<?php
// Isolated in-memory contract test. No WordPress, database, network, or site writes.
$image_test_dir = sys_get_temp_dir() . '/ais-image-sync-' . bin2hex(random_bytes(8));
mkdir($image_test_dir . '/wp-admin/includes', 0700, true);
file_put_contents($image_test_dir . '/wp-admin/includes/image.php', '<?php // isolated image mock');
file_put_contents($image_test_dir . '/cover.jpg', 'isolated image file');
define('ABSPATH', $image_test_dir . '/');
register_shutdown_function(function () use ($image_test_dir) {
    unlink($image_test_dir . '/wp-admin/includes/image.php'); unlink($image_test_dir . '/cover.jpg');
    rmdir($image_test_dir . '/wp-admin/includes'); rmdir($image_test_dir . '/wp-admin'); rmdir($image_test_dir);
});
define('OBJECT', 'OBJECT');
$role = 'edu'; $posts = array(); $fields = array(); $products = array(); $writes = 0;
function add_action(...$args) {} function add_filter(...$args) {}
function home_url($path='') { return 'https://' . ($GLOBALS['role']==='edu'?'edu-plus.ru':'zifra-plus.ru') . $path; }
function wp_parse_url($url,$part=-1) { return parse_url($url,$part); }
function wp_json_encode($data) { return json_encode($data,JSON_UNESCAPED_UNICODE); }
function wp_slash($data) { return $data; }
function sanitize_text_field($text) { return strip_tags($text); }
function wp_kses_post($text) { return str_replace('<script>bad</script>','',$text); }
if (!function_exists('mb_strlen')) { function mb_strlen($text) { return preg_match_all('/./us',$text); } }
function get_post($id) { return isset($GLOBALS['posts'][$id]) ? (object) $GLOBALS['posts'][$id] : null; }
function get_post_status($id) { return $GLOBALS['posts'][$id]['post_status'] ?? ''; }
function get_post_type($id) { return $GLOBALS['posts'][$id]['post_type'] ?? ''; }
function get_post_meta($id,$key,$single=true) { return $GLOBALS['sample_meta'][$id][$key] ?? ''; }
function update_post_meta($id,$key,$value) { $GLOBALS['sample_meta'][$id][$key]=$value; $GLOBALS['writes']++; }
function get_post_mime_type($id) { return $GLOBALS['sample_mime'][$id] ?? ''; }
function get_post_thumbnail_id($id) {return $GLOBALS['thumbnails'][$id] ?? ($id===42?90:0);}
function set_post_thumbnail($id,$image) {$GLOBALS['thumbnails'][$id]=$image;}
function wp_get_attachment_image_url($id,$size) {return $id===90?'https://edu-plus.ru/wp-content/uploads/cover.jpg':($id===91?'https://edu-plus.ru/wp-content/uploads/other.jpg':false);}
function get_attached_file($id) {return $GLOBALS['image_test_dir'].'/cover.jpg';}
function get_post_field($key,$id) {return $GLOBALS['posts'][$id][$key] ?? '';}
function get_page_by_path($slug,$output,$types) {
    foreach ($GLOBALS['posts'] as $id=>$post) if (($post['post_name'] ?? '') === $slug && in_array($post['post_type'],(array)$types,true)) return (object) array('ID'=>$id);
    return null;
}
function wp_get_attachment_metadata($id) {return array('width'=>1);}
function get_permalink($id) { return home_url('/item/' . $id . '/'); }
function admin_url($path) { return home_url('/wp-admin/' . $path); }
function add_query_arg($params,$url) { return $url . '?' . http_build_query($params); }
function is_wp_error($value) { return false; }
function get_posts($args) { if($args['post_type']==='attachment') return array(191); return array_keys(array_filter($GLOBALS['posts'],function($post)use($args){return $post['post_name']===$args['name'] && in_array($post['post_type'],$args['post_type'],true);})); }
function get_field_objects($id,$format=false) {
    $result=array();
    foreach($GLOBALS['fields'][$id] ?? array() as $name=>$value) {
        $field=array('key'=>'field_'.$name,'name'=>$name,'value'=>$value,'type'=>'text');
        if($name==='blok_ceny') { $field['type']='repeater';$field['sub_fields']=array_map(function($key){return array('name'=>$key,'key'=>'field_'.$key,'type'=>'text');},array_keys($value[0])); }
        if (array_key_exists($name, ais_pg_certificate_slots())) $field['type'] = 'image';
        if ($name === 'slajder') { $field['type'] = 'repeater'; $field['sub_fields'] = array(array('name'=>'izobrazhenie_slajda','key'=>'field_izobrazhenie_slajda','type'=>'image')); }
        if ($name === 'programmy_obucheniya') {
            $field['type'] = 'repeater';
            $field['sub_fields'] = array_map(function ($key) { return array('name'=>$key,'key'=>'field_'.$key,'type'=>'text'); }, array('zagolovok_programmy_obucheniya','ssylka_na_programmu_kursa','nazvanie_knopki_skachat'));
            $field['sub_fields'][] = array('name'=>'moduli_programmy','key'=>'field_moduli_programmy','type'=>'repeater','sub_fields'=>array_map(function ($key) {return array('name'=>$key,'key'=>'field_'.$key,'type'=>'text');},array('nazvanie_modulya','opisanie_modulya','chasy_vsego','chasy_1','chasy_2','kontrol')));
        }
        $result[]=$field;
    }
    return $result;
}
function update_field($key,$value,$id) {
    if(!empty($GLOBALS['drop_write'])) return false;
    if(($GLOBALS['drop_field'] ?? '') === $key) return false;
    foreach(get_field_objects($id) as $field) if($field['key']===$key) {$GLOBALS['fields'][$id][$field['name']]=ais_pg_acf_value($field,$value);$GLOBALS['writes']++;return true;}
    throw new RuntimeException('Unknown ACF field');
}
function wp_update_post($data,$error=false) { $GLOBALS['posts'][$data['ID']]=array_merge($GLOBALS['posts'][$data['ID']],$data);$GLOBALS['writes']++;return $data['ID']; }
class SyncDb {
    public $prefix='test_';public $locked=false;
    function prepare($sql,...$args) {return $sql;}
    function get_var($sql) {$this->locked=strpos($sql,'GET_LOCK')!==false;return 1;}
}
$wpdb=new SyncDb();
class SyncProduct {
    public $id;public $values;
    function __construct($id) {$this->id=$id;$this->values=array('name'=>'Old product','status'=>'publish','price'=>'1000','regular_price'=>'1500','sale_price'=>'1000','description'=>'Existing description','date_on_sale_from'=>'','date_on_sale_to'=>'','date_modified'=>'2026-09-14', 'downloads'=>array('PRIVATE FILE'), 'slug'=>'unchanged', 'virtual'=>true);}
    function is_type($type) {return $type==='simple';}
    function __call($name,$args) { $key=substr($name,4);if(strpos($name,'get_')===0) return $this->values[$key] ?? ''; $this->values[$key]=$args[0]; }
    function save() {$GLOBALS['products'][$this->id]=$this;if(isset($this->values['image_id'])) set_post_thumbnail($this->id,$this->values['image_id']);$GLOBALS['writes']++;return $this->id;}
}
function wc_get_product($id) {return isset($GLOBALS['products'][$id]) ? clone $GLOBALS['products'][$id] : false;}
require __DIR__ . '/../services/wordpress/ais-program-generator.php';
function check($ok,$message) {if(!$ok) throw new RuntimeException('FAIL: '.$message);}
function rejects($callback,$contains) {try{$callback();}catch(RuntimeException $error){check(strpos($error->getMessage(),$contains)!==false,$error->getMessage());return;}throw new RuntimeException('FAIL: expected rejection '.$contains);}
$posts[42]=array('ID'=>42,'post_title'=>'Old landing','post_type'=>'courses-pk','post_status'=>'publish','post_name'=>'pk-test','post_modified_gmt'=>'2026-09-14','post_content'=>'<p>Keep page content</p>');
$base=array('skidka'=>'33','kolichestvo_chasov'=>'72','staraya_cena'=>'1500','stoimost_kursa'=>'1000','primechanie_ceny'=>'Keep note','ssylka_na_registraciyu'=>'https://zifra-plus.ru/checkout/?add-to-cart=12');
$fields[42]=array('blok_ceny'=>array($base,array_merge($base,array('ssylka_na_registraciyu'=>'https://zifra-plus.ru/checkout/?other=1&amp;add-to-cart=13'))),'stoimost_kursa'=>'1000','kolichestvo_chasov'=>'72','podacha_zayavki_nazvanie_kursa'=>'Old landing','srok'=>'2 weeks','forma_obucheniya'=>'Online','opisanie_dokumenta'=>'Existing text','blok_opisaniya_kursa'=>array(array('soderzhimoe_bloka'=>'Review Old landing','photo'=>99)),'slajder'=>array(array('izobrazhenie_slajda'=>100)));
$products[12]=new SyncProduct(12);$products[13]=new SyncProduct(13);
$model=array('type'=>'КПК','name'=>'New landing','productName'=>'New product','price'=>0,'oldPrice'=>0,'hours'=>80,'duration'=>'3 недели','studyForm'=>'Заочная','descriptionHtml'=>'','speakerHtml'=>'');
$snapshot=ais_pg_resolve_site(array('landingId'=>42));
check($snapshot['previewImageUrl']==='https://edu-plus.ru/wp-content/uploads/cover.jpg','Real featured landing image supplied for preview fallback');
check(count($snapshot['offers'])===2,'All offers resolved, including encoded query');
check(ais_pg_resolve_site(array('slug'=>'pk-test'))['id']===42,'Exact slug lookup');
check(ais_pg_resolve_site(array('slug'=>'missing-test','allowMissing'=>true))['found']===false,'Missing slug explicitly distinguished from failures');
check(ais_pg_resolve_site(array('landingId'=>99999,'allowMissing'=>true))['found']===false,'Missing ID reported without a mutation');
rejects(function(){ais_pg_resolve_site(array('slug'=>'missing-test'));},'не найден');
rejects(function(){ais_pg_resolve_site(array('slug'=>'../evil','allowMissing'=>true));},'код');
rejects(function(){ais_pg_resolve_site(array('slug'=>'../evil'));},'код');
$before=$fields[42];$post_before=$posts[42];
$data=array('model'=>$model,'landingId'=>42,'productId'=>13,'version'=>$snapshot['version']);
check(ais_pg_sync_existing($data,true)['ok']===true && $writes===0,'Preflight never writes');
rejects(function()use($data){ais_pg_sync_existing(array_merge($data,array('productId'=>999)));},'ценовой блок');
$fields[42]['srok']='Changed concurrently';
rejects(function()use($data){ais_pg_sync_existing($data);},'изменились');
check($writes===0,'Stale snapshots must not write');
$fields[42]=$before;
$result=ais_pg_sync_existing($data);
check($result['id']===42,'Correct landing updated');
check($fields[42]['blok_ceny'][0]===$before['blok_ceny'][0],'Other offer preserved verbatim');
check($fields[42]['blok_ceny'][1]['stoimost_kursa']==='0','Free program price updated');
check($fields[42]['blok_ceny'][1]['staraya_cena']==='' && $fields[42]['blok_ceny'][1]['skidka']==='0','Discount removed');
check($fields[42]['stoimost_kursa']==='1000','Header of first variant preserved');
check($fields[42]['blok_opisaniya_kursa']===$before['blok_opisaniya_kursa'] && $fields[42]['slajder']===$before['slajder'],'Reviews/images untouched');
check($fields[42]['opisanie_dokumenta']==='Existing text','Empty AIS description does not erase existing content');
check($posts[42]['post_content']===$post_before['post_content'] && $posts[42]['post_status']==='publish' && $posts[42]['post_name']==='pk-test','Content/status/URL preserved');
check(!$wpdb->locked,'Lock released');
$newdata=array_merge($data,array('version'=>ais_pg_sync_landing(42)['version']));
ais_pg_sync_existing($newdata); // Idempotent retry has no new object.
check(count($posts)===1,'Retry creates no duplicate');
$newdata['productId']=12;$newdata['model']['price']=500;$newdata['model']['oldPrice']=1000;
$newdata['version']=ais_pg_sync_landing(42)['version'];
ais_pg_sync_existing($newdata);
check($fields[42]['stoimost_kursa']==='500' && $fields[42]['blok_ceny'][0]['skidka']==='50','First offer updates header and discount');
$newdata['version']=ais_pg_sync_landing(42)['version'];$newdata['model']['price']=600;$drop_write=true;
rejects(function()use($newdata){ais_pg_sync_existing($newdata);},'не подтвердил поле');
$drop_write=false;
$role='shop';
$data['version']=ais_pg_sync_product(13)['version'];
$before_product=$products[13]->values;
ais_pg_sync_existing($data,true);ais_pg_sync_existing($data);
check($products[13]->values['name']==='New product' && $products[13]->values['price']==='0','Existing Woo product name/free price updated');
foreach(array('description','downloads','slug','virtual','status') as $key) check($products[13]->values[$key]===$before_product[$key], 'Preserved product '.$key);
check($products[12]->values['name']==='Old product','Unselected product not touched');
check(!$wpdb->locked,'Shop lock released');
echo "PASS: exact landing resolution, ACF price variants, free/old price, reviews/images/content/downloads preservation, legacy Woo product, stale snapshot, verification and retries\n";
$role='edu';
$posts[43]=array_merge($posts[42],array('ID'=>43,'post_title'=>'Источник','post_name'=>'source'));
$posts[91]=array('post_type'=>'attachment','post_modified_gmt'=>'image-v1');
$posts[90]=array('post_type'=>'attachment','post_modified_gmt'=>'image-v0');
set_post_thumbnail(43,91);
$image_source=ais_pg_image_source(43);
$image_data=array('model'=>array_merge($model,array('imageSource'=>$image_source)),'landingId'=>42,'productId'=>13,'version'=>ais_pg_sync_landing(42)['version']);
$image_before=$fields[42];$source_before=$posts[43];$count_before=$writes;
ais_pg_sync_existing($image_data,true);
check($writes===$count_before && get_post_thumbnail_id(42)===90,'Image preflight never changes destination');
ais_pg_sync_existing($image_data);
check(get_post_thumbnail_id(42)===91 && get_post_thumbnail_id(43)===91 && $posts[43]===$source_before,'Landing receives selected image, source intact');
check($fields[42]['blok_opisaniya_kursa']===$image_before['blok_opisaniya_kursa'] && $fields[42]['slajder']===$image_before['slajder'],'Review photos and document samples intact');
$image_data['version']=ais_pg_sync_landing(42)['version'];
set_post_thumbnail(43,90);$count_before=$writes;
rejects(function()use($image_data){ais_pg_sync_existing($image_data);},'изменилось');
check($writes===$count_before,'Stale source rejected before writes');
set_post_thumbnail(43,91);
$role='shop';$image_data['version']=ais_pg_sync_product(13)['version'];
$other_image=get_post_thumbnail_id(12);
ais_pg_sync_existing($image_data,true);ais_pg_sync_existing($image_data);
check(get_post_thumbnail_id(13)===191 && get_post_thumbnail_id(12)===$other_image,'Only selected product gets imported media ID');
check($products[13]->values['status']==='publish' && $products[13]->values['downloads']===$before_product['downloads'],'Image update preserves publication and downloads');
echo "PASS: explicit image synchronization on both sites, source/destination concurrency, other products, samples and reviews preserved\n";
$role = 'edu';
$rename = array('model'=>array_merge($model,array('slug'=>'new-promo-code')),'landingId'=>42,'productId'=>13,'version'=>ais_pg_sync_landing(42)['version']);
$rename_before = serialize(array($posts,$fields)); $write_count = $writes;
$posts[888] = array('ID'=>888,'post_type'=>'page','post_name'=>'new-promo-code');
rejects(function () use ($rename) { ais_pg_sync_existing($rename,true); }, 'занят');
unset($posts[888]);
check($writes === $write_count && serialize(array($posts,$fields)) === $rename_before,'Occupied landing address blocks all writes');
check(ais_pg_sync_existing($rename,true)['ok'] === true && $writes === $write_count,'Landing rename preflight is read-only');
$renamed = ais_pg_sync_existing($rename);
check($renamed['id'] === 42 && $renamed['slug'] === 'new-promo-code','Landing is renamed in place');
check($posts[42]['post_status'] === 'publish' && $posts[42]['post_type'] === 'courses-pk','Landing type/publication state retained');
check($fields[42]['blok_opisaniya_kursa'] === $image_before['blok_opisaniya_kursa'] && $fields[42]['slajder'] === $image_before['slajder'],'Rename preserves reviews and samples');
$rename['version'] = ais_pg_sync_landing(42)['version']; $write_count = $writes;
$posts[42]['post_name'] = 'concurrent-name';
rejects(function () use ($rename) { ais_pg_sync_existing($rename); }, 'изменились');
check($writes === $write_count,'Concurrent slug edit rejected even within the same modified timestamp');
echo "PASS: in-place landing rename, occupied address, read-only preflight, unchanged content/status and concurrent slug protection\n";

// Synchronizing a webinar edits its existing schedule, not reviews, URLs or identities.
$schedule_model = array_merge($model, array('type'=>'ПРО', 'date'=>'2026-10-25', 'time'=>'19:30'));
$old_schedule = '<p>Расписание трансляции — <b>4 августа 2026 года</b> в 18.00 (мск)</p>';
$new_schedule = '<p>Расписание трансляции — <b>25 октября 2026 года</b> в 19.30 (мск)</p>';
$posts[42]['post_content'] = $old_schedule;
$posts[42]['post_excerpt'] = $old_schedule;
$fields[42]['opisanie_dokumenta'] = $old_schedule;
$fields[42]['review_text'] = $old_schedule;
$fields[42]['tekst_etap_obucheniya_1'] = 'Преподаватель работает с 04.08.2020.';
$schedule_data = array('model'=>$schedule_model,'landingId'=>42,'productId'=>13,'version'=>ais_pg_sync_landing(42)['version']);
$write_count = $writes;
check(ais_pg_sync_existing($schedule_data,true)['ok'] === true && $writes === $write_count,'Schedule preflight makes no writes');
$invalid = $schedule_data; $invalid['model']['date'] = '2026-02-30';
rejects(function()use($invalid){ais_pg_sync_existing($invalid);},'дату и время');
check($writes === $write_count,'Invalid schedule rejected before writes');
ais_pg_sync_existing($schedule_data);
check($posts[42]['post_content'] === $new_schedule && $posts[42]['post_excerpt'] === $new_schedule,'Page content and excerpt schedule updated');
check($fields[42]['opisanie_dokumenta'] === $new_schedule,'ACF schedule updated');
check($fields[42]['review_text'] === $old_schedule && $fields[42]['tekst_etap_obucheniya_1'] === 'Преподаватель работает с 04.08.2020.','Reviews and speaker biography preserved');
$role = 'shop';
$products[13]->values['description'] = $old_schedule;
$products[13]->values['short_description'] = $old_schedule;
$schedule_data['version'] = ais_pg_sync_product(13)['version'];
ais_pg_sync_existing($schedule_data);
check($products[13]->values['description'] === $new_schedule && $products[13]->values['short_description'] === $new_schedule,'Product full and short descriptions updated');
$schedule_data['version'] = ais_pg_sync_product(13)['version'];
$products[13]->values['short_description'] .= ' Concurrent edit';
$write_count = $writes;
rejects(function()use($schedule_data){ais_pg_sync_existing($schedule_data);},'изменились');
check($writes === $write_count,'Concurrent short description edit prevents writes');
echo "PASS: webinar schedule sync on both sites, calendar validation, read-only preflight, preserved reviews/biography and concurrency\n";

// Explicit sample replacement works for legacy/published pages without a generator key.
$role = 'edu';
foreach (array('ПРО','ДОП','КПК','ППП') as $sample_type) {
    $pages = array(); $languages = in_array($sample_type,array('ПРО','ДОП'),true) ? array('ru','en') : array('ru','page-2','page-3','page-4');
    $sample_hash = hash('sha256', 'current plan and template ' . $sample_type);
    foreach ($languages as $index => $language) {
        $id = 300 + $index;
        $posts[$id] = array('post_type'=>'attachment');
        $sample_meta[$id]['_ais_certificate_key'] = ais_pg_certificate_key('sync-landing-42', $sample_hash, $language);
        $sample_mime[$id] = 'image/jpeg';
        $pages[] = array('id'=>$id, 'language'=>$language);
    }
    foreach (ais_pg_certificate_slots($sample_type) as $slot => $language) $fields[42][$slot] = 100;
    $fields[42]['slajder'] = array(array('izobrazhenie_slajda'=>100));
    $sample_data = array('model'=>array_merge($model,array('type'=>$sample_type,'updateSamples'=>true,'certificateHash'=>$sample_hash)),
        'landingId'=>42,'productId'=>13,'version'=>ais_pg_sync_landing(42)['version']);
    $count_before=$writes; $before_samples=$fields[42];
    ais_pg_sync_existing($sample_data,true);
    check($writes===$count_before,'Sample preflight does not change media or page');
    rejects(function()use($sample_data){ais_pg_sync_existing($sample_data);},'Не загружены');
    check($writes===$count_before,'Apply without pages must fail before writes');
    $sample_data['certificatePages']=$pages;
    $bad=$sample_data;$bad['certificatePages'][0]['id']=90;
    rejects(function()use($bad){ais_pg_sync_existing($bad);},'актуальные');
    $bad=$sample_data;$bad['model']['certificateHash']=str_repeat('f',64);
    rejects(function()use($bad){ais_pg_sync_existing($bad);},'актуальные');
    $bad=$sample_data;$bad['certificatePages']=array_reverse($pages);
    rejects(function()use($bad){ais_pg_sync_existing($bad);},'порядок');
    check($writes===$count_before,'Unowned/stale/wrong-order pages never replace samples');
    ais_pg_sync_existing($sample_data);
    check($fields[42]['izobrazhenie_vydavaemogo_dokumenta']===300 && $fields[42]['prevyu_vydavaemogo_dokumenta_1']===300,'Main image and preview updated');
    check($fields[42]['izobrazhenie_vydavaemogo_dokumenta_2']===301 && $fields[42]['prevyu_vydavaemogo_dokumenta_2']===301,'Second image and preview updated');
    check(count($fields[42]['slajder'])===count($pages),'Every appendix page is in gallery');
    check($fields[42]['blok_opisaniya_kursa']===$before_samples['blok_opisaniya_kursa'],'Reviews preserved during sample update');
    check($fields[42]['blok_ceny'][0]===$before_samples['blok_ceny'][0],'Other offer price preserved during sample update');
    check($posts[42]['post_status']==='publish' && get_post_thumbnail_id(42)===91,'Publication and featured image preserved');
    check(get_post_meta(42,'_ais_generator_key',true)==='','Legacy landing does not acquire creation ownership');
    check(get_post_meta(42,'_ais_certificate_hash',true)===$sample_hash && get_post_meta(42,'_ais_certificate_pages',true)===$pages,'Current sample metadata saved');
    $sample_data['version']=ais_pg_sync_landing(42)['version']; $count_before=$writes;
    unset($fields[42]['prevyu_vydavaemogo_dokumenta_1']);
    $sample_data['version']=ais_pg_sync_landing(42)['version'];
    rejects(function()use($sample_data){ais_pg_sync_existing($sample_data,true);},'отсутствует поле');
    check($writes===$count_before,'Missing ACF slot is rejected in read-only preflight');
}
$role='shop';
rejects(function()use($sample_data){ais_pg_sync_certificate_assets($sample_data);},'только');
$sample_meta[42]['_ais_generator_key']=str_repeat('a',64);
check(ais_pg_sync_certificate_owner(42)===str_repeat('a',64),'Generated pages retain their sample ownership for later publication checks');
echo "PASS: optional sample refresh for all types, legacy/published landing, all gallery pages, asset ownership/order/hash, missing slots and preserved unrelated data\n";
