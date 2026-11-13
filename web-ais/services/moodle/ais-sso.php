<?php
declare(strict_types=1);

function ais_sso_assertion(string $token, string $key, int $now): array {
    if (strlen($token) > 4096 || !preg_match('/^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/D', $token, $parts)
        || !preg_match('/^[a-f0-9]{64}$/D', $key) || !hash_equals(hash_hmac('sha256', $parts[1], $key), $parts[2])) {
        throw new RuntimeException('Недействительный запрос входа. Откройте СДО из кабинета слушателя заново.');
    }
    $payload = json_decode((string) base64_decode(strtr($parts[1], '-_', '+/'), true), true);
    if (!is_array($payload) || ($payload['iss'] ?? '') !== 'ais-dopobr' || ($payload['aud'] ?? '') !== 'https://portal.edu-plus.ru'
        || !is_int($payload['exp'] ?? null) || $payload['exp'] < $now || $payload['exp'] > $now + 90
        || !preg_match('/^[a-f0-9]{48}$/D', (string) ($payload['nonce'] ?? ''))
        || empty($payload['username']) || strlen((string) $payload['username']) > 160 || empty($payload['studentId'])) {
        throw new RuntimeException('Ссылка для входа устарела. Откройте СДО из кабинета слушателя заново.');
    }
    return $payload;
}

function ais_sso_origin_allowed(string $origin): bool {
    return $origin === 'https://edu-plus.ru' || (bool) preg_match('~^http://(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$~D', $origin);
}

function ais_sso_pending(array $pending, string $request, int $userid, int $now): array {
    if (empty($pending['request']) || !hash_equals($pending['request'], $request)
        || ($pending['userid'] ?? null) !== $userid || ($pending['expires'] ?? 0) < $now || empty($pending['claim'])) {
        throw new RuntimeException('Подтверждение устарело. Откройте СДО из кабинета слушателя заново.');
    }
    return $pending['claim'];
}

function ais_sso_resume_token(array $claim, string $key, int $now): string {
    // Issued only after a session-bound confirmation. The old assertion has already
    // been consumed; this one-use POST handoff starts a fresh session after logout.
    $claim['nonce'] = bin2hex(random_bytes(24));
    $claim['exp'] = $now + 60;
    $payload = rtrim(strtr(base64_encode(json_encode($claim, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
    return $payload . '.' . hash_hmac('sha256', $payload, $key);
}

function ais_sso_page(string $title, string $content): void {
    header('Content-Type: text/html; charset=utf-8');
    // no-referrer turns Origin into "null" on browser form POSTs, including
    // confirmation and logout handoff. Keep same-origin forms verifiable while
    // withholding the referrer from external sites; tokens stay in POST bodies.
    header('Referrer-Policy: same-origin');
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
        . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</title><style>body{margin:0;background:#f2f6f4;color:#213b37;font:16px/1.6 system-ui,sans-serif}main{max-width:560px;margin:8vh auto;padding:28px;background:white;border:1px solid #d6e1dc;border-radius:14px}h1{font-size:24px}form{display:flex;gap:12px;flex-wrap:wrap}button{border:1px solid #ccd9d5;border-radius:8px;padding:12px 18px;font:inherit;cursor:pointer;background:white}button[value="yes"],button[type="submit"]{background:#087c74;color:white}@media(max-width:620px){main{margin:20px;padding:20px}}</style></head><body><main><h1>'
        . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h1>' . $content . '</main></body></html>';
}

if (defined('AIS_SSO_LIBRARY_ONLY')) return;
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
try {
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $confirmation = isset($_POST['decision']);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST'
        || ($confirmation ? $origin !== 'https://portal.edu-plus.ru' : !ais_sso_origin_allowed($origin) && $origin !== 'https://portal.edu-plus.ru')) {
        throw new RuntimeException('Откройте СДО кнопкой в личном кабинете слушателя.');
    }
    $key = trim((string) @file_get_contents(dirname(__DIR__) . '/ais-sso.key'));
    $claim = $confirmation ? null : ais_sso_assertion((string) ($_POST['token'] ?? ''), $key, time());
    require_once __DIR__ . '/config.php';
    require_once $CFG->libdir . '/authlib.php';
    if (rtrim($CFG->wwwroot, '/') !== 'https://portal.edu-plus.ru') throw new RuntimeException('Адрес СДО не соответствует запросу.');
    if ($confirmation) {
        require_sesskey();
        $claim = ais_sso_pending((array) ($SESSION->ais_sso_pending ?? []), (string) ($_POST['request'] ?? ''), (int) $USER->id, time());
        unset($SESSION->ais_sso_pending);
        if (($_POST['decision'] ?? '') === 'no') { redirect(new moodle_url('/my/courses.php')); exit; }
        if (($_POST['decision'] ?? '') !== 'yes') throw new RuntimeException('Подтвердите смену учётной записи.');
    }
    $user = get_complete_user_data('username', $claim['username'], $CFG->mnet_localhost_id);
    if (!$user || $user->deleted || $user->suspended || !$user->confirmed || isguestuser($user) || is_siteadmin($user)
        || $user->auth === 'nologin' || !is_enabled_auth($user->auth)) {
        throw new RuntimeException('Учётная запись СДО недоступна. Обратитесь в учебный центр.');
    }
    if (!empty($claim['email']) && core_text::strtolower(trim($user->email)) !== core_text::strtolower(trim($claim['email']))) {
        throw new RuntimeException('Email в СДО отличается от карточки слушателя. Обратитесь в учебный центр.');
    }
    if (!$confirmation) {
        $lock = \core\lock\lock_config::get_lock_factory('local_ais_sso')->get_lock($claim['nonce'], 5);
        if (!$lock) throw new RuntimeException('Вход уже выполняется. Повторите позже.');
        try {
            $value = hash('sha256', $claim['nonce']);
            if ($DB->record_exists('user_private_key', ['script' => 'local_ais_sso', 'value' => $value])) {
                throw new RuntimeException('Запрос входа уже использован. Нажмите «Открыть СДО» заново.');
            }
            $DB->insert_record('user_private_key', (object) ['script' => 'local_ais_sso', 'value' => $value,
                'userid' => $user->id, 'instance' => null, 'iprestriction' => null, 'validuntil' => $claim['exp'] + 300, 'timecreated' => time()]);
            $DB->delete_records_select('user_private_key', 'script = ? AND validuntil < ?', ['local_ais_sso', time() - 600]);
        } finally { $lock->release(); }
    }
    if (isloggedin() && !isguestuser() && (int) $USER->id !== (int) $user->id) {
        if (!$confirmation) {
            $request = bin2hex(random_bytes(24));
            $SESSION->ais_sso_pending = ['request' => $request, 'userid' => (int) $USER->id, 'claim' => $claim, 'expires' => time() + 180];
            $escape = fn($value) => htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
            ais_sso_page('Сменить учётную запись СДО?', '<p>Сейчас выполнен вход как <strong>' . $escape($USER->username)
                . '</strong>. Для перехода из кабинета слушателя нужно выйти из этой учётной записи и войти как <strong>' . $escape($user->username)
                . '</strong>.</p><p>После входа откроется раздел «Мои курсы».</p><form method="post" action="/ais-sso.php"><input type="hidden" name="request" value="' . $request
                . '"><input type="hidden" name="sesskey" value="' . $escape(sesskey()) . '"><button name="decision" value="yes">Выйти и войти как слушатель</button><button name="decision" value="no">Отмена</button></form>');
            exit;
        }
        $resume = ais_sso_resume_token($claim, $key, time());
        require_logout();
        // Moodle closes the PHP session on logout. Continue in a new POST request,
        // never call complete_user_login against the terminated session.
        ais_sso_page('Вход в СДО', '<p>Открываем раздел «Мои курсы»…</p><form method="post" action="/ais-sso.php" id="ais-resume"><input type="hidden" name="token" value="'
            . htmlspecialchars($resume, ENT_QUOTES, 'UTF-8') . '"><button type="submit">Продолжить вход</button></form><script>document.getElementById("ais-resume").submit();</script>');
        exit;
    }
    if (!isloggedin() || isguestuser() || (int) $USER->id !== (int) $user->id) {
        complete_user_login($user);
        \core\session\manager::apply_concurrent_login_limit($user->id, session_id());
    }
    redirect(new moodle_url('/my/courses.php'));
} catch (Throwable $error) {
    http_response_code(403);
    // Database/session errors must not disclose Moodle configuration or internal paths.
    $safe = $error instanceof RuntimeException && get_class($error) === RuntimeException::class;
    ais_sso_page('Не удалось открыть СДО', '<p>' . htmlspecialchars($safe ? $error->getMessage() : 'Повторите переход из кабинета слушателя. Если ошибка повторяется, обратитесь в учебный центр.', ENT_QUOTES, 'UTF-8') . '</p>');
}
