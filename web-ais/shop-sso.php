<?php
declare(strict_types=1);
define('AIS_GATEWAY_LIBRARY_ONLY', true);
require_once __DIR__ . '/gateway.php';

function ais_shop_sso_origin(string $stage, string $origin): bool {
    return $origin === ($stage === 'start' ? 'https://zifra-plus.ru' : 'https://edu-plus.ru');
}
function ais_shop_sso_ticket(string $token, bool $consume): array {
    $response = gateway_run_node('/api/auth/shop-sso-ticket', 'POST', [], json_encode(['token' => $token, 'consume' => $consume], JSON_THROW_ON_ERROR));
    $result = json_decode((string) ($response['body'] ?? ''), true);
    if ((int) ($response['status'] ?? 0) !== 200 || ($result['user']['role'] ?? '') !== 'student') {
        throw new RuntimeException('Переход устарел или недоступен. Откройте кабинет слушателя кнопкой в интернет-магазине ещё раз.');
    }
    return $result['user'];
}
function ais_shop_sso_switch_required(?array $current, array $target): bool {
    return $current !== null && (($current['role'] ?? '') !== 'student' || ($current['studentId'] ?? '') !== ($target['studentId'] ?? ''));
}
function ais_shop_sso_page(string $title, string $body, bool $auto = false): void {
    $nonce = bin2hex(random_bytes(16));
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: private, no-store, max-age=0');
    header('Referrer-Policy: same-origin');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header("Content-Security-Policy: default-src 'none'; style-src 'self' 'nonce-$nonce'; script-src 'nonce-$nonce'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    echo '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="referrer" content="same-origin"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</title><link rel="stylesheet" href="styles.css">';
    echo '<style nonce="' . $nonce . '">body{display:grid;place-items:center;min-height:100vh;padding:16px}.shop-entry{background:white;border:1px solid #d5e2df;border-radius:16px;width:min(620px,100%);padding:24px;box-sizing:border-box}.shop-entry h1{font-size:24px}.shop-entry form{margin:0}.modal-actions{flex-wrap:wrap}.shop-entry p{overflow-wrap:anywhere}</style><main class="shop-entry"><h1>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h1>' . $body . '</main>';
    if ($auto) echo '<script nonce="' . $nonce . '">document.querySelector("form").submit();</script>';
    echo '</html>';
}
if (defined('AIS_SHOP_SSO_LIBRARY_ONLY') && AIS_SHOP_SSO_LIBRARY_ONLY) return;
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) throw new RuntimeException('Откройте кабинет слушателя кнопкой в интернет-магазине.');
    $stage = (string) ($_POST['stage'] ?? 'start');
    if (!in_array($stage, ['start', 'local', 'confirm'], true) || !ais_shop_sso_origin($stage, (string) ($_SERVER['HTTP_ORIGIN'] ?? ''))) throw new RuntimeException('Источник перехода не подтверждён. Откройте кабинет из интернет-магазина.');
    if ($stage === 'start') {
        // Do not start/replace a PHP session on a cross-site POST: SameSite=Strict cookies
        // are only available after this same-origin continuation. Staff sessions survive.
        $token = (string) ($_POST['token'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/D', $token) || strlen($token) > 4096) throw new RuntimeException('Некорректный переход.');
        ais_shop_sso_page('Вход в кабинет слушателя', '<p>Подтверждаем переход из интернет-магазина…</p><form method="post" action="shop-sso.php"><input type="hidden" name="stage" value="local"><input type="hidden" name="token" value="' . htmlspecialchars($token, ENT_QUOTES, 'UTF-8') . '"><button class="primary-button" type="submit">Продолжить</button></form>', true);
        exit;
    }
    ais_auth_start_session();
    if ($stage === 'confirm') {
        $pending = $_SESSION['ais_shop_sso_pending'] ?? [];
        unset($_SESSION['ais_shop_sso_pending']);
        if (($pending['expires'] ?? 0) < time() || !is_string($_POST['confirmation'] ?? null)
            || !hash_equals((string) ($pending['confirmation'] ?? ''), $_POST['confirmation']) || empty($pending['token'])) throw new RuntimeException('Подтверждение устарело. Повторите переход из магазина.');
        $token = $pending['token'];
    } else {
        $token = (string) ($_POST['token'] ?? '');
        $user = ais_shop_sso_ticket($token, false);
        $current = ais_auth_current_user();
        if (ais_shop_sso_switch_required($current, $user)) {
            $confirmation = bin2hex(random_bytes(24));
            $_SESSION['ais_shop_sso_pending'] = ['token' => $token, 'confirmation' => $confirmation, 'expires' => time() + 120];
            ais_shop_sso_page('Сменить учётную запись?', '<p>Сейчас выполнен вход как <strong>' . htmlspecialchars((string) $current['login'], ENT_QUOTES, 'UTF-8') . '</strong>. Для открытия кабинета слушателя нужно войти как <strong>' . htmlspecialchars((string) $user['login'], ENT_QUOTES, 'UTF-8') . '</strong>.</p><form method="post" action="shop-sso.php"><input type="hidden" name="stage" value="confirm"><input type="hidden" name="confirmation" value="' . $confirmation . '"><div class="modal-actions"><button type="submit" class="primary-button">Войти как слушатель</button><a class="ghost-button" href="./">Отмена</a></div></form>');
            exit;
        }
    }
    $user = ais_shop_sso_ticket($token, true);
    ais_auth_login_student($user);
    unset($_SESSION['ais_shop_sso_pending']);
    ais_audit_try_append(['action' => 'Вход из интернет-магазина', 'area' => 'Авторизация', 'entityType' => 'user', 'entityId' => $user['id'], 'entityLabel' => $user['login']], $user);
    header('Cache-Control: private, no-store');
    header('Location: ./', true, 303);
} catch (Throwable $error) {
    http_response_code(403);
    ais_shop_sso_page('Не удалось открыть кабинет', '<p>' . htmlspecialchars($error instanceof RuntimeException ? $error->getMessage() : 'Повторите переход из интернет-магазина.', ENT_QUOTES, 'UTF-8') . '</p><a class="ghost-button" href="https://zifra-plus.ru/">Вернуться в интернет-магазин</a>');
}
