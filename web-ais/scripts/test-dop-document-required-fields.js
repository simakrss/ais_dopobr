"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf("\n  }", start);
  assert.ok(start >= 0 && end > start, `Missing ${name}`);
  return source.slice(start, end + 4);
}
const programs = new Map([
  ["DOP fixture", { type: "ДОП", hours: 72 }],
  ["KPK fixture", { type: "КПК", hours: 72 }]
]);
const alerts = [], focus = [], checks = [];
const context = vm.createContext({
  findProgramByName: name => programs.get(name),
  formatStudentGradeSheetDisciplines: () => "Test curriculum",
  formatEducationDocumentTrainingPlan: () => "Test curriculum",
  alert: message => alerts.push(message),
  focusStudentDocumentField: key => focus.push(key),
  showStudentDocumentDataCheckDialog: (_record, _template, missing) => checks.push(Array.from(missing, field => field.key))
});
vm.runInContext([
  "normalizeEducationProgramType", "getStudentProgramTypeCode", "getStudentProgramHours",
  "getStudentDocumentRequiredFields", "getMissingStudentDocumentFields",
  "formatStudentDocumentMissingFields", "validateStudentDocumentRequiredFields", "checkStudentDocumentData"
].map(extract).join("\n"), context);

const priorEducation = ["educationDocument", "educationDocumentNumber", "educationDocumentDate", "educationDocumentIssuer"];
const passport = ["passportType", "passportDate", "passportNumber", "passportIssuer"];
const fixture = Object.freeze({
  name: "Тестовый слушатель", program: "DOP fixture", educationType: "КПК", studyForm: "Заочная",
  employmentCategory: "Работающий", registrationAddress: "Тестовый адрес", mailingAddress: "Тестовый почтовый адрес",
  phone: "+70000000000", email: "fixture@example.invalid", birthDate: "1990-01-01", citizenship: "Россия",
  passportType: "Паспорт", passportDate: "2010-01-01", passportNumber: "0000 000000", passportIssuer: "Тестовый орган",
  fundingSource: "Собственные средства", contractAmount: 1000, contractNo: "TEST", contractDate: "2026-10-09",
  startDate: "2026-10-09", endDate: "2026-10-10"
});
const keys = (kind, record = fixture, type = "") => Array.from(context.getStudentDocumentRequiredFields(kind, record, type), field => field.key);
const missing = (kind, record = fixture, type = "") => Array.from(context.getMissingStudentDocumentFields(record, {documentKind: kind}, type), field => field.key);

for (const kind of ["application", "contract"]) {
  const template = { documentKind: kind, title: kind === "contract" ? "Заявление и договор" : "Заявление" };
  assert.deepEqual(missing(kind), [], `${kind}: DOP should not require prior education credentials`);
  assert.ok(priorEducation.every(key => !keys(kind).includes(key)));
  assert.ok(passport.every(key => keys(kind).includes(key)), "Passport requirements remain");
  assert.equal(context.validateStudentDocumentRequiredFields(fixture, template), true);
  assert.equal(context.checkStudentDocumentData(fixture, template), true);
  assert.deepEqual(checks.at(-1), [], "Manual data check uses the same requirements");
  for (const key of passport) {
    assert.deepEqual(missing(kind, { ...fixture, [key]: "" }), [key]);
    assert.equal(context.validateStudentDocumentRequiredFields({ ...fixture, [key]: "" }, template), false);
    assert.equal(focus.at(-1), key);
  }
  assert.deepEqual(missing(kind, { ...fixture, phone: "" }), ["phone"], "Other personal/contact fields remain required");
  for (const type of ["ДОП", " доп ", "Дополнительная общеобразовательная программа"]) {
    assert.deepEqual(missing(kind, { ...fixture, program: "Unregistered fixture", educationType: type, hours: 72 }), []);
    assert.deepEqual(missing(kind, { ...fixture, program: "KPK fixture" }, type), [], "Explicit type remains authoritative");
  }
  for (const type of ["КПК", "ППП", "ПРО", "", "UNKNOWN"]) {
    const record = { ...fixture, program: "Unregistered fixture", educationType: type, hours: 72 };
    assert.deepEqual(missing(kind, record), priorEducation, `Existing requirements must remain for ${type || "unknown"}`);
  }
  assert.deepEqual(missing(kind, { ...fixture, program: "KPK fixture", educationType: "ДОП" }), priorEducation,
    "The selected program's real type overrides a stale type in the student's record");
  const existing = { ...fixture, educationDocument: "Диплом", educationDocumentNumber: "TEST-123", educationDocumentDate: "2020-01-01", educationDocumentIssuer: "Тестовый вуз" };
  const before = JSON.stringify(existing);
  assert.deepEqual(missing(kind, existing), []);
  assert.equal(JSON.stringify(existing), before, "Optional education data must not be erased or changed");
}
assert.deepEqual(missing("contract", { ...fixture, contractAmount: 0 }), ["contractAmount"]);
assert.deepEqual(missing("contract", { ...fixture, contractNo: "" }), ["contractNo"]);
assert.ok(keys("education", fixture, "ДОП").includes("diplomaIssueDate"), "Issued certificate requirements remain");
assert.ok(keys("education", fixture, "КПК").includes("finalGrade"));
assert.ok(keys("education", fixture, "ППП").includes("qualification"));
assert.equal(alerts.length, 8, "Only missing passport test cases should block validation");
console.log("PASS: DOP application/contract without prior education, passport/contact requirements, other types, manual checks and data preservation");
