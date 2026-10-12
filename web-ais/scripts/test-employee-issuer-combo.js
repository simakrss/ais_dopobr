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
const issuerDefinition = source.match(/^\s*field\("identityIssuer",[^\n]+/m)?.[0].trim().replace(/,$/, "");
assert.ok(issuerDefinition);
const issuer = new Function("field", `return ${issuerDefinition}`)(
  (key, label, type, required, dict, options) => ({ key, label, type, required, dict, options })
);
assert.equal(issuer.type, "combo");
const nameField = { key: "name", label: "ФИО", type: "text" };
const citizenship = { key: "citizenship", label: "Гражданство", type: "select", dict: "citizenships" };
const state = {
  modal: { config: "contracts", id: "employee", draft: {} },
  data: {
    dictionaries: { passportIssuers: ["Справочник МВД", "Отдел МВД"], citizenships: ["Россия"] },
    collections: {
      contracts: [{ id: "employee", name: "Тестовый сотрудник", identityIssuer: "Отдел МВД" },
        { id: "another", identityIssuer: "Управление МВД" }],
      students: [{ passportIssuer: "Отдел МВД", customerPassportIssuer: "УФМС" }]
    }
  }
};
const form = {
  dataset: { config: "contracts", id: "employee" },
  elements: { name: { value: "Тестовый сотрудник" }, identityIssuer: { value: "" } },
  querySelector: () => null
};
class TestFormData extends Map {
  constructor(target) { super(Object.entries(target.elements).map(([key, input]) => [key, input.value])); }
}
const c = vm.createContext({
  state, configs: { contracts: { collection: "contracts", fields: [nameField, issuer, citizenship], title: "Сотрудники" } },
  unique: (values) => [...new Set(values)], FormData: TestFormData,
  document: { getElementById: () => form },
  getEmployeePaymentCollections: () => state.data.collections,
  normalizePreferredMessenger: (value) => value || "",
  clearUnchangedGeneratedEmployeeCommunicationMessages() {},
  buildContractPortalCredentials: () => "",
  normalizeContractRecord: (record) => ({ ...record }),
  fillMissingPersonGender: (record) => record,
  normalizePersonPhotoCardPath: (value) => value || "",
  normalizeInn: (value) => value || "", formatSnils: (value) => value || "",
  validateStudentIdentityValue: () => true,
  getEmployeePaymentAccounting: () => ({ amount: 0, paid: 0, agencyAmount: 0, balance: 0 }),
  commitEmployeePaymentTransaction() {}, refreshContractPaymentAccountingForCollections() {},
  addAudit() {}, buildRecordAuditChanges: () => [],
  getDocumentRecognitionCitizenshipOptions: () => ["Россия"],
  searchableStudentFields: {}, studentCardFields: [],
  getEducationDocumentIssuerOptions: () => ["Учебное заведение"]
});
vm.runInContext([
  "escapeHtml", "escapeAttr", "renderField", "renderComboField", "getLookupOptions", "getPassportIssuerOptions",
  "collectContractFormDraft", "saveFormRecord", "getDocumentRecognitionFieldDefinition",
  "getDocumentRecognitionAlternativeValues", "getDocumentRecognitionListControl", "filterComboOptions"
].map(extract).join("\n"), c);

const custom = 'Новое подразделение № 42 — «МВД» & "ОВД" <пример>';
const options = Array.from(c.getPassportIssuerOptions(custom));
assert.deepEqual(new Set(options), new Set(["Справочник МВД", "Отдел МВД", "Управление МВД", "УФМС", custom]));
assert.equal(options.filter((value) => value === "Отдел МВД").length, 1, "Duplicate suggestions are removed");
const html = c.renderField(issuer, { identityIssuer: custom });
assert.equal((html.match(/<input\b/g) || []).length, 1, "Free text and selection use one input");
assert.match(html, /name="identityIssuer"/);
assert.match(html, /data-combo-input/);
assert.match(html, /data-settings-dictionary="passportIssuers"/);
assert.match(html, /data-action="select-combo-value"/);
assert.match(html, /data-action="clear-combo-value"/);
assert.match(html, /program-field-wide/);
assert.doesNotMatch(html, /<select\b|readonly|disabled/);
assert.ok(html.includes(`value="${c.escapeAttr(custom)}"`), "Custom text is retained and escaped");
assert.match(c.renderField(citizenship, { citizenship: "Россия" }), /<select\b/, "Unrelated selects are unchanged");

for (const value of [custom, "УФМС", ""]) {
  form.elements.identityIssuer.value = value;
  assert.equal(c.collectContractFormDraft({ recalculatePaymentAccounting: false }).identityIssuer, value,
    "Switching tabs preserves arbitrary, selected and cleared values");
  assert.equal(c.saveFormRecord(form), "employee");
  assert.equal(state.data.collections.contracts[0].identityIssuer, value, "Saving does not restrict values to the dictionary");
  assert.ok(c.renderField(issuer, state.data.collections.contracts[0]).includes(`value="${c.escapeAttr(value)}"`));
  if (value) assert.ok(c.getPassportIssuerOptions().includes(value), "Saved values are available for selection");
}

const recognized = c.getDocumentRecognitionListControl({
  key: "identityIssuer", label: "Кем выдан", value: custom, alternatives: ["Вариант распознавания"]
}, true);
assert.equal(recognized.mode, "combo");
assert.ok(recognized.options.includes(custom));
assert.ok(recognized.options.includes("Вариант распознавания"));
assert.match(recognized.markup, /data-ocr-field-value/);
assert.match(recognized.markup, /data-combo-input/);
assert.doesNotMatch(recognized.markup, /<select\b/);
assert.equal(c.getDocumentRecognitionListControl({ key: "citizenship", value: "Россия" }, true).mode, "select");

const buttons = ["Управление МВД", "УФМС", "Отдел МВД"].map((textContent) => ({ textContent, hidden: false }));
const combo = { querySelectorAll: () => buttons, classList: { contains: () => false } };
c.filterComboOptions({ value: "мвд", closest: () => combo });
assert.deepEqual(buttons.map((button) => Boolean(button.hidden)), [false, true, false]);
c.filterComboOptions({ value: "произвольное значение", closest: () => combo }, { showAll: true });
assert.ok(buttons.every((button) => !button.hidden), "Opening the list can show all options regardless of typed text");

state.data.dictionaries.passportIssuers = [];
state.data.collections.students = [];
state.data.collections.contracts = [];
assert.match(c.renderField(issuer, { identityIssuer: "Новый орган выдачи" }), /data-combo-input/);
assert.equal(c.getDocumentRecognitionListControl({ key: "identityIssuer", value: "Новый орган выдачи" }, true).mode, "combo");
console.log("Employee issuer combo: OK (one editable field, suggestions, search, escaping, draft/save/reopen, OCR, empty dictionary)");
