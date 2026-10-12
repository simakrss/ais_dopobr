"use strict";

// Synthetic card state only: no real records, database writes or document generation.
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

const dateKeys = ["startDate", "endDate", "expulsionDate", "diplomaIssueDate"];
const documentKeys = ["diplomaBlankNo", "registrationNo", "diplomaIssueDate", "frdoDate", "protocolNo", "qualification"];
function fixture(type = "ПРО", dates = {}, datesVisible = false) {
  const original = Object.freeze({
    id: "synthetic-student", name: "Тестовый слушатель", program: "Тестовый семинар",
    ...Object.fromEntries(dateKeys.map((key) => [key, ""])), ...dates,
    notes: "Сохранённое примечание", finalGrade: "", status: "На зачисление",
    enrollmentDate: "", login: "existing-login", contractNo: "existing-contract"
  });
  const program = { name: original.program, type, hours: 1, qualification: "Тестовая квалификация" };
  const state = {
    studentCardTab: "results",
    data: { collections: { students: [original] } },
    modal: { draft: { notes: "Несохранённое примечание", retained: "Оставить" }, hasDraftChanges: false }
  };
  const alerts = [], events = [], numberRequests = [];
  class Input {
    constructor(key, value) { this.name = key; this.value = value || ""; }
    dispatchEvent(event) { events.push([this.name, event.type]); }
    focus() { this.focused = true; }
  }
  const form = { dataset: { config: "students", id: original.id }, elements: {}, querySelector: () => null };
  function mount(keys) {
    const current = { ...original, ...state.modal.draft };
    form.elements = Object.fromEntries(keys.map((key) => [key, new Input(key, current[key])]));
  }
  mount([...documentKeys, ...(datesVisible ? dateKeys : [])]);
  class FormData {
    constructor() { this.entries = Object.entries(form.elements).map(([key, input]) => [key, input.value]); }
    has(key) { return this.entries.some(([name]) => name === key); }
    get(key) { return this.entries.find(([name]) => name === key)?.[1] ?? null; }
    forEach(callback) { this.entries.forEach(([key, value]) => callback(value, key)); }
  }
  let today = "2026-10-06";
  const context = vm.createContext({
    state, FormData, HTMLInputElement: Input, HTMLTextAreaElement: Input, HTMLSelectElement: Input,
    Event: class { constructor(type) { this.type = type; } },
    document: { getElementById: () => form },
    studentAllFields: [...new Set([...Object.keys(original), ...documentKeys])].map((key) => ({ key })),
    findProgramByName: (name) => name === program.name ? program : null,
    todayIso: () => today,
    alert: (message) => alerts.push(message),
    focusStudentDocumentField: () => {},
    isFrdoProgramType: (value) => ["КПК", "ППП"].includes(value),
    getEducationRegistrationTypeCode: (value) => value,
    getGeneratedNumberFromDataFormula: (name, date, id, options) => {
      numberRequests.push({ name, date, id, options });
      return { value: "1/26-" + options.programTypeCode };
    },
    normalizePreferredMessenger: (value) => value || "",
    normalizePersonPhotoCardPath: (value) => value || "",
    collectStudentDirectExpenses: (_form, values) => values.directExpenses || [],
    clearUnchangedGeneratedCommunicationMessages: () => {},
    getNextUid: () => "synthetic-uid",
    calculateStudentFinance: (values) => values,
    formatStudentGradeSheetDisciplines: () => "",
    formatEducationDocumentTrainingPlan: () => "Учебный план"
  });
  vm.runInContext([
    "normalizeEducationProgramType", "parseOrdersSdoDate", "getStudentProgramTypeCode",
    "getNextEducationBlankNumber", "getNextEducationProtocolNo", "getStudentProgramHours",
    "collectStudentFormDraft", "getEducationDocumentAutofillContext", "getEducationDocumentAutofillValues",
    "setOrdersSdoFieldValue", "autoFillEducationDocument", "getStudentDocumentRequiredFields"
  ].map(extract).join("\n"), context);
  return { context, original, program, state, form, alerts, events, numberRequests, mount,
    setToday(value) { today = value; } };
}

for (const datesVisible of [false, true]) {
  for (const previous of ["", "invalid", "2025-12-31"]) {
    const f = fixture("ПРО", Object.fromEntries(dateKeys.map((key) => [key, previous])), datesVisible);
    const result = f.context.autoFillEducationDocument();
    assert.ok(result);
    assert.deepEqual(f.alerts, []);
    assert.equal(f.state.studentCardTab, "results");
    for (const key of dateKeys) {
      assert.equal(result[key], "2026-10-06", key);
      assert.equal(f.state.modal.draft[key], "2026-10-06", key);
      assert.equal(f.original[key], previous, "Autofill must not write directly to the saved record");
      if (f.form.elements[key]) assert.equal(f.form.elements[key].value, "2026-10-06");
    }
    assert.equal(result.diplomaBlankNo, "0000000001");
    assert.equal(result.registrationNo, "1/26-ПРО");
    assert.equal(f.numberRequests[0].date.getFullYear(), 2026);
    assert.equal(f.numberRequests[0].date.getMonth(), 9);
    assert.equal(f.numberRequests[0].date.getDate(), 6);
    assert.equal(f.state.modal.draft.hours, 1);
    assert.equal(f.state.modal.draft.educationType, "ПРО");
    assert.equal(f.state.modal.draft.notes, "Несохранённое примечание");
    assert.equal(f.state.modal.draft.retained, "Оставить");
    for (const key of ["finalGrade", "status", "enrollmentDate", "login", "contractNo"]) {
      assert.equal(f.state.modal.draft[key], f.original[key], key + " must not be invented or overwritten");
    }
    assert.equal(f.state.modal.hasDraftChanges, true);
    assert.ok(f.form.elements.diplomaBlankNo.focused);
    assert.ok(f.events.some(([key, event]) => key === "registrationNo" && event === "change"));
    // Simulate opening the other tab and collecting the actual save draft.
    f.mount(["startDate", "endDate", "expulsionDate"]);
    const saveDraft = f.context.collectStudentFormDraft();
    for (const key of dateKeys) assert.equal(saveDraft[key], "2026-10-06");
    const missing = f.context.getStudentDocumentRequiredFields("education", saveDraft, "ПРО")
      .filter((field) => !String(field.value ?? saveDraft[field.key] ?? "").trim());
    assert.equal(missing.length, 0, "All required ПРО certificate fields are filled");
    f.setToday("2026-10-07");
    f.context.autoFillEducationDocument();
    for (const key of dateKeys) assert.equal(f.state.modal.draft[key], "2026-10-07", "Date is resolved on each click");
  }
}

// Explicit dates used by expulsion-order and bulk workflows must remain unchanged.
const explicit = fixture("ПРО", { expulsionDate: "2026-09-20" });
assert.equal(explicit.context.getEducationDocumentAutofillContext().issueDate, "2026-09-20");
assert.equal(explicit.context.getEducationDocumentAutofillValues(explicit.original).diplomaIssueDate, "2026-09-20");
assert.equal(explicit.context.getEducationDocumentAutofillValues(explicit.original, { issueDate: "2026-09-21" }).diplomaIssueDate, "2026-09-21");

for (const type of ["КПК", "ППП", "ДОП"]) {
  const f = fixture(type, { startDate: "2026-08-01", endDate: "2026-09-20", expulsionDate: "2026-09-21" });
  assert.equal(f.context.autoFillEducationDocument().diplomaIssueDate, "2026-09-21");
  for (const key of ["startDate", "endDate", "expulsionDate"]) assert.equal(f.state.modal.draft[key], f.original[key]);
  const missingDate = fixture(type);
  assert.equal(missingDate.context.autoFillEducationDocument(), null);
  assert.equal(missingDate.alerts.length, 1);
  assert.equal(missingDate.state.modal.hasDraftChanges, false);
}

for (const invalidProgram of ["missing", "empty-type"]) {
  const f = fixture();
  if (invalidProgram === "missing") f.state.modal.draft.program = "Несуществующая программа";
  else f.program.type = "";
  const before = JSON.stringify(f.state.modal);
  assert.equal(f.context.autoFillEducationDocument(), null);
  assert.equal(JSON.stringify(f.state.modal), before);
  assert.equal(f.alerts.length, 1);
}

console.log("PRO education document autofill tests passed.");
