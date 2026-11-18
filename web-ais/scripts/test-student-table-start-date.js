"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
const configStart = source.indexOf("  const configs = {");
const configEnd = source.indexOf("    contracts: {", configStart);
assert.ok(configStart >= 0 && configEnd > configStart);
const constants = source.match(/^  const (?:TABLE_SETTINGS_KEY|(?:STUDENTS|DIRECT_EXPENSES|GENERAL_EXPENSES|CONTRACTS)_TABLE_LAYOUT_VERSION(?:_KEY)?) = .*;$/gm);
assert.equal(constants.length, 9);
const storage = new Map();
let writes = 0;
let failWrites = false;
let downloaded;
const c = vm.createContext({
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { if (failWrites) throw Error("Storage unavailable"); storage.set(key, value); writes += 1; }
  },
  console: { warn() {} },
  unique: (values) => [...new Set(values)],
  state: { tableSettings: {} },
  money: (value) => `${value} ₽`,
  download: (name, content) => { downloaded = { name, content }; },
  calculateDaysUntilDate: () => 10
});
vm.runInContext([
  ...constants, extract("field"), source.slice(configStart, configEnd) + "};",
  ...["migrateStudentTableSettings", "loadTableSettings", "getTableKeys", "getTableFields", "dateRu", "valueForDisplay", "getTableCellValue", "exportCsv", "csvCell"].map(extract)
].join("\n"), c);
const config = vm.runInContext("configs.students", c);
const key = vm.runInContext("TABLE_SETTINGS_KEY", c);
const versionKey = vm.runInContext("STUDENTS_TABLE_LAYOUT_VERSION_KEY", c);
const version = vm.runInContext("STUDENTS_TABLE_LAYOUT_VERSION", c);
const expected = ["name", "status", "program", "applicationDate", "startDate", "endDate", "daysUntilEnd", "balance"];
const plain = (value) => JSON.parse(JSON.stringify(value));
function seedOtherVersions() {
  for (const name of ["DIRECT_EXPENSES", "GENERAL_EXPENSES", "CONTRACTS"]) {
    storage.set(vm.runInContext(`${name}_TABLE_LAYOUT_VERSION_KEY`, c), vm.runInContext(`${name}_TABLE_LAYOUT_VERSION`, c));
  }
}
assert.deepEqual(plain(config.table), expected);
assert.equal(config.fields.find((field) => field.key === "phone").label, "Телефон", "Keep the phone in the student card");
seedOtherVersions();
let settings = c.loadTableSettings();
assert.deepEqual(plain(settings.students.order), expected);
assert.equal(storage.get(versionKey), version);
assert.equal(writes, 2);
const old = {
  students: {
    order: ["program", "name", "status", "applicationDate", "phone", "balance", "endDate", "documentsStatus"],
    widths: { name: 240, phone: 130, balance: 90, documentsStatus: 105 },
    pageSize: 100, collapsedGroups: ["deferred-start"], expandedGroups: ["pro"], extra: "preserve"
  },
  programs: { order: ["price", "name"], pageSize: 50 }
};
const oldSnapshot = JSON.stringify(old);
storage.set(key, oldSnapshot);
storage.set(versionKey, "days-until-end-replaces-documents");
settings = c.loadTableSettings();
assert.deepEqual(plain(settings.students.order), ["program", "name", "status", "applicationDate", "startDate", "endDate", "daysUntilEnd", "balance"]);
assert.deepEqual(plain(settings.students.widths), { name: 240, startDate: 130, balance: 90, daysUntilEnd: 105 });
assert.equal(settings.students.pageSize, 100);
assert.deepEqual(plain(settings.students.collapsedGroups), ["deferred-start"]);
assert.deepEqual(plain(settings.students.expandedGroups), ["pro"]);
assert.equal(settings.students.extra, "preserve");
assert.deepEqual(plain(settings.programs), old.programs);
assert.equal(JSON.stringify(old), oldSnapshot);
assert.deepEqual(plain(c.migrateStudentTableSettings(settings.students)), plain(settings.students), "Migration is idempotent");
const widths = c.migrateStudentTableSettings({ widths: { phone: 150, startDate: 110, documentsStatus: 120, daysUntilEnd: 100 } }).widths;
assert.deepEqual(plain(widths), { startDate: 110, daysUntilEnd: 100 }, "Keep already configured date/day widths");
const duplicateKeys = c.migrateStudentTableSettings({ order: ["phone", "startDate", "balance", "balance", "unknown"] }).order;
assert.equal(duplicateKeys.filter((key) => key === "startDate").length, 1);
assert.equal(duplicateKeys.filter((key) => key === "balance").length, 1);
assert.equal(duplicateKeys.at(-1), "balance");
assert.equal(duplicateKeys.includes("unknown"), false);
// Subsequent user adjustments remain possible; only the version change triggers migration.
settings.students.order = ["balance", ...expected.filter((key) => key !== "balance")];
storage.set(key, JSON.stringify(settings));
const beforeReload = writes;
assert.deepEqual(plain(c.loadTableSettings().students.order), plain(settings.students.order));
assert.equal(writes, beforeReload);
storage.set(key, "invalid-json");
storage.delete(versionKey);
settings = c.loadTableSettings();
assert.deepEqual(plain(settings.students.order), expected);
storage.delete(versionKey);
failWrites = true;
assert.deepEqual(plain(c.loadTableSettings().students.order), expected, "Storage failure must not prevent the new layout in memory");
failWrites = false;
c.state.tableSettings = {};
assert.deepEqual(plain(c.getTableKeys(config, "students")), expected, "Reset/default view uses the requested order");
const fields = c.getTableFields(config, "students");
assert.equal(fields[4].key, "startDate");
assert.equal(fields[4].type, "date");
assert.equal(fields[4].label, "Начало обучения");
assert.equal(fields.at(-1).label, "Остаток");
assert.equal(c.valueForDisplay("startDate", "2026-09-27", "students"), "27.09.2026");
assert.equal(c.valueForDisplay("startDate", "", "students"), "—");
const student = { name: "Тестовый слушатель", phone: "+79000000000", startDate: "2026-09-27", balance: 2500 };
c.exportCsv("students", [student]);
assert.equal(downloaded.name, "students.csv");
const [header, row] = downloaded.content.slice(1).split("\n");
assert.equal(header, '"ФИО";"Статус";"Программа";"Дата заявки";"Начало обучения";"Окончание";"Дней до конца";"Остаток"');
assert.equal(row.split(";")[4], '"2026-09-27"');
assert.equal(row.split(";").at(-1), '"2500"');
assert.equal(downloaded.content.includes(student.phone), false);
assert.equal(student.phone, "+79000000000");
console.log("Student table: start date instead of phone, balance last, legacy migration, preserved settings/widths, reload/reset, date display and CSV: OK");
