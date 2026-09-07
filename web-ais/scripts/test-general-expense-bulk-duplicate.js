const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, "Не найдено начало блока: " + startMarker);
  assert.ok(end > start, "Не найден конец блока: " + endMarker);
  return source.slice(start, end).replace(/^  /gmu, "");
}

let nextId = 0;
let confirmation = "";
let confirmResult = false;
let audit = null;
let notice = "";
let persistCount = 0;
let renderCount = 0;
const first = {
  id: "expense-1",
  section: "Организации",
  counterparty: "Контрагент 1",
  date: "2026-08-01",
  workType: "Аренда",
  description: "Офис",
  amount: 10000,
  otherExpenses: "Дополнительные расходы",
  paid: "2026-08-02",
  isPaid: "+",
  accountingClosed: "+",
  bkExpenseNo: "15",
  act: "+",
  actStatus: "Подписан",
  databaseSync: { recordId: "expense-1" },
  databaseSyncSourceRow: 12,
  databaseSyncFormulaFields: ["paid"],
  databaseFixedValueOverrides: ["date"],
  __syncComment: "service",
  employeePaymentOrder: 20
};
const second = {
  id: "expense-2",
  section: "Физлица",
  counterparty: "Контрагент 2",
  date: "2026-08-03",
  workType: "Услуги",
  description: "Проверка",
  amount: "2500"
};
const untouched = { id: "expense-3", counterparty: "Не выбран" };
const state = {
  selected: { generalExpenses: ["expense-1", "expense-2"] },
  data: { collections: { generalExpenses: [first, second, untouched] } },
  lastEditedRow: null,
  tablePages: {}
};
const context = {
  state,
  configs: { generalExpenses: { title: "Общие затраты" } },
  todayIso: () => "2026-09-07",
  clone: (value) => JSON.parse(JSON.stringify(value)),
  makeId: () => "general-expense-copy-" + (++nextId),
  normalizeGeneralExpenseRecord: (value) => ({ ...value, amount: Number(value.amount || 0) }),
  getSelected: (configId) => [...(state.selected[configId] || [])],
  getRowsByIds: (collection, ids) => {
    const selected = new Set(ids);
    return state.data.collections[collection].filter((row) => selected.has(row.id));
  },
  confirm: (message) => {
    confirmation = message;
    return confirmResult;
  },
  addAudit: (...args) => {
    audit = args;
  },
  persist: () => {
    persistCount += 1;
  },
  render: () => {
    renderCount += 1;
  },
  showDocumentGenerationNotice: (message) => {
    notice = message;
  }
};
vm.createContext(context);
vm.runInContext(
  extractBetween(
    appSource,
    "  function createGeneralExpenseDuplicate",
    "\n  const studentBulkDocumentOperations"
  ) + "\nthis.runDuplicate = bulkDuplicateGeneralExpenses;",
  context
);

const initialCollections = JSON.parse(JSON.stringify(state.data.collections));
const initialSelection = [...state.selected.generalExpenses];
context.runDuplicate();
assert.deepEqual(state.data.collections, initialCollections);
assert.deepEqual(state.selected.generalExpenses, initialSelection);
assert.equal(audit, null);
assert.equal(notice, "");
assert.equal(persistCount, 0);
assert.equal(renderCount, 0);

confirmation = "";
state.selected.generalExpenses = ["missing-expense"];
context.runDuplicate();
assert.deepEqual(state.data.collections, initialCollections);
assert.deepEqual(state.selected.generalExpenses, ["missing-expense"]);
assert.equal(confirmation, "");
assert.equal(audit, null);
assert.equal(notice, "");
assert.equal(persistCount, 0);
assert.equal(renderCount, 0);

state.selected.generalExpenses = initialSelection;
confirmResult = true;
context.runDuplicate();

assert.equal(state.data.collections.generalExpenses.length, 5);
const copies = state.data.collections.generalExpenses.slice(0, 2);
const copyIds = Array.from(copies, (item) => item.id);
assert.deepEqual(copyIds, [
  "general-expense-copy-1",
  "general-expense-copy-2"
]);
assert.deepEqual(Array.from(state.selected.generalExpenses), copyIds);
assert.equal(copies[0].counterparty, first.counterparty);
assert.equal(copies[0].description, first.description);
assert.equal(copies[0].amount, first.amount);
assert.equal(copies[0].section, first.section);
assert.equal(copies[0].workType, first.workType);
assert.equal(copies[0].otherExpenses, first.otherExpenses);
assert.equal(copies[0].date, "2026-09-07");
["paid", "isPaid", "accountingClosed", "bkExpenseNo", "act", "actStatus"].forEach((field) => {
  assert.equal(copies[0][field], "", "Не очищено поле нового расхода: " + field);
});
[
  "databaseSync",
  "databaseSyncSourceRow",
  "databaseSyncFormulaFields",
  "databaseFixedValueOverrides",
  "__syncComment",
  "employeePaymentOrder"
].forEach((field) => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(copies[0], field),
    false,
    "В дубликат перенесено служебное поле: " + field
  );
});
assert.equal(first.paid, "2026-08-02", "Исходная запись не должна изменяться.");
assert.equal(state.data.collections.generalExpenses[2], first);
assert.deepEqual(
  JSON.parse(JSON.stringify(state.data.collections.generalExpenses.slice(2))),
  initialCollections.generalExpenses,
  "Исходные общие расходы не должны изменяться."
);
assert.equal(state.tablePages.generalExpenses, 1);
assert.equal(state.lastEditedRow.config, "generalExpenses");
assert.equal(state.lastEditedRow.id, "general-expense-copy-2");
assert.match(confirmation, /Выбрано записей: 2/u);
assert.equal(audit[0], "Продублированы общие расходы");
assert.match(notice, /Продублировано общих расходов: 2/u);
assert.equal(persistCount, 1);
assert.equal(renderCount, 1);
assert.match(
  appSource,
  /data-action="bulk-duplicate-general-expenses"[\s\S]{0,240}Дублировать/u
);
assert.doesNotMatch(appSource, /bulk-copy-general-expenses/u);

console.log("General expense bulk duplicate checks: OK");
