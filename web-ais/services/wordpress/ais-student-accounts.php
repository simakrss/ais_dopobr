<?php
/**
 * Plugin Name: АИС — единый кабинет покупателя и слушателя
 * Version: 1.0.0
 * Customer-only bridge. No historical orders or emails are processed on installation.
 */
defined('ABSPATH') || exit;

function ais_sa_rpc(array $payload, int $timeout = 20): array {
    $file = dirname(rtrim(ABSPATH, '/\\')) . '/ais-program-site.key';
    $key = is_readable($file) ? trim(file_get_contents($file)) : '';
    if (!preg_match('/^[a-f0-9]{64}$/D', $key)) throw new RuntimeException('Обмен с учебным центром не настроен.');
    $resource = '/api/student-enrollment/paid-order'; $stamp = (string) time(); $nonce = bin2hex(random_bytes(16)); $body = wp_json_encode($payload);
    $response = wp_remote_post('https://edu-plus.ru/lms' . $resource, ['timeout' => $timeout, 'redirection' => 0, 'sslverify' => true,
        'headers' => ['Content-Type' => 'application/json', 'X-AIS-Timestamp' => $stamp, 'X-AIS-Nonce' => $nonce,
            'X-AIS-Signature' => ais_pg_signature($key, 'POST', $resource, $stamp, $nonce, $body)], 'body' => $body]);
    if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) !== 200) throw new RuntimeException('Учебный центр временно недоступен. Повторите позже.');
    $result = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($result)) throw new RuntimeException('Не удалось подтвердить кабинет слушателя.');
    return $result;
}
function ais_sa_customer($user): bool {
    return $user instanceof WP_User && $user->exists() && $user->roles
        && !array_diff($user->roles, ['customer', 'subscriber'])
        && !user_can($user, 'manage_options') && !user_can($user, 'edit_users') && !user_can($user, 'edit_posts') && !is_super_admin($user->ID);
}
function ais_sa_locked(string $key, callable $operation) {
    global $wpdb;
    $name = 'ais-shop-' . substr(hash('sha256', $key), 0, 48);
    if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 5)', $name)) !== 1) throw new RuntimeException('Кабинет уже создаётся. Проверка будет повторена.');
    try { return $operation(); } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $name)); }
}
function ais_sa_prepare($order, array $accounts): array {
    if (!$accounts || !$order->is_paid() || (float) $order->get_total() <= 0 || $order->get_meta('_ais_student_payment_intent')) return $accounts;
    if (count($accounts) !== 1) throw new RuntimeException('В заказе несколько разных кабинетов слушателей. Требуется проверка учебного центра.');
    $account = $accounts[0]; $email = strtolower(trim($order->get_billing_email()));
    if (!is_email($email) || empty($account['accountId']) || !preg_match('/^[a-f0-9]{64}$/D', (string) ($account['credentialVersion'] ?? ''))) throw new RuntimeException('Не подтверждены данные кабинета слушателя.');
    return ais_sa_locked($email, function () use ($order, $account, $email) {
        $uid = (int) $order->get_customer_id();
        $user = $uid ? get_user_by('id', $uid) : get_user_by('email', $email);
        if ($user && (!ais_sa_customer($user) || strcasecmp($user->user_email, $email) !== 0)) throw new RuntimeException('Заказ не связан с обычной учётной записью покупателя.');
        $login_user = get_user_by('login', $account['login']);
        if ($login_user && (!$user || (int) $login_user->ID !== (int) $user->ID)) throw new RuntimeException('Логин кабинета уже занят другим покупателем. Требуется проверка учебного центра.');
        foreach (['_ais_student_account' => $account['accountId'], '_ais_student_login' => $account['login']] as $key => $value) {
            $linked = get_users(['meta_key' => $key, 'meta_value' => $value, 'number' => 2, 'fields' => 'ID']);
            if ($linked && (!$user || count($linked) !== 1 || (int) $linked[0] !== (int) $user->ID)) throw new RuntimeException('Кабинет уже связан с другим покупателем.');
        }
        $created = false;
        if (!$user) {
            // The visible common login can be an alias; WordPress itself restricts usernames.
            $wp_login = sanitize_user($account['login'], true);
            if ($wp_login !== $account['login']) $wp_login = 'ais_' . substr(hash('sha256', $account['accountId']), 0, 24);
            $GLOBALS['ais_sa_creating'] = true;
            try { $uid = wc_create_new_customer($email, $wp_login, $account['password']); }
            finally { unset($GLOBALS['ais_sa_creating']); }
            if (is_wp_error($uid)) throw new RuntimeException('Не удалось создать учётную запись покупателя.');
            $user = get_user_by('id', (int) $uid); $created = true;
        }
        if (!ais_sa_customer($user)) throw new RuntimeException('Недопустимая учётная запись покупателя.');
        $bound = (string) get_user_meta($user->ID, '_ais_student_account', true);
        if ($bound && $bound !== $account['accountId']) throw new RuntimeException('Покупатель связан с другим кабинетом слушателя.');
        // Only a newly created checkout account gets its native password replaced.
        // Existing accounts keep their original password; the AIS alias is verified online.
        if (!$bound && !$created && (int) get_user_meta($user->ID, '_ais_student_registration_pending', true) > time() - 3600
            && (int) $order->get_customer_id() === (int) $user->ID) wp_set_password($account['password'], $user->ID);
        update_user_meta($user->ID, '_ais_student_account', $account['accountId']);
        update_user_meta($user->ID, '_ais_student_login', $account['login']);
        update_user_meta($user->ID, '_ais_student_order', (string) $order->get_id());
        update_user_meta($user->ID, '_ais_student_version', $account['credentialVersion']);
        if (!(int) $order->get_customer_id()) { $order->set_customer_id($user->ID); $order->save(); }
        return [array_merge($account, ['shopAccess' => true, 'shopUserId' => (int) $user->ID])];
    });
}
function ais_sa_access_content(array $account, bool $plain = false): string {
    $shop = wc_get_page_permalink('myaccount');
    if ($plain) return "ДОСТУП В ИНТЕРНЕТ-МАГАЗИН И УЧЕБНЫЙ ЦЕНТР\nИнтернет-магазин: $shop\nУчебный центр: https://edu-plus.ru/lms/\nЛогин: " . $account['login'] . "\nПароль: " . $account['password'] . "\nЭти данные подходят для обоих сайтов. Прежний пароль существующего аккаунта магазина также продолжает работать.\n\nВ кабинете учебного центра заполните раздел «Основное», загрузите сканы в разделе «Документы» и нажмите «Отправить на проверку». Кнопка станет доступна после заполнения обязательных полей и загрузки необходимых документов. Перечень: https://zifra-plus.ru/edu_info/\nИз кабинета магазина можно открыть кабинет слушателя без повторного ввода пароля. Не передавайте пароль другим людям.\n";
    return '<h2>Доступ в интернет-магазин и учебный центр</h2><p><a href="' . esc_url($shop) . '">Интернет-магазин zifra-plus.ru</a><br><a href="https://edu-plus.ru/lms/">Учебный центр edu-plus.ru/lms</a></p><p>Логин: <strong>' . esc_html($account['login']) . '</strong><br>Пароль: <strong>' . esc_html($account['password']) . '</strong></p><p>Эти данные подходят для обоих сайтов. Прежний пароль существующего аккаунта магазина также продолжает работать.</p><p>В кабинете учебного центра заполните раздел <strong>«Основное»</strong>, загрузите сканы в разделе <strong>«Документы»</strong> и нажмите <strong>«Отправить на проверку»</strong>. Кнопка станет доступна после заполнения обязательных полей и загрузки необходимых документов. <a href="https://zifra-plus.ru/edu_info/">Перечень документов</a>.</p><p>Из кабинета магазина можно открыть кабинет слушателя без повторного ввода пароля. Не передавайте пароль другим людям.</p>';
}
function ais_sa_process_order($order): void {
    if ($order->get_meta('_ais_student_payment_intent')) return;
    $accounts = ais_pg_order_email_access($order, $order->get_billing_email(), true);
    foreach ($accounts as $account) {
        if (empty($account['shopAccess'])) throw new RuntimeException('Общий доступ в магазин и учебный центр пока не подготовлен.');
        ais_sa_locked('mail:' . $account['shopUserId'], function () use ($account) {
            $state = get_user_meta($account['shopUserId'], '_ais_student_access_notice', true);
            if (is_array($state) && ($state['version'] ?? '') === $account['credentialVersion'] && in_array($state['status'] ?? '', ['sent', 'sending'], true)) return;
            $user = get_user_by('id', $account['shopUserId']);
            if (!ais_sa_customer($user)) throw new RuntimeException('Получатель письма недоступен.');
            update_user_meta($user->ID, '_ais_student_access_notice', ['version' => $account['credentialVersion'], 'status' => 'sending', 'at' => time()]);
            $mailer = WC()->mailer();
            $sent = $mailer->send($user->user_email, 'Ваш доступ в интернет-магазин и учебный центр',
                $mailer->wrap_message('Личные кабинеты готовы', ais_sa_access_content($account)), ['Content-Type: text/html; charset=UTF-8']);
            update_user_meta($user->ID, '_ais_student_access_notice', ['version' => $account['credentialVersion'], 'status' => $sent ? 'sent' : 'failed', 'at' => time()]);
            if (!$sent) throw new RuntimeException('Письмо с общими данными доступа не отправлено. Попытка будет повторена.');
            update_user_meta($user->ID, '_ais_student_registration_handled', true);
            delete_user_meta($user->ID, '_ais_student_registration_pending');
        });
    }
}
function ais_sa_mark_created($uid): void {
    if (ais_pg_role() !== 'shop') return;
    $eligible = !empty($GLOBALS['ais_sa_creating']);
    if (!$eligible && function_exists('WC') && WC()->cart) {
        $ids = [];
        foreach (WC()->cart->get_cart() as $item) $ids[] = (string) ($item['product_id'] ?? '');
        if ($ids) try { $eligible = !empty(ais_sa_rpc(['shopAccountOperation' => 'eligible-products', 'productIds' => array_values(array_unique($ids))], 10)['productIds']); } catch (Throwable $error) { /* Ordinary registration still works during an AIS outage. */ }
    }
    if ($eligible) update_user_meta((int) $uid, '_ais_student_registration_pending', time());
}
add_action('woocommerce_created_customer', 'ais_sa_mark_created', 1, 1);
add_filter('woocommerce_email_enabled_customer_new_account', function ($enabled, $user) {
    return ais_pg_role() === 'shop' && ($user instanceof WP_User)
        && (get_user_meta($user->ID, '_ais_student_registration_pending', true) || get_user_meta($user->ID, '_ais_student_registration_handled', true)) ? false : $enabled;
}, 20, 2);

function ais_sa_login_limit($user, bool $success = false): bool {
    global $wpdb;
    $table = $wpdb->prefix . 'ais_student_login_limits';
    $login_key = hash('sha256', 'user:' . $user->ID);
    if ($success) { $wpdb->query($wpdb->prepare("DELETE FROM $table WHERE bucket_key=%s", $login_key)); return true; }
    if ($wpdb->query("CREATE TABLE IF NOT EXISTS $table (bucket_key CHAR(64) PRIMARY KEY, attempts INT NOT NULL, expires_at BIGINT NOT NULL)") === false) return false;
    $now = time(); $wpdb->query($wpdb->prepare("DELETE FROM $table WHERE expires_at < %d LIMIT 100", $now));
    $keys = [$login_key, hash('sha256', 'ip:' . (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'))];
    foreach ($keys as $index => $key) {
        if ($wpdb->query($wpdb->prepare("INSERT INTO $table (bucket_key,attempts,expires_at) VALUES (%s,1,%d) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<%d,1,attempts+1),expires_at=IF(expires_at<%d,VALUES(expires_at),expires_at)", $key, $now+900, $now, $now)) === false) return false;
        $attempts = $wpdb->get_var($wpdb->prepare("SELECT attempts FROM $table WHERE bucket_key=%s", $key));
        if ($attempts === null || (int) $attempts > ($index ? 100 : 15)) return false;
    }
    return true;
}
function ais_sa_authenticate($result, $login, $password) {
    if (ais_pg_role() !== 'shop' || !$login || !$password || strlen($login) > 256 || strlen($password) > 256) return $result;
    if (is_wp_error($result) && array_diff($result->get_error_codes(), ['invalid_username', 'invalid_email', 'incorrect_password'])) return $result;
    $user = $result instanceof WP_User ? $result : (is_email($login) ? get_user_by('email', $login) : get_user_by('login', $login));
    if (!$user) {
        $users = get_users(['meta_key' => '_ais_student_login', 'meta_value' => trim($login), 'number' => 2]);
        if (count($users) !== 1) return $result;
        $user = $users[0];
    }
    if (!ais_sa_customer($user)) return $result;
    $native = get_user_by('login', $login);
    if ($native && (int) $native->ID !== (int) $user->ID) return $result;
    $account = get_user_meta($user->ID, '_ais_student_account', true); $alias = get_user_meta($user->ID, '_ais_student_login', true);
    if (!$account || !$alias) return $result;
    if (!ais_sa_login_limit($user)) return new WP_Error('ais_login_limit', 'Слишком много попыток входа или проверка временно недоступна. Повторите через 15 минут.');
    if ($result instanceof WP_User) { ais_sa_login_limit($user, true); return $result; }
    // Honor WordPress account restrictions, including other authentication plugins.
    $allowed = apply_filters('wp_authenticate_user', $user, $password);
    if (is_wp_error($allowed)) return $allowed;
    try {
        $answer = ais_sa_rpc(['shopAccountOperation' => 'authenticate', 'shopUserId' => (string) $user->ID,
            'accountId' => $account, 'email' => $user->user_email, 'login' => $alias, 'password' => $password,
            'clientKey' => substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 80)], 15);
        if (!empty($answer['ok'])) { ais_sa_login_limit($user, true); return $user; }
        return $result;
    } catch (Throwable $error) { return $result; }
}
add_filter('authenticate', 'ais_sa_authenticate', 25, 3);

function ais_sa_account_button(): void {
    $user = wp_get_current_user();
    if (ais_pg_role() !== 'shop' || !ais_sa_customer($user) || !get_user_meta($user->ID, '_ais_student_account', true)) return;
    echo '<p><a class="button" target="_blank" rel="noopener" href="' . esc_url(wp_nonce_url(admin_url('admin-post.php?action=ais_student_cabinet'), 'ais_student_cabinet')) . '">Открыть кабинет слушателя ↗</a></p>';
}
add_action('woocommerce_account_dashboard', 'ais_sa_account_button', 5);
function ais_sa_open_cabinet(): void {
    try {
        if (ais_pg_role() !== 'shop' || !is_user_logged_in()) throw new RuntimeException('Войдите в интернет-магазин.');
        check_admin_referer('ais_student_cabinet'); $user = wp_get_current_user();
        if (!ais_sa_customer($user)) throw new RuntimeException('Переход доступен только из кабинета покупателя.');
        $account = (string) get_user_meta($user->ID, '_ais_student_account', true);
        $order = wc_get_order((int) get_user_meta($user->ID, '_ais_student_order', true));
        if (!$account || !$order || (int) $order->get_customer_id() !== (int) $user->ID || strcasecmp($order->get_billing_email(), $user->user_email) !== 0 || !$order->is_paid()) throw new RuntimeException('Не найден оплаченный заказ образовательной программы.');
        $ticket = ais_sa_rpc(['shopAccountOperation' => 'sso', 'shopUserId' => (string) $user->ID, 'accountId' => $account,
            'orderId' => (string) $order->get_id(), 'email' => $user->user_email]);
        if (empty($ticket['ok']) || ($ticket['action'] ?? '') !== 'https://edu-plus.ru/lms/shop-sso.php' || !preg_match('/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/D', (string) ($ticket['token'] ?? ''))) throw new RuntimeException('Не удалось подтвердить переход.');
        nocache_headers(); header('Referrer-Policy: same-origin'); header('X-Frame-Options: DENY');
        $nonce = bin2hex(random_bytes(16));
        header("Content-Security-Policy: default-src 'none'; script-src 'nonce-$nonce'; form-action https://edu-plus.ru; base-uri 'none'; frame-ancestors 'none'");
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="referrer" content="same-origin"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход в учебный центр</title><form method="post" action="https://edu-plus.ru/lms/shop-sso.php"><input type="hidden" name="token" value="' . esc_attr($ticket['token']) . '"><button type="submit">Открыть кабинет слушателя</button></form><script nonce="' . $nonce . '">document.querySelector("form").submit();</script></html>';
    } catch (Throwable $error) { wp_die(esc_html($error->getMessage()), 'Кабинет слушателя', ['response' => 403, 'back_link' => true]); }
    exit;
}
add_action('admin_post_ais_student_cabinet', 'ais_sa_open_cabinet');
add_action('admin_post_nopriv_ais_student_cabinet', function () { auth_redirect(); });
add_action('rest_api_init', function () {
    register_rest_route('ais-program-sites/v1', '/student-account-logins', ['methods' => 'POST', 'permission_callback' => 'ais_pg_permission', 'callback' => function ($request) {
        if (ais_pg_role() !== 'shop') return ais_pg_error('Недоступно.', 403);
        $email = (string) ($request->get_json_params()['email'] ?? '');
        if (!is_email($email)) return ais_pg_error('Некорректный email.');
        $base = preg_replace('/[^\p{L}\p{N}._+\-]/u', '_', explode('@', strtolower(trim($email)))[0]);
        $base = mb_substr($base, 0, 56, 'UTF-8');
        global $wpdb; $pattern = $wpdb->esc_like($base) . '%';
        $values = $wpdb->get_col($wpdb->prepare("SELECT user_login FROM {$wpdb->users} WHERE user_login LIKE %s UNION SELECT meta_value FROM {$wpdb->usermeta} WHERE meta_key='_ais_student_login' AND meta_value LIKE %s LIMIT 2000", $pattern, $pattern));
        if (count($values) >= 2000) return ais_pg_error('Слишком много совпадений логина.', 409);
        return ['reserved' => array_values($values), 'ok' => true];
    }]);
});
