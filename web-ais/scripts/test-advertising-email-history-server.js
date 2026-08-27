const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  advertisingEmailHistoryEmailKey,
  normalizeAdvertisingEmailHistoryRows,
  emptyAdvertisingEmailHistoryResult,
  buildAdvertisingEmailHistoryResult,
  persistAdvertisingEmailHistoryResult
} = require("../app-server.js");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");

const normalized = normalizeAdvertisingEmailHistoryRows([
  { email: " Saved@Example.ru ", name: "Сохранённый" },
  { email: "saved@example.ru", name: "Последняя версия" },
  { email: "new@example.ru", organization: "Новая организация" },
  { email: "blocked@example.ru", excluded: true, exclusionReason: "Исключение" },
  { email: "не email" }
]);
assert.deepEqual(normalized.map((row) => row.email), [
  "blocked@example.ru",
  "new@example.ru",
  "saved@example.ru"
]);
assert.equal(normalized.find((row) => row.email === "saved@example.ru").name, "Последняя версия");
assert.match(advertisingEmailHistoryEmailKey("SAVED@example.ru"), /^[a-f0-9]{64}$/u);
assert.equal(
  advertisingEmailHistoryEmailKey("SAVED@example.ru"),
  advertisingEmailHistoryEmailKey("saved@example.ru")
);

const collected = {
  refreshedAt: "2026-08-27T12:00:00.000Z",
  durationMs: 1234,
  sources: [{ id: "ais", label: "АИС", status: "ok", count: 3 }],
  workbook: { status: "ok", source: "Тест" },
  summary: { raw: 4, unique: 3, ready: 2, excluded: 1, duplicates: 1, exclusionRules: 1 },
  rows: normalized
};
const previousKeys = new Set([advertisingEmailHistoryEmailKey("saved@example.ru")]);
const compared = buildAdvertisingEmailHistoryResult(collected, previousKeys, {
  runId: "run-current",
  previousRun: { runId: "run-previous", refreshedAt: "2026-08-26T12:00:00.000Z" }
});
assert.equal(compared.exists, true);
assert.equal(compared.runId, "run-current");
assert.deepEqual(compared.comparedTo, {
  hasPrevious: true,
  runId: "run-previous",
  refreshedAt: "2026-08-26T12:00:00.000Z"
});
assert.equal(compared.rows.find((row) => row.email === "saved@example.ru").isNew, false);
assert.equal(compared.rows.find((row) => row.email === "new@example.ru").isNew, true);
assert.equal(compared.rows.find((row) => row.email === "blocked@example.ru").isNew, true);
assert.equal(compared.summary.newUnique, 2);
assert.equal(compared.summary.newReady, 1);

const firstRun = buildAdvertisingEmailHistoryResult(collected, [], { runId: "run-first" });
assert.equal(firstRun.comparedTo.hasPrevious, false);
assert.ok(firstRun.rows.every((row) => row.isNew));
assert.equal(firstRun.summary.newUnique, 3);
assert.equal(firstRun.summary.newReady, 2);

assert.deepEqual(emptyAdvertisingEmailHistoryResult().comparedTo, {
  hasPrevious: false,
  runId: "",
  refreshedAt: ""
});
assert.equal(emptyAdvertisingEmailHistoryResult().summary.newUnique, 0);
assert.equal(emptyAdvertisingEmailHistoryResult().summary.newReady, 0);

assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_advertising_email_history_contacts/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_advertising_email_history_runs/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_advertising_email_history_run_contacts/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_advertising_email_history_state/u);
assert.match(
  serverSource,
  /beginTransaction\(\)[\s\S]*?ais_advertising_email_history_state[\s\S]*?FOR UPDATE[\s\S]*?readAdvertisingEmailHistoryMembership[\s\S]*?insertAdvertisingEmailHistoryRunContacts[\s\S]*?commit\(\)/u
);
assert.match(serverSource, /ADVERTISING_EMAIL_HISTORY_WRITE_CHUNK_SIZE/u);
assert.match(serverSource, /ADVERTISING_EMAIL_HISTORY_MAX_CONTACTS_PER_RUN/u);
assert.match(serverSource, /ADVERTISING_EMAIL_HISTORY_RETAINED_RUNS = 2/u);
assert.match(
  serverSource,
  /if \(req\.method === "GET"\)[\s\S]*?readLatestAdvertisingEmailHistoryResult\(\)/u
);
assert.match(
  serverSource,
  /const collected = await collectAdvertisingEmails[\s\S]*?persistAdvertisingEmailHistoryResult\(collected, authUser\)/u
);

(async () => {
  await assert.rejects(
    () => persistAdvertisingEmailHistoryResult({ sources: [], rows: [] }),
    (error) => (
      error?.statusCode === 502
      && error?.code === "ADVERTISING_HISTORY_NO_SUCCESSFUL_SOURCES"
      && /Предыдущий результат сохранён без изменений/u.test(error.message)
    )
  );
  console.log("Advertising email history server tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
