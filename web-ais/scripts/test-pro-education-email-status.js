"use strict";
// In-memory only: no email is sent and no real student or database is changed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
const success = { emailed: true, emailRecipientMode: "student" };
const eventKey = "electronicDocumentSent";
const label = "Отправлен электронный документ об образовании";
function fixture({ modal = true, controls = true, type = "ПРО" } = {}) {
  const students = [
    { id: "a", name: "Тест А", program: type, status: "Учится", additionalStatus: "Вебинары", notes: "Сохранённые данные", eventDeleted: eventKey + ",other", expulsionDate: "2026-10-06" },
    { id: "b", name: "Тест Б", program: "ПРО", status: "На зачисление" }
  ];
  const state = { data: { collections: { students } }, modal: modal ? { config: "students", id: "a", draft: { notes: "Несохранённые правки" } } : null };
  const snapshots = [], audits = [], events = [];
  const select = (value) => ({ tagName: "SELECT", value, options: [], appendChild(option) { this.options.push(option); }, dispatchEvent(event) { events.push(event.type); } });
  const statusControl = select("Учится"), additionalControl = select("Вебинары");
  const form = { dataset: { id: "a" }, elements: controls ? { status: statusControl, additionalStatus: additionalControl } : {} };
  const templates = [{ key: eventKey, label }, { key: "educationDocMaketSent", label: "Отправлен макет" }];
  const c = vm.createContext({
    state, configs: { students: { title: "Слушатели" } }, studentEventTemplates: templates,
    PRO_STUDENT_ARCHIVE_ADDITIONAL_STATUS: "Вебинары. Архив", PRO_STUDENT_ADDITIONAL_STATUS: "Вебинары",
    STUDENT_LEARNING_ADDITIONAL_STATUS: "Обучающиеся", STUDENT_EXPELLED_ADDITIONAL_STATUS: "Отчисленные",
    findProgramByName: (name) => ({ type: name }),
    getStudentEventTemplates: () => templates,
    normalizeEventTemplateLabel: (value) => value.toLowerCase(), buildMacroEventKey: () => eventKey,
    csvList: (value) => String(value || "").split(",").filter(Boolean), unique: (values) => [...new Set(values)],
    todayIso: () => "2026-10-06", dateRu: () => "06.10.2026",
    getEventAuditSnapshot: (record, key) => ({ value: record[`event_${key}_state`] || "" }),
    addAudit: (...args) => audits.push(args), persist: () => snapshots.push(JSON.parse(JSON.stringify(students))),
    restoreStudentEventCompletionInCard: () => {}, updateStudentEventCompletionInCard: () => {},
    document: { querySelector: () => form, createElement: () => ({}) },
    Event: class { constructor(type) { this.type = type; } }
  });
  vm.runInContext([
    "normalizeEducationProgramType", "getStudentProgramTypeCode", "isStudentExpelledStatus",
    "resolveProStudentAdditionalStatus", "resolveStudentAdditionalStatusAfterMainStatusChange",
    "applyStudentEventCompletion", "ensureStudentEventVisibleForCompletion", "markStudentEventsCompleted",
    "markStudentEducationDocumentEmailSent"
  ].map(extract).join("\n"), c);
  return { c, students, state, form, statusControl, additionalControl, snapshots, audits, events };
}
for (const result of [null, {}, { emailed: false, emailRecipientMode: "student" }, { emailed: null, emailRecipientMode: "student" }, { generated: true }, { generated: true, emailSkipped: true }, { cancelled: true }, { emailed: true }, { emailed: true, emailRecipientMode: "system" }, { emailed: true, emailRecipientMode: "off" }]) {
  const f = fixture(), before = JSON.stringify(f.state);
  assert.equal(f.c.markStudentEducationDocumentEmailSent({ id: "a", program: "ПРО" }, result), 0);
  assert.equal(JSON.stringify(f.state), before, "No change without confirmed student delivery");
  assert.equal(f.snapshots.length, 0); assert.equal(f.audits.length, 0);
}
for (const controls of [true, false]) {
  const f = fixture({ controls });
  assert.equal(f.c.markStudentEducationDocumentEmailSent({ ...f.students[0], notes: "Старый снимок" }, success), 1);
  assert.equal(f.students[0].status, "Отчислен");
  assert.equal(f.students[0].additionalStatus, "Вебинары. Архив");
  assert.equal(f.students[0][`event_${eventKey}_state`], "dated");
  assert.equal(f.students[0][`event_${eventKey}_date`], "2026-10-06");
  assert.equal(f.students[0].eventDeleted, "other");
  assert.equal(f.students[0].notes, "Сохранённые данные");
  assert.equal(f.students[0].expulsionDate, "2026-10-06");
  assert.equal(f.state.modal.draft.notes, "Несохранённые правки");
  assert.equal(f.state.modal.draft.status, "Отчислен");
  assert.equal(f.state.modal.draft.additionalStatus, "Вебинары. Архив");
  assert.equal(f.snapshots.length, 1, "Status and delivery event are persisted together");
  assert.equal(f.snapshots[0][0][`event_${eventKey}_state`], "dated");
  assert.equal(f.snapshots[0][0].status, "Отчислен");
  assert.equal(f.audits.length, 2, "Status changes and event are audited");
  assert.deepEqual(Array.from(f.audits[0][3].changes, (item) => item.field), ["status", "additionalStatus"]);
  if (controls) {
    assert.equal(f.statusControl.value, "Отчислен");
    assert.equal(f.additionalControl.value, "Вебинары. Архив");
    assert.equal(f.statusControl.options.length, 1);
  }
  assert.equal(f.c.markStudentEducationDocumentEmailSent(f.students[0], success), 0, "Repeated completion is idempotent");
  assert.equal(f.snapshots.length, 1);
  f.students[0].status = "Учится";
  assert.equal(f.c.markStudentEducationDocumentEmailSent(f.students[0], success), 1);
  assert.equal(f.snapshots.length, 2, "Persist status even when the event was already marked");
}
for (const type of ["ДОП", "КПК", "ППП"]) {
  const f = fixture({ type });
  f.c.markStudentEducationDocumentEmailSent(f.students[0], success);
  assert.equal(f.students[0].status, "Учится", type + " status is unchanged");
  assert.equal(f.students[0].additionalStatus, "Вебинары");
  assert.equal(f.students[0][`event_${type === "ДОП" ? eventKey : "educationDocMaketSent"}_state`], "dated");
}
const batch = fixture({ modal: false });
batch.c.markStudentEducationDocumentEmailSent(batch.students[0], success);
batch.c.markStudentEducationDocumentEmailSent(batch.students[1], { emailed: false, emailRecipientMode: "student" });
assert.equal(batch.students[0].status, "Отчислен"); assert.equal(batch.students[1].status, "На зачисление");
const otherCard = fixture(); otherCard.state.modal.id = "b"; otherCard.form.dataset.id = "b";
otherCard.c.markStudentEducationDocumentEmailSent(otherCard.students[0], success);
assert.equal(otherCard.state.modal.draft.status, undefined); assert.equal(otherCard.statusControl.value, "Учится");
const deleted = fixture(); const deletedRecord = deleted.students.shift();
assert.equal(deleted.c.markStudentEducationDocumentEmailSent(deletedRecord, success), 0);
assert.equal(deleted.snapshots.length, 0); assert.equal(deleted.state.modal.draft.status, undefined);
const unsaved = fixture(); unsaved.state.modal.id = ""; unsaved.form.dataset.id = "";
unsaved.c.markStudentEducationDocumentEmailSent({ program: "ПРО" }, success);
assert.equal(unsaved.state.modal.draft.status, "Отчислен"); assert.equal(unsaved.state.modal.hasDraftChanges, true);
assert.equal(unsaved.snapshots.length, 0, "New records remain drafts until the card is saved");
const send = extract("downloadStudentDocumentFromTemplate");
const hook = send.indexOf("markStudentEducationDocumentEmailSent(record,");
assert.ok(hook > send.indexOf("emailSent = await sendServerEmail("));
assert.ok(hook < send.indexOf("if (storageRequest.openAfterGeneration)"), "Later file-opening errors do not undo successful delivery");
assert.equal((source.match(/markStudentEducationDocumentEmailSent\(record,/g) || []).length, 2, "Definition and one shared completion hook only");
assert.match(send, /documentTemplate.documentKind === "education" && \(!options.entityType \|\| options.entityType === "students"\)/u);
assert.match(extract("openStudentEducationDocument"), /downloadStudentDocumentFromTemplate\(/u);
assert.match(extract("runStudentBulkDocuments"), /downloadStudentDocumentFromTemplate\(/u);
console.log("PRO education delivery: confirmed student-only status/archive/event, atomic persistence, drafts, audit, idempotency, failed/skipped/system/batch isolation: OK");
