const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  extractAdvertisingEmails,
  parseAdvertisingCollectorWorkbook,
  aggregateAdvertisingEmailResults
} = require("../app-server.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
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
assert.match(appSource, /Копировать готовые/u);
assert.match(appSource, /Экспорт CSV/u);
assert.match(appSource, /ADVERTISING_EMAIL_SOURCES/u);
assert.match(serverSource, /\/api\/advertising\/email-collector\/collect/u);
assert.match(serverSource, /\/api\/advertising\/email-collector\/settings/u);
assert.match(serverSource, /ADVERTISING_GOOGLE_SHEET_SOURCES/u);
assert.match(serverSource, /handleAdvertisingEmailSettings[\s\S]*authUser\?\.role !== "admin"/u);
assert.match(serverSource, /Promise\.allSettled\(definitions\.map/u);
assert.match(serverSource, /attempt <= 3/u);
assert.match(serverCliSource, /closeAdvertisingAbitMySqlStorage\(\)/u);
assert.match(serverCliSource, /closeAdvertisingMoodleMySqlStorage\(\)/u);
assert.match(stylesSource, /\.advertising-source-grid/u);
assert.match(stylesSource, /\.advertising-email-table/u);
assert.match(indexSource, /20260824-mobile-registry-filters-v1/u);

console.log("Advertising email collector tests passed.");
