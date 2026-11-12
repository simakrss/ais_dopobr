<?php
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/fixture/');
$orders = array(); $filters = array(); $remote_status = 'pending';
function add_action(...$args) {}
function add_filter($name, $callback, ...$args) { $GLOBALS['filters'][$name] = $callback; }
function home_url() { return 'https://zifra-plus.ru'; }
function wp_parse_url($url, $component) { return parse_url($url, $component); }
class WP_Error { public function __construct(public $code, public $message, public $data) {} }
function is_wp_error($value) { return $value instanceof WP_Error; }
function sanitize_email($value) { return trim($value); }
function is_email($value) { return filter_var($value, FILTER_VALIDATE_EMAIL); }
function sanitize_text_field($value) { return strip_tags($value); }
class GatewayFixture { public $enabled = 'yes', $id = 'yookassa_epl'; }
function WC() { return new class { function payment_gateways() { return new class { function payment_gateways() { return array('yookassa_epl' => new GatewayFixture()); } }; } }; }
$wpdb = new class { function prepare($sql, $arg) { return $sql; } function get_var($sql) { return '1'; } };
class WC_Order_Item_Product { public $total; function set_name($v) {} function set_quantity($v) {} function set_subtotal($v) {} function set_total($v) { $this->total = $v; } }
class OrderFixture {
    public $meta = array(), $total = 0, $status = 'pending', $currency = 'RUB', $transaction = '', $items = array(), $method;
    function __construct(public $id) {}
    function get_id() { return $this->id; }
    function get_meta($key) { return $this->meta[$key] ?? ''; }
    function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    function get_total() { return $this->total; }
    function set_total($v) { $this->total = $v; }
    function get_currency() { return $this->currency; }
    function set_currency($v) { $this->currency = $v; }
    function set_billing_email($v) {} function set_billing_first_name($v) {} function set_billing_phone($v) {}
    function set_payment_method($v) { $this->method = $v->id; }
    function get_payment_method() { return $this->method; }
    function add_item($v) { $this->items[] = $v; }
    function save() {}
    function is_paid() { return $this->status === 'processing'; }
    function needs_payment() { return $this->status === 'pending'; }
    function get_status() { return $this->status; }
    function update_status($v, $note) { $this->status = $v; }
    function get_transaction_id() { return $this->transaction; }
    function get_date_paid() { return new class { function date($v) { return '2026-11-12T12:00:00+03:00'; } }; }
    function get_checkout_payment_url() { return 'https://zifra-plus.ru/checkout/order-pay/' . $this->id . '/?key=fixture'; }
}
function wc_get_orders($query) { return array_values(array_filter($GLOBALS['orders'], fn($order) => $order->get_meta($query['meta_key']) === $query['meta_value'])); }
function wc_create_order($args) { $id = count($GLOBALS['orders']) + 1; return $GLOBALS['orders'][$id] = new OrderFixture($id); }
function wc_get_order($id) { return $GLOBALS['orders'][$id] ?? null; }
class YooKassaClientFactory { static function getYooKassaClient() { return new class { function getPaymentInfo($id) { return new class {
    function getAmount() { return new class { function getCurrency() { return 'RUB'; } function getValue() { return '5000.00'; } }; }
    function getStatus() { return $GLOBALS['remote_status']; }
    function getPaid() { return $GLOBALS['remote_status'] === 'succeeded'; }
}; } }; } }
function check($value, $message) { if (!$value) throw new RuntimeException($message); }
require dirname(__DIR__) . '/services/wordpress/ais-program-generator.php';
check(ais_pg_student_payment(array('checkOnly' => true))['available'], 'Read-only health'); check(count($orders) === 0, 'Health creates no orders');
$input = array('intentKey' => '00000000-0000-4000-8000-000000000001', 'studentId' => 'student-1', 'email' => 'fixture@example.test', 'name' => 'Тест', 'program' => 'Программа', 'amount' => '5000.00');
$a = ais_pg_student_payment($input); $b = ais_pg_student_payment($input); check($a['orderId'] === $b['orderId'] && count($orders) === 1, 'Duplicate click reuses order');
check($orders[1]->total === '5000.00' && count($orders[1]->items) === 1 && $orders[1]->method === 'yookassa_epl', 'Exact debt, one line, YooKassa gateway');
$orders[1]->status = 'processing'; $orders[1]->transaction = 'yoo-id';
check(!ais_pg_student_payment(array('orderId' => '1'), true)['paid'], 'Woo paid status without provider success is not enough');
$remote_status = 'succeeded'; check(ais_pg_student_payment(array('orderId' => '1'), true)['paid'], 'Provider success accepted');
check(!ais_pg_cancel_student_payment(array('orderId' => '1', 'intentKey' => $input['intentKey']))['cancelled'], 'Paid order never cancelled');
check(is_wp_error(ais_pg_student_payment(array_merge($input, array('amount' => '-1.00')))), 'Negative amount rejected');
check(is_wp_error(ais_pg_student_payment(array_merge($input, array('email' => "a@b.test\r\nBad")))), 'Invalid email rejected');
$input['intentKey'] = '00000000-0000-4000-8000-000000000002'; ais_pg_student_payment($input);
check(ais_pg_cancel_student_payment(array('orderId' => '2', 'intentKey' => $input['intentKey']))['cancelled'], 'Outdated unpaid order may be cancelled');
echo "PASS: signed shop payment operations, health without orders, amount/gateway, idempotency, provider confirmation and safe cancellation\n";
