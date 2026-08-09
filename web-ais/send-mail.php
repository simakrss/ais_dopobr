<?php

declare(strict_types=1);

const AIS_MAIL_FROM_NAME = 'Цифровизация Плюс';
const AIS_MAIL_MAX_MESSAGE_BYTES = 100000;
const AIS_MAIL_MAX_REQUEST_BYTES = 34 * 1024 * 1024;
const AIS_MAIL_MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;
const AIS_MAIL_MAX_SUBJECT_LENGTH = 200;
const AIS_MAIL_RATE_LIMIT = 20;
const AIS_MAIL_RATE_WINDOW = 60;

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

function send_json(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function encode_mail_header(string $value): string
{
    return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

function encode_mail_body(string $value): string
{
    return rtrim(chunk_split(base64_encode($value), 76, "\r\n"));
}

function contains_html_markup(string $value): bool
{
    return preg_match('/<\s*\/?\s*[a-z][a-z0-9:-]*(?:\s[^<>]*?)?\s*\/?\s*>/iu', $value) === 1;
}

function utf8_length(string $value): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen($value, 'UTF-8');
    }
    $count = preg_match_all('/./us', $value, $matches);
    return $count === false ? strlen($value) : $count;
}

function utf8_substring(string $value, int $length): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $length, 'UTF-8');
    }
    $matched = preg_match_all('/./us', $value, $matches);
    if ($matched === false) {
        return substr($value, 0, $length);
    }
    return implode('', array_slice($matches[0], 0, $length));
}

function normalize_mail_subject(string $value): string
{
    $subject = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value);
    $subject = preg_replace('/\s+/u', ' ', (string) $subject);
    $subject = trim((string) $subject);
    if (utf8_length($subject) <= AIS_MAIL_MAX_SUBJECT_LENGTH) {
        return $subject;
    }
    return rtrim(utf8_substring($subject, AIS_MAIL_MAX_SUBJECT_LENGTH - 3)) . '...';
}

function check_same_origin(): void
{
    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    $host = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
    if ($origin === '' || $host === '') {
        return;
    }
    $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
    $requestHost = strtolower((string) preg_replace('/:\d+$/', '', $host));
    if ($originHost === '' || !hash_equals($requestHost, $originHost)) {
        send_json(403, ['ok' => false, 'error' => 'Запрос отклонен сервером.']);
    }
}

function enforce_rate_limit(): void
{
    $client = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $path = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR
        . 'ais-mail-rate-'
        . sha1($client)
        . '.json';
    $handle = @fopen($path, 'c+');
    if ($handle === false) {
        return;
    }
    try {
        if (!flock($handle, LOCK_EX)) {
            return;
        }
        $contents = stream_get_contents($handle);
        $timestamps = json_decode($contents ?: '[]', true);
        if (!is_array($timestamps)) {
            $timestamps = [];
        }
        $now = time();
        $timestamps = array_values(array_filter(
            $timestamps,
            static fn ($value): bool => is_int($value) && $value > $now - AIS_MAIL_RATE_WINDOW
        ));
        if (count($timestamps) >= AIS_MAIL_RATE_LIMIT) {
            send_json(429, ['ok' => false, 'error' => 'Слишком много писем. Повторите отправку через минуту.']);
        }
        $timestamps[] = $now;
        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, json_encode($timestamps));
        fflush($handle);
        flock($handle, LOCK_UN);
    } finally {
        fclose($handle);
    }
}

function load_mail_settings(): array
{
    $path = __DIR__ . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'server-settings.json';
    $settings = [];
    if (is_file($path)) {
        $contents = file_get_contents($path);
        $decoded = $contents === false ? null : json_decode($contents, true);
        if (is_array($decoded)) {
            $settings = $decoded;
        }
    }
    $imapHost = trim((string) ($settings['studentApplicationsEmailHost'] ?? getenv('STUDENT_APPLICATIONS_EMAIL_HOST') ?: ''));
    $smtpHost = trim((string) (
        $settings['studentApplicationsEmailSmtpHost']
        ?? getenv('STUDENT_APPLICATIONS_EMAIL_SMTP_HOST')
        ?: preg_replace('/^imap(?=\.)/i', 'smtp', $imapHost)
    ));
    $smtpPort = (int) (
        $settings['studentApplicationsEmailSmtpPort']
        ?? getenv('STUDENT_APPLICATIONS_EMAIL_SMTP_PORT')
        ?: 465
    );
    $login = trim((string) (
        $settings['studentApplicationsEmailLogin']
        ?? getenv('STUDENT_APPLICATIONS_EMAIL_LOGIN')
        ?: ''
    ));
    $password = (string) (
        $settings['studentApplicationsEmailPassword']
        ?? getenv('STUDENT_APPLICATIONS_EMAIL_PASSWORD')
        ?: ''
    );
    if ($smtpHost === '' || $smtpPort < 1 || $smtpPort > 65535 || $login === '' || $password === '') {
        throw new RuntimeException('В админке не настроен SMTP для исходящей почты.');
    }
    if (!filter_var($login, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Логин почтового ящика должен быть адресом электронной почты.');
    }
    return [
        'host' => $smtpHost,
        'port' => $smtpPort,
        'login' => $login,
        'password' => $password,
    ];
}

function smtp_read_response($socket, array $expectedCodes, string $action): string
{
    $response = '';
    $code = 0;
    while (($line = fgets($socket, 8192)) !== false) {
        $response .= $line;
        if (preg_match('/^(\d{3}) /', $line, $matches)) {
            $code = (int) $matches[1];
            break;
        }
    }
    $meta = stream_get_meta_data($socket);
    if (!empty($meta['timed_out'])) {
        throw new RuntimeException($action . ': SMTP-сервер не ответил вовремя.');
    }
    if (!in_array($code, $expectedCodes, true)) {
        throw new RuntimeException($action . ': ' . trim($response ?: 'SMTP-сервер закрыл соединение.'));
    }
    return $response;
}

function smtp_write_all($socket, string $value): void
{
    $length = strlen($value);
    $offset = 0;
    while ($offset < $length) {
        $written = fwrite($socket, substr($value, $offset));
        if ($written === false || $written === 0) {
            throw new RuntimeException('Не удалось передать данные SMTP-серверу.');
        }
        $offset += $written;
    }
}

function smtp_command($socket, string $command, array $expectedCodes, string $action): string
{
    smtp_write_all($socket, $command . "\r\n");
    return smtp_read_response($socket, $expectedCodes, $action);
}

function send_smtp_mail(
    array $settings,
    string $to,
    string $subject,
    string $message,
    ?array $attachment = null
): void
{
    $context = stream_context_create([
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'peer_name' => $settings['host'],
            'SNI_enabled' => true,
        ],
    ]);
    $errorNumber = 0;
    $errorMessage = '';
    $socket = @stream_socket_client(
        'ssl://' . $settings['host'] . ':' . $settings['port'],
        $errorNumber,
        $errorMessage,
        30,
        STREAM_CLIENT_CONNECT,
        $context
    );
    if ($socket === false) {
        throw new RuntimeException('Не удалось подключиться к SMTP-серверу: ' . ($errorMessage ?: $errorNumber));
    }
    stream_set_timeout($socket, 30);
    try {
        smtp_read_response($socket, [220], 'Подключение к SMTP');
        smtp_command($socket, 'EHLO ais-dopobrazovanie.local', [250], 'Инициализация SMTP');
        smtp_command($socket, 'AUTH LOGIN', [334], 'Авторизация SMTP');
        smtp_command($socket, base64_encode($settings['login']), [334], 'Передача логина SMTP');
        smtp_command($socket, base64_encode($settings['password']), [235], 'Передача пароля SMTP');
        smtp_command($socket, 'MAIL FROM:<' . $settings['login'] . '>', [250], 'Адрес отправителя');
        smtp_command($socket, 'RCPT TO:<' . $to . '>', [250, 251], 'Адрес получателя');
        smtp_command($socket, 'DATA', [354], 'Подготовка письма');

        $normalizedMessage = preg_replace("/\r\n|\r|\n/", "\r\n", $message);
        $encodedBody = encode_mail_body($normalizedMessage);
        $bodyContentType = contains_html_markup($normalizedMessage) ? 'text/html' : 'text/plain';
        $domain = substr(strrchr($settings['login'], '@') ?: '@localhost', 1);
        $headers = [
            'From: ' . encode_mail_header(AIS_MAIL_FROM_NAME) . ' <' . $settings['login'] . '>',
            'To: <' . $to . '>',
            'Subject: ' . encode_mail_header($subject),
            'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000',
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $domain . '>',
            'MIME-Version: 1.0',
            'X-Mailer: AIS-Dopobrazovanie',
        ];
        if ($attachment === null) {
            $headers[] = 'Content-Type: ' . $bodyContentType . '; charset=UTF-8';
            $headers[] = 'Content-Transfer-Encoding: base64';
            $mailBody = $encodedBody;
        } else {
            $boundary = 'ais-' . bin2hex(random_bytes(18));
            $fallbackFileName = preg_replace('/[^\x20-\x7E]+/', '_', $attachment['fileName']);
            $fallbackFileName = str_replace(['"', '\\'], '_', (string) $fallbackFileName);
            $headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';
            $mailBody = implode("\r\n", [
                '--' . $boundary,
                'Content-Type: ' . $bodyContentType . '; charset=UTF-8',
                'Content-Transfer-Encoding: base64',
                '',
                $encodedBody,
                '--' . $boundary,
                'Content-Type: ' . $attachment['contentType'] . '; name="' . $fallbackFileName . '"',
                'Content-Transfer-Encoding: base64',
                'Content-Disposition: attachment; filename="' . $fallbackFileName
                    . '"; filename*=UTF-8\'\'' . rawurlencode($attachment['fileName']),
                '',
                encode_mail_body($attachment['bytes']),
                '--' . $boundary . '--',
            ]);
        }
        smtp_write_all($socket, implode("\r\n", $headers) . "\r\n\r\n" . $mailBody . "\r\n.\r\n");
        smtp_read_response($socket, [250], 'Отправка письма');
        try {
            smtp_command($socket, 'QUIT', [221], 'Завершение SMTP');
        } catch (Throwable $error) {
            // The message is already accepted; a QUIT failure must not trigger a duplicate retry.
        }
    } finally {
        fclose($socket);
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    send_json(405, ['ok' => false, 'error' => 'Разрешен только POST-запрос.']);
}

try {
    $currentUser = ais_auth_current_user();
    if ($currentUser === null) {
        send_json(401, ['ok' => false, 'error' => 'Требуется вход в систему.']);
    }
} catch (Throwable $error) {
    send_json(500, ['ok' => false, 'error' => 'Служба авторизации недоступна.']);
}

if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'AIS-Web') {
    send_json(403, ['ok' => false, 'error' => 'Запрос отклонен сервером.']);
}

check_same_origin();
enforce_rate_limit();

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > AIS_MAIL_MAX_REQUEST_BYTES) {
    send_json(413, ['ok' => false, 'error' => 'Письмо превышает допустимый размер.']);
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    send_json(400, ['ok' => false, 'error' => 'Некорректный формат запроса.']);
}

$to = trim((string) ($data['to'] ?? ''));
$subject = normalize_mail_subject((string) ($data['subject'] ?? ''));
$message = trim((string) ($data['message'] ?? ''));
$auditContext = is_array($data['auditContext'] ?? null) ? $data['auditContext'] : [];
$studentId = ais_audit_text($auditContext['studentId'] ?? '', 240);
$studentName = ais_audit_text($auditContext['studentName'] ?? '', 500);
$contractId = ais_audit_text($auditContext['contractId'] ?? '', 240);
$contractName = ais_audit_text($auditContext['contractName'] ?? '', 500);
$requestedEntityType = ais_audit_text($auditContext['entityType'] ?? '', 40);
$entityType = in_array($requestedEntityType, ['students', 'contracts'], true)
    ? $requestedEntityType
    : ($contractId !== '' ? 'contracts' : ($studentId !== '' ? 'students' : 'email'));
$entityId = ais_audit_text(
    $auditContext['entityId'] ?? ($entityType === 'contracts' ? $contractId : $studentId),
    240
);
$entityLabel = ais_audit_text(
    $auditContext['entityName'] ?? ($entityType === 'contracts' ? $contractName : $studentName),
    500
);
$messageType = ais_audit_text($auditContext['messageType'] ?? 'Письмо', 240);
$recipientModeValue = (string) ($auditContext['recipientMode'] ?? '');
$recipientMode = $recipientModeValue === 'system'
    ? 'системный ящик'
    : ($recipientModeValue === 'employee' ? 'сотрудник' : 'слушатель');

if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $to)) {
    send_json(400, ['ok' => false, 'error' => 'Некорректный адрес получателя.']);
}
if ($subject === '' || utf8_length($subject) > AIS_MAIL_MAX_SUBJECT_LENGTH) {
    send_json(400, ['ok' => false, 'error' => 'Некорректная тема письма.']);
}
if ($message === '' || strlen($message) > AIS_MAIL_MAX_MESSAGE_BYTES) {
    send_json(400, ['ok' => false, 'error' => 'Некорректный текст письма.']);
}

$attachment = null;
$attachmentFileName = '';
if (array_key_exists('attachment', $data) && $data['attachment'] !== null) {
    if (!is_array($data['attachment'])) {
        send_json(400, ['ok' => false, 'error' => 'Некорректные данные вложения.']);
    }
    $fileName = trim((string) ($data['attachment']['fileName'] ?? ''));
    $contentType = strtolower(trim((string) ($data['attachment']['contentType'] ?? '')));
    $base64 = preg_replace('/\s+/', '', (string) ($data['attachment']['base64'] ?? ''));
    $allowedAttachments = [
        'application/pdf' => '.pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => '.docx',
    ];
    $requiredExtension = $allowedAttachments[$contentType] ?? '';
    if (
        $fileName === ''
        || utf8_length($fileName) > 180
        || preg_match('/[\r\n\\\\\/:*?"<>|]/u', $fileName)
    ) {
        send_json(400, ['ok' => false, 'error' => 'Некорректное имя вложения.']);
    }
    if ($requiredExtension === '' || strtolower((string) pathinfo($fileName, PATHINFO_EXTENSION)) !== ltrim($requiredExtension, '.')) {
        send_json(400, ['ok' => false, 'error' => 'Недопустимый формат вложения.']);
    }
    if ($base64 === '' || !preg_match('/^[A-Za-z0-9+\/]*={0,2}$/D', $base64)) {
        send_json(400, ['ok' => false, 'error' => 'Некорректные данные вложения.']);
    }
    $attachmentBytes = base64_decode($base64, true);
    if (
        $attachmentBytes === false
        || strlen($attachmentBytes) === 0
        || strlen($attachmentBytes) > AIS_MAIL_MAX_ATTACHMENT_BYTES
    ) {
        send_json(400, ['ok' => false, 'error' => 'Вложение пустое или превышает допустимый размер.']);
    }
    if (
        ($requiredExtension === '.pdf' && substr($attachmentBytes, 0, 5) !== '%PDF-')
        || ($requiredExtension === '.docx' && substr($attachmentBytes, 0, 2) !== 'PK')
    ) {
        send_json(400, ['ok' => false, 'error' => 'Содержимое вложения не соответствует указанному формату.']);
    }
    $attachment = [
        'fileName' => $fileName,
        'contentType' => $contentType,
        'bytes' => $attachmentBytes,
    ];
    $attachmentFileName = $fileName;
}

try {
    $settings = load_mail_settings();
    send_smtp_mail($settings, $to, $subject, $message, $attachment);
    ais_audit_try_append([
        'action' => 'Отправлено письмо',
        'area' => 'Электронная почта',
        'entityType' => $entityType,
        'entityId' => $entityId,
        'entityLabel' => $entityLabel !== '' ? $entityLabel : $to,
        'field' => 'email',
        'after' => $to,
        'details' => implode('; ', [
            'Тип: ' . $messageType,
            'Получатель: ' . $to . ' (' . $recipientMode . ')',
            'Тема: ' . $subject,
            $attachmentFileName !== '' ? 'Вложение: ' . $attachmentFileName : 'Без вложения',
            'Отправитель: ' . $settings['login'],
        ]),
        'source' => 'smtp',
    ], $currentUser);
} catch (Throwable $error) {
    error_log('AIS mail sender failed for recipient: ' . $to);
    ais_audit_try_append([
        'action' => 'Ошибка отправки письма',
        'area' => 'Электронная почта',
        'entityType' => $entityType,
        'entityId' => $entityId,
        'entityLabel' => $entityLabel !== '' ? $entityLabel : $to,
        'field' => 'email',
        'after' => $to,
        'details' => implode('; ', [
            'Тип: ' . $messageType,
            'Получатель: ' . $to . ' (' . $recipientMode . ')',
            'Тема: ' . $subject,
            $attachmentFileName !== '' ? 'Вложение: ' . $attachmentFileName : 'Без вложения',
            'Ошибка: ' . ais_audit_text($error->getMessage(), 1000),
        ]),
        'source' => 'smtp',
    ], $currentUser);
    send_json(502, [
        'ok' => false,
        'error' => $error->getMessage()
    ]);
}

send_json(200, ['ok' => true, 'from' => $settings['login']]);
