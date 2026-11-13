"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.resolve(__dirname, "..", "app.js");
const source = fs.readFileSync(appPath, "utf8");
const start = source.indexOf("  function duplicateEmployeePaymentAccountingRow(event) {");
const end = source.indexOf("  function removeEmployeePaymentSourceRecord(", start);
assert.ok(start >= 0 && end > start, "Обработчик дублирования выплаты сотрудника не найден.");

const block = source.slice(start, end);
assert.match(block, /date:\s*todayIso\(\)/u);

const commitIndex = block.indexOf("commitEmployeePaymentAccountingChange(");
const noticeIndex = block.indexOf("showDocumentGenerationNotice(");
assert.ok(commitIndex >= 0, "После дублирования выплата не сохраняется.");
assert.ok(noticeIndex > commitIndex, "Уведомление должно показываться только после успешного сохранения дубликата.");
assert.match(block, /\$\{sourceType === "general" \? "Общий" : "Прямой"\} расход продублирован/u);
assert.match(block, /Текущая дата:\s*\$\{formatContractDate\(duplicate\.date\)\}/u);

console.log("Employee payment duplicate notice checks passed.");
