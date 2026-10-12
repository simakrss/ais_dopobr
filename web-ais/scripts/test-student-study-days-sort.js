const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requestedSource = String(process.env.AIS_TEST_APP_SOURCE || "").trim();
const appPath = requestedSource
  ? path.resolve(process.cwd(), requestedSource)
  : path.resolve(__dirname, "..", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

const context = {
  configs: { students: { defaultSort: { key: "name", dir: "asc" } } },
  state: {
    view: "students",
    search: "",
    documentTemplateSearch: "",
    statusFilter: "Учится",
    sort: null,
    studentProgramTypeFilter: [],
    studentListFilters: {},
    programRegistryTypeFilter: [],
    contractSectionFilter: [],
    studentImportedViewIds: [],
    directExpenseNoteFilter: "",
    generalExpenseSectionFilter: [],
    generalExpenseWorkTypeFilter: []
  },
  CONTRACT_SECTIONS: [],
  GENERAL_EXPENSE_SECTIONS: [],
  getRowsForConfig(_config, rowsOverride) {
    return rowsOverride || [];
  },
  getStudentListSelectedPrograms() {
    return [];
  },
  getProgramRegistryTypeFilterOptions() {
    return [];
  },
  normalizeEducationProgramType() {
    return "";
  },
  findProgramByName() {
    return null;
  },
  normalizeContractSection() {
    return "";
  },
  normalizeGeneralExpenseSection() {
    return "";
  },
  calculateDaysUntilDate(value) {
    const text = String(value || "").trim();
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  },
  compareProgramNames(left, right) {
    return String(left || "").localeCompare(String(right || ""), "ru");
  }
};
vm.createContext(context);
vm.runInContext(
  `${extractBetween("  function getDefaultTableSort", "  function parseTableSortDate")}
   ${extractBetween("  function parseTableSortDate", "  function getFilterOptions")}
   ${extractBetween("  function getTableCellValue", "  function pushStudentStatusHistory")}
   this.getStudentStatusTableSort = getStudentStatusTableSort;
   this.getVisibleRows = getVisibleRows;`,
  context
);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.getStudentStatusTableSort("Учится"))),
  { key: "daysUntilEnd", dir: "asc" },
  "Для статуса «Учится» должна включаться сортировка по возрастанию дней до конца"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.getStudentStatusTableSort("  УЧИТСЯ  "))),
  { key: "daysUntilEnd", dir: "asc" },
  "Выбор статуса должен быть нечувствителен к регистру и пробелам"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.getStudentStatusTableSort("Все"))),
  { key: "applicationDate", dir: "desc" },
  "Сортировка списка «Все» не должна измениться"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.getStudentStatusTableSort("Отчислен"))),
  { key: "endDate", dir: "desc" },
  "Сортировка отчисленных не должна измениться"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.getStudentStatusTableSort("На зачисление"))),
  { key: "name", dir: "asc" },
  "Другие статусы должны сохранять стандартную сортировку таблицы"
);

context.state.sort = context.getStudentStatusTableSort("Учится");
const config = {
  collection: "students",
  fields: [{ key: "daysUntilEnd", type: "number" }]
};
const sortedRows = context.getVisibleRows(config, [
  { id: "later", status: "Учится", endDate: "10" },
  { id: "missing", status: "Учится", endDate: "" },
  { id: "overdue", status: "Учится", endDate: "-2" },
  { id: "extended", status: "Учится", endDate: "20", extendedEndDate: "1" },
  { id: "soon", status: "Учится", endDate: "2" },
  { id: "other-status", status: "Отчислен", endDate: "-50" }
]);
assert.deepEqual(
  sortedRows.map((row) => row.id),
  ["overdue", "extended", "soon", "later", "missing"],
  "Таблица должна численно сортировать вычисляемые дни, учитывать продление и оставлять пустые даты внизу"
);

assert.match(
  extractBetween("    document.querySelectorAll(\"[data-view]\")", "    document.querySelectorAll(\"[data-view-shortcut]\")"),
  /state\.sort\s*=\s*state\.view\s*===\s*"students"[\s\S]*?getStudentStatusTableSort\(state\.statusFilter\)/u,
  "При открытии раздела слушателей должна устанавливаться статусная сортировка"
);
assert.match(
  extractBetween("  let state = {", "  let recordLockHeartbeatTimer"),
  /sort:\s*initialView\s*===\s*"students"[\s\S]*?getStudentStatusTableSort\(getDefaultStatusFilter\(initialView\)\)/u,
  "Сохранённая стартовая страница «Слушатели» должна сразу открываться с нужной сортировкой"
);
assert.match(
  extractBetween("    document.getElementById(\"statusFilter\")", "    const directExpenseNoteFilter"),
  /state\.statusFilter\s*=\s*event\.target\.value;[\s\S]*?state\.sort\s*=\s*getStudentStatusTableSort\(state\.statusFilter\)/u,
  "При смене фильтра должна сразу устанавливаться сортировка выбранного статуса"
);
assert.match(
  extractBetween("    document.querySelectorAll(\"[data-student-status-shortcut]\")", "    const issuedDocumentsRegister"),
  /state\.statusFilter\s*=\s*status;[\s\S]*?state\.sort\s*=\s*getStudentStatusTableSort\(status\)/u,
  "Переход из виджета статусов должен применять ту же сортировку"
);

const manualSortSource = extractBetween(
  "    document.querySelectorAll(\"[data-action='sort']\")",
  "    document.querySelectorAll(\"[data-action='sort-inventory-students']\")"
);
assert.match(
  manualSortSource,
  /state\.sort\s*=\s*\{\s*key,[\s\S]*?state\.sort\.key\s*===\s*key/u,
  "Ручной клик по заголовку должен по-прежнему менять текущую сортировку"
);
assert.doesNotMatch(
  manualSortSource,
  /getStudentStatusTableSort/u,
  "Ручная сортировка не должна немедленно сбрасываться статусным правилом"
);

console.log("Student study days sort tests passed.");
