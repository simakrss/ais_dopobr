"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/gu, "\n");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8").replace(/\r\n/gu, "\n");

function extractFunction(name) {
  const start = appSource.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Не найдена функция ${name}`);
  const bodyStart = appSource.indexOf(") {", start) + 2;
  assert.ok(bodyStart > start, `Не найдено тело функции ${name}`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1).replace(/^  /gmu, "");
    }
  }
  throw new Error(`Функция ${name} не завершена`);
}

assert.match(
  appSource,
  /const TABLE_VALUE_FILTER_HOVER_DELAY_MS\s*=\s*1000\s*;/u,
  "Кнопка фильтра должна появляться только после наведения продолжительностью 1 секунду"
);
assert.match(
  appSource,
  /tableValueFilters:\s*\{\}/u,
  "Активные быстрые фильтры таблиц должны храниться отдельно в состоянии интерфейса"
);
assert.match(appSource, /function normalizeTableValueFilterValue\(/u);
assert.match(appSource, /function getTableValueFilter\(/u);
assert.match(appSource, /function filterRowsByTableValueFilters\(/u);
assert.match(appSource, /function bindTableValueFilterEvents\(/u);
assert.match(
  appSource,
  /bindTableValueFilterEvents\(\)/u,
  "Универсальный обработчик должен подключаться при запуске приложения"
);

const bindStart = appSource.indexOf("  function bindTableValueFilterEvents(");
assert.ok(bindStart >= 0, "Не найден универсальный обработчик быстрых фильтров таблиц");
const bindEnd = appSource.indexOf("\n\n  function ", bindStart + 1);
const bindSource = appSource.slice(bindStart, bindEnd > bindStart ? bindEnd : appSource.length);
assert.match(
  bindSource,
  /pointerover|pointerenter/u,
  "Наведение на значение таблицы должно запускать показ кнопки"
);
assert.match(
  bindSource,
  /pointerout|pointerleave/u,
  "Уход курсора до истечения задержки должен отменять показ кнопки"
);
assert.match(bindSource, /clear-table-value-filter/u);
assert.match(
  bindSource,
  /hideSystemHelpTooltip\(\)[\s\S]{0,240}scheduleTableValueFilterButton/u,
  "Подсказка ячейки должна закрываться до планирования кнопки фильтра"
);

const scheduleSource = extractFunction("scheduleTableValueFilterButton");
const cancelSource = extractFunction("cancelPendingTableValueFilterButton");
assert.match(scheduleSource, /TABLE_VALUE_FILTER_HOVER_DELAY_MS/u);
assert.match(scheduleSource, /setTimeout/u);
assert.match(cancelSource, /clearTimeout/u);

const cellMetaSource = extractFunction("getTableValueFilterCellMeta");
assert.match(cellMetaSource, /closest\("tbody td"\)/u, "Делегирование должно охватывать все обычные таблицы");
assert.match(cellMetaSource, /cell\.colSpan\s*>\s*1/u, "Итоговые строки с colspan не должны получать фильтр");
assert.match(cellMetaSource, /\.select-col/u, "Колонки выбора не должны получать фильтр");
assert.match(cellMetaSource, /input, select, textarea/u, "Интерактивные ячейки должны быть исключены");
assert.match(cellMetaSource, /действия\|выбор\|операции/u, "Колонки действий должны быть исключены");
assert.match(cellMetaSource, /!columnLabel/u, "Колонки с пустым заголовком действий должны быть исключены");
assert.doesNotMatch(
  cellMetaSource,
  /nestedHelpTarget[\s\S]{0,160}return null/u,
  "Вложенный title или tooltip у реального значения не должен отключать фильтр всей ячейки"
);
assert.match(cellMetaSource, /!value\s*\|\|\s*value\s*===\s*"—"/u, "Пустые ячейки не должны получать кнопку");
assert.match(
  cellMetaSource,
  /mode\s*===\s*"dom"[\s\S]{0,180}tbody input\[type='checkbox'\],[\s\S]{0,80}tbody input\[type='radio'\][\s\S]{0,80}return null/u,
  "DOM-фильтрация должна быть отключена для таблиц с массовым выбором checkbox/radio"
);

assert.match(
  appSource,
  /(?:data-action=["']filter-table-by-hovered-value["']|dataset\.action\s*=\s*["']filter-table-by-hovered-value["'])/u,
  "Всплывающая кнопка должна иметь единое действие применения фильтра"
);
assert.match(
  appSource,
  /data-action=["']clear-table-value-filter["']/u,
  "Для каждого активного быстрого фильтра должна быть доступна явная очистка"
);
assert.match(
  extractFunction("getTableValueFilterButton"),
  /className\s*=\s*"table-value-filter-button"[\s\S]{0,500}renderTableValueFilterIcon\("table-value-filter-button-icon"\)/u,
  "На всплывающей кнопке должен использоваться значок фильтра, а не текстовый символ"
);
assert.match(extractFunction("renderTableValueFilterIcon"), /<svg[\s\S]*?<path/u);
assert.match(
  appSource,
  /table-value-filter-chip/u,
  "Активное значение фильтра должно быть видно и доступно для очистки"
);
assert.match(
  appSource,
  /student-applications-import-table/u,
  "Таблица импорта слушателей должна участвовать в универсальной фильтрации"
);

const baseButtonRule = stylesSource.match(/\.table-value-filter-button\s*\{([^}]*)\}/u)?.[1] || "";
assert.match(baseButtonRule, /opacity:\s*0\s*;/u, "До истечения задержки кнопка должна оставаться невидимой");
assert.match(baseButtonRule, /pointer-events:\s*none\s*;/u);
assert.match(
  baseButtonRule,
  /transition:[^;]*(?:opacity|transform)/u,
  "Появление кнопки должно быть плавным"
);

const visibleButtonRule = stylesSource.match(/\.table-value-filter-button\.is-visible\s*\{([^}]*)\}/u)?.[1] || "";
assert.match(visibleButtonRule, /opacity:\s*1\s*;/u);
assert.match(visibleButtonRule, /pointer-events:\s*(?:auto|all)\s*;/u);
assert.match(stylesSource, /\.table-value-filter-chip(?:\s*\{|\s*,[\s\S]{0,120}\{)/u);
assert.match(
  extractFunction("isTableValueFilterHoverSupported"),
  /\(any-hover: hover\) and \(any-pointer: fine\)/u,
  "Подключённая мышь должна поддерживаться и на гибридном устройстве"
);
assert.match(stylesSource, /@media \(any-hover: none\)/u);

class FakeNode {}
const fakeCell = new FakeNode();
fakeCell.isConnected = true;
fakeCell.contains = (node) => node === fakeCell;
const scheduledTimers = [];
const clearedTimers = [];
const pointerListeners = new Map();
let shownMeta = null;
const hoverContext = {
  Node: FakeNode,
  Number,
  TABLE_VALUE_FILTER_HOVER_DELAY_MS: 1000,
  document: {
    addEventListener(type, listener) { pointerListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (pointerListeners.get(type) === listener) pointerListeners.delete(type);
    },
    elementFromPoint() { return fakeCell; }
  },
  window: {
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduledTimers.push(timer);
      return timer;
    },
    clearTimeout(timer) { clearedTimers.push(timer); },
    getSelection() { return { isCollapsed: true }; }
  },
  showTableValueFilterButton(meta) { shownMeta = meta; }
};
vm.createContext(hoverContext);
vm.runInContext(
  `let tableValueFilterHoverTimer = 0;
   let tableValueFilterHideTimer = 0;
   let tableValueFilterHoveredCell = null;
   let tableValueFilterPointerMoveHandler = null;
   ${cancelSource}
   ${scheduleSource}
   this.api = { scheduleTableValueFilterButton, cancelPendingTableValueFilterButton };`,
  hoverContext
);
const hoverMeta = { cell: fakeCell };
hoverContext.api.scheduleTableValueFilterButton(hoverMeta, { clientX: 15, clientY: 20 });
assert.equal(shownMeta, null, "До завершения задержки кнопка не должна показываться");
assert.equal(scheduledTimers.at(-1).delay, 1000);
scheduledTimers.at(-1).callback();
assert.equal(shownMeta, hoverMeta, "После задержки кнопка должна появиться у всё ещё наведённой ячейки");
hoverContext.api.scheduleTableValueFilterButton(hoverMeta, { clientX: 15, clientY: 20 });
const pendingTimer = scheduledTimers.at(-1);
hoverContext.api.cancelPendingTableValueFilterButton();
assert.ok(clearedTimers.includes(pendingTimer), "Уход курсора должен отменять ещё не сработавший таймер");

const domTable = { isConnected: true };
const domTables = new Map([["special-table", domTable]]);
const domState = new WeakMap();
const domRefreshCalls = [];
const domClearContext = {
  String,
  Number,
  Map,
  tableValueFilterDomTables: domTables,
  tableValueFilterDomState: domState,
  applyDomTableValueFilters(table) { domRefreshCalls.push(["rows", table]); },
  renderDomTableValueFilterChips(table) { domRefreshCalls.push(["chips", table]); }
};
vm.createContext(domClearContext);
vm.runInContext(
  `${extractFunction("clearDomTableValueFilter")}
   this.clearDomTableValueFilter = clearDomTableValueFilter;`,
  domClearContext
);
domState.set(domTable, new Map([
  [0, { value: "москва" }],
  [2, { value: "обучающиеся" }]
]));
domClearContext.clearDomTableValueFilter({ dataset: { tableId: "special-table", columnIndex: "2" } });
assert.deepEqual(Array.from(domState.get(domTable).keys()), [0], "Очистка одного DOM-фильтра не должна снимать остальные");
domClearContext.clearDomTableValueFilter({ dataset: { tableId: "special-table" } });
assert.equal(domState.has(domTable), false, "Кнопка «Сбросить все» без индекса должна очищать все DOM-фильтры");
assert.equal(domRefreshCalls.length, 4, "После каждой очистки должны обновляться строки и чипы таблицы");

const logicContext = {
  state: { tableValueFilters: {} },
  String,
  Object,
  Array
};
vm.createContext(logicContext);
vm.runInContext(
  [
    "normalizeTableValueFilterValue",
    "getTableValueFilters",
    "getTableValueFilter",
    "getTableValueFilterEntries",
    "setTableValueFilter",
    "clearTableValueFilter",
    "filterRowsByTableValueFilters"
  ].map(extractFunction).join("\n\n")
  + "\nthis.api = { normalizeTableValueFilterValue, getTableValueFilter, setTableValueFilter, clearTableValueFilter, filterRowsByTableValueFilters };",
  logicContext
);

assert.equal(
  logicContext.api.normalizeTableValueFilterValue("  ЁЛКА\n  72 Ч  "),
  "елка 72 ч",
  "Сравнение значений должно быть нечувствительно к регистру, лишним пробелам и написанию е/ё"
);
assert.equal(logicContext.api.setTableValueFilter("students", "status", "  Обучающиеся "), true);
assert.equal(logicContext.api.getTableValueFilter("students", "status").value, "обучающиеся");
assert.deepEqual(
  Array.from(logicContext.api.filterRowsByTableValueFilters(
    [
      { id: 1, status: "обучающиеся" },
      { id: 2, status: " ОБУЧАЮЩИЕСЯ " },
      { id: 3, status: "выпуск" }
    ],
    "students",
    (row, key) => row[key]
  ), (row) => row.id),
  [1, 2],
  "Фильтр должен оставлять точные нормализованные совпадения в выбранном столбце"
);
assert.equal(
  logicContext.api.setTableValueFilter("students", "status", "обучающиеся"),
  true,
  "Повторное применение того же значения должно обрабатываться как переключение"
);
assert.equal(logicContext.api.getTableValueFilter("students", "status"), null);
assert.equal(logicContext.api.setTableValueFilter("students", "status", ""), false, "Пустые ячейки не должны создавать фильтр");
logicContext.api.setTableValueFilter("students", "status", "выпуск");
logicContext.api.setTableValueFilter("students", "city", "Москва");
assert.equal(logicContext.api.clearTableValueFilter("students", "status"), true);
assert.equal(logicContext.api.getTableValueFilter("students", "status"), null);
assert.equal(logicContext.api.getTableValueFilter("students", "city").value, "москва");
assert.equal(logicContext.api.clearTableValueFilter("students"), true);
assert.equal(logicContext.api.getTableValueFilter("students", "city"), null);

const mainRowsSource = extractFunction("getVisibleRows");
assert.ok(
  mainRowsSource.indexOf("filterRowsByTableValueFilters") < mainRowsSource.indexOf("if (state.sort.key)"),
  "Основные реестры должны фильтроваться до сортировки и последующей пагинации"
);
const importRowsSource = extractFunction("getVisibleStudentApplications");
assert.ok(
  importRowsSource.indexOf("filterRowsByTableValueFilters") < importRowsSource.indexOf("sortStudentApplicationRows"),
  "Импорт слушателей должен фильтроваться до сортировки и пагинации"
);
const issuedRowsSource = extractFunction("getVisibleIssuedDocumentRows");
assert.ok(
  issuedRowsSource.indexOf("filterRowsByTableValueFilters") < issuedRowsSource.indexOf("sortIssuedDocumentRows"),
  "Выданные документы должны фильтроваться до сортировки и пагинации"
);
assert.match(
  extractFunction("renderIssuedDocumentTableCell"),
  /tableValueFilterDataAttrs\([\s\S]{0,220}getIssuedDocumentTableFilterDisplayValue\(row,\s*column\.key\)/u,
  "Ячейки выданных документов должны передавать в фильтр каноническое значение строки"
);
const issuedRegistrySource = extractFunction("renderIssuedDocumentsRegistry");
assert.match(issuedRegistrySource, /renderTableValueFilterChips\(ISSUED_DOCUMENT_TABLE_CONFIG_ID\)/u);
assert.match(issuedRegistrySource, /data-table-value-filter-config="\$\{ISSUED_DOCUMENT_TABLE_CONFIG_ID\}"/u);
assert.match(
  extractFunction("resetIssuedDocumentRegistryFilters"),
  /clearTableValueFilter\(ISSUED_DOCUMENT_TABLE_CONFIG_ID\)/u,
  "Общий сброс реестра выданных документов должен снимать быстрый фильтр"
);
assert.match(
  extractFunction("resetTableOptions"),
  /clearTableValueFilter\(configId\)/u,
  "Восстановление исходного вида таблицы должно снимать быстрый фильтр"
);
assert.match(
  extractFunction("isStateDrivenTableValueFilter"),
  /configId\s*===\s*ISSUED_DOCUMENT_TABLE_CONFIG_ID/u,
  "Реестр выданных документов должен использовать state-driven фильтрацию, а не DOM fallback"
);

const importCellSource = extractFunction("renderStudentApplicationImportTableCell");
assert.match(importCellSource, /tableValueFilterDataAttrs\([\s\S]*?row\.name\s*\|\|\s*""/u);
assert.match(importCellSource, /tableValueFilterDataAttrs\([\s\S]*?row\.program\s*\|\|\s*""/u);
assert.match(
  importCellSource,
  /paymentAmount\s*>\s*0\s*\|\|\s*row\.paid\s*\?\s*value\s*:\s*""/u,
  "Пустая оплата не должна становиться фильтром по декоративному тире"
);
const mainTableSource = extractFunction("renderTable");
assert.match(
  mainTableSource,
  /rawValue\s*===\s*undefined[\s\S]{0,220}\?\s*""\s*:\s*displayValue/u,
  "Пустые значения основных таблиц не должны получать кнопку фильтра"
);

console.log("table value hover filter checks: OK");
