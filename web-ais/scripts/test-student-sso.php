<?php
declare(strict_types=1);
define('AIS_SSO_LIBRARY_ONLY', true);
require dirname(__DIR__) . '/services/moodle/ais-sso.php';
$key = str_repeat('a', 64);
$claim = ['iss'=>'ais-dopobr', 'aud'=>'https://portal.edu-plus.ru', 'username'=>'fixture', 'email'=>'fixture@example.test', 'studentId'=>'s', 'exp'=>time()+60, 'nonce'=>str_repeat('b',48)];
function signed_token(array $claim, string $key): string {
    $payload = rtrim(strtr(base64_encode(json_encode($claim)), '+/', '-_'), '=');
    return $payload . '.' . hash_hmac('sha256', $payload, $key);
}
function rejects(callable $operation): void {
    try { $operation(); } catch (RuntimeException $e) { return; }
    throw new Exception('Unsafe assertion accepted');
}
if (ais_sso_assertion(signed_token($claim,$key), $key, time()) !== $claim) throw new Exception('Valid assertion rejected');
rejects(fn() => ais_sso_assertion(signed_token($claim,$key), str_repeat('c',64), time()));
foreach (['exp'=>time()-1, 'aud'=>'https://attacker.test', 'iss'=>'other', 'nonce'=>'../', 'studentId'=>''] as $field=>$value) {
    $changed=$claim; $changed[$field]=$value;
    rejects(fn() => ais_sso_assertion(signed_token($changed,$key), $key, time()));
}
rejects(fn() => ais_sso_assertion(str_repeat('a',4097), $key, time()));
foreach (['https://edu-plus.ru','http://127.0.0.1:8081','http://localhost:8081'] as $origin) if (!ais_sso_origin_allowed($origin)) throw new Exception('Trusted origin rejected');
foreach (['','null','https://edu-plus.ru.attacker.test','https://attacker.test','http://192.168.1.1'] as $origin) if (ais_sso_origin_allowed($origin)) throw new Exception('Untrusted origin accepted');
echo "PASS: signed SSO assertions, expiration, issuer, audience, nonce, size and origin checks\n";
