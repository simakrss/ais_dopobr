"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/gu, "\n");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

const helperStart = appSource.indexOf("  function parseStudentApplicationSortDate");
const helperEnd = appSource.indexOf("\n\n  function getVisibleStudentApplications", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Не найден блок сортировки заявок");

const STUDENT_APPLICATIONS_IMPORT_DEFAULT_SORT = { key: "date", dir: "desc" };
const STUDENT_APPLICATIONS_IMPORT_TABLE_COLUMNS = [
  { key: "date", type: "date" },
  { key: "name" },
  { key: "order" },
  { key: "payment", type: "number" },
  { key: "program" },
  { key: "phone" },
  { key: "email" },
  { key: "city" },
  { key: "source" }
];
const getStudentApplicationReceiptAmount = (row) => Number(row.payment || 0);
const factory = new Function(
  "STUDENT_APPLICATIONS_IMPORT_DEFAULT_SORT",
  "STUDENT_APPLICATIONS_IMPORT_TABLE_COLUMNS",
  "getStudentApplicationReceiptAmount",
  `${appSource.slice(helperStart, helperEnd)}\nreturn { parseStudentApplicationSortDate, sortStudentApplicationRows };`
);
const helpers = factory(
  STUDENT_APPLICATIONS_IMPORT_DEFAULT_SORT,
  STUDENT_APPLICATIONS_IMPORT_TABLE_COLUMNS,
  getStudentApplicationReceiptAmount
);

const dateRows = [
  { id: "old", date: "19.08.2026 23:59:59" },
  { id: "new", date: "20.08.2026 10:15:30" },
  { id: "early", date: "20.08.2026 08:00:00" },
  { id: "empty", date: "" }
];
assert.deepEqual(
  helpers.sortStudentApplicationRows(dateRows, { key: "date", dir: "desc" }).map((row) => row.id),
  ["new", "early", "old", "empty"],
  "Дата и время должны сортироваться по убыванию, пустое значение — оставаться внизу"
);
assert.deepEqual(
  helpers.sortStudentApplicationRows(dateRows, { key: "date", dir: "asc" }).map((row) => row.id),
  ["old", "early", "new", "empty"],
  "Пустая дата должна оставаться внизу и при сортировке по возрастанию"
);
assert.deepEqual(
  helpers.sortStudentApplicationRows([
    { id: "large", payment: 12000 },
    { id: "small", payment: 390 },
    { id: "zero", payment: 0 }
  ], { key: "payment", dir: "asc" }).map((row) => row.id),
  ["zero", "small", "large"],
  "Оплата должна сортироваться численно"
);
assert.ok(
  helpers.parseStudentApplicationSortDate("20.08.2026 10:15:30")
    > helpers.parseStudentApplicationSortDate("20.08.2026 08:00:00"),
  "Парсер даты должен учитывать время заявки"
);

assert.match(appSource, /STUDENT_APPLICATIONS_IMPORT_TABLE_COLUMNS[\s\S]*key: "date"[\s\S]*key: "source"/u);
assert.match(appSource, /getTableFields\(\s*studentApplicationsImportTableConfig/u);
assert.match(appSource, /data-action="sort-student-applications"/u);
assert.match(appSource, /class="column-resize-handle"[\s\S]*data-config="\$\{STUDENT_APPLICATIONS_IMPORT_TABLE_CONFIG_ID\}"/u);
assert.match(appSource, /bindTableColumnEvents\(scope\)/u);
assert.match(appSource, /annotateShiftRequiredDraggableElements\(scope\)/u);
const shiftExemptStart = appSource.indexOf("  const SHIFT_DRAG_EXEMPT_SELECTOR");
const shiftExemptEnd = appSource.indexOf("\n  const STUDENT_CARD_TAB_ORDER_KEY", shiftExemptStart);
assert.ok(shiftExemptStart >= 0 && shiftExemptEnd > shiftExemptStart, "Не найден список исключений Shift-перетаскивания");
const shiftExemptSelector = new Function(
  "STUDENT_APPLICATIONS_IMPORT_TABLE_CONFIG_ID",
  `${appSource.slice(shiftExemptStart, shiftExemptEnd)}\nreturn SHIFT_DRAG_EXEMPT_SELECTOR;`
)("studentApplicationsImport");
assert.match(
  shiftExemptSelector,
  /\.table-column-head\[data-table-config="studentApplicationsImport"\]\[data-column-key\]/u,
  "Заголовки импорта должны оставаться draggable без Shift"
);
const dragHelpersStart = appSource.indexOf("  function isShiftDragExemptElement");
const dragHelpersEnd = appSource.indexOf("\n\n  function bindShiftDragRequirement", dragHelpersStart);
assert.ok(dragHelpersStart >= 0 && dragHelpersEnd > dragHelpersStart, "Не найдены обработчики Shift-перетаскивания");
class FakeElement {
  constructor(importHeader = false) {
    this.importHeader = importHeader;
    this.dataset = {};
    this.draggable = true;
    this.attributes = { title: "Перетащите элемент" };
  }

  closest(selector) {
    if (this.importHeader && selector.includes('[data-table-config="studentApplicationsImport"]')) return this;
    if (selector === '[draggable="true"]' && this.draggable) return this;
    return null;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}
const importHeader = new FakeElement(true);
const protectedDragElement = new FakeElement(false);
const fakeDocument = { body: { classList: { contains: () => false } } };
const annotateShiftRequiredDraggableElements = new Function(
  "Element",
  "document",
  "DRAG_TOOLTIP_DELAY_MS",
  "SHIFT_DRAG_EXEMPT_SELECTOR",
  `${appSource.slice(dragHelpersStart, dragHelpersEnd)}\nreturn annotateShiftRequiredDraggableElements;`
)(FakeElement, fakeDocument, 1000, shiftExemptSelector);
annotateShiftRequiredDraggableElements({
  querySelectorAll: () => [importHeader, protectedDragElement]
});
assert.equal(importHeader.draggable, true, "Заголовок импорта не должен отключаться без Shift");
assert.equal(importHeader.dataset.shiftDragEnabled, undefined);
assert.equal(protectedDragElement.draggable, false, "Остальные защищённые draggable-элементы не должны менять поведение");
assert.equal(protectedDragElement.dataset.shiftDragEnabled, "true");
assert.match(appSource, /renderTableOptions\(STUDENT_APPLICATIONS_IMPORT_TABLE_CONFIG_ID\)/u);
assert.match(
  appSource,
  /class="ghost-button student-applications-import-button"[^>]*>Импорт<\/button>/u,
  "Кнопка импорта в реестре слушателей должна иметь короткую подпись"
);
assert.doesNotMatch(
  appSource,
  /class="ghost-button student-applications-import-button"[^>]*>Импорт слушателей<\/button>/u
);
assert.match(appSource, /delete state\.tableSettings\[configId\][\s\S]*STUDENT_APPLICATIONS_IMPORT_DEFAULT_SORT/u);
assert.match(appSource, /getTableLayoutConfig\(configId\)[\s\S]*studentApplicationsImportTableConfig/u);
assert.match(stylesSource, /\.student-applications-payment-cell\s*\{[\s\S]*text-align:\s*right/u);
assert.match(stylesSource, /\.student-applications-table-options-panel\s*\{[\s\S]*z-index:\s*37/u);
assert.doesNotMatch(stylesSource, /student-applications-import-table th:nth-child/u);

console.log("student applications import table layout tests: OK");
