"use strict";
// Exercise real transaction/index/mutation handlers on a large, isolated database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const source = fs.readFileSync(process.env.AIS_PAYMENT_BENCHMARK_SOURCE || path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const baseline = Boolean(process.env.AIS_PAYMENT_BENCHMARK_SOURCE);
const extract = name => {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
};
const employee = "Тестовый Сотрудник";
const persisted = {
  contracts: [{ id: "c", name: employee, paid: 35000 }],
  students: Array.from({ length: 20000 }, (_, i) => ({
    id: `s${i}`, name: `Слушатель ${i}`,
    ...Object.fromEntries(Array.from({ length: 60 }, (_, n) => [`field${n}`, `Данные ${n}`])),
    directExpenses: Array.from({ length: 3 }, (_, n) => ({
      id: `d${i}-${n}`, note: i < 100 ? employee : "Другой сотрудник", amount: 350, recommendation: "+"
    }))
  })),
  directExpenses: [{ id: "global", note: employee, amount: 500, recommendation: "+" }],
  generalExpenses: Array.from({ length: 2000 }, (_, i) => ({ id: `g${i}`, counterparty: i < 100 ? employee : "Другой сотрудник", amount: 1000 }))
};
let scans = 0, renders = 0, filters = 0, audited = [], nextId = 0, newRow = null, selected = [];
const domRows = new Map();
const section = { isConnected: true, querySelectorAll: () => [...domRows.values()], contains: () => true };
function row(type, id) {
  const value = { dataset: { paymentSource: type, paymentSourceId: id, paymentDeletable: "true" },
    closest: () => section, remove: () => domRows.delete(`${type}:${id}`) };
  domRows.set(`${type}:${id}`, value);
  return value;
}
const c = vm.createContext({
  state: { modal: { config: "contracts", id: "c", draft: { ...persisted.contracts[0] } },
    data: { collections: persisted, dictionaries: { paymentSettings: [] } } },
  employeePaymentPersistTimer: 0, employeePaymentPreviewFrame: 0, pendingEmployeePaymentPreview: null,
  EMPLOYEE_PAYMENT_PERSIST_DELAY_MS: 500, AUDIT_CLIENT_MAX_CHANGES: 200,
  window: { clearTimeout() {}, cancelAnimationFrame() {}, confirm: () => true },
  document: { querySelector: selector => selector === "[data-employee-payment-accounting]" ? section : null },
  requestAnimationFrame() {},
  getEmployeePaymentAccountingDraft: () => ({ ...c.state.modal.draft }),
  normalizeContractRecord: value => value, normalizeGeneralExpenseRecord: value => value,
  getEmployeePartnerPaymentRows: () => [], normalizeEmployeePaymentSourceRow: (_type, value) => value,
  isEmployeePaymentSettled: value => Boolean(value.paid || value.isPaid || ["Получен", "Без акта"].includes(value.actStatus)),
  getEmployeePaymentSort: () => ({ key: "date" }), getEmployeePaymentFilters: () => ({ payment: "payable" }),
  getSelectedEmployeePaymentRows: () => selected,
  insertEmployeePaymentDuplicateRow: (_accounting, focus) => { newRow = row(focus.sourceType, focus.sourceId); return section; },
  applyEmployeePaymentSortToDom: () => filters++, applyEmployeePaymentFiltersToDom: () => filters++,
  updateEmployeePaymentAccountingUi() {},
  render: () => renders++,
  todayIso: () => "2026-11-18", makeId: () => `copy-${++nextId}`,
  createGeneralExpenseDuplicate: (value, date) => ({ ...value, id: `copy-${++nextId}`, date, paid: date }),
  getEmployeePaymentSourceValues: (_type, value) => value,
  getEmployeePaymentEditorAuditRecord: (_type, value) => ({ ...value }),
  getEmployeePaymentAuditFields: () => [], buildAuditChanges: (before, after) => [{ before, after }],
  formatContractDate: String, money: String, showDocumentGenerationNotice() {}, unique: values => [...new Set(values)],
  addAudit: (...args) => audited.push(args), alert: message => { throw new Error(message); }
});
const functions = ["cloneEmployeePaymentCollections", "getEmployeePaymentTransaction", "getEmployeePaymentCollections",
  "getEmployeePaymentSourceIndex", "invalidateEmployeePaymentSourceIndex", "normalizeEmployeeActPersonName",
  "getDirectExpenseEntriesFromCollections", "findEmployeePaymentSourceRecord", "markEmployeePaymentTransactionDirty",
  "addEmployeePaymentAudit", "scheduleEmployeePaymentAccountingPersist", "commitEmployeePaymentAccountingChange",
  "getEmployeePaymentAccounting", "duplicateEmployeePaymentAccountingRow", "removeEmployeePaymentSourceRecord",
  "applyEmployeePaymentGroupOperation", "commitEmployeePaymentTransaction", "discardEmployeePaymentTransaction"];
if (!baseline) functions.push("updateEmployeePaymentSourceIndex");
vm.runInContext(functions.map(extract).join("\n"), c);
const scan = c.getDirectExpenseEntriesFromCollections;
c.getDirectExpenseEntriesFromCollections = (...args) => { scans++; return scan(...args); };
const started = performance.now();
c.getEmployeePaymentCollections({ create: true });
c.getEmployeePaymentSourceIndex();
const firstEditMs = performance.now() - started;
scans = 0;
const duplicateStart = performance.now();
for (let i = 0; i < 30; i++) {
  const type = i % 2 ? "general" : "direct", id = i % 2 ? `g${i}` : `d${i}-0`;
  const existingRow = row(type, id);
  c.duplicateEmployeePaymentAccountingRow({ target: { closest: () => ({ closest: () => existingRow }) } });
  const copy = c.findEmployeePaymentSourceRecord(type, newRow.dataset.paymentSourceId);
  assert.equal(copy.paid, ""); assert.equal(copy.recommendation, "+");
  assert.equal(copy.date, "2026-11-18");
}
const duplicateMs = performance.now() - duplicateStart;
const duplicateScans = scans;
if (!baseline) assert.equal(scans, 0, "Thirty duplicates do not rebuild the database index");
assert.equal(renders, 0);
assert.equal(persisted.generalExpenses.length, 2000, "The database is not mutated before Save");
assert.equal(persisted.students[0].directExpenses.length, 3);
selected = [
  ...Array.from({ length: 100 }, (_, i) => row("direct", `d${i}-0`)),
  ...Array.from({ length: 100 }, (_, i) => row("general", `g${i}`)),
  ...[...domRows.values()].filter(value => value.dataset.paymentSourceId.startsWith("copy-"))
];
const selectedKeys = selected.map(value => `${value.dataset.paymentSource}:${value.dataset.paymentSourceId}`);
scans = 0; filters = 0;
const deleteStart = performance.now();
const deleteButton = { matches: selector => selector.includes("delete-selected-employee-payments") };
c.applyEmployeePaymentGroupOperation({ target: { closest: () => deleteButton } }, section);
const deleteMs = performance.now() - deleteStart;
const deleteScans = scans;
if (!baseline) {
  assert.equal(scans, 0, "Bulk deletion must not scan the database for each selected expense");
  assert.equal(renders, 0, "Bulk deletion must not rebuild the application or card");
  assert.equal(filters, 1, "Filter options and totals refresh once per operation");
  selectedKeys.forEach(key => assert.equal(domRows.has(key), false));
}
const working = c.getEmployeePaymentCollections();
const independent = c.getEmployeePaymentAccounting(c.state.modal.draft, working);
assert.equal(c.state.modal.draft.amount, independent.amount);
assert.equal(working.students[0].directExpenses.length, 2);
assert.equal(working.generalExpenses.length, 1900);
assert.equal(persisted.students[0].directExpenses.length, 3);
assert.equal(persisted.generalExpenses.length, 2000);
assert.equal(audited.length, 0, "Audit remains in the card transaction until Save");
assert.equal(c.commitEmployeePaymentTransaction(), true);
assert.equal(persisted.students[0].directExpenses.length, 2);
assert.equal(persisted.generalExpenses.length, 1900);
assert.equal(audited.length, 31, "Thirty duplications and one bulk deletion are audited on Save");

// Cancelling a later edit leaves the saved database unchanged.
c.removeEmployeePaymentSourceRecord("direct", "d0-1");
assert.equal(c.getEmployeePaymentCollections().students[0].directExpenses.length, 1);
c.discardEmployeePaymentTransaction();
assert.equal(persisted.students[0].directExpenses.length, 2);

if (!baseline) {
  // Legacy mirrors with the same ID must remain consistent with a fresh accounting scan.
  const mirrored = c.getEmployeePaymentCollections({ create: true });
  mirrored.directExpenses.push({ id: "d0-1", note: employee, amount: 99, recommendation: "+" });
  c.invalidateEmployeePaymentSourceIndex();
  assert.equal(c.removeEmployeePaymentSourceRecord("direct", "d0-1").amount, 350);
  assert.equal(c.findEmployeePaymentSourceRecord("direct", "d0-1").amount, 99);
  c.discardEmployeePaymentTransaction();
  // A payee edit can move a source between groups; no stale membership may remain.
  let expense = c.findEmployeePaymentSourceRecord("general", "g101");
  expense.counterparty = employee;
  c.updateEmployeePaymentSourceIndex("general", expense.id, { expense, identity: expense.id });
  let index = c.getEmployeePaymentSourceIndex();
  assert.ok(index.byEmployee.get(employee.toLowerCase()).generalEntries.some(entry => entry.expense === expense));
  assert.ok(!index.byEmployee.get("другой сотрудник").generalEntries.some(entry => entry.expense === expense));
  c.removeEmployeePaymentSourceRecord("general", expense.id);
  assert.equal(c.findEmployeePaymentSourceRecord("general", expense.id), null);
  // An external structural change invalidates the cached references.
  c.getEmployeePaymentCollections().generalExpenses = [];
  assert.equal(c.findEmployeePaymentSourceRecord("general", "g102"), null);
  // Removing the last expense clears cached totals rather than resurrecting them.
  c.getEmployeePaymentCollections().students = [];
  c.getEmployeePaymentCollections().directExpenses = [];
  c.commitEmployeePaymentAccountingChange({ id: "c", name: employee, paid: 35000, balance: 99 },
    { removedRows: [row("direct", "gone")], sourceIndexUpdated: true }, true);
  assert.equal(c.state.modal.draft.amount, 0); assert.equal(c.state.modal.draft.balance, 0);
}
console.log(JSON.stringify({ mode: baseline ? "baseline" : "optimized", students: 20000, expenses: 62001,
  firstEditMs: +firstEditMs.toFixed(1), thirtyDuplicatesMs: +duplicateMs.toFixed(1), duplicateScans,
  delete230Ms: +deleteMs.toFixed(1), deleteScans, renders }));
