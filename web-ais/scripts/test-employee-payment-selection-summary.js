"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
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
  getEmployeePartnerPaymentRows: (student) => student.partnerPaymentRows || [],
  normalizeEmployeePaymentSourceRow: (_type, value) => value,
  isEmployeePaymentSettled: (value = {}) => Boolean(value.historicalPayment || value.paid
    || ["Получен", "Без акта"].includes(value.actStatus)),
  getEmployeePaymentAccountingDraft: () => record,
  getEmployeePaymentCollections: () => collections,
  employeePaymentFiltersAreActive: () => filtersActive,
  money: String
});
vm.runInContext([
  "getEmployeePaymentAccounting", "normalizePaymentConstantNumber", "getEmployeeNetPayment",
  "getSelectedEmployeePaymentRows", "syncEmployeePaymentSummaryUi", "syncEmployeePaymentSelectionUi",
  "updateEmployeePaymentSelection", "clearEmployeePaymentSelection"
].map(extract).join("\n"), context);

const rows = collections.directExpenses.map((expense) => row("direct", expense.id));
const section = sectionFor(rows);
const summary = (key) => Number(section.nodes[`[data-employee-payment-summary="${key}"]`].textContent);
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
  students: [{ agent: record.name, partnerPaymentRows: [
    { sourceId: "student::agent-due", source: {}, amount: 75.5, affectsAccounting: true,
      calculation: { payableAmount: 75.5 } },
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
assert.equal(selectedAccounting("partner:student::agent-due").amount, 75.5, "No legacy service fallback for agency-only selection");
assert.equal(selectedAccounting("partner:student::agent-paid1").amount, 0, "Historical payments are not paid twice");
assert.equal(selectedAccounting().amount, 0);
assert.equal(selectedAccounting().balance, 0);
assert.equal(context.getEmployeePaymentAccounting(record, {}).amount, record.paid, "Unrestricted legacy accounting is unchanged");

const render = extract("renderEmployeePaymentAccounting");
assert.ok(render.indexOf('data-employee-payment-summary="netAmount"') < render.indexOf('data-employee-payment-summary="amount"'));
assert.match(render, /<small>К зачислению<\/small>/u);
assert.match(css, /\.employee-payment-formula-summary\s*\{\s*display: grid;\s*grid-template-columns: repeat\(5,/u);
assert.match(css, /\.employee-payment-formula-summary\s*\{\s*grid-template-columns: repeat\(2,/u);
assert.match(extract("applyEmployeePaymentFiltersToDom"), /syncEmployeePaymentSelectionUi\(section\)/u);
assert.match(extract("commitEmployeePaymentAccountingChange"), /getEmployeePaymentAccounting\(draft, collections\)/u);
console.log("Employee payment selection summary: OK");
