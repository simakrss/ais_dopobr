<?php
// Isolated fixtures only: no WordPress connection, network or production files.
require __DIR__ . '/test-program-site-wordpress.php';
$test_role = 'shop'; $test_collision = null;
$old = 'https://jazz.sber.ru/#/calls/old?psw=Old_123';
$join = 'https://salutejazz.ru/calls/new?psw=New_456&name=%D0%90#join';
$dir = ABSPATH . 'wp-content/uploads/dae-uploads/webinars';
$file = $dir . '/legacy-source.html';
$original = '<!-- original layout --><meta http-equiv="refresh" content="0;URL=' . $old . '"/>'
    . '<h1>Вебинар</h1><a href="' . $old . '">Подключиться</a><a href="https://example.org/materials">Материалы</a>'
    . '<script>window.location.href="' . $old . '";</script>';
file_put_contents($file, $original);
$product = new WC_Product_Simple();
$product->set_status('publish'); $product->set_slug('legacy-product'); $product->set_name('Legacy webinar');
$product->set_price('390'); $product->set_regular_price('1000'); $product->set_sale_price('390');
$product->update_meta_data('_ais_generator_key', '');
$download = new WC_Product_Download(); $download->set_id('old-permission-id'); $download->set_name('Вход');
$download->set_file('http://zifra-plus.ru/wp-content/uploads/dae-uploads/webinars/legacy-source.html');
$extra = new WC_Product_Download(); $extra->set_id('materials'); $extra->set_file('/manual/materials.pdf');
$product->set_downloads(array('old'=>$download,'extra'=>$extra)); $id = $product->save();
$model = array('id'=>'legacy-fixture','type'=>'ПРО','name'=>'Legacy webinar','productName'=>'Legacy webinar',
    'price'=>390,'oldPrice'=>1000,'hours'=>1,'joinUrl'=>$join,'landingUrl'=>'https://edu-plus.ru/other_course/legacy-product/');
$request = array('model'=>$model,'productId'=>$id,'landingId'=>999,'landingStatus'=>'publish','version'=>ais_pg_sync_product($id)['version']);
$before = serialize(array($test_posts,$test_meta,$test_products,WF301_functions::$rules));
check(ais_pg_sync_existing($request,true)['ok'] === true, 'Attached manual HTML is accepted without AIS metadata');
check(file_get_contents($file) === $original && !file_exists($dir.'/legacy-product.html'), 'Preflight does not change or create files');
check(serialize(array($test_posts,$test_meta,$test_products,WF301_functions::$rules)) === $before, 'Preflight does not mutate products/redirects');
// Even a legacy file with no AIS metadata participates in stale-preview checks.
file_put_contents($file,$original.'<!-- external edit -->');
rejects(function () use ($request) { ais_pg_sync_existing($request); }, 'Unmarked file changes invalidate the preview');
check(serialize(array($test_posts,$test_meta,$test_products,WF301_functions::$rules)) === $before, 'Stale legacy preview cannot write');
file_put_contents($file,$original);
ais_pg_sync_existing($request);
$updated = file_get_contents($file);
check(strpos($updated,$old) === false && substr_count(html_entity_decode($updated,ENT_QUOTES,'UTF-8'),$join) === 3, 'Meta refresh, anchor and script all use the current meeting');
check(strpos($updated,'<!-- original layout -->') === 0 && strpos($updated,'https://example.org/materials') !== false && strpos($updated,'<h1>Вебинар</h1>') !== false, 'Original layout and unrelated URLs are preserved');
check(strpos($updated,'window.location.href="'.$join.'"') !== false, 'Script URL does not acquire HTML entities');
$backup_dir = dirname(rtrim(ABSPATH,'/')) . '/ais-webinar-files/legacy-backups/' . $id;
$backups = glob($backup_dir.'/*.bak');
check(count($backups) === 1 && file_get_contents($backups[0]) === $original, 'Exact original is backed up outside public_html');
$saved = wc_get_product($id)->get_downloads('edit');
check(count($saved) === 2 && $saved['old']->get_id() === 'old-permission-id' && $saved['extra'] === $extra, 'Download IDs/permissions and unrelated material are retained');
check(get_post_meta($id,'_ais_webinar_legacy_slugs') === array('legacy-source'), 'Previous file remains tracked after download URL migration');
$request['version'] = ais_pg_sync_product($id)['version'];
ais_pg_sync_existing($request);
check(file_get_contents($file) === $updated && count(glob($backup_dir.'/*.bak')) === 1, 'Same meeting is a byte-for-byte no-op without redundant backups');
$request['model']['joinUrl'] = 'https://salutejazz.ru/calls/next?psw=Next_789';
$request['version'] = ais_pg_sync_product($id)['version'];
ais_pg_sync_existing($request);
check(strpos(file_get_contents($file),'Next_789') !== false && strpos(file_get_contents($dir.'/legacy-product.html'),'Next_789') !== false, 'Subsequent sync updates both legacy and generated filenames');
// Shared legacy files must not silently redirect another product to this webinar.
$other = new WC_Product_Simple(); $other->set_status('publish'); $other->set_slug('another-webinar'); $other->set_name('Other');
$other->update_meta_data('_ais_generator_key',''); $other->set_downloads(array(clone $download)); $other->save();
$request['version'] = ais_pg_sync_product($id)['version'];
rejects(function () use ($request) { ais_pg_sync_existing($request,true); }, 'Shared file ownership conflict remains blocked');
$other->set_downloads(array()); $other->save();
// An unbound collision is not adopted, even if it also contains a Jazz redirect.
file_put_contents($dir.'/unbound.html','<meta http-equiv="refresh" content="0;URL='.$old.'">');
$request['model']['slug']='unbound'; $request['model']['landingUrl']='https://edu-plus.ru/other_course/unbound/';
rejects(function () use ($request) { ais_pg_sync_existing($request,true); }, 'Unbound HTML is not overwritten');
unset($request['model']['slug']); $request['model']['landingUrl']=$model['landingUrl'];
$expected_hash=hash_file('sha256',$file);
$locations=ais_pg_webinar_file_locations($id);
file_put_contents($file,file_get_contents($file).'<!-- concurrent -->');
rejects(function () use ($id,$locations,$expected_hash,$join) { ais_pg_sync_legacy_webinar_file($id,$locations,'legacy-source',$expected_hash,$join); }, 'Concurrent edit is rechecked under the file lock');
file_put_contents($file,'<!-- AIS webinar '.str_repeat('f',64).' -->'.$original);
$request['version']=ais_pg_sync_product($id)['version'];
rejects(function () use ($request) { ais_pg_sync_existing($request,true); }, 'Explicit foreign AIS ownership is not adopted');
file_put_contents($file,'<html>Материалы без ссылки подключения</html>');
$request['version']=ais_pg_sync_product($id)['version'];
rejects(function () use ($request) { ais_pg_sync_existing($request,true); }, 'Unrecognized HTML is not rewritten');
foreach (array('https://evil.example/wp-content/uploads/dae-uploads/webinars/legacy-source.html','/wp-content/uploads/dae-uploads/webinars/../secret.html','https://user:pass@zifra-plus.ru/wp-content/uploads/dae-uploads/webinars/legacy-source.html') as $bad) check(ais_pg_webinar_download_slug($bad)==='', 'Only bounded local webinar paths are accepted');
check(ais_pg_webinar_download_slug('/wp-content/uploads/dae-uploads/webinars/legacy-source.html')==='legacy-source','Root-relative legacy link supported');
rejects(function () use ($original) { ais_pg_legacy_webinar_html($original,'javascript:alert(1)'); }, 'Unsafe replacement URL rejected');
echo "PASS: bound unmarked webinar HTML, in-place URL replacement/backups, all targets, download identity, repeat/rename safety, shared/foreign/unbound protection and stale file checks\n";
