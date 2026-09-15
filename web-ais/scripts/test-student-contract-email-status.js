"use strict";
// In-memory only: never sends email or changes real records.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const block = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
};
const label = "Отправлен пакет готовых документов для подписи";
const status = "На зачисление (документы отправлены)";
const success = {emailed: true, emailRecipientMode: "student"};
function setup({modal = true, control = true} = {}) {
  const students = [{id: "a", name: "Слушатель А", additionalStatus: "Прежний", status: "На зачисление", notes: "Не менять", eventDeleted: "contractDocsSent,other"}, {id: "b", additionalStatus: "Другой"}];
  const state = {data: {collections: {students}}, modal: modal ? {config: "students", id: "a", draft: {notes: "Несохранённый текст"}} : null};
  const audits = [], snapshots = [], controls = [];
  const select = {tagName: "SELECT", value: "Прежний", options: [], appendChild(option) {this.options.push(option);}, dispatchEvent(event) {controls.push(event.type);}};
  const form = {dataset: {id: "a"}, elements: control ? {additionalStatus: select} : {}};
  const context = {
    state, configs: {students: {title: "Слушатели"}}, studentEventTemplates: [{key: "contractDocsSent", label}],
    getStudentEventTemplates: () => [{key: "contractDocsSent", label}],
    csvList: value => String(value || "").split(",").filter(Boolean), unique: values => [...new Set(values)],
    todayIso: () => "2026-09-15", dateRu: () => "15.09.2026",
    getEventAuditSnapshot: record => ({value: record.event_contractDocsSent_state || ""}),
    addAudit: (...args) => audits.push(args), persist: () => snapshots.push(JSON.parse(JSON.stringify(students))),
    restoreStudentEventCompletionInCard: () => {}, updateStudentEventCompletionInCard: () => {},
    Event: class {constructor(type) {this.type = type;}},
    document: {querySelector: () => form, createElement: () => ({})}
  };
  vm.createContext(context);
  for (const [start, end] of [
    ["  function applyStudentEventCompletion(", "  function updateStudentEventCompletionInCard("],
    ["  function ensureStudentEventVisibleForCompletion(", "  function restoreStudentEventCompletionInCard("],
    ["  function markStudentEventsCompleted(", "  function markStudentEducationDocumentEmailSent("],
    ["  function markStudentContractEmailSent(", "  function isExplicitUncheckedEventState("]
  ]) vm.runInContext(block(start, end), context);
  return {context, students, state, audits, snapshots, select, form, controls};
}
for (const result of [null, {}, {emailed: false, emailRecipientMode: "student"}, {emailed: null, emailRecipientMode: "student"}, {emailed: true, emailRecipientMode: "system"}, {emailed: true, emailRecipientMode: "off"}, {emailed: true}]) {
  const test = setup(); const before = JSON.stringify(test.state);
  assert.equal(test.context.markStudentContractEmailSent({id: "a"}, result), 0);
  assert.equal(JSON.stringify(test.state), before, "No mutation without confirmed delivery to student");
  assert.equal(test.snapshots.length, 0); assert.equal(test.audits.length, 0);
}
const test = setup();
assert.equal(test.context.markStudentContractEmailSent({id: "a", notes: "Old snapshot"}, success), 1);
assert.equal(test.students[0].additionalStatus, status);
assert.equal(test.students[0].event_contractDocsSent_state, "dated");
assert.equal(test.students[0].event_contractDocsSent_date, "2026-09-15");
assert.equal(test.students[0].event_contractDocsSent_label, label);
assert.equal(test.students[0].eventDeleted, "other", "Hidden event restored, unrelated event remains hidden");
assert.equal(test.students[0].status, "На зачисление", "Main status unchanged");
assert.equal(test.students[0].notes, "Не менять");
assert.equal(test.students[1].additionalStatus, "Другой");
assert.equal(test.state.modal.draft.notes, "Несохранённый текст");
assert.equal(test.state.modal.draft.additionalStatus, status);
assert.equal(test.state.modal.draft.event_contractDocsSent_state, "dated");
assert.equal(test.select.value, status); assert.equal(test.select.options.length, 1);
assert.equal(test.snapshots.length, 1, "One persist contains status and event together");
assert.equal(test.snapshots[0][0].additionalStatus, status);
assert.equal(test.snapshots[0][0].event_contractDocsSent_state, "dated");
assert.equal(test.audits.length, 2, "Status and completion have separate audit entries");
assert.equal(test.context.markStudentContractEmailSent({id: "a"}, success), 0, "Same-day retry is idempotent");
assert.equal(test.snapshots.length, 1); assert.equal(test.audits.length, 2); assert.equal(test.select.options.length, 1);
test.students[0].additionalStatus = "Изменён вручную";
assert.equal(test.context.markStudentContractEmailSent({id: "a"}, success), 1);
assert.equal(test.snapshots.length, 2, "Status persists even when the event was already marked");
const hiddenTab = setup({control: false}); hiddenTab.context.markStudentContractEmailSent({id: "a"}, success);
assert.equal(hiddenTab.state.modal.draft.additionalStatus, status, "Inactive tab receives updated draft");
const batch = setup({modal: false}); batch.context.markStudentContractEmailSent({id: "a"}, success); batch.context.markStudentContractEmailSent({id: "b"}, {emailed: false, emailRecipientMode: "student"});
assert.equal(batch.students[0].additionalStatus, status); assert.equal(batch.students[1].additionalStatus, "Другой");
const otherCard = setup(); otherCard.state.modal.id = "b"; otherCard.form.dataset.id = "b";
otherCard.context.markStudentContractEmailSent({id: "a"}, success);
assert.equal(otherCard.state.modal.draft.additionalStatus, undefined, "Do not update a card opened while email was sending");
assert.equal(otherCard.select.value, "Прежний");
const deleted = setup(); deleted.students.shift();
assert.equal(deleted.context.markStudentContractEmailSent({id: "a"}, success), 0, "Deleted student is not resurrected");
const unsaved = setup(); unsaved.state.modal.id = ""; unsaved.form.dataset.id = "";
unsaved.context.markStudentContractEmailSent({name: "Новая запись"}, success);
assert.equal(unsaved.state.modal.draft.additionalStatus, status); assert.equal(unsaved.state.modal.draft.event_contractDocsSent_state, "dated");
assert.equal(unsaved.state.modal.hasDraftChanges, true); assert.equal(unsaved.snapshots.length, 0);
const generation = block("  async function downloadStudentDocumentFromTemplate(", "  async function openStudentEducationDocument(");
const hook = generation.indexOf("markStudentContractEmailSent(record,");
assert.ok(hook > generation.indexOf("emailSent = await sendServerEmail("), "Completion follows confirmed email response");
assert.ok(hook < generation.indexOf("if (storageRequest.openAfterGeneration)"), "Later file-opening errors cannot lose successful delivery completion");
assert.match(generation, /documentTemplate.documentKind === "contract" && \(!options.entityType \|\| options.entityType === "students"\)/);
assert.match(block("  async function openStudentContractDocument(", "  function evaluateContractTemplateFields("), /downloadStudentDocumentFromTemplate\(/);
assert.match(block("  async function runStudentBulkDocuments(", "  async function runStudentBulkOperation("), /downloadStudentDocumentFromTemplate\(/);
console.log("PASS: confirmed student-only contract delivery, persisted status/event/date, card and hidden-tab drafts, retries, failed/system/batch isolation, deleted records, audit and shared send hook");
