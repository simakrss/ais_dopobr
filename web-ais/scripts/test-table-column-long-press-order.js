"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/gu, "\n");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

const resizeMatches = [...appSource.matchAll(/data-action="resize-column"/gu)];
assert.ok(resizeMatches.length >= 5, "Не найдены все таблицы с изменяемой шириной колонок");
resizeMatches.forEach((match) => {
  const headerStart = appSource.lastIndexOf("<th", match.index);
  const headerSource = appSource.slice(headerStart, match.index);
  assert.match(headerSource, /class="[^"]*table-column-head/u, "Изменяемая колонка должна поддерживать общий перенос");
  assert.match(headerSource, /draggable="true"/u, "Заголовок изменяемой колонки должен быть перетаскиваемым");
});

const exemptStart = appSource.indexOf("  const SHIFT_DRAG_EXEMPT_SELECTOR");
const exemptEnd = appSource.indexOf("\n  const STUDENT_CARD_TAB_ORDER_KEY", exemptStart);
assert.ok(exemptStart >= 0 && exemptEnd > exemptStart, "Не найден список исключений перетаскивания");
assert.doesNotMatch(
  appSource.slice(exemptStart, exemptEnd),
  /table-column-head/u,
  "Колонки таблиц не должны обходить общее правило удержания ЛКМ или Shift"
);

assert.match(appSource, /const LONG_PRESS_DRAG_DELAY_MS = 1000;/u);
assert.match(
  appSource,
  /function getLongPressDragContext[\s\S]*\.table-column-head\[data-table-config\]\[data-column-key\][\s\S]*type: "table-column"/u
);
assert.match(
  appSource,
  /context\.immediate = Boolean\([\s\S]*event\.shiftKey[\s\S]*shift-drag-ready/u,
  "Shift должен включать перенос без задержки"
);
assert.match(
  appSource,
  /function moveLongPressDragElement[\s\S]*type === "table-column"[\s\S]*elementFromPoint/u
);
assert.match(
  appSource,
  /function commitLongPressDragOrder[\s\S]*context\.type === "table-column"[\s\S]*reorderTableColumn/u
);
assert.match(
  appSource,
  /const suppressClick = current\.type === "table-column" && current\.ready;/u,
  "Длительное нажатие без переноса не должно запускать сортировку"
);

assert.match(
  appSource,
  /const employeePaymentTableConfig[\s\S]*EMPLOYEE_PAYMENT_TABLE_COLUMNS\.map/u
);
assert.match(
  appSource,
  /const columns = getTableFields\(employeePaymentTableConfig, EMPLOYEE_PAYMENT_TABLE_CONFIG_ID\)[\s\S]*columns\.map\(\(column\) => renderEmployeePaymentTableCell/u,
  "Таблица выплат должна выводить ячейки в сохранённом порядке"
);
assert.match(
  appSource,
  /const columns = getTableFields\([\s\S]*statisticsProgramProfitabilityTableConfig[\s\S]*STATISTICS_PROFITABILITY_TABLE_CONFIG_ID[\s\S]*columns\.map\(renderStatisticsProgramProfitabilityHeader\)/u,
  "Таблица рентабельности должна выводить сохранённый порядок колонок"
);

const applyStart = appSource.indexOf("  function applyTableColumnOrderToDom");
const applyEnd = appSource.indexOf("\n\n  function resetTableOptions", applyStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart, "Не найдено применение порядка колонок без перерисовки формы");
const applyTableColumnOrderToDom = new Function(
  "getTableLayoutConfig",
  "getTableKeys",
  `${appSource.slice(applyStart, applyEnd).replace(/^  /gmu, "")}\nreturn applyTableColumnOrderToDom;`
)(() => ({ table: ["first", "second", "third"] }), () => ["first", "second", "third"]);

const parent = {
  children: [],
  appendChild(element) {
    this.children = this.children.filter((item) => item !== element);
    this.children.push(element);
  }
};
const selectColumn = { dataset: {}, parentElement: parent };
const first = { dataset: { tableConfig: "test", columnKey: "first" }, parentElement: parent };
const second = { dataset: { tableConfig: "test", columnKey: "second" }, parentElement: parent };
const third = { dataset: { tableConfig: "test", columnKey: "third" }, parentElement: parent };
parent.children = [selectColumn, first, second, third];
applyTableColumnOrderToDom("test", ["third", "first", "second"], {
  querySelectorAll: () => [first, second, third]
});
assert.deepEqual(parent.children, [selectColumn, third, first, second]);

assert.match(stylesSource, /\.table-column-head\.is-long-press-pending/u);
assert.match(stylesSource, /\.table-column-head\.is-long-press-ready/u);
assert.match(stylesSource, /body\.shift-drag-ready \.table-column-head/u);

console.log("table column long-press ordering tests: OK");
