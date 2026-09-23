<?php
// All files and credentials below are synthetic, inside an isolated temporary directory.
$test_root = getenv('AIS_RELAY_TEST_ROOT') ?: sys_get_temp_dir() . '/ais-relay-test-' . bin2hex(random_bytes(8));
if (!is_dir($test_root . '/public_html')) mkdir($test_root . '/public_html', 0700, true);
define('ABSPATH', $test_root . '/public_html/');
file_put_contents($test_root . '/ais-program-site.key', str_repeat('a', 64));
class WP_Error { public $message, $data; function __construct($code, $message, $data) { $this->message = $message; $this->data = $data; } }
class WP_REST_Response { public $data; function __construct($data, $status, $headers) { $this->data = $data; } }
function add_action($name, $callback) {}
function home_url() { return 'https://zifra-plus.ru'; }
function wp_parse_url($url, $component) { return parse_url($url, $component); }
function is_wp_error($value) { return $value instanceof WP_Error; }
function add_option($name, $value, $unused, $autoload) {
    global $test_root;
    $file = @fopen($test_root . '/' . $name, 'x'); if (!$file) return false;
    fwrite($file, $value); fclose($file); return true;
}
$wpdb = new class { public $options = 'options'; function query($query) {} function prepare(...$args) { return ''; } function esc_like($value) { return $value; } };
require __DIR__ . '/../services/wordpress/ais-document-relay.php';
class Request {
    public $action, $body, $headers;
    function __construct($action, $body, $headers = array()) { $this->action = $action; $this->body = $body; $this->headers = array_change_key_case($headers); }
    function get_header($name) { return $this->headers[strtolower($name)] ?? ''; }
    function get_route() { return '/ais-document-relay/v1/' . $this->action; }
    function get_method() { return 'POST'; }
    function get_query_params() { return array(); }
    function get_body() { return $this->body; }
    function get_json_params() { return json_decode($this->body, true); }
}
if (PHP_SAPI === 'cli-server') {
    $request = new Request(basename(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)), file_get_contents('php://input'), getallheaders());
    $permission = ais_dr_permission($request);
    $result = $permission === true ? ais_dr_handle($request) : $permission;
    header('Content-Type: application/json');
    if (is_wp_error($result)) { http_response_code($result->data['status']); echo json_encode(array('message' => $result->message)); }
    else echo json_encode($result->data);
    return;
}
function check($ok, $message) { if (!$ok) throw new RuntimeException($message); }
function ok($value) { check(!is_wp_error($value), is_wp_error($value) ? $value->message : ''); return $value; }
function status($value, $code) { check(is_wp_error($value) && $value->data['status'] === $code, 'Expected error ' . $code); }
$root = ais_dr_root(); mkdir($root, 0700);
$now = time();
$call = fn($action, $data = array(), $time = null) => ais_dr_dispatch($root, $action, $data, $time ?? $now);
$worker1 = str_repeat('1', 32); $worker2 = str_repeat('2', 32);
$id = str_repeat('3', 32); $owner = str_repeat('4', 64); $bytes = str_repeat('ENCRYPTED', 20);
$identity = array('id' => $id, 'owner' => $owner);
$input = $identity + array('kind' => 'pdf', 'size' => strlen($bytes), 'digest' => hash('sha256', $bytes));
status($call('submit', $input), 503);
ok($call('claim', array('worker' => $worker1, 'capabilities' => array('pdf'))));
ok($call('claim', array('worker' => $worker2, 'capabilities' => array('pdf', 'ocr'))));
check($call('health')['pdf'] === 2 && $call('health')['ocr'] === 1, 'Capability counts');
ok($call('submit', $input)); ok($call('submit', $input));
status($call('status', array('id' => $id, 'owner' => str_repeat('f', 64))), 403);
status($call('commit', $identity), 409);
$chunk = $identity + array('offset' => 0, 'data' => base64_encode($bytes));
ok($call('put', $chunk)); ok($call('put', $chunk));
ok($call('commit', $identity));
$first = ok($call('claim', array('worker' => $worker1, 'capabilities' => array('pdf'))))['job'];
check($first['id'] === $id, 'First worker claim');
check($call('claim', array('worker' => $worker2, 'capabilities' => array('pdf')))['job'] === null, 'Second worker cannot duplicate live job');
check($call('claim', array('worker' => $worker1, 'capabilities' => array('pdf')))['job'] === null, 'Duplicate process cannot create second slot');
$first_identity = array('id' => $id, 'worker' => $worker1, 'lease' => $first['lease']);
check(base64_decode(ok($call('read', $first_identity + array('offset' => 0)))['data']) === $bytes, 'Input reads');
$second = ok($call('claim', array('worker' => $worker2, 'capabilities' => array('pdf')), $now + 41))['job'];
check($second['id'] === $id && $second['lease'] !== $first['lease'], 'Expired executor is replaced');
status($call('renew', $first_identity, $now + 42), 409);
$second_identity = array('id' => $id, 'worker' => $worker2, 'lease' => $second['lease']);
ok($call('result-start', $second_identity + array('size' => strlen($bytes), 'digest' => hash('sha256', $bytes)), $now + 42));
ok($call('result-put', $second_identity + array('offset' => 0, 'data' => base64_encode($bytes)), $now + 42));
status($call('complete', $first_identity, $now + 42), 409);
ok($call('complete', $second_identity, $now + 42));
check(!file_exists("$root/$id.input"), 'Input removed after processing');
check($call('status', $identity, $now + 43)['state'] === 'complete', 'Result available');
ok($call('ack', $identity, $now + 43));
check(!file_exists("$root/$id.output"), 'Result removed after receipt');
$id2 = str_repeat('5', 32); $identity2 = array('id' => $id2, 'owner' => $owner);
ok($call('submit', array_merge($input, $identity2), $now + 43));
ok($call('put', $identity2 + array('offset' => 0, 'data' => base64_encode($bytes)), $now + 43));
ok($call('cancel', $identity2, $now + 43));
check(!file_exists("$root/$id2.input"), 'Cancel removes bytes');
status($call('commit', $identity2, $now + 43), 409);
$unsigned = new Request('health', '{}'); status(ais_dr_permission($unsigned), 403);
$nonce = bin2hex(random_bytes(16)); $stamp = (string) time();
$key = hash_hmac('sha256', 'ais-document-relay-v1:authentication', str_repeat('a', 64), true);
$signature = hash_hmac('sha256', implode("\n", array('POST', '/wp-json/ais-document-relay/v1/health', $stamp, $nonce, hash('sha256', '{}'))), $key);
$signed = new Request('health', '{}', array('x-ais-timestamp' => $stamp, 'x-ais-nonce' => $nonce, 'x-ais-signature' => $signature));
check(ais_dr_permission($signed) === true, 'Valid signature'); status(ais_dr_permission($signed), 409);
ais_dr_cleanup($root, $now + 2000); check(count(glob($root . '/*.json')) === 0, 'Expiry cleanup');
// Only known flat fixture directories are removed, never application storage.
foreach (glob($root . '/*') ?: array() as $file) unlink($file); rmdir($root);
foreach (glob($test_root . '/*') ?: array() as $file) { if (is_file($file)) unlink($file); }
rmdir($test_root . '/public_html'); rmdir($test_root);
echo "Relay PHP: signatures/replay, ownership, chunk retries, two workers, single slot, lease fencing, cancellation, cleanup OK\n";
