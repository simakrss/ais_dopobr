<?php
declare(strict_types=1);
define('AIS_GATEWAY_LIBRARY_ONLY', true);
require_once dirname(__DIR__) . '/gateway.php';
function check_layout(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
gateway_validate_interface_layout(['nav'=>[], 'tabs:program-card'=>['site','main'], 'table:students:width:name'=>250]);
foreach ([['password'=>'no'], ['nav'=>'students'], ['tabs:__proto__'=>[]], ['table:students:width:name'=>-1], ['table:students:width:name'=>'150']] as $invalid) {
    try { gateway_validate_interface_layout($invalid); throw new LogicException('Invalid schema accepted'); }
    catch (RuntimeException $error) { check_layout($error->getCode() === 400, 'Invalid schema not rejected'); }
}
if (in_array('--mysql', $argv, true)) {
    check_layout((bool) preg_match('/^layout-test-[a-f0-9]{16}$/', gateway_shared_state_key()), 'Live tests require isolated namespace');
    $settings = json_decode(file_get_contents(dirname(__DIR__) . '/storage/server-settings.json'), true);
    $raw = getenv('AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING') ?: ($settings['sharedRecordLocksMySqlConnectionString'] ?? '');
    if (!$raw && ($settings['sharedRecordLocksMySqlUseApplicationsConnection'] ?? true)) $raw = $settings['studentApplicationsMySqlConnectionString'] ?? '';
    $config = $raw ? gateway_parse_connection_string($raw) : ['server'=>$settings['sharedRecordLocksMySqlHost'], 'database'=>$settings['sharedRecordLocksMySqlDatabase'], 'uid'=>$settings['sharedRecordLocksMySqlUser'], 'pwd'=>$settings['sharedRecordLocksMySqlPassword'], 'port'=>$settings['sharedRecordLocksMySqlPort']];
    $pdo = new PDO('mysql:host=' . ($config['server'] ?? $config['host']) . ';port=' . ($config['port'] ?? 3306) . ';dbname=' . $config['database'] . ';charset=utf8mb4', $config['uid'] ?? $config['user'], $config['pwd'] ?? $config['password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $result = gateway_read_interface_layout($pdo);
    check_layout($result['initialized'] && $result['preferences']->nav === ['students','programs'], 'Node order not read in PHP');
    $result = gateway_save_interface_layout(['nav'=>['programs','students'], 'table:students:width:name'=>null], $pdo);
    check_layout($result['preferences']->{'tabs:program-card'} === ['site','main'], 'Independent tabs lost');
    check_layout($result['preferences']->{'table:students:width:name'} === null, 'Reset lost');
    echo "PHP/MySQL: Node layout read, website changes, tombstones and unrelated settings preserved: OK\n";
} else echo "PHP interface layout validation: OK\n";
