"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, name);
  return source.slice(start, end + 2);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ais-cleanup-recovery-"));
const leasePath = path.join(root, ".cleanup-worker.lock");
const turns = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
async function main() {
  const timers = [];
  const leaseRuntime = vm.createContext({
    fs: fs.promises, crypto, path, process: { pid: process.pid }, Date,
    generatedDocumentPreviewStorageRoot: () => root,
    isProcessAlive: () => true, // Includes an unrelated process that inherited the old PID.
    GENERATED_DOCUMENT_PREVIEW_CLEANUP_WORKER_STALE_MS: 180000,
    GENERATED_DOCUMENT_PREVIEW_CLEANUP_WORKER_HEARTBEAT_MS: 10000,
    setInterval: callback => { timers.push(callback); return callback; }, clearInterval() {}
  });
  vm.runInContext([
    "generatedDocumentPreviewCleanupWorkerLeasePath", "getGeneratedDocumentPreviewCleanupWorkerHealth",
    "acquireGeneratedDocumentPreviewCleanupWorkerLease"
  ].map(extract).join("\n"), leaseRuntime);
  fs.writeFileSync(leasePath, JSON.stringify({ pid: process.pid, nonce: "recycled-pid", startedAt: Date.now() - 600000 }));
  const stale = new Date(Date.now() - 600000);
  fs.utimesSync(leasePath, stale, stale);
  const replacement = await leaseRuntime.acquireGeneratedDocumentPreviewCleanupWorkerLease();
  assert.ok(replacement, "An expired lease must not be pinned forever by a recycled live PID");
  const bytes = fs.readFileSync(leasePath, "utf8");
  assert.notEqual(JSON.parse(bytes).nonce, "recycled-pid");
  assert.equal(await leaseRuntime.acquireGeneratedDocumentPreviewCleanupWorkerLease(), null, "Keep a healthy owner's lease");
  assert.equal(fs.readFileSync(leasePath, "utf8"), bytes);
  fs.utimesSync(leasePath, stale, stale);
  const successor = await leaseRuntime.acquireGeneratedDocumentPreviewCleanupWorkerLease();
  assert.ok(successor);
  const successorBytes = fs.readFileSync(leasePath, "utf8");
  timers[0]();
  await replacement.release();
  assert.equal(replacement.isLost(), true, "The old worker must notice its lost lease");
  assert.equal(fs.readFileSync(leasePath, "utf8"), successorBytes, "The old worker must not remove the successor's lease");
  await successor.release();
  assert.equal(fs.existsSync(leasePath), false);

  let launches = 0, rejectStart, now = 100000, errors = 0;
  const supervisor = vm.createContext({
    Date: { now: () => now }, console: { error: () => errors++ },
    launchGeneratedDocumentPreviewCleanupWorker: () => {
      launches++;
      return new Promise((_resolve, reject) => { rejectStart = reject; });
    }
  });
  vm.runInContext("let generatedDocumentPreviewCleanupWorkerStart = null; let generatedDocumentPreviewCleanupWorkerNextCheck = 0;\n"
    + extract("ensureGeneratedDocumentPreviewCleanupWorker") + "\n" + extract("superviseGeneratedDocumentPreviewCleanupWorker"), supervisor);
  for (let i = 0; i < 20; i++) supervisor.superviseGeneratedDocumentPreviewCleanupWorker();
  assert.equal(launches, 1, "Concurrent API calls must not create a storm of cleanup workers");
  const first = supervisor.ensureGeneratedDocumentPreviewCleanupWorker();
  assert.equal(supervisor.ensureGeneratedDocumentPreviewCleanupWorker(), first);
  rejectStart(new Error("fixture worker failed"));
  await assert.rejects(first, /fixture worker failed/);
  await turns();
  assert.equal(errors, 1);
  supervisor.superviseGeneratedDocumentPreviewCleanupWorker();
  assert.equal(launches, 1, "A failure must be throttled");
  now += 30001;
  supervisor.superviseGeneratedDocumentPreviewCleanupWorker();
  assert.equal(launches, 2, "Supervision must retry automatically after a failure");
  rejectStart(new Error("second fixture failure"));
  await turns();

  let supervised = 0;
  const routing = vm.createContext({
    URL, process: { env: { AIS_TRUST_GATEWAY: "1", AIS_TUNNEL_ONLY: "1" } },
    isDatabaseDemoModeEnabled: () => false, isOnlyOfficeProxyPath: () => false,
    requestHasConfiguredGatewaySecret: req => !!req.authorized,
    useGeneratedDocumentPreviewFileStore: () => true,
    superviseGeneratedDocumentPreviewCleanupWorker: () => { supervised++; return new Promise(() => {}); },
    ensureGeneratedDocumentPreviewCleanupWorker: () => { throw Error("Health must never wait for cleanup"); },
    resolveLibreOfficeBinary: async () => "fixture-libreoffice",
    getLocalSystemDocumentsAvailability: async () => ({ available: true }),
    resolveOnlyOfficeJwtSecret: async () => "fixture", runtimeSecretFingerprint: () => "fingerprint",
    serverSettings: {}, CORS_HEADERS: {},
    sendJson: (res, status, body) => Object.assign(res, { status, body }),
    sendError: (res, status) => Object.assign(res, { status })
  });
  vm.runInContext(extract("route"), routing);
  const request = async (method, url, authorized = false) => {
    const res = { writeHead(status) { this.status = status; }, end() {} };
    await Promise.race([
      routing.route({ method, url, authorized, headers: { host: "localhost" } }, res),
      new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(Error("API blocked on cleanup")), 500); timer.unref(); })
    ]);
    return res;
  };
  for (const authorized of [false, true]) {
    const health = await request("GET", "/api/health", authorized);
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.highQualityPdfConversionAvailable, true, "Preserve document capability reporting");
    assert.equal(!!health.body.runtimeSecrets, authorized, "Preserve authenticated runtime verification");
  }
  assert.equal(supervised, 0, "Health must not start housekeeping workers");
  assert.equal((await request("OPTIONS", "/api/anything", true)).status, 204);
  assert.equal(supervised, 1, "Regular requests should trigger nonblocking recovery");
  assert.equal((await request("OPTIONS", "/api/anything", false)).status, 404, "Tunnel authorization still applies");
  assert.equal(supervised, 1);
  console.log("PASS: recycled PID recovery, lease ownership, single worker, retry backoff, fast health and API authorization");
}
main().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
