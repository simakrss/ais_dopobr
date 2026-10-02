<?php
// In-memory WP/ACF tests. Never changes a website or a real product.
$admin_request = false; $purged_posts = array();
function is_admin() { return $GLOBALS['admin_request']; }
function do_action($name, ...$args) { $GLOBALS['purged_posts'][] = array($name, $args); }
function do_shortcode($value) { return str_replace('[skidki-pp-pk]', '30.09.2026', $value); }
require __DIR__ . '/test-program-site-variants.php';
$before_fields = $fields[42]; $before_products = serialize($products); $before_posts = $posts;
$definitions = array_column(get_field_objects(42, false), null, 'name');
$request = array('landingId'=>42, 'productId'=>99, 'hidden'=>true, 'version'=>ais_pg_sync_landing(42)['version']);
rejects(function() use ($request) { ais_pg_set_variant_visibility(array_merge($request, array('hidden'=>'true'))); }, 'Проверьте');
rejects(function() use ($request) { ais_pg_set_variant_visibility(array_merge($request, array('productId'=>1000))); }, 'не связан');
rejects(function() use ($request) { ais_pg_set_variant_visibility(array_merge($request, array('version'=>'old'))); }, 'изменился');
$role='shop';
rejects(function() use ($request) { ais_pg_set_variant_visibility($request); }, 'только на сайте');
$role='edu';
$write_count = $writes;
$hidden = ais_pg_set_variant_visibility($request);
check($hidden['hidden'] && $writes === $write_count + 1, 'Only visibility metadata is written');
check($fields[42] === $before_fields && serialize($products) === $before_products && $posts === $before_posts, 'Hide leaves all original fields, posts, products and samples intact');
check(!$wpdb->locked && count($purged_posts)===1, 'Lock released and page cache purged');
$snapshot = ais_pg_sync_landing(42);
check(count($snapshot['offers'])===2 && $snapshot['offers'][1]['hidden']===true, 'API continues to return hidden variants');
check($snapshot['version']!==$request['version'], 'Visibility participates in stale-request protection');
foreach (array('blok_ceny','programmy_obucheniya','slajder') as $name) {
    $visible = ais_pg_visible_variant_rows($fields[42][$name],42,$definitions[$name]);
    check(count($visible)===1 && $visible[0]===$before_fields[$name][0], 'Only the original variant remains visible in '.$name);
    $keyed = ais_pg_acf_value($definitions[$name],$fields[42][$name],true);
    check(count(ais_pg_visible_variant_rows($keyed,42,$definitions[$name]))===1, 'Raw ACF field-key rows filtered for have_rows: '.$name);
    $admin_request=true;
    check(ais_pg_visible_variant_rows($keyed,42,$definitions[$name])===$keyed, 'Admin editing always sees complete data');
    $admin_request=false;
}
$note=ais_pg_format_variant_price_note(ais_pg_variant_price_note(),42,array('name'=>'blok_ceny_1_primechanie_ceny'));
check($note==="Скидка до 30.09.2026<br>\nРассрочка без переплат", 'Default has exactly two rendered lines and an evaluated shortcode');
check(ais_pg_format_variant_price_note('Свои условия',42,array('name'=>'primechanie_ceny'))==='Свои условия', 'Custom notes are preserved');
// A remaining visible offer must not be rewritten to a different hidden product.
$sample_meta[42]['_ais_generator_key']=str_repeat('1',64);
check(ais_pg_render_registration_links('https://zifra-plus.ru/checkout/?add-to-cart=12',42,'ssylka_na_registraciyu')==='https://zifra-plus.ru/checkout/?add-to-cart=12', 'Visible registration link keeps its product identity');
$fields[42]['blok_ceny'][1]['primechanie_ceny']='Свои условия';
$sync['version']=ais_pg_sync_landing(42)['version'];
ais_pg_sync_existing($sync);
check(ais_pg_hidden_offers(42)===array(99), 'Ordinary synchronization cannot unhide an offer');
check($fields[42]['blok_ceny'][1]['primechanie_ceny']==='Свои условия', 'Synchronization cannot overwrite an edited note');
$request['version']=ais_pg_sync_landing(42)['version']; $request['hidden']=false;
ais_pg_set_variant_visibility($request);
check(ais_pg_hidden_offers(42)===array(), 'Unhide removes only the visibility flag');
foreach (array('blok_ceny','programmy_obucheniya','slajder') as $name) check(ais_pg_visible_variant_rows($fields[42][$name],42,$definitions[$name])===$fields[42][$name], 'Showing restores complete original rows: '.$name);
check(serialize($products)===$before_products, 'No store product was written at any stage');
echo "PASS: hide/show, raw/keyed ACF rows, plans and samples, stale guards, admin data, sync preservation, note formatting and no shop mutations\n";
