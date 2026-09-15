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
    $private_dirs = array();
    foreach (array('txt', 'html') as $extension) foreach (glob($test_dir . '/ais-webinar-files/*/connection.' . $extension) as $file) {
        $private_dirs[] = dirname($file); unlink($file);
    }
    foreach (array_unique($private_dirs) as $dir) rmdir($dir);
    foreach (glob($test_dir . '/ais-webinar-files/public-locks/*.lock') as $file) unlink($file);
    if (is_dir($test_dir . '/ais-webinar-files/public-locks')) rmdir($test_dir . '/ais-webinar-files/public-locks');
    foreach (glob($test_dir . '/wordpress/wp-content/uploads/dae-uploads/webinars/*.html') as $file) unlink($file);
    foreach (array('wp-content/uploads/dae-uploads/webinars', 'wp-content/uploads/dae-uploads', 'wp-content/uploads', 'wp-content') as $suffix) {
        $dir = $test_dir . '/wordpress/' . $suffix;
        if (is_dir($dir)) rmdir($dir);
    }
    if (is_dir($test_dir . '/ais-webinar-files')) rmdir($test_dir . '/ais-webinar-files');
    foreach (glob($test_dir . '/certificate-sample-*.jpg') as $file) unlink($file);
    foreach (glob($test_dir . '/landing-*') as $file) unlink($file);
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
        $value = $args['meta_key'] === '_ais_generator_key' ? ($post['key'] ?? '') : get_post_meta($id, $args['meta_key']);
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
function wp_json_encode($data) { return json_encode($data, JSON_UNESCAPED_UNICODE); }
function sanitize_text_field($value) { return strip_tags($value); }
function wp_kses_post($value) { return $value; }
if (!function_exists('mb_strlen')) { function mb_strlen($value) { return preg_match_all('/./us', $value); } }
function get_post_thumbnail_id($id) { return (int) get_post_meta($id, '_thumbnail_id'); }
function set_post_thumbnail($id, $image) { update_post_meta($id, '_thumbnail_id', $image); }
function wp_get_attachment_image_url($id, $size) { return $id ? wp_get_attachment_url($id) : false; }
function wp_safe_remote_get($url, $args) {
    check($args['redirection'] === 0 && $args['limit_response_size'] === 5242881, 'Bounded media transfer, no redirects');
    $GLOBALS['test_image_fetches'] = ($GLOBALS['test_image_fetches'] ?? 0) + 1;
    return array('code' => $GLOBALS['test_image_code'] ?? 200, 'body' => $GLOBALS['test_image_body'] ?? base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0cAAAAASUVORK5CYII='));
}
function wp_remote_retrieve_response_code($response) { return $response['code']; }
function wp_remote_retrieve_body($response) { return $response['body']; }
class WF301_functions {
    static $rules = array();
    static function get_redirects($active = false) { return array_map(function ($rule) { return (object) $rule; }, array_values(self::$rules)); }
    static function save_redirect_rule($rule) {
        $id = $rule['redirect_id'] ?? count(self::$rules) + 1;
        unset($rule['redirect_id']);
        self::$rules[$id] = array_merge(self::$rules[$id] ?? array(), $rule, array('id'=>$id));
        return $id;
    }
    static function get_redirect($id) { return self::$rules[$id] ?? array(); }
}
function get_object_taxonomies($type, $output) { return array(); }
function wp_mkdir_p($path) { return is_dir($path) || mkdir($path, 0700, true); }
function wp_upload_dir() { return array('baseurl'=>'https://zifra-plus.ru/wp-content/uploads', 'basedir'=>ABSPATH . 'wp-content/uploads', 'error'=>false); }
class WC_Product_Download {
    public $file; public $id; public $name;
    function set_file($file) { $this->file = $file; }
    function set_id($id) { $this->id = $id; }
    function set_name($name) { $this->name = $name; }
    function get_file() { return $this->file; }
    function get_id() { return $this->id; }
    function get_name() { return $this->name; }
    function is_allowed_filetype() {
        $types = $GLOBALS['test_filters']['woocommerce_downloadable_file_allowed_mime_types'][0](array('txt'=>'text/plain'));
        return isset($types[pathinfo($this->file, PATHINFO_EXTENSION)]);
    }
    function check_is_valid($auto_add = true) {
        $local = str_replace('https://zifra-plus.ru/wp-content/uploads', ABSPATH . 'wp-content/uploads', $this->file);
        if ($auto_add || !$this->is_allowed_filetype() || !is_file($local) || ($GLOBALS['test_approved_dir'] ?? '') !== dirname($this->file) . '/') throw new Exception('Download rejected: secret URL/path must not leak');
    }
}
class TestApprovedDirectories {
    function add_approved_directory($dir, $enabled) { check($enabled, 'Download directory enabled'); $GLOBALS['test_approved_dir'] = $dir; }
}
class_alias('TestApprovedDirectories', 'Automattic\\WooCommerce\\Internal\\ProductDownloads\\ApprovedDirectories\\Register');
function wc_get_container() { return new class { function get($class) { return new $class(); } }; }
function wc_get_logger() { return new class { function error($message, $context) { $GLOBALS['test_log'][] = array($message, $context); } }; }
class WC_Product_Simple {
    public $id=0;
    public $save_count=0;
    public $values=array(); public $meta=array();
    function is_type($type) { return $type==='simple'; }
    function __call($name,$args) { if (strpos($name,'get_')===0) return $this->values[substr($name,4)] ?? null; $this->values[substr($name,4)]=$args[0]; }
    function update_meta_data($key,$value) { $this->meta[$key]=$value; }
    function save() {
        $this->save_count++;
        $id=$this->id ?: max(array_keys($GLOBALS['test_posts']))+1;
        $this->id=$id;
        $GLOBALS['test_posts'][$id]=array('type'=>'product','status'=>$this->values['status'],'key'=>$this->meta['_ais_generator_key'],'post_name'=>$this->values['slug'],'post_title'=>$this->values['name']);
        $GLOBALS['test_meta'][$id]=$this->meta;
        $GLOBALS['test_product']=$this;
        $GLOBALS['test_products'][$id]=$this;
        return $id;
    }
}
function wc_get_product($id) { return $GLOBALS['test_products'][$id] ?? null; }
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
function get_page_by_path($slug, $output, $type) { return $GLOBALS['test_code_collisions'][$slug] ?? $GLOBALS['test_collision']; }
function get_permalink($id) { return home_url('/other_course/test/'); }
function admin_url($path) { return home_url('/wp-admin/' . $path); }
function add_query_arg($params, $url) { return $url . '?' . http_build_query($params); }
function wp_update_post($data, $return_error = false) {
    $GLOBALS['test_updates'][] = $data;
    $GLOBALS['test_posts'][$data['ID']] = array_merge($GLOBALS['test_posts'][$data['ID']], $data);
    if (isset($data['post_status'])) $GLOBALS['test_posts'][$data['ID']]['status'] = $data['post_status'];
    return $data['ID'];
}
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
function check_purchase_limit($data, $id) {
    $product = wc_get_product($id);
    check($product->get_sold_individually('edit') === true, $data['type'] . ': new product is limited to one per order');
    $before = serialize(array($product->values, $product->meta));
    $post_count = count($GLOBALS['test_posts']);
    $product->set_sold_individually(false);
    $product->save();
    $saved = $product->save_count;
    check(ais_pg_mutate('prepare-product', $data)['id'] === $id, $data['type'] . ': retry keeps product ID');
    check($product->get_sold_individually('edit') === true && $product->save_count === $saved + 1, $data['type'] . ': retry persists purchase limit on a legacy draft');
    check(serialize(array($product->values, $product->meta)) === $before, $data['type'] . ': name, price, status and downloads remain unchanged');
    $saved = $product->save_count;
    ais_pg_mutate('prepare-product', $data);
    check($product->save_count === $saved && count($GLOBALS['test_posts']) === $post_count, $data['type'] . ': repeated preparation does not save or duplicate an already limited product');
}
function category_prototype_fixture() {
    $source = new WC_Product_Simple();
    $source->set_name('Товар-прототип'); $source->set_slug('category-prototype'); $source->set_status('publish');
    $source->set_category_ids(array(17, 29)); $source->update_meta_data('_ais_generator_key', '');
    return $source->save();
}
function check_copied_categories($data, $id) {
    $source = wc_get_product($data['productTemplateId']);
    $source_before = serialize($source);
    $product = wc_get_product($id);
    check($product->get_category_ids('edit') === array(17, 29), $data['type'] . ': all shop categories copied from prototype');
    check(get_post_meta($id, '_ais_generator_product_template') === $source->id, $data['type'] . ': shop prototype recorded independently of landing/image ID');
    $product->set_category_ids(array(1)); $product->save();
    ais_pg_mutate('prepare-product', $data);
    check($product->get_category_ids('edit') === array(17, 29), $data['type'] . ': retry repairs categories, without retaining the default category');
    check(serialize($source) === $source_before, $data['type'] . ': prototype itself is never saved or changed');
}
$code_request = array('key'=>str_repeat('9',64), 'postType'=>'courses-pk', 'slug'=>'osnovy-gramotnosti');
$before_code = serialize(array($test_posts, $test_meta, $test_updates));
check(ais_pg_landing_code($code_request)['slug'] === $code_request['slug'], 'Free code retained');
check(ais_pg_landing_code(array_replace($code_request, array('slug'=>'manual_code-_')))['slug'] === 'manual_code-_', 'Valid manual code retained exactly');
$test_code_collisions = array($code_request['slug'] => (object) array('ID'=>100));
$free_code = ais_pg_landing_code($code_request)['slug'];
check($free_code === 'osnovy-gramotnosti-99999999', 'Collision gets a stable program suffix');
check(ais_pg_landing_code($code_request)['slug'] === $free_code, 'Repeated suggestion stays stable');
$test_code_collisions[$free_code] = (object) array('ID'=>101);
check(ais_pg_landing_code($code_request)['slug'] === $free_code . '-2', 'Repeated collisions are resolved');
$long_code_request = array_replace($code_request, array('slug'=>str_repeat('a',80)));
$test_code_collisions[$long_code_request['slug']] = (object) array('ID'=>102);
check(strlen(ais_pg_landing_code($long_code_request)['slug']) === 80, 'Suffix fits the 80-character limit');
check(serialize(array($test_posts, $test_meta, $test_updates)) === $before_code, 'Suggestion does not write any site content');
$test_posts[999] = array('key'=>$code_request['key'], 'type'=>'courses-pk', 'status'=>'draft', 'post_name'=>'saved-draft');
check(ais_pg_landing_code($code_request)['slug'] === 'saved-draft', 'Own draft address recovered after interrupted preparation');
check(ais_pg_landing_code(array_replace($code_request, array('exact'=>true,'slug'=>'web_nazv')))['slug'] === 'web_nazv', 'Explicit promo slug overrides own draft address');
$test_code_collisions['web_nazv'] = (object) array('ID'=>100);
rejects(function () use ($code_request) { ais_pg_landing_code(array_replace($code_request, array('exact'=>true,'slug'=>'web_nazv'))); }, 'Explicit occupied address never gets a suffix or overwrites another page');
unset($test_code_collisions['web_nazv']);
$test_posts[999]['status'] = 'publish';
rejects(function () use ($code_request) { ais_pg_landing_code(array_replace($code_request, array('exact'=>true,'slug'=>'web_nazv'))); }, 'Published own page cannot silently change address');
check(ais_pg_landing_code($code_request)['slug'] === 'saved-draft', 'Published address never renamed');
rejects(function () use ($code_request) { ais_pg_landing_code(array_replace($code_request, array('postType'=>'courses-pp'))); }, 'Cannot change the existing landing type');
$test_posts[999]['status'] = 'trash';
rejects(function () use ($code_request) { ais_pg_landing_code($code_request); }, 'Trashed draft not silently replaced');
unset($test_posts[999]);
foreach (array(array('key'=>'bad'), array('slug'=>'../bad'), array('postType'=>'product')) as $invalid) rejects(function () use ($code_request, $invalid) { ais_pg_landing_code(array_replace($code_request, $invalid)); }, 'Invalid suggestion refused');
$test_role = 'shop';
rejects(function () use ($code_request) { ais_pg_landing_code($code_request); }, 'Suggestion available only on education site');
$test_role = 'edu';
$test_code_collisions = array();
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
$test_meta[123]['_ais_webinar_join_url'] = 'https://salutejazz.ru/calls/fixture?psw=example';
$test_meta[123]['_ais_landing_url'] = 'https://edu-plus.ru/other_course/test/';
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
    $product_data=array('key'=>$key,'hash'=>$hash,'type'=>$course_type,'slug'=>$landing_data['slug'],'productName'=>'Курс','price'=>100,'joinUrl'=>'not-a-url','productTemplateId'=>category_prototype_fixture());
    $product=ais_pg_mutate('prepare-product',$product_data);
    check_purchase_limit($product_data, $product['id']);
    check_copied_categories($product_data, $product['id']);
    check($test_product->values['downloadable']===true && count($test_product->values['downloads'])===1,'Every course has an education info download');
    check(ais_pg_download_target($product['id'])==='https://zifra-plus.ru/edu_info','Non-webinar download goes to education info');
    check(get_post_meta($product['id'],'_ais_webinar_file')==='' && get_post_meta($product['id'],'_ais_webinar_join_url')==='','No Jazz metadata for course');
    check(get_post_meta($product['id'],'_ais_landing_url')===ais_pg_landing_url($course_type,$landing_data['slug']),'Correct course redirect URL');
    check(strpos(file_get_contents(get_post_meta($product['id'],'_ais_download_file')), 'https://zifra-plus.ru/edu_info') !== false,'Private info file created without Jazz URL');
}
// Public webinar HTML is accepted by WooCommerce and remains idempotent.
$test_role = 'shop';
$webinar_data = array('key'=>str_repeat('7',64), 'hash'=>str_repeat('8',64), 'type'=>'ПРО', 'slug'=>'new-webinar-txt',
    'productName'=>'Онлайн-семинар', 'price'=>500, 'joinUrl'=>'https://jazz.sber.ru/meeting?psw=private-test#join','productTemplateId'=>category_prototype_fixture());
check(ais_pg_download_formats() === array('html'=>true, 'txt'=>true), 'WooCommerce accepts generated HTML and existing TXT');
$webinar_result = ais_pg_mutate('prepare-product', $webinar_data);
check_purchase_limit($webinar_data, $webinar_result['id']);
check_copied_categories($webinar_data, $webinar_result['id']);
$category_before = serialize(array($test_posts, $test_meta, $test_products));
foreach (array(0, -1, 1.5, true, array(), '001', 'missing', 999999) as $bad_id) rejects(function () use ($webinar_data, $bad_id) {
    ais_pg_mutate('prepare-product', array_replace($webinar_data, array('productTemplateId'=>$bad_id)));
}, 'Invalid or missing category prototype rejected before writes');
check(serialize(array($test_posts, $test_meta, $test_products)) === $category_before, 'Failed category lookup leaves all products intact');
$source = wc_get_product($webinar_data['productTemplateId']);
$source->set_category_ids(array());
check(ais_pg_product_prototype_categories($webinar_data) === array(), 'Empty prototype categories do not invent another category');
$source->set_status('trash');
rejects(function () use ($webinar_data) { ais_pg_product_prototype_categories($webinar_data); }, 'Trashed prototype refused');
$source->set_status('publish'); $source->set_category_ids(array(17, 29));
check(ais_pg_product_prototype_categories(array()) === null, 'Old clients do not clear existing categories');
echo "PASS: purchase limit and shop prototype categories for ПРО, ДОП, КПК and ППП, legacy draft repair, idempotent retries and source protection\n";
$connection = get_post_meta($webinar_result['id'], '_ais_webinar_file');
$connection_path = ABSPATH . 'wp-content/uploads/dae-uploads/webinars/new-webinar-txt.html';
check($connection === 'https://zifra-plus.ru/wp-content/uploads/dae-uploads/webinars/new-webinar-txt.html', 'Public HTML URL uses exact landing code');
check(strpos(file_get_contents($connection_path), $webinar_data['joinUrl']) !== false, 'Complete meeting URL retained');
check($test_product->values['downloads'][0]->get_file() === $connection, 'Product downloadable files contains the public HTML URL');
check($test_product->values['downloadable'] === true && count($test_product->values['downloads']) === 1, 'Webinar has one authorized download');
check(ais_pg_mutate('prepare-product', $webinar_data)['id'] === $webinar_result['id'], 'Retry does not duplicate the product');
$download_hook = $test_filters['woocommerce_file_download_method'][0];
check($download_hook('force', $webinar_result['id'], $connection) === 'force', 'Public HTML uses standard WooCommerce delivery');
check($download_hook('force', $webinar_result['id'], '/another-file.txt') === 'force', 'No download authorization bypass for other files');
ais_pg_log_failure(new Exception('private-test password full/path'), 'test-error');
check(strpos(json_encode($test_log), 'private-test') === false, 'Diagnostic log excludes secret error messages');
// The provided example's meta refresh plus a fallback link, with safe escaping.
$full_join = 'https://salutejazz.ru/calls/example?psw=AbCd_123&name=%D0%90#join';
$html_url = ais_pg_public_webinar_file($webinar_data['key'], 'web_nazv', '<script>alert(1)</script> & семинар', $full_join);
$html_path = ABSPATH . 'wp-content/uploads/dae-uploads/webinars/web_nazv.html';
$html = file_get_contents($html_path);
check($html_url === 'https://zifra-plus.ru/wp-content/uploads/dae-uploads/webinars/web_nazv.html', 'Underscore in code is preserved');
check(preg_match('/<meta http-equiv="refresh" content="0;URL=([^"]+)">/', $html, $refresh) === 1, 'Immediate redirect matches the supplied example');
check(html_entity_decode($refresh[1], ENT_QUOTES, 'UTF-8') === $full_join, 'Query/password case and fragment survive HTML escaping');
check(strpos($html, '<script>') === false && strpos($html, '&lt;script&gt;') !== false && strpos($html, '<a rel="noreferrer"') !== false, 'Escaped title and clickable fallback');
check(!isset($test_filters['upload_mimes']), 'No global media upload permissions changed');
$test_role = 'edu'; check(ais_pg_download_formats()['html'] === false, 'HTML download MIME is limited to the shop'); $test_role = 'shop';
foreach (array('../bad', 'a', 'bad.html', 'Uppercase', 'bad/name') as $slug) rejects(function () use ($webinar_data, $slug, $full_join) {
    ais_pg_public_webinar_file($webinar_data['key'], $slug, 'Test', $full_join);
}, 'Invalid/path-traversal slug rejected');
rejects(function () use ($webinar_data) { ais_pg_public_webinar_file($webinar_data['key'], 'web_nazv', 'Test', 'javascript:alert(1)'); }, 'Unsafe redirect rejected');
rejects(function () use ($full_join) { ais_pg_public_webinar_file(str_repeat('9',64), 'web_nazv', 'Other', $full_join); }, 'Another program cannot overwrite HTML');
check(file_get_contents($html_path) === $html, 'Collision leaves existing file intact');
$manual_path = dirname($html_path) . '/manual.html'; file_put_contents($manual_path, 'Manual file');
rejects(function () use ($webinar_data, $full_join) { ais_pg_public_webinar_file($webinar_data['key'], 'manual', 'Test', $full_join); }, 'Manual files not replaced');
check(file_get_contents($manual_path) === 'Manual file', 'Manual file unchanged');
ais_pg_public_webinar_file($webinar_data['key'], 'web_nazv', 'Updated', 'https://salutejazz.ru/calls/updated');
check(strpos(file_get_contents($html_path), 'https://salutejazz.ru/calls/updated') !== false && strpos(file_get_contents($html_path), $full_join) === false, 'Same program updates its connection file');
// Upgrade a ready legacy product without replacing extra downloads/permissions.
$legacy_product = wc_get_product($webinar_result['id']);
$legacy = clone $legacy_product->values['downloads'][0]; $legacy->set_file('/private/connection.txt');
$extra = new WC_Product_Download(); $extra->set_id('extra'); $extra->set_file('/other/manual.pdf');
$legacy_product->values['downloads'] = array($legacy->get_id()=>$legacy, 'extra'=>$extra);
$test_meta[$webinar_result['id']]['_ais_download_file'] = '/private/connection.txt';
$test_meta[$webinar_result['id']]['_ais_webinar_file'] = '/private/connection.txt';
$upgraded = ais_pg_mutate('prepare-product', $webinar_data);
check($upgraded['id'] === $webinar_result['id'], 'Legacy upgrade keeps product ID');
check(count($legacy_product->values['downloads']) === 2 && $legacy_product->values['downloads']['extra'] === $extra, 'Extra downloads retained');
check($legacy_product->values['downloads'][$legacy->get_id()]->get_file() === $connection, 'Legacy download ID retained for existing permissions');
echo "PASS: public HTML webinar files, safe redirect/escaping, collision protection, legacy migration, MIME/path checks, own-product retry\n";
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
// Product presentation: all rules are visible in the existing manager, idempotent,
// disabled for drafts, and narrowly match exactly this product (not ID prefixes).
$test_role = 'shop';
$product_id = $webinar_result['id'];
$draft_rules = ais_pg_product_redirect_rules($product_id, false);
function matches_pro_rule($rule, $path) {
    // Mirror WF301_functions::format_from_url + wild_compare (installed PRO 6.28).
    $pattern = '/' . ltrim(stripslashes($rule['url_from']), '/');
    $expr = str_replace('.*', '*', $pattern);
    $expr = str_replace(array('*', '/'), array('.*', '\\/'), $expr);
    $expr = str_replace('\\/^', '^', $expr);
    return preg_match('/' . $expr . '$/', rtrim($path, '/')) === 1;
}
foreach ($draft_rules as $rule) {
    check($rule['status'] === 'disabled', 'Draft redirect is not public');
    check($rule['query_parameters'] === 'exactdrop' && $rule['case_insensitive'] === 'disabled', 'Never forward order credentials or lowercase Jazz password');
}
foreach (array('/?post_type=product&p='.$product_id, '/?p='.$product_id.'&post_type=product', '/?utm_source=test&p='.$product_id.'&post_type=product&x=1') as $path) check(matches_pro_rule($draft_rules[0], $path), 'Product query order supported: '.$path);
foreach (array('/?post_type=product&p='.$product_id.'0', '/?p='.$product_id.'&post_type=page', '/?post_type=product&p='.$product_id.'&preview=true', '/?add-to-cart=7&post_type=product&p='.$product_id, '/?post_type=product&p='.$product_id.'&download_file=7') as $path) check(!matches_pro_rule($draft_rules[0], $path), 'No neighboring product, preview, checkout or download redirect: '.$path);
check(matches_pro_rule($draft_rules[1], '/product/new-webinar-txt/'), 'Pretty product link supported');
check(matches_pro_rule($draft_rules[1], '/product/new-webinar-txt/?utm_source=test'), 'Pretty link with campaign supported');
check(!matches_pro_rule($draft_rules[1], '/product/new-webinar-txt-copy/'), 'Do not redirect another slug');
check(!matches_pro_rule($draft_rules[1], '/product/new-webinar-txt/?add-to-cart='.$product_id), 'Do not intercept add-to-cart');
check(matches_pro_rule($draft_rules[2], '/?download_file='.$product_id.'&order=private&email=test'), 'Download parameters supported');
check(matches_pro_rule($draft_rules[2], '/?order=private&download_file='.$product_id), 'Download ID can occur after other parameters');
check(!matches_pro_rule($draft_rules[2], '/?download_file='.$product_id.'0'), 'Download ID is not a prefix wildcard');
check($draft_rules[2]['url_to'] === $webinar_data['joinUrl'] && $draft_rules[2]['type'] === 302, 'Complete Jazz URL, temporary redirect');
$rule_count = count(WF301_functions::$rules);
$image_data = $webinar_data + array('imageUrl'=>'https://edu-plus.ru/wp-content/uploads/fixture.png');
$configured = ais_pg_mutate('configure-product', $image_data);
check($configured['imageId'] > 0 && get_post_thumbnail_id($product_id) === $configured['imageId'], 'Landing image attached to existing draft');
check(get_post_status($product_id) === 'draft', 'Repair must not publish a draft');
$repeated = ais_pg_mutate('configure-product', $image_data);
check($configured['imageId'] === $repeated['imageId'] && $test_image_fetches === 1, 'Image copy retry reuses media');
check(count(WF301_functions::$rules) === $rule_count, 'No duplicate manager rules on retry');
foreach (array('https://evil.example/image.png', 'https://edu-plus.ru.evil.example/wp-content/uploads/a.png', 'https://edu-plus.ru/wp-content/uploads/a.svg', 'https://user:pass@edu-plus.ru/wp-content/uploads/a.jpg') as $url) rejects(function () use ($url) { ais_pg_product_image($url); }, 'Only trusted raster media');
$test_image_body = '<?php not an image';
rejects(function () { ais_pg_product_image('https://edu-plus.ru/wp-content/uploads/invalid.jpg'); }, 'Image body checked before media upload');
unset($test_image_body);
$test_image_code = 302;
rejects(function () { ais_pg_product_image('https://edu-plus.ru/wp-content/uploads/redirect.jpg'); }, 'Remote redirects rejected');
unset($test_image_code);
$test_posts[$product_id]['status'] = 'publish';
ais_pg_mutate('enable-redirect', $webinar_data);
foreach (get_post_meta($product_id, '_ais_redirect_rule_ids') as $rule_id) check(WF301_functions::$rules[$rule_id]['status'] === 'enabled', 'Rules activated after publication');
$cart = $test_filters['woocommerce_cart_item_permalink'][0];
check($cart('/product/original/', array('product_id'=>$product_id)) === get_post_meta($product_id, '_ais_landing_url'), 'Cart title and thumbnail link directly to landing');
check($cart('/product/unrelated/', array('product_id'=>99999)) === '/product/unrelated/', 'Other cart products untouched');
$first_rule = $draft_rules[0];
$first_rule['tags'] = 'Manually created';
WF301_functions::save_redirect_rule($first_rule);
$before_conflict = serialize(WF301_functions::$rules);
rejects(function () use ($webinar_data) { ais_pg_mutate('configure-product', $webinar_data); }, 'Conflicting manual rules not overwritten');
check(serialize(WF301_functions::$rules) === $before_conflict, 'All rule conflicts checked before writes');
echo "PASS: product image copy and retries, PRO manager rules, ID boundaries, query privacy, cart links, draft lifecycle and manual-rule protection\n";
$schedule_data = array('type'=>'ПРО','date'=>'2027-09-18','time'=>'09:35');
foreach (json_decode(file_get_contents(__DIR__ . '/fixtures/program-site-schedule.json'), true) as $fixture) {
    check(ais_pg_webinar_schedule($fixture['source'], $schedule_data, $fixture['name']) === $fixture['expected'], 'PHP/JS schedule parity: ' . $fixture['name']);
    check(ais_pg_webinar_schedule($fixture['expected'], $schedule_data, $fixture['name']) === $fixture['expected'], 'Schedule transform is idempotent');
    foreach (array('ДОП','КПК','ППП') as $type) check(ais_pg_webinar_schedule($fixture['source'], array_replace($schedule_data, array('type'=>$type)), $fixture['name']) === $fixture['source'], 'Other program dates unchanged');
}
rejects(function () use ($schedule_data) { ais_pg_webinar_schedule('04.08.2026', array_replace($schedule_data, array('date'=>'2027-02-31'))); }, 'Invalid date rejected before landing write');
$test_role = 'edu';
$key = hash('sha256', 'schedule-program'); $hash = hash('sha256', 'schedule-draft'); $certificate_hash = hash('sha256', 'schedule-certificates');
$pages = array(array('id'=>500,'language'=>'ru'),array('id'=>501,'language'=>'en'));
foreach ($pages as $page) $test_meta[$page['id']]['_ais_certificate_key'] = ais_pg_certificate_key($key, $certificate_hash, $page['language']);
$source_description = '<p>Расписание трансляции — <b>4 августа 2026 года в 18.00</b></p>';
$source_review = array(array('quote'=>'4 августа 2026 года в 18.00 — отличный вебинар'));
$fields = array('opisanie_dokumenta'=>'Untrusted client replacement','blok_opisaniya_kursa'=>array(),'slajder'=>array());
foreach (ais_pg_certificate_slots('ПРО') as $slot=>$language) $fields[$slot] = $language === 'ru' ? 500 : 501;
$test_posts[900] = array('type'=>'other-course','status'=>'publish','key'=>'','post_modified_gmt'=>'version','post_title'=>'Прототип','post_content'=>$source_description,'post_excerpt'=>$source_description);
$test_definitions[900] = array();
foreach ($fields as $name=>$value) $test_definitions[900][] = array('key'=>'field_'.$name,'name'=>$name,'type'=>'text','value'=>$name==='opisanie_dokumenta' ? $source_description : ($name==='blok_opisaniya_kursa' ? $source_review : $value));
$landing_data = array_merge($schedule_data, array('key'=>$key,'hash'=>$hash,'title'=>'Новый вебинар','slug'=>'web_nazv','templateId'=>900,'templateModified'=>'version','fields'=>$fields,'certificatePages'=>$pages,'certificateHash'=>$certificate_hash));
$landing = ais_pg_mutate('prepare-landing', $landing_data);
$expected_description = '<p>Расписание трансляции — <b>18 сентября 2027 года в 09.35</b></p>';
check(get_field('opisanie_dokumenta', $landing['id']) === $expected_description, 'Authoritative description schedule changed without accepting arbitrary client text');
check($test_posts[$landing['id']]['post_content'] === $expected_description && $test_posts[$landing['id']]['post_excerpt'] === $expected_description, 'Content and excerpt schedules updated');
check(get_field('blok_opisaniya_kursa', $landing['id']) === $source_review, 'Review schedule remains verbatim');
check($test_posts[$landing['id']]['post_name'] === 'web_nazv', 'WordPress receives exact promo slug');
check($test_posts[900]['post_content'] === $source_description, 'Published prototype untouched');
$landing_data['hash'] = hash('sha256', 'schedule-retry'); $landing_data['slug'] = 'web_nazv_v2';
check(ais_pg_mutate('prepare-landing', $landing_data)['id'] === $landing['id'], 'Existing own draft reused with changed promo slug');
check($test_posts[$landing['id']]['post_name'] === 'web_nazv_v2', 'Own draft receives new requested slug');
echo "PASS: WordPress signature, URL validation, nested ACF schema, locks, managed identity, stale versions, exact promo slug collisions, schedule parity and authorized download hooks\n";

$link = '<a href="https://zifra-plus.ru/checkout/?ref=test&amp;add-to-cart=2732&amp;quantity=1">Регистрация</a>';
$expected_link = str_replace('add-to-cart=2732', 'add-to-cart=5112', $link);
check(ais_pg_registration_links($link, 5112) === $expected_link, 'Registration ID replaced, query and markup preserved');
check(ais_pg_registration_links(array('nested'=>array($link)), 5112) === array('nested'=>array($expected_link)), 'Nested registration links replaced');
foreach (array('blok_opisaniya_kursa','reviews','otzyvy') as $name) check(ais_pg_registration_links($link, 5112, $name) === $link, 'Review links preserved');
foreach (array('https://evil.example/?add-to-cart=2732','https://zifra-plus.ru/edu_info?add-to-cart=2732','https://zifra-plus.ru/?download_file=2732') as $other) check(ais_pg_registration_links($other, 5112) === $other, 'Unrelated links untouched');
update_post_meta($landing['id'], '_ais_generator_product', 5112);
check(ais_pg_render_registration_links($link, $landing['id']) === $expected_link, 'Already-generated landing corrected at render time');
check(ais_pg_render_registration_links($link, 900) === $link, 'Prototype rendering unchanged');
$format_image_link = $test_filters['acf/format_value'][0];
check($format_image_link($link, $landing['id'], array('name'=>'soderzhimoe_bloka')) === $link, 'Review child fields are never rewritten by the ACF formatting hook');
check($format_image_link($link, $landing['id'], array('name'=>'opisanie_dokumenta')) === $expected_link, 'Old description registration buttons repaired');
update_post_meta($landing['id'], 'blok_ceny', array(array(),array()));
check(ais_pg_render_registration_links($link, $landing['id']) === $link, 'Manually added price variants are not collapsed at render time');
update_post_meta($landing['id'], 'blok_ceny', array());
$test_role = 'shop';
$test_posts[5112] = array('type'=>'product','status'=>'draft','key'=>str_repeat('b',64));
$test_meta[5112]['_ais_generator_key'] = str_repeat('b',64);
check(strpos(ais_pg_draft_registration_message(5112), 'черновик') !== false, 'Draft has an actionable registration explanation');
$test_posts[5112]['status'] = 'publish';
check(ais_pg_draft_registration_message(5112) === '', 'Published product uses normal WooCommerce purchase checks');
$test_posts[5112]['status'] = 'draft'; unset($test_meta[5112]['_ais_generator_key']);
check(ais_pg_draft_registration_message(5112) === '' && ais_pg_draft_registration_message(999999) === '', 'Unmanaged/missing products are not intercepted');
check($test_actions['wp_loaded'][1] < 20, 'Draft guard precedes WooCommerce add-to-cart handler');
$test_role = 'edu';
$test_posts[902] = array_merge($test_posts[900], array('post_title'=>'Источник изображения'));
$image_file = $test_dir . '/landing-selected.jpg';
file_put_contents($image_file, 'isolated-image-fixture');
$test_posts[500]['file'] = $image_file;
set_post_thumbnail(902, 500);
$image_source = ais_pg_image_source(902);
check($image_source['imageId'] === 500 && strlen($image_source['version']) === 64, 'Authoritative featured image and version loaded');
check(ais_pg_validate_image_source($image_source) === $image_source, 'Current selection validated');
$bad_source = array_merge($image_source, array('imageId'=>501));
rejects(function () use ($bad_source) { ais_pg_validate_image_source($bad_source); }, 'Forged image rejected');
$image_data = array_merge($landing_data, array('hash'=>hash('sha256','image-selection'), 'imageSource'=>$image_source, 'productId'=>5112));
$image_landing = ais_pg_mutate('prepare-landing', $image_data);
check(get_post_thumbnail_id($image_landing['id']) === 500, 'Chosen image overrides prototype thumbnail');
check(get_post_thumbnail_id(900) === 0 && get_post_thumbnail_id(902) === 500, 'Prototype and image source unchanged');
set_post_thumbnail(902, 501);
$before_stale = serialize(array($test_posts, $test_meta));
rejects(function () use ($image_data) { ais_pg_mutate('prepare-landing', $image_data); }, 'Changed source blocks even idempotent retry');
check(serialize(array($test_posts, $test_meta)) === $before_stale, 'Stale source rejected before any mutation');
rejects(function () { ais_pg_image_source(900); }, 'No image rejected');
foreach (array('По мере набора группы', '01.10.2026', 'Ежедневно', '') as $start_label) {
    $test_meta[902]['data_starta'] = $start_label;
    check(ais_pg_start_label(902) === $start_label, 'Catalog preserves the prototype start wording');
}
$test_meta[902]['data_starta'] = array('unexpected');
check(ais_pg_start_label(902) === '', 'Non-text start field is not cast to Array');
check(ais_pg_start_label(999999) === '', 'Missing start field stays empty');
echo "PASS: registration repair with preserved reviews, draft notice without purchase bypass, explicit image source selection, stale-source protection and prototype start labels\n";
