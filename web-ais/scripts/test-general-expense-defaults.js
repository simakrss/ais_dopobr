"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing block: ${startMarker}`);
  return source.slice(start, end);
}

const fields = [
  { key: "date", type: "date", label: "Дата" },
  { key: "paid", type: "date", label: "Оплачено" },
  { key: "bkExpenseNo", type: "text", label: "Номер в расходах" },
  { key: "accountingClosed", type: "checkbox", label: "Закрыто в бухгалтерии" }
];
const config = { collection: "generalExpenses", title: "Общие затраты", fields };
const state = { modal: { config: "generalExpenses", id: "" }, data: { collections: { generalExpenses: [] } } };
let currentDate = "2026-09-22";
let dateCalls = 0;
let recordId = 0;
let form;
class TestFormData extends Map {
  constructor(target) {
    super(Object.entries(target.elements)
      .filter(([, control]) => !control.disabled && (control.type !== "checkbox" || control.checked))
      .map(([name, control]) => [name, control.value]));
  }
}
function control(value = "", type = "text") {
  const listeners = new Map();
  return {
    value, type, checked: false, disabled: false, dataset: {}, title: "",
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
    emit(name) { (listeners.get(name) || []).forEach((listener) => listener()); },
    listenerCount(name) { return (listeners.get(name) || []).length; }
  };
}
function makeForm(record = {}, dataset = { config: "generalExpenses", id: "" }) {
  return {
    dataset: { ...dataset },
    elements: Object.fromEntries(fields.map((field) => {
      const input = control(record[field.key] || "", field.type);
      input.checked = record[field.key] === "+";
      return [field.key, input];
    }))
  };
}
const context = {
  state, configs: { generalExpenses: config }, FormData: TestFormData,
  document: { getElementById: () => form },
  todayIso: () => { dateCalls += 1; return currentDate; },
  normalizeGeneralExpenseSection: (section) => section || "Организации",
  normalizeContractSection: (section) => section || "Сотрудники",
  DEFAULT_STUDENT_ADDITIONAL_STATUS: "Начальный статус",
  getNextUid: () => "123",
  escapeAttr: String, escapeHtml: String,
  getMoneyInputStepAttribute: () => "",
  makeId: () => `test-${++recordId}`,
  addAudit: () => {}, buildRecordAuditChanges: () => [],
  refreshContractPaymentAccountingForCollections: () => {}
};
vm.createContext(context);
vm.runInContext([
  block("  function ensureRecordUid(", "  function download("),
  block("  function isChecked(", "  function paymentRowHasData("),
  block("  function renderField(", "  function renderStudentModal("),
  block("  function saveFormRecord(", "  function getFormSubmitButton(")
].join("\n"), context);

let record = context.ensureRecordUid(config);
assert.equal(record.date, currentDate);
assert.equal(record.paid, currentDate);
assert.equal(dateCalls, 1, "Read today's date once for both fields");
currentDate = "2026-09-23";
assert.equal(context.ensureRecordUid(config).paid, currentDate, "A later new record gets the new date");
const custom = { date: "2026-08-01", paid: "" };
record = context.ensureRecordUid(config, custom);
assert.equal(record.date, custom.date);
assert.equal(record.paid, "", "Do not replace an explicitly cleared payment date");
assert.deepEqual(custom, { date: "2026-08-01", paid: "" }, "Do not mutate the source");
state.modal.id = "existing";
assert.equal(context.ensureRecordUid(config, custom), custom, "Do not apply defaults to an existing record");
state.modal.id = "";
assert.equal(context.ensureRecordUid({ collection: "directExpenses", fields }).date, undefined);
assert.equal(context.ensureRecordUid({ collection: "contracts", fields }).paid, undefined);

for (const number of ["личная карта", "ЛИЧНАЯ КАРТА", " Личная  карта ", "личная\u00a0карта"]) {
  assert.equal(context.isGeneralExpensePersonalCard(number), true);
  form = makeForm({ bkExpenseNo: number, accountingClosed: "+" });
  context.bindGeneralExpenseAccountingControl();
  const checkbox = form.elements.accountingClosed;
  assert.equal(checkbox.disabled, true);
  assert.equal(checkbox.checked, true, "Disabling must not clear a stored flag");
  assert.match(checkbox.title, /личной карты/u);
  assert.equal(new TestFormData(form).has("accountingClosed"), false, "Native serialization omits disabled inputs");
  const id = context.saveFormRecord(form);
  assert.equal(state.data.collections.generalExpenses.find((item) => item.id === id).accountingClosed, "+");
}
for (const number of ["", "123", "личная карта другого лица"]) {
  assert.equal(context.isGeneralExpensePersonalCard(number), false);
}
form = makeForm(context.ensureRecordUid(config));
context.bindGeneralExpenseAccountingControl();
const number = form.elements.bkExpenseNo;
const checkbox = form.elements.accountingClosed;
context.bindGeneralExpenseAccountingControl();
assert.equal(number.listenerCount("input"), 1, "Do not duplicate event handlers");
assert.equal(checkbox.disabled, false);
number.value = "личная карта";
number.emit("input");
assert.equal(checkbox.disabled, true, "Typing changes availability immediately");
number.value = "125";
number.emit("change");
assert.equal(checkbox.disabled, false, "Selecting a different number enables the flag");
assert.equal(checkbox.title, "");
state.modal.readOnly = true;
number.emit("input");
assert.equal(checkbox.disabled, true, "Do not unlock a read-only card");
state.modal.readOnly = false;
form.dataset.recordReadonly = "true";
number.emit("change");
assert.equal(checkbox.disabled, true);
delete form.dataset.recordReadonly;
context.syncGeneralExpenseAccountingControl(form);
assert.equal(checkbox.disabled, false);
number.value = "Личная карта";
number.emit("change");
let id = context.saveFormRecord(form);
record = state.data.collections.generalExpenses.find((item) => item.id === id);
assert.equal(record.accountingClosed, "");
assert.equal(record.date, currentDate);
assert.equal(record.paid, currentDate);
form.dataset.id = id;
form.elements.paid.value = "";
form.elements.date.value = "2026-08-09";
context.saveFormRecord(form);
record = state.data.collections.generalExpenses.find((item) => item.id === id);
assert.equal(record.paid, "", "Saving preserves the user's cleared date");
assert.equal(record.date, "2026-08-09");

form = makeForm({ bkExpenseNo: "личная карта" }, { sourceType: "general" });
context.bindGeneralExpenseAccountingControl(form);
assert.equal(form.elements.accountingClosed.disabled, true, "Also applies in the employee's expense editor");
form.elements.bkExpenseNo.value = "151";
form.elements.bkExpenseNo.emit("change");
assert.equal(form.elements.accountingClosed.disabled, false);
form = makeForm({ bkExpenseNo: "личная карта" }, { config: "directExpenses" });
context.bindGeneralExpenseAccountingControl(form);
assert.equal(form.elements.accountingClosed.disabled, false, "Do not affect unrelated forms");

const checkboxField = fields.find((field) => field.key === "accountingClosed");
assert.match(context.renderField(checkboxField, { bkExpenseNo: "Личная карта", accountingClosed: "+" }), /checked\s+disabled/u);
assert.doesNotMatch(context.renderField(checkboxField, { bkExpenseNo: "12" }), /disabled/u);
assert.match(context.renderField(fields[0], { date: currentDate }), new RegExp(`value="${currentDate}"`));
assert.match(block("  function bindEvents()", "  function initializeRecordFormSnapshot("), /bindGeneralExpenseAccountingControl\(\);/u);
assert.match(block("  function restoreRecordFormEditingMode(", "  function dismissRecordLockNotice("), /syncGeneralExpenseAccountingControl\(form\);/u);
assert.match(block("  function bindEmployeeExpenseEditorEvents(", "  function synchronizeEmployeePaymentAgencyDraft("), /bindGeneralExpenseAccountingControl\(form\);/u);

// Exercise the actual supplemental-field save loop used inside the employee card.
const employeeSave = block("  function saveEmployeeExpenseEditor(", "    if (sourceType === \"general\") Object.assign(source, normalizeGeneralExpenseRecord(source));");
const loop = employeeSave.slice(employeeSave.indexOf("    fields.forEach((item) => {"));
form = makeForm({ bkExpenseNo: "личная карта", accountingClosed: "+" }, { sourceType: "general" });
context.bindGeneralExpenseAccountingControl(form);
Object.assign(context, { form, fields, context: { configId: "generalExpenses" }, source: {}, formData: new TestFormData(form) });
vm.runInContext(loop, context);
assert.equal(context.source.accountingClosed, "+");
console.log("General expense defaults, personal-card lock, saving and linked editor checks passed.");
