"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}

class Input {
  constructor(action) { this.action = action; this.checked = false; this.disabled = false; }
  matches(selector) { return selector === `[data-action='${this.action}']`; }
}
class Button {}
function element() {
  const classes = new Set();
  return {
    textContent: "",
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
    classes
  };
}
function row(sourceType, sourceId) {
  const control = new Input("select-employee-payment-row");
  return {
    hidden: false,
    dataset: { paymentSource: sourceType, paymentSourceId: sourceId, paymentDeletable: "true" },
    control,
    querySelector: (selector) => control.matches(selector) ? control : null
  };
}
function sectionFor(rows) {
  const nodes = {
    "[data-action='select-visible-employee-payments']": new Input("select-visible-employee-payments"),
    "[data-employee-payment-selected-count]": element(),
    "[data-employee-payment-group-actions]": element(),
    "[data-employee-payment-balance-card]": element(),
    "[data-employee-payment-summary-scope]": element()
  };
  for (const key of ["netAmount", "amount", "paid", "agencyAmount", "balance"]) {
    nodes[`[data-employee-payment-summary="${key}"]`] = element();
  }
  return {
    nodes,
    querySelector: (selector) => nodes[selector] || null,
    querySelectorAll(selector) {
      if (selector === "[data-employee-payment-row]") return rows;
      if (selector === "[data-action='select-employee-payment-row']") return rows.map((item) => item.control);
      return [];
    }
  };
}

const record = Object.freeze({ name: "Тестовый сотрудник", paid: 9999, balance: 1234 });
const collections = {
  students: [], generalExpenses: [],
  directExpenses: Array.from({ length: 8 }, (_, index) => ({
    id: `direct-${index}`, note: record.name, amount: 350, recommendation: "+"
  }))
};
let filtersActive = false;
const context = vm.createContext({
  HTMLInputElement: Input, HTMLButtonElement: Button,
  state: { data: { dictionaries: { paymentSettings: [] } } },
  normalizeEmployeeActPersonName: (value) => String(value || "").trim().toLowerCase(),
  getDirectExpenseEntriesFromCollections: (values) => (values.directExpenses || [])
    .map((expense) => ({ expense, identity: expense.id })),
  getEmployeePartnerPaymentRows: (student) => (student.partnerPaymentRows || []).map((row) => ({ ...row, student })),
  normalizeEmployeePaymentSourceRow: (_type, value) => value,
  isEmployeePaymentSettled: (value = {}) => Boolean(value.historicalPayment || value.paid
    || ["Получен", "Без акта"].includes(value.actStatus)),
  getEmployeePaymentAccountingDraft: () => record,
  getEmployeePaymentCollections: () => collections,
  employeePaymentFiltersAreActive: () => filtersActive,
  formatContractDate: (value) => String(value || ""),
  splitFullName: () => ({ firstName: "Иван", patronymic: "Иванович" }),
  numberToRussianWords: (value) => `Прописью ${value}`,
  formatEmployeeContractShortName: () => "Иванов И.И.",
  formatEmployeeActCurrentDate: () => "12.10.2026",
  addAudit: () => {},
  commitEmployeePaymentAccountingChange: () => {},
  money: String
});
vm.runInContext([
  "getEmployeePaymentAccounting", "normalizePaymentConstantNumber", "getEmployeeNetPayment",
  "getSelectedEmployeePaymentRows", "getEmployeePaymentSummaryScope", "formatEmployeePaymentSummaryAmount", "syncEmployeePaymentSummaryUi", "syncEmployeePaymentSelectionUi",
  "updateEmployeePaymentSelection", "clearEmployeePaymentSelection",
  "formatEmployeeActAmount", "formatEmployeeActPaymentRows", "getEmployeeActVariablePaymentRows",
  "getEmployeeActPartnerPaymentRows", "getEmployeeActPaymentSummary", "prepareEmployeeActDocumentRecord",
  "getEmployeeActDocumentRequiredFields", "getMissingEmployeeActDocumentFields", "markEmployeeActPaymentRowsAsSent"
].map(extract).join("\n"), context);

const rows = collections.directExpenses.map((expense) => row("direct", expense.id));
const section = sectionFor(rows);
const summary = (key) => {
  const value = Number(section.nodes[`[data-employee-payment-summary="${key}"]`].textContent.replace(/[^\d,.-]/g, "").replace(",", "."));
  const act = context.getEmployeeActPaymentSummary(record, collections, context.getEmployeePaymentSummaryScope(section).includedRowKeys);
  if (key === "amount") assert.equal(act.total, value, "Act and visible gross payout must always match");
  if (key === "paid") assert.equal(act.variableTotal, value);
  if (key === "agencyAmount") assert.equal(act.partnerTotal, value);
  return value;
};
const scope = () => section.nodes["[data-employee-payment-summary-scope]"].textContent;
const selectAll = section.nodes["[data-action='select-visible-employee-payments']"];
const originalCollections = JSON.stringify(collections);
context.syncEmployeePaymentSelectionUi(section);
assert.equal(summary("amount"), 2800);
assert.equal(summary("netAmount"), 2436);
assert.equal(scope(), "По всему списку.");

rows.slice(0, 4).forEach((item) => { item.control.checked = true; });
assert.equal(context.updateEmployeePaymentSelection({ target: rows[3].control }, section), true);
assert.equal(summary("amount"), 1400);
assert.equal(summary("netAmount"), 1218);
assert.equal(summary("paid"), 1400);
assert.equal(summary("agencyAmount"), 0);
assert.equal(summary("balance"), 0);
assert.equal(section.nodes["[data-employee-payment-selected-count]"].textContent, "4");
assert.equal(scope(), "По выбранным строкам: 4.");
assert.equal(selectAll.indeterminate, true);
const selectedAct = context.getEmployeeActPaymentSummary(record, collections, context.getEmployeePaymentSummaryScope(section).includedRowKeys);
const generatedAct = context.prepareEmployeeActDocumentRecord(record, collections, selectedAct);
assert.equal(generatedAct.employeeActDocumentValues["Сумма"], "1400");
assert.equal(generatedAct.employeeActDocumentValues["СуммаЗач"], "1218");
assert.equal(generatedAct.amount, 1400, "Custom formulas also receive the scoped gross payout");
assert.equal(generatedAct.employeeActDocumentValues["Переменные выплаты"].split("\n").length, 4);
assert.equal(record.paid, 9999, "Generating an act must not overwrite the employee record");

selectAll.checked = true;
assert.equal(context.updateEmployeePaymentSelection({ target: selectAll }, section), true);
assert.equal(summary("amount"), 2800);
assert.ok(rows.every((item) => item.control.checked));
context.clearEmployeePaymentSelection(section);
assert.ok(rows.every((item) => !item.control.checked));
assert.equal(summary("amount"), 2800);
assert.equal(selectAll.indeterminate, false);

filtersActive = true;
rows.slice(2).forEach((item) => { item.hidden = true; });
context.syncEmployeePaymentSelectionUi(section);
assert.equal(summary("amount"), 700);
assert.equal(summary("netAmount"), 609);
assert.equal(scope(), "По фильтру: 2.");
selectAll.checked = true;
context.updateEmployeePaymentSelection({ target: selectAll }, section);
assert.equal(rows.filter((item) => item.control.checked).length, 2);
rows[0].hidden = true;
context.syncEmployeePaymentSelectionUi(section);
assert.equal(summary("amount"), 700, "Hidden selected rows still participate in group operations and totals");
assert.equal(scope(), "По выбранным строкам: 2 (скрыто фильтром: 1).");
context.clearEmployeePaymentSelection(section);
assert.equal(summary("amount"), 350);
rows[1].hidden = true;
context.syncEmployeePaymentSelectionUi(section);
assert.equal(summary("amount"), 0, "Empty filter must not fall back to stored contract totals");
assert.equal(summary("balance"), 0);
assert.equal(selectAll.disabled, true);
const emptyAct = context.getEmployeeActPaymentSummary(record, collections, context.getEmployeePaymentSummaryScope(section).includedRowKeys);
assert.ok(context.getMissingEmployeeActDocumentFields(record, collections, emptyAct).some((item) => item.key === "amount"));
assert.equal(emptyAct.variableRows.length, 0);
assert.equal(emptyAct.partnerRows.length, 0);
assert.equal(JSON.stringify(collections), originalCollections, "Selection and filtering never change stored data");
assert.equal(context.getEmployeePaymentAccounting(record, collections).amount, 2800);

filtersActive = false;
rows.forEach((item) => { item.hidden = false; });
rows[0].control.checked = true;
context.state.data.dictionaries.paymentSettings = [{ key: "incomeTaxRate", value: "20" }];
context.syncEmployeePaymentSelectionUi(section);
assert.equal(summary("netAmount"), 280);
collections.directExpenses[0].amount = 500;
context.syncEmployeePaymentSelectionUi(section);
assert.equal(summary("amount"), 500);
assert.equal(summary("netAmount"), 400);
const changedRateAct = context.getEmployeeActPaymentSummary(record, collections, context.getEmployeePaymentSummaryScope(section).includedRowKeys);
assert.equal(context.prepareEmployeeActDocumentRecord(record, collections, changedRateAct).employeeActDocumentValues["СуммаЗач"], "400");
collections.directExpenses[0].act = "+";
collections.directExpenses[0].actStatus = "Отправлен";
context.syncEmployeePaymentSelectionUi(section);
assert.equal(summary("amount"), 500, "Sent but unpaid act rows remain in the same payout calculation");
collections.directExpenses[0].recommendation = "";
context.syncEmployeePaymentSelectionUi(section);
assert.equal(summary("amount"), 0);
assert.equal(summary("balance"), 500);
assert.ok(section.nodes["[data-employee-payment-balance-card]"].classes.has("has-balance"));
collections.directExpenses[0].recommendation = "+";
collections.directExpenses[0].paid = "2026-10-06";
context.syncEmployeePaymentSelectionUi(section);
assert.equal(summary("amount"), 0);
assert.equal(summary("balance"), 0);
assert.ok(!section.nodes["[data-employee-payment-balance-card]"].classes.has("has-balance"));

// Source IDs are namespaced: a direct expense must not select a general expense with the same ID.
const mixed = {
  directExpenses: [{ id: "same", note: record.name, amount: 100, recommendation: "+" }],
  generalExpenses: [
    { id: "same", counterparty: record.name, amount: 250 },
    { id: "received", counterparty: record.name, amount: 900, actStatus: "Получен" }
  ],
  students: [{ name: "Слушатель", agent: record.name, partnerPaymentRows: [
    { sourceId: "student::agent-due", source: {}, amount: 75.5, affectsAccounting: true, payable: true, slot: "due",
      calculation: { payableAmount: 75.5, rate: 10, receiptsTotal: 755 } },
    { sourceId: "student::agent-paid1", source: { historicalPayment: true }, amount: 400, affectsAccounting: false }
  ] }]
};
const selectedAccounting = (...keys) => context.getEmployeePaymentAccounting(record, mixed, [], new Set(keys));
assert.equal(selectedAccounting("direct:same").amount, 100);
assert.equal(selectedAccounting("general:same").amount, 250);
assert.equal(selectedAccounting("general:received").amount, 0);
const selectedMixed = selectedAccounting("direct:same", "general:same", "partner:student::agent-due");
assert.equal(selectedMixed.amount, 425.5);
assert.equal(selectedMixed.agencyAmount, 75.5);
assert.equal(context.getEmployeeNetPayment(selectedMixed.amount, []), 370.19);
assert.match(context.formatEmployeePaymentSummaryAmount(selectedMixed.amount), /425,5/);
assert.match(context.formatEmployeePaymentSummaryAmount(370.19), /370,19/);
assert.doesNotMatch(context.formatEmployeePaymentSummaryAmount(350), /,/);
assert.equal(selectedAccounting("partner:student::agent-due").amount, 75.5, "No legacy service fallback for agency-only selection");
assert.equal(selectedAccounting("partner:student::agent-paid1").amount, 0, "Historical payments are not paid twice");
assert.equal(selectedAccounting().amount, 0);
assert.equal(selectedAccounting().balance, 0);
assert.equal(context.getEmployeePaymentAccounting(record, {}).amount, record.paid, "Unrestricted legacy accounting is unchanged");
const scopedAct = (...keys) => context.getEmployeeActPaymentSummary(record, mixed, new Set(keys));
assert.equal(scopedAct("partner:student::agent-due").total, 75.5);
assert.equal(scopedAct("partner:student::agent-due").variableRows.length, 0);
assert.equal(scopedAct("partner:student::agent-paid1").total, 0);
assert.equal(scopedAct("general:received").total, 0);
assert.equal(scopedAct("direct:same").variableRows[0].amount, 100);
assert.equal(scopedAct("general:same").variableRows[0].amount, 250);
const actSnapshot = scopedAct("general:same", "partner:student::agent-due");
assert.equal(context.markEmployeeActPaymentRowsAsSent(record, mixed, actSnapshot.includedRowKeys), 2);
assert.equal(mixed.directExpenses[0].act, undefined, "Excluded rows must not be marked as sent");
assert.equal(mixed.generalExpenses[0].actStatus, "Отправлен");
assert.equal(mixed.students[0].agentPaymentActStatus, "Отправлен");
assert.equal(mixed.generalExpenses[1].actStatus, "Получен");
assert.equal(context.markEmployeeActPaymentRowsAsSent(record, mixed, new Set()), 0);

mixed.directExpenses[0].amount = 100.75;
const rounded = scopedAct("direct:same");
assert.equal(rounded.total, 100, "Existing panel rounding is preserved");
assert.equal(rounded.variableRows.reduce((sum, row) => sum + row.amount, 0), rounded.total, "Detail rows explain rounding and match the total");
assert.match(rounded.variableRows[1].description, /Округление/);
assert.equal(mixed.directExpenses[0].amount, 100.75);
assert.equal(context.getEmployeeActPaymentSummary({ name: record.name, paid: 0, amount: 9999 }, {}).total, 0, "Never fall back to the full contract amount");

const render = extract("renderEmployeePaymentAccounting");
assert.ok(render.indexOf('data-employee-payment-summary="netAmount"') < render.indexOf('data-employee-payment-summary="amount"'));
assert.match(render, /<small>К зачислению<\/small>/u);
assert.match(css, /\.employee-payment-formula-summary\s*\{\s*display: grid;\s*grid-template-columns: repeat\(5,/u);
assert.match(css, /\.employee-payment-formula-summary\s*\{\s*grid-template-columns: repeat\(2,/u);
assert.match(extract("applyEmployeePaymentFiltersToDom"), /syncEmployeePaymentSelectionUi\(section\)/u);
assert.match(extract("commitEmployeePaymentAccountingChange"), /getEmployeePaymentAccounting\(draft, collections\)/u);
async function testActWorkflowSnapshot() {
  const draftRecord = { ...record, id: "employee-1", contractDate: "2026-10-12", subject: "Услуги" };
  let generated = null, sends = 0, emailed = true, warnings = 0;
  Object.assign(context, {
    document: { querySelector: () => section },
    collectContractFormDraft: () => draftRecord,
    getEmployeeActDocumentTemplate: () => ({ title: "Акт" }),
    getEmployeeDocumentStorageRequest: () => ({}),
    alert: () => { warnings++; },
    formatStudentDocumentMissingFields: (fields) => fields.map((item) => item.label).join(", "),
    focusEmployeeContractDocumentField: () => {},
    downloadStudentDocumentFromTemplate: async (_template, prepared) => {
      sends++; generated = prepared;
      // Changing the UI while preview/email is open must not broaden the sent act.
      rows.forEach((row) => { row.control.checked = false; row.hidden = false; });
      filtersActive = false;
      return { emailed };
    }
  });
  vm.runInContext(["validateEmployeeActDocumentFields", "openEmployeeActDocument"].map(extract).join("\n"), context);
  collections.directExpenses.forEach((expense) => {
    expense.amount = 350; expense.recommendation = "+";
    delete expense.act; delete expense.actStatus; delete expense.paid;
  });
  rows.forEach((row, index) => { row.control.checked = index < 2; row.hidden = false; });
  await context.openEmployeeActDocument({ currentTarget: {} });
  assert.equal(generated.amount, 700);
  assert.equal(generated.employeeActDocumentValues["Сумма"], "700");
  assert.equal(collections.directExpenses.filter((expense) => expense.actStatus === "Отправлен").length, 2);
  assert.equal(draftRecord.paid, 9999);
  assert.equal(warnings, 0);
  emailed = false;
  rows[2].control.checked = true;
  await context.openEmployeeActDocument({ currentTarget: {} });
  assert.equal(generated.amount, 350);
  assert.equal(collections.directExpenses[2].act, undefined, "Preview/save without email does not mark rows sent");
  filtersActive = true;
  rows.forEach((row) => { row.hidden = true; row.control.checked = false; });
  await context.openEmployeeActDocument({ currentTarget: {} });
  assert.equal(sends, 2, "An empty filtered payout must not generate a full-list act");
  assert.equal(warnings, 1);
  console.log("Employee payment selection and act: OK (filters, checkboxes, draft, rounding, zero, email snapshot)");
}
testActWorkflowSnapshot().catch((error) => { console.error(error); process.exitCode = 1; });
