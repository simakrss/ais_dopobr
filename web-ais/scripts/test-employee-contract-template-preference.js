"use strict";
// Synthetic cards and mocked generation only; no production writes or emails.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";
const server = require("../app-server.js");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const extract = name => {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }$`, "m"));
  assert.ok(match, name);
  return match[0];
};
const templates = ["education", "general", "education-no-stamp", "general-no-stamp"].map(id => ({id, title: id}));
const person = "Тестова Варвара Романовна";
const state = {data: {collections: {contracts: [
  {id: "a", name: person, note: "Сохранённый текст"},
  {id: "b", name: "ТЕСТОВА  ВАРВАРА РОМАНОВНА", note: "Другой договор"},
  {id: "c", name: "Другой сотрудник"}
]}}};
const saved = [], generated = [], choices = [];
let selected = null, valid = true, switchCard = false;
const c = {
  state, persist: () => saved.push(JSON.parse(JSON.stringify(state.data))),
  getEmployeeContractDocumentTemplates: () => templates,
  collectContractFormDraft: () => ({...state.data.collections.contracts.find(row => row.id === state.modal.id), ...state.modal.draft}),
  chooseStudentContractDocument: async (_templates, id) => {choices.push(id); if (switchCard) state.modal = {config: "students"}; return selected;},
  validateEmployeeContractDocumentFields: () => valid,
  prepareEmployeeContractDocumentRecord: record => record,
  getEmployeeDocumentStorageRequest: () => ({}),
  downloadStudentDocumentFromTemplate: async (template, record) => generated.push({template: template.id, record: {...record}})
};
vm.createContext(c);
for (const name of ["normalizeEmployeeActPersonName", "getPreferredEmployeeContractDocumentTemplate", "rememberEmployeeContractDocumentTemplate", "openEmployeeContractDocument"])
  vm.runInContext(extract(name), c);
const open = id => {state.modal = {config: "contracts", id, draft: {...state.data.collections.contracts.find(row => row.id === id)}};};
async function main() {
  open("a");
  await c.openEmployeeContractDocument({});
  assert.equal(choices.at(-1), "education", "Initial default unchanged");
  assert.equal(saved.length, 0, "Cancelling the picker changes nothing");
  selected = templates[1];
  state.modal.draft.note = "Несохранённая правка";
  state.modal.employeePaymentTransaction = {dirty: true, collections: {contracts: state.data.collections.contracts.map(row => ({...row}))}};
  state.modal.employeePaymentTransaction.collections.contracts[0].amount = 123;
  await c.openEmployeeContractDocument({});
  assert.equal(generated.at(-1).template, "general");
  assert.equal(saved.at(-1).collections.contracts[0].employeeContractTemplateId, "general");
  assert.equal(saved.at(-1).collections.contracts[0].note, "Сохранённый текст", "Preference does not save unrelated draft fields");
  assert.equal(saved.at(-1).collections.contracts[0].amount, undefined, "No unsaved payment transaction leak");
  assert.equal(state.modal.draft.note, "Несохранённая правка");
  assert.equal(state.modal.employeePaymentTransaction.collections.contracts[0].employeeContractTemplateId, "general");
  assert.equal(state.modal.employeePaymentTransaction.collections.contracts[0].amount, 123);
  assert.equal(state.modal.employeePaymentTransaction.dirty, true);
  assert.equal(state.data.collections.contracts[1].employeeContractTemplateId, undefined, "Do not edit other locked contracts");
  state.data = JSON.parse(JSON.stringify(saved.at(-1))); open("b");
  assert.equal(c.getPreferredEmployeeContractDocumentTemplate(c.collectContractFormDraft()).id, "general", "Same employee's other contracts after reload");
  assert.equal(c.getPreferredEmployeeContractDocumentTemplate({name: person}).id, "general", "New/duplicated contract inherits employee preference");
  assert.equal(c.getPreferredEmployeeContractDocumentTemplate({name: "Другой сотрудник"}).id, "education", "Unrelated employee stays independent");
  state.data.collections.contracts[0].employeeContractTemplateSelectedAt = "2000-01-01T00:00:00.000Z";
  selected = templates[3];
  await c.openEmployeeContractDocument({});
  assert.equal(choices.at(-1), "general", "Remembered template is preselected, but can be changed");
  assert.equal(c.getPreferredEmployeeContractDocumentTemplate(state.data.collections.contracts[0]).id, "general-no-stamp", "Most recent choice wins across contracts");
  assert.equal(c.getPreferredEmployeeContractDocumentTemplate({name: person}, [templates[0]]).id, "education", "Deleted templates fall back to available default");
  assert.equal(c.getPreferredEmployeeContractDocumentTemplate({name: person}, []), null);
  const anonymous = {employeeContractTemplateId: "general", employeeContractTemplateSelectedAt: "2999-01-01"};
  state.data.collections.contracts.push(anonymous);
  assert.equal(c.getPreferredEmployeeContractDocumentTemplate({name: ""}).id, "education", "Empty names never match other cards");
  const persisted = saved.length;
  open("a"); state.modal.readOnly = true;
  assert.equal(c.rememberEmployeeContractDocumentTemplate(c.collectContractFormDraft(), templates[0]), false);
  assert.equal(saved.length, persisted, "Read-only cards cannot be written");
  open("a"); switchCard = true;
  const generatedBefore = generated.length;
  await c.openEmployeeContractDocument({});
  assert.equal(saved.length, persisted); assert.equal(generated.length, generatedBefore, "Do not continue after navigating away");
  switchCard = false; state.modal = {config: "contracts", id: "", draft: {name: "Новый сотрудник", note: "Черновик"}};
  selected = templates[2]; valid = false;
  await c.openEmployeeContractDocument({});
  assert.equal(state.modal.draft.employeeContractTemplateId, "education-no-stamp", "Confirmed choice retained even when required fields are missing");
  assert.equal(state.modal.hasDraftChanges, true); assert.equal(saved.length, persisted, "New card is not created implicitly");
  assert.equal(state.modal.draft.note, "Черновик");
  const record = state.data.collections.contracts[1];
  const patch = server.normalizeSharedApplicationStatePatch({collections: {contracts: {upserts: [record]}}});
  const normalized = server.normalizeSharedApplicationData({collections: {contracts: [record]}, dictionaries: {}});
  for (const copy of [patch.collections.contracts.upserts[0], normalized.collections.contracts[0]]) {
    assert.equal(copy.employeeContractTemplateId, record.employeeContractTemplateId);
    assert.equal(copy.employeeContractTemplateSelectedAt, record.employeeContractTemplateSelectedAt);
  }
  assert.match(source, /getPreferredEmployeeContractDocumentTemplate\(collectContractFormDraft\(\)\)/, "Context menu follows remembered template");
  console.log("PASS: per-employee last template, cross-contract/reload/shared-state persistence, replacement/defaults, cancel/navigation/readonly/new cards, draft/payment isolation");
}
main().catch(error => {console.error(error);process.exitCode = 1;});
