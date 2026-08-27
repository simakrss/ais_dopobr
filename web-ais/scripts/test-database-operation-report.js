const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const syncSource = fs.readFileSync(path.join(root, "scripts", "sync-student-database.ps1"), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Не найдено начало блока: ${startMarker}`);
  assert.notEqual(end, -1, `Не найден конец блока: ${endMarker}`);
  return source.slice(start, end);
}

const normalizeBlock = sourceBlock(
  appSource,
  "function normalizeDatabaseOperationResultItem(",
  "function getDatabaseOperationResultRowValue("
);
const normalizeDatabaseOperationResultItem = new Function(
  `${normalizeBlock}\nreturn normalizeDatabaseOperationResultItem;`
)();
const normalized = normalizeDatabaseOperationResultItem({
  key: "unmatched-programs",
  label: "Не сопоставлено программ",
  value: 3,
  problem: true,
  rows: [{ name: "Программа", landingCode: "5003" }]
}, 0);
assert.equal(normalized.problem, true);
assert.equal(normalized.key, "unmatched-programs");
assert.deepEqual(normalized.columns, [
  { key: "name", label: "name" },
  { key: "landingCode", label: "landingCode" }
]);
assert.equal(normalized.rows.length, 1);

const renderBlock = sourceBlock(
  appSource,
  "const DATABASE_OPERATION_RESULT_PREVIEW_LIMIT",
  "function exportDatabaseOperationResultReport("
);
const renderDatabaseOperationResultItemDetails = new Function(
  "escapeHtml",
  `${renderBlock}\nreturn renderDatabaseOperationResultItemDetails;`
)((value) => String(value));
const detailHtml = renderDatabaseOperationResultItemDetails(normalized);
assert.match(detailHtml, /is-problem/u);
assert.match(detailHtml, /Программа/u);
assert.match(detailHtml, /5003/u);

const showBlock = sourceBlock(
  appSource,
  "function showDatabaseOperationResult(",
  "function closeDatabaseOperationResult("
);
const operationState = { databaseOperationResult: null };
const showDatabaseOperationResult = new Function(
  "normalizeDatabaseOperationResultItem",
  "state",
  "appendStudentDatabaseOperationHistory",
  "render",
  "requestAnimationFrame",
  "document",
  `${showBlock}\nreturn showDatabaseOperationResult;`
)(
  normalizeDatabaseOperationResultItem,
  operationState,
  () => {},
  () => {},
  (callback) => callback(),
  { querySelector: () => null }
);
showDatabaseOperationResult({
  tone: "error",
  recordHistory: false,
  items: [
    { key: "ordinary", label: "Обычный показатель", value: 1 },
    { key: "sync-conflicts", label: "Конфликты", value: 1, problem: true }
  ]
});
assert.equal(
  operationState.databaseOperationResult.selectedItemKey,
  "sync-conflicts",
  "В ошибочном отчёте первый проблемный показатель должен быть раскрыт сразу"
);

assert.match(appSource, /Экспорт отчёта CSV/u);
assert.match(appSource, /show-database-operation-result-item/u);
assert.match(appSource, /exportDatabaseOperationResultReport/u);
assert.match(appSource, /Синхронизированные изменения \(/u);
assert.match(appSource, /data-item-key="synchronized-changes"/u);
assert.match(appSource, /hiddenStat:\s*true/u);
assert.match(appSource, /\{ key: "before", label: "Было" \}/u);
assert.match(appSource, /\{ key: "after", label: "Стало" \}/u);
assert.match(appSource, /problem:\s*Number\(result\.programPromoSkippedCount/u);
assert.match(appSource, /problem:\s*nextDirectExpenses\.length\s*>\s*0/u);
assert.match(stylesSource, /database-operation-result-stat\.is-problem/u);
assert.match(stylesSource, /database-operation-result-item-details/u);

assert.match(syncSource, /programPromoSkippedDetails\s*=\s*@\(\$programPromoResult\.SkippedPrograms\)/u);
assert.match(syncSource, /programMissingManagedColumnNames\s*=\s*@\(\$programPromoResult\.MissingManagedColumnNames\)/u);
assert.match(syncSource, /ConvertTo-Json -Compress -Depth 6/u);
assert.match(serverSource, /programPromoSkippedDetails,/u);
assert.match(serverSource, /communicationTemplateMissingNamedRangeNames,/u);

console.log("database operation report checks: OK");
