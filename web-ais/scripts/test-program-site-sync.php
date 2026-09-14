<?php
// Isolated in-memory contract test. No WordPress, database, network, or site writes.
define('ABSPATH', __DIR__ . '/isolated-not-a-wordpress/');
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
function get_post_meta($id,$key,$single=true) { return ''; }
function get_permalink($id) { return home_url('/item/' . $id . '/'); }
function admin_url($path) { return home_url('/wp-admin/' . $path); }
function add_query_arg($params,$url) { return $url . '?' . http_build_query($params); }
function is_wp_error($value) { return false; }
function get_posts($args) { return array_keys(array_filter($GLOBALS['posts'],function($post)use($args){return $post['post_name']===$args['name'] && in_array($post['post_type'],$args['post_type'],true);})); }
function get_field_objects($id,$format=false) {
    $result=array();
    foreach($GLOBALS['fields'][$id] ?? array() as $name=>$value) {
        $field=array('key'=>'field_'.$name,'name'=>$name,'value'=>$value,'type'=>'text');
        if($name==='blok_ceny') { $field['type']='repeater';$field['sub_fields']=array_map(function($key){return array('name'=>$key,'key'=>'field_'.$key,'type'=>'text');},array_keys($value[0])); }
        $result[]=$field;
    }
    return $result;
}
function update_field($key,$value,$id) {
    if(!empty($GLOBALS['drop_write'])) return false;
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
    function save() {$GLOBALS['products'][$this->id]=$this;$GLOBALS['writes']++;return $this->id;}
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
check(count($snapshot['offers'])===2,'All offers resolved, including encoded query');
check(ais_pg_resolve_site(array('slug'=>'pk-test'))['id']===42,'Exact slug lookup');
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
