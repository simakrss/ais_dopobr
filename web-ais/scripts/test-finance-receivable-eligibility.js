"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n?/gu, "\n");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8").replace(/\r\n?/gu, "\n");
const helperStart = appSource.indexOf("  function isStudentEligibleForReceivable");
const helperEnd = appSource.indexOf("\n\n  function calculateDashboardStudentProfit", helperStart);

assert.ok(helperStart >= 0 && helperEnd > helperStart, "Не найдена логика отбора дебиторской задолженности");

const factory = new Function(
  "hasStudentEducationDocumentIssued",
  "sumStudentPayments",
  `${appSource.slice(helperStart, helperEnd)}\nreturn { isStudentEligibleForReceivable, calculateDashboardStudentReceivable };`
);
const hasStudentEducationDocumentIssued = (record = {}) => Boolean(
  String(record.diplomaBlankNo || "").trim()
  || String(record.registrationNo || "").trim()
);
const sumStudentPayments = (record = {}) => Number(record.detailedPayments || 0);
const { isStudentEligibleForReceivable, calculateDashboardStudentReceivable } = factory(
  hasStudentEducationDocumentIssued,
  sumStudentPayments
);

const debtRecord = {
  status: "Учится",
  enrollmentDate: "2026-01-10",
  contractAmount: 10000,
  paidAmount: 2500
};

assert.equal(calculateDashboardStudentReceivable(debtRecord), 7500, "Обучающийся должен учитываться без документа");
assert.equal(
  calculateDashboardStudentReceivable({ ...debtRecord, status: "Отчислен", diplomaBlankNo: "123456" }),
  7500,
  "Завершившийся слушатель с номером бланка должен учитываться"
);
assert.equal(
  calculateDashboardStudentReceivable({ ...debtRecord, status: "Архив", registrationNo: "77" }),
  7500,
  "Архивный слушатель с регистрационным номером должен учитываться"
);
assert.equal(
  calculateDashboardStudentReceivable({ ...debtRecord, status: "Отчислен" }),
  0,
  "Отчисленный без выданного документа не должен учитываться"
);
assert.equal(
  calculateDashboardStudentReceivable({ ...debtRecord, status: "В работе", diplomaBlankNo: "123456" }),
  0,
  "Незавершённый статус не должен учитываться даже при ошибочно заполненном номере"
);
assert.equal(
  calculateDashboardStudentReceivable({ ...debtRecord, status: "Без выдачи документа", registrationNo: "77" }),
  0,
  "Статус без выдачи документа не должен учитываться"
);
assert.equal(
  calculateDashboardStudentReceivable({ ...debtRecord, status: "Учится", detailedPayments: 4000 }),
  6000,
  "Детализированные оплаты должны сохранять приоритет"
);
assert.equal(isStudentEligibleForReceivable({ status: " учится " }), true, "Статус должен нормализоваться");

assert.match(appSource, /students\.reduce\(\(sum, student\) => sum \+ calculateDashboardStudentReceivable\(student\)/u);
assert.match(appSource, /getFinanceReceivableRows\(\)[\s\S]*calculateDashboardStudentReceivable\(student\)/u);

assert.match(appSource, /<td data-label="Слушатель \/ контрагент">/u);
assert.match(stylesSource, /\.finance-details-table-wrap\s*\{[\s\S]{0,120}overflow-x:\s*hidden;/u);
assert.match(stylesSource, /\.finance-details-table\s*\{[\s\S]{0,160}table-layout:\s*fixed;/u);
assert.doesNotMatch(stylesSource, /\.finance-details-table\s*\{[^}]*min-width:\s*1120px;/u);
assert.match(
  stylesSource,
  /@media \(max-width: 720px\)[\s\S]*\.finance-details-table td::before\s*\{[\s\S]{0,100}content:\s*attr\(data-label\);/u
);

console.log("finance receivable eligibility tests: OK");
