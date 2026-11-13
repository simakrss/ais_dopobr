"use strict";
const assert = require("node:assert/strict");
const {
  hashStudentDatabaseCriticalSnapshot,
  buildStudentDatabaseSynchronizedChanges,
  resolveStudentDatabaseCompleteReconciliation,
  validateStudentDatabaseReconciliationSelectionsAgainstOutput
} = require("../app-server.js");

function data(collection, values) {
  return {
    students: [{ id: "test-student", uid: "test-1", name: "Test student" }],
    [collection]: [{ id: "test-row", section: "Организации", ...values }]
  };
}
function equal(before, after, label) {
  assert.equal(hashStudentDatabaseCriticalSnapshot(before), hashStudentDatabaseCriticalSnapshot(after), label);
  assert.equal(buildStudentDatabaseSynchronizedChanges(before, after).totalCount, 0, label);
  assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(before, after, {}), label);
}
function different(before, after, label) {
  assert.notEqual(hashStudentDatabaseCriticalSnapshot(before), hashStudentDatabaseCriticalSnapshot(after), label);
  assert.ok(buildStudentDatabaseSynchronizedChanges(before, after).totalCount > 0, label);
  assert.throws(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(before, after, {}),
    { code: "STUDENT_DATABASE_RECONCILIATION_OUTPUT_MISMATCH" }, label);
}

const textFields = {
  generalExpenses: ["counterparty", "workType", "description", "bkExpenseNo", "otherExpenses"],
  directExpenses: ["uid", "type", "note", "act", "actStatus", "additionalInfo"],
  inventoryRows: ["uid", "itemType", "note"]
};
for (const [collection, fields] of Object.entries(textFields)) {
  for (const field of fields) {
    const label = `${collection}.${field}`;
    equal(data(collection, { [field]: "75" }), data(collection, { [field]: 75 }), label);
    equal(data(collection, { [field]: 75 }), data(collection, { [field]: "75" }), label);
    equal(data(collection, { [field]: "0" }), data(collection, { [field]: 0 }), label);
    equal(data(collection, { [field]: " 75 " }), data(collection, { [field]: 75 }), label);
    equal(data(collection, { [field]: null }), data(collection, {}), label);
    different(data(collection, { [field]: "75" }), data(collection, { [field]: 76 }), `${label}: changed value`);
    different(data(collection, { [field]: "0" }), data(collection, { [field]: "" }), `${label}: zero vs empty`);
    different(data(collection, { [field]: "0075" }), data(collection, { [field]: 75 }), `${label}: leading zeros`);
    different(data(collection, { [field]: "9007199254740993" }), data(collection, { [field]: 9007199254740992 }), `${label}: precision`);
  }
  equal(data(collection, { amount: "12,50", date: "2026-09-21" }),
    data(collection, { amount: 12.5, date: "21.09.2026" }), `${collection}: dates and amounts`);
}
for (const field of ["inventoryLink", "recommendation"]) {
  equal(data("directExpenses", { [field]: "75" }), data("directExpenses", { [field]: 75 }), `Derived ${field}`);
}
equal(data("generalExpenses", { accountingClosed: "Да" }), data("generalExpenses", { accountingClosed: true }), "Boolean hash and diff agree");
equal(data("generalExpenses", { accountingClosed: "Нет" }), data("generalExpenses", { accountingClosed: false }), "Unchecked boolean");
different(data("generalExpenses", { accountingClosed: true }), data("generalExpenses", { accountingClosed: false }), "Changed checkbox");

const webData = data("generalExpenses", { bkExpenseNo: "75", counterparty: "Test host", date: "2026-09-21" });
const excelData = data("generalExpenses", { bkExpenseNo: 80, counterparty: "Test host", date: "2026-09-21" });
const initial = resolveStudentDatabaseCompleteReconciliation({ webData, excelData });
assert.equal(initial.conflicts.length, 1);
for (const choice of ["web", "excel"]) {
  const resolved = resolveStudentDatabaseCompleteReconciliation({ webData, excelData,
    conflictResolutions: { [initial.conflicts[0].id]: choice } });
  assert.deepEqual(resolved.conflicts, []);
  const output = structuredClone(resolved.collections);
  output.generalExpenses[0].bkExpenseNo = choice === "web" ? 75 : "80";
  assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(resolved.collections, output, resolved));
  output.generalExpenses[0].bkExpenseNo = choice === "web" ? 80 : "75";
  assert.throws(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(resolved.collections, output, resolved),
    { code: "STUDENT_DATABASE_RECONCILIATION_OUTPUT_MISMATCH" });
}
console.log("PASS expense and inventory text values: types, selections, leading zeros, precision, dates, amounts and booleans");
