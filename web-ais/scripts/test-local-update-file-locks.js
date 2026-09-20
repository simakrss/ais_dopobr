"use strict";
// Inject Windows sharing violations without changing permissions or touching live status.
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os");
const path = require("node:path"), vm = require("node:vm");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ais-update-lock-test-"));
let remaining = 0, attempts = 0, code = "EPERM", heartbeat, unlinks = [], delays = [], warnings = [];
const mockFs = { ...fs,
  renameSync(from, to) {
    attempts++;
    if (remaining-- > 0) throw Object.assign(Error(`${code}: rename ${from} -> ${to}`), { code });
    return fs.renameSync(from, to);
  },
  unlinkSync(file) { unlinks.push(file); return fs.unlinkSync(file); }
};
const context = vm.createContext({
  module: { exports: {} }, require: (name) => name === "node:fs" ? mockFs : require(name),
  process, Buffer, fetch, AbortSignal, setTimeout, clearTimeout,
  setInterval: (handler) => { heartbeat = handler; return { unref() {} }; }, clearInterval() {},
  Atomics: { wait: (_buffer, _index, _value, ms) => delays.push(ms) },
  console: { warn: (message) => warnings.push(message) }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../local-update.js"), "utf8"), context);
const up = context.module.exports;
async function main() {
  const file = path.join(root, "status.json");
  fs.writeFileSync(file, '{"phase":"old"}');
  remaining = 2; up.atomicJson(file, { phase: "new" });
  assert.equal(attempts, 3); assert.deepEqual(delays, [25, 50]);
  assert.equal(up.readJson(file).phase, "new");
  for (const errorCode of ["EPERM", "EACCES", "EBUSY", "EIO"]) {
    code = errorCode; attempts = 0; remaining = 100; delays = []; unlinks = [];
    assert.throws(() => up.atomicJson(file, { phase: "must-not-replace" }), (error) => error.code === errorCode);
    assert.equal(attempts, errorCode === "EIO" ? 1 : 6, "Retries must be bounded and only for sharing/access errors");
    assert.equal(up.readJson(file).phase, "new", "Never unlink or truncate the old status to force replacement");
    assert.ok(!unlinks.includes(file));
    assert.deepEqual(fs.readdirSync(root), ["status.json"], "Clean up failed temporary writes");
  }
  remaining = 0;
  fs.writeFileSync(path.join(root, "app.js"), 'const APPLICATION_RELEASE = Object.freeze({version: "1.0.0"});');
  fs.writeFileSync(path.join(root, "index.html"), 'const build = "test-lock-old";');
  let rejectDownload;
  const updater = up.createUpdater(root, {
    idle: async () => true, restart: async () => assert.fail("A failed status write must not start installation")
  }, { fetcher: () => new Promise((_resolve, reject) => { rejectDownload = reject; }) });
  try {
    await updater.recover();
    const checking = updater.checkNow();
    remaining = 100; code = "EPERM";
    assert.doesNotThrow(() => heartbeat(), "A busy status file must not crash the supervisor timer");
    rejectDownload(Object.assign(Error("EPERM: test status busy"), { code: "EPERM" }));
    await checking;
    assert.equal(updater.maintenance(), false);
    assert.ok(warnings.length >= 2, "Log failed progress reporting instead of an unhandled exception");
    assert.equal(up.version(root), "1.0.0");
  } finally { updater.dispose(); }
  console.log("Local update file locks: bounded retries, atomic preservation, temporary cleanup, heartbeat and error-report safety: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith("ais-update-lock-test-")) fs.rmSync(root, { recursive: true, force: true });
});
