"use strict";
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
const c = vm.createContext({
  state: { data: { dictionaries: { paymentSettings: [] } } },
  EMPLOYEE_PAYMENT_ACT_STATUS_WITHOUT: "Без акта",
  getEmployeePartnerPaymentRows: () => [],
  formatOrdersSdoDate: (date) => date.toISOString().slice(0, 10),
  normalizeContractRecord: (record) => ({ ...record })
});
vm.runInContext([
  "getMoscowCalendarDateKey", "normalizeContractCalendarDateKey", "isStudentPastTrainingEndDate",
  "isChecked", "normalizeEmployeeActPersonName", "directExpenseIdentity", "buildLegacyRecordId",
  "ensureDirectExpenseId", "attachDirectExpensesToStudentRecords", "getDirectExpenseEntriesFromCollections",
  "hasManualEmployeePaymentRecommendation", "normalizeEmployeePaymentDateInput",
  "normalizeEmployeePaymentActStatus", "isEmployeePaymentCompletedActStatus", "isEmployeePaymentSettled",
  "applyAutomaticEmployeePaymentRecommendationsForCollections", "getEmployeePaymentAccounting",
  "refreshContractPaymentAccountingForCollections", "getEmployeeActVariablePaymentRows"
].map(extract).join("\n"), c);

const today = "2026-10-13";
for (const endDate of ["2026-10-12", "12.10.2026", "2026-10-12T23:59:59", " 12.10.2026 "]) {
  assert.equal(c.isStudentPastTrainingEndDate({ endDate }, today), true, endDate);
}
for (const endDate of ["2026-10-13", "13.10.2026", "2026-10-14", "", null, undefined,
  "неизвестно", "2026-02-30", "31.09.2026", "2026-13-01", "2026-00-10"]) {
  assert.equal(c.isStudentPastTrainingEndDate({ endDate }, today), false, String(endDate));
}
assert.equal(c.isStudentPastTrainingEndDate({ endDate: today, expulsionDate: "2026-01-01", status: "Отчисленные" }, today), false);
assert.equal(c.isStudentPastTrainingEndDate({ endDate: "2026-10-12", status: "Учится" }, today), true);
assert.equal(c.isStudentPastTrainingEndDate({ endDate: "2026-10-12" }, "bad-date"), false);
assert.equal(c.isStudentPastTrainingEndDate({ endDate: "2024-02-29" }, "2024-03-01"), true);
assert.equal(c.isStudentPastTrainingEndDate({ endDate: "2025-02-29" }, "2025-03-01"), false);
const beforeMidnight = c.getMoscowCalendarDateKey(new Date("2026-10-12T20:59:59.999Z"));
const afterMidnight = c.getMoscowCalendarDateKey(new Date("2026-10-12T21:00:00.000Z"));
assert.equal(c.isStudentPastTrainingEndDate({ endDate: "2026-10-12" }, beforeMidnight), false);
assert.equal(c.isStudentPastTrainingEndDate({ endDate: "2026-10-12" }, afterMidnight), true);

const employee = { id: "employee", name: "Тестовый Сотрудник", amount: 999 };
let seq = 0;
function student(endDate, expense = {}, fields = {}) {
  const id = String(++seq);
  return { id, uid: id, name: `Слушатель ${id}`, program: "Курс", endDate, ...fields,
    directExpenses: [{ id: `expense-${id}`, note: employee.name, amount: 350, ...expense }] };
}
const finished = student("2026-10-12");
const sameDay = student(today, { recommendation: "+" });
const future = student("2026-10-14", { recommendation: "+" });
const missing = student("", { recommendation: "+" });
const invalid = student("2026-02-30", { recommendation: "+" });
const manualTrue = student("2026-10-14", { recommendation: "+", recommendationManual: true });
const manualFalse = student("2026-10-12", { recommendation: "", recommendationManual: "Да" });
const paid = student("2026-10-14", { recommendation: "+", paid: "2026-10-01" });
const received = student("2026-10-14", { recommendation: "+", actStatus: "Получен" });
const withoutAct = student("2026-10-14", { recommendation: "+", actStatus: "Без акта" });
const legacyPaid = student("2026-10-14", { recommendation: "+", isPaid: "Да" });
const otherPayee = student("2026-10-12", { note: "Не сотрудник", recommendation: "" });
const unlinked = { id: "unlinked", note: employee.name, amount: 75, recommendation: "" };
const general = { id: "general", counterparty: employee.name, amount: 100, recommendation: "" };
const data = { contracts: [employee], generalExpenses: [general], directExpenses: [unlinked],
  students: [finished, sameDay, future, missing, invalid, manualTrue, manualFalse, paid, received, withoutAct, legacyPaid, otherPayee] };
const preserved = JSON.stringify({ students: data.students.slice(5), unlinked, general });
assert.equal(c.applyAutomaticEmployeePaymentRecommendationsForCollections(data, today), 5);
assert.equal(finished.directExpenses[0].recommendation, "+");
for (const item of [sameDay, future, missing, invalid]) assert.equal(item.directExpenses[0].recommendation, "");
assert.equal(JSON.stringify({ students: data.students.slice(5), unlinked, general }), preserved,
  "Manual, settled, other-payee, unlinked and general expenses must not be changed");
assert.equal(c.applyAutomaticEmployeePaymentRecommendationsForCollections(data, today), 0, "Idempotent recalculation");
finished.endDate = "2026-11-01";
assert.equal(c.applyAutomaticEmployeePaymentRecommendationsForCollections(data, today), 1);
assert.equal(finished.directExpenses[0].recommendation, "", "Postponing completion clears only the automatic recommendation");
assert.equal(c.applyAutomaticEmployeePaymentRecommendationsForCollections(data, "2026-10-14"), 1);
assert.equal(sameDay.directExpenses[0].recommendation, "+", "Recommendation becomes available the following day");
assert.equal(future.directExpenses[0].recommendation, "", "End-date equality is never eligible");

// The import path attaches global XLSB expenses by UID before recalculating.
const importedStudent = student("2026-10-12");
importedStudent.directExpenses = [];
const importedExpense = { id: "imported", uid: importedStudent.uid, note: employee.name, amount: 90 };
const partition = c.attachDirectExpensesToStudentRecords([importedStudent], [importedExpense]);
assert.equal(c.applyAutomaticEmployeePaymentRecommendationsForCollections({ contracts: [employee],
  students: [importedStudent], directExpenses: partition.unlinkedDirectExpenses }, today), 1);
assert.equal(importedExpense.recommendation, "+");

// Use the live default day for the same refresh/save path as production.
const liveToday = c.getMoscowCalendarDateKey();
const now = new Date(`${liveToday}T12:00:00Z`);
now.setUTCDate(now.getUTCDate() - 1);
const yesterday = now.toISOString().slice(0, 10);
const eligible = student(yesterday, { recommendation: "" });
const pending = student(liveToday, { recommendation: "+" });
const accountingData = { contracts: [{ ...employee }], students: [eligible, pending], directExpenses: [], generalExpenses: [] };
c.refreshContractPaymentAccountingForCollections(accountingData);
assert.equal(accountingData.contracts[0].amount, 350);
assert.equal(accountingData.contracts[0].balance, 350, "Accrual remains outstanding until eligible");
const rows = c.getEmployeeActVariablePaymentRows(employee, accountingData);
assert.equal(rows.length, 1);
assert.equal(rows[0].rowKey, `direct:${eligible.directExpenses[0].id}`);
assert.equal(c.getEmployeePaymentAccounting(employee, accountingData, [], new Set([`direct:${pending.directExpenses[0].id}`])).amount, 0);
assert.equal(c.getEmployeePaymentAccounting(employee, accountingData, [], new Set([`direct:${eligible.directExpenses[0].id}`])).amount, 350);
pending.endDate = yesterday;
c.refreshContractPaymentAccountingForCollections(accountingData);
assert.equal(accountingData.contracts[0].amount, 700);
assert.equal(accountingData.contracts[0].balance, 0);
console.log("Payment recommendation training end: OK (strict calendar dates, Moscow midnight, imports, manual/paid preservation, date changes, totals, selection and act rows)");
