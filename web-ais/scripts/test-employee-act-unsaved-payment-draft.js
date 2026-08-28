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

const persisted = {
  students: [],
  directExpenses: [{
    id: "direct-1",
    note: "Иванов Иван Иванович",
    amount: 100,
    recommendation: "+",
    additionalInfo: "Сохранённая прямая услуга"
  }],
  generalExpenses: [{
    id: "general-1",
    counterparty: "Иванов Иван Иванович",
    amount: 200,
    workType: "Сохранённая общая услуга"
  }]
};
const draft = {
  students: [],
  directExpenses: [{
    id: "direct-1",
    note: "Иванов Иван Иванович",
    amount: 777,
    recommendation: "+",
    additionalInfo: "Черновая прямая услуга"
  }],
  generalExpenses: [{
    id: "general-1",
    counterparty: "Иванов Иван Иванович",
    amount: 333,
    workType: "Черновая общая услуга",
    date: "2026-08-28"
  }]
};
const accountingCollections = [];

const context = {
  console,
  state: { data: { collections: persisted } },
  getEmployeePaymentCollections: () => draft,
  getAllDirectExpenses: (collections = persisted) => collections.directExpenses || [],
  isEmployeePaymentSettled: (row) => Boolean(row?.paid || row?.actStatus === "Получен"),
  directExpenseIdentity: (expense, index) => expense?.id || String(index),
  formatContractDate: (value) => value === "2026-08-28" ? "28.08.2026" : String(value || ""),
  getEmployeePaymentAccounting: (record, collections = persisted) => {
    accountingCollections.push(collections);
    return {
      directEntries: (collections.directExpenses || []).map((expense) => ({ expense })),
      generalEntries: (collections.generalExpenses || []).map((expense) => ({ expense })),
      partnerStudents: collections === draft ? [{}] : [],
      partnerRows: collections === draft ? [{
        payable: true,
        slot: "due",
        source: { recommendation: true, act: false, amount: 44 },
        calculation: { payableAmount: 44, rate: 10, receiptsTotal: 440 },
        student: { name: "Петров Пётр", program: "Черновая программа" }
      }] : []
    };
  },
  normalizeEmployeePaymentSourceRow: (sourceType, row) => ({ ...row }),
  splitFullName: () => ({ surname: "Иванов", firstName: "Иван", patronymic: "Иванович" }),
  numberToRussianWords: () => "одна тысяча сто пятьдесят четыре рубля",
  formatEmployeeContractShortName: () => "Иванов И.И.",
  formatEmployeeActCurrentDate: (saveFormat) => saveFormat ? "2026.08.28" : "28.08.2026"
};
vm.createContext(context);
vm.runInContext(`
  ${extractFunction("normalizeEmployeeActPersonName")}
  ${extractFunction("formatEmployeeActAmount")}
  ${extractFunction("formatEmployeeActPaymentRows")}
  ${extractFunction("getEmployeeActVariablePaymentRows")}
  ${extractFunction("getEmployeeActPartnerPaymentRows")}
  ${extractFunction("getEmployeeActPaymentSummary")}
  ${extractFunction("prepareEmployeeActDocumentRecord")}
  ${extractFunction("getEmployeeContractDocumentRequiredFields")}
  ${extractFunction("getEmployeeActDocumentRequiredFields")}
  ${extractFunction("getMissingEmployeeActDocumentFields")}
  this.getSummary = getEmployeeActPaymentSummary;
  this.prepareRecord = prepareEmployeeActDocumentRecord;
  this.getEmployeeContractRequiredFields = getEmployeeContractDocumentRequiredFields;
  this.getMissingEmployeeActFields = getMissingEmployeeActDocumentFields;
`, context);

const record = {
  name: "Иванов Иван Иванович",
  contractDate: "2026-08-01",
  contractNo: "15",
  subject: "Оказание услуг",
  email: "employee@example.test"
};
const summary = context.getSummary(record);
assert.equal(summary.variableTotal, 1110);
assert.equal(summary.partnerTotal, 44);
assert.equal(summary.total, 1154);
assert.deepEqual(
  JSON.parse(JSON.stringify(summary.variableRows.map((row) => [row.description, row.amount]))),
  [
    ["Черновая прямая услуга", 777],
    ["Черновая общая услуга (на дату 28.08.2026)", 333]
  ]
);

const generated = context.prepareRecord(record);
assert.equal(generated.employeeActDocumentValues["Сумма"], "1154");
assert.match(generated.employeeActDocumentValues["Переменные выплаты"], /Черновая прямая услуга\t777/u);
assert.match(generated.employeeActDocumentValues["Переменные выплаты"], /Черновая общая услуга \(на дату 28\.08\.2026\)\t333/u);
assert.match(generated.employeeActDocumentValues["Партнерская программа"], /Петров Пётр[\s\S]*\t44/u);
assert.ok(accountingCollections.length >= 4);
assert.ok(accountingCollections.every((collections) => collections === draft), "Все расчёты акта должны использовать черновую коллекцию выплат.");

const recordWithoutContractNumber = { ...record, contractNo: "" };
assert.equal(
  context.getEmployeeContractRequiredFields(recordWithoutContractNumber)
    .some((field) => field.key === "contractNo"),
  false,
  "Номер договора не должен блокировать формирование договора сотрудника."
);
assert.equal(
  context.getMissingEmployeeActFields(recordWithoutContractNumber, draft)
    .some((field) => field.key === "contractNo"),
  false,
  "Номер договора не должен блокировать формирование акта сотрудника."
);
const configsStart = source.indexOf("  const configs = {");
const contractsConfigStart = source.indexOf("    contracts: {", configsStart);
const programsConfigStart = source.indexOf("    programs: {", contractsConfigStart);
assert.ok(configsStart >= 0 && contractsConfigStart >= 0 && programsConfigStart > contractsConfigStart);
const contractsConfigSource = source.slice(contractsConfigStart, programsConfigStart);
assert.match(
  contractsConfigSource,
  /field\("contractNo", "Номер договора"\),/u,
  "Поле номера договора в карточке сотрудника должно быть необязательным."
);

const markSentSource = extractFunction("markEmployeeActPaymentRowsAsSent");
assert.doesNotMatch(markSentSource, /state\.data\.collections/u);
assert.match(markSentSource, /getDirectExpenseEntriesFromCollections\(collections\)/u);
assert.match(markSentSource, /\(collections\.generalExpenses \|\| \[\]\)/u);
assert.match(markSentSource, /getEmployeePaymentAccounting\(record, collections\)/u);

const openDocumentSource = source.slice(
  source.indexOf("  async function openEmployeeActDocument(event) {"),
  source.indexOf("  function isStudentFundedByLegalEntity(", source.indexOf("  async function openEmployeeActDocument(event) {"))
);
assert.match(openDocumentSource, /const collections = getEmployeePaymentCollections\(\);/u);
assert.match(openDocumentSource, /validateEmployeeActDocumentFields\(record, documentTemplate, collections\)/u);
assert.match(openDocumentSource, /prepareEmployeeActDocumentRecord\(record, collections\)/u);
assert.match(openDocumentSource, /markEmployeeActPaymentRowsAsSent\(record, collections\)/u);

console.log("Employee act unsaved payment draft tests passed.");
