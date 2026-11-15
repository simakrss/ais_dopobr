<?php
/** Run with wp eval-file: disposable customer, memory-only orders, all mail/HTTP intercepted. */
if (!defined('WP_CLI') || !WP_CLI || DB_NAME !== 'cl11741_zifra') throw new RuntimeException('Wrong test environment');
if (!function_exists('ais_sa_track_order_email')) throw new RuntimeException('Deploy the order receipt module first');
class AIS_Email_Memory_Order extends WC_Order {
    public int $fixtureId = 0;
    public array $fixtureMeta = [];
    public function get_id() { return $this->fixtureId; }
    public function get_order_number() { return 'TEST-' . $this->fixtureId; }
    public function save() { throw new RuntimeException('Test orders must never be saved'); }
    public function read_meta_data($force_read = false) {}
    public function save_meta_data() {}
    public function get_meta($key = '', $single = true, $context = 'view') { return $this->fixtureMeta[$key] ?? ''; }
    public function update_meta_data($key, $value, $meta_id = 0) { $this->fixtureMeta[$key] = $value; }
    public function delete_meta_data($key) { unset($this->fixtureMeta[$key]); }
}
$GLOBALS['ais_email_test_checks'] = [];
function ais_email_test_check($value, $name) {
    if (!$value) throw new RuntimeException($name);
    $GLOBALS['ais_email_test_checks'][] = $name;
}
$mails = []; $fixtures = []; $uid = 0; $buffer_level = ob_get_level();
add_filter('pre_wp_mail', function ($result, $mail) use (&$mails) { $mails[] = $mail; return true; }, PHP_INT_MAX, 2);
add_filter('pre_http_request', function ($result, $options, $url) use (&$fixtures) {
    $data = json_decode($options['body'] ?? '', true);
    if ($url === 'https://edu-plus.ru/lms/api/student-enrollment/paid-order' && isset($fixtures[$data['orderId'] ?? ''])) {
        $fixture = $fixtures[$data['orderId']];
        if (($data['orderEmailRecipient'] ?? '') !== $fixture['email']) throw new RuntimeException('Wrong test recipient');
        return ['headers' => [], 'response' => ['code' => 200], 'body' => wp_json_encode(['ok' => true, 'accounts' => [$fixture['account']]])];
    }
    return new WP_Error('test_http_disabled', 'External requests disabled during the test');
}, PHP_INT_MAX, 3);
add_filter('woocommerce_defer_transactional_emails', '__return_false', PHP_INT_MAX);
add_filter('woocommerce_email_enabled_customer_new_account', '__return_false', PHP_INT_MAX);
// The admin notification writes its own order flag; only customer notifications
// are under test, and the fixture forbids any real order writes.
add_filter('woocommerce_email_enabled_new_order', '__return_false', PHP_INT_MAX);
try {
    WC()->mailer();
    $suffix = strtolower(wp_generate_password(14, false));
    $address = 'ais-auto-mail-' . $suffix . '@example.invalid';
    $password = wp_generate_password(30, true);
    $uid = wc_create_new_customer($address, 'ais-mail-' . $suffix, $password);
    ais_email_test_check(is_int($uid) && $uid > 0, 'disposable_customer_created');
    $user = get_userdata($uid); $native_hash = $user->user_pass;
    $account = ['accountId' => 'fixture-' . $suffix, 'credentialVersion' => hash('sha256', $suffix), 'login' => $user->user_login,
        'password' => $password, 'programs' => ['Тестовая программа']];
    $mails = [];
    $orders = [];
    foreach ([['processing', 1000, 'woocommerce_order_status_pending_to_processing_notification'], ['completed', 0, 'woocommerce_order_status_completed_notification']] as [$status, $total, $event]) {
        $id = random_int(1900000000, 2000000000);
        ais_email_test_check(!wc_get_order($id), 'fixture_id_unused_' . $status);
        $order = new AIS_Email_Memory_Order(); $order->fixtureId = $id;
        $order->set_customer_id($uid); $order->set_billing_email($address); $order->set_billing_first_name('Проверка');
        $order->set_date_created(time()); $order->set_status($status); $order->set_total($total);
        $fixtures[(string)$id] = ['email' => $address, 'account' => $account];
        $before = count($mails);
        do_action($event, $id, $order);
        $new_mails = array_slice($mails, $before);
        $customer = array_values(array_filter($new_mails, static fn($mail) => in_array($address, (array)$mail['to'], true)));
        ais_email_test_check(count($customer) === 1, 'one_automatic_customer_email_' . $status);
        $decoded = html_entity_decode($customer[0]['message'], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        ais_email_test_check(str_contains($decoded, $account['login']) && str_contains($decoded, $password)
            && str_contains($decoded, 'https://edu-plus.ru/lms/') && str_contains($decoded, wc_get_page_permalink('myaccount')), 'existing_credentials_in_automatic_email_' . $status);
        ais_email_test_check($order->get_meta('_ais_order_access_notice')['status'] === 'sent', 'delivery_recorded_per_order_' . $status);
        $before_fallback = count($mails); ais_sa_process_order($order);
        ais_email_test_check(count($mails) === $before_fallback, 'no_extra_notice_after_confirmed_delivery_' . $status);
        ais_email_test_check(!str_contains(wp_json_encode($order->fixtureMeta), $password), 'no_password_in_order_metadata_' . $status);
        $orders[] = $order;
    }
    ais_email_test_check(get_userdata($uid)->user_pass === $native_hash && wp_check_password($password, $native_hash, $uid), 'repeat_order_preserves_password');
    ais_email_test_check(get_user_meta($uid, '_ais_student_account', true) === $account['accountId'], 'repeat_order_preserves_student_account');
    foreach ($orders as $order) ais_email_test_check(!wc_get_order($order->get_id()), 'order_not_saved_' . $order->get_status());
    echo wp_json_encode(['ok' => true, 'checks' => $GLOBALS['ais_email_test_checks'], 'orders_saved' => 0, 'outgoing_mail_blocked' => true, 'ais_requests_mocked' => true], JSON_UNESCAPED_UNICODE) . "\n";
} finally {
    while (ob_get_level() > $buffer_level) ob_end_clean();
    if (is_int($uid) && $uid > 0) {
        require_once ABSPATH . 'wp-admin/includes/user.php';
        wp_delete_user($uid);
    }
}
