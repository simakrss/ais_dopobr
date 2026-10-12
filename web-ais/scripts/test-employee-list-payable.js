"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
const record = { id: "c1", name: "Тестовый Сотрудник", amount: 19750, paid: 19750, balance: 0 };
const expense = (id, amount, extra = {}) => ({ id, amount, note: record.name, recommendation: "+", ...extra });
const ready = expense("ready", 4000);
const sent = expense("sent", 5400, { act: "+", actStatus: "Отправлен" });
const pending = expense("pending", 10350, { recommendation: "" });
const settled = expense("settled", 78350, { actStatus: "Получен" });
let collections = {
  contracts: [record, { ...record, id: "c2", name: " ТЕСТОВЫЙ  СОТРУДНИК " }],
  students: [{ id: "student", directExpenses: [ready, sent, pending, settled] }],
  generalExpenses: [], directExpenses: []
};
let partnerCalculations = 0, scans = 0;
const c = vm.createContext({
  state: {
    view: "contracts", search: "", statusFilter: "Все", contractSectionFilter: [], sort: { key: "amount", dir: "asc" },
    employeePaymentFilters: { payment: "paid", comment: "unrelated temporary filter" },
    data: { collections, dictionaries: { paymentSettings: [] } }
  },
  configs: { contracts: { collection: "contracts", fields: [{ key: "amount", type: "number" }, { key: "netAmount", type: "number" }] } },
  CONTRACT_SECTIONS: [], GENERAL_EXPENSE_SECTIONS: [], EMPLOYEE_PAYMENT_ACT_STATUS_WITHOUT: "Без акта",
  formatOrdersSdoDate: (date) => date.toISOString().slice(0, 10),
  getEmployeeNetPayment: (amount) => Math.round(Number(amount || 0) * 90) / 100,
  getEmployeePartnerPaymentRows: (student) => { partnerCalculations++; return student.testPartnerRows || []; },
  money: (value) => `${value} ₽`,
  getTableConfigId: () => "contracts", getStudentListSelectedPrograms: () => [],
  getRegistryRowSearchText: (row) => Object.values(row).join(" ").toLowerCase(),
  normalizeContractSection: () => "", parseTableSortDate: () => null,
  filterRowsByTableValueFilters: (rows) => rows,
  normalizeContractRecord: (row) => row,
  getDocumentTemplateRows: () => [{ id: "template" }]
});
vm.runInContext([
  "normalizeEmployeeActPersonName", "getMoscowCalendarDateKey", "normalizeContractCalendarDateKey",
  "isStudentPastTrainingEndDate", "hasManualEmployeePaymentRecommendation", "applyAutomaticEmployeePaymentRecommendationsForCollections",
  "directExpenseIdentity", "getDirectExpenseEntriesFromCollections", "isChecked",
  "normalizeEmployeePaymentDateInput", "normalizeEmployeePaymentActStatus", "isEmployeePaymentCompletedActStatus",
  "isEmployeePaymentSettled", "getEmployeePaymentRowStatus", "getEmployeePaymentStatusFilterValue",
  "getEmployeePaymentDefaultSourceLabel", "getEmployeePaymentSourceValues", "normalizeEmployeePaymentSourceRow",
  "getEmployeePaymentAccounting", "getEmployeeContractListRows", "getRowsForConfig", "getVisibleRows", "getTableCellValue"
].map(extract).join("\n"), c);
const getEntries = c.getDirectExpenseEntriesFromCollections;
c.getDirectExpenseEntriesFromCollections = (...args) => { scans++; return getEntries(...args); };
const config = c.configs.contracts;
const listRows = (rowsOverride = null) => c.getEmployeeContractListRows(c.getRowsForConfig(config, rowsOverride));
const before = JSON.stringify(collections);
const list = listRows();
assert.equal(scans, 1, "One expense scan for all contracts and cells");
assert.equal(list[0].amount, 4000, "Exclude the 5400 sent act from the default payable list scope");
assert.equal(list[0].paid, 4000);
assert.equal(list[0].agencyAmount, 0);
assert.equal(list[0].balance, 10350, "Keep the full outstanding balance visible");
assert.equal(c.getTableCellValue(config, list[0], "netAmount"), 3600);
assert.equal(list[1].amount, list[0].amount, "Contracts for the same employee agree");
assert.equal(JSON.stringify(collections), before, "Display projection never changes stored financial data");
assert.notEqual(list[0], record);

// Reproduce the card's default status filter independently of the list projection.
function defaultCardAccounting(employee, data) {
  const all = c.getEmployeePaymentAccounting(employee, data);
  const rows = [
    ...all.directEntries.map(({ expense: e, identity }) => ({ type: "direct", id: e.id || identity, source: e })),
    ...all.generalEntries.map(({ expense: e, identity }) => ({ type: "general", id: identity, source: e })),
    ...all.partnerRows.map(({ source: p, sourceId }) => ({ type: "partner", id: sourceId, source: p }))
  ];
  const keys = new Set(rows.filter((row) => c.getEmployeePaymentStatusFilterValue(c.normalizeEmployeePaymentSourceRow(row.type, row.source)) === "payable")
    .map((row) => `${row.type}:${row.id}`));
  return c.getEmployeePaymentAccounting(employee, data, [], keys, all);
}
for (const key of ["amount", "paid", "agencyAmount"]) assert.equal(list[0][key], defaultCardAccounting(record, collections)[key]);
ready.amount = 4200;
assert.equal(listRows()[0].amount, 4200, "Recompute after a source edit without stale totals/cache");
sent.act = ""; sent.actStatus = "";
assert.equal(listRows()[0].amount, 9600, "Removing the act immediately restores payable amount");
sent.act = "+";
assert.equal(listRows()[0].amount, 4200, "Formed acts match the card's separate status too");

const partner = { id: "partner-student", agent: record.name };
partner.testPartnerRows = [
  { sourceId: "p-due", affectsAccounting: true, amount: 100, calculation: { payableAmount: 100 },
    source: { __partnerStudent: partner, __agentPaymentSlot: "due", __agentPaymentCalculation: { outstanding: 100, receiptsTotal: 500, accrued: 100 } } },
  { sourceId: "p-paid", affectsAccounting: false, amount: 50,
    source: { __partnerStudent: { agentPayment1Amount: 50, agentPayment1Date: "2026-10-01" }, __agentPaymentSlot: "paid1", __agentPaymentCalculation: {} } }
];
collections.students.push(partner);
collections.generalExpenses.push(
  { id: "g-ready", counterparty: record.name, amount: 200 },
  { id: "g-wait", counterparty: record.name, amount: 300, recommendation: "" },
  { id: "g-sent", counterparty: record.name, amount: 400, actStatus: "Отправлен" },
  { id: "g-paid", counterparty: record.name, amount: 500, paid: "2026-10-01" }
);
partnerCalculations = 0;
const mixed = listRows();
assert.equal(partnerCalculations, 1, "Compute partner sources once even with multiple contracts");
assert.equal(mixed[0].amount, 4500);
assert.equal(mixed[0].paid, 4400);
assert.equal(mixed[0].agencyAmount, 100);
for (const key of ["amount", "paid", "agencyAmount"]) assert.equal(mixed[0][key], defaultCardAccounting(record, collections)[key]);
partner.agentPaymentActStatus = "Отправлен";
assert.equal(listRows()[0].agencyAmount, 0);

collections.contracts.push({ id: "legacy", name: "Без источников", amount: 99999, paid: 99999, balance: 15 });
const visible = c.getVisibleRows(config);
assert.equal(visible[0].id, "legacy", "Numeric sorting uses projected current amounts");
assert.equal(visible[0].amount, 0, "No payable rows means zero, as in the default filtered card");
assert.equal(visible[0].balance, 15);
c.state.search = "4400";
assert.equal(c.getVisibleRows(config).length, 2, "Search uses the displayed payable totals");
c.state.search = "19750";
assert.equal(c.getVisibleRows(config).length, 0, "Stale saved totals must not affect the list search");
c.state.search = "";
assert.equal(c.getVisibleRows(config, [record])[0].amount, 4400, "Row overrides use the same projection");
assert.equal(c.getRowsForConfig(config)[0], record, "Raw source access remains unchanged for non-display operations");
const otherRows = [{ id: "untouched" }];
assert.equal(c.getRowsForConfig({ collection: "students" }, otherRows), otherRows);
assert.equal(c.getRowsForConfig({ collection: "documentTemplates" })[0].id, "template");
assert.equal(record.amount, 19750, "Temporary card filters and projected totals never overwrite the contract");
console.log("Employee list payable: OK (9400 vs 4000 regression, card parity, current data, tax, balance, act states, general/partner rows, sorting/search, no mutation, one-pass indexing)");
