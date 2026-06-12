<?php

declare(strict_types=1);

const AIS_MAIL_FROM = 'mail@edu-plus.ru';
const AIS_MAIL_FROM_NAME = 'Цифровизация Плюс';
const AIS_MAIL_MAX_BODY_BYTES = 100000;
const AIS_MAIL_RATE_LIMIT = 20;
const AIS_MAIL_RATE_WINDOW = 60;

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

function utf8_length(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
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

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    send_json(405, ['ok' => false, 'error' => 'Разрешен только POST-запрос.']);
}

if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'AIS-Web') {
    send_json(403, ['ok' => false, 'error' => 'Запрос отклонен сервером.']);
}

check_same_origin();
enforce_rate_limit();

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > AIS_MAIL_MAX_BODY_BYTES) {
    send_json(413, ['ok' => false, 'error' => 'Письмо превышает допустимый размер.']);
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    send_json(400, ['ok' => false, 'error' => 'Некорректный формат запроса.']);
}

$to = trim((string) ($data['to'] ?? ''));
$subject = trim((string) ($data['subject'] ?? ''));
$message = trim((string) ($data['message'] ?? ''));

if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $to)) {
    send_json(400, ['ok' => false, 'error' => 'Некорректный адрес получателя.']);
}
if ($subject === '' || utf8_length($subject) > 200 || preg_match('/[\r\n]/', $subject)) {
    send_json(400, ['ok' => false, 'error' => 'Некорректная тема письма.']);
}
if ($message === '' || strlen($message) > AIS_MAIL_MAX_BODY_BYTES) {
    send_json(400, ['ok' => false, 'error' => 'Некорректный текст письма.']);
}

$normalizedMessage = preg_replace("/\r\n|\r|\n/", PHP_EOL, $message);
$headers = [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'From: ' . encode_mail_header(AIS_MAIL_FROM_NAME) . ' <' . AIS_MAIL_FROM . '>',
    'Reply-To: ' . AIS_MAIL_FROM,
    'X-Mailer: AIS-Dopobrazovanie'
];

$sent = @mail(
    $to,
    encode_mail_header($subject),
    $normalizedMessage,
    implode("\r\n", $headers)
);

if (!$sent) {
    error_log('AIS mail sender failed for recipient: ' . $to);
    send_json(502, [
        'ok' => false,
        'error' => 'Почтовый сервер не принял письмо. Проверьте настройку PHP mail().'
    ]);
}

send_json(200, ['ok' => true]);
