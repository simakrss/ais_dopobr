<?php
declare(strict_types=1);
define('AIS_GATEWAY_LIBRARY_ONLY', true);
require_once dirname(__DIR__) . '/gateway.php';
function check_json_error(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
foreach ([
    JSON_ERROR_DEPTH => 'глубина', JSON_ERROR_STATE_MISMATCH => 'структура',
    JSON_ERROR_CTRL_CHAR => 'управляющий', JSON_ERROR_SYNTAX => 'синтаксис',
    JSON_ERROR_UTF8 => 'UTF-8', JSON_ERROR_UTF16 => 'Unicode', JSON_ERROR_NONE => 'объект',
] as $code => $expected) {
    $message = gateway_shared_state_json_error($code, 123, 123);
    check_json_error(str_contains($message, $expected), 'Missing JSON error detail');
    check_json_error(str_contains($message, 'Получено 123 из 123 байт'), 'Missing request size');
}
check_json_error(str_contains(gateway_shared_state_json_error(4, 0, 100), 'пустое тело'), 'Empty body not identified');
check_json_error(str_contains(gateway_shared_state_json_error(4, 12, 100), 'не полностью'), 'Truncated body not identified');
check_json_error(str_contains(gateway_shared_state_json_error(4, 12, 0), 'Получено 12 байт'), 'Missing Content-Length is supported');
$payload = json_decode('{"patch":{"note":"\ud83d"}}', true);
check_json_error($payload === null && json_last_error() === JSON_ERROR_UTF16, 'Unpaired surrogate reproduction failed');
echo "Shared state JSON diagnostics: syntax, depth, UTF-8/UTF-16, empty/truncated bodies; no record contents disclosed: OK\n";
