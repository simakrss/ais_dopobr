const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const api = require("../app-server.js");

const sources = [
  { id: "misc", label: "Other", stream: "other", records: [{ email: "both@example.org" }, { email: "other@example.org" }] },
  { id: "vitu_applicants", label: "VITU", kind: "vitu", records: [{ email: "BOTH@example.org" }, { email: "new@example.org" }, { email: "denied@example.org" }] }
];
const collected = api.aggregateAdvertisingEmailResults(sources, [{ key: "denied@example.org" }]);
assert.equal(collected.rows.length, 4);
assert.equal(collected.rows.find((row) => row.email === "both@example.org").stream, "applicants");
assert.equal(collected.rows.find((row) => row.email === "other@example.org").stream, "other");
assert.deepEqual(api.aggregateAdvertisingEmailResults([...sources].reverse(), [{ key: "denied@example.org" }]).rows, collected.rows);
const result = api.buildAdvertisingEmailHistoryResult(collected, [api.advertisingEmailHistoryEmailKey("both@example.org")], {
  previousRun: { runId: "previous" },
  transferredEmailKeys: new Set([api.advertisingEmailHistoryEmailKey("other@example.org")])
});
assert.deepEqual(result.summary.streams, {
  applicants: { unique: 3, ready: 2, newReady: 1 },
  other: { unique: 1, ready: 1, newReady: 0 }
});
const legacy = api.normalizeAdvertisingEmailHistoryRows([
  { email: "applicant@example.org", sources: [{ id: "viit_applicants" }] },
  { email: "counselor@example.org", sources: [{ id: "viit_counselors" }] },
  { email: "custom@example.org", sources: [{ id: "custom", stream: "applicants" }] }
]);
assert.deepEqual(legacy.map((row) => row.stream), ["applicants", "other", "applicants"]);
assert.equal(api.advertisingEmailSourceStream({ id: "viit_open_days" }), "applicants");
assert.equal(api.advertisingEmailSourceStream({ id: "viit_applicants", stream: "other" }), "other");
assert.equal(api.normalizeAdvertisingEmailSources([{ id: "custom", kind: "vitu", stream: "other" }])[0].stream, "applicants");

// Temporary fixtures are deliberately confined to the user's managed workspace.
const tempRoot = process.env.AIS_TEST_TMP || "D:/Jupiter/AIS-Email-Streams-Tests";
fs.mkdirSync(tempRoot, { recursive: true });
const fixtureRoot = fs.mkdtempSync(path.join(tempRoot, "vitu-"));
const databasePath = path.join(fixtureRoot, "vitu.sqlite");
const now = Date.parse("2026-10-02T04:00:00Z");
try {
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE applications(id TEXT, email TEXT, created_at TEXT, archive_state TEXT); CREATE TABLE mirror_sync_state(id INTEGER PRIMARY KEY,synced_at TEXT)");
  db.prepare("INSERT INTO mirror_sync_state VALUES(1,?)").run(new Date(now).toISOString());
  const insert = db.prepare("INSERT INTO applications VALUES(?,?,?,?)");
  insert.run("1", "VITU@example.org; second@example.org", "2026-09-01T12:00:00Z", "active");
  insert.run("2", "", "2026-09-01", "active");
  insert.run("3", "archived@example.org", "2025-01-01", "archived");
  db.close();
  const before = fs.readFileSync(databasePath);
  const contacts = api.readAdvertisingVituContacts(databasePath, now);
  assert.deepEqual(contacts.map((row) => row.email), ["archived@example.org", "vitu@example.org", "second@example.org"]);
  assert.equal(contacts.find((row) => row.email === "vitu@example.org").sourceReceivedAt, "2026-09-01T12:00:00.000Z");
  assert.equal(contacts.processing, "vitu-mirror");
  assert.deepEqual(fs.readFileSync(databasePath), before, "Reading must not mutate the mirror");
  assert.throws(() => api.readAdvertisingVituContacts(databasePath, now + 16 * 60000), /15 минут/);
  assert.throws(() => api.readAdvertisingVituContacts(path.join(fixtureRoot, "missing.sqlite"), now), /недоступны/);
  assert.equal(fs.existsSync(path.join(fixtureRoot, "missing.sqlite")), false);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

// Execute production UI functions with synthetic contacts, including historical rows.
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
const blocks = [...app.matchAll(/^  (?:async )?function ([\w$]+)\([^\n]*\) \{[\s\S]*?^  \}/gm)];
const names = ["getAdvertisingSourceStream", "getAdvertisingRowStream", "getAdvertisingStreamRows", "renderAdvertisingStreams"];
const uiState = { advertising: { result, loading: false, resultLoading: false, resultCachePartial: false } };
const ui = new Function("state", "isAdvertisingCurrentRowNew", "formatStatisticsInteger",
  names.map((name) => blocks.find((block) => block[1] === name)?.[0] || assert.fail(name)).join("\n")
  + "\nreturn {getAdvertisingStreamRows,renderAdvertisingStreams,getAdvertisingRowStream};")(
  uiState, (row) => row.isNew && !uiState.advertising.result.transferredToAdvertising, String
);
assert.deepEqual(ui.getAdvertisingStreamRows("applicants", true).map((row) => row.email), ["new@example.org"]);
assert.deepEqual(ui.getAdvertisingStreamRows("other").map((row) => row.email), ["other@example.org"]);
assert.equal(ui.getAdvertisingRowStream({ sources: [{ id: "viit_applicants" }] }), "applicants");
const html = ui.renderAdvertisingStreams();
assert.equal((html.match(/data-action="copy-advertising-stream"/g) || []).length, 4);
uiState.advertising.result.transferredToAdvertising = true;
assert.equal(ui.getAdvertisingStreamRows("applicants", true).length, 0);
uiState.advertising.resultCachePartial = true;
assert.equal((ui.renderAdvertisingStreams().match(/data-action="copy-advertising-stream"[^>]*disabled/g) || []).length, 4);
async function testHistoryCopy() {
  const server = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8");
  const historyFunction = server.slice(server.indexOf("async function readAdvertisingEmailHistoryNewReadyEmails("), server.indexOf("async function readAdvertisingEmailHistoryMembership("));
  let transferred = false;
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql) {
      if (sql.includes("SELECT run.run_id")) return [[{ run_id: "test-run", transferred_to_advertising: Number(transferred) }]];
      assert.match(sql, /is_new = 1 AND excluded = 0/, "History copies must only read new non-excluded contacts");
      return [[
        { email_key: "1", data_json: JSON.stringify({ email: "applicant@example.org", sources: [{ id: "viit_applicants" }] }) },
        { email_key: "2", data_json: JSON.stringify({ email: "other@example.org", stream: "other" }) }
      ]];
    }
  };
  const context = {
    normalizeAdvertisingEmailHistoryRunId: (value) => value,
    getSharedRecordLocksMySqlPool: async () => ({ getConnection: async () => connection }),
    advertisingEmailHistoryJson: (value) => JSON.parse(value),
    advertisingEmailHistoryError: (message, statusCode) => Object.assign(new Error(message), { statusCode }),
    isMySqlConnectivityError: () => false,
    advertisingEmailRowStream: api.advertisingEmailRowStream,
    extractAdvertisingEmails: api.extractAdvertisingEmails,
    ADVERTISING_EMAIL_HISTORY_READ_PAGE_SIZE: 5000,
    ADVERTISING_EMAIL_HISTORY_STATE_KEY: "test"
  };
  const copy = new Function(...Object.keys(context), historyFunction + '\nreturn readAdvertisingEmailHistoryNewReadyEmails;')(...Object.values(context));
  assert.deepEqual((await copy('test-run', 'applicants')).emails, ['applicant@example.org']);
  assert.deepEqual((await copy('test-run', 'other')).emails, ['other@example.org']);
  assert.equal((await copy('test-run')).emails.length, 2);
  await assert.rejects(copy('test-run', 'invalid'), { statusCode: 400 });
  transferred = true;
  assert.equal((await copy('test-run', 'applicants')).count, 0);
  console.log("PASS: VITU read-only source, freshness, stream deduplication, history API, exclusions and stream copy UI");
}
testHistoryCopy().catch((error) => { console.error(error); process.exitCode = 1; });
