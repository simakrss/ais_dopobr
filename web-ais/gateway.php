<?php

declare(strict_types=1);

const AIS_GATEWAY_MAX_REQUEST_BYTES = 42 * 1024 * 1024;
const AIS_GATEWAY_TIMEOUT_SECONDS = 760;
const AIS_GATEWAY_JOB_TTL_SECONDS = 3600;

$authLibraryCandidates = [
    dirname(__DIR__, 2) . '/lms-runtime/app/auth-lib.php',
    __DIR__ . '/auth-lib.php',
];
$authLibrary = null;
foreach ($authLibraryCandidates as $candidate) {
    if (is_file($candidate)) {
        $authLibrary = $candidate;
        break;
    }
}
if ($authLibrary === null) {
    http_response_code(500);
    exit('Authentication service is unavailable.');
}
require_once $authLibrary;

$auditLibraryCandidates = [
    dirname(__DIR__, 2) . '/lms-runtime/app/audit-lib.php',
    __DIR__ . '/audit-lib.php',
];
$auditLibrary = null;
foreach ($auditLibraryCandidates as $candidate) {
    if (is_file($candidate)) {
        $auditLibrary = $candidate;
        break;
    }
}
if ($auditLibrary === null) {
    http_response_code(500);
    exit('Audit service is unavailable.');
}
require_once $auditLibrary;

function gateway_json(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function gateway_fail(int $status, string $message): void
{
    gateway_json($status, ['error' => $message]);
}

function gateway_request_headers(): array
{
    $source = function_exists('getallheaders') ? getallheaders() : [];
    $headers = [];
    foreach ($source as $name => $value) {
        $headers[strtolower((string) $name)] = (string) $value;
    }
    $headers['host'] = (string) ($_SERVER['HTTP_HOST'] ?? $headers['host'] ?? 'localhost');
    return $headers;
}

function gateway_request_path(): string
{
    $requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    $path = (string) parse_url($requestUri, PHP_URL_PATH);
    $scriptDirectory = str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/')));
    $scriptDirectory = $scriptDirectory === '/' ? '' : rtrim($scriptDirectory, '/');
    if ($scriptDirectory !== '' && str_starts_with($path, $scriptDirectory . '/')) {
        $path = substr($path, strlen($scriptDirectory));
    }
    return $path === '' ? '/' : $path;
}

function gateway_api_url(): string
{
    $requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    $path = gateway_request_path();
    $query = (string) parse_url($requestUri, PHP_URL_QUERY);
    if (!preg_match('#^/api(?:/|$)#', $path)) {
        gateway_fail(404, 'Not found');
    }
    return $path . ($query !== '' ? '?' . $query : '');
}

function gateway_public_app_url(): string
{
    $forwardedProto = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
    $httpsEnabled = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
    $scheme = $httpsEnabled || $forwardedProto === 'https' ? 'https' : 'http';
    $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if ($host === '' || preg_match('/[^A-Za-z0-9.\-:\[\]]/', $host)) {
        throw new RuntimeException('Не удалось определить адрес системы для письма подтверждения.');
    }
    return $scheme . '://' . $host . ais_auth_base_path();
}

function gateway_temp_file(string $prefix): string
{
    $path = tempnam(sys_get_temp_dir(), $prefix);
    if ($path === false) {
        throw new RuntimeException('Не удалось создать временный файл серверного запроса.');
    }
    return $path;
}

function gateway_run_node(string $url, string $method, array $headers, string $body): array
{
    $runtimeRoot = dirname(__DIR__, 2) . '/lms-runtime';
    $node = $runtimeRoot . '/node/bin/node';
    $worker = $runtimeRoot . '/app/server-cli.js';
    if (!is_file($node) || !is_executable($node) || !is_file($worker)) {
        throw new RuntimeException('Серверный runtime не установлен.');
    }

    $requestPath = gateway_temp_file('ais-req-');
    $requestBodyPath = gateway_temp_file('ais-in-');
    $responsePath = gateway_temp_file('ais-res-');
    $responseBodyPath = gateway_temp_file('ais-out-');
    $stdoutPath = gateway_temp_file('ais-stdout-');
    $stderrPath = gateway_temp_file('ais-stderr-');
    $paths = [$requestPath, $requestBodyPath, $responsePath, $responseBodyPath, $stdoutPath, $stderrPath];

    try {
        file_put_contents($requestPath, json_encode([
            'method' => $method,
            'url' => $url,
            'headers' => $headers,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
        file_put_contents($requestBodyPath, $body, LOCK_EX);

        $command = [$node, $worker, $requestPath, $requestBodyPath, $responsePath, $responseBodyPath];
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['file', $stdoutPath, 'ab'],
            2 => ['file', $stderrPath, 'ab'],
        ];
        putenv('AIS_APP_ROOT=' . __DIR__);
        putenv('AIS_TRUST_GATEWAY=1');
        putenv('AIS_OCR_CLI=1');
        $process = proc_open($command, $descriptors, $pipes, __DIR__, null, ['bypass_shell' => true]);
        if (!is_resource($process)) {
            throw new RuntimeException('Не удалось запустить серверную обработку запроса.');
        }
        fclose($pipes[0]);

        $deadline = microtime(true) + AIS_GATEWAY_TIMEOUT_SECONDS;
        do {
            $processStatus = proc_get_status($process);
            if (!$processStatus['running']) {
                break;
            }
            if (microtime(true) >= $deadline) {
                proc_terminate($process, 9);
                throw new RuntimeException('Серверная операция превысила допустимое время выполнения.');
            }
            usleep(50000);
        } while (true);
        proc_close($process);

        $metadataText = is_file($responsePath) ? file_get_contents($responsePath) : false;
        $metadata = $metadataText === false ? null : json_decode($metadataText, true);
        if (!is_array($metadata) || !isset($metadata['status'])) {
            $details = trim((string) @file_get_contents($stderrPath));
            throw new RuntimeException(
                'Серверная обработка не вернула ответ.'
                . ($details !== '' ? ' ' . mb_substr($details, 0, 800, 'UTF-8') : '')
            );
        }
        return [
            'status' => (int) $metadata['status'],
            'headers' => is_array($metadata['headers'] ?? null) ? $metadata['headers'] : [],
            'body' => (string) @file_get_contents($responseBodyPath),
        ];
    } finally {
        foreach ($paths as $path) {
            if (is_file($path)) {
                @unlink($path);
            }
        }
    }
}

function gateway_jobs_directory(): string
{
    $directory = __DIR__ . '/storage/jobs';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Не удалось подготовить хранилище серверных задач.');
    }
    return $directory;
}

function gateway_cleanup_jobs(): void
{
    $directory = gateway_jobs_directory();
    $expiresBefore = time() - AIS_GATEWAY_JOB_TTL_SECONDS;
    foreach (glob($directory . '/*') ?: [] as $path) {
        if (is_file($path) && filemtime($path) < $expiresBefore) {
            @unlink($path);
        }
    }
}

function gateway_job_id(): string
{
    return bin2hex(random_bytes(18));
}

function gateway_job_paths(string $id): array
{
    if (!preg_match('/^[a-f0-9]{36}$/', $id)) {
        gateway_fail(404, 'Серверная задача не найдена.');
    }
    $base = gateway_jobs_directory() . '/' . $id;
    return ['meta' => $base . '.json', 'body' => $base . '.body'];
}

function gateway_read_job(string $id): array
{
    $paths = gateway_job_paths($id);
    $text = is_file($paths['meta']) ? file_get_contents($paths['meta']) : false;
    $job = $text === false ? null : json_decode($text, true);
    if (!is_array($job)) {
        gateway_fail(404, 'Серверная задача не найдена или срок ее хранения истек.');
    }
    return [$job, $paths];
}

function gateway_public_job(array $job): array
{
    return [
        'id' => $job['id'],
        'status' => $job['status'],
        'stage' => $job['status'] === 'completed' ? 'complete' : 'error',
        'message' => $job['message'],
        'progress' => $job['status'] === 'completed' ? 100 : 0,
        'error' => $job['error'] ?? '',
        'createdAt' => $job['createdAt'],
        'updatedAt' => $job['updatedAt'],
    ];
}

function gateway_public_ocr_job(array $job): array
{
    return [
        'jobId' => $job['id'],
        'status' => $job['status'],
        'stage' => $job['status'] === 'completed'
            ? 'Распознавание завершено'
            : 'Распознавание не выполнено',
        'progress' => $job['status'] === 'completed' ? 100 : 0,
        'source' => 'webdav',
        'sourceLabel' => 'Яндекс-Диск',
        'startedAt' => $job['createdAt'],
        'completedAt' => $job['updatedAt'],
        'elapsedMs' => (int) ($job['durationMs'] ?? 0),
        'processedFiles' => (int) ($job['processedFiles'] ?? 0),
        'totalFiles' => (int) ($job['totalFiles'] ?? 0),
        'error' => $job['error'] ?? '',
    ];
}

function gateway_store_completed_job(string $kind, array $nodeResponse, string $ownerId): array
{
    $id = gateway_job_id();
    $paths = gateway_job_paths($id);
    $success = $nodeResponse['status'] >= 200 && $nodeResponse['status'] < 300;
    $error = '';
    if (!$success) {
        $payload = json_decode($nodeResponse['body'], true);
        $error = is_array($payload) ? (string) ($payload['error'] ?? '') : '';
        if ($error === '') {
            $error = 'Серверная операция завершилась с ошибкой.';
        }
    }
    $resultPayload = $success && $kind === 'ocr'
        ? json_decode((string) $nodeResponse['body'], true)
        : null;
    $now = gmdate('c');
    $job = [
        'id' => $id,
        'kind' => $kind,
        'ownerId' => $ownerId,
        'status' => $success ? 'completed' : 'failed',
        'message' => $success
            ? match ($kind) {
                'import' => 'Импорт завершен',
                'ocr' => 'Распознавание завершено',
                default => 'Синхронизация завершена',
            }
            : $error,
        'error' => $error,
        'createdAt' => $now,
        'updatedAt' => $now,
        'resultStatus' => $nodeResponse['status'],
        'resultHeaders' => $nodeResponse['headers'],
        'durationMs' => is_array($resultPayload) ? (int) ($resultPayload['durationMs'] ?? 0) : 0,
        'processedFiles' => is_array($resultPayload) ? (int) ($resultPayload['processedCount'] ?? 0) : 0,
        'totalFiles' => is_array($resultPayload)
            ? (int) (($resultPayload['processedCount'] ?? 0) + ($resultPayload['failedCount'] ?? 0))
            : 0,
    ];
    file_put_contents($paths['body'], $nodeResponse['body'], LOCK_EX);
    file_put_contents(
        $paths['meta'],
        json_encode($job, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        LOCK_EX
    );
    return $job;
}

function gateway_require_user(): array
{
    $user = ais_auth_current_user();
    if ($user === null) {
        gateway_fail(401, 'Требуется вход в систему.');
    }
    return $user;
}

function gateway_require_admin(array $user): void
{
    if ((string) ($user['role'] ?? '') !== 'admin') {
        gateway_fail(403, 'Раздел доступен только администратору.');
    }
}

function gateway_partner_record_rank(array $employee): int
{
    $section = mb_strtolower(trim((string) ($employee['section'] ?? $employee['status'] ?? '')), 'UTF-8');
    $sectionScore = str_contains($section, 'действующ') || $section === 'действует'
        ? 3000000000
        : (str_contains($section, 'партнер') || str_contains($section, 'партнёр')
            ? 2000000000
            : 1000000000);
    $date = trim((string) ($employee['endDate'] ?? $employee['contractDate'] ?? ''));
    $timestamp = $date !== '' ? strtotime($date) : false;
    return $sectionScore + ($timestamp === false ? 0 : (int) floor($timestamp / 86400));
}

function gateway_find_partner_employee(string $login, string $password): ?array
{
    $normalizedLogin = ais_auth_normalize_login($login);
    if ($normalizedLogin === '' || $password === '') {
        return null;
    }
    $data = gateway_shared_state_read_data(gateway_record_locks_pdo());
    $contracts = is_array($data['collections']['contracts'] ?? null)
        ? $data['collections']['contracts']
        : [];
    $matches = [];
    foreach ($contracts as $employee) {
        if (!is_array($employee)
            || ais_auth_normalize_login((string) ($employee['login'] ?? '')) !== $normalizedLogin) {
            continue;
        }
        $expectedPassword = (string) ($employee['password'] ?? '');
        if ($expectedPassword === '' || !hash_equals($expectedPassword, $password)) {
            continue;
        }
        $employeeId = trim((string) ($employee['id'] ?? ''));
        if ($employeeId === '') {
            $employeeId = substr(hash('sha256', $normalizedLogin . '|' . (string) ($employee['contractNo'] ?? '')), 0, 24);
        }
        $employee['id'] = $employeeId;
        $matches[] = $employee;
    }
    if ($matches === []) {
        return null;
    }
    usort($matches, static fn (array $left, array $right): int =>
        gateway_partner_record_rank($right) <=> gateway_partner_record_rank($left)
    );
    return $matches[0];
}

function gateway_read_json_body(string $body): array
{
    $payload = json_decode($body, true);
    if (!is_array($payload)) {
        gateway_fail(400, 'Некорректный JSON в запросе.');
    }
    return $payload;
}

function gateway_handle_auth_route(string $method, string $path, string $body): void
{
    if ($method === 'POST' && $path === '/api/auth/login') {
        $payload = gateway_read_json_body($body);
        $user = ais_auth_login((string) ($payload['login'] ?? ''), (string) ($payload['password'] ?? ''));
        if ($user === null) {
            try {
                $employee = gateway_find_partner_employee(
                    (string) ($payload['login'] ?? ''),
                    (string) ($payload['password'] ?? '')
                );
                if ($employee !== null) {
                    $user = ais_auth_login_partner($employee);
                }
            } catch (Throwable $partnerLoginError) {
                error_log('Partner authentication is temporarily unavailable: ' . $partnerLoginError->getMessage());
            }
        }
        if ($user === null) {
            gateway_fail(401, 'Неверный логин или пароль.');
        }
        ais_audit_try_append([
            'action' => 'Вход в систему',
            'area' => 'Авторизация',
            'entityType' => 'user',
            'entityId' => $user['id'] ?? '',
            'entityLabel' => $user['login'] ?? '',
        ], $user);
        gateway_json(200, [
            'ok' => true,
            'user' => $user,
            'sessionExpiresAt' => ais_auth_session_expires_at_ms(),
        ]);
    }
    if ($method === 'GET' && $path === '/api/auth/me') {
        $user = ais_auth_current_user();
        if ($user === null) {
            gateway_fail(401, 'Требуется вход в систему.');
        }
        gateway_json(200, [
            'ok' => true,
            'user' => $user,
            'sessionExpiresAt' => ais_auth_session_expires_at_ms(),
        ]);
    }
    if ($method === 'POST' && $path === '/api/auth/logout') {
        $user = ais_auth_current_user();
        if ($user !== null) {
            ais_audit_try_append([
                'action' => 'Выход из системы',
                'area' => 'Авторизация',
                'entityType' => 'user',
                'entityId' => $user['id'] ?? '',
                'entityLabel' => $user['login'] ?? '',
            ], $user);
        }
        ais_auth_logout();
        gateway_json(200, ['ok' => true]);
    }
    if ($method === 'POST' && $path === '/api/auth/profile') {
        $user = gateway_require_user();
        if ((string) ($user['role'] ?? '') === 'partner') {
            gateway_fail(403, 'Данные партнёра изменяются в карточке сотрудника.');
        }
        $payload = gateway_read_json_body($body);
        $updated = ais_auth_update_profile(
            (string) $user['id'],
            (string) ($payload['email'] ?? ''),
            (string) ($payload['phone'] ?? '')
        );
        ais_audit_try_append([
            'action' => 'Изменён личный кабинет',
            'area' => 'Пользователи',
            'entityType' => 'user',
            'entityId' => $user['id'] ?? '',
            'entityLabel' => $user['login'] ?? '',
            'changes' => [
                ['field' => 'email', 'label' => 'Email', 'before' => $user['email'] ?? '', 'after' => $updated['email'] ?? ''],
                ['field' => 'phone', 'label' => 'Телефон', 'before' => $user['phone'] ?? '', 'after' => $updated['phone'] ?? ''],
            ],
        ], $updated);
        gateway_json(200, ['ok' => true, 'user' => $updated]);
    }
    if ($method === 'POST' && $path === '/api/auth/password') {
        $user = gateway_require_user();
        if ((string) ($user['role'] ?? '') === 'partner') {
            gateway_fail(403, 'Пароль партнёра изменяется в реквизитах СДО сотрудника.');
        }
        $payload = gateway_read_json_body($body);
        ais_auth_change_password(
            (string) $user['id'],
            (string) ($payload['currentPassword'] ?? ''),
            (string) ($payload['newPassword'] ?? '')
        );
        ais_audit_try_append([
            'action' => 'Изменён пароль',
            'area' => 'Пользователи',
            'entityType' => 'user',
            'entityId' => $user['id'] ?? '',
            'entityLabel' => $user['login'] ?? '',
            'field' => 'password',
            'before' => '[скрыто]',
            'after' => '[скрыто]',
        ], $user);
        gateway_json(200, ['ok' => true]);
    }
}

function gateway_audit_filters(): array
{
    $filters = [];
    foreach ([
        'q', 'from', 'to', 'user', 'userName', 'role', 'action', 'area', 'entityType',
        'entityId', 'entityLabel', 'field', 'before', 'after', 'details', 'ip',
        'userAgent', 'source',
    ] as $key) {
        $filters[$key] = (string) ($_GET[$key] ?? '');
    }
    return $filters;
}

function gateway_handle_audit_routes(
    string $method,
    string $path,
    string $body,
    array $currentUser
): void {
    if ($method === 'POST' && $path === '/api/audit/log') {
        $entry = ais_audit_append(gateway_read_json_body($body), $currentUser);
        gateway_json(201, ['ok' => true, 'entry' => $entry]);
    }
    if ($method === 'GET' && $path === '/api/admin/audit') {
        gateway_require_admin($currentUser);
        gateway_json(200, ais_audit_query(
            gateway_audit_filters(),
            (int) ($_GET['page'] ?? 1),
            (int) ($_GET['pageSize'] ?? 50)
        ));
    }
    if ($method === 'GET' && $path === '/api/admin/audit/export') {
        gateway_require_admin($currentUser);
        $csv = ais_audit_export_csv(gateway_audit_filters());
        $fileName = 'audit-log-' . gmdate('Y-m-d_H-i-s') . '.csv';
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $fileName . '"');
        header('Content-Length: ' . strlen($csv));
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo $csv;
        exit;
    }
    if ($method === 'GET' && in_array($path, [
        '/api/students/audit',
        '/api/students/audit/export',
    ], true)) {
        $legacyStudentId = trim((string) ($_GET['studentId'] ?? ''));
        $entityType = trim((string) ($_GET['entityType'] ?? '')) === 'contracts'
            ? 'contracts'
            : 'students';
        $entityId = trim((string) ($_GET['entityId'] ?? $legacyStudentId));
        if ($entityId === '' || mb_strlen($entityId, 'UTF-8') > 240) {
            gateway_fail(
                400,
                $entityType === 'contracts'
                    ? 'Не указан сотрудник для просмотра журнала.'
                    : 'Не указан слушатель для просмотра журнала.'
            );
        }
        $scope = [
            'entityTypeExact' => $entityType,
            'entityIdExact' => $entityId,
        ];
        $filters = array_merge(gateway_audit_filters(), $scope);
        if (str_ends_with($path, '/export')) {
            $csv = ais_audit_export_csv($filters);
            $safeId = preg_replace('/[^A-Za-z0-9_-]+/', '-', $entityId) ?: 'log';
            $prefix = $entityType === 'contracts' ? 'employee-audit-' : 'student-audit-';
            $fileName = $prefix . substr($safeId, 0, 80) . '-' . gmdate('Y-m-d_H-i-s') . '.csv';
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $fileName . '"');
            header('Content-Length: ' . strlen($csv));
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
            echo $csv;
            exit;
        }
        gateway_json(200, ais_audit_query(
            $filters,
            (int) ($_GET['page'] ?? 1),
            (int) ($_GET['pageSize'] ?? 50),
            $scope
        ));
    }
}

function gateway_handle_admin_users(string $method, string $path, string $body, array $currentUser): void
{
    if (!str_starts_with($path, '/api/admin/users')) {
        return;
    }
    gateway_require_admin($currentUser);
    if ($method === 'GET' && $path === '/api/admin/users') {
        gateway_json(200, [
            'users' => array_map('ais_auth_public_user', ais_auth_load_users()),
        ]);
    }
    if ($method === 'POST' && $path === '/api/admin/users') {
        $payload = gateway_read_json_body($body);
        $before = null;
        foreach (ais_auth_load_users() as $candidate) {
            if ((string) ($candidate['id'] ?? '') === (string) ($payload['id'] ?? '')) {
                $before = ais_auth_public_user($candidate);
                break;
            }
        }
        $saved = ais_auth_admin_save_user(
            $payload,
            (string) $currentUser['id']
        );
        $changes = [];
        foreach ([
            'login' => 'Логин',
            'name' => 'Имя',
            'role' => 'Роль',
            'status' => 'Статус',
            'email' => 'Email',
            'phone' => 'Телефон',
        ] as $key => $label) {
            $oldValue = (string) ($before[$key] ?? '');
            $newValue = (string) ($saved[$key] ?? '');
            if ($oldValue !== $newValue) {
                $changes[] = ['field' => $key, 'label' => $label, 'before' => $oldValue, 'after' => $newValue];
            }
        }
        if ((string) ($payload['password'] ?? '') !== '') {
            $changes[] = ['field' => 'password', 'label' => 'Пароль', 'before' => '[скрыто]', 'after' => '[скрыто]'];
        }
        ais_audit_try_append([
            'action' => $before === null ? 'Создан пользователь' : 'Изменён пользователь',
            'area' => 'Пользователи',
            'entityType' => 'user',
            'entityId' => $saved['id'] ?? '',
            'entityLabel' => $saved['login'] ?? '',
            'changes' => $changes,
        ], $currentUser);
        gateway_json(200, ['ok' => true, 'user' => $saved]);
    }
    gateway_fail(405, 'Method not allowed');
}

function gateway_serve_protected_data(string $path): void
{
    $user = gateway_require_user();
    if ((string) ($user['role'] ?? '') === 'partner') {
        gateway_fail(403, 'Раздел недоступен в кабинете партнёра.');
    }
    $runtimeDataRoot = dirname(__DIR__, 2) . '/lms-runtime/data';
    $dataRoot = is_dir($runtimeDataRoot) ? $runtimeDataRoot : __DIR__ . '/data';
    $allowed = [
        '/data/program-registry.js' => $dataRoot . '/program-registry.js',
        '/data/program-payment-registry.js' => $dataRoot . '/program-payment-registry.js',
        '/data/seed.js' => $dataRoot . '/seed.js',
    ];
    $file = $allowed[$path] ?? '';
    if ($file === '' || !is_file($file)) {
        gateway_fail(404, 'Not found');
    }
    header('Content-Type: text/javascript; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    readfile($file);
    exit;
}

function gateway_send_node_response(array $response): void
{
    http_response_code((int) $response['status']);
    $blocked = ['connection', 'transfer-encoding', 'content-length', 'set-cookie'];
    foreach ($response['headers'] as $name => $value) {
        if (in_array(strtolower((string) $name), $blocked, true)) {
            continue;
        }
        if (is_scalar($value)) {
            header((string) $name . ': ' . (string) $value);
        }
    }
    header('X-Content-Type-Options: nosniff');
    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'HEAD') {
        echo $response['body'];
    }
    exit;
}

function gateway_tunnel_settings(): ?array
{
    $path = __DIR__ . '/storage/tunnel-runtime.json';
    $text = is_file($path) ? file_get_contents($path) : false;
    $settings = $text === false ? null : json_decode($text, true);
    if (!is_array($settings) || ($settings['enabled'] ?? false) !== true) {
        return null;
    }
    $baseUrl = rtrim(trim((string) ($settings['baseUrl'] ?? '')), '/');
    $secret = (string) ($settings['secret'] ?? '');
    $parts = parse_url($baseUrl);
    if (
        !is_array($parts)
        || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
        || trim((string) ($parts['host'] ?? '')) === ''
        || strlen($baseUrl) > 500
        || strlen($secret) < 32
        || strlen($secret) > 512
    ) {
        return null;
    }
    return ['baseUrl' => $baseUrl, 'secret' => $secret];
}

function gateway_handle_advertising_source_proxy(
    string $method,
    string $path,
    string $body
): void {
    if ($path !== '/api/advertising/email-collector/source-proxy') {
        return;
    }
    $settings = gateway_tunnel_settings();
    $headers = gateway_request_headers();
    $providedSecret = trim((string) ($headers['x-ais-gateway-token'] ?? ''));
    if (
        $settings === null
        || $providedSecret === ''
        || !hash_equals((string) $settings['secret'], $providedSecret)
    ) {
        gateway_fail(404, 'Not found');
    }
    if ($method !== 'POST') {
        gateway_fail(405, 'Method not allowed');
    }
    if (strlen($body) > 64 * 1024) {
        gateway_fail(413, 'Настройки источника превышают допустимый размер.');
    }
    $headers['x-ais-user-id'] = 'advertising-source-proxy';
    $headers['x-ais-user-login'] = 'advertising-proxy';
    $headers['x-ais-user-name'] = 'Advertising source proxy';
    $headers['x-ais-user-role'] = 'admin';
    $headers['x-ais-session-id'] = hash('sha256', 'advertising-source-proxy');
    $response = gateway_run_node($path, 'POST', $headers, $body);
    $response['headers']['X-AIS-Processing'] = 'site-proxy';
    gateway_send_node_response($response);
}

function gateway_sanitize_external_service_url(string $value, string $fallback = ''): string
{
    $source = trim($value !== '' ? $value : $fallback);
    if ($source === '' || strlen($source) > 500) {
        return '';
    }
    $parts = parse_url($source);
    if (!is_array($parts)) {
        return '';
    }
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    $host = trim((string) ($parts['host'] ?? ''));
    if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
        return '';
    }
    if (str_contains($host, ':') && !str_starts_with($host, '[')) {
        $host = '[' . $host . ']';
    }
    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
    $path = rtrim((string) ($parts['path'] ?? ''), '/');
    return $scheme . '://' . $host . $port . $path;
}

function gateway_join_external_service_url(string $baseUrl, string $route): string
{
    $base = rtrim($baseUrl, '/');
    return $base === '' ? '' : $base . '/' . ltrim($route, '/');
}

function gateway_tunnel_admin_summary(): array
{
    $path = __DIR__ . '/storage/tunnel-runtime.json';
    $text = is_file($path) ? file_get_contents($path) : false;
    $runtime = $text === false ? null : json_decode($text, true);
    if (!is_array($runtime)) {
        $runtime = [];
    }
    $baseUrl = gateway_sanitize_external_service_url((string) ($runtime['baseUrl'] ?? ''));
    if (!str_starts_with($baseUrl, 'https://')) {
        $baseUrl = '';
    }
    $secretLength = strlen((string) ($runtime['secret'] ?? ''));
    $secretConfigured = $secretLength >= 32 && $secretLength <= 512;
    $enabled = ($runtime['enabled'] ?? false) === true;
    return [
        'enabled' => $enabled,
        'configured' => $enabled && $baseUrl !== '' && $secretConfigured,
        'baseUrl' => $baseUrl,
        'updatedAt' => substr(trim((string) ($runtime['updatedAt'] ?? '')), 0, 80),
        'secretConfigured' => $secretConfigured,
    ];
}

function gateway_external_services_admin_payload(): array
{
    $settings = gateway_server_settings();
    $tunnel = gateway_tunnel_admin_summary();
    $localGatewayUrl = gateway_sanitize_external_service_url(
        (string) (getenv('AIS_LOCAL_DOCUMENT_SERVICES_ORIGIN') ?: ''),
        'http://127.0.0.1:8081'
    );
    $ocrServiceUrl = gateway_sanitize_external_service_url(
        (string) (getenv('AIS_OCR_SERVICE_URL') ?: ($settings['ocrServiceUrl'] ?? '')),
        'http://127.0.0.1:8083'
    );
    $documentConverterUrl = gateway_sanitize_external_service_url(
        (string) (getenv('ONLYOFFICE_CONVERTER_URL') ?: ($settings['documentConverterUrl'] ?? '')),
        'http://127.0.0.1:8082'
    );
    $documentConverterSourceUrl = gateway_sanitize_external_service_url(
        (string) (getenv('ONLYOFFICE_SOURCE_URL') ?: ($settings['documentConverterSourceUrl'] ?? '')),
        'http://host.docker.internal:19081'
    );
    $converterSecret = (string) (
        getenv('ONLYOFFICE_JWT_SECRET') ?: ($settings['documentConverterJwtSecret'] ?? '')
    );
    return [
        'ok' => true,
        'mode' => 'local-first',
        'localGateway' => [
            'baseUrl' => $localGatewayUrl,
            'healthUrl' => gateway_join_external_service_url(
                $localGatewayUrl,
                '/api/local-document-services/health'
            ),
        ],
        'tunnel' => $tunnel,
        'recognition' => [
            'serviceUrl' => $ocrServiceUrl,
            'localApiUrl' => gateway_join_external_service_url(
                $localGatewayUrl,
                '/api/students/recognize-documents'
            ),
            'tunnelApiUrl' => gateway_join_external_service_url(
                (string) $tunnel['baseUrl'],
                '/api/students/recognize-documents'
            ),
            'route' => '/api/students/recognize-documents/*',
        ],
        'documentGeneration' => [
            'serviceUrl' => $documentConverterUrl,
            'sourceUrl' => $documentConverterSourceUrl,
            'localApiUrl' => gateway_join_external_service_url(
                $localGatewayUrl,
                '/api/contracts/student-document'
            ),
            'tunnelApiUrl' => gateway_join_external_service_url(
                (string) $tunnel['baseUrl'],
                '/api/contracts/student-document'
            ),
            'routes' => [
                '/api/contracts/student-document',
                '/api/contracts/student-document-preview/*',
            ],
            'accessKeyConfigured' => trim($converterSecret) !== '' ? true : null,
        ],
    ];
}

function gateway_handle_admin_external_services(
    string $method,
    string $path,
    array $currentUser
): void {
    if ($path !== '/api/admin/external-services') {
        return;
    }
    gateway_require_admin($currentUser);
    if ($method !== 'GET') {
        gateway_fail(405, 'Method not allowed');
    }
    gateway_json(200, gateway_external_services_admin_payload());
}

function gateway_tunnel_handles(string $method, string $path): bool
{
    if (
        $method === 'POST'
        && (
            $path === '/api/contracts/student-document'
            || str_starts_with($path, '/api/contracts/student-document-preview/')
        )
    ) {
        return true;
    }
    return in_array($method, ['GET', 'HEAD', 'POST'], true)
        && str_starts_with($path, '/api/students/recognize-documents/');
}

function gateway_parse_tunnel_response_headers(array $lines): array
{
    $headers = [];
    foreach ($lines as $line) {
        $separator = strpos((string) $line, ':');
        if ($separator === false) {
            continue;
        }
        $name = trim(substr((string) $line, 0, $separator));
        $value = trim(substr((string) $line, $separator + 1));
        if ($name !== '' && $value !== '') {
            $headers[$name] = $value;
        }
    }
    return $headers;
}

function gateway_run_tunnel(
    array $settings,
    string $url,
    string $method,
    array $headers,
    string $body
): array {
    $target = $settings['baseUrl'] . '/' . ltrim($url, '/');
    $outgoingHeaders = [];
    $blocked = [
        'connection',
        'content-length',
        'cookie',
        'host',
        'transfer-encoding',
        'x-ais-gateway-token',
        'x-forwarded-host',
        'x-forwarded-proto',
    ];
    foreach ($headers as $name => $value) {
        if (!in_array(strtolower((string) $name), $blocked, true) && is_scalar($value)) {
            $outgoingHeaders[] = (string) $name . ': ' . (string) $value;
        }
    }
    $originalHost = preg_replace(
        '/[\r\n].*$/s',
        '',
        trim((string) ($headers['host'] ?? ($_SERVER['HTTP_HOST'] ?? '')))
    );
    if ($originalHost !== '') {
        $outgoingHeaders[] = 'X-Forwarded-Host: ' . $originalHost;
    }
    $outgoingHeaders[] = 'X-Forwarded-Proto: https';
    $outgoingHeaders[] = 'X-AIS-Gateway-Token: ' . $settings['secret'];

    if (function_exists('curl_init')) {
        $responseHeaders = [];
        $curl = curl_init($target);
        if ($curl === false) {
            throw new RuntimeException('Не удалось подготовить туннельный запрос.');
        }
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $outgoingHeaders,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 20,
            CURLOPT_TIMEOUT => AIS_GATEWAY_TIMEOUT_SECONDS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$responseHeaders): int {
                $trimmed = trim($line);
                if (str_starts_with($trimmed, 'HTTP/')) {
                    $responseHeaders = [];
                } elseif ($trimmed !== '') {
                    $responseHeaders[] = $trimmed;
                }
                return strlen($line);
            },
        ]);
        if ($method === 'HEAD') {
            curl_setopt($curl, CURLOPT_NOBODY, true);
        } elseif ($method !== 'GET' || $body !== '') {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }
        $responseBody = curl_exec($curl);
        if ($responseBody === false) {
            $message = curl_error($curl);
            curl_close($curl);
            throw new RuntimeException($message !== '' ? $message : 'Туннель не ответил.');
        }
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        return [
            'status' => $status > 0 ? $status : 502,
            'headers' => gateway_parse_tunnel_response_headers($responseHeaders),
            'body' => (string) $responseBody,
        ];
    }

    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $outgoingHeaders),
            'content' => in_array($method, ['GET', 'HEAD'], true) ? '' : $body,
            'ignore_errors' => true,
            'follow_location' => 0,
            'max_redirects' => 0,
            'timeout' => AIS_GATEWAY_TIMEOUT_SECONDS,
        ],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $responseBody = @file_get_contents($target, false, $context);
    $responseLines = isset($http_response_header) && is_array($http_response_header)
        ? $http_response_header
        : [];
    if ($responseBody === false && $responseLines === []) {
        throw new RuntimeException('Туннель не ответил.');
    }
    $status = 502;
    foreach ($responseLines as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#i', (string) $line, $matches)) {
            $status = (int) $matches[1];
        }
    }
    return [
        'status' => $status,
        'headers' => gateway_parse_tunnel_response_headers($responseLines),
        'body' => $method === 'HEAD' ? '' : (string) $responseBody,
    ];
}

function gateway_server_settings(): array
{
    $path = __DIR__ . '/storage/server-settings.json';
    $text = is_file($path) ? file_get_contents($path) : false;
    $settings = $text === false ? null : json_decode($text, true);
    return is_array($settings) ? $settings : [];
}

function gateway_parse_connection_string(string $value): array
{
    $result = [];
    preg_match_all('/(?:^|;)\s*([^=;]+)\s*=\s*(\{[^}]*\}|[^;]*)/', $value, $matches, PREG_SET_ORDER);
    foreach ($matches as $match) {
        $key = strtolower(trim((string) $match[1]));
        $item = trim((string) $match[2]);
        if (str_starts_with($item, '{') && str_ends_with($item, '}')) {
            $item = substr($item, 1, -1);
        }
        $result[$key] = $item;
    }
    return $result;
}

function gateway_application_date(string $value, string $label): DateTimeImmutable
{
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    $errors = DateTimeImmutable::getLastErrors();
    if (
        !$date
        || (is_array($errors) && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))
        || $date->format('Y-m-d') !== $value
    ) {
        throw new InvalidArgumentException('Некорректная дата ' . $label . '.');
    }
    return $date;
}

function gateway_query_store_applications(array $filters): array
{
    $settings = gateway_server_settings();
    $connection = gateway_parse_connection_string((string) (
        $settings['studentApplicationsMySqlConnectionString'] ?? ''
    ));
    $host = trim((string) ($connection['server'] ?? $connection['host'] ?? ''));
    $database = trim((string) ($connection['database'] ?? ''));
    $user = trim((string) ($connection['uid'] ?? $connection['user'] ?? ''));
    $password = (string) ($connection['pwd'] ?? $connection['password'] ?? '');
    if ($host === '' || $database === '' || $user === '' || $password === '') {
        throw new RuntimeException('Не настроено подключение к базе заявок.');
    }

    $dateFrom = gateway_application_date(trim((string) ($filters['dateFrom'] ?? '')), 'начала');
    $dateTo = gateway_application_date(trim((string) ($filters['dateTo'] ?? '')), 'окончания');
    if ($dateFrom > $dateTo) {
        throw new InvalidArgumentException('Дата начала периода не может быть позже даты окончания.');
    }
    $programName = mb_substr(trim((string) ($filters['programName'] ?? '')), 0, 300, 'UTF-8');
    $productId = mb_substr(trim((string) ($filters['productId'] ?? '')), 0, 80, 'UTF-8');
    $onlyPaid = !empty($filters['onlyPaid']);

    $query = <<<'SQL'
SELECT *
FROM (
  SELECT DISTINCTROW
    DATE_FORMAT(t_opl.date_created, '%d.%m.%Y %H:%i:%s') AS `Дата`,
    IFNULL(bn.meta_value, '') AS `ФИО`,
    CONCAT(
      t_opl.order_id, ' ',
      IF(
        os.status IN ('wc-completed', 'wc-processing') AND os.total_sales > 0,
        CONCAT('опл ', IFNULL(itotal.meta_value, '')),
        ''
      ),
      ' ',
      IFNULL(coup.order_item_name, '')
    ) AS `Заказ (оплата)`,
    CONCAT(oi.order_item_name, ' [', IFNULL(iprod.meta_value, ''), ']') AS `Программа`,
    IFNULL(bp.meta_value, '') AS `Телефон`,
    IFNULL(be.meta_value, '') AS `Email`,
    IFNULL(bcity.meta_value, '') AS `Город`,
    IFNULL(bcomp.meta_value, '') AS `Организация`,
    IFNULL(baddr1.meta_value, '') AS `Должность`,
    IFNULL(baddr2.meta_value, '') AS `Источник`,
    IFNULL(bcomm.post_excerpt, '') AS `Примечание`,
    t_opl.date_created,
    t_opl.order_id AS source_order_id,
    oi.order_item_id AS source_line_item_id,
    IFNULL(iprod.meta_value, '') AS source_product_id,
    IF(
      os.status IN ('wc-completed', 'wc-processing') AND os.total_sales > 0,
      1,
      0
    ) AS source_is_paid,
    IF(
      os.status IN ('wc-completed', 'wc-processing') AND os.total_sales > 0,
      IFNULL(itotal.meta_value, 0),
      0
    ) AS source_payment_amount
  FROM wp_wc_order_product_lookup AS t_opl
  INNER JOIN wp_wc_order_stats os
    ON t_opl.order_id = os.order_id
  INNER JOIN wp_woocommerce_order_items oi
    ON t_opl.order_id = oi.order_id
    AND oi.order_item_type = 'line_item'
  LEFT JOIN wp_woocommerce_order_itemmeta iprod
    ON oi.order_item_id = iprod.order_item_id
    AND iprod.meta_key = '_product_id'
  LEFT JOIN wp_woocommerce_order_itemmeta itotal
    ON oi.order_item_id = itotal.order_item_id
    AND itotal.meta_key = '_line_total'
  LEFT JOIN wp_postmeta bn
    ON t_opl.order_id = bn.post_id
    AND bn.meta_key = '_billing_first_name'
  LEFT JOIN wp_postmeta bp
    ON t_opl.order_id = bp.post_id
    AND bp.meta_key = '_billing_phone'
  LEFT JOIN wp_postmeta be
    ON t_opl.order_id = be.post_id
    AND be.meta_key = '_billing_email'
  LEFT JOIN wp_postmeta bcity
    ON t_opl.order_id = bcity.post_id
    AND bcity.meta_key = '_billing_city'
  LEFT JOIN wp_postmeta bcomp
    ON t_opl.order_id = bcomp.post_id
    AND bcomp.meta_key = '_billing_company'
  LEFT JOIN wp_postmeta baddr1
    ON t_opl.order_id = baddr1.post_id
    AND baddr1.meta_key = '_billing_address_1'
  LEFT JOIN wp_postmeta baddr2
    ON t_opl.order_id = baddr2.post_id
    AND baddr2.meta_key = '_billing_address_2'
  LEFT JOIN wp_posts bcomm
    ON t_opl.order_id = bcomm.id
    AND bcomm.post_excerpt != ''
  LEFT JOIN wp_woocommerce_order_items coup
    ON t_opl.order_id = coup.order_id
    AND coup.order_item_type = 'coupon'
) AS t_all
WHERE date_created >= ?
  AND date_created < ?
SQL;
    $parameters = [$dateFrom->format('Y-m-d'), $dateTo->modify('+1 day')->format('Y-m-d')];
    if ($productId !== '' && $programName !== '') {
        $query .= ' AND (source_product_id = ? OR `Программа` LIKE ?)';
        $parameters[] = $productId;
        $parameters[] = '%' . $programName . '%';
    } elseif ($productId !== '') {
        $query .= ' AND source_product_id = ?';
        $parameters[] = $productId;
    } elseif ($programName !== '') {
        $query .= ' AND `Программа` LIKE ?';
        $parameters[] = '%' . $programName . '%';
    }
    if ($onlyPaid) {
        $query .= ' AND source_is_paid = 1';
    }
    $query .= ' ORDER BY source_order_id DESC, source_line_item_id LIMIT 5000';

    $candidateHosts = preg_match('/\.timeweb\.ru$/i', $host)
        ? array_values(array_unique(['localhost', $host]))
        : [$host];
    $pdo = null;
    $lastConnectionError = null;
    foreach ($candidateHosts as $candidateHost) {
        try {
            $pdo = new PDO(
                'mysql:host=' . $candidateHost . ';dbname=' . $database . ';charset=utf8mb4',
                $user,
                $password,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_TIMEOUT => 30,
                    PDO::ATTR_EMULATE_PREPARES => true,
                ]
            );
            break;
        } catch (PDOException $error) {
            $lastConnectionError = $error;
        }
    }
    if (!$pdo instanceof PDO) {
        throw $lastConnectionError ?? new RuntimeException('Не удалось подключиться к базе заявок.');
    }
    $statement = $pdo->prepare($query);
    $statement->execute($parameters);
    $rows = [];
    while ($row = $statement->fetch()) {
        $orderId = (string) ($row['source_order_id'] ?? '');
        $lineItemId = (string) ($row['source_line_item_id'] ?? '');
        $dateCreated = new DateTimeImmutable((string) ($row['date_created'] ?? 'now'));
        $rows[] = [
            'id' => $orderId . '-' . $lineItemId,
            'date' => (string) ($row['Дата'] ?? ''),
            'dateCreated' => $dateCreated->format('Y-m-d\TH:i:s'),
            'name' => (string) ($row['ФИО'] ?? ''),
            'order' => (string) ($row['Заказ (оплата)'] ?? ''),
            'orderId' => $orderId,
            'program' => (string) ($row['Программа'] ?? ''),
            'productId' => (string) ($row['source_product_id'] ?? ''),
            'phone' => (string) ($row['Телефон'] ?? ''),
            'email' => (string) ($row['Email'] ?? ''),
            'city' => (string) ($row['Город'] ?? ''),
            'organization' => (string) ($row['Организация'] ?? ''),
            'position' => (string) ($row['Должность'] ?? ''),
            'source' => (string) ($row['Источник'] ?? ''),
            'note' => (string) ($row['Примечание'] ?? ''),
            'paid' => (int) ($row['source_is_paid'] ?? 0) === 1,
            'paymentAmount' => (float) ($row['source_payment_amount'] ?? 0),
            'sourceType' => 'mysql',
        ];
    }
    return ['rows' => $rows, 'truncated' => count($rows) >= 5000];
}

function gateway_handle_application_query(array $headers, string $body): void
{
    $filters = json_decode($body, true);
    if (!is_array($filters)) {
        gateway_fail(400, 'Некорректный JSON в запросе.');
    }
    $rows = [];
    $warnings = [];
    $truncated = false;
    $nodeResponse = gateway_run_node(
        '/api/students/import-applications/query',
        'POST',
        $headers,
        $body
    );
    if ($nodeResponse['status'] >= 200 && $nodeResponse['status'] < 300) {
        $payload = json_decode($nodeResponse['body'], true);
        if (is_array($payload)) {
            $rows = array_values(is_array($payload['rows'] ?? null) ? $payload['rows'] : []);
            $warnings = array_values(array_filter(
                is_array($payload['warnings'] ?? null) ? $payload['warnings'] : [],
                static fn ($warning): bool => !str_starts_with((string) $warning, 'База сайта:')
            ));
            $truncated = !empty($payload['truncated']);
        }
    } else {
        $payload = json_decode($nodeResponse['body'], true);
        $warnings[] = (string) ($payload['error'] ?? 'Электронная почта недоступна.');
    }

    try {
        $store = gateway_query_store_applications($filters);
        $rows = array_merge($rows, $store['rows']);
        $truncated = $truncated || $store['truncated'];
    } catch (Throwable $error) {
        $warnings[] = 'База сайта: ' . $error->getMessage();
    }
    if ($rows === [] && $warnings !== []) {
        gateway_fail(400, implode("\n", $warnings));
    }

    usort($rows, static function (array $left, array $right): int {
        return strcmp((string) ($right['dateCreated'] ?? ''), (string) ($left['dateCreated'] ?? ''))
            ?: strcmp((string) ($right['id'] ?? ''), (string) ($left['id'] ?? ''));
    });
    $unique = [];
    $seen = [];
    foreach ($rows as $row) {
        $key = implode("\0", [
            (string) ($row['sourceType'] ?? 'mysql'),
            (string) ($row['orderId'] ?? ''),
            (string) ($row['productId'] ?? ''),
            (string) ($row['id'] ?? ''),
        ]);
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $unique[] = $row;
    }
    gateway_json(200, [
        'rows' => $unique,
        'total' => count($unique),
        'truncated' => $truncated,
        'warnings' => array_values(array_unique($warnings)),
    ]);
}

function gateway_record_locks_pdo(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $settings = gateway_server_settings();
    $environmentConnection = trim((string) (getenv('AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING') ?: ''));
    $dedicatedConnection = trim((string) ($settings['sharedRecordLocksMySqlConnectionString'] ?? ''));
    $useApplicationsConnection = ($settings['sharedRecordLocksMySqlUseApplicationsConnection'] ?? true) !== false;
    if ($environmentConnection !== '' || $dedicatedConnection !== '' || $useApplicationsConnection) {
        $connection = gateway_parse_connection_string(
            $environmentConnection !== ''
                ? $environmentConnection
                : ($dedicatedConnection !== ''
                    ? $dedicatedConnection
                    : (string) ($settings['studentApplicationsMySqlConnectionString'] ?? ''))
        );
    } else {
        $connection = [
            'host' => (string) ($settings['sharedRecordLocksMySqlHost'] ?? ''),
            'port' => (string) ($settings['sharedRecordLocksMySqlPort'] ?? '3306'),
            'database' => (string) ($settings['sharedRecordLocksMySqlDatabase'] ?? ''),
            'user' => (string) ($settings['sharedRecordLocksMySqlUser'] ?? ''),
            'password' => (string) ($settings['sharedRecordLocksMySqlPassword'] ?? ''),
        ];
    }
    $host = trim((string) ($connection['server'] ?? $connection['host'] ?? ''));
    $database = trim((string) ($connection['database'] ?? ''));
    $user = trim((string) ($connection['uid'] ?? $connection['user'] ?? ''));
    $password = (string) ($connection['pwd'] ?? $connection['password'] ?? '');
    $port = max(1, (int) ($connection['port'] ?? 3306));
    if ($host === '' || $database === '' || $user === '' || $password === '') {
        throw new RuntimeException('Не настроено подключение MySQL для блокировок записей.');
    }
    $candidateHosts = preg_match('/\.timeweb\.ru$/i', $host)
        ? array_values(array_unique(['127.0.0.1', 'localhost', $host]))
        : [$host];
    $lastError = null;
    foreach ($candidateHosts as $candidateHost) {
        try {
            $pdo = new PDO(
                'mysql:host=' . $candidateHost . ';port=' . $port . ';dbname=' . $database . ';charset=utf8mb4',
                $user,
                $password,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_TIMEOUT => 10,
                    PDO::ATTR_EMULATE_PREPARES => true,
                ]
            );
            $pdo->exec("SET time_zone = '+00:00'");
            return $pdo;
        } catch (PDOException $error) {
            $lastError = $error;
            $pdo = null;
        }
    }
    throw $lastError ?? new RuntimeException('Не удалось подключиться к MySQL блокировок.');
}

function gateway_shared_state_key(): string
{
    $key = trim((string) (getenv('AIS_SHARED_STATE_KEY') ?: 'main'));
    return substr($key !== '' ? $key : 'main', 0, 64);
}

function gateway_shared_state_ensure_tables(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS ais_shared_state_meta (
  state_key VARCHAR(64) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(160) NOT NULL DEFAULT '',
  PRIMARY KEY (state_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS ais_shared_state_entries (
  state_key VARCHAR(64) NOT NULL,
  entry_type VARCHAR(32) NOT NULL,
  group_name VARCHAR(120) NOT NULL DEFAULT '',
  item_key VARCHAR(191) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  data_json LONGTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (state_key, entry_type, group_name, item_key),
  KEY ais_shared_state_entries_order (state_key, entry_type, group_name, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
}

function gateway_shared_state_meta(PDO $pdo, bool $forUpdate = false): ?array
{
    $sql = 'SELECT revision, updated_at, updated_by FROM ais_shared_state_meta WHERE state_key = ?'
        . ($forUpdate ? ' FOR UPDATE' : ' LIMIT 1');
    $statement = $pdo->prepare($sql);
    try {
        $statement->execute([gateway_shared_state_key()]);
    } catch (PDOException $error) {
        if ((int) ($error->errorInfo[1] ?? 0) !== 1146) {
            throw $error;
        }
        gateway_shared_state_ensure_tables($pdo);
        $statement = $pdo->prepare($sql);
        $statement->execute([gateway_shared_state_key()]);
    }
    $row = $statement->fetch();
    return is_array($row) ? $row : null;
}

function gateway_shared_state_decode_value(mixed $value): mixed
{
    $decoded = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    return $decoded;
}

function gateway_shared_state_read_data(PDO $pdo): array
{
    $statement = $pdo->prepare(<<<'SQL'
SELECT entry_type, group_name, item_key, sort_order, data_json
FROM ais_shared_state_entries
WHERE state_key = ?
ORDER BY entry_type, group_name, sort_order, item_key
SQL);
    $statement->execute([gateway_shared_state_key()]);
    $data = ['collections' => [], 'dictionaries' => [], 'meta' => []];
    $collections = [];
    $replacements = [];
    while ($row = $statement->fetch()) {
        $type = (string) ($row['entry_type'] ?? '');
        $group = (string) ($row['group_name'] ?? '');
        $key = (string) ($row['item_key'] ?? '');
        if ($type === 'collection_meta') {
            $collections[$group] ??= [];
            continue;
        }
        if ($type === 'collection_replace') {
            $replacements[$group] = gateway_shared_state_decode_value($row['data_json'] ?? '[]');
            continue;
        }
        if ($type === 'collection') {
            $collections[$group] ??= [];
            $collections[$group][] = [
                'order' => (int) ($row['sort_order'] ?? 0),
                'key' => $key,
                'value' => gateway_shared_state_decode_value($row['data_json'] ?? 'null'),
            ];
            continue;
        }
        if ($type === 'dictionary') {
            $data['dictionaries'][$key] = gateway_shared_state_decode_value($row['data_json'] ?? 'null');
        } elseif ($type === 'meta') {
            $data['meta'][$key] = gateway_shared_state_decode_value($row['data_json'] ?? 'null');
        } elseif ($type === 'root') {
            $data[$key] = gateway_shared_state_decode_value($row['data_json'] ?? 'null');
        }
    }
    foreach ($collections as $name => $items) {
        usort($items, static fn (array $left, array $right): int =>
            $left['order'] <=> $right['order'] ?: strcmp((string) $left['key'], (string) $right['key'])
        );
        $data['collections'][$name] = array_map(
            static fn (array $item): mixed => $item['value'],
            $items
        );
    }
    foreach ($replacements as $name => $value) {
        $data['collections'][$name] = is_array($value) ? $value : [];
    }
    return $data;
}

function gateway_shared_state_protected_recycle_bin_ids(
    array $currentData,
    ?array $patch,
    ?array $replacementData
): array {
    $currentRows = is_array($currentData['collections']['recycleBin'] ?? null)
        ? $currentData['collections']['recycleBin']
        : [];
    $currentById = [];
    foreach ($currentRows as $row) {
        $id = is_array($row) ? trim((string) ($row['id'] ?? '')) : '';
        if ($id !== '') {
            $currentById[$id] = $row;
        }
    }
    if ($currentById === []) {
        return [];
    }
    if ($replacementData !== null) {
        $nextRows = is_array($replacementData['collections']['recycleBin'] ?? null)
            ? $replacementData['collections']['recycleBin']
            : [];
    } else {
        $change = is_array($patch['collections']['recycleBin'] ?? null)
        ? $patch['collections']['recycleBin']
        : null;
        if ($change === null) {
            return [];
        }
        if (is_array($change['replace'] ?? null)) {
            $nextRows = $change['replace'];
        } else {
            $nextById = $currentById;
            foreach (is_array($change['deletes'] ?? null) ? $change['deletes'] : [] as $id) {
                unset($nextById[trim((string) $id)]);
            }
            foreach (is_array($change['upserts'] ?? null) ? $change['upserts'] : [] as $row) {
                $id = is_array($row) ? trim((string) ($row['id'] ?? '')) : '';
                if ($id !== '') {
                    $nextById[$id] = $row;
                }
            }
            $nextRows = array_values($nextById);
        }
    }
    $nextById = [];
    foreach ($nextRows as $row) {
        $id = is_array($row) ? trim((string) ($row['id'] ?? '')) : '';
        if ($id !== '') {
            $nextById[$id] = $row;
        }
    }
    $protected = [];
    foreach ($currentById as $id => $row) {
        if (!isset($nextById[$id]) || json_encode($nextById[$id]) !== json_encode($row)) {
            $protected[] = $id;
        }
    }
    return $protected;
}

function gateway_shared_state_version(int $revision): string
{
    return 'mysql-' . max(0, $revision);
}

function gateway_shared_state_iso_date(string $value): string
{
    $date = new DateTimeImmutable($value, new DateTimeZone('UTC'));
    return $date->format('Y-m-d\TH:i:s.v\Z');
}

function gateway_shared_state_public_meta(?array $meta): array
{
    $revision = max(0, (int) ($meta['revision'] ?? 0));
    return [
        'exists' => $meta !== null,
        'revision' => $revision,
        'backendId' => gateway_shared_state_snapshot_backend_id(),
        'versionTag' => $meta !== null ? gateway_shared_state_version($revision) : '',
        'updatedAt' => $meta !== null ? gateway_shared_state_iso_date((string) $meta['updated_at']) : '',
        'updatedBy' => (string) ($meta['updated_by'] ?? ''),
        'source' => 'mysql',
        'offline' => false,
        'writable' => true,
        'pendingCount' => 0,
    ];
}

function gateway_shared_state_snapshot_backend_id(): string
{
    static $backendId = null;
    if (is_string($backendId)) {
        return $backendId;
    }
    $settings = gateway_server_settings();
    $environmentConnection = trim((string) (getenv('AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING') ?: ''));
    $dedicatedConnection = trim((string) ($settings['sharedRecordLocksMySqlConnectionString'] ?? ''));
    $useApplicationsConnection = ($settings['sharedRecordLocksMySqlUseApplicationsConnection'] ?? true) !== false;
    if ($environmentConnection !== '' || $dedicatedConnection !== '' || $useApplicationsConnection) {
        $connection = gateway_parse_connection_string(
            $environmentConnection !== ''
                ? $environmentConnection
                : ($dedicatedConnection !== ''
                    ? $dedicatedConnection
                    : (string) ($settings['studentApplicationsMySqlConnectionString'] ?? ''))
        );
    } else {
        $connection = [
            'host' => (string) ($settings['sharedRecordLocksMySqlHost'] ?? ''),
            'port' => (string) ($settings['sharedRecordLocksMySqlPort'] ?? '3306'),
            'database' => (string) ($settings['sharedRecordLocksMySqlDatabase'] ?? ''),
            'user' => (string) ($settings['sharedRecordLocksMySqlUser'] ?? ''),
        ];
    }
    $identity = [
        'host' => strtolower(trim((string) ($connection['server'] ?? $connection['host'] ?? ''))),
        'port' => max(1, (int) ($connection['port'] ?? 3306)),
        'database' => trim((string) ($connection['database'] ?? '')),
        'user' => trim((string) ($connection['uid'] ?? $connection['user'] ?? '')),
    ];
    $encoded = json_encode($identity, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $backendId = hash('sha256', is_string($encoded) ? $encoded : serialize($identity));
    return $backendId;
}

function gateway_shared_state_snapshot_base_path(): string
{
    $suffix = substr(
        hash('sha256', gateway_shared_state_snapshot_backend_id() . '|' . gateway_shared_state_key()),
        0,
        24
    );
    return ais_auth_storage_root() . '/shared-state-snapshot-' . $suffix;
}

function gateway_shared_state_snapshot_meta_path(): string
{
    return gateway_shared_state_snapshot_base_path() . '.meta.json';
}

function gateway_shared_state_snapshot_data_path(): string
{
    return gateway_shared_state_snapshot_base_path() . '.data.json';
}

function gateway_shared_state_snapshot_with_lock(callable $operation): mixed
{
    $lockPath = gateway_shared_state_snapshot_base_path() . '.lock';
    $lock = fopen($lockPath, 'c+');
    if ($lock === false) {
        throw new RuntimeException('Не удалось открыть блокировку снимка общей базы.');
    }
    @chmod($lockPath, 0600);
    try {
        if (!flock($lock, LOCK_EX)) {
            throw new RuntimeException('Не удалось заблокировать снимок общей базы.');
        }
        return $operation();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function gateway_shared_state_snapshot_write_json(string $path, array $payload): void
{
    $json = json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );
    if ($json === false) {
        throw new RuntimeException('Не удалось подготовить снимок общей базы.');
    }
    $temporary = $path . '.tmp-' . bin2hex(random_bytes(6));
    if (file_put_contents($temporary, $json, LOCK_EX) === false) {
        @unlink($temporary);
        throw new RuntimeException('Не удалось сохранить снимок общей базы.');
    }
    @chmod($temporary, 0600);
    if (!rename($temporary, $path)) {
        @unlink($temporary);
        throw new RuntimeException('Не удалось обновить снимок общей базы.');
    }
}

function gateway_shared_state_snapshot_read_meta(): ?array
{
    $path = gateway_shared_state_snapshot_meta_path();
    if (!is_file($path)) {
        return null;
    }
    $payload = json_decode((string) file_get_contents($path), true);
    if (
        !is_array($payload)
        || (int) ($payload['schemaVersion'] ?? 0) !== 1
        || (string) ($payload['stateKey'] ?? '') !== gateway_shared_state_key()
        || (string) ($payload['backendId'] ?? '') !== gateway_shared_state_snapshot_backend_id()
        || !is_array($payload['meta'] ?? null)
    ) {
        return null;
    }
    return $payload['meta'];
}

function gateway_shared_state_snapshot_read_data(int $revision): ?array
{
    if ($revision <= 0) {
        return null;
    }
    $path = gateway_shared_state_snapshot_data_path();
    if (!is_file($path)) {
        return null;
    }
    $payload = json_decode((string) file_get_contents($path), true);
    if (
        !is_array($payload)
        || (int) ($payload['schemaVersion'] ?? 0) !== 1
        || (string) ($payload['stateKey'] ?? '') !== gateway_shared_state_key()
        || (string) ($payload['backendId'] ?? '') !== gateway_shared_state_snapshot_backend_id()
        || (int) ($payload['revision'] ?? 0) !== $revision
        || !is_array($payload['data'] ?? null)
    ) {
        return null;
    }
    return $payload['data'];
}

function gateway_shared_state_snapshot_store(array $meta, array $data, bool $lockHeld = false): void
{
    $revision = max(0, (int) ($meta['revision'] ?? 0));
    if ($revision <= 0) {
        return;
    }
    if (!$lockHeld) {
        try {
            gateway_shared_state_snapshot_with_lock(
                static function () use ($meta, $data): mixed {
                    gateway_shared_state_snapshot_store($meta, $data, true);
                    return null;
                }
            );
        } catch (Throwable) {
            // The snapshot is only an optimization. Preserve the last complete
            // snapshot if the lock or a temporary file cannot be created.
        }
        return;
    }
    $currentMeta = gateway_shared_state_snapshot_read_meta();
    $currentRevision = max(0, (int) ($currentMeta['revision'] ?? 0));
    if ($currentRevision > $revision) {
        return;
    }
    try {
        gateway_shared_state_snapshot_write_json(gateway_shared_state_snapshot_data_path(), [
            'schemaVersion' => 1,
            'stateKey' => gateway_shared_state_key(),
            'backendId' => gateway_shared_state_snapshot_backend_id(),
            'revision' => $revision,
            'data' => $data,
        ]);
        gateway_shared_state_snapshot_write_json(gateway_shared_state_snapshot_meta_path(), [
            'schemaVersion' => 1,
            'stateKey' => gateway_shared_state_key(),
            'backendId' => gateway_shared_state_snapshot_backend_id(),
            'meta' => $meta,
        ]);
    } catch (Throwable) {
        $latestMeta = gateway_shared_state_snapshot_read_meta();
        $latestRevision = max(0, (int) ($latestMeta['revision'] ?? 0));
        if ($latestRevision <= $revision) {
            @unlink(gateway_shared_state_snapshot_data_path());
            try {
                gateway_shared_state_snapshot_write_json(gateway_shared_state_snapshot_meta_path(), [
                    'schemaVersion' => 1,
                    'stateKey' => gateway_shared_state_key(),
                    'backendId' => gateway_shared_state_snapshot_backend_id(),
                    'meta' => ['revision' => $revision],
                ]);
            } catch (Throwable) {
                @unlink(gateway_shared_state_snapshot_meta_path());
            }
        }
    }
}

function gateway_shared_state_snapshot_invalidate(
    ?int $revision = null,
    bool $lockHeld = false,
    ?array $meta = null
): void
{
    if (!$lockHeld) {
        try {
            gateway_shared_state_snapshot_with_lock(
                static function () use ($revision, $meta): mixed {
                    gateway_shared_state_snapshot_invalidate($revision, true, $meta);
                    return null;
                }
            );
        } catch (Throwable) {
            // A later revision may already own the snapshot. Do not remove it
            // without the lock merely because cache invalidation failed.
        }
        return;
    }
    if ($revision !== null) {
        $revision = max(0, $revision);
        $currentMeta = gateway_shared_state_snapshot_read_meta();
        $currentRevision = max(0, (int) ($currentMeta['revision'] ?? 0));
        if ($currentRevision >= $revision) {
            return;
        }
        @unlink(gateway_shared_state_snapshot_data_path());
        $markerMeta = $meta !== null && (int) ($meta['revision'] ?? 0) === $revision
            ? $meta
            : ['revision' => $revision];
        try {
            gateway_shared_state_snapshot_write_json(gateway_shared_state_snapshot_meta_path(), [
                'schemaVersion' => 1,
                'stateKey' => gateway_shared_state_key(),
                'backendId' => gateway_shared_state_snapshot_backend_id(),
                'meta' => $markerMeta,
            ]);
        } catch (Throwable) {
            @unlink(gateway_shared_state_snapshot_meta_path());
        }
        return;
    }
    @unlink(gateway_shared_state_snapshot_meta_path());
    @unlink(gateway_shared_state_snapshot_data_path());
}

function gateway_shared_state_snapshot_cached(int $expectedRevision = 0): ?array
{
    $meta = gateway_shared_state_snapshot_read_meta();
    $revision = max(0, (int) ($meta['revision'] ?? 0));
    if ($meta === null || $revision <= 0 || ($expectedRevision > 0 && $revision !== $expectedRevision)) {
        return null;
    }
    $data = gateway_shared_state_snapshot_read_data($revision);
    return $data === null ? null : ['meta' => $meta, 'data' => $data];
}

function gateway_shared_state_snapshot_refresh(PDO $pdo, bool $includeData = true): array
{
    return gateway_shared_state_snapshot_with_lock(static function () use ($pdo, $includeData): array {
        for ($attempt = 0; $attempt < 4; $attempt += 1) {
            $metaBefore = gateway_shared_state_meta($pdo);
            if ($metaBefore === null) {
                gateway_shared_state_snapshot_invalidate(null, true);
                return ['meta' => null, 'data' => null];
            }
            $revisionBefore = max(0, (int) ($metaBefore['revision'] ?? 0));
            $cachedMeta = gateway_shared_state_snapshot_read_meta();
            if (max(0, (int) ($cachedMeta['revision'] ?? 0)) === $revisionBefore) {
                if (!$includeData) {
                    return ['meta' => $metaBefore, 'data' => null];
                }
                $cachedData = gateway_shared_state_snapshot_read_data($revisionBefore);
                if ($cachedData !== null) {
                    return ['meta' => $metaBefore, 'data' => $cachedData];
                }
            }
            $data = gateway_shared_state_read_data($pdo);
            $metaAfter = gateway_shared_state_meta($pdo);
            $revisionAfter = max(0, (int) ($metaAfter['revision'] ?? 0));
            if ($metaAfter === null || $revisionAfter !== $revisionBefore) {
                continue;
            }
            gateway_shared_state_snapshot_store($metaAfter, $data, true);
            return ['meta' => $metaAfter, 'data' => $data];
        }
        throw new RuntimeException(
            'Общая база изменялась во время подготовки снимка. Повторите запрос.'
        );
    });
}

function gateway_shared_state_upsert_entry(
    PDOStatement $statement,
    string $type,
    string $group,
    string $key,
    int $order,
    mixed $value
): void {
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $statement->execute([gateway_shared_state_key(), $type, $group, $key, $order, $json]);
}

function gateway_shared_state_replace_data(PDO $pdo, array $data): void
{
    if (!is_array($data['collections'] ?? null) || !is_array($data['dictionaries'] ?? null)) {
        throw new InvalidArgumentException('Общая база передана в некорректном формате.');
    }
    $delete = $pdo->prepare('DELETE FROM ais_shared_state_entries WHERE state_key = ?');
    $delete->execute([gateway_shared_state_key()]);
    $insert = $pdo->prepare(<<<'SQL'
INSERT INTO ais_shared_state_entries
  (state_key, entry_type, group_name, item_key, sort_order, data_json, updated_at)
VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  sort_order = VALUES(sort_order), data_json = VALUES(data_json), updated_at = VALUES(updated_at)
SQL);
    foreach ($data['collections'] as $name => $rows) {
        if (!preg_match('/^[A-Za-z0-9_-]{1,120}$/', (string) $name)) {
            continue;
        }
        $rows = is_array($rows) ? array_values($rows) : [];
        gateway_shared_state_upsert_entry($insert, 'collection_meta', (string) $name, '__collection__', 0, null);
        $rowsHaveIds = true;
        foreach ($rows as $row) {
            if (!is_array($row) || trim((string) ($row['id'] ?? '')) === '') {
                $rowsHaveIds = false;
                break;
            }
        }
        if (!$rowsHaveIds) {
            gateway_shared_state_upsert_entry($insert, 'collection_replace', (string) $name, '__replace__', 0, $rows);
            continue;
        }
        foreach ($rows as $index => $row) {
            gateway_shared_state_upsert_entry(
                $insert,
                'collection',
                (string) $name,
                (string) $row['id'],
                (int) $index,
                $row
            );
        }
    }
    foreach (['dictionaries' => 'dictionary', 'meta' => 'meta'] as $group => $type) {
        foreach (is_array($data[$group] ?? null) ? $data[$group] : [] as $name => $value) {
            gateway_shared_state_upsert_entry($insert, $type, '', (string) $name, 0, $value);
        }
    }
    foreach ($data as $name => $value) {
        if (in_array($name, ['collections', 'dictionaries', 'meta'], true)) {
            continue;
        }
        gateway_shared_state_upsert_entry($insert, 'root', '', (string) $name, 0, $value);
    }
}

function gateway_shared_state_apply_patch(PDO $pdo, array $patch): void
{
    $insert = $pdo->prepare(<<<'SQL'
INSERT INTO ais_shared_state_entries
  (state_key, entry_type, group_name, item_key, sort_order, data_json, updated_at)
VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), updated_at = VALUES(updated_at)
SQL);
    $insertWithOrder = $pdo->prepare(<<<'SQL'
INSERT INTO ais_shared_state_entries
  (state_key, entry_type, group_name, item_key, sort_order, data_json, updated_at)
VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  sort_order = VALUES(sort_order), data_json = VALUES(data_json), updated_at = VALUES(updated_at)
SQL);
    $deleteCollection = $pdo->prepare(<<<'SQL'
DELETE FROM ais_shared_state_entries
WHERE state_key = ? AND group_name = ?
  AND entry_type IN ('collection', 'collection_meta', 'collection_replace')
SQL);
    $deleteReplacement = $pdo->prepare(<<<'SQL'
DELETE FROM ais_shared_state_entries
WHERE state_key = ? AND group_name = ? AND entry_type = 'collection_replace'
SQL);
    $deleteRecord = $pdo->prepare(<<<'SQL'
DELETE FROM ais_shared_state_entries
WHERE state_key = ? AND entry_type = 'collection' AND group_name = ? AND item_key = ?
SQL);
    $updateOrder = $pdo->prepare(<<<'SQL'
UPDATE ais_shared_state_entries
SET sort_order = ?, updated_at = UTC_TIMESTAMP(3)
WHERE state_key = ? AND entry_type = 'collection' AND group_name = ? AND item_key = ?
SQL);
    foreach (is_array($patch['collections'] ?? null) ? $patch['collections'] : [] as $name => $change) {
        $name = (string) $name;
        if (!preg_match('/^[A-Za-z0-9_-]{1,120}$/', $name) || !is_array($change)) {
            continue;
        }
        if (is_array($change['replace'] ?? null)) {
            $deleteCollection->execute([gateway_shared_state_key(), $name]);
            gateway_shared_state_upsert_entry($insertWithOrder, 'collection_meta', $name, '__collection__', 0, null);
            $rows = array_values($change['replace']);
            $rowsHaveIds = true;
            foreach ($rows as $row) {
                if (!is_array($row) || trim((string) ($row['id'] ?? '')) === '') {
                    $rowsHaveIds = false;
                    break;
                }
            }
            if (!$rowsHaveIds) {
                gateway_shared_state_upsert_entry($insertWithOrder, 'collection_replace', $name, '__replace__', 0, $rows);
            } else {
                foreach ($rows as $index => $row) {
                    gateway_shared_state_upsert_entry($insertWithOrder, 'collection', $name, (string) $row['id'], (int) $index, $row);
                }
            }
            continue;
        }
        gateway_shared_state_upsert_entry($insert, 'collection_meta', $name, '__collection__', 0, null);
        $deleteReplacement->execute([gateway_shared_state_key(), $name]);
        foreach (is_array($change['deletes'] ?? null) ? $change['deletes'] : [] as $id) {
            $deleteRecord->execute([gateway_shared_state_key(), $name, (string) $id]);
        }
        $order = is_array($change['order'] ?? null) ? array_values($change['order']) : [];
        $orderById = array_flip(array_map('strval', $order));
        foreach (is_array($change['upserts'] ?? null) ? $change['upserts'] : [] as $index => $row) {
            if (!is_array($row) || trim((string) ($row['id'] ?? '')) === '') {
                continue;
            }
            $id = (string) $row['id'];
            gateway_shared_state_upsert_entry(
                $order !== [] ? $insertWithOrder : $insert,
                'collection',
                $name,
                $id,
                isset($orderById[$id]) ? (int) $orderById[$id] : 1000000000 + (int) $index,
                $row
            );
        }
        foreach ($order as $index => $id) {
            $updateOrder->execute([(int) $index, gateway_shared_state_key(), $name, (string) $id]);
        }
    }
    foreach (['dictionaries' => 'dictionary', 'meta' => 'meta', 'root' => 'root'] as $group => $type) {
        foreach (is_array($patch[$group] ?? null) ? $patch[$group] : [] as $name => $value) {
            gateway_shared_state_upsert_entry($insert, $type, '', (string) $name, 0, $value);
        }
    }
}

function gateway_shared_state_lock_conflict(PDO $pdo, array $patch, string $clientId): ?array
{
    $select = $pdo->prepare(<<<'SQL'
SELECT entity_type, entity_id, client_id, owner_login, owner_name, acquired_at, expires_at
FROM ais_record_locks
WHERE entity_type = ? AND entity_id = ? AND expires_at > UTC_TIMESTAMP(3) AND client_id <> ?
LIMIT 1
SQL);
    foreach (is_array($patch['collections'] ?? null) ? $patch['collections'] : [] as $collection => $change) {
        if (!is_array($change)) {
            continue;
        }
        $ids = [];
        foreach (is_array($change['upserts'] ?? null) ? $change['upserts'] : [] as $row) {
            if (is_array($row) && trim((string) ($row['id'] ?? '')) !== '') {
                $ids[] = (string) $row['id'];
            }
        }
        foreach (is_array($change['deletes'] ?? null) ? $change['deletes'] : [] as $id) {
            $ids[] = (string) $id;
        }
        foreach (array_unique($ids) as $id) {
            $select->execute([(string) $collection, $id, $clientId]);
            $row = $select->fetch();
            if (is_array($row)) {
                return $row;
            }
        }
    }
    return null;
}

function gateway_handle_shared_state(string $method, string $body, array $currentUser): void
{
    $pdo = gateway_record_locks_pdo();
    if ($method === 'GET') {
        $metadataOnly = ($_GET['metadata'] ?? '') === '1';
        $expectedRevision = max(0, (int) ($_GET['revision'] ?? 0));
        $usePreparedSnapshot = !$metadataOnly
            && ($_GET['snapshot'] ?? '') === '1'
            && $expectedRevision > 0;
        $snapshot = $usePreparedSnapshot
            ? gateway_shared_state_snapshot_cached($expectedRevision)
            : null;
        if ($snapshot === null) {
            $snapshot = gateway_shared_state_snapshot_refresh($pdo, !$metadataOnly);
        }
        $response = gateway_shared_state_public_meta($snapshot['meta']);
        if (!$metadataOnly) {
            $response['warning'] = '';
            $response['data'] = $snapshot['data'];
        }
        gateway_json(200, $response);
    }
    if ($method !== 'POST') {
        gateway_fail(405, 'Method not allowed');
    }
    if (strlen($body) > 40 * 1024 * 1024) {
        gateway_fail(413, 'Пакет синхронизации превышает допустимый размер.');
    }
    $payload = json_decode($body, true);
    if (!is_array($payload)) {
        gateway_fail(400, 'Некорректный JSON общей базы.');
    }
    $patch = is_array($payload['patch'] ?? null) ? $payload['patch'] : null;
    $data = is_array($payload['data'] ?? null) ? $payload['data'] : null;
    if ($patch === null && $data === null) {
        gateway_fail(400, 'Не переданы изменения общей базы.');
    }
    $requestedRevision = max(0, (int) ($payload['baseRevision'] ?? 0));
    $clientId = substr(trim((string) ($payload['clientId'] ?? '')), 0, 160);
    if ($patch !== null) {
        $locked = gateway_shared_state_lock_conflict($pdo, $patch, $clientId);
        if ($locked !== null) {
            gateway_json(423, [
                'error' => 'Одна из изменяемых записей сейчас заблокирована другим пользователем.',
                'locked' => true,
                'lock' => gateway_public_record_lock($locked, $clientId),
            ]);
        }
    }
    $pdo->beginTransaction();
    try {
        $meta = gateway_shared_state_meta($pdo, true);
        $currentRevision = max(0, (int) ($meta['revision'] ?? 0));
        if ($patch === null && $requestedRevision !== $currentRevision) {
            $pdo->rollBack();
            gateway_json(409, [
                'error' => 'Общая база уже изменена другим пользователем.',
                'conflict' => true,
                ...gateway_shared_state_public_meta($meta),
            ]);
        }
        if ($meta === null && $data === null) {
            throw new RuntimeException('Общая база ещё не создана.');
        }
        $recycleBinChange = is_array($patch['collections']['recycleBin'] ?? null)
            ? $patch['collections']['recycleBin']
            : null;
        $canChangeRecycleBin = $data !== null || (
            $recycleBinChange !== null
            && (
                is_array($recycleBinChange['replace'] ?? null)
                || (is_array($recycleBinChange['deletes'] ?? null)
                    && $recycleBinChange['deletes'] !== [])
                || (is_array($recycleBinChange['upserts'] ?? null)
                    && $recycleBinChange['upserts'] !== [])
            )
        );
        if ($meta !== null && $canChangeRecycleBin) {
            $protectedRecycleBinIds = gateway_shared_state_protected_recycle_bin_ids(
                gateway_shared_state_read_data($pdo),
                $patch,
                $data
            );
            if ($protectedRecycleBinIds !== []) {
                $pdo->rollBack();
                gateway_fail(
                    403,
                    'Удалять или изменять элементы корзины через общую синхронизацию запрещено. '
                    . 'Используйте восстановление или административное безвозвратное удаление.'
                );
            }
        }
        if ($data !== null) {
            gateway_shared_state_replace_data($pdo, $data);
        } else {
            gateway_shared_state_apply_patch($pdo, $patch);
        }
        $nextRevision = $currentRevision + 1;
        $updatedBy = substr((string) ($currentUser['login'] ?? $currentUser['name'] ?? 'system'), 0, 160);
        $upsertMeta = $pdo->prepare(<<<'SQL'
INSERT INTO ais_shared_state_meta (state_key, revision, updated_at, updated_by)
VALUES (?, ?, UTC_TIMESTAMP(3), ?)
ON DUPLICATE KEY UPDATE
  revision = VALUES(revision), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)
SQL);
        $upsertMeta->execute([gateway_shared_state_key(), $nextRevision, $updatedBy]);
        $savedMeta = gateway_shared_state_meta($pdo);
        $merged = $patch !== null && $requestedRevision !== $currentRevision;
        $savedData = null;
        if ($data !== null || $merged) {
            $savedData = gateway_shared_state_read_data($pdo);
        }
        $pdo->commit();
        if ($savedData !== null && $savedMeta !== null) {
            gateway_shared_state_snapshot_store($savedMeta, $savedData);
        } else {
            gateway_shared_state_snapshot_invalidate($nextRevision, false, $savedMeta);
        }
        $response = [
            'ok' => true,
            'conflict' => false,
            'locked' => false,
            'merged' => $merged,
            ...gateway_shared_state_public_meta($savedMeta),
        ];
        if ($response['merged']) {
            $response['data'] = $savedData;
        } else {
            $response['data'] = null;
        }
        gateway_json(200, $response);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

function gateway_trash_error(string $message, int $status = 400): RuntimeException
{
    return new RuntimeException($message, $status);
}

function gateway_trash_request(array $payload, bool $permanentDelete): array
{
    $id = trim(str_replace("\0", '', (string) ($payload['id'] ?? '')));
    if ($id === '' || mb_strlen($id, 'UTF-8') > 191 || preg_match('/[\r\n]/u', $id)) {
        throw gateway_trash_error('Не указан элемент корзины.');
    }
    $baseRevision = filter_var(
        $payload['baseRevision'] ?? null,
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 0]]
    );
    if ($baseRevision === false) {
        throw gateway_trash_error('Не указана ревизия общей базы.');
    }
    if ($permanentDelete) {
        $confirmationPhrase = (string) (
            $payload['confirmationPhrase'] ?? $payload['phrase'] ?? ''
        );
        if (($payload['confirmed'] ?? null) !== true || $confirmationPhrase !== 'Удалить') {
            throw gateway_trash_error(
                'Безвозвратное удаление не подтверждено фразой «Удалить».'
            );
        }
    }
    return ['id' => $id, 'baseRevision' => (int) $baseRevision];
}

function gateway_trash_find_item(array $data, string $id): array
{
    $rows = is_array($data['collections']['recycleBin'] ?? null)
        ? array_values($data['collections']['recycleBin'])
        : [];
    $indexes = [];
    foreach ($rows as $index => $item) {
        if (is_array($item) && trim((string) ($item['id'] ?? '')) === $id) {
            $indexes[] = (int) $index;
        }
    }
    if ($indexes === []) {
        throw gateway_trash_error('Элемент корзины не найден.', 404);
    }
    if (count($indexes) !== 1) {
        throw gateway_trash_error(
            'В корзине найдены дубли элемента. Операция остановлена.',
            409
        );
    }
    $index = $indexes[0];
    return ['rows' => $rows, 'index' => $index, 'item' => $rows[$index]];
}

function gateway_trash_restore_mutation(array $data, string $id): array
{
    $found = gateway_trash_find_item($data, $id);
    $item = $found['item'];
    $collection = trim((string) ($item['collection'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{1,120}$/', $collection) || $collection === 'recycleBin') {
        throw gateway_trash_error(
            'Элемент корзины повреждён: не указан раздел восстановления.',
            409
        );
    }
    $record = $item['record'] ?? null;
    if (!is_array($record)) {
        throw gateway_trash_error(
            'Элемент корзины повреждён: нет снимка записи.',
            409
        );
    }
    $recordId = trim((string) ($record['id'] ?? ''));
    if ($recordId === '' || mb_strlen($recordId, 'UTF-8') > 191) {
        throw gateway_trash_error(
            'Элемент корзины повреждён: нет идентификатора записи.',
            409
        );
    }
    if (trim((string) ($item['recordId'] ?? $recordId)) !== $recordId) {
        throw gateway_trash_error(
            'Элемент корзины повреждён: идентификаторы записи не совпадают.',
            409
        );
    }
    $targetRows = is_array($data['collections'][$collection] ?? null)
        ? array_values($data['collections'][$collection])
        : [];
    foreach ($targetRows as $activeRecord) {
        if (is_array($activeRecord) && trim((string) ($activeRecord['id'] ?? '')) === $recordId) {
            throw gateway_trash_error(
                'В активном разделе уже есть запись с таким идентификатором.',
                409
            );
        }
    }
    $related = $item['related']['globalDirectExpenses'] ?? [];
    if (!is_array($related)) {
        throw gateway_trash_error(
            'Элемент корзины повреждён: некорректны связанные затраты.',
            409
        );
    }
    $expenseIds = [];
    foreach ($related as $expense) {
        $expenseId = is_array($expense) ? trim((string) ($expense['id'] ?? '')) : '';
        if ($expenseId === '') {
            throw gateway_trash_error(
                'Элемент корзины повреждён: связанные затраты не имеют идентификатора.',
                409
            );
        }
        if (isset($expenseIds[$expenseId]) || ($collection === 'directExpenses' && $expenseId === $recordId)) {
            throw gateway_trash_error(
                'В снимке корзины найдены дубли связанных затрат.',
                409
            );
        }
        $expenseIds[$expenseId] = true;
    }
    $activeExpenses = is_array($data['collections']['directExpenses'] ?? null)
        ? array_values($data['collections']['directExpenses'])
        : [];
    $activeExpensesById = [];
    foreach ($activeExpenses as $expense) {
        $expenseId = is_array($expense) ? trim((string) ($expense['id'] ?? '')) : '';
        if ($expenseId !== '') {
            $activeExpensesById[$expenseId] = $expense;
        }
    }
    $expensesToRestore = [];
    foreach ($related as $expense) {
        $expenseId = trim((string) ($expense['id'] ?? ''));
        if (!isset($activeExpensesById[$expenseId])) {
            $expensesToRestore[] = $expense;
            continue;
        }
        if (json_encode($activeExpensesById[$expenseId]) !== json_encode($expense)) {
            throw gateway_trash_error(
                'Одна из связанных затрат уже есть в активной базе с другими данными.',
                409
            );
        }
    }

    $originalIndex = filter_var(
        $item['originalIndex'] ?? count($targetRows),
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 0]]
    );
    if ($originalIndex === false) {
        $originalIndex = count($targetRows);
    }
    $originalIndex = min((int) $originalIndex, count($targetRows));
    array_splice($targetRows, $originalIndex, 0, [$record]);
    $data['collections'][$collection] = $targetRows;
    if ($expensesToRestore !== []) {
        $restoredExpenses = $collection === 'directExpenses'
            ? $data['collections']['directExpenses']
            : $activeExpenses;
        array_push($restoredExpenses, ...$expensesToRestore);
        $data['collections']['directExpenses'] = $restoredExpenses;
    }
    array_splice($found['rows'], (int) $found['index'], 1);
    $data['collections']['recycleBin'] = $found['rows'];
    return [$data, [
        'id' => $id,
        'collection' => $collection,
        'recordId' => $recordId,
        'label' => mb_substr((string) (
            $item['label'] ?? $record['fullName'] ?? $record['name'] ?? $recordId
        ), 0, 500, 'UTF-8'),
        'restoredExpenses' => count($expensesToRestore),
    ]];
}

function gateway_trash_permanent_delete_mutation(array $data, string $id): array
{
    $found = gateway_trash_find_item($data, $id);
    $item = $found['item'];
    array_splice($found['rows'], (int) $found['index'], 1);
    $data['collections']['recycleBin'] = $found['rows'];
    return [$data, [
        'id' => $id,
        'collection' => trim((string) ($item['collection'] ?? '')),
        'recordId' => trim((string) ($item['record']['id'] ?? $item['recordId'] ?? '')),
        'label' => mb_substr((string) (
            $item['label'] ?? $item['record']['fullName'] ?? $item['record']['name'] ?? $id
        ), 0, 500, 'UTF-8'),
    ]];
}

function gateway_handle_trash_route(
    string $method,
    string $path,
    string $body,
    array $currentUser
): void {
    if ($method !== 'POST') {
        gateway_fail(405, 'Method not allowed');
    }
    $permanentDelete = $path === '/api/admin/trash/permanent-delete';
    if ($permanentDelete) {
        gateway_require_admin($currentUser);
    }
    $request = gateway_trash_request(gateway_read_json_body($body), $permanentDelete);
    try {
        $pdo = gateway_record_locks_pdo();
    } catch (Throwable $error) {
        gateway_fail(503, 'Общая MySQL-база недоступна: ' . $error->getMessage());
    }
    try {
        $pdo->beginTransaction();
        $meta = gateway_shared_state_meta($pdo, true);
        $currentRevision = max(0, (int) ($meta['revision'] ?? 0));
        if ($request['baseRevision'] !== $currentRevision) {
            throw gateway_trash_error(
                'Общая база уже изменена другим пользователем.',
                409
            );
        }
        if ($meta === null) {
            throw gateway_trash_error('Общая база ещё не создана.', 409);
        }
        $data = gateway_shared_state_read_data($pdo);
        [$nextData, $summary] = $permanentDelete
            ? gateway_trash_permanent_delete_mutation($data, $request['id'])
            : gateway_trash_restore_mutation($data, $request['id']);
        gateway_shared_state_replace_data($pdo, $nextData);
        $nextRevision = $currentRevision + 1;
        $updatedBy = substr(
            (string) ($currentUser['login'] ?? $currentUser['name'] ?? 'system'),
            0,
            160
        );
        $upsertMeta = $pdo->prepare(<<<'SQL'
INSERT INTO ais_shared_state_meta (state_key, revision, updated_at, updated_by)
VALUES (?, ?, UTC_TIMESTAMP(3), ?)
ON DUPLICATE KEY UPDATE
  revision = VALUES(revision), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)
SQL);
        $upsertMeta->execute([gateway_shared_state_key(), $nextRevision, $updatedBy]);
        $savedMeta = gateway_shared_state_meta($pdo);
        $savedData = gateway_shared_state_read_data($pdo);
        $pdo->commit();
        ais_audit_try_append([
            'action' => $permanentDelete
                ? 'Безвозвратно удалён элемент корзины'
                : 'Восстановлена запись из корзины',
            'area' => 'Корзина',
            'entityType' => $permanentDelete ? 'recycleBin' : $summary['collection'],
            'entityId' => $permanentDelete ? $summary['id'] : $summary['recordId'],
            'entityLabel' => $summary['label'],
            'details' => $permanentDelete
                ? trim(
                    'Элемент корзины: ' . $summary['id'] . '; раздел: ' . $summary['collection']
                    . '.'
                )
                : 'Элемент корзины: ' . $summary['id']
                    . '; восстановлено связанных затрат: '
                    . $summary['restoredExpenses'],
            'source' => 'recycle-bin',
        ], $currentUser);
        if ($savedMeta !== null) {
            gateway_shared_state_snapshot_store($savedMeta, $savedData);
        } else {
            gateway_shared_state_snapshot_invalidate($nextRevision);
        }
        gateway_json(200, [
            'ok' => true,
            ($permanentDelete ? 'deleted' : 'restored') => $summary,
            ...gateway_shared_state_public_meta($savedMeta),
        ]);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        $status = $error instanceof PDOException ? 503 : (int) $error->getCode();
        gateway_fail($status >= 400 && $status <= 599 ? $status : 500, $error->getMessage());
    }
}

function gateway_record_lock_identifier(mixed $value, string $label): string
{
    $text = trim((string) $value);
    if ($text === '' || strlen($text) > 160 || !preg_match('/^[A-Za-z0-9_.:@-]+$/', $text)) {
        throw new InvalidArgumentException($label . ' блокировки указан некорректно.');
    }
    return $text;
}

function gateway_public_record_lock(?array $row, string $clientId): ?array
{
    if ($row === null) {
        return null;
    }
    $utc = new DateTimeZone('UTC');
    $acquiredAt = new DateTimeImmutable((string) $row['acquired_at'], $utc);
    $expiresAt = new DateTimeImmutable((string) $row['expires_at'], $utc);
    return [
        'entityType' => (string) $row['entity_type'],
        'entityId' => (string) $row['entity_id'],
        'ownerLogin' => (string) $row['owner_login'],
        'ownerName' => (string) $row['owner_name'],
        'acquiredAt' => $acquiredAt->format('Y-m-d\TH:i:s.v\Z'),
        'expiresAt' => $expiresAt->format('Y-m-d\TH:i:s.v\Z'),
        'ownedByClient' => $clientId !== '' && hash_equals((string) $row['client_id'], $clientId),
    ];
}

function gateway_handle_record_locks(string $method, string $body, array $currentUser): void
{
    $pdo = gateway_record_locks_pdo();
    if ($method === 'GET') {
        $clientId = trim((string) ($_GET['clientId'] ?? ''));
        $statement = $pdo->query(<<<'SQL'
SELECT entity_type, entity_id, client_id, owner_login, owner_name, acquired_at, expires_at
FROM ais_record_locks
WHERE expires_at > UTC_TIMESTAMP(3)
ORDER BY updated_at DESC
LIMIT 5000
SQL);
        $locks = [];
        while ($row = $statement->fetch()) {
            $locks[] = gateway_public_record_lock($row, $clientId);
        }
        gateway_json(200, [
            'locks' => $locks,
            'revision' => (int) floor(microtime(true) * 1000),
            'ttlMs' => 30000,
            'pollIntervalMs' => 1000,
            'source' => 'mysql',
        ]);
    }
    if ($method !== 'POST') {
        gateway_fail(405, 'Method not allowed');
    }
    $payload = json_decode($body, true);
    if (!is_array($payload)) {
        gateway_fail(400, 'Некорректный JSON запроса блокировки.');
    }
    $action = strtolower(trim((string) ($payload['action'] ?? 'acquire')));
    if (!in_array($action, ['acquire', 'renew', 'release'], true)) {
        gateway_fail(400, 'Неизвестное действие с блокировкой записи.');
    }
    $entityType = gateway_record_lock_identifier($payload['entityType'] ?? '', 'Раздел');
    $entityId = gateway_record_lock_identifier($payload['entityId'] ?? '', 'Идентификатор записи');
    $clientId = gateway_record_lock_identifier($payload['clientId'] ?? '', 'Идентификатор клиента');
    $pdo->beginTransaction();
    try {
        $select = $pdo->prepare(<<<'SQL'
SELECT entity_type, entity_id, client_id, owner_login, owner_name, acquired_at, expires_at
FROM ais_record_locks
WHERE entity_type = ? AND entity_id = ?
FOR UPDATE
SQL);
        $select->execute([$entityType, $entityId]);
        $existing = $select->fetch() ?: null;
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $existingActive = $existing !== null
            && new DateTimeImmutable((string) $existing['expires_at'], new DateTimeZone('UTC')) > $now;
        if ($existingActive && !hash_equals((string) $existing['client_id'], $clientId)) {
            $pdo->commit();
            gateway_json(423, [
                'error' => 'Запись уже редактируется другим пользователем.',
                'locked' => true,
                'lock' => gateway_public_record_lock($existing, $clientId),
            ]);
        }
        if ($action === 'release') {
            $delete = $pdo->prepare(
                'DELETE FROM ais_record_locks WHERE entity_type = ? AND entity_id = ? AND client_id = ?'
            );
            $delete->execute([$entityType, $entityId, $clientId]);
            $pdo->commit();
            gateway_json(200, [
                'ok' => true,
                'locked' => false,
                'released' => true,
                'lock' => null,
                'revision' => (int) floor(microtime(true) * 1000),
                'ttlMs' => 30000,
                'source' => 'mysql',
            ]);
        }
        $acquiredAt = $existingActive && hash_equals((string) $existing['client_id'], $clientId)
            ? new DateTimeImmutable((string) $existing['acquired_at'], new DateTimeZone('UTC'))
            : $now;
        $expiresAt = $now->modify('+30 seconds');
        $row = [
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'client_id' => $clientId,
            'owner_login' => mb_substr((string) ($currentUser['login'] ?? ''), 0, 160, 'UTF-8'),
            'owner_name' => mb_substr((string) ($currentUser['name'] ?? $currentUser['login'] ?? 'Пользователь'), 0, 240, 'UTF-8'),
            'acquired_at' => $acquiredAt->format('Y-m-d H:i:s.v'),
            'expires_at' => $expiresAt->format('Y-m-d H:i:s.v'),
            'updated_at' => $now->format('Y-m-d H:i:s.v'),
        ];
        $upsert = $pdo->prepare(<<<'SQL'
INSERT INTO ais_record_locks (
  entity_type, entity_id, client_id, owner_login, owner_name, acquired_at, expires_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  client_id = VALUES(client_id),
  owner_login = VALUES(owner_login),
  owner_name = VALUES(owner_name),
  acquired_at = VALUES(acquired_at),
  expires_at = VALUES(expires_at),
  updated_at = VALUES(updated_at)
SQL);
        $upsert->execute(array_values($row));
        $pdo->commit();
        gateway_json(200, [
            'ok' => true,
            'locked' => false,
            'released' => false,
            'lock' => gateway_public_record_lock($row, $clientId),
            'revision' => (int) floor(microtime(true) * 1000),
            'ttlMs' => 30000,
            'source' => 'mysql',
        ]);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

set_time_limit(AIS_GATEWAY_TIMEOUT_SECONDS + 20);
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if (!in_array($method, ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'], true)) {
    gateway_fail(405, 'Method not allowed');
}

$requestPath = gateway_request_path();
$isPreviewControlRequest = in_array($requestPath, [
    '/api/contracts/student-document-preview/finalize',
    '/api/contracts/student-document-preview/editor-start',
    '/api/contracts/student-document-preview/editor-save',
    '/api/contracts/student-document-preview/editor-discard',
    '/api/contracts/student-document-preview/cancel',
], true);
$requestBodyLimit = $isPreviewControlRequest ? 4096 : AIS_GATEWAY_MAX_REQUEST_BYTES;
$contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($contentLength > $requestBodyLimit) {
    gateway_fail(413, 'Размер запроса превышает допустимый предел.');
}
$inputStream = fopen('php://input', 'rb');
if ($inputStream === false) {
    gateway_fail(400, 'Не удалось прочитать тело запроса.');
}
$body = (string) stream_get_contents($inputStream, $requestBodyLimit + 1);
fclose($inputStream);
if (strlen($body) > $requestBodyLimit) {
    gateway_fail(413, 'Размер запроса превышает допустимый предел.');
}

try {
    if (str_starts_with($requestPath, '/data/')) {
        gateway_serve_protected_data($requestPath);
    }
    if (str_starts_with($requestPath, '/api/auth/')) {
        if (in_array($requestPath, [
            '/api/auth/partner-registration/challenge',
            '/api/auth/partner-registration',
            '/api/auth/partner-registration/confirm',
        ], true)) {
            $publicHeaders = gateway_request_headers();
            $publicHeaders['x-ais-public-app-url'] = gateway_public_app_url();
            $publicHeaders['x-ais-client-ip'] = substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 80);
            $response = gateway_run_node(gateway_api_url(), $method, $publicHeaders, $body);
            gateway_send_node_response($response);
        }
        gateway_handle_auth_route($method, $requestPath, $body);
        gateway_fail(405, 'Method not allowed');
    }
    if ($requestPath === '/api/health') {
        $response = gateway_run_node('/api/health', $method, gateway_request_headers(), $body);
        gateway_send_node_response($response);
    }
    if (str_starts_with($requestPath, '/api/document-conversion/source/')) {
        $response = gateway_run_node(gateway_api_url(), $method, gateway_request_headers(), $body);
        gateway_send_node_response($response);
    }

    gateway_handle_advertising_source_proxy($method, $requestPath, $body);

    $currentUser = gateway_require_user();
    $authenticatedHeaders = gateway_request_headers();
    $authenticatedHeaders['x-ais-user-id'] = (string) ($currentUser['id'] ?? '');
    $authenticatedHeaders['x-ais-user-login'] = (string) ($currentUser['login'] ?? '');
    $authenticatedHeaders['x-ais-user-name'] = (string) ($currentUser['name'] ?? '');
    $authenticatedHeaders['x-ais-user-role'] = (string) ($currentUser['role'] ?? 'manager');
    $authenticatedHeaders['x-ais-employee-id'] = (string) ($currentUser['employeeId'] ?? '');
    $authenticatedHeaders['x-ais-session-id'] = hash('sha256', (string) session_id());
    if ((string) ($currentUser['role'] ?? '') === 'partner'
        && !str_starts_with($requestPath, '/api/partner/')) {
        gateway_fail(403, 'Раздел недоступен в кабинете партнёра.');
    }
    if (in_array($requestPath, [
        '/api/trash/restore',
        '/api/admin/trash/permanent-delete',
    ], true)) {
        gateway_handle_trash_route($method, $requestPath, $body, $currentUser);
    }
    gateway_handle_audit_routes($method, $requestPath, $body, $currentUser);
    gateway_handle_admin_users($method, $requestPath, $body, $currentUser);
    gateway_handle_admin_external_services($method, $requestPath, $currentUser);
    if (
        ($method === 'POST' && $requestPath === '/api/settings/system-documents')
        || in_array($requestPath, [
            '/api/yandex-disk/test',
            '/api/student-applications-email/test',
            '/api/mysql-locks/test',
        ], true)
        || $requestPath === '/api/students/export-database'
        || str_starts_with($requestPath, '/api/students/export-database/')
    ) {
        gateway_require_admin($currentUser);
    }

    gateway_cleanup_jobs();
    $url = gateway_api_url();
    $path = (string) parse_url($url, PHP_URL_PATH);

    if ($path === '/api/shared-state') {
        gateway_handle_shared_state($method, $body, $currentUser);
    }

    if ($path === '/api/shared-state/locks') {
        gateway_handle_record_locks($method, $body, $currentUser);
    }

    $tunnelSettings = gateway_tunnel_settings();
    if ($tunnelSettings !== null && gateway_tunnel_handles($method, $path)) {
        try {
            $response = gateway_run_tunnel(
                $tunnelSettings,
                $url,
                $method,
                $authenticatedHeaders,
                $body
            );
            $response['headers']['X-AIS-Processing'] = 'local-tunnel';
            gateway_send_node_response($response);
        } catch (Throwable $tunnelError) {
            gateway_fail(
                503,
                'Локальные сервисы распознавания и формирования документов недоступны. '
                . 'Проверьте, что компьютер включён и туннель запущен.'
            );
        }
    }

    if ($method === 'POST' && $path === '/api/students/recognize-documents/start') {
        $ocrPayload = json_decode($body, true);
        if (!is_array($ocrPayload)) {
            gateway_fail(400, 'Некорректный запрос распознавания документов.');
        }
        $ocrPayload['source'] = 'webdav';
        $ocrBody = json_encode($ocrPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($ocrBody === false) {
            gateway_fail(400, 'Не удалось подготовить запрос распознавания документов.');
        }
        $nodeResponse = gateway_run_node(
            '/api/students/recognize-documents/direct',
            'POST',
            gateway_request_headers(),
            $ocrBody
        );
        $job = gateway_store_completed_job('ocr', $nodeResponse, (string) $currentUser['id']);
        gateway_json(202, gateway_public_ocr_job($job));
    }

    if ($method === 'GET' && preg_match(
        '#^/api/students/recognize-documents/(status|result)$#',
        $path,
        $matches
    )) {
        $id = (string) ($_GET['jobId'] ?? '');
        [$job, $paths] = gateway_read_job($id);
        if ((string) ($job['ownerId'] ?? '') !== (string) $currentUser['id']
            && (string) ($currentUser['role'] ?? '') !== 'admin') {
            gateway_fail(404, 'Задание распознавания не найдено.');
        }
        if (($job['kind'] ?? '') !== 'ocr') {
            gateway_fail(404, 'Задание распознавания не найдено.');
        }
        if ($matches[1] === 'status') {
            gateway_json(200, gateway_public_ocr_job($job));
        }
        if (($job['status'] ?? '') === 'failed') {
            gateway_fail(400, (string) ($job['error'] ?? 'Распознавание документов не выполнено.'));
        }
        gateway_send_node_response([
            'status' => (int) ($job['resultStatus'] ?? 200),
            'headers' => is_array($job['resultHeaders'] ?? null) ? $job['resultHeaders'] : [],
            'body' => (string) @file_get_contents($paths['body']),
        ]);
    }

    if ($method === 'POST' && $path === '/api/students/import-applications/query') {
        gateway_handle_application_query(gateway_request_headers(), $body);
    }

    if ($method === 'POST' && in_array($path, [
        '/api/students/import-database/start',
        '/api/students/export-database/start',
    ], true)) {
        $kind = str_contains($path, '/import-') ? 'import' : 'export';
        $directUrl = $kind === 'import'
            ? '/api/students/import-database'
            : '/api/students/export-database';
        $nodeResponse = gateway_run_node($directUrl, $method, gateway_request_headers(), $body);
        $job = gateway_store_completed_job($kind, $nodeResponse, (string) $currentUser['id']);
        gateway_json(202, gateway_public_job($job));
    }

    if ($method === 'GET' && preg_match(
        '#^/api/students/(import|export)-database/(status|result)$#',
        $path,
        $matches
    )) {
        $id = (string) ($_GET['id'] ?? '');
        [$job, $paths] = gateway_read_job($id);
        if ((string) ($job['ownerId'] ?? '') !== (string) $currentUser['id']
            && (string) ($currentUser['role'] ?? '') !== 'admin') {
            gateway_fail(404, 'Серверная задача не найдена.');
        }
        if ($job['kind'] !== $matches[1]) {
            gateway_fail(404, 'Серверная задача не найдена.');
        }
        if ($matches[2] === 'status') {
            gateway_json(200, gateway_public_job($job));
        }
        if ($job['status'] === 'failed') {
            gateway_fail(400, (string) ($job['error'] ?? 'Серверная операция завершилась с ошибкой.'));
        }
        gateway_send_node_response([
            'status' => (int) ($job['resultStatus'] ?? 200),
            'headers' => is_array($job['resultHeaders'] ?? null) ? $job['resultHeaders'] : [],
            'body' => (string) @file_get_contents($paths['body']),
        ]);
    }

    $response = gateway_run_node($url, $method, $authenticatedHeaders, $body);
    gateway_send_node_response($response);
} catch (Throwable $error) {
    gateway_fail(500, $error->getMessage());
}
