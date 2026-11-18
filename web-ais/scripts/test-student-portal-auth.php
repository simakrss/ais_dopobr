<?php
declare(strict_types=1);
define('AIS_GATEWAY_LIBRARY_ONLY', true);
require_once dirname(__DIR__) . '/gateway.php';
$user = ['id'=>'student:fixture', 'studentId'=>'fixture', 'studentCredentialVersion'=>str_repeat('a',64), 'role'=>'student', 'status'=>'active', 'login'=>'fixture', 'password'=>'123456'];
$public = ais_auth_public_user($user);
if (isset($public['password']) || $public['studentId'] !== 'fixture' || $public['role'] !== 'student') throw new RuntimeException('Public student principal mismatch');
if (gateway_resolve_shared_auth_user($public) !== $public) throw new RuntimeException('Student must never be mapped to a staff role');
ais_auth_login_student($public);
if ((ais_auth_current_user()['role'] ?? '') !== 'student') throw new RuntimeException('Student session lost');
if (isset($_SESSION['ais_user_id']) || isset($_SESSION['ais_partner'])) throw new RuntimeException('Mixed principal session');
$_SESSION['ais_expires_at'] = time() - 1;
if (ais_auth_current_user() !== null) throw new RuntimeException('Expired session accepted');
echo "PASS: PHP student principal, secret projection, separate session and expiry\n";
