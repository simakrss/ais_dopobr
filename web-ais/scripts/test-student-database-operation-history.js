const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Не найдено начало блока: ${startMarker}`);
  assert.notEqual(end, -1, `Не найден конец блока: ${endMarker}`);
  return source.slice(start, end);
}

const historyFunctions = sourceBlock(
  appSource,
  "function getStudentDatabaseOperationType(",
  "function getDatabaseOperationResultRowValue("
);
const historyApi = new Function(`
  const STUDENT_DATABASE_OPERATION_HISTORY_LIMIT = 100;
  const STUDENT_DATABASE_OPERATION_HISTORY_ROW_LIMIT = 500;
  ${historyFunctions}
  return {
    normalizeStudentDatabaseOperationHistoryEntry,
    normalizeStudentDatabaseOperationHistory
  };
`)();

const synchronizedRows = Array.from({ length: 700 }, (_, index) => ({
  number: index + 1,
  entity: "Слушатели",
  record: `Запись ${index + 1}`,
  action: "Изменено",
  field: "Сумма договора",
  before: "4000",
  after: "2500"
}));
const entry = historyApi.normalizeStudentDatabaseOperationHistoryEntry({
  id: "operation-1",
  eyebrow: "Синхронизация с XLSB",
  title: "Синхронизация завершена",
  summary: "Изменения перенесены.",
  generatedAt: "2026-08-26T10:00:00.000Z",
  userLogin: "admin",
  userName: "Администратор",
  details: [
    { label: "Источник", value: "на локальном компьютере" },
    { label: "Время выполнения", value: "2 мин 38 сек" },
    { label: "Резервная копия", value: "Y:\\АИС Допобразование\\_Резерв\\backup.xlsb" }
  ],
  items: [
    {
      key: "synchronized-changes",
      label: "Синхронизированные изменения",
      value: 700,
      columns: [
        { key: "record", label: "Запись" },
        { key: "field", label: "Поле" },
        { key: "before", label: "Было" },
        { key: "after", label: "Стало" }
      ],
      rows: synchronizedRows
    },
    { key: "direction", label: "Направление", value: "Web → Excel" }
  ]
});

assert.equal(entry.operation, "sync");
assert.equal(entry.operationLabel, "Синхронизация");
assert.equal(entry.status, "success");
assert.equal(entry.sourceKey, "local");
assert.equal(entry.direction, "Web → Excel");
assert.equal(entry.duration, "2 мин 38 сек");
assert.equal(entry.userLogin, "admin");
assert.equal(entry.items[0].rows.length, 500);
assert.equal(entry.items[0].rowCount, 700);
assert.equal(entry.items[0].rowsTruncated, true);

const conflictEntry = historyApi.normalizeStudentDatabaseOperationHistoryEntry({
  id: "operation-conflict",
  tone: "error",
  eyebrow: "Синхронизация с XLSB",
  title: "Синхронизация не выполнена полностью",
  generatedAt: "2026-08-27T12:48:48.000Z",
  items: [{
    key: "sync-conflicts",
    label: "Конкретные расхождения Web и XLSB",
    value: 1,
    problem: true,
    columns: [
      { key: "record", label: "Запись" },
      { key: "web", label: "Web" },
      { key: "excel", label: "XLSB" }
    ],
    rows: [{ record: "Пащенко", web: "Примечание", excel: "Доп. статус" }]
  }]
});
assert.equal(conflictEntry.status, "error");
assert.equal(conflictEntry.items[0].key, "sync-conflicts");
assert.equal(conflictEntry.items[0].problem, true);
assert.equal(conflictEntry.items[0].rows[0].record, "Пащенко");
assert.equal(conflictEntry.items[0].rows[0].excel, "Доп. статус");

const historyDetailBlock = sourceBlock(
  appSource,
  "function renderStudentDatabaseOperationHistoryDetails(",
  "function renderStudentDatabaseOperationHistoryDialog("
);
const historyState = { databaseOperationHistory: { selectedItemKey: "" } };
const renderStudentDatabaseOperationHistoryDetails = new Function(
  "state",
  "escapeAttr",
  "escapeHtml",
  "renderDatabaseOperationResultItemDetails",
  "formatDateTimeRu",
  `${historyDetailBlock}\nreturn renderStudentDatabaseOperationHistoryDetails;`
)(
  historyState,
  String,
  String,
  (item) => `<div>${item.key}</div>`,
  String
);
renderStudentDatabaseOperationHistoryDetails({
  status: "error",
  title: "Ошибка синхронизации",
  summary: "Обнаружены конфликты",
  generatedAt: "2026-08-27T12:48:48.000Z",
  userLogin: "admin",
  userName: "Администратор",
  sourceLabel: "локально",
  details: [],
  items: [
    { key: "synchronized-changes", label: "Изменения", value: 4, problem: false },
    { key: "sync-conflicts", label: "Конфликты", value: 1, problem: true }
  ]
});
assert.equal(
  historyState.databaseOperationHistory.selectedItemKey,
  "sync-conflicts",
  "История ошибочной операции должна сразу раскрывать проблемный показатель"
);

const limitedHistory = historyApi.normalizeStudentDatabaseOperationHistory(
  Array.from({ length: 120 }, (_, index) => ({
    id: `operation-${index}`,
    eyebrow: index % 2 ? "Импорт XLSB" : "Экспорт XLSB",
    generatedAt: new Date(Date.UTC(2026, 7, 26, 0, index)).toISOString()
  }))
);
assert.equal(limitedHistory.length, 100);
assert.equal(limitedHistory[0].id, "operation-119");

assert.match(appSource, /studentDatabaseOperationHistory\s*=\s*normalizeStudentDatabaseOperationHistory/u);
assert.match(appSource, /appendStudentDatabaseOperationHistory\(normalizedResult\)/u);
assert.match(appSource, /data-action="open-student-database-operation-history"/u);
assert.match(appSource, /class="icon-button" data-action="open-student-database-operation-history"/u);
assert.match(appSource, /class="student-database-history-icon"/u);
assert.match(appSource, /История операций/u);
assert.match(appSource, /data-import-button-label>\$\{state\.databaseImport\.running \? "Загрузка\.\.\." : "Загрузить"\}<\/span>/u);
assert.match(appSource, /data-database-download-button-label>\$\{state\.databaseExport\.running[\s\S]*?"Формирование\.\.\." : "Экспорт"\}<\/span>/u);
assert.match(appSource, /data-database-export-button-label>\$\{state\.databaseExport\.running[\s\S]*?"Синхронизация\.\.\." : "Синхронизация"\}<\/span>/u);
assert.match(appSource, /filter-student-database-operation-history/u);
assert.match(appSource, /exportStudentDatabaseOperationHistory/u);
assert.match(appSource, /Состояние XLSB/u);
assert.equal((appSource.match(/showDatabaseOperationResult\(\{/gu) || []).length, 6);
assert.match(stylesSource, /student-database-operation-history-modal/u);
assert.match(stylesSource, /student-database-operation-history-status\.is-error/u);

console.log("student database operation history checks: OK");
