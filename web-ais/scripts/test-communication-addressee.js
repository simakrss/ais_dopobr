"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
function constant(name) {
  const match = source.match(new RegExp(`^  const ${name} = [\\s\\S]*?^  [\\]}];`, "m"));
  assert.ok(match, name);
  return match[0];
}
// Synthetic records only. Exercise real greeting/template generation, with
// unrelated program/link/date lookups stubbed; never open or send messages.
const c = vm.createContext({
  DEFAULT_REPRESENTATIVE_NAME: "Тестовый представитель",
  DEFAULT_CONTACT_EMAIL: "school@example.test",
  DEFAULT_MESSENGER_CONTACT_LINE: "",
  state: { data: { dictionaries: {} } },
  isStudentDpoProgram: () => false,
  getStudentProgramMessageLink: () => "https://example.test/course",
  getStudentCommunicationEndDate: () => "",
  getStudentCommunicationReductionDate: () => "",
  getStudentCommunicationDaysLeft: () => 0,
  getStudentReferralCode: () => "TEST",
  findProgramByName: () => null,
  formatStudentCommunicationDate: () => "",
  formatStudentCommunicationLongDate: () => "",
  formatStudentCommunicationPortalEndDate: () => "",
  syncStudentPortalEndDateLine: message => message
});
vm.runInContext([
  ...["studentCommunicationMessages", "employeeCommunicationMessages", "studentCommunicationTemplateDefaults",
    "employeeCommunicationTemplateDefaults", "studentCommunicationTemplateFieldFormulaDefaults"].map(constant),
  ...["splitFullName", "isChecked", "getStudentCommunicationAddressee", "getStudentCommunicationGreeting",
    "generateStudentCommunicationMessages", "renderStudentCommunicationTemplates", "generateEmployeeCommunicationMessages",
    "buildContractPortalCredentials", "applyStudentCommunicationTemplate", "resolveStudentCommunicationFormulaConditions",
    "isStudentCommunicationFormulaConditionTrue"].map(extract),
  "function normalizeCommunicationTemplates() { return studentCommunicationTemplateDefaults; }",
  "function normalizeEmployeeCommunicationTemplates() { return employeeCommunicationTemplateDefaults; }",
  "function getCommunicationTemplateFieldDefinitions() { return Object.entries(studentCommunicationTemplateFieldFormulaDefaults).map(([name, formula]) => ({name, formula})); }"
].join("\n"), c);

const cases = [
  ["Мария Александровна Почкалова", "Мария", "Мария Александровна"],
  ["Почкалова Мария Александровна", "Мария", "Мария Александровна"],
  ["  Мария\u00a0Александровна\tПокачалова  ", "Мария", "Мария Александровна"],
  ["Анна-Мария Олеговна Иванова-Петрова", "Анна-Мария", "Анна-Мария Олеговна"],
  ["Иванова-Петрова Анна-Мария Олеговна", "Анна-Мария", "Анна-Мария Олеговна"],
  ["Пётр Павлович Иванов", "Пётр", "Пётр Павлович"],
  ["Иванов Пётр Павлович", "Пётр", "Пётр Павлович"],
  ["Пащенко Мария", "Мария", "Мария"],
  ["Ким Никита", "Никита", "Никита"],
  ["", "", ""],
  ["   ", "", ""]
];
let count = 0;
for (const [name, firstName, fullGreeting] of cases) {
  for (const flag of [true, "Да", "+", 1, false, "Нет", "0", ""]) {
    const record = Object.freeze({ name, addressByFirstName: flag });
    const expected = [true, "Да", "+", 1].includes(flag) ? firstName : fullGreeting;
    const greeting = expected ? `Здравствуйте, ${expected}!` : "Здравствуйте!";
    assert.equal(c.getStudentCommunicationAddressee(record), expected, `${name}; ${flag}`);
    assert.equal(c.getStudentCommunicationGreeting(record), greeting);
    assert.equal(c.generateStudentCommunicationMessages(record).note1.split("\n")[0], greeting, "Student message preview");
    assert.equal(c.generateEmployeeCommunicationMessages(record).message1.split("\n")[0], greeting, "Employee message preview");
    assert.equal(record.name, name, "Do not modify the stored name");
    count += 1;
  }
}
const saved = Object.freeze({ name: "Мария Александровна Почкалова", addressByFirstName: false });
const draft = { ...saved, addressByFirstName: "Да" };
assert.ok(c.generateStudentCommunicationMessages(draft).note1.startsWith("Здравствуйте, Мария!"), "Use unsaved checkbox value");
assert.ok(c.generateStudentCommunicationMessages(saved).note1.startsWith("Здравствуйте, Мария Александровна!"), "Keep saved record intact");
console.log(`PASS: ${count} name/checkbox combinations, student and employee templates, empty names and unsaved drafts`);
