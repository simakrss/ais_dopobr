"use strict";
// Synthetic records only: no database changes, real bank details or emails.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n?/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }$`, "m"));
  assert.ok(match, name);
  return match[0];
}
function constant(name) {
  const match = source.match(new RegExp(`^  const ${name} = [\\s\\S]*?^  [\\]}](?:\\))?;$`, "m"));
  assert.ok(match, name);
  return match[0];
}
const state = { data: { dictionaries: {} }, communicationTemplateFieldsCollapsed: {} };
const context = {
  state, window: {}, unique: values => [...new Set(values)],
  DEFAULT_REPRESENTATIVE_NAME: "Тестовый представитель", DEFAULT_CONTACT_EMAIL: "test@example.invalid",
  isChecked: value => value === "Да",
  escapeHtml: value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
};
context.escapeAttr = context.escapeHtml;
vm.createContext(context);
vm.runInContext([
  ...["employeeCommunicationMessages", "employeeCommunicationTemplateDefaults", "studentCommunicationTemplateFields",
    "studentCommunicationTemplateCardFields", "studentCommunicationTemplateEditableFields", "employeeCommunicationTemplateCardFields",
    "communicationTemplateEditableFields", "studentCommunicationTemplateFieldFormulaDefaults", "communicationTemplateFieldAliasMap"].map(constant),
  ...["normalizeEmployeeCommunicationTemplates", "normalizeCommunicationTemplateFieldOverrides", "normalizeCommunicationTemplateCustomFields",
    "normalizeCommunicationTemplateFieldName", "getCommunicationTemplateFieldAlias", "replaceCommunicationTemplateFieldAliases",
    "getCommunicationTemplateFieldDefinitions", "generateEmployeeCommunicationMessages", "buildContractPortalCredentials",
    "applyStudentCommunicationTemplate", "resolveStudentCommunicationFormulaConditions", "isStudentCommunicationFormulaConditionTrue",
    "getStudentCommunicationAddressee", "formatStudentCommunicationDate", "renderCommunicationTemplateAudienceForm",
    "renderCommunicationTemplateFieldToken", "renderCommunicationTemplateEditorContent", "renderCommunicationTemplateLinks",
    "renderCommunicationTemplateSyntax", "renderCommunicationTemplateFormulaEditorContent"].map(extract),
  "this.messageKeys = employeeCommunicationMessages.map(message => message.key);"
].join("\n"), context);

const mapping = {
  БанкКарточки: "bank", РасчетныйСчетКарточки: "settlementAccount",
  КорреспондентскийСчетКарточки: "correspondentAccount", БИККарточки: "bic"
};
const record = {
  name: "Тестов Тест Тестович", type: "Тестовый договор",
  bank: ' Тестовый банк "Пример" ', settlementAccount: " 00123456789012345678 ",
  correspondentAccount: "00987654321098765432", bic: "001234567"
};
const keys = Object.keys(mapping);
const template = keys.map(key => `{${key}}`).join("\n");
const expected = Object.values(mapping).map(key => record[key].trim()).join("\n");
const definitions = context.getCommunicationTemplateFieldDefinitions();
for (const name of keys) {
  const matches = definitions.filter(field => field.name === name);
  assert.equal(matches.length, 1, `${name}: registered once`);
  assert.equal(matches[0].formula, `{${name}}`);
  assert.equal(matches[0].initialFormula, `{${name}}`);
  assert.equal(matches[0].custom, false);
  const token = context.renderCommunicationTemplateFieldToken(matches[0]);
  assert.ok(token.includes(`data-template-token="{${name}}"`));
  assert.match(token, /draggable="true"/);
}
const paymentSection = source.match(/renderContractSection\("Данные для оплаты", \[([\s\S]*?)\]/)[1];
assert.deepEqual([...paymentSection.matchAll(/"([^"]+)"/g)].map(match => match[1]), Object.values(mapping), "All payment section fields covered");
state.data.dictionaries.employeeCommunicationTemplates = context.messageKeys.map(() => template);
for (const value of Object.values(context.generateEmployeeCommunicationMessages(record))) assert.equal(value, expected);
for (const value of Object.values(context.generateEmployeeCommunicationMessages({}))) assert.equal(value, "\n\n\n", "Empty values resolve, not undefined or markers");
const editedRecord = { ...record, bank: "Другой тестовый банк", bic: "000000001" };
assert.equal(context.generateEmployeeCommunicationMessages(editedRecord)[context.messageKeys[0]], Object.values(mapping).map(key => editedRecord[key].trim()).join("\n"));

state.data.dictionaries.communicationTemplateCustomFields = [{ name: "РеквизитыДляПисьма", formula: template }];
state.data.dictionaries.employeeCommunicationTemplates[0] = "Реквизиты:\n{РеквизитыДляПисьма}";
assert.equal(context.generateEmployeeCommunicationMessages(record)[context.messageKeys[0]], `Реквизиты:\n${expected}`, "Nested formula resolves all payment fields");
state.data.dictionaries.communicationTemplateFieldOverrides = { БанкКарточки: "Банк: {БанкКарточки}", СообщениеДоступаКарточки: template };
assert.equal(context.buildContractPortalCredentials(record), `Банк: ${expected}`, "Employee access message uses same values and overrides");
assert.equal(context.buildContractPortalCredentials({ ...record, portalCredentials: "Ручной текст" }), "Ручной текст", "Manual messages unchanged");

const html = context.renderCommunicationTemplateAudienceForm({ audience: "employees", messages: [{}], templates: [template], descriptions: ["Реквизиты"], templateFields: definitions, active: true });
for (const name of keys) {
  assert.equal(html.split(`data-template-field-name="${name}"`).length - 1, 2, `${name}: palette and editor`);
  assert.ok(context.renderCommunicationTemplateFormulaEditorContent(`{${name}}`).includes('class="communication-template-block"'), `${name}: formula highlighting`);
}
state.data.dictionaries.employeeCommunicationTemplates[0] = "Ручной текст без полей";
assert.equal(context.generateEmployeeCommunicationMessages(record)[context.messageKeys[0]], "Ручной текст без полей");
console.log("PASS: four employee payment fields, palette/editor/formulas, all messages, empty/edited records, leading zeroes, nested/custom formulas and access messages");
