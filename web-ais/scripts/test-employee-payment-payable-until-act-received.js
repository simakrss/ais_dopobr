"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Не найдена функция ${name}.`);
  const bodyStart = source.indexOf(") {", start) + 2;
  assert.ok(bodyStart > start, `Не найдено тело функции ${name}.`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1).replace(/^  /gmu, "");
    }
  }
  throw new Error(`Функция ${name} не завершена.`);
}

const context = {
  state: { data: { dictionaries: { paymentSettings: {} } } },
  normalizeEmployeeActPersonName: (value) => String(value || "").trim().toLocaleLowerCase("ru-RU"),
  getDirectExpenseEntriesFromCollections: (collections) => (
    (collections.directExpenses || []).map((expense) => ({ expense, identity: expense.id }))
  ),
  getEmployeePartnerPaymentRows: (student) => student?.partnerPaymentRows || [],
  normalizeEmployeePaymentSourceRow: (_sourceType, source) => ({ ...source }),
  isEmployeePaymentSettled: (row = {}) => Boolean(
    row.historicalPayment
    || String(row.paid || "").trim()
    || ["Получен", "Без акта"].includes(String(row.actStatus || "").trim())
  )
};
vm.createContext(context);
vm.runInContext(`
  ${extractFunction("getEmployeePaymentAccounting")}
  this.getAccounting = getEmployeePaymentAccounting;
`, context);

const record = { name: "Иванов Иван Иванович" };

function accountingForDirect(overrides = {}) {
  return context.getAccounting(record, {
    students: [],
    generalExpenses: [],
    directExpenses: [{
      id: "direct-1",
      note: record.name,
      amount: 100,
      recommendation: "+",
      ...overrides
    }]
  });
}

[
  {},
  { act: "+" },
  { act: "+", actStatus: "Отправлен" }
].forEach((values) => {
  const accounting = accountingForDirect(values);
  assert.equal(accounting.amount, 100, "Неоплаченная строка должна оставаться в сумме к выплате.");
  assert.equal(accounting.paid, 100);
  assert.equal(accounting.balance, 0);
});

assert.equal(accountingForDirect({ act: "+", actStatus: "Получен" }).amount, 0);
assert.equal(accountingForDirect({ act: "", actStatus: "Без акта" }).amount, 0);
assert.equal(accountingForDirect({ act: "+", actStatus: "Отправлен", paid: "2026-08-28" }).amount, 0);

const generalAccounting = context.getAccounting(record, {
  students: [],
  directExpenses: [],
  generalExpenses: [{
    id: "general-1",
    counterparty: record.name,
    amount: 250,
    act: "+",
    actStatus: "Отправлен"
  }]
});
assert.equal(generalAccounting.amount, 250);
assert.equal(generalAccounting.balance, 0);

function accountingForPartner(overrides = {}) {
  const source = {
    amount: 75,
    recommendation: true,
    act: true,
    actStatus: "Отправлен",
    ...overrides
  };
  return context.getAccounting(record, {
    directExpenses: [],
    generalExpenses: [],
    students: [{
      agent: record.name,
      partnerPaymentRows: [{
        affectsAccounting: true,
        source,
        amount: 75,
        calculation: { payableAmount: 75 }
      }]
    }]
  });
}

assert.equal(accountingForPartner().agencyAmount, 75);
assert.equal(accountingForPartner({ actStatus: "Получен" }).agencyAmount, 0);
assert.equal(accountingForPartner({ act: false, actStatus: "Без акта" }).agencyAmount, 0);
assert.equal(accountingForPartner({ paid: "2026-08-28" }).agencyAmount, 0);

const accountingSource = extractFunction("getEmployeePaymentAccounting");
assert.doesNotMatch(accountingSource, /!String\(expense\?\.act/u);
assert.doesNotMatch(accountingSource, /isEmployeePaymentSettled\(expense\) \|\| String\(expense\?\.act/u);

console.log("Employee payment payable-until-received tests passed.");
