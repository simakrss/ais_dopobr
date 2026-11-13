<?php
declare(strict_types=1);
$root = sys_get_temp_dir() . '/ais-order-email-' . bin2hex(random_bytes(8));
mkdir($root); mkdir($root . '/wp'); define('ABSPATH', $root . '/wp/');
file_put_contents($root . '/ais-program-site.key', str_repeat('a', 64));
register_shutdown_function(static function () use ($root) { unlink($root . '/ais-program-site.key'); rmdir($root . '/wp'); rmdir($root); });
$actions = []; $filters = []; $requests = []; $jobs = []; $orders = []; $response_status = 200;
$response_body = ['ok' => true, 'accounts' => [['login' => 'student_test', 'password' => '123456', 'programs' => ['Курс <пример>']]]];
function add_action($name, $callback, $priority = 10, $argc = 1) { $GLOBALS['actions'][$name] = $callback; }
function add_filter($name, $callback, $priority = 10, $argc = 1) { $GLOBALS['filters'][$name] = $callback; }
function home_url() { return 'https://zifra-plus.ru'; }
function wp_parse_url($url, $component) { return parse_url($url, $component); }
function wc_get_order($id) { return $GLOBALS['orders'][$id] ?? null; }
function as_schedule_single_action($time, $hook, $args, $group, $unique = false) { $GLOBALS['jobs'][] = compact('time', 'hook', 'args'); }
function wp_json_encode($data) { return json_encode($data); }
function is_wp_error($response) { return false; }
function wp_remote_post($url, $options) { $GLOBALS['requests'][] = compact('url', 'options'); return ['status' => $GLOBALS['response_status']]; }
function wp_remote_retrieve_response_code($response) { return $response['status']; }
function wp_remote_retrieve_body($response) { return json_encode($GLOBALS['response_body']); }
function is_email($email) { return filter_var($email, FILTER_VALIDATE_EMAIL); }
function esc_html($text) { return htmlspecialchars($text, ENT_QUOTES, 'UTF-8'); }
function esc_url($url) { return esc_html($url); }
class OrderEmailFixture {
    public array $meta = [];
    public bool $paid = true;
    public float $total = 1000;
    public function __construct(public int $id) {}
    public function get_id() { return $this->id; }
    public function is_paid() { return $this->paid; }
    public function get_total() { return $this->total; }
    public function get_meta($key) { return $this->meta[$key] ?? ''; }
    public function get_billing_email() { return 'student@example.test'; }
}
class EmailFixture {
    public string $id = 'customer_processing_order';
    public string $recipient = 'student@example.test';
    public function get_recipient() { return $this->recipient; }
}
function check_email($value, $message) { if (!$value) throw new RuntimeException($message); }
function render_email($order, $email, $plain = false, $admin = false) {
    ob_start(); ais_pg_order_email_instructions($order, $admin, $plain, $email); return ob_get_clean();
}
require dirname(__DIR__) . '/services/wordpress/ais-program-generator.php';
check_email(!$requests && !$jobs, 'Installation must not send messages or process orders');
check_email(($actions['woocommerce_email_order_meta'] ?? '') === 'ais_pg_order_email_instructions', 'Standard Woo email hook is registered');
$order = new OrderEmailFixture(1); $email = new EmailFixture();
check_email(render_email($order, $email, false, true) === '', 'Never include access in administrator email');
$email->recipient = 'other@example.test'; check_email(render_email($order, $email) === '', 'Never include access for different recipient');
$email->recipient = 'student@example.test,other@example.test'; check_email(render_email($order, $email) === '', 'Multiple recipients are rejected');
$email->recipient = 'student@example.test'; $order->paid = false; check_email(render_email($order, $email) === '', 'Unpaid order has no access');
$order->paid = true; $order->total = 0; check_email(render_email($order, $email) === '', 'Free order has no access');
$order->total = 1000; $order->meta['_ais_student_payment_intent'] = 'debt'; check_email(render_email($order, $email) === '', 'Debt payment does not create another account');
$order->meta = []; $email->id = 'customer_refunded_order'; check_email(render_email($order, $email) === '', 'Refund mail has no access');
check_email(!$requests, 'Excluded messages do not call AIS');
$email->id = 'customer_processing_order'; $html = render_email($order, $email);
foreach (['https://edu-plus.ru/lms/', 'student_test', '123456', 'Курс &lt;пример&gt;', '«Основное»', '«Документы»', '«Отправить на проверку»', 'https://zifra-plus.ru/edu_info/'] as $text) check_email(str_contains($html, $text), 'Missing expected order email content');
$plain = render_email($order, $email, true);
check_email(str_contains($plain, 'Логин: student_test') && str_contains($plain, 'Пароль: 123456') && !str_contains($plain, '<strong>'), 'Plaintext email content');
check_email(count($requests) === 1, 'HTML/plain rendering reuses account within request');
$options = $requests[0]['options']; $headers = $options['headers'];
check_email($requests[0]['url'] === 'https://edu-plus.ru/lms/api/student-enrollment/paid-order' && $options['sslverify'] && $options['redirection'] === 0 && $options['timeout'] <= 20, 'Bounded fixed HTTPS request');
check_email(json_decode($options['body'], true) === ['orderId' => '1', 'orderEmailRecipient' => 'student@example.test'], 'Recipient bound to request');
check_email($headers['X-AIS-Signature'] === ais_pg_signature(str_repeat('a', 64), 'POST', '/api/student-enrollment/paid-order', $headers['X-AIS-Timestamp'], $headers['X-AIS-Nonce'], $options['body']), 'Signature covers recipient');
check_email(!$order->meta && !$jobs, 'Credentials are not saved to order; rendering does not queue/send mail');
$response_body = ['ok' => true, 'accounts' => []]; check_email(render_email(new OrderEmailFixture(2), $email) === '', 'Noneducational orders with no account remain unchanged');
$response_status = 503; $orders[3] = new OrderEmailFixture(3);
check_email(render_email($orders[3], $email) === '' && count($jobs) === 1, 'Unavailable AIS does not break email and keeps queued enrollment retry');

// Render the same instruction template used by the shop, preserving document requirements.
function get_header() {}
function get_footer() {}
function have_posts() { static $remaining = 1; return $remaining-- > 0; }
function the_post() {}
function get_the_content() { return ''; }
function zifra_icon($name) { return '<svg aria-hidden="true"></svg>'; }
function zifra_education_info_sections($content) { return ['qualification' => 'Для зачисления необходимо прислать: паспорт и диплом', 'certificate' => 'Для зачисления необходимо прислать: паспорт', 'module' => 'Модуль: документы не требуются', 'international' => 'Порядок признания дипломов', 'signature' => 'Учебный центр', 'social' => '', 'contact' => 'Отправьте на email']; }
function zifra_education_info_html($content) { return $content; }
function zifra_education_info_links($content) { return []; }
ob_start(); require dirname(__DIR__) . '/services/wordpress/ais-education-info-template.php'; $page = ob_get_clean();
foreach (['загрузите сканы', '«Основное»', '«Документы»', '«Отправить на проверку»', 'https://edu-plus.ru/lms/', 'паспорт и диплом', 'Порядок признания дипломов'] as $text) check_email(str_contains($page, $text), 'Instruction page missing required content');
check_email(!str_contains($page, 'необходимо прислать:') && !str_contains($page, 'Отправьте на email'), 'Legacy email submission instructions are replaced');
check_email(substr_count($page, 'href="https://edu-plus.ru/lms/"') === 2, 'Cabinet buttons are present');
echo "PASS: order email recipient isolation, paid-only credentials, HMAC, HTML/plain rendering, bounded failure, no email side effects, instruction page\n";
