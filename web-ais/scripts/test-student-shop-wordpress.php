<?php
declare(strict_types=1);
$root = sys_get_temp_dir() . '/ais-shop-' . bin2hex(random_bytes(8)); mkdir($root); mkdir($root . '/wp'); define('ABSPATH', $root . '/wp/');
file_put_contents($root . '/ais-program-site.key', str_repeat('a', 64));
register_shutdown_function(static function () use ($root) { unlink($root . '/ais-program-site.key'); rmdir($root . '/wp'); rmdir($root); });
$users = []; $meta = []; $hooks = []; $requests = []; $mails = []; $orders = []; $password_changes = []; $answers = []; $cart_ids = []; $offline = false; $send_ok = true;
class WP_Error { public function __construct(public string $code, public string $message = '', public array $data = []) {} public function get_error_codes() { return [$this->code]; } }
class WP_User {
    public array $roles = ['customer']; public string $user_pass; public string $display_name = '';
    public function __construct(public int $ID, public string $user_login, public string $user_email, string $password = 'old-password') { $this->user_pass = password_hash($password, PASSWORD_DEFAULT); }
    public function exists() { return $this->ID > 0; }
}
function add_action($hook, $callback, $priority = 10, $args = 1) { $GLOBALS['hooks'][$hook][$priority][] = [$callback, $args]; }
function add_filter(...$args) { add_action(...$args); }
function apply_filters($hook, $value, ...$args) {
    $callbacks = $GLOBALS['hooks'][$hook] ?? []; ksort($callbacks);
    foreach ($callbacks as $group) foreach ($group as [$fn, $argc]) $value = $fn(...array_slice([$value, ...$args], 0, $argc)); return $value;
}
function do_action($hook, ...$args) { $callbacks = $GLOBALS['hooks'][$hook] ?? []; ksort($callbacks); foreach ($callbacks as $group) foreach ($group as [$fn, $argc]) $fn(...array_slice($args, 0, $argc)); }
function home_url() { return 'https://zifra-plus.ru'; }
function wp_parse_url($value, $component) { return parse_url($value, $component); }
function user_can($user, $cap) { return in_array('administrator', $user->roles); }
function is_super_admin($id) { return in_array('administrator', $GLOBALS['users'][$id]->roles); }
function get_user_by($field, $value) { foreach ($GLOBALS['users'] as $user) if (strcasecmp((string) $user->{$field === 'id' ? 'ID' : ($field === 'email' ? 'user_email' : 'user_login')}, (string) $value) === 0) return $user; return false; }
function get_user_meta($id, $key, $single = true) { return $GLOBALS['meta'][$id][$key] ?? ''; }
function update_user_meta($id, $key, $value) { $GLOBALS['meta'][$id][$key] = $value; return true; }
function delete_user_meta($id, $key) { unset($GLOBALS['meta'][$id][$key]); }
function get_users($args) { $result = []; foreach ($GLOBALS['users'] as $user) if (isset($args['search']) ? strcasecmp($user->user_email, $args['search']) === 0 : (string) get_user_meta($user->ID, $args['meta_key']) === (string) $args['meta_value']) $result[] = ($args['fields'] ?? '') === 'ID' ? $user->ID : $user; return array_slice($result, 0, $args['number']); }
function wp_salt($scheme) { return 'fixture-private-salt'; }
function sanitize_user($login, $strict) { return preg_replace('/[^a-zA-Z0-9_.+\-]/', '', $login); }
function wc_create_new_customer($email, $login, $password) {
    if (get_user_by('email', $email) || get_user_by('login', $login)) return new WP_Error('exists');
    $id = count($GLOBALS['users']) + 1; $GLOBALS['users'][$id] = new WP_User($id, $login, $email, $password); do_action('woocommerce_created_customer', $id);
    if (apply_filters('woocommerce_email_enabled_customer_new_account', true, $GLOBALS['users'][$id])) $GLOBALS['mails'][] = ['default' => true];
    return $id;
}
function wp_set_password($password, $id) { $GLOBALS['password_changes'][] = $id; $GLOBALS['users'][$id]->user_pass = password_hash($password, PASSWORD_DEFAULT); }
function is_email($email) { return filter_var($email, FILTER_VALIDATE_EMAIL); }
function is_wp_error($value) { return $value instanceof WP_Error; }
function wp_json_encode($value) { return json_encode($value); }
function esc_html($text) { return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8'); }
function esc_attr($text) { return esc_html($text); }
function esc_url($text) { return esc_html($text); }
function wc_get_page_permalink($name) { return 'https://zifra-plus.ru/my-account/'; }
function wc_get_order($id) { return $GLOBALS['orders'][$id] ?? null; }
function as_schedule_single_action(...$args) {}
function wp_remote_post($url, $options) {
    $GLOBALS['requests'][] = [$url, $options]; $body = json_decode($options['body'], true);
    if ($GLOBALS['offline']) return ['status' => 503, 'body' => []];
    $operation = $body['shopAccountOperation'] ?? '';
    if ($operation === 'eligible-products') return ['status' => 200, 'body' => ['ok' => true, 'productIds' => array_values(array_intersect($body['productIds'], ['10']))]];
    if ($operation === 'authenticate') return ['status' => 200, 'body' => ['ok' => $body['password'] === '003456']];
    if (isset($body['orderEmailRecipient'])) return ['status' => 200, 'body' => ['ok' => true, 'accounts' => $GLOBALS['answers'][$body['orderId']] ?? []]];
    return ['status' => 200, 'body' => ['ok' => true, 'imported' => 1]];
}
function wp_remote_retrieve_response_code($r) { return $r['status']; }
function wp_remote_retrieve_body($r) { return json_encode($r['body']); }
class FakeOrder {
    public array $meta = []; public bool $paid = true; public float $total = 5000; public array $notes = [];
    public function __construct(public int $id, public string $email, public int $customer = 0) { $GLOBALS['orders'][$id] = $this; }
    public function get_id() { return $this->id; } public function is_paid() { return $this->paid; } public function get_total() { return $this->total; }
    public function get_meta($key) { return $this->meta[$key] ?? ''; } public function get_billing_email() { return $this->email; }
    public function get_customer_id() { return $this->customer; } public function set_customer_id($id) { $this->customer = $id; }
    public function save() {} public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    public function delete_meta_data($key) { unset($this->meta[$key]); } public function add_order_note($value) { $this->notes[] = $value; }
}
class FakeMailer { public function wrap_message($heading, $body) { return $body; } public function send($to, $subject, $body, $headers) { $GLOBALS['mails'][] = compact('to', 'subject', 'body'); return $GLOBALS['send_ok']; } }
class FakeCart { public function get_cart() { return array_map(static fn($id) => ['product_id' => $id], $GLOBALS['cart_ids']); } }
class FakeWC { public $cart; public function __construct() { $this->cart = new FakeCart(); } public function mailer() { return new FakeMailer(); } }
function WC() { static $wc; return $wc ??= new FakeWC(); }
$wpdb = new class { public string $prefix = 'fixture_'; public int $attempts = 1; public function prepare($sql, ...$args) { return $sql; } public function query($sql) { return 1; } public function get_var($sql) { return str_starts_with($sql, 'SELECT attempts') ? $this->attempts : 1; } };
function check($condition, $message) { if (!$condition) throw new RuntimeException($message); }
function denied(callable $fn, string $message) { try { $fn(); } catch (RuntimeException $e) { return; } throw new RuntimeException($message); }
function account($id, $login) { return ['accountId' => $id, 'credentialVersion' => str_repeat('b', 64), 'login' => $login, 'password' => '003456', 'programs' => ['Курс <пример>']]; }
require dirname(__DIR__) . '/services/wordpress/ais-program-generator.php';
require dirname(__DIR__) . '/services/wordpress/ais-student-accounts.php';
check(!$requests && !$mails && !$users, 'Installation has no processing or mailing side effects');
$order = new FakeOrder(101, 'new@example.test'); $answers['101'] = [account('s1', 'new')];
$access = ais_pg_order_email_access($order, $order->email);
check(count($users) === 1 && $order->customer === 1 && $access[0]['shopAccess'], 'Guest gets one linked shop account');
check(password_verify('003456', $users[1]->user_pass), 'Generated AIS password works as native shop password');
check(!$mails, 'Rendering an order email does not send a registration email');
check(!str_contains(json_encode($meta), '003456') && !str_contains(json_encode($order->meta), '003456'), 'No plaintext credentials in metadata');
ais_pg_process_paid_enrollment(101);
check(count($mails) === 1 && $mails[0]['to'] === 'new@example.test', 'Exactly one registration instruction sent after paid provisioning');
foreach (['https://zifra-plus.ru/my-account/', 'https://edu-plus.ru/lms/', '003456', 'Отправить на проверку', 'Основное', 'Документы'] as $part) check(str_contains($mails[0]['body'], $part), 'Registration email contains both sites and instructions');
ais_sa_process_order($order); check(count($mails) === 1 && count($users) === 1, 'Repeated jobs do not recreate accounts or resend notices');
check(!apply_filters('woocommerce_email_enabled_customer_new_account', true, $users[1]), 'A delayed generic registration email is not sent after the common instruction');
$email = new class { public $id = 'customer_processing_order'; public function get_recipient() { return 'new@example.test'; } };
ob_start(); ais_pg_order_email_instructions($order, false, false, $email); $html = ob_get_clean();
check(str_contains($html, 'Курс &lt;пример&gt;') && str_contains($html, 'Интернет-магазин zifra-plus.ru'), 'Paid order email includes common access');
ob_start(); ais_pg_order_email_instructions($order, false, true, $email); $plain = ob_get_clean();
check(!str_contains($plain, '<strong>') && str_contains($plain, 'Пароль: 003456'), 'Plain email includes correct access');

$old_id = count($users)+1; $users[$old_id] = new WP_User($old_id, 'old-native', 'old@example.test');
$old_order = new FakeOrder(102, 'old@example.test', $old_id); $bound = ais_sa_prepare($old_order, [account('s2', 'old-common')]);
check(password_verify('old-password', $users[$old_id]->user_pass) && !$password_changes, 'Existing shop password preserved');
$error = new WP_Error('invalid_username');
check(ais_sa_authenticate($error, 'old-common', '003456') === $users[$old_id], 'Common alias works for existing customer');
check(ais_sa_authenticate($error, 'old@example.test', '003456') === $users[$old_id], 'Email also accepts common password');
check(ais_sa_authenticate($error, 'old-common', 'bad') === $error, 'Incorrect password denied');
check(ais_sa_authenticate($users[$old_id], 'old-native', 'old-password') === $users[$old_id], 'Normal successful login preserved');
$wpdb->attempts = 16;
check(ais_sa_authenticate($error, 'old-common', '003456')->code === 'ais_login_limit', 'Alias password attempts are throttled');
check(ais_sa_authenticate($users[$old_id], 'old-native', 'old-password')->code === 'ais_login_limit', 'Native generated-password login is also throttled');
$wpdb->attempts = 1;
$locked = new WP_Error('account_locked'); $before = count($requests);
check(ais_sa_authenticate($locked, 'old-common', '003456') === $locked && count($requests) === $before, 'Security plugin denials are preserved');
$offline = true; check(ais_sa_authenticate($error, 'old-common', '003456') === $error, 'Unavailable AIS fails closed for aliases'); $offline = false;
$admin_id = count($users)+1; $users[$admin_id] = new WP_User($admin_id, 'admin', 'admin@example.test'); $users[$admin_id]->roles = ['administrator'];
denied(fn() => ais_sa_prepare(new FakeOrder(103, 'admin@example.test', $admin_id), [account('s3', 'admin')]), 'Privileged users must never be linked');
update_user_meta($admin_id, '_ais_student_account', 's3'); update_user_meta($admin_id, '_ais_student_login', 'admin');
check(ais_sa_authenticate($error, 'admin', '003456') === $error, 'Common password cannot log into an administrator');
denied(fn() => ais_sa_prepare(new FakeOrder(104, 'foreign@example.test', $old_id), [account('s4', 'foreign')]), 'Order/customer email mismatch rejected');
denied(fn() => ais_sa_prepare(new FakeOrder(105, 'third@example.test'), [account('s5', 'old-native')]), 'Occupied native login rejected');
denied(fn() => ais_sa_prepare(new FakeOrder(106, 'third@example.test'), [account('s2', 'another')]), 'Owner cannot be linked to a second customer');
denied(fn() => ais_sa_prepare($old_order, [account('s9', 'old-common')]), 'Existing binding cannot be replaced');
denied(fn() => ais_sa_prepare($old_order, [account('s2', 'old-common'), account('s4', 'other')]), 'Ambiguous multi-person order rejected');
check(ais_sa_prepare(new FakeOrder(107, 'nonedu@example.test'), []) === [], 'Noneducational order unchanged');

$cart_ids = ['10']; $created = wc_create_new_customer('checkout@example.test', 'checkout', 'temporary');
check(get_user_meta($created, '_ais_student_registration_pending'), 'Eligible checkout defers generic registration notice');
$count = count($mails); $checkout = new FakeOrder(108, 'checkout@example.test', $created);
ais_sa_prepare($checkout, [account('s8', 'checkout.2')]); check(password_verify('003456', $users[$created]->user_pass), 'New checkout password unified');
ais_sa_prepare($checkout, [account('s8', 'checkout.2')]); check(count($password_changes) === 1, 'Native password set only once');
check(count($mails) === $count, 'Preparing a checkout binding does not send email');
$cart_ids = ['20']; wc_create_new_customer('webinar@example.test', 'webinar', 'original'); check(count($mails) === $count+1, 'Other product registration unchanged');
$offline = true; $failed_order = new FakeOrder(109, 'outage@example.test'); ais_pg_process_paid_enrollment(109);
check(!$failed_order->get_meta('_ais_enrollment_done') && $failed_order->get_meta('_ais_enrollment_error'), 'Worker does not mark failed binding complete');
echo "PASS: unified new/old customer access, role/recipient isolation, collisions, alias restrictions, one registration notice, no plaintext metadata, retries, noneducational checkout\n";

$offline = false; $cart_ids = [];
$existing_id = count($users) + 1; $users[$existing_id] = new WP_User($existing_id, 'existing-shop', 'existing@example.test', 'keep-this-password');
update_user_meta($existing_id, 'billing_first_name', 'Анна Петровна'); update_user_meta($existing_id, 'billing_last_name', 'Иванова');
update_user_meta($existing_id, '_ais_student_registration_pending', time());
$candidate = ['accountId' => 'existing-student', 'email' => 'existing@example.test', 'login' => 'existing-common', 'credentialVersion' => str_repeat('c',64), 'names' => ['Иванова Анна Петровна'], 'orderIds' => []];
$original_meta = $meta; $old_hash = $users[$existing_id]->user_pass; $mail_count = count($mails); $request_count = count($requests); $password_count = count($password_changes); $user_count = count($users);
$preview = ais_sa_existing_batch(['accounts' => [$candidate]]);
check($preview['results'][0]['status'] === 'ready' && $meta === $original_meta, 'Existing-account preview makes no changes');
$with_proof = $candidate + ['proof' => $preview['results'][0]['proof']];
$stale = ais_sa_existing_batch(['accounts' => [$candidate + ['proof' => str_repeat('0',64)]], 'apply' => true]);
check($stale['results'][0]['reason'] === 'changed_since_preview' && $meta === $original_meta, 'Stale/forged preview cannot apply');
$applied = ais_sa_existing_batch(['accounts' => [$with_proof], 'apply' => true]);
check($applied['results'][0]['status'] === 'linked' && !$applied['mailSent'] && !$applied['passwordsChanged'], 'Verified existing account linked without messages');
check($users[$existing_id]->user_pass === $old_hash && count($password_changes) === $password_count && count($users) === $user_count, 'Migration cannot create users or reset even a recently registered account password');
check(count($mails) === $mail_count && count($requests) === $request_count, 'No mail or enrollment RPC during migration');
check(ais_sa_existing_binding($users[$existing_id]), 'Existing cabinet can open without an order reference');
$existing_sso = ais_sa_cabinet_payload($users[$existing_id]); check($existing_sso['existingBinding'] && $existing_sso['orderId'] === '' && $existing_sso['accountId'] === $candidate['accountId'], 'Existing SSO is bound to the logged-in account without requiring a historical order');
denied(fn() => ais_sa_cabinet_payload($users[$admin_id]), 'Privileged users cannot use existing-customer SSO');
check(ais_sa_existing_batch(['accounts' => [$candidate], 'apply' => true])['results'][0]['status'] === 'unchanged', 'Migration is idempotent');
$users[$existing_id]->user_email = 'changed@example.test'; check(!ais_sa_existing_binding($users[$existing_id]), 'Changed shop email invalidates the old binding'); $users[$existing_id]->user_email = $candidate['email'];
$historical_order = new FakeOrder(110, $candidate['email'], $existing_id); $answers['110'] = [array_merge($candidate, ['password' => '003456', 'programs' => ['Старая программа']])];
ais_sa_process_order($historical_order); check(count($mails) === $mail_count, 'The existing registration instruction is suppressed on retries');
check(ais_sa_authenticate(new WP_Error('invalid_username'), 'existing-common', '003456') === $users[$existing_id], 'Existing common login works after migration');
check(ais_sa_existing_batch(['accounts' => [array_merge($candidate, ['email' => 'missing@example.test', 'accountId' => 'missing'])]])['results'][0]['reason'] === 'shop_account_missing', 'Missing shop account is not created');
check(ais_sa_existing_batch(['accounts' => [array_merge($candidate, ['email' => 'admin@example.test', 'accountId' => 'admin-student'])]])['results'][0]['reason'] === 'privileged_shop_account', 'Privileged existing account rejected');
$unknown_id = count($users)+1; $users[$unknown_id] = new WP_User($unknown_id, 'unconfirmed', 'unconfirmed@example.test');
$unknown = array_merge($candidate, ['email' => 'unconfirmed@example.test', 'accountId' => 'unconfirmed-student', 'login' => 'unconfirmed-common']);
check(ais_sa_existing_batch(['accounts' => [$unknown]])['results'][0]['reason'] === 'identity_unconfirmed', 'Email alone does not merge unrelated identities');
$proof_order = new FakeOrder(111, $unknown['email'], $unknown_id); $unknown['orderIds'] = ['111'];
$unknown_preview = ais_sa_existing_batch(['accounts' => [$unknown]])['results'][0]; check($unknown_preview['status'] === 'ready', 'Owned paid order confirms identity when profile names are missing');
$users[$unknown_id]->user_pass = password_hash('changed-during-preview', PASSWORD_DEFAULT);
check(ais_sa_existing_batch(['accounts' => [$unknown + ['proof' => $unknown_preview['proof']]], 'apply' => true])['results'][0]['reason'] === 'changed_since_preview', 'Changed native credentials require a fresh preview');
$duplicate_id = count($users)+1; $users[$duplicate_id] = new WP_User($duplicate_id, 'duplicate', $unknown['email']);
check(ais_sa_existing_batch(['accounts' => [$unknown]])['results'][0]['reason'] === 'duplicate_shop_email', 'Duplicate shop emails are not silently linked');
check(count($mails) === $mail_count && count($password_changes) === $password_count, 'No test migration sent mail or changed passwords');
echo "PASS: explicit existing-account migration, name/order identity, preview guard, duplicate/privileged isolation, no provisioning, no mail, preserved passwords, existing SSO binding\n";
