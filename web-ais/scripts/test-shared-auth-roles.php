<?php
declare(strict_types=1);
define('AIS_GATEWAY_LIBRARY_ONLY', true);
require_once dirname(__DIR__) . '/gateway.php';
function check_role(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$user = ['id' => 'php-user', 'login' => 'role-check', 'employeeId' => 'php-contract', 'authSource' => 'employee', 'role' => 'manager', 'status' => 'active'];
$identity = gateway_shared_auth_role_identity($user);
check_role($identity['key'] === hash('sha256', "employee\0role-check"), 'PHP/Node identity mismatch');
check_role(gateway_shared_auth_role_identity(['login' => 'role-check'])['key'] !== $identity['key'], 'Principal boundary');
try { gateway_apply_shared_auth_role($user, ['principal_key' => $identity['key'], 'role' => 'admin', 'revision' => 1]); throw new LogicException('Employee granted admin'); }
catch (RuntimeException $error) { check_role(!($error instanceof LogicException), 'Employee/admin separation'); }
if (in_array('--mysql', $argv, true)) {
    check_role((bool) preg_match('/^role-test-[a-f0-9]{16}$/', gateway_shared_state_key()), 'Live tests require an isolated namespace');
    // Use the configured remote host directly; no local-host fallback in Windows tests.
    $settings = json_decode(file_get_contents(dirname(__DIR__) . '/storage/server-settings.json'), true);
    $raw = getenv('AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING') ?: ($settings['sharedRecordLocksMySqlConnectionString'] ?? '');
    if (!$raw && ($settings['sharedRecordLocksMySqlUseApplicationsConnection'] ?? true)) $raw = $settings['studentApplicationsMySqlConnectionString'] ?? '';
    $config = $raw ? gateway_parse_connection_string($raw) : ['server'=>$settings['sharedRecordLocksMySqlHost'], 'database'=>$settings['sharedRecordLocksMySqlDatabase'], 'uid'=>$settings['sharedRecordLocksMySqlUser'], 'pwd'=>$settings['sharedRecordLocksMySqlPassword'], 'port'=>$settings['sharedRecordLocksMySqlPort']];
    $pdo = new PDO('mysql:host=' . ($config['server'] ?? $config['host']) . ';port=' . ($config['port'] ?? 3306) . ';dbname=' . $config['database'] . ';charset=utf8mb4', $config['uid'] ?? $config['user'], $config['pwd'] ?? $config['password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $resolved = gateway_resolve_shared_auth_users([$user], $pdo)[0];
    check_role($resolved['role'] === 'manager' && $resolved['sharedRoleVersion'] === '2', 'Node assignment not read by PHP');
    $changed = gateway_save_shared_auth_role([...$user, 'role'=>'partner'], '2', 'test-admin-php', $pdo);
    check_role($changed['sharedRoleVersion'] === '3', 'PHP assignment version');
    try { gateway_save_shared_auth_role($user, '2', 'stale-php', $pdo); throw new LogicException('Stale update accepted'); }
    catch (RuntimeException $error) {check_role($error->getCode() === 409, 'Missing conflict error');}
    gateway_initialize_shared_auth_roles([$user], $pdo);
    check_role(gateway_resolve_shared_auth_users([$user], $pdo)[0]['role'] === 'partner', 'Stale PHP copy overwrote common role');
    $manual = ['id'=>'manual-test', 'login'=>'role-check', 'role'=>'admin'];
    gateway_save_shared_auth_role($manual, '0', 'test-admin-php', $pdo);
    check_role(gateway_resolve_shared_auth_users([$user], $pdo)[0]['role'] === 'partner', 'Manual account affected employee');
    echo "PHP/MySQL cross-runtime reads/writes, conflicts, principal separation: OK\n";
} else echo "PHP shared role validation: OK\n";
