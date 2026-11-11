<?php
declare(strict_types=1);
$root = sys_get_temp_dir() . '/ais-paid-enrollment-' . bin2hex(random_bytes(8));
mkdir($root); mkdir($root . '/wp'); define('ABSPATH', $root . '/wp/');
file_put_contents($root . '/ais-program-site.key', str_repeat('a', 64));
register_shutdown_function(static function () use ($root) { unlink($root . '/ais-program-site.key'); rmdir($root . '/wp'); rmdir($root); });
$actions = []; $jobs = []; $requests = []; $orders = []; $response_status = 200;
function add_action($name, $callback, $priority = 10, $argc = 1) { $GLOBALS['actions'][$name] = $callback; }
function add_filter(...$args) {}
function home_url() { return 'https://zifra-plus.ru'; }
function wp_parse_url($url, $component) { return parse_url($url, $component); }
function wc_get_order($id) { return $GLOBALS['orders'][$id] ?? null; }
function as_schedule_single_action($time, $hook, $args, $group, $unique = false) { $GLOBALS['jobs'][] = compact('time', 'hook', 'args', 'group', 'unique'); }
function wp_json_encode($data) { return json_encode($data); }
function is_wp_error($response) { return false; }
function wp_remote_post($url, $options) { $GLOBALS['requests'][] = compact('url', 'options'); return ['status' => $GLOBALS['response_status']]; }
function wp_remote_retrieve_response_code($response) { return $response['status']; }
function wp_remote_retrieve_body($response) { return '{"ok":true,"imported":1,"skipped":0}'; }
class EnrollmentOrderFixture {
    public array $meta = [], $notes = [];
    public function __construct(public bool $paid = true, public float $total = 1000) {}
    public function is_paid() { return $this->paid; }
    public function get_total() { return $this->total; }
    public function get_meta($key) { return $this->meta[$key] ?? ''; }
    public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    public function delete_meta_data($key) { unset($this->meta[$key]); }
    public function add_order_note($note) { $this->notes[] = $note; }
    public function save() {}
}
function check_enrollment($value, $message) { if (!$value) throw new RuntimeException($message); }
require dirname(__DIR__) . '/services/wordpress/ais-program-generator.php';
check_enrollment(count($requests) === 0 && count($jobs) === 0, 'Plugin installation must not process historical orders');
$orders[1] = new EnrollmentOrderFixture(false); $orders[2] = new EnrollmentOrderFixture(true, 0); $orders[3] = new EnrollmentOrderFixture();
ais_pg_queue_paid_enrollment(1); ais_pg_queue_paid_enrollment(2); check_enrollment(count($jobs) === 0, 'Unpaid/free orders ignored');
$actions['woocommerce_payment_complete'](3); check_enrollment(count($jobs) === 1 && $jobs[0]['unique'], 'Payment must queue unique asynchronous action');
check_enrollment(count($requests) === 0, 'Checkout must not wait for AIS');
$actions['ais_pg_paid_enrollment'](3); check_enrollment(count($requests) === 1, 'Queued task contacts AIS');
$sent = $requests[0]; $options = $sent['options']; $headers = $options['headers'];
check_enrollment($sent['url'] === 'https://edu-plus.ru/lms/api/student-enrollment/paid-order' && $options['sslverify'] && $options['redirection'] === 0, 'HTTPS destination must be fixed');
check_enrollment($headers['X-AIS-Signature'] === ais_pg_signature(str_repeat('a',64), 'POST', '/api/student-enrollment/paid-order', $headers['X-AIS-Timestamp'], $headers['X-AIS-Nonce'], $options['body']), 'Signed request mismatch');
check_enrollment(json_decode($options['body'], true) === ['orderId'=>'3'], 'No credentials or personal data in callback');
ais_pg_process_paid_enrollment(3); check_enrollment(count($requests) === 1, 'Completed task must not repeat');
$orders[4] = new EnrollmentOrderFixture(); $response_status = 503; ais_pg_process_paid_enrollment(4);
check_enrollment(!$orders[4]->get_meta('_ais_enrollment_done') && count($jobs) === 2 && !$jobs[1]['unique'], 'Failure must schedule retry even while current task is running');
check_enrollment($orders[4]->get_meta('_ais_enrollment_error') !== '', 'Retry reason must remain visible in order');
echo "PASS: payment hooks, asynchronous dispatch, HMAC, paid-only checks, idempotency, visible errors and retries\n";
