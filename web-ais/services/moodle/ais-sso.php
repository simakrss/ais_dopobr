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

if (defined('AIS_SSO_LIBRARY_ONLY')) return;
header('Cache-Control: private, no-store');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !ais_sso_origin_allowed((string) ($_SERVER['HTTP_ORIGIN'] ?? ''))) {
        throw new RuntimeException('Откройте СДО кнопкой в личном кабинете слушателя.');
    }
    $key = trim((string) @file_get_contents(dirname(__DIR__) . '/ais-sso.key'));
    $claim = ais_sso_assertion((string) ($_POST['token'] ?? ''), $key, time());
    require_once __DIR__ . '/config.php';
    require_once $CFG->libdir . '/authlib.php';
    if (rtrim($CFG->wwwroot, '/') !== 'https://portal.edu-plus.ru') throw new RuntimeException('Адрес СДО не соответствует запросу.');
    $user = get_complete_user_data('username', $claim['username'], $CFG->mnet_localhost_id);
    if (!$user || $user->deleted || $user->suspended || !$user->confirmed || isguestuser($user) || is_siteadmin($user)
        || $user->auth === 'nologin' || !is_enabled_auth($user->auth)) {
        throw new RuntimeException('Учётная запись СДО недоступна. Обратитесь в учебный центр.');
    }
    if (!empty($claim['email']) && core_text::strtolower(trim($user->email)) !== core_text::strtolower(trim($claim['email']))) {
        throw new RuntimeException('Email в СДО отличается от карточки слушателя. Обратитесь в учебный центр.');
    }
    $lock = \core\lock\lock_config::get_lock_factory('local_ais_sso')->get_lock($claim['nonce'], 5);
    if (!$lock) throw new RuntimeException('Вход уже выполняется. Повторите позже.');
    try {
        $value = hash('sha256', $claim['nonce']);
        if ($DB->record_exists('user_private_key', ['script' => 'local_ais_sso', 'value' => $value])) {
            throw new RuntimeException('Запрос входа уже использован. Нажмите «Открыть СДО» заново.');
        }
        $DB->insert_record('user_private_key', (object) ['script' => 'local_ais_sso', 'value' => $value,
            'userid' => $user->id, 'instance' => null, 'iprestriction' => null, 'validuntil' => $claim['exp'] + 120, 'timecreated' => time()]);
        $DB->delete_records_select('user_private_key', 'script = ? AND validuntil < ?', ['local_ais_sso', time() - 600]);
    } finally { $lock->release(); }
    if (isloggedin() && !isguestuser() && (int) $USER->id !== (int) $user->id) {
        throw new RuntimeException('В этом браузере СДО открыта под другой учётной записью. Выйдите из неё и повторите переход.');
    }
    complete_user_login($user);
    \core\session\manager::apply_concurrent_login_limit($user->id, session_id());
    redirect(new moodle_url('/my/'));
} catch (Throwable $error) {
    http_response_code(403);
    header('Content-Type: text/html; charset=utf-8');
    // Database/session errors must not disclose Moodle configuration or internal paths.
    $safe = $error instanceof RuntimeException && get_class($error) === RuntimeException::class;
    echo '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Вход в СДО</title><h1>Не удалось открыть СДО</h1><p>'
        . htmlspecialchars($safe ? $error->getMessage() : 'Повторите переход из кабинета слушателя. Если ошибка повторяется, обратитесь в учебный центр.', ENT_QUOTES, 'UTF-8') . '</p></html>';
}
