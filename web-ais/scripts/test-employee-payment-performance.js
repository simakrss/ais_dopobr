"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
let scans = 0, partnerCalculations = 0, drafts = 0;
let record = { id: "c", name: "Сотрудник", paid: 0, balance: 0 };
let collections = {
  contracts: [record], generalExpenses: [], directExpenses: [],
  students: Array.from({ length: 20000 }, (_, i) => ({
    id: `s${i}`, name: `Слушатель ${i}`, agent: i < 8 ? record.name : "Другой сотрудник",
    directExpenses: [{ id: `d${i}`, note: i < 80 ? record.name : "Другой сотрудник", amount: 350, recommendation: "+" }]
  }))
};
const c = vm.createContext({
  state: { modal: { id: "c", draft: record }, data: { dictionaries: { paymentSettings: [] } } },
  normalizeEmployeeActPersonName: (value) => String(value || "").trim().toLowerCase(),
  getDirectExpenseEntriesFromCollections: (data) => {
    scans++;
    return [...data.students.flatMap((student) => student.directExpenses.map((expense) => ({ expense, student, identity: expense.id }))),
      ...data.directExpenses.map((expense) => ({ expense, identity: expense.id }))];
  },
  getEmployeePartnerPaymentRows: (student, data) => {
    assert.equal(data, collections, "Use the transaction collections, not persisted data");
    partnerCalculations++;
    const calculation = { payableAmount: 100 };
    return [{ sourceId: `${student.id}::agent-due`, slot: "due", student, amount: 100,
      calculation, affectsAccounting: true, source: { amount: 100 } }];
  },
  normalizeEmployeePaymentSourceRow: (_type, value) => value,
  isEmployeePaymentSettled: (value = {}) => Boolean(value.paid || value.isPaid || ["Получен", "Без акта"].includes(value.actStatus)),
  getEmployeePaymentCollections: () => collections,
  getEmployeePaymentAccountingDraft: () => { drafts++; return { ...record }; },
  getEmployeeNetPayment: (amount) => Math.round(amount * 87) / 100,
  getEmployeePaymentSummaryScope: (section) => ({ selectedRows: [], visibleRows: [], restricted: true, includedRowKeys: section.keys }),
  parseEmployeePartnerPaymentSourceId: (id) => ({ studentId: String(id).split("::agent-")[0] }),
  createEmployeePartnerPaymentSource: () => { throw new Error("Reuse the existing due source without recalculating"); }
});
vm.runInContext([
  "getEmployeePaymentAccounting", "formatEmployeePaymentSummaryAmount", "syncEmployeePaymentSummaryUi",
  "buildEmployeePaymentSourceLookup", "syncEmployeePaymentOrderFromTable", "updateEmployeePaymentFilters",
  "duplicateEmployeePaymentAccountingRow", "insertEmployeePaymentDuplicateRow", "commitEmployeePaymentAccountingChange"
].map(extract).join("\n"), c);
const outputs = new Map();
const section = {
  keys: new Set(["direct:d0"]),
  closest: () => ({ elements: { name: { value: record.name } } }),
  querySelector(selector) {
    if (!outputs.has(selector)) outputs.set(selector, { textContent: "", classList: { toggle() {} } });
    return outputs.get(selector);
  }
};
const total = () => Number(outputs.get('[data-employee-payment-summary="amount"]').textContent.replace(/[^\d,.-]/g, "").replace(",", "."));
const started = performance.now();
for (let i = 0; i < 30; i++) c.syncEmployeePaymentSummaryUi(section);
const baselineMs = performance.now() - started;
assert.equal(scans, 30);
scans = partnerCalculations = drafts = 0;
const optimizedStarted = performance.now();
for (let i = 0; i < 30; i++) {
  section.keys = new Set(i % 2 ? ["direct:d0"] : ["direct:d0", "partner:s0::agent-due"]);
  c.syncEmployeePaymentSummaryUi(section, true);
  assert.equal(total(), i % 2 ? 350 : 450);
}
const optimizedMs = performance.now() - optimizedStarted;
assert.equal(scans, 0, "Filtering must not rescan all students/expenses");
assert.equal(partnerCalculations, 0, "Filtering must not recalculate agent commissions");
assert.equal(drafts, 0, "Filtering must not serialize the entire employee form");

collections.students[0].directExpenses[0].amount = 500;
c.syncEmployeePaymentSummaryUi(section); // Normal payment edit / commit refresh.
assert.equal(total(), 500);
assert.equal(scans, 1);
c.syncEmployeePaymentSummaryUi(section, true);
assert.equal(total(), 500);
assert.equal(scans, 1);
for (const invalidate of [
  () => { collections = { ...collections }; },
  () => { c.state.data.dictionaries.paymentSettings = []; },
  () => { c.state.modal = { ...c.state.modal }; },
  () => { record = { ...record, name: "Другой сотрудник" }; }
]) {
  const previous = scans;
  invalidate();
  c.syncEmployeePaymentSummaryUi(section, true);
  assert.equal(scans, previous + 1, "A changed data source, settings, modal or employee invalidates the snapshot");
}
record = { ...record, name: "Сотрудник" };
c.state.modal.draft = record;

partnerCalculations = 0;
const rows = [
  { dataset: { paymentSource: "direct", paymentSourceId: "d0" } },
  { dataset: { paymentSource: "partner", paymentSourceId: "s0::agent-due" } }
];
const tbody = { querySelectorAll: () => rows };
const scopedLookup = c.buildEmployeePaymentSourceLookup(tbody);
assert.equal(partnerCalculations, 1, "Reordering/duplicating must calculate only partner rows in this employee table");
assert.equal(scopedLookup.get("direct\u0000d0"), collections.students[0].directExpenses[0]);
assert.ok(scopedLookup.has("partner\u0000s0::agent-due"));
rows.pop();
partnerCalculations = 0;
c.buildEmployeePaymentSourceLookup(tbody);
assert.equal(partnerCalculations, 0, "No agent calculation is needed for an expense-only table");

let filterPasses = 0;
const filterValues = { comment: "Иван", source: "direct", description: "", payment: "", act: "" };
const panel = {
  querySelector: (selector) => ({ value: filterValues[/="([^"]+)"/.exec(selector)[1]] }),
  closest: () => section
};
Object.assign(c, {
  getEmployeePaymentFilters: () => c.state.employeePaymentFilters || { comment: "", source: "", description: "", payment: "", act: "" },
  applyEmployeePaymentFiltersToDom: (_section, reuse) => { assert.equal(reuse, true); filterPasses++; }
});
c.updateEmployeePaymentFilters(panel); // input
c.updateEmployeePaymentFilters(panel); // change
assert.equal(filterPasses, 1, "One filter selection causes only one processing pass");
filterValues.comment = "Иван Петров";
c.updateEmployeePaymentFilters(panel);
assert.equal(filterPasses, 2);

let renderCount = 0, comboBindings = 0, moneyBindings = 0, actBindings = 0, notices = 0, sortCalls = 0, ids = 0;
let activeSort = "";
const domSection = { isConnected: true, selectedCount: 2, scrollTop: 240 };
const insertedModels = [];
const original = collections.students[0].directExpenses[0];
Object.assign(original, { date: "2026-09-01", act: "+", actStatus: "Получен", paid: "2026-09-02", isPaid: "+" });
const domRow = {
  dataset: { paymentSource: "direct", paymentSourceId: original.id },
  unsavedComment: "Не сохранённое поле",
  closest: (selector) => selector === "tbody" ? domTbody : domSection,
  insertAdjacentHTML(position, html) { assert.equal(position, "afterend"); this.nextElementSibling = { html }; }
};
const domTbody = { querySelectorAll: () => [domRow] };
const button = { closest: () => domRow };
Object.assign(c, {
  findEmployeePaymentSourceRecord: (type, id) => type === "direct"
    ? collections.students[0].directExpenses.find((item) => item.id === id)
    : collections.generalExpenses.find((item) => item.id === id),
  getEmployeePaymentSort: () => ({ key: activeSort }),
  makeId: () => `duplicate-${++ids}`,
  todayIso: () => "2026-10-12",
  setEmployeePaymentSourceOrder: (_type, expense, order) => { expense.employeePaymentOrder = order; return true; },
  getEmployeePaymentSourceValues: (_type, expense) => ({ description: expense.type || "Услуга" }),
  normalizeGeneralExpenseRecord: (expense) => expense,
  createGeneralExpenseDuplicate: (expense) => ({ ...expense, id: `duplicate-${++ids}`, date: "2026-10-12", paid: "", act: "", actStatus: "" }),
  addEmployeePaymentAudit: () => {},
  buildAuditChanges: () => [],
  getEmployeePaymentEditorAuditRecord: (_type, expense) => expense,
  getEmployeePaymentAuditFields: () => [],
  normalizeContractRecord: (value) => value,
  scheduleEmployeePaymentAccountingPersist: () => {},
  getTableFields: () => ["actions", "amount"],
  employeePaymentTableConfig: {}, EMPLOYEE_PAYMENT_TABLE_CONFIG_ID: "payment",
  renderEmployeePaymentAccountingRow: (model) => { insertedModels.push(model); return "<tr>duplicate</tr>"; },
  bindComboFieldEvents: () => { comboBindings++; },
  bindMoneyInputStepControls: () => { moneyBindings++; },
  syncEmployeePaymentActCheckboxes: () => { actBindings++; },
  render: () => { renderCount++; },
  applyEmployeePaymentSortToDom: (_section, reuse) => { assert.equal(reuse, true); sortCalls++; },
  showDocumentGenerationNotice: () => { notices++; },
  formatContractDate: String, money: String, requestAnimationFrame: (fn) => fn(),
  CSS: { escape: String }, document: { querySelector: () => null },
  alert: (message) => { throw new Error(message); }
});
c.duplicateEmployeePaymentAccountingRow({ target: { closest: () => button } });
assert.equal(renderCount, 0, "Duplicating a row never rebuilds the entire interface");
assert.equal(insertedModels.length, 1);
const duplicate = collections.students[0].directExpenses[1];
assert.equal(duplicate.id, "duplicate-1");
assert.equal(duplicate.date, "2026-10-12");
assert.equal(duplicate.amount, original.amount);
for (const key of ["act", "actStatus", "paid", "isPaid"]) assert.equal(duplicate[key], "");
assert.equal(original.actStatus, "Получен", "The source record is preserved");
assert.equal(domRow.unsavedComment, "Не сохранённое поле");
assert.equal(domSection.selectedCount, 2);
assert.equal(domSection.scrollTop, 240);
assert.equal(c.state.employeePaymentFilters.comment, "Иван Петров", "Active filters are not reset");
assert.equal(domSection.employeePaymentAccountingSnapshot.accounting.directEntries.length, 81);
assert.equal(notices, 1);
assert.equal(comboBindings, 1); assert.equal(moneyBindings, 1); assert.equal(actBindings, 1);

const general = { id: "g", counterparty: record.name, amount: 500, date: "2026-09-01" };
collections.generalExpenses.push(general);
domRow.dataset = { paymentSource: "general", paymentSourceId: "g" };
activeSort = "date";
c.duplicateEmployeePaymentAccountingRow({ target: { closest: () => button } });
assert.equal(renderCount, 0);
assert.equal(sortCalls, 1, "An active sort is reapplied after inserting the duplicate");
assert.equal(insertedModels[1].sourceType, "general");
assert.equal(collections.generalExpenses[1].id, "duplicate-2");
assert.equal(notices, 2);

console.log(`Employee payment performance: OK; 20,000 students / 30 filter passes: ${baselineMs.toFixed(1)} ms full scan, ${optimizedMs.toFixed(1)} ms scoped snapshot. Duplicate inserts one row; unrelated partner calculations skipped.`);
