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

let nextId = 0;
let rules = "Оплата преподавателю,[АвторскаяСтавка]";
const c = vm.createContext({
  state: { data: { meta: { defaultAuthorPaymentPercent: 50 } } },
  getPaymentSettingValue: () => rules,
  getPaymentRateMarkerValues: () => ({ АвторскаяСтавка: 50 }),
  normalizePaymentConstantMarker: (value) => String(value).trim(),
  resolveProgramCommissionRecord: (program) => program,
  isFrdoProgramType: (type) => ["КПК", "ППП", "ДОП"].includes(type),
  makeId: () => `expense-${++nextId}`,
  todayIso: () => "2026-10-12",
  findProgramByName: () => { throw new Error("Test must supply the program explicitly"); }
});
vm.runInContext([
  "normalizeOptionalNumber", "normalizeProgramName", "normalizePaymentPercent",
  "parseProgramAuthorPayments", "normalizeProgramAuthorPayments", "parseAutomaticExpenseRules",
  "evaluatePaymentArithmeticExpression", "evaluatePaymentAmountFormula", "getProgramAuthorPaymentPercent",
  "evaluateProgramAuthorPaymentFormula", "extractPaymentRecipientName", "automaticExpenseFingerprint",
  "getProgramAuthorExpenseRule", "buildProgramAuthorExpenseSpecifications", "isAutomaticProgramAuthorExpense",
  "recalculateAutomaticProgramAuthorExpenses", "buildAutomaticStudentExpenses", "addAutomaticStudentExpenses",
  "sumStudentPayments", "sumStudentExpenses"
].map(extract).join("\n"), c);

const program = {
  id: "p", name: "Курс", type: "ПРО", price: 390,
  authorPayments: [
    { id: "a1", recipient: "Первый Автор", amountFormula: "[АвторскаяСтавка]" },
    { id: "a2", recipient: "Второй Автор", amountFormula: "[АвторскаяСтавка]" }
  ]
};
const student = { id: "s", uid: "1", program: program.name, contractAmount: 390, directExpenses: [] };

for (const type of ["ПРО", "КПК", "ППП", "ДОП"]) {
  for (const price of [0, "0", "0.00", "0,00", " 0,00 "]) {
    for (const formula of ["[АвторскаяСтавка]", "25%", "350"]) {
      rules = `Оплата преподавателю,${formula}`;
      // Even stale receipt data or a fixed-price author rule must not create expenses.
      for (const payment1Amount of [0, 390]) {
        const freeProgram = { ...program, type, price };
        const freeStudent = { ...student, contractAmount: 0, payment1Amount };
        const before = JSON.stringify({ freeProgram, freeStudent });
        const result = c.addAutomaticStudentExpenses(freeStudent, freeProgram);
        assert.equal(result.additions.length, 0, `${type}, ${price}, ${formula}`);
        assert.equal(result.record.directExpenses.length, 0);
        assert.equal(c.addAutomaticStudentExpenses(result.record, freeProgram).additions.length, 0);
        assert.equal(JSON.stringify({ freeProgram, freeStudent }), before, "Input records are not mutated");
      }
    }
  }
}

rules = "Оплата преподавателю,[АвторскаяСтавка]";
const unpaid = c.addAutomaticStudentExpenses(student, program);
assert.equal(unpaid.additions.length, 2, "Unpaid paid-course registrations keep their author accruals");
assert.ok(unpaid.additions.every((expense) => expense.amount === 0));
const paid = c.addAutomaticStudentExpenses({ ...unpaid.record, payment1Amount: 390 }, program);
assert.equal(paid.additions.length, 0, "A later payment updates existing accruals without duplicates");
assert.ok(paid.record.directExpenses.every((expense) => expense.amount === 195));

for (const price of [undefined, null, "", " ", "не указана"]) {
  assert.equal(c.buildAutomaticStudentExpenses(student, { ...program, price }).length, 2,
    "An unknown registry price must not be interpreted as explicitly free");
}
rules = "Оплата преподавателю,350";
assert.ok(c.buildAutomaticStudentExpenses(student, program).every((expense) => expense.amount === 350),
  "Fixed-rate payments for paid programs remain unchanged");
assert.equal(c.buildAutomaticStudentExpenses(student, null).length, 0);

const manual = { id: "manual", type: "Оплата преподавателю", amount: 125, note: "Первый Автор" };
const historical = { ...paid.record.directExpenses[0], isPaid: "+", actStatus: "Получен" };
const legacy = { ...paid.record.directExpenses[1] };
delete legacy.automaticPaymentKind;
const previous = { ...student, directExpenses: [manual, historical, legacy] };
const before = JSON.stringify(previous);
const preserved = c.addAutomaticStudentExpenses(previous, { ...program, price: 0 });
assert.equal(preserved.additions.length, 0);
assert.equal(JSON.stringify(preserved.record.directExpenses), JSON.stringify(previous.directExpenses),
  "Existing manual and historical accruals are never silently removed or rewritten");
assert.equal(JSON.stringify(previous), before);

rules = "Оплата преподавателю,350\nПечать,85\nОплата председателю ИАК,100";
const otherExpenses = c.buildAutomaticStudentExpenses(student, {
  ...program, type: "КПК", price: 0, commissionChair: "Председатель Комиссии"
});
assert.deepEqual(Array.from(otherExpenses, (expense) => expense.type), ["Печать", "Оплата председателю ИАК"],
  "Only author compensation is excluded, not unrelated automatic expenses");

console.log("Free program author payments: OK");
