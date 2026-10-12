"use strict";
const assert = require("node:assert/strict");
const {
  hashStudentDatabaseCriticalSnapshot,
  buildStudentDatabaseSynchronizedChanges,
  resolveStudentDatabaseCompleteReconciliation,
  validateStudentDatabaseReconciliationSelectionsAgainstOutput
} = require("../app-server.js");

function data(values) {
  return {
    students: [{ id: "test-student", uid: "test-1", name: "Test student" }],
    contracts: [{ id: "test-contract-43", section: "ДЕЙСТВУЮЩИЕ ДОГОВОРА", name: "Test", contractNo: "43", ...values }]
  };
}
function verifyEqual(before, after, context) {
  assert.equal(hashStudentDatabaseCriticalSnapshot(before), hashStudentDatabaseCriticalSnapshot(after), context);
  assert.equal(buildStudentDatabaseSynchronizedChanges(before, after).totalCount, 0, context);
  assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(before, after, {}), context);
}
function verifyMismatch(before, after, context) {
  assert.notEqual(hashStudentDatabaseCriticalSnapshot(before), hashStudentDatabaseCriticalSnapshot(after), context);
  assert.ok(buildStudentDatabaseSynchronizedChanges(before, after).totalCount > 0, context);
  assert.throws(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(before, after, {}), { code: "STUDENT_DATABASE_RECONCILIATION_OUTPUT_MISMATCH" }, context);
}

// UI inputs return strings; numeric Excel cells return numbers. Never parse IDs as numbers.
for (const [field, value] of Object.entries({
  couponId: 3745, coupon: 12345, contractNo: 43, inn: 123456789012,
  bic: 123456789, identityDocument: 1234567890, identityDepartmentCode: 123456,
  educationNumber: 12345, settlementAccount: 12345, correspondentAccount: 67890,
  courtCertificateNo: 456, phone: 79830000000
})) {
  const text = data({ [field]: String(value) });
  const numeric = data({ [field]: value });
  verifyEqual(text, numeric, `${field}: text to Excel number`);
  verifyEqual(numeric, text, `${field}: Excel number to text`);
}
verifyEqual(data({ couponId: "0" }), data({ couponId: 0 }), "Zero is an explicit value");
verifyEqual(data({ couponId: " 3745 " }), data({ couponId: 3745 }), "Outer whitespace is already ignored");
verifyEqual(data({ couponId: null }), data({}), "Missing values remain empty");
verifyMismatch(data({ couponId: "3745" }), data({ couponId: 4590 }), "Changed ID must be rejected");
verifyMismatch(data({ couponId: "0" }), data({ couponId: "" }), "Zero must not become blank");
verifyMismatch(data({ couponId: "003745" }), data({ couponId: 3745 }), "Leading zeros must not be discarded");
verifyMismatch(data({ couponId: "9007199254740993" }), data({ couponId: 9007199254740992 }), "Rounded identifiers must be rejected");
verifyMismatch(data({ bic: "012345678" }), data({ bic: 12345678 }), "Leading zeros of payment details are significant");
verifyMismatch(data({ settlementAccount: "12345678901234567890" }), data({ settlementAccount: 12345678901234567890 }), "Long account numbers must not lose precision");

const selection = { verificationSelections: [{
  definitionKey: "contracts", recordId: "test-contract-43", fieldName: "couponId",
  expectedValue: "3745", rejectedValue: "4590", exact: true
}] };
assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(data({ couponId: "3745" }), data({ couponId: 3745 }), selection));
assert.throws(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(data({ couponId: "3745" }), data({ couponId: 4590 }), selection), { code: "STUDENT_DATABASE_RECONCILIATION_OUTPUT_MISMATCH" });

const webData = data({ couponId: "3745" });
const excelData = data({ couponId: 4590 });
const initial = resolveStudentDatabaseCompleteReconciliation({ webData, excelData });
assert.equal(initial.conflicts.length, 1);
assert.equal(initial.conflicts[0].fieldName, "couponId");
for (const choice of ["web", "excel"]) {
  const resolved = resolveStudentDatabaseCompleteReconciliation({
    webData, excelData, conflictResolutions: { [initial.conflicts[0].id]: choice }
  });
  assert.deepEqual(resolved.conflicts, []);
  const output = structuredClone(resolved.collections);
  output.contracts[0].couponId = choice === "web" ? 3745 : "4590";
  assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(resolved.collections, output, resolved), `Explicit ${choice} choice survives a cell type change`);
  output.contracts[0].couponId = choice === "web" ? 4590 : "3745";
  assert.throws(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(resolved.collections, output, resolved), { code: "STUDENT_DATABASE_RECONCILIATION_OUTPUT_MISMATCH" }, "Keeping the rejected ID must fail");
}

verifyEqual(data({ amount: "12,50", accountingRecorded: "Да", notificationEmail: "Нет" }), data({ amount: 12.5, accountingRecorded: true, notificationEmail: false }), "Amounts and booleans retain their dedicated normalization");
assert.notEqual(hashStudentDatabaseCriticalSnapshot(data({ amount: "12,50" })), hashStudentDatabaseCriticalSnapshot(data({ amount: 13 })), "Changed amounts must remain visible");
console.log("PASS contract text values: numeric/text equivalence, exact selections, empty/zero distinction, leading zeros, precision and genuine mismatches");
