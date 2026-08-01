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
        $studentId = trim((string) ($_GET['studentId'] ?? ''));
        if ($studentId === '' || mb_strlen($studentId, 'UTF-8') > 240) {
            gateway_fail(400, 'Не указан слушатель для просмотра журнала.');
        }
        $scope = [
            'entityTypeExact' => 'students',
            'entityIdExact' => $studentId,
        ];
        $filters = array_merge(gateway_audit_filters(), $scope);
        if (str_ends_with($path, '/export')) {
            $csv = ais_audit_export_csv($filters);
            $safeId = preg_replace('/[^A-Za-z0-9_-]+/', '-', $studentId) ?: 'log';
            $fileName = 'student-audit-' . substr($safeId, 0, 80) . '-' . gmdate('Y-m-d_H-i-s') . '.csv';
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
    gateway_require_user();
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

set_time_limit(AIS_GATEWAY_TIMEOUT_SECONDS + 20);
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if (!in_array($method, ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'], true)) {
    gateway_fail(405, 'Method not allowed');
}

$contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($contentLength > AIS_GATEWAY_MAX_REQUEST_BYTES) {
    gateway_fail(413, 'Размер запроса превышает допустимый предел.');
}
$body = (string) file_get_contents('php://input');
if (strlen($body) > AIS_GATEWAY_MAX_REQUEST_BYTES) {
    gateway_fail(413, 'Размер запроса превышает допустимый предел.');
}

try {
    $requestPath = gateway_request_path();
    if (str_starts_with($requestPath, '/data/')) {
        gateway_serve_protected_data($requestPath);
    }
    if (str_starts_with($requestPath, '/api/auth/')) {
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

    $currentUser = gateway_require_user();
    gateway_handle_audit_routes($method, $requestPath, $body, $currentUser);
    gateway_handle_admin_users($method, $requestPath, $body, $currentUser);
    if (
        ($method === 'POST' && $requestPath === '/api/settings/system-documents')
        || in_array($requestPath, [
            '/api/yandex-disk/test',
            '/api/student-applications-email/test',
        ], true)
        || $requestPath === '/api/students/export-database'
        || str_starts_with($requestPath, '/api/students/export-database/')
    ) {
        gateway_require_admin($currentUser);
    }

    gateway_cleanup_jobs();
    $url = gateway_api_url();
    $path = (string) parse_url($url, PHP_URL_PATH);

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

    $response = gateway_run_node($url, $method, gateway_request_headers(), $body);
    gateway_send_node_response($response);
} catch (Throwable $error) {
    gateway_fail(500, $error->getMessage());
}
