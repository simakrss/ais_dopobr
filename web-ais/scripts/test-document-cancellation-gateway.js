"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const source = fs.readFileSync(path.join(__dirname, "..", "gateway.php"), "utf8").replace(/\r\n/g, "\n");
const operation = source.match(/^function gateway_run_document_operation\([\s\S]*?^}/m)?.[0];
assert.ok(operation);
assert.match(source, /abort-generation' => \['POST'\]/);
assert.ok(source.indexOf("$currentUser = gateway_require_user()") < source.indexOf("if ($method === 'POST' && $path === '/api/contracts/student-document-preview/abort-generation')"));
const cancel = source.slice(source.indexOf("if ($method === 'POST' && $path === '/api/contracts/student-document-preview/abort-generation')"), source.indexOf("if ($previewAffinityBackend === 'tunnel'"));
assert.match(cancel, /gateway_run_node\(/);
assert.match(cancel, /gateway_run_tunnel\(/);
assert.match(source, /gateway_run_document_operation\(\$documentTunnelRoute, fn\(\) => gateway_run_tunnel/);
assert.match(source, /gateway_run_document_operation\(\$documentTunnelRoute, fn\(\) => gateway_run_node/);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ais-cancel-session-"));
try {
  const script = `
    function ais_auth_start_session(): void { session_start(); }
    ${operation}
    session_save_path($argv[1]);
    session_id('isolated-document-cancellation-test');
    session_start();
    $_SESSION['fixture'] = 'retained';
    $result = gateway_run_document_operation(true, function() {
        if (session_status() !== PHP_SESSION_NONE) throw new RuntimeException('Generation holds the session lock');
        return ['ok' => true];
    });
    if (session_status() !== PHP_SESSION_ACTIVE || $_SESSION['fixture'] !== 'retained' || !$result['ok']) throw new RuntimeException('Session was not restored');
    try { gateway_run_document_operation(true, function() { throw new RuntimeException('fixture'); }); }
    catch (RuntimeException $error) { if ($error->getMessage() !== 'fixture') throw $error; }
    if (session_status() !== PHP_SESSION_ACTIVE) throw new RuntimeException('Failed generation lost its session');
    session_write_close();
    echo 'PHP document cancellation session test: OK';
  `;
  const result = spawnSync(process.env.PHP_BINARY || "php", ["-r", script, temp], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  assert.match(result.stdout, /session test: OK/);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log("Gateway cancellation: authenticated dispatch to both backends, released PHP lock, session restoration after success/failure: OK");
