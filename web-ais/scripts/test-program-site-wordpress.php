<?php
// Isolated WordPress contract test: no network, WordPress DB or real products.
$test_dir = sys_get_temp_dir() . '/ais-program-tests-' . bin2hex(random_bytes(8));
mkdir($test_dir);
mkdir($test_dir . '/wordpress');
define('ABSPATH', $test_dir . '/wordpress/');
file_put_contents($test_dir . '/ais-program-site.key', str_repeat('a',64));
register_shutdown_function(function () use ($test_dir) {
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
function get_posts($args) { return array_keys(array_filter($GLOBALS['test_posts'], function ($post) use ($args) { return ($post['key'] ?? '') === $args['meta_value']; })); }
function get_post_status($id) { return $GLOBALS['test_posts'][$id]['status'] ?? ''; }
function get_post_type($id) { return $GLOBALS['test_posts'][$id]['type'] ?? ''; }
function get_post_field($key, $id) { return $GLOBALS['test_posts'][$id][$key] ?? ''; }
function get_post_meta($id, $key, $single = true) { return $GLOBALS['test_meta'][$id][$key] ?? ''; }
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
echo "PASS: WordPress signature, URL validation, nested ACF schema, locks, managed identity, stale versions, slug collision and authorized download hooks\n";
