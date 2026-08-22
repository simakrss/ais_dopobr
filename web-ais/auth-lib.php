<?php

declare(strict_types=1);

const AIS_AUTH_SESSION_NAME = 'AIS_SESSION';
const AIS_AUTH_PASSWORD_ITERATIONS = 210000;
const AIS_AUTH_SESSION_TTL_SECONDS = 12 * 60 * 60;

function ais_auth_storage_root(): string
{
    $parent = dirname(__DIR__);
    $root = basename($parent) === 'lms-runtime' ? $parent : __DIR__ . '/storage';
    if (!is_dir($root) && !mkdir($root, 0700, true) && !is_dir($root)) {
        throw new RuntimeException('Не удалось подготовить хранилище пользователей.');
    }
    return $root;
}

function ais_auth_users_path(): string
{
    return ais_auth_storage_root() . '/users.json';
}

function ais_auth_sessions_path(): string
{
    $path = ais_auth_storage_root() . '/php-sessions';
    if (!is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) {
        throw new RuntimeException('Не удалось подготовить хранилище сессий.');
    }
    return $path;
}

function ais_auth_base_path(): string
{
    $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/'));
    $directory = rtrim(dirname($script), '/');
    return ($directory === '' || $directory === '.') ? '/' : $directory . '/';
}

function ais_auth_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.gc_maxlifetime', (string) AIS_AUTH_SESSION_TTL_SECONDS);
    session_name(AIS_AUTH_SESSION_NAME);
    session_save_path(ais_auth_sessions_path());
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => ais_auth_base_path(),
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

function ais_auth_base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function ais_auth_base64url_decode(string $value): string|false
{
    $padding = (4 - strlen($value) % 4) % 4;
    return base64_decode(strtr($value . str_repeat('=', $padding), '-_', '+/'), true);
}

function ais_auth_hash_password(string $password): string
{
    $salt = random_bytes(18);
    $hash = hash_pbkdf2('sha256', $password, $salt, AIS_AUTH_PASSWORD_ITERATIONS, 32, true);
    return implode('$', [
        'pbkdf2_sha256',
        (string) AIS_AUTH_PASSWORD_ITERATIONS,
        ais_auth_base64url_encode($salt),
        ais_auth_base64url_encode($hash),
    ]);
}

function ais_auth_verify_password(string $password, string $encoded): bool
{
    $parts = explode('$', $encoded);
    if (count($parts) !== 4 || $parts[0] !== 'pbkdf2_sha256') {
        return false;
    }
    $iterations = (int) $parts[1];
    $salt = ais_auth_base64url_decode($parts[2]);
    $expected = ais_auth_base64url_decode($parts[3]);
    if ($iterations < 100000 || $iterations > 1000000 || $salt === false || $expected === false) {
        return false;
    }
    $actual = hash_pbkdf2('sha256', $password, $salt, $iterations, strlen($expected), true);
    return hash_equals($expected, $actual);
}

function ais_auth_default_users(): array
{
    $now = gmdate('c');
    $adminPassword = trim((string) getenv('AIS_INITIAL_ADMIN_PASSWORD'));
    if (mb_strlen($adminPassword, 'UTF-8') < 12) {
        throw new RuntimeException(
            'Для первичного запуска задайте AIS_INITIAL_ADMIN_PASSWORD длиной не менее 12 символов.'
        );
    }
    $definitions = [
        ['login' => 'admin', 'name' => 'Администратор', 'role' => 'admin', 'password' => $adminPassword],
        ['login' => 'simak.varvara', 'name' => 'Симак Варвара', 'role' => 'manager', 'password' => '123'],
        ['login' => 'simak.yuriy', 'name' => 'Симак Юрий', 'role' => 'manager', 'password' => '123'],
    ];
    return array_map(static fn (array $item): array => [
        'id' => bin2hex(random_bytes(12)),
        'login' => $item['login'],
        'name' => $item['name'],
        'role' => $item['role'],
        'status' => 'active',
        'email' => '',
        'phone' => '',
        'passwordHash' => ais_auth_hash_password($item['password']),
        'createdAt' => $now,
        'updatedAt' => $now,
        'lastLoginAt' => '',
    ], $definitions);
}

function ais_auth_write_users(array $users): void
{
    $path = ais_auth_users_path();
    $temporary = $path . '.tmp-' . bin2hex(random_bytes(6));
    $payload = json_encode(
        ['version' => 1, 'users' => array_values($users)],
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    if ($payload === false || file_put_contents($temporary, $payload . "\n", LOCK_EX) === false) {
        throw new RuntimeException('Не удалось сохранить пользователей.');
    }
    @chmod($temporary, 0600);
    if (!rename($temporary, $path)) {
        @unlink($temporary);
        throw new RuntimeException('Не удалось обновить пользователей.');
    }
}

function ais_auth_load_users(): array
{
    $path = ais_auth_users_path();
    if (!is_file($path)) {
        $users = ais_auth_default_users();
        ais_auth_write_users($users);
        return $users;
    }
    $decoded = json_decode((string) file_get_contents($path), true);
    $users = is_array($decoded['users'] ?? null) ? $decoded['users'] : [];
    if ($users === []) {
        throw new RuntimeException('Список пользователей пуст или повреждён.');
    }
    return array_values(array_filter($users, 'is_array'));
}

function ais_auth_normalize_login(string $login): string
{
    return mb_strtolower(trim($login), 'UTF-8');
}

function ais_auth_validate_login(string $login): string
{
    $value = ais_auth_normalize_login($login);
    if (!preg_match('/^[\p{L}\p{N}._-]{3,64}$/u', $value)) {
        throw new InvalidArgumentException('Логин должен содержать от 3 до 64 букв, цифр, точек, дефисов или знаков подчёркивания.');
    }
    return $value;
}

function ais_auth_public_user(array $user): array
{
    return [
        'id' => (string) ($user['id'] ?? ''),
        'login' => (string) ($user['login'] ?? ''),
        'name' => (string) ($user['name'] ?? ''),
        'role' => (string) ($user['role'] ?? 'manager'),
        'status' => (string) ($user['status'] ?? 'blocked'),
        'email' => (string) ($user['email'] ?? ''),
        'phone' => (string) ($user['phone'] ?? ''),
        'employeeId' => (string) ($user['employeeId'] ?? ''),
        'createdAt' => (string) ($user['createdAt'] ?? ''),
        'updatedAt' => (string) ($user['updatedAt'] ?? ''),
        'lastLoginAt' => (string) ($user['lastLoginAt'] ?? ''),
    ];
}

function ais_auth_find_user(array $users, string $idOrLogin): ?array
{
    $needle = ais_auth_normalize_login($idOrLogin);
    foreach ($users as $user) {
        if ((string) ($user['id'] ?? '') === $idOrLogin
            || ais_auth_normalize_login((string) ($user['login'] ?? '')) === $needle) {
            return $user;
        }
    }
    return null;
}

function ais_auth_current_user(): ?array
{
    ais_auth_start_session();
    $partner = is_array($_SESSION['ais_partner'] ?? null) ? $_SESSION['ais_partner'] : null;
    if ($partner !== null) {
        $expiresAt = (int) ($_SESSION['ais_expires_at'] ?? 0);
        if ($expiresAt <= time()) {
            ais_auth_logout();
            return null;
        }
        return ais_auth_public_user([
            ...$partner,
            'role' => 'partner',
            'status' => 'active',
        ]);
    }
    $userId = (string) ($_SESSION['ais_user_id'] ?? '');
    if ($userId === '') {
        return null;
    }
    $expiresAt = (int) ($_SESSION['ais_expires_at'] ?? 0);
    if ($expiresAt <= 0) {
        $expiresAt = time() + AIS_AUTH_SESSION_TTL_SECONDS;
        $_SESSION['ais_expires_at'] = $expiresAt;
    }
    if ($expiresAt <= time()) {
        ais_auth_logout();
        return null;
    }
    $user = ais_auth_find_user(ais_auth_load_users(), $userId);
    if (!$user || (string) ($user['status'] ?? '') !== 'active') {
        unset($_SESSION['ais_user_id']);
        return null;
    }
    return ais_auth_public_user($user);
}

function ais_auth_session_expires_at_ms(): int
{
    ais_auth_start_session();
    return max(0, (int) ($_SESSION['ais_expires_at'] ?? 0)) * 1000;
}

function ais_auth_login(string $login, string $password): ?array
{
    ais_auth_start_session();
    $users = ais_auth_load_users();
    $normalized = ais_auth_normalize_login($login);
    $matchIndex = null;
    foreach ($users as $index => $user) {
        if (ais_auth_normalize_login((string) ($user['login'] ?? '')) === $normalized) {
            $matchIndex = $index;
            break;
        }
    }
    if ($matchIndex === null
        || (string) ($users[$matchIndex]['status'] ?? '') !== 'active'
        || !ais_auth_verify_password($password, (string) ($users[$matchIndex]['passwordHash'] ?? ''))) {
        usleep(250000);
        return null;
    }
    $users[$matchIndex]['lastLoginAt'] = gmdate('c');
    $users[$matchIndex]['updatedAt'] = (string) ($users[$matchIndex]['updatedAt'] ?? gmdate('c'));
    ais_auth_write_users($users);
    session_regenerate_id(true);
    unset($_SESSION['ais_partner']);
    $_SESSION['ais_user_id'] = (string) $users[$matchIndex]['id'];
    $_SESSION['ais_expires_at'] = time() + AIS_AUTH_SESSION_TTL_SECONDS;
    return ais_auth_public_user($users[$matchIndex]);
}

function ais_auth_login_partner(array $employee): array
{
    ais_auth_start_session();
    $employeeId = trim((string) ($employee['id'] ?? ''));
    $login = trim((string) ($employee['login'] ?? ''));
    $name = trim((string) ($employee['name'] ?? ''));
    if ($employeeId === '' || $login === '' || $name === '') {
        throw new InvalidArgumentException('Карточка партнёра заполнена не полностью.');
    }
    $now = gmdate('c');
    $partner = [
        'id' => 'partner:' . $employeeId,
        'employeeId' => $employeeId,
        'login' => mb_substr($login, 0, 160, 'UTF-8'),
        'name' => mb_substr($name, 0, 240, 'UTF-8'),
        'role' => 'partner',
        'status' => 'active',
        'email' => mb_substr(trim((string) ($employee['email'] ?? '')), 0, 160, 'UTF-8'),
        'phone' => mb_substr(trim((string) ($employee['phone'] ?? '')), 0, 40, 'UTF-8'),
        'createdAt' => $now,
        'updatedAt' => $now,
        'lastLoginAt' => $now,
    ];
    session_regenerate_id(true);
    unset($_SESSION['ais_user_id']);
    $_SESSION['ais_partner'] = $partner;
    $_SESSION['ais_expires_at'] = time() + AIS_AUTH_SESSION_TTL_SECONDS;
    return ais_auth_public_user($partner);
}

function ais_auth_logout(): void
{
    ais_auth_start_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        $basePath = ais_auth_base_path();
        $cookiePaths = array_values(array_unique(array_filter([
            (string) ($params['path'] ?? ''),
            $basePath,
            rtrim($basePath, '/'),
        ])));
        foreach ($cookiePaths as $cookiePath) {
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $cookiePath,
                'domain' => $params['domain'],
                'secure' => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => 'Strict',
            ]);
        }
    }
    session_destroy();
}

function ais_auth_validate_email(string $email): string
{
    $value = trim($email);
    if ($value !== '' && filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
        throw new InvalidArgumentException('Укажите корректный email.');
    }
    return mb_substr($value, 0, 160, 'UTF-8');
}

function ais_auth_validate_phone(string $phone): string
{
    $value = trim($phone);
    if (mb_strlen($value, 'UTF-8') > 40) {
        throw new InvalidArgumentException('Номер телефона слишком длинный.');
    }
    return $value;
}

function ais_auth_update_profile(string $userId, string $email, string $phone): array
{
    $users = ais_auth_load_users();
    foreach ($users as $index => $user) {
        if ((string) ($user['id'] ?? '') !== $userId) {
            continue;
        }
        $users[$index]['email'] = ais_auth_validate_email($email);
        $users[$index]['phone'] = ais_auth_validate_phone($phone);
        $users[$index]['updatedAt'] = gmdate('c');
        ais_auth_write_users($users);
        return ais_auth_public_user($users[$index]);
    }
    throw new RuntimeException('Пользователь не найден.');
}

function ais_auth_change_password(string $userId, string $currentPassword, string $newPassword): void
{
    if (mb_strlen($newPassword, 'UTF-8') < 6) {
        throw new InvalidArgumentException('Новый пароль должен содержать не менее 6 символов.');
    }
    $users = ais_auth_load_users();
    foreach ($users as $index => $user) {
        if ((string) ($user['id'] ?? '') !== $userId) {
            continue;
        }
        if (!ais_auth_verify_password($currentPassword, (string) ($user['passwordHash'] ?? ''))) {
            throw new InvalidArgumentException('Текущий пароль указан неверно.');
        }
        $users[$index]['passwordHash'] = ais_auth_hash_password($newPassword);
        $users[$index]['updatedAt'] = gmdate('c');
        ais_auth_write_users($users);
        session_regenerate_id(true);
        $_SESSION['ais_user_id'] = $userId;
        return;
    }
    throw new RuntimeException('Пользователь не найден.');
}

function ais_auth_count_active_admins(array $users): int
{
    return count(array_filter($users, static fn (array $user): bool => (
        (string) ($user['role'] ?? '') === 'admin'
        && (string) ($user['status'] ?? '') === 'active'
    )));
}

function ais_auth_admin_save_user(array $payload, string $currentUserId): array
{
    $users = ais_auth_load_users();
    $id = trim((string) ($payload['id'] ?? ''));
    $login = ais_auth_validate_login((string) ($payload['login'] ?? ''));
    $name = trim((string) ($payload['name'] ?? ''));
    $role = (string) ($payload['role'] ?? 'manager');
    $status = (string) ($payload['status'] ?? 'active');
    $password = (string) ($payload['password'] ?? '');
    if ($name === '' || mb_strlen($name, 'UTF-8') > 120) {
        throw new InvalidArgumentException('Укажите имя пользователя.');
    }
    if (!in_array($role, ['admin', 'manager'], true)) {
        throw new InvalidArgumentException('Выбрана неизвестная роль.');
    }
    if (!in_array($status, ['active', 'blocked'], true)) {
        throw new InvalidArgumentException('Выбран неизвестный статус.');
    }
    foreach ($users as $user) {
        if ((string) ($user['id'] ?? '') !== $id
            && ais_auth_normalize_login((string) ($user['login'] ?? '')) === $login) {
            throw new InvalidArgumentException('Пользователь с таким логином уже существует.');
        }
    }
    $now = gmdate('c');
    $index = null;
    foreach ($users as $userIndex => $user) {
        if ((string) ($user['id'] ?? '') === $id) {
            $index = $userIndex;
            break;
        }
    }
    if ($index === null) {
        if ($password === '') {
            $password = $role === 'manager' ? '123' : '';
        }
        if (mb_strlen($password, 'UTF-8') < 3) {
            throw new InvalidArgumentException('Для новой учётной записи укажите пароль.');
        }
        $users[] = [
            'id' => bin2hex(random_bytes(12)),
            'login' => $login,
            'name' => $name,
            'role' => $role,
            'status' => $status,
            'email' => ais_auth_validate_email((string) ($payload['email'] ?? '')),
            'phone' => ais_auth_validate_phone((string) ($payload['phone'] ?? '')),
            'passwordHash' => ais_auth_hash_password($password),
            'createdAt' => $now,
            'updatedAt' => $now,
            'lastLoginAt' => '',
        ];
        ais_auth_write_users($users);
        return ais_auth_public_user($users[array_key_last($users)]);
    }
    $previous = $users[$index];
    if ((string) ($previous['id'] ?? '') === $currentUserId && ($role !== 'admin' || $status !== 'active')) {
        throw new InvalidArgumentException('Нельзя ограничить доступ текущей учётной записи администратора.');
    }
    $users[$index] = [
        ...$previous,
        'login' => $login,
        'name' => $name,
        'role' => $role,
        'status' => $status,
        'email' => ais_auth_validate_email((string) ($payload['email'] ?? '')),
        'phone' => ais_auth_validate_phone((string) ($payload['phone'] ?? '')),
        'updatedAt' => $now,
    ];
    if ($password !== '') {
        if (mb_strlen($password, 'UTF-8') < 3) {
            throw new InvalidArgumentException('Пароль должен содержать не менее 3 символов.');
        }
        $users[$index]['passwordHash'] = ais_auth_hash_password($password);
    }
    if (ais_auth_count_active_admins($users) < 1) {
        throw new InvalidArgumentException('В системе должен оставаться хотя бы один активный администратор.');
    }
    ais_auth_write_users($users);
    return ais_auth_public_user($users[$index]);
}
