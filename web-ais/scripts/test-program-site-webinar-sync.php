<?php
// Reuse the isolated WooCommerce/filesystem fixture. No network or real site writes.
require __DIR__ . '/test-program-site-wordpress.php';
$test_role = 'shop'; $test_collision = null;
$key = hash('sha256', 'webinar-sync-fixture');
$old_join = 'https://salutejazz.ru/calls/old?psw=Old_123';
$new_join = 'https://salutejazz.ru/calls/new?psw=AbCd_123&name=%D0%90#join';
$prepared = ais_pg_mutate('prepare-product', array('key'=>$key,'hash'=>hash('sha256','sync-v1'),'type'=>'ПРО',
    'slug'=>'sync-old','productName'=>'Sync webinar','price'=>500,'joinUrl'=>$old_join));
$id = $prepared['id']; $product = wc_get_product($id);
$product->set_status('publish');
$downloads = $product->get_downloads('edit'); $download_id = $downloads[0]->get_id();
$extra = new WC_Product_Download(); $extra->set_id('unrelated'); $extra->set_file('/manual/materials.pdf');
$downloads['unrelated'] = $extra; $product->set_downloads($downloads); $product->save();
$dir = ABSPATH . 'wp-content/uploads/dae-uploads/webinars';
$private_dir = dirname(rtrim(ABSPATH,'/')) . '/ais-webinar-files/' . $key;
wp_mkdir_p($private_dir);
file_put_contents($private_dir . '/connection.txt', $old_join);
file_put_contents($private_dir . '/connection.html', '<html>' . $old_join . '</html>');
$model = array('id'=>'sync','type'=>'ПРО','name'=>'Updated webinar','productName'=>'Updated webinar',
    'price'=>600,'oldPrice'=>800,'hours'=>2,'slug'=>'sync-new','joinUrl'=>$new_join,'landingUrl'=>'https://edu-plus.ru/other_course/sync-new/');
$request = array('model'=>$model,'productId'=>$id,'landingId'=>999,'landingStatus'=>'publish','version'=>ais_pg_sync_product($id)['version']);
$before = serialize(array($test_posts,$test_meta,$test_products,WF301_functions::$rules));
$old_file = file_get_contents($dir . '/sync-old.html');
check(ais_pg_sync_existing($request, true)['ok'] === true, 'PRO file/URL preflight succeeds');
check(serialize(array($test_posts,$test_meta,$test_products,WF301_functions::$rules)) === $before && !file_exists($dir . '/sync-new.html'), 'Preflight makes no product, redirect or file writes');
$test_collision = (object) array('ID'=>999999);
rejects(function () use ($request) { ais_pg_sync_existing($request,true); }, 'Occupied product slug');
$test_collision = null;
file_put_contents($dir . '/sync-new.html', '<!-- AIS webinar ' . str_repeat('9',64) . ' -->Foreign file');
rejects(function () use ($request) { ais_pg_sync_existing($request,true); }, 'Foreign webinar filename');
check(strpos(file_get_contents($dir . '/sync-new.html'),'Foreign file') !== false, 'Foreign HTML is not overwritten');
unlink($dir . '/sync-new.html');
$rules = WF301_functions::$rules;
$manual = ais_pg_product_redirect_rules($id,true,array('slug'=>'sync-new','landingUrl'=>$model['landingUrl'],'downloadUrl'=>$new_join))[1];
$manual['tags'] = 'Manual redirect'; WF301_functions::save_redirect_rule($manual);
rejects(function () use ($request) { ais_pg_sync_existing($request,true); }, 'Manual redirect conflict is found before mutation');
WF301_functions::$rules = $rules;
check(serialize(array($test_posts,$test_meta,$test_products,WF301_functions::$rules)) === $before, 'All rejected checks preserve current state');
$other_products = $test_products; unset($other_products[$id]); $other_before = serialize($other_products);
$result = ais_pg_sync_existing($request);
check($result['id'] === $id && $result['status'] === 'publish' && $result['slug'] === 'sync-new', 'Sync renames the same product, without republishing or duplicating');
check(get_post_meta($id,'_ais_webinar_join_url') === $new_join, 'Full Jazz URL saved without losing query/password/fragment');
check(get_post_meta($id,'_ais_landing_url') === $model['landingUrl'], 'Cart destination uses new landing URL');
$new_url = 'https://zifra-plus.ru/wp-content/uploads/dae-uploads/webinars/sync-new.html';
check(get_post_meta($id,'_ais_download_file') === $new_url, 'Main download filename follows new promo code');
$saved_downloads = wc_get_product($id)->get_downloads('edit');
check($saved_downloads[0]->get_id() === $download_id && $saved_downloads[0]->get_file() === $new_url, 'Existing download permissions retain their ID');
check($saved_downloads['unrelated'] === $extra, 'Unrelated materials are untouched');
foreach (array($dir.'/sync-old.html',$dir.'/sync-new.html',$private_dir.'/connection.html',$private_dir.'/connection.txt') as $file) {
    $content = html_entity_decode(file_get_contents($file), ENT_QUOTES, 'UTF-8');
    check(strpos($content,$new_join) !== false && strpos($content,$old_join) === false, 'Every linked current/legacy file uses the new meeting');
}
foreach (get_post_meta($id,'_ais_redirect_rule_ids') as $rule_id) {
    $rule = WF301_functions::get_redirect($rule_id);
    check($rule['url_to'] === (substr($rule['tags'],-8) === 'download' ? $new_join : $model['landingUrl']), 'Redirect targets updated');
    check($rule['status'] === 'enabled', 'Published program keeps active redirects');
}
$other_products = $test_products; unset($other_products[$id]); check(serialize($other_products) === $other_before, 'Other products and prototypes remain intact');
// A second rename still refreshes every old generated HTML link.
$request['model']['slug'] = 'sync-final'; $request['model']['landingUrl'] = 'https://edu-plus.ru/other_course/sync-final/';
$request['model']['joinUrl'] = 'https://salutejazz.ru/calls/final?psw=Final_456';
$request['version'] = ais_pg_sync_product($id)['version'];
ais_pg_sync_existing($request);
foreach (array('sync-old','sync-new','sync-final') as $slug) check(strpos(file_get_contents($dir.'/'.$slug.'.html'),'Final_456') !== false,'All earlier filenames updated on subsequent sync');
$count = count($test_posts); $request['version'] = ais_pg_sync_product($id)['version'];
ais_pg_sync_existing($request);
check(count($test_posts) === $count && wc_get_product($id)->get_downloads('edit')[0]->get_id() === $download_id, 'Retry keeps post and download identities');
// A concurrent file change is part of the optimistic-lock snapshot.
$request['version'] = ais_pg_sync_product($id)['version'];
file_put_contents($dir.'/sync-old.html', file_get_contents($dir.'/sync-old.html') . '<!-- concurrent edit -->');
$before_stale = serialize(array($test_posts,$test_meta));
rejects(function () use ($request) { ais_pg_sync_existing($request); }, 'Stale file snapshot rejected');
check(serialize(array($test_posts,$test_meta)) === $before_stale, 'Stale file check does not write product fields');
$request['version'] = ais_pg_sync_product($id)['version'];
$request['model']['joinUrl'] = 'javascript:alert(1)';
rejects(function () use ($request) { ais_pg_sync_existing($request,true); }, 'Unsafe Jazz URL rejected');
$request['model']['joinUrl'] = $new_join; $request['model']['type'] = 'КПК';
rejects(function () use ($request) { ais_pg_sync_existing($request,true); }, 'Jazz update refused for non-PRO');
echo "PASS: PRO sync updates current/legacy HTML/TXT, preserves download IDs, renames product/redirects, checks collisions and stale files, supports retries\n";
