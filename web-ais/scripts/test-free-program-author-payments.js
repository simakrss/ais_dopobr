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
  EMPLOYEE_PAYMENT_ACT_STATUS_WITHOUT: "Без акта",
  formatOrdersSdoDate: (date) => date.toISOString().slice(0, 10),
  getPaymentSettingValue: () => rules,
  getPaymentRateMarkerValues: () => ({ АвторскаяСтавка: 50 }),
  normalizePaymentConstantMarker: (value) => String(value).trim(),
  resolveProgramCommissionRecord: (program) => program,
  isFrdoProgramType: (type) => ["КПК", "ППП", "ДОП"].includes(type),
  makeId: () => `expense-${++nextId}`,
  todayIso: () => "2026-10-12",
  findProgramByName: () => { throw new Error("Test must supply the program explicitly"); }
});
const functions = [
  "normalizeOptionalNumber", "normalizeProgramName", "normalizePaymentPercent",
  "parseProgramAuthorPayments", "normalizeProgramAuthorPayments", "parseAutomaticExpenseRules",
  "evaluatePaymentArithmeticExpression", "evaluatePaymentAmountFormula", "getProgramAuthorPaymentPercent",
  "evaluateProgramAuthorPaymentFormula", "extractPaymentRecipientName", "automaticExpenseFingerprint",
  "getProgramAuthorExpenseRule", "buildProgramAuthorExpenseSpecifications", "isAutomaticProgramAuthorExpense",
  "recalculateAutomaticProgramAuthorExpenses", "buildAutomaticStudentExpenses", "addAutomaticStudentExpenses",
  "sumStudentPayments", "sumStudentExpenses",
  "normalizePaymentConstantNumber", "isPaymentConstantNumberValid", "roundAutomaticTeacherPayment",
  "normalizeEmployeePaymentDateInput", "normalizeEmployeePaymentActStatus", "isEmployeePaymentCompletedActStatus",
  "isEmployeePaymentSettled", "isChecked", "normalizeStudentDatabaseFixedValue", "studentDatabaseFixedValuesEqual",
  "applyDirectExpenseFormulaValueOverride", "collectStudentDirectExpenses", "applyStudentExpenseEditorValues"
].map(extract).join("\n");
vm.runInContext(functions, c);

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
assert.ok(paid.record.directExpenses.every((expense) => expense.amount === 200), "390 × 50% rounds up to 200 at the default step of 50");

for (const [amount, step, expected] of [
  [195, 50, 200], [200, 50, 200], [200.01, 50, 250], [0, 50, 0],
  [0.01, 50, 50], [126, 25, 150], [151, 100, 200], [195, 1, 195],
  [0.3, 0.1, 0.3], [1.11, 0.25, 1.25], [195, "25,00", 200]
]) {
  assert.equal(c.roundAutomaticTeacherPayment(amount, [{ key: "paymentRoundingStep", value: step }]), expected);
}
for (const value of [undefined, null, "", "bad", -50, 0, Infinity, 1000001]) {
  assert.equal(c.normalizePaymentConstantNumber("paymentRoundingStep", value), 50);
}
for (const value of [0.01, 0.25, 25, 50, 75, 1000000]) {
  assert.equal(c.isPaymentConstantNumberValid("paymentRoundingStep", value), true);
}
for (const value of [0, -50, 0.001, 1.001, NaN, Infinity, 1000001]) {
  assert.equal(c.isPaymentConstantNumberValid("paymentRoundingStep", value), false);
}
c.state.data.dictionaries = { paymentSettings: [{ key: "paymentRoundingStep", value: 100 }] };
assert.equal(c.evaluateProgramAuthorPaymentFormula("50%", 402), 300, "The saved system step is used for percent payments");
assert.equal(c.evaluateProgramAuthorPaymentFormula("125", 390), 200, "Fixed automatic teacher payments use the same rounding");
delete c.state.data.dictionaries;

// Manual edits must survive both card input and the separate expense editor, JSON storage,
// subsequent payment changes, and clicking Add typical expenses again.
for (const metadata of [{}, { databaseSyncFormulaFields: [] }, { databaseSyncFormulaFields: ["amount", "note"] }]) {
  for (const amount of [195, 152.25, 0]) {
    const originalExpense = { ...paid.record.directExpenses[0], ...metadata, databaseFixedValueOverrides: ["note"] };
    const originalRecord = { ...paid.record, directExpenses: [originalExpense, paid.record.directExpenses[1]] };
    const form = { elements: Object.fromEntries(Object.entries({
      Date: originalExpense.date, Type: originalExpense.type, Amount: String(amount), Note: originalExpense.note
    }).map(([suffix, value]) => [`directExpense0${suffix}`, { value }])) };
    const edits = [
      { ...originalRecord, directExpenses: c.collectStudentDirectExpenses(form, originalRecord) },
      c.applyStudentExpenseEditorValues(originalRecord, { kind: "direct", id: originalExpense.id }, { ...originalExpense, amount })
    ];
    for (const edit of edits) {
      assert.deepEqual(Array.from(edit.directExpenses[0].databaseFixedValueOverrides), ["amount", "note"]);
      const restored = JSON.parse(JSON.stringify(edit));
      const recalculated = c.addAutomaticStudentExpenses({ ...restored, payment1Amount: 810 }, program);
      assert.equal(recalculated.additions.length, 0, "A manual override must not create another automatic expense");
      assert.equal(recalculated.record.directExpenses[0].amount, amount, "The manual amount must not be recalculated");
      assert.equal(recalculated.record.directExpenses[1].amount, 450, "The other author still recalculates and rounds up");
    }
    assert.equal(originalExpense.amount, 200, "Editing must not mutate the stored source record");
  }
}
const unchanged = c.applyDirectExpenseFormulaValueOverride(paid.record.directExpenses[0], { amount: "200" });
assert.equal(unchanged.databaseFixedValueOverrides, undefined, "Collecting unchanged fields must not disable automatic calculations");
const staleRecord = { ...paid.record, directExpenses: [{ ...paid.record.directExpenses[0], amount: 195 }] };
const renderedForm = { elements: {
  directExpense0Date: { value: "2026-11-17" },
  directExpense0Note: { value: "Первый Автор" },
  directExpense0Amount: { value: "200", dataset: { expenseRenderedAmount: "200" } }
} };
const renderedExpenses = c.collectStudentDirectExpenses(renderedForm, staleRecord);
assert.equal(renderedExpenses[0].databaseFixedValueOverrides, undefined, "Displaying 200 for an old 195 expense must not lock it as manual");
assert.equal(c.recalculateAutomaticProgramAuthorExpenses({ ...staleRecord, payment1Amount: 810, directExpenses: renderedExpenses }, program).directExpenses[0].amount, 450);
renderedForm.elements.directExpense0Amount.value = "195";
const revertedExpenses = c.collectStudentDirectExpenses(renderedForm, staleRecord);
assert.deepEqual(Array.from(revertedExpenses[0].databaseFixedValueOverrides), ["amount"], "Typing the old stored amount over the rendered amount is a manual choice");
for (const settled of [{ isPaid: "+" }, { paid: "2026-11-17" }, { actStatus: "Получен" }, { actStatus: "Без акта" }]) {
  const record = { ...paid.record, directExpenses: [{ ...paid.record.directExpenses[0], amount: 195, ...settled }] };
  assert.equal(c.recalculateAutomaticProgramAuthorExpenses(record, program).directExpenses[0].amount, 195, "Settled expense remains unchanged");
}
const sent = { ...paid.record, directExpenses: [{ ...paid.record.directExpenses[0], amount: 195, actStatus: "Отправлен" }] };
assert.equal(c.recalculateAutomaticProgramAuthorExpenses(sent, program).directExpenses[0].amount, 200, "An unpaid sent act still calculates");

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

console.log("Teacher payment rounding, manual overrides, settled expenses, free programs: OK");

if (process.argv.includes("--browser")) {
  runBrowserRegression().catch((error) => { console.error(error); process.exitCode = 1; });
}

async function runBrowserRegression() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage();
    // Use the real field markup and handlers; never connect to a live database in this test.
    const template = source.match(/<input name="directExpense\$\{index\}Amount"[^>]+>/u)?.[0];
    assert.ok(template);
    const markup = new Function("index", "expense", "escapeAttr", "MONEY_INPUT_STEP", `return \`${template}\`;`)(0, { amount: 200 }, String, 50);
    await page.setContent(`<form id="recordForm" data-config="students">${markup}<input type="hidden" name="directExpense0Date" value="2026-11-17"><input type="hidden" name="directExpense0Type" value="Оплата преподавателю"><input type="hidden" name="directExpense0Note" value="Первый Автор"><button>Сохранить</button></form>`);
    const moneyFunctions = ["synchronizeMoneyInputStepBase", "bindMoneyInputStepControls", "syncStudentFinanceFields"].map(extract).join("\n");
    await page.addScriptTag({ content: `${functions}\n${moneyFunctions}\n
      const state = { data: { meta: { defaultAuthorPaymentPercent: 50 } }, modal: { draft: ${JSON.stringify(staleRecord)} } };
      const EMPLOYEE_PAYMENT_ACT_STATUS_WITHOUT = "Без акта";
      const formatOrdersSdoDate = date => date.toISOString().slice(0, 10);
      const getPaymentSettingValue = () => "Оплата преподавателю,[АвторскаяСтавка]";
      const getPaymentRateMarkerValues = () => ({ АвторскаяСтавка: 50 });
      const normalizePaymentConstantMarker = value => String(value).trim();
      const testProgram = ${JSON.stringify(program)};
      const form = document.getElementById("recordForm");
      const amountInput = form.elements.directExpense0Amount;
      const calculateStudentFinance = record => ({ ...recalculateAutomaticProgramAuthorExpenses(record, testProgram), paidAmount: sumStudentPayments(record), balance: 0 });
      const collectStudentFormDraft = () => ({ ...state.modal.draft, directExpenses: collectStudentDirectExpenses(form, state.modal.draft) });
      bindMoneyInputStepControls(form);
      amountInput.addEventListener("input", syncStudentFinanceFields);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const record = JSON.parse(JSON.stringify(state.modal.draft));
        window.savedAmount = recalculateAutomaticProgramAuthorExpenses(record, testProgram).directExpenses[0].amount;
        window.manualOverride = record.directExpenses[0].databaseFixedValueOverrides?.includes("amount") === true;
      });
    ` });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const value of ["152.25", "195", "0"]) {
        await page.locator('[name="directExpense0Amount"]').fill(value);
        assert.equal(await page.locator('[name="directExpense0Amount"]').inputValue(), value);
        assert.equal(await page.locator("form").evaluate(form => form.checkValidity()), true, "Native validation accepts manually entered amounts");
        await page.getByRole("button", { name: "Сохранить" }).click();
        assert.equal(await page.evaluate(() => window.savedAmount), Number(value), "The submitted value survives a save and recalculation");
        assert.equal(await page.evaluate(() => window.manualOverride), true);
      }
      await page.locator('[name="directExpense0Amount"]').fill("");
      await page.locator('[name="directExpense0Amount"]').pressSequentially("152.25");
      assert.equal(await page.locator('[name="directExpense0Amount"]').inputValue(), "152.25", "Typing a decimal amount must not lose the decimal point");
      await page.getByRole("button", { name: "Сохранить" }).click();
      assert.equal(await page.evaluate(() => window.savedAmount), 152.25);
    }
    console.log("Native browser amount input / save (desktop and mobile widths): OK");
  } finally { await browser.close(); }
}
