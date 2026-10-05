"use strict";
// Synthetic SQLite only; does not collect contacts, write history, or contact production sites.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const {DatabaseSync} = require("node:sqlite");
const api = require("../app-server");
const source = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8");
function block(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ais-vitu-relay-"));
  const databasePath = path.join(root, "mirror.sqlite");
  const originalPath = process.env.AIS_ADVERTISING_VITU_DATABASE;
  const db = new DatabaseSync(databasePath);
  const now = Date.now(), synced = new Date(now).toISOString();
  try {
    process.env.AIS_ADVERTISING_VITU_DATABASE = databasePath;
    db.exec("CREATE TABLE mirror_sync_state(id INTEGER PRIMARY KEY, synced_at TEXT); CREATE TABLE applications(id INTEGER, email TEXT, created_at TEXT, archive_state TEXT, passport TEXT)");
    db.prepare("INSERT INTO mirror_sync_state VALUES(1,?)").run(synced);
    const insert = db.prepare("INSERT INTO applications VALUES(?,?,?,?,?)");
    insert.run(1, "FIRST@example.org; second@example.org", "2026-09-01", "active", "PRIVATE_NOT_FOR_TRANSFER");
    insert.run(2, "deleted@example.org", "2026-09-01", "deleted", "PRIVATE_NOT_FOR_TRANSFER");
    insert.run(3, "archived@example.org", "2026-09-02", "archived", "PRIVATE_NOT_FOR_TRANSFER");
    insert.run(4, "", "2026-09-02", "active", "PRIVATE_NOT_FOR_TRANSFER");
    assert.equal(api.hasAdvertisingVituMirror(), true);
    const before = fs.readFileSync(databasePath);
    const controller = new AbortController();
    const result = await api.executeDocumentRelayJob("vitu-emails", {}, controller);
    assert.deepEqual(result.records.map(row => row.email), ["first@example.org", "second@example.org", "archived@example.org"]);
    assert.equal(result.sourceSyncedAt, synced);
    for (const row of result.records) assert.deepEqual(Object.keys(row), ["email", "sourceReceivedAt"]);
    assert.ok(!JSON.stringify(result).includes("PRIVATE_NOT_FOR_TRANSFER"));
    assert.deepEqual(fs.readFileSync(databasePath), before, "Read-only executor must not change the mirror");
    const local = await api.queryAdvertisingVituContacts();
    assert.equal(local.processing, "vitu-mirror");
    assert.equal(local.length, 3);
    for (const payload of [null, [], {path: databasePath}, {sql: "SELECT * FROM applications"}, {url: "https://example.org"}]) {
      await assert.rejects(api.executeDocumentRelayJob("vitu-emails", payload, controller), /Недопустимое задание ВИТУ/);
    }
    controller.abort(new Error("Test cancellation"));
    await assert.rejects(api.executeDocumentRelayJob("vitu-emails", {}, controller), /Test cancellation/);
    db.prepare("UPDATE mirror_sync_state SET synced_at=?").run(new Date(now - 16 * 60000).toISOString());
    await assert.rejects(api.executeDocumentRelayJob("vitu-emails", {}, new AbortController()), /15 минут/);
    await assert.rejects(api.queryAdvertisingVituContacts(), /15 минут/, "Never fall back to old snapshots");
    db.prepare("UPDATE mirror_sync_state SET synced_at=?").run(new Date(now + 120000).toISOString());
    assert.throws(() => api.readAdvertisingVituContacts(databasePath, now), /15 минут/);
    process.env.AIS_ADVERTISING_VITU_DATABASE = path.join(root, "missing.sqlite");
    assert.equal(api.hasAdvertisingVituMirror(), false);
    await assert.rejects(api.executeDocumentRelayJob("vitu-emails", {}, new AbortController()), /недоступны/);
    assert.equal(fs.existsSync(process.env.AIS_ADVERTISING_VITU_DATABASE), false);

    let relayResult = result, calls = 0, relayError = null;
    const context = vm.createContext({Date, Object, Array, Error,
      hasAdvertisingVituMirror: () => false,
      normalizeAdvertisingEmailRecords: api.normalizeAdvertisingEmailRecords,
      getDocumentRelayClient: async () => ({run: async (kind, payload, options) => {
        calls++; assert.equal(kind, "vitu-emails"); assert.equal(Object.keys(payload).length, 0);
        assert.equal(options.timeoutMs, 55000);
        if (relayError) throw relayError;
        return relayResult;
      }})
    });
    vm.runInContext(block("function validateAdvertisingVituSyncTime(", "function readAdvertisingVituContacts("), context);
    vm.runInContext(block("async function queryAdvertisingVituContacts(", "async function runAdvertisingEmailSource("), context);
    const received = await context.queryAdvertisingVituContacts();
    assert.equal(received.processing, "vitu-relay"); assert.equal(received.sourceSyncedAt, synced);
    assert.deepEqual(received.map(row => row.email), result.records.map(row => row.email));
    // Source-side personal fields cannot leak through a modified/old worker result.
    relayResult = {sourceSyncedAt: synced, records: [{email: "safe@example.org", name: "PRIVATE", phone: "PRIVATE"}]};
    assert.ok(!JSON.stringify(await context.queryAdvertisingVituContacts()).includes("PRIVATE"));
    for (relayResult of [null, {}, {sourceSyncedAt: synced, records: new Array(100001)},
      {sourceSyncedAt: "", records: []}, {sourceSyncedAt: new Date(now - 16 * 60000).toISOString(), records: []}]) {
      await assert.rejects(context.queryAdvertisingVituContacts(), /некорректный|15 минут/);
    }
    relayError = new Error("Нет доступного компьютера с базой ВИТУ");
    await assert.rejects(context.queryAdvertisingVituContacts(), /Нет доступного компьютера/, "Unavailable is not an empty list");
    assert.ok(calls > 5);
    const routing = block("async function runAdvertisingEmailSource(", "function aggregateAdvertisingEmailResults(");
    assert.match(routing, /source.kind === "vitu"[\s\S]*?return queryAdvertisingVituContacts\(\)/);
    const gateway = fs.readFileSync(path.join(__dirname, "../gateway.php"), "utf8");
    const proxy = gateway.slice(gateway.indexOf("function gateway_handle_advertising_source_proxy("), gateway.indexOf("function gateway_sanitize_external_service_url("));
    assert.doesNotMatch(proxy, /gateway_run_tunnel/, "Legacy compatibility must not send VITU to a tunnel");
    assert.match(proxy, /hash_equals/, "Legacy authenticated proxy stays protected");
    assert.match(block("function startDocumentRelayWorker(", "function isUnavailableDocumentPathError("), /hasAdvertisingVituMirror\(\) \? \["vitu-emails"\]/);
    const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
    assert.match(app, /через защищённую очередь zifra-plus\.ru, без туннеля/);
    console.log("PASS VITU relay: local/hosted routing, email/date only, read-only mirror, deleted rows, capability gating, freshness at both ends, payload validation and cancellation");
  } finally {
    db.close();
    if (originalPath === undefined) delete process.env.AIS_ADVERTISING_VITU_DATABASE;
    else process.env.AIS_ADVERTISING_VITU_DATABASE = originalPath;
    assert.ok(path.basename(root).startsWith("ais-vitu-relay-"));
    fs.rmSync(root, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
