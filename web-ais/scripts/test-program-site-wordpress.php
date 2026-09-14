<?php
// Isolated WordPress contract test: no network, WordPress DB or real products.
$test_dir = sys_get_temp_dir() . '/ais-program-tests-' . bin2hex(random_bytes(8));
mkdir($test_dir);
mkdir($test_dir . '/wordpress');
mkdir($test_dir . '/wordpress/wp-admin');
mkdir($test_dir . '/wordpress/wp-admin/includes');
file_put_contents($test_dir . '/wordpress/wp-admin/includes/image.php', '<?php // isolated image metadata mock');
define('ABSPATH', $test_dir . '/wordpress/');
file_put_contents($test_dir . '/ais-program-site.key', str_repeat('a',64));
register_shutdown_function(function () use ($test_dir) {
    foreach (glob($test_dir . '/certificate-sample-*.jpg') as $file) unlink($file);
    unlink($test_dir . '/wordpress/wp-admin/includes/image.php');
    rmdir($test_dir . '/wordpress/wp-admin/includes');
    rmdir($test_dir . '/wordpress/wp-admin');
    unlink($test_dir . '/ais-program-site.key');
    rmdir($test_dir . '/wordpress');
    rmdir($test_dir);
});
$test_role = 'edu';
$test_posts = array();
$test_meta = array();
$test_options = array();
$test_actions = array();
$test_filters = array();
$test_updates = array();
$test_collision = null;
function add_action($name, $callback, $priority = 10, $args = 1) { $GLOBALS['test_actions'][$name] = array($callback, $priority, $args); }
function add_filter($name, $callback, $priority = 10, $args = 1) { $GLOBALS['test_filters'][$name] = array($callback, $priority, $args); }
function home_url($path = '') { return 'https://' . ($GLOBALS['test_role'] === 'edu' ? 'edu-plus.ru' : 'zifra-plus.ru') . $path; }
function wp_parse_url($url, $component = -1) { return parse_url($url, $component); }
function esc_url_raw($url, $schemes = array()) { return $url; }
function current_user_can($capability) { return false; }
function add_option($key, $value, $unused = '', $autoload = false) {
    if (array_key_exists($key, $GLOBALS['test_options'])) return false;
    $GLOBALS['test_options'][$key] = $value; return true;
}
function get_posts($args) {
    $ids = array();
    foreach ($GLOBALS['test_posts'] as $id=>$post) {
        if (!in_array($post['type'], (array) $args['post_type'], true)) continue;
        $value = $args['meta_key'] === '_ais_certificate_key' ? get_post_meta($id, '_ais_certificate_key') : ($post['key'] ?? '');
        if ($value === $args['meta_value']) $ids[] = $id;
    }
    return $ids;
}
function get_post($id) { $p=$GLOBALS['test_posts'][$id] ?? null; return $p ? (object) array_merge($p,array('ID'=>$id,'post_type'=>$p['type'],'post_status'=>$p['status'])) : null; }
function get_field_objects($id, $format = false) { return $GLOBALS['test_definitions'][$id] ?? array(); }
function update_field($key, $value, $id) {
    foreach ($GLOBALS['test_definitions'] as $definitions) foreach ($definitions as $field) {
        if ($field['key'] === $key) { update_post_meta($id, $field['name'], ais_pg_acf_value($field, $value)); return true; }
    }
    throw new RuntimeException('Unknown field');
}
function wp_insert_post($data, $errors) {
    $id=$data['ID'] ?? max(array_keys($GLOBALS['test_posts']))+1;
    $GLOBALS['test_posts'][$id]=array_merge($data,array('key'=>$data['meta_input']['_ais_generator_key'],'type'=>$data['post_type'],'status'=>$data['post_status']));
    foreach ($data['meta_input'] as $key=>$value) update_post_meta($id,$key,$value);
    return $id;
}
function wp_slash($data) { return $data; }
function sanitize_text_field($value) { return strip_tags($value); }
function wp_kses_post($value) { return $value; }
if (!function_exists('mb_strlen')) { function mb_strlen($value) { return preg_match_all('/./us', $value); } }
function get_post_thumbnail_id($id) { return 0; }
function get_object_taxonomies($type, $output) { return array(); }
class WC_Product_Download { function __construct() { throw new RuntimeException('Course must not create a Jazz download'); } }
class WC_Product_Simple {
    public $values=array(); public $meta=array();
    function is_type($type) { return $type==='simple'; }
    function __call($name,$args) { $this->values[substr($name,4)]=$args[0]; }
    function update_meta_data($key,$value) { $this->meta[$key]=$value; }
    function save() {
        $id=max(array_keys($GLOBALS['test_posts']))+1;
        $GLOBALS['test_posts'][$id]=array('type'=>'product','status'=>$this->values['status'],'key'=>$this->meta['_ais_generator_key']);
        $GLOBALS['test_meta'][$id]=$this->meta;
        $GLOBALS['test_product']=$this;
        return $id;
    }
}
function wp_upload_bits($name, $unused, $bytes) {
    $file = $GLOBALS['test_dir'] . '/' . $name; file_put_contents($file, $bytes);
    return array('file'=>$file, 'url'=>'https://edu-plus.ru/wp-content/uploads/' . $name, 'error'=>false);
}
function wp_insert_attachment($data, $file, $parent, $errors) {
    $id = max(array_keys($GLOBALS['test_posts']) ?: array(0)) + 1;
    $GLOBALS['test_posts'][$id] = array('type'=>'attachment','status'=>'inherit','file'=>$file,'mime'=>$data['post_mime_type']);
    $GLOBALS['test_meta'][$id] = $data['meta_input']; return $id;
}
function wp_get_attachment_metadata($id) { return get_post_meta($id, 'metadata'); }
function wp_update_attachment_metadata($id, $data) { update_post_meta($id, 'metadata', $data); }
function wp_generate_attachment_metadata($id, $file) { return array('file'=>$file); }
function wp_get_attachment_url($id) { return 'https://edu-plus.ru/wp-content/uploads/' . basename(get_attached_file($id)); }
function get_post_status($id) { return $GLOBALS['test_posts'][$id]['status'] ?? ''; }
function get_post_type($id) { return $GLOBALS['test_posts'][$id]['type'] ?? ''; }
function get_post_field($key, $id) { return $GLOBALS['test_posts'][$id][$key] ?? ''; }
function get_post_meta($id, $key, $single = true) { return $GLOBALS['test_meta'][$id][$key] ?? ''; }
function get_post_mime_type($id) { return $GLOBALS['test_posts'][$id]['mime'] ?? ''; }
function get_attached_file($id) { return $GLOBALS['test_posts'][$id]['file'] ?? ''; }
function get_field($name, $id, $format = true) { return $GLOBALS['test_meta'][$id][$name] ?? ''; }
function update_post_meta($id, $key, $value) { $GLOBALS['test_meta'][$id][$key] = $value; }
function get_page_by_path($slug, $output, $type) { return $GLOBALS['test_collision']; }
function get_permalink($id) { return home_url('/other_course/test/'); }
function admin_url($path) { return home_url('/wp-admin/' . $path); }
function add_query_arg($params, $url) { return $url . '?' . http_build_query($params); }
function wp_update_post($data, $return_error = false) { $GLOBALS['test_updates'][] = $data; $GLOBALS['test_posts'][$data['ID']]['status'] = $data['post_status']; return $data['ID']; }
function is_wp_error($value) { return $value instanceof WP_Error; }
class WP_Error { public $code; public $message; public $data; function __construct($code, $message, $data) { $this->code=$code; $this->message=$message; $this->data=$data; } }
class MockWpDb {
    public $prefix = 'fixture_'; public $options = 'fixture_options'; public $locked = false; public $deny = false;
    function prepare($sql, ...$args) { return $sql; }
    function esc_like($value) { return addcslashes($value, '_%'); }
    function query($value) { return 0; }
    function get_var($sql) {
        if (strpos($sql, 'GET_LOCK') !== false) { $this->locked = !$this->deny; return $this->deny ? 0 : 1; }
        if (strpos($sql, 'RELEASE_LOCK') !== false) { $this->locked = false; return 1; }
        throw new RuntimeException('Unexpected SQL');
    }
}
$wpdb = new MockWpDb();
define('OBJECT', 'OBJECT');
require __DIR__ . '/../services/wordpress/ais-program-generator.php';
function check($condition, $message) { if (!$condition) throw new RuntimeException('FAIL: ' . $message); }
function rejects($callback, $message) { try { $callback(); } catch (RuntimeException $error) { return; } throw new RuntimeException('FAIL: ' . $message); }
check(ais_pg_signature(str_repeat('a', 64), 'POST', '/wp-json/ais-program-sites/v1/publish', '1789380000', str_repeat('1', 32), '{}') === '6c60bfb88e6bee88888142416b262f30d1af1b313442898cc14b26f40e40ea0d', 'Node/PHP signature compatibility');
$request = new class {
    public $headers = array();
    function get_header($name) { return $this->headers[$name] ?? ''; }
    function get_route() { return '/ais-program-sites/v1/publish'; }
    function get_query_params() { return array(); }
    function get_method() { return 'POST'; }
    function get_body() { return '{}'; }
};
check(ais_pg_permission($request) instanceof WP_Error, 'Anonymous requests refused');
$request->headers = array('x-ais-timestamp'=>(string)time(),'x-ais-nonce'=>str_repeat('1',32),'x-ais-signature'=>'bad');
check(ais_pg_permission($request) instanceof WP_Error, 'Invalid proof refused');
$request->headers['x-ais-signature'] = ais_pg_signature(str_repeat('a',64), 'POST', '/wp-json/ais-program-sites/v1/publish', $request->headers['x-ais-timestamp'], str_repeat('1',32), '{}');
check(ais_pg_permission($request) === true, 'Valid scoped signature accepted');
check(ais_pg_permission($request) instanceof WP_Error, 'Replayed signature refused');
$request->headers['x-ais-timestamp'] = (string)(time()-301);
check(ais_pg_permission($request) instanceof WP_Error, 'Expired signature refused');
check(ais_pg_join_url('https://jazz.sber.ru/example?psw=test#join') === 'https://jazz.sber.ru/example?psw=test#join', 'Complete Jazz link retained');
foreach (array('http://jazz.sber.ru', 'javascript:alert(1)', 'https://localhost/', 'https://user:pass@jazz.sber.ru/', "https://jazz.sber.ru/\r\nLocation:evil") as $url) rejects(function () use ($url) { ais_pg_join_url($url); }, 'Reject unsafe join URL');
$field = array('name'=>'prices', 'key'=>'field_prices', 'type'=>'repeater', 'sub_fields'=>array(
    array('name'=>'price', 'key'=>'field_price', 'type'=>'text'),
    array('name'=>'nested', 'key'=>'field_nested', 'type'=>'group', 'sub_fields'=>array(array('name'=>'url', 'key'=>'field_url', 'type'=>'url')))
));
$raw = array(array('field_price'=>'390', 'field_nested'=>array('field_url'=>'https://zifra-plus.ru/checkout/?add-to-cart=99')));
$named = array(array('price'=>'390', 'nested'=>array('url'=>'https://zifra-plus.ru/checkout/?add-to-cart=99')));
check(ais_pg_acf_value($field, $raw) === $named, 'ACF repeater keys exported as names');
check(ais_pg_acf_value($field, $named, true) === $raw, 'ACF nested names imported as keys');
check(ais_pg_acf_value($field, $named) === $named, 'Name-based ACF values supported');
$identity = array('key'=>str_repeat('b',64), 'hash'=>str_repeat('c',64));
rejects(function () { ais_pg_identity(array('key'=>'../bad')); }, 'Invalid identity');
$wpdb->deny = true;
check(ais_pg_mutate('publish', $identity) instanceof WP_Error, 'Concurrent mutation refused');
$wpdb->deny = false;
rejects(function () use ($identity) { ais_pg_mutate('publish', $identity); }, 'Cannot publish unmanaged posts');
check(!$wpdb->locked && !$test_updates, 'Lock released after failure; no mutation');
$test_posts[123] = array('key'=>$identity['key'], 'status'=>'draft', 'type'=>'other-course', 'post_name'=>'test');
$test_meta[123]['_ais_generator_hash'] = str_repeat('d',64);
rejects(function () use ($identity) { ais_pg_mutate('publish', $identity); }, 'Stale hash refused');
check(!$test_updates, 'Stale publication did not alter WordPress');
$test_meta[123]['_ais_generator_hash'] = $identity['hash'];
rejects(function () use ($identity) { ais_pg_mutate('publish', $identity); }, 'Missing certificate assets block publication');
$test_meta[123]['_ais_certificate_hash'] = str_repeat('e',64);
foreach (array('ru'=>201, 'en'=>202) as $language=>$asset_id) {
    $test_posts[$asset_id] = array('status'=>'inherit', 'type'=>'attachment', 'mime'=>'image/jpeg', 'file'=>$test_dir . '/ais-program-site.key');
    $test_meta[$asset_id]['_ais_certificate_key'] = ais_pg_certificate_key($identity['key'], str_repeat('e',64), $language);
    foreach (ais_pg_certificate_slots() as $slot=>$slot_language) if ($slot_language === $language) $test_meta[123][$slot] = $asset_id;
}
$asset_data = $identity + array('certificateHash'=>str_repeat('e',64), 'fields'=>$test_meta[123]);
ais_pg_validate_certificates($asset_data);
rejects(function () use ($asset_data) { ais_pg_validate_certificates(array_replace($asset_data, array('certificateHash'=>str_repeat('f',64)))); }, 'Stale certificate files refused');
rejects(function () use ($asset_data) { ais_pg_validate_certificates(array_replace($asset_data, array('key'=>str_repeat('f',64)))); }, 'Another program certificate refused');
rejects(function () use ($identity) { ais_pg_certificate_assets($identity + array('images'=>array())); }, 'Both certificate languages required');
rejects(function () use ($identity) { ais_pg_certificate_assets($identity + array('certificateHash'=>str_repeat('e',64),'images'=>array(array('language'=>'ru','base64'=>base64_encode('<?php invalid ?>')),array('language'=>'en','base64'=>'')))); }, 'Non-image uploads refused');
$test_collision = (object) array('ID'=>321);
rejects(function () use ($identity) { ais_pg_mutate('publish', $identity); }, 'Slug collision refused');
check(!$test_updates, 'Existing landing not replaced');
$test_collision = null;
check(ais_pg_mutate('publish', $identity)['status'] === 'publish', 'Publishes own ready draft');
check(!$wpdb->locked, 'Lock released after success');
$test_posts[124] = $test_posts[123];
rejects(function () use ($identity) { ais_pg_find($identity['key']); }, 'Ambiguous duplicate identity blocked');
unset($test_posts[124]);
$test_role = 'shop';
$test_posts[123]['type'] = 'product';
$test_meta[123]['_ais_generator_key'] = $identity['key'];
$test_meta[123]['_ais_webinar_file'] = '/private/connection.html';
check(ais_pg_mutate('enable-redirect', $identity)['id'] === 123, 'Own published product redirect enabled');
$method = $test_filters['woocommerce_file_download_method'][0];
check($method('force', 123, '/private/connection.html') === 'ais_webinar', 'Only approved own download uses Jazz redirect');
check($method('force', 123, '/other/file.html') === 'force', 'Unrelated downloads unchanged');
check(!isset($test_filters['woocommerce_download_product_filepath']), 'No redirect before WooCommerce authorization');
check(isset($test_actions['woocommerce_download_file_ais_webinar']), 'Redirect uses authorized download handler');
foreach (array('ДОП','КПК','ППП') as $course_type) {
    $test_role='edu';
    $key=hash('sha256',$course_type); $hash=hash('sha256','version-'.$course_type); $certificate_hash=hash('sha256','sample-'.$course_type);
    $languages=$course_type==='ДОП' ? array('ru','en') : array('ru','page-2','page-3');
    $pages=array(); $fields=array();
    foreach ($languages as $index=>$language) {
        $id=500+$index;
        $test_posts[$id]=array('type'=>'attachment','status'=>'inherit','mime'=>'image/jpeg','file'=>$test_dir . '/ais-program-site.key');
        $test_meta[$id]['_ais_certificate_key']=ais_pg_certificate_key($key,$certificate_hash,$language);
        $pages[]=array('id'=>$id,'language'=>$language);
        foreach(ais_pg_certificate_slots($course_type) as $slot=>$slot_language) if($language===$slot_language) $fields[$slot]=$id;
    }
    $fields['slajder']=array_map(function($page){return array('izobrazhenie_slajda'=>$page['id']);},$pages);
    $review=array(array('zagolovok_opisaniya'=>'Отзыв','soderzhimoe_bloka'=>'Прототип <img src="/original.jpg"> — цитата без замены'));
    $fields['blok_opisaniya_kursa']=array(array('soderzhimoe_bloka'=>'Client must not replace review'));
    $test_posts[900]=array('type'=>ais_pg_post_type($course_type),'status'=>'publish','key'=>'','post_modified_gmt'=>'version','post_title'=>'Прототип','post_content'=>'','post_excerpt'=>'');
    $definitions=array();
    foreach($fields as $name=>$value) $definitions[]=array('key'=>'field_'.$name,'name'=>$name,'type'=>'text','value'=>$name==='blok_opisaniya_kursa' ? $review : $value);
    $test_definitions[900]=$definitions;
    $landing_data=array('key'=>$key,'hash'=>$hash,'type'=>$course_type,'title'=>'Новая программа','slug'=>'new-'.strtolower(bin2hex($course_type)),
        'templateId'=>900,'templateModified'=>'version','fields'=>$fields,'certificatePages'=>$pages,'certificateHash'=>$certificate_hash);
    $landing=ais_pg_mutate('prepare-landing',$landing_data);
    check($test_posts[$landing['id']]['type']===ais_pg_post_type($course_type),'Correct target landing section');
    check(get_field('blok_opisaniya_kursa',$landing['id'])===$review,'Authoritative review quotes and images copied');
    check(ais_pg_mutate('prepare-landing',$landing_data)['id']===$landing['id'],'Landing retry is idempotent');
    check(ais_pg_mutate('validate-publication',$landing_data)['ok']===true,'All sample pages ready');
    if($course_type!=='ДОП') {
        $valid=$test_meta[$landing['id']]['slajder'];
        $test_meta[$landing['id']]['slajder']=array_slice($valid,0,2);
        rejects(function()use($landing_data){ais_pg_mutate('validate-publication',$landing_data);},'Missing appendix page blocks publication');
        $test_meta[$landing['id']]['slajder']=$valid;
    }
    check(ais_pg_mutate('publish',$landing_data)['status']==='publish','Course landing published after checks');
    $test_role='shop';
    $product=ais_pg_mutate('prepare-product',array('key'=>$key,'hash'=>$hash,'type'=>$course_type,'slug'=>$landing_data['slug'],'productName'=>'Курс','price'=>100,'joinUrl'=>'not-a-url'));
    check($test_product->values['downloadable']===false && $test_product->values['downloads']===array(),'No Jazz download for course');
    check(get_post_meta($product['id'],'_ais_webinar_file')==='' && get_post_meta($product['id'],'_ais_webinar_join_url')==='','No Jazz metadata for course');
    check(get_post_meta($product['id'],'_ais_landing_url')===ais_pg_landing_url($course_type,$landing_data['slug']),'Correct course redirect URL');
    check(!is_dir($test_dir . '/ais-webinar-files'),'No connection file created');
}
// Optional real JPEG fixture exercises upload/retry without a WordPress DB or network.
if (isset($argv[1]) && is_file($argv[1])) {
    $test_role = 'edu';
    $payload = array('key'=>str_repeat('1',64),'hash'=>str_repeat('2',64),'certificateHash'=>str_repeat('3',64),
        'images'=>array(array('language'=>'ru','base64'=>base64_encode(file_get_contents($argv[1]))),array('language'=>'en','base64'=>base64_encode(file_get_contents($argv[1])))));
    $assets = ais_pg_mutate('certificate-assets', $payload);
    check(count($assets['images']) === 2, 'Two real JPEG assets created');
    $repeated = ais_pg_mutate('certificate-assets', $payload);
    check($repeated === $assets, 'Retries reuse existing attachment IDs and URLs');
    check(count(glob($test_dir . '/certificate-sample-*.jpg')) === 2, 'Retry did not duplicate files');
    check(!$wpdb->locked, 'Certificate lock released');
    $course_payload=$payload;
    $course_payload['type']='КПК';
    $course_payload['certificateHash']=str_repeat('4',64);
    $course_payload['images']=array_map(function($language)use($payload){return array('language'=>$language,'base64'=>$payload['images'][0]['base64']);},array('ru','page-2','page-3'));
    $course_assets=ais_pg_mutate('certificate-assets',$course_payload);
    check(count($course_assets['images'])===3,'All real appendix pages uploaded');
    check(ais_pg_mutate('certificate-assets',$course_payload)===$course_assets,'Appendix retry reuses all assets');
    check(count(glob($test_dir . '/certificate-sample-*.jpg'))===5,'No duplicate appendix files');
    echo "PASS: real JPEG upload, attachment metadata, idempotent retry, no duplicate files\n";
}
echo "PASS: WordPress signature, URL validation, nested ACF schema, locks, managed identity, stale versions, slug collision and authorized download hooks\n";
