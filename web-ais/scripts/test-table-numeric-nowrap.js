const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const config = {
  collection: "students",
  fields: [
    { key: "name", label: "ФИО" }, { key: "status", label: "Статус" },
    { key: "program", label: "Программа" }, { key: "applicationDate", label: "Дата заявки", type: "date" },
    { key: "phone", label: "Телефон" }, { key: "balance", label: "Остаток", type: "number" },
    { key: "endDate", label: "Окончание", type: "date" }, { key: "daysUntilEnd", label: "Дней" }
  ]
};
const rows = [
  { id: "1", name: "Тестовая Ольга Николаевна", status: "На зачисление", program: "Технология создания электронных учебников (36 ч)", applicationDate: "09.09.2026", phone: "+79112359783", balance: "0 ₽", endDate: "—", daysUntilEnd: "—" },
  { id: "2", name: "Тестовая Любовь Александровна", status: "На зачисление", program: "Организация образовательного процесса вуза на основе современных технологий", applicationDate: "02.09.2026", phone: "+79531732760", balance: "12 345,67 ₽", endDate: "02.11.2026", daysUntilEnd: 53 }
];
const context = {
  state: { view: "students", lastEditedRow: {}, sort: {}, tableSettings: {} },
  getTableFields: c => c.fields, getSelected: () => [], renderTableValueFilterChips: () => "",
  getTablePagination: (_id, count) => ({ start: 0, end: count }), renderTablePagination: () => "",
  getRecordLock: () => null, recordLockEntityType: id => id, isStudentTrainingDeadlinePassed: () => false,
  getTableCellValue: (_config, row, key) => row[key], valueForDisplay: (_key, value) => String(value ?? "—"),
  tableValueFilterDataAttrs: () => "", escapeAttr: escape, escapeHtml: escape,
  getTableLayoutConfig: () => config, clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  REGISTRY_COLUMN_WEIGHT_OVERRIDES: { students: { name: 230, status: 110, program: 310, applicationDate: 105, phone: 120, balance: 82, endDate: 105, daysUntilEnd: 105 } },
  STATISTICS_PROFITABILITY_TABLE_CONFIG_ID: "statistics", STUDENT_APPLICATIONS_IMPORT_TABLE_CONFIG_ID: "import",
  EMPLOYEE_PAYMENT_TABLE_CONFIG_ID: "employee", ISSUED_DOCUMENT_TABLE_CONFIG_ID: "issued"
};
vm.createContext(context);
for (const name of ["isSingleLineTableValue", "getSingleLineTableColumnMinWidth", "getColumnWidth", "getRegistryColumnPercentages", "columnStyleAttr", "columnDataAttrs", "renderTable", "applyColumnWidthToDom", "getTableCellTooltipTarget"]) {
  vm.runInContext(extract(name), context);
}
for (const [field, value] of [[{ type: "date" }, "10.09.2026"], [{ type: "number" }, "12 345,67 ₽"], [{ key: "phone" }, "+7 (900) 123-45-67"], [{ key: "daysUntilEnd" }, "53"], [{ key: "uid" }, "0012345678"], [{ key: "balance" }, "−1 234,56 ₽"]]) {
  assert.equal(context.isSingleLineTableValue(field, value), true);
  assert.ok(context.getSingleLineTableColumnMinWidth(field, value) >= 48);
}
for (const value of ["Технологии (36 ч)", "На зачисление", "Тестовая Ольга", "личная карта", "https://example.ru", "—"]) {
  assert.equal(context.isSingleLineTableValue({ key: "program" }, value), false, value);
  assert.equal(context.getSingleLineTableColumnMinWidth({ key: "program" }, value), 0);
}
assert.equal(context.getSingleLineTableColumnMinWidth({ type: "number" }, "1".repeat(100)), 200);
const renderSample = () => context.renderTable(config, rows, "students");
const html = renderSample();
assert.match(html, /data-table-cell-full-text="09\.09\.2026" data-table-cell-nowrap/u);
assert.match(html, /data-table-cell-full-text="\+79112359783" data-table-cell-nowrap/u);
assert.match(html, /data-table-cell-full-text="12 345,67 ₽" data-table-cell-nowrap/u);
assert.doesNotMatch(html, /data-table-cell-full-text="На зачисление" data-table-cell-nowrap/u);
assert.match(html, /data-column-key="applicationDate" data-table-column-min-width="97" style="width:97px;/u);
const dateCell = { dataset: { tableConfig: "students", columnKey: "applicationDate", tableColumnMinWidth: "97" }, style: {} };
context.document = { querySelectorAll: () => [dateCell] };
context.applyColumnWidthToDom("students", "applicationDate", 40);
assert.equal(dateCell.style.width, "97px", "Перетаскивание границы не отменяет минимальную ширину даты");
context.applyColumnWidthToDom("students", "applicationDate", 180);
assert.equal(dateCell.style.width, "180px", "Числовые столбцы можно расширять вручную");
context.state.tableSettings.students = { widths: { applicationDate: 180 } };
assert.match(renderSample(), /data-column-key="applicationDate" data-table-column-min-width="97" style="width:180px;/u);
context.state.tableSettings.students = {};
class Element {}
context.Element = Element;
const tooltipCell = Object.assign(new Element(), { dataset: { tableCellFullText: "12345678901234567890 ₽" }, clientHeight: 18, scrollHeight: 18, clientWidth: 100, scrollWidth: 200 });
tooltipCell.closest = () => tooltipCell;
assert.equal(context.getTableCellTooltipTarget(tooltipCell), tooltipCell);
assert.equal(tooltipCell.dataset.tooltip, tooltipCell.dataset.tableCellFullText);
const rule = styles.match(/\.table-cell-clamp\[data-table-cell-nowrap\]\s*\{([^}]+)\}/u)?.[1] || "";
assert.match(rule, /display:\s*block/u);
assert.match(rule, /white-space:\s*nowrap/u);
assert.match(rule, /overflow-wrap:\s*normal/u);
assert.match(rule, /font-variant-numeric:\s*tabular-nums/u);
if (require.main === module) console.log("Table dates, phones, numbers, column resizing and full-text tooltip: OK");
module.exports = { renderSample };
