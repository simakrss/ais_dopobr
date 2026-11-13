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
$pending = ['request' => str_repeat('d',48), 'userid' => 7, 'claim' => $claim, 'expires' => time()+180];
if (ais_sso_pending($pending, $pending['request'], 7, time()) !== $claim) throw new Exception('Valid confirmation rejected');
rejects(fn() => ais_sso_pending($pending, 'forged', 7, time()));
rejects(fn() => ais_sso_pending($pending, $pending['request'], 8, time()));
rejects(fn() => ais_sso_pending($pending, $pending['request'], 7, time()+181));
rejects(fn() => ais_sso_pending([], $pending['request'], 7, time()));
$resume = ais_sso_assertion(ais_sso_resume_token($claim, $key, time()), $key, time());
if ($resume['nonce'] === $claim['nonce'] || $resume['username'] !== $claim['username'] || $resume['studentId'] !== $claim['studentId']) throw new Exception('Unsafe resume token');
echo "PASS: session-bound confirmation, expiration and fresh one-use logout handoff\n";
