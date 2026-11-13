const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  extractAdvertisingEmails,
  normalizeAdvertisingSourceReceivedAt,
  parseAdvertisingCollectorWorkbook,
  parseAdvertisingGoogleWorkbook,
  normalizeAdvertisingEmailRecords,
  aggregateAdvertisingEmailResults,
  normalizeAdvertisingEmailSources,
  normalizeAdvertisingEmailExclusions,
  mergeAdvertisingEmailExclusions,
  normalizeAdvertisingEmailHistoryRows,
  resolveAdvertisingEmailCollectionRequest
} = require("../app-server.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8");
const serverCliSource = fs.readFileSync(path.join(root, "server-cli.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const workbookPath = "Y:\\Реклама\\Базы рассылок\\База рассылок.xlsb";
const XLSX = require(path.join(root, "vendor", "sheetjs", "xlsx.full.min.js"));

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

assert.deepEqual(
  extractAdvertisingEmails("Первый USER@Example.ru; повтор user@example.ru и second.person+tag@mail.org"),
  ["user@example.ru", "second.person+tag@mail.org"]
);

assert.equal(
  normalizeAdvertisingSourceReceivedAt(new Date("2024-05-16T09:30:00.000Z")),
  "2024-05-16T09:30:00.000Z"
);
assert.equal(normalizeAdvertisingSourceReceivedAt("2024-05-16 09:30:00"), "2024-05-16T09:30:00.000Z");
assert.equal(normalizeAdvertisingSourceReceivedAt("16.05.2024 09:30:00"), "2024-05-16T09:30:00.000Z");
assert.equal(normalizeAdvertisingSourceReceivedAt("2024-01-02T12:00:00+03:00"), "2024-01-02T09:00:00.000Z");
assert.equal(normalizeAdvertisingSourceReceivedAt(Date.UTC(2024, 0, 2, 9) / 1000), "2024-01-02T09:00:00.000Z");
assert.equal(normalizeAdvertisingSourceReceivedAt("не дата"), "");

const collectorFixture = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(collectorFixture, XLSX.utils.aoa_to_sheet([
  ["FIO", "Дата добавления", "Email"],
  ["Иван", "16.05.2024 09:30:00", "ONE@example.ru; two@example.ru"],
  ["Без даты", "", "old@example.ru"]
]), "База контактов");
XLSX.utils.book_append_sheet(collectorFixture, XLSX.utils.aoa_to_sheet([
  [], [], [], ["", "", "", "", "", "", "", "", "", "", "google@example.ru"]
]), "Выгрузка Email");
XLSX.utils.book_append_sheet(collectorFixture, XLSX.utils.aoa_to_sheet([
  ["Email", "Примечание"]
]), "База исключений");
const parsedFixture = parseAdvertisingCollectorWorkbook(XLSX.write(collectorFixture, {
  type: "buffer",
  bookType: "xlsb"
}));
assert.equal(
  parsedFixture.legacyContacts.find((row) => row.email === "one@example.ru").sourceReceivedAt,
  "2024-05-16T09:30:00.000Z"
);
assert.equal(
  parsedFixture.legacyContacts.find((row) => row.email === "two@example.ru").sourceReceivedAt,
  "2024-05-16T09:30:00.000Z"
);
assert.equal(parsedFixture.legacyContacts.find((row) => row.email === "old@example.ru").sourceReceivedAt, "");

const googleFixture = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(googleFixture, XLSX.utils.aoa_to_sheet([
  ["Отметка времени", "Адрес электронной почты"],
  ["02.01.2024 12:30:00", "FORM@example.ru"]
]), "Ответы на форму (1)");
const googleRows = parseAdvertisingGoogleWorkbook(
  XLSX.write(googleFixture, { type: "buffer", bookType: "xlsx" }),
  ["Адрес электронной почты"]
);
assert.equal(googleRows[0].sourceReceivedAt, "2024-01-02T12:30:00.000Z");

const sqlRows = normalizeAdvertisingEmailRecords([
  { email: "sql@example.ru", sourceReceivedAt: "2024-03-01 10:20:30" },
  { email: "legacy@example.ru", sourceReceivedAt: "некорректно" }
]);
assert.equal(sqlRows[0].sourceReceivedAt, "2024-03-01T10:20:30.000Z");
assert.equal(sqlRows[1].sourceReceivedAt, "");

const aggregated = aggregateAdvertisingEmailResults([
  {
    id: "one",
    label: "Источник 1",
    records: [
      { email: "first@example.ru", name: "Первый", sourceReceivedAt: "2025-04-20T10:00:00Z" },
      { email: "repeat@example.org", organization: "Организация" }
    ]
  },
  {
    id: "two",
    label: "Источник 2",
    records: [
      { email: "FIRST@example.ru", phone: "+7 900 000-00-00", sourceReceivedAt: "2024-01-02T12:00:00+03:00" },
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
assert.equal(
  aggregated.rows.find((row) => row.email === "first@example.ru").sourceReceivedAt,
  "2024-01-02T09:00:00.000Z"
);
assert.equal(aggregated.rows.find((row) => row.email === "blocked@deny.ru").excluded, true);
assert.equal(aggregated.rows.find((row) => row.email === "repeat@example.org").sourceReceivedAt, "");

const historyRows = normalizeAdvertisingEmailHistoryRows([
  { email: "old-snapshot@example.ru", firstSeenAt: "2026-08-27T12:00:00Z" },
  { email: "dated-snapshot@example.ru", sourceReceivedAt: "2024-05-16T09:30:00Z" }
]);
assert.equal(historyRows.find((row) => row.email === "old-snapshot@example.ru").sourceReceivedAt, "");
assert.equal(
  historyRows.find((row) => row.email === "dated-snapshot@example.ru").sourceReceivedAt,
  "2024-05-16T09:30:00.000Z"
);

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
  resolveAdvertisingEmailCollectionRequest(
    { sourceIds: ["custom-sql"], source: "local" },
    { role: "manager" }
  ),
  { sourceIds: [], source: "auto" }
);
assert.deepEqual(
  resolveAdvertisingEmailCollectionRequest(
    { sourceIds: ["custom-sql"], source: "webdav" },
    { role: "admin" }
  ),
  { sourceIds: ["custom-sql"], source: "webdav" }
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
  assert.ok(parsed.legacyContacts.some((row) => row.sourceReceivedAt), "Дата добавления должна быть прочитана");
  assert.ok(parsed.exclusions.length > 100, "Правила исключений должны быть прочитаны");
}

assert.match(appSource, /id: "statistics"[\s\S]*id: "advertising"[\s\S]*id: "students"/u);
assert.match(appSource, /function renderAdvertising\(\)/u);
assert.match(appSource, /function collectAdvertisingEmails\(\)/u);
assert.doesNotMatch(appSource, /queueMicrotask\(\(\) => collectAdvertisingEmails\(\)\)/u);
assert.match(appSource, /\[data-action='collect-advertising-emails'\][\s\S]*?addEventListener\("click", collectAdvertisingEmails\)/u);
const advertisingRendererBlock = sourceBlock(appSource, "function renderAdvertising()", "async function loadAdvertisingEmailSettings(");
assert.match(advertisingRendererBlock, /\.\.\.\(isAdminUser\(\) \? \[\{ id: "sources", label: "Источники" \}\] : \[\]\)/u);
assert.match(advertisingRendererBlock, /const advertisingTab = advertisingTabs\.some[\s\S]*: "collector"/u);
assert.match(advertisingRendererBlock, /advertising\.tab = advertisingTab/u);
assert.match(advertisingRendererBlock, /\$\{isAdminUser\(\) \? `<div class="advertising-source-picker">/u);
assert.match(appSource, /isAdminUser\(\) && !state\.advertising\.settingsLoaded/u);
const advertisingSourcesBlock = sourceBlock(appSource, "function getAdvertisingEmailSources(", "function renderAdvertisingSourceCards(");
assert.match(advertisingSourcesBlock, /if \(!isAdminUser\(\)\)/u);
assert.match(advertisingSourcesBlock, /state\.advertising\.result\?\.sources/u);
const advertisingSettingsLoaderBlock = sourceBlock(appSource, "async function loadAdvertisingEmailSettings(", "async function loadAdvertisingEmailResult(");
assert.match(advertisingSettingsLoaderBlock, /if \(!isAdminUser\(\)\) return;/u);
const advertisingCollectorBlock = sourceBlock(appSource, "async function collectAdvertisingEmails()", "function parseAdvertisingWorkbookEditorValue(");
assert.match(advertisingCollectorBlock, /const sourceIds = isAdminUser\(\) \? advertising\.selectedSourceIds : \[\]/u);
assert.match(advertisingCollectorBlock, /if \(isAdminUser\(\) && !sourceIds\.length\)/u);
assert.match(advertisingCollectorBlock, /body: JSON\.stringify\(\{ sourceIds \}\)/u);
const advertisingEventsBlock = sourceBlock(appSource, "function bindAdvertisingEvents()", "function bindFinanceDetailsEvents(");
assert.match(advertisingEventsBlock, /tab === "sources" && !isAdminUser\(\)/u);
const advertisingServerCollectorBlock = sourceBlock(serverSource, "async function handleAdvertisingEmailCollector(", "async function handleAdvertisingEmailHistory(");
assert.match(advertisingServerCollectorBlock, /resolveAdvertisingEmailCollectionRequest\(body, authUser\)/u);
assert.match(advertisingServerCollectorBlock, /collectAdvertisingEmails\(collectionRequest\.sourceIds,/u);
const advertisingSettingsHandlerBlock = sourceBlock(serverSource, "async function handleAdvertisingEmailSettings(", "async function handleAdvertisingEmailExclusions(");
const advertisingSettingsRoleIndex = advertisingSettingsHandlerBlock.indexOf('authUser?.role !== "admin"');
const advertisingSettingsGetIndex = advertisingSettingsHandlerBlock.indexOf('req.method === "GET"');
assert.ok(advertisingSettingsRoleIndex >= 0 && advertisingSettingsGetIndex > advertisingSettingsRoleIndex);
assert.match(advertisingSettingsHandlerBlock, /publicAdvertisingEmailSettings\(true\)/u);
assert.match(appSource, /Копировать готовые/u);
assert.match(appSource, /Экспорт CSV/u);
assert.match(appSource, /ADVERTISING_EMAIL_SOURCES/u);
assert.match(appSource, /class="ghost-button compact-button" data-action="select-all-advertising-sources"/u);
assert.match(appSource, /class="danger-button compact-button" data-action="delete-advertising-source"/u);
assert.doesNotMatch(appSource, /class="text-button" data-action="(?:select-all|clear|move|delete)-advertising/u);
assert.match(serverSource, /\/api\/advertising\/email-collector\/collect/u);
assert.match(serverSource, /\/api\/advertising\/email-collector\/settings/u);
assert.match(serverSource, /DEFAULT_ADVERTISING_EMAIL_SOURCES/u);
assert.ok((serverSource.match(/AS sourceReceivedAt/gu) || []).length >= 7);
assert.match(serverSource, /student\.applicationDate/u);
assert.match(serverSource, /contract\.contractDate/u);
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
assert.match(gatewaySource, /'\/api\/advertising\/email-collector\/settings'[\s\S]*gateway_require_admin\(\$currentUser\)/u);
assert.match(appSource, /advertisingExclusionsSync/u);
assert.match(appSource, /через сайт/u);
const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(
  fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8")
)?.[1] || "";
assert.ok(authBuild, "Не найден идентификатор сборки загрузчика");
assert.match(indexSource, new RegExp(`(?:styles\\.css|auth-bootstrap\\.js)\\?v=${authBuild}`, "u"));

console.log("Advertising email collector tests passed.");
