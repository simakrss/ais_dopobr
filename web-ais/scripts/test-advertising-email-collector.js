const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  extractAdvertisingEmails,
  parseAdvertisingCollectorWorkbook,
  aggregateAdvertisingEmailResults,
  normalizeAdvertisingEmailSources,
  normalizeAdvertisingEmailExclusions,
  mergeAdvertisingEmailExclusions
} = require("../app-server.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8");
const serverCliSource = fs.readFileSync(path.join(root, "server-cli.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const workbookPath = "Y:\\Реклама\\Базы рассылок\\База рассылок.xlsb";

assert.deepEqual(
  extractAdvertisingEmails("Первый USER@Example.ru; повтор user@example.ru и second.person+tag@mail.org"),
  ["user@example.ru", "second.person+tag@mail.org"]
);

const aggregated = aggregateAdvertisingEmailResults([
  {
    id: "one",
    label: "Источник 1",
    records: [
      { email: "first@example.ru", name: "Первый" },
      { email: "repeat@example.org", organization: "Организация" }
    ]
  },
  {
    id: "two",
    label: "Источник 2",
    records: [
      { email: "FIRST@example.ru", phone: "+7 900 000-00-00" },
      { email: "blocked@deny.ru" }
    ]
  }
], [
  { key: "first@example.ru", note: "Индивидуальное исключение" },
  { key: "@deny.ru", note: "Домен исключён" }
]);

assert.equal(aggregated.summary.raw, 4);
assert.equal(aggregated.summary.unique, 3);
assert.equal(aggregated.summary.duplicates, 1);
assert.equal(aggregated.summary.excluded, 2);
assert.equal(aggregated.summary.ready, 1);
assert.equal(aggregated.rows.find((row) => row.email === "first@example.ru").sources.length, 2);
assert.equal(aggregated.rows.find((row) => row.email === "blocked@deny.ru").excluded, true);

const customSources = normalizeAdvertisingEmailSources([
  {
    id: "custom-sql",
    label: "Пользовательский SQL",
    group: "Новые",
    kind: "sql",
    connection: "applications",
    sql: "SELECT email FROM registrations",
    enabled: true
  },
  {
    id: "custom-workbook",
    label: "Раздел XLSB",
    kind: "workbook",
    dataset: "legacyContacts",
    enabled: false
  }
]);
assert.equal(customSources.length, 2);
assert.equal(customSources[0].sql, "SELECT email FROM registrations");
assert.equal(customSources[1].enabled, false);
assert.throws(
  () => normalizeAdvertisingEmailSources([
    { id: "duplicate", label: "Первый", kind: "ais" },
    { id: "duplicate", label: "Второй", kind: "ais" }
  ]),
  /повторяется/u
);
assert.throws(
  () => normalizeAdvertisingEmailSources([
    { id: "unsafe", label: "Опасный SQL", kind: "sql", connection: "applications", sql: "DELETE FROM users" }
  ]),
  /только запрос SELECT/u
);

assert.deepEqual(
  normalizeAdvertisingEmailExclusions([
    { key: "USER@EXAMPLE.RU", note: "Первое правило" },
    { key: "user@example.ru", note: "Обновлённое правило" },
    { key: "@BLOCKED.RU", note: "Домен" }
  ]),
  [
    { key: "@blocked.ru", note: "Домен" },
    { key: "user@example.ru", note: "Обновлённое правило" }
  ]
);
assert.deepEqual(
  mergeAdvertisingEmailExclusions(
    [{ key: "first@example.ru", note: "Из XLSB" }],
    [{ key: "first@example.ru", note: "Из интерфейса" }, { key: "@deny.ru" }]
  ),
  [
    { key: "@deny.ru", note: "" },
    { key: "first@example.ru", note: "Из интерфейса" }
  ]
);

if (fs.existsSync(workbookPath)) {
  const parsed = parseAdvertisingCollectorWorkbook(fs.readFileSync(workbookPath));
  assert.ok(parsed.sheets.includes("База контактов"));
  assert.ok(parsed.sheets.includes("База исключений"));
  assert.ok(parsed.legacyContacts.length > 1000, "Историческая база контактов должна быть прочитана");
  assert.ok(parsed.exclusions.length > 100, "Правила исключений должны быть прочитаны");
}

assert.match(appSource, /id: "statistics"[\s\S]*id: "advertising"[\s\S]*id: "students"/u);
assert.match(appSource, /function renderAdvertising\(\)/u);
assert.match(appSource, /function collectAdvertisingEmails\(\)/u);
assert.doesNotMatch(appSource, /queueMicrotask\(\(\) => collectAdvertisingEmails\(\)\)/u);
assert.match(appSource, /\[data-action='collect-advertising-emails'\][\s\S]*?addEventListener\("click", collectAdvertisingEmails\)/u);
assert.match(appSource, /Копировать готовые/u);
assert.match(appSource, /Экспорт CSV/u);
assert.match(appSource, /ADVERTISING_EMAIL_SOURCES/u);
assert.match(serverSource, /\/api\/advertising\/email-collector\/collect/u);
assert.match(serverSource, /\/api\/advertising\/email-collector\/settings/u);
assert.match(serverSource, /DEFAULT_ADVERTISING_EMAIL_SOURCES/u);
assert.match(serverSource, /normalizeAdvertisingEmailSources/u);
assert.match(serverSource, /\/api\/advertising\/email-collector\/exclusions/u);
assert.match(serverSource, /\/api\/advertising\/email-collector\/sync/u);
assert.match(serverSource, /Promise\.allSettled\(definitions\.map/u);
assert.match(serverSource, /attempt <= 3/u);
assert.match(serverCliSource, /closeAdvertisingAbitMySqlStorage\(\)/u);
assert.match(serverCliSource, /closeAdvertisingMoodleMySqlStorage\(\)/u);
assert.match(stylesSource, /\.advertising-source-grid/u);
assert.match(stylesSource, /\.advertising-email-table/u);
assert.match(stylesSource, /\.advertising-source-builder-panel/u);
assert.match(serverSource, /trySyncAdvertisingEmailExclusionsForDatabaseOperation/u);
assert.match(serverSource, /queryAdvertisingEmailRecordsThroughSite/u);
assert.match(serverSource, /source-proxy/u);
assert.match(gatewaySource, /gateway_handle_advertising_source_proxy/u);
assert.match(gatewaySource, /hash_equals/u);
assert.match(appSource, /advertisingExclusionsSync/u);
assert.match(appSource, /через сайт/u);
assert.match(indexSource, /20260826-advertising-manual-collect-v1/u);

console.log("Advertising email collector tests passed.");
