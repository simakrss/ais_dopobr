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

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}.`);
  return source.slice(start, end);
}

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

assert.match(
  serverSource,
  /const ADVERTISING_EMAIL_HISTORY_RETAINED_RUNS\s*=\s*30;/u,
  "Метаданные и new-only наборы должны храниться для 30 последних запросов."
);
assert.match(
  serverSource,
  /const ADVERTISING_EMAIL_HISTORY_FULL(?:_SNAPSHOT)?_RUNS\s*=\s*2;/u,
  "Полные снимки должны сохраняться только для двух последних запросов."
);

assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_advertising_email_history_contacts/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_advertising_email_history_runs/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_advertising_email_history_deleted_runs/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_advertising_email_history_run_contacts/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_advertising_email_history_state/u);
assert.match(
  serverSource,
  /beginTransaction\(\)[\s\S]*?ais_advertising_email_history_state[\s\S]*?FOR UPDATE[\s\S]*?readAdvertisingEmailHistoryMembership[\s\S]*?insertAdvertisingEmailHistoryRunContacts[\s\S]*?commit\(\)/u
);
assert.match(serverSource, /ADVERTISING_EMAIL_HISTORY_WRITE_CHUNK_SIZE/u);
assert.match(serverSource, /ADVERTISING_EMAIL_HISTORY_MAX_CONTACTS_PER_RUN/u);
const runContactsReaderSource = sourceSlice(
  serverSource,
  "async function readAdvertisingEmailHistoryRunContacts(",
  "async function insertAdvertisingEmailHistoryContacts("
);
assert.match(
  runContactsReaderSource,
  /SELECT[\s\S]*?contact\.first_seen_at[\s\S]*?LEFT JOIN ais_advertising_email_history_contacts AS contact/u,
  "Снимок запуска должен получать дату первого появления адреса из общего реестра контактов."
);
assert.match(
  runContactsReaderSource,
  /firstSeenAt:\s*advertisingEmailHistoryIsoDate\(\s*row\.first_seen_at/u,
  "API должен возвращать дату первого получения адреса в ISO-формате."
);
const persistHistorySource = sourceSlice(
  serverSource,
  "async function persistAdvertisingEmailHistoryResult(",
  "async function readLatestAdvertisingEmailHistoryResult("
);
const canonicalInsertIndex = persistHistorySource.indexOf("insertAdvertisingEmailHistoryContacts(connection");
const snapshotInsertIndex = persistHistorySource.indexOf("insertAdvertisingEmailHistoryRunContacts(connection");
const enrichedReadIndex = persistHistorySource.indexOf("payload.rows = await readAdvertisingEmailHistoryRunContacts(connection");
const commitIndex = persistHistorySource.indexOf("await connection.commit()");
assert.ok(
  canonicalInsertIndex >= 0
    && canonicalInsertIndex < snapshotInsertIndex
    && snapshotInsertIndex < enrichedReadIndex
    && enrichedReadIndex < commitIndex,
  "Ответ нового запуска должен обогащаться датами первого получения после записи контактов и до commit."
);
const pruneHistorySource = sourceSlice(
  serverSource,
  "async function pruneAdvertisingEmailHistoryRuns(",
  "async function persistAdvertisingEmailHistoryResult("
);
assert.match(pruneHistorySource, /ADVERTISING_EMAIL_HISTORY_RETAINED_RUNS/u);
assert.match(pruneHistorySource, /ADVERTISING_EMAIL_HISTORY_FULL(?:_SNAPSHOT)?_RUNS/u);
assert.match(
  pruneHistorySource,
  /\.slice\(ADVERTISING_EMAIL_HISTORY_FULL(?:_SNAPSHOT)?_RUNS\)/u,
  "Очистка не-новых контактов должна начинаться только после двух полных запусков."
);
assert.match(
  pruneHistorySource,
  /DELETE FROM ais_advertising_email_history_run_contacts[\s\S]*?is_new\s*=\s*0/u,
  "У более старых, но ещё сохранённых запусков нужно удалять только не-новые контакты."
);
assert.match(
  pruneHistorySource,
  /SELECT run_id[\s\S]*?NOT IN[\s\S]*?DELETE FROM ais_advertising_email_history_runs[\s\S]*?WHERE run_id IN/u,
  "Запуски старше retention-лимита должны удаляться полностью."
);
assert.match(
  serverSource,
  /if \(req\.method === "GET"\)[\s\S]*?readLatestAdvertisingEmailHistoryResult\(\)/u
);
assert.match(
  serverSource,
  /const collected = await collectAdvertisingEmails[\s\S]*?persistAdvertisingEmailHistoryResult\(collected, authUser\)/u
);

assert.match(
  serverSource,
  /requestUrl\.pathname === "\/api\/advertising\/email-collector\/history"/u,
  "Не найден маршрут истории рекламных запросов."
);
const historyHandlerMatch = /async function (handleAdvertisingEmailHistory[A-Za-z0-9_$]*)\(/u.exec(serverSource);
assert.ok(historyHandlerMatch, "Не найден обработчик истории рекламных запросов.");
const historyHandlerName = historyHandlerMatch[1];
const historyHandlerStart = serverSource.indexOf(`async function ${historyHandlerName}(`);
const nextFunctionStart = serverSource.indexOf("\nasync function ", historyHandlerStart + 1);
assert.ok(nextFunctionStart > historyHandlerStart, "Не найден конец обработчика истории рекламных запросов.");
const historyHandlerSource = serverSource.slice(historyHandlerStart, nextFunctionStart);
assert.match(historyHandlerSource, /\["GET",\s*"DELETE"\]\.includes\(req\.method\)/u);
assert.match(historyHandlerSource, /searchParams\.get\("runId"\)|\.searchParams\.get\("runId"\)/u);
assert.match(historyHandlerSource, /readAdvertisingEmailHistoryRuns/u);
assert.match(historyHandlerSource, /readAdvertisingEmailHistory(?:Run)?New/u);
assert.match(historyHandlerSource, /deleteAdvertisingEmailHistoryRun/u);
assert.match(historyHandlerSource, /safelyAppendAuditEntry/u);

const deleteHistorySource = sourceSlice(
  serverSource,
  "async function deleteAdvertisingEmailHistoryRun(",
  "async function readAdvertisingEmailHistoryNewReadyEmails("
);
assert.match(deleteHistorySource, /authUser\?\.role[\s\S]{0,80}?admin/u);
assert.match(deleteHistorySource, /beginTransaction\(\)/u);
assert.match(deleteHistorySource, /FOR UPDATE/u);
assert.match(deleteHistorySource, /INSERT INTO ais_advertising_email_history_deleted_runs/u);
assert.match(deleteHistorySource, /commit\(\)/u);
assert.match(deleteHistorySource, /rollback\(\)/u);
assert.doesNotMatch(deleteHistorySource, /DELETE FROM ais_advertising_email_history_runs/u);
assert.doesNotMatch(deleteHistorySource, /UPDATE ais_advertising_email_history_state/u);

const historyListSource = sourceSlice(
  serverSource,
  "async function readAdvertisingEmailHistoryRuns(",
  "async function readLatestAdvertisingEmailHistoryRunId("
);
assert.match(historyListSource, /LEFT JOIN ais_advertising_email_history_deleted_runs/u);
assert.match(historyListSource, /deleted_run\.run_id IS NULL/u);

const collectorHandlerSource = sourceSlice(
  serverSource,
  "async function handleAdvertisingEmailCollector(",
  "async function handleAdvertisingEmailHistory("
);
assert.match(collectorHandlerSource, /searchParams\?\.get\("knownRunId"\)/u);
assert.match(collectorHandlerSource, /readLatestAdvertisingEmailHistoryRunId/u);
assert.match(collectorHandlerSource, /notModified:\s*true/u);

assert.match(
  serverSource,
  /SELECT[\s\S]{0,900}?FROM ais_advertising_email_history_runs[\s\S]{0,500}?ORDER BY (?:current_run\.)?run_sequence DESC[\s\S]{0,200}?LIMIT \$\{ADVERTISING_EMAIL_HISTORY_RETAINED_RUNS\}/u,
  "Список запусков должен возвращаться от нового к старому и быть ограничен retention-лимитом."
);

const newOnlyReaderMatch = /async function (readAdvertisingEmailHistory(?:Run)?New[A-Za-z0-9_$]*)\(/u.exec(serverSource);
assert.ok(newOnlyReaderMatch, "Не найдена загрузка new-only набора отдельного запуска.");
const newOnlyReaderStart = serverSource.indexOf(`async function ${newOnlyReaderMatch[1]}(`);
const newOnlyReaderEnd = serverSource.indexOf("\nasync function ", newOnlyReaderStart + 1);
assert.ok(newOnlyReaderEnd > newOnlyReaderStart, "Не найден конец загрузки new-only набора.");
const newOnlyReaderSource = serverSource.slice(newOnlyReaderStart, newOnlyReaderEnd);
assert.match(newOnlyReaderSource, /WHERE run_id\s*=\s*\?/u, "runId должен передаваться параметром SQL.");
assert.match(newOnlyReaderSource, /is_new\s*=\s*1/u);
assert.match(newOnlyReaderSource, /excluded\s*=\s*0/u);
assert.doesNotMatch(
  newOnlyReaderSource,
  /\$\{[^}]*runId[^}]*\}/u,
  "runId нельзя подставлять непосредственно в SQL."
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
