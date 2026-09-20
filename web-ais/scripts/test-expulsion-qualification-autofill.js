const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8")
  .replace(/\r\n?/gu, "\n");

function block(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source block: ${start}`);
  return source.slice(from, to);
}

// Run the actual validation, value generation and both application branches together.
const implementation = [
  block("  function getStudentProgramTypeCode(", "\n\n  function autoFillEducationDocument("),
  block("  function getStudentEducationDocumentIssueFields(", "\n\n  function formatExpulsionOrderStudentListItem("),
  block("  function getStudentEducationDocumentSequenceRecords(", "\n\n  async function openStudentEnrollmentOrderDocument(")
].join("\n");

const baseRecord = {
  id: "student-1",
  name: "Тестовый слушатель",
  program: "Тестовая программа",
  expulsionDate: "2026-09-20"
};
const readyFields = {
  diplomaBlankNo: "0000000042",
  registrationNo: "42/26-ПП",
  diplomaIssueDate: "2026-09-20",
  protocolNo: "7"
};

function harness(record = {}, options = {}) {
  const stored = { ...baseRecord, ...record };
  const program = {
    name: stored.program,
    type: options.type || "ППП",
    qualification: "  Специалист по информационным системам  ",
    ...options.program
  };
  const calls = { written: [], focused: [], alerts: [], audits: [], persisted: 0 };
  const formValues = { ...stored };
  const form = {
    elements: Object.fromEntries([
      ...Object.keys(readyFields), "qualification"
    ].map((key) => [key, { focus() { calls.focused.push(key); } }]))
  };
  const context = {
    state: { data: { collections: { students: [stored] } }, modal: { draft: { ...stored } } },
    configs: { students: { title: "Слушатели" } },
    findProgramByName: (name) => name === program.name ? program : null,
    normalizeEducationProgramType: (value) => String(value || ""),
    parseOrdersSdoDate: (value) => value === baseRecord.expulsionDate ? new Date(2026, 8, 20) : null,
    getEducationRegistrationTypeCode: () => "ПП",
    getGeneratedNumberFromDataFormula: () => ({ value: "1/26-ПП" }),
    isFrdoProgramType: (type) => ["КПК", "ППП"].includes(type),
    getEducationDocumentAutofillContext: () => ({
      form, record: { ...formValues }, program, programType: program.type,
      issueDate: formValues.expulsionDate
    }),
    collectStudentFormDraft: () => ({ ...formValues }),
    setOrdersSdoFieldValue(target, key, value) {
      assert.equal(target, form);
      calls.written.push(key);
      formValues[key] = value;
    },
    formatStudentDocumentMissingFields: (fields) => fields.map((field) => field.label).join(", "),
    focusStudentDocumentField: (key) => calls.focused.push(key),
    alert: (message) => calls.alerts.push(message),
    addAudit: (...args) => calls.audits.push(args),
    persist: () => { calls.persisted += 1; }
  };
  vm.createContext(context);
  vm.runInContext(implementation, context);
  const sequence = context.getStudentEducationDocumentSequenceRecords(stored, stored.id);
  return {
    context, stored, calls, sequence,
    missing: () => Array.from(context.getMissingStudentEducationDocumentIssueFields(stored), (field) => field.key),
    fill: () => context.autoFillStudentExpulsionEducationDocument(
      stored, options.otherStudent ? "another-open-card" : stored.id, sequence
    )
  };
}

for (const otherStudent of [false, true]) {
  for (const fields of [{}, readyFields]) {
    const test = harness(fields, { otherStudent });
    assert.ok(test.missing().includes("qualification"),
      "Qualification in the program must not count as already stored in the student card");
    assert.equal(test.context.hasStudentEducationDocumentIssueData(test.stored), false);
    const result = test.fill();
    assert.equal(result.qualification, "Специалист по информационным системам");
    assert.equal(test.context.hasStudentEducationDocumentIssueData(result), true);
    assert.equal(test.sequence[0].qualification, result.qualification);
    for (const [key, value] of Object.entries(fields)) assert.equal(result[key], value);
    assert.deepEqual(test.calls.alerts, []);
    if (otherStudent) {
      assert.equal(test.stored.qualification, result.qualification);
      assert.equal(test.calls.persisted, 1);
      assert.equal(test.calls.audits[0][3].changes.find((change) => change.field === "qualification").after,
        result.qualification);
      assert.equal(test.context.state.modal.draft.qualification, undefined,
        "Autofilling another student must not change the open card");
    } else {
      assert.equal(test.context.state.modal.draft.qualification, result.qualification);
      assert.equal(test.context.state.modal.hasDraftChanges, true);
      assert.ok(test.calls.written.includes("qualification"));
      assert.equal(test.calls.persisted, 0, "The current card is saved through its normal draft workflow");
    }
  }

  const manual = harness({ qualification: "Квалификация, введённая вручную" }, { otherStudent });
  assert.equal(manual.fill().qualification, "Квалификация, введённая вручную");
  assert.ok(!manual.calls.written.includes("qualification"));
  assert.ok(!manual.calls.audits.some((audit) => audit[3].changes.some((change) => change.field === "qualification")));

  const complete = harness({ ...readyFields, qualification: "Сохранённая квалификация" }, { otherStudent });
  assert.deepEqual(complete.missing(), []);
  assert.equal(complete.fill().qualification, complete.stored.qualification);
  assert.equal(complete.calls.persisted, 0);
  assert.deepEqual(complete.calls.written, []);

  const manualWithoutSource = harness({ qualification: "Собственная квалификация" }, {
    otherStudent, program: { qualification: "" }
  });
  assert.equal(manualWithoutSource.fill().qualification, "Собственная квалификация");
  assert.deepEqual(manualWithoutSource.calls.alerts, []);

  const unavailable = harness(readyFields, { otherStudent, program: { qualification: "  " } });
  assert.equal(unavailable.fill(), null, "Do not silently claim success when the program has no qualification");
  assert.match(unavailable.calls.alerts[0], /Квалификация/u);
  assert.equal(unavailable.calls.persisted, 0);
  if (!otherStudent) assert.ok(unavailable.calls.focused.includes("qualification"));
}

const whitespace = harness({ ...readyFields, qualification: "  " });
assert.deepEqual(whitespace.missing(), ["qualification"]);
assert.equal(whitespace.fill().qualification, "Специалист по информационным системам");

for (const type of ["КПК", "ДОП", "ПРО"]) {
  const test = harness({}, { type });
  assert.ok(!test.missing().includes("qualification"));
  const result = test.fill();
  assert.equal(result.qualification, undefined, `${type}: do not add a qualification requirement`);
  assert.deepEqual(test.calls.alerts, []);
}

console.log("expulsion qualification autofill checks: OK");
