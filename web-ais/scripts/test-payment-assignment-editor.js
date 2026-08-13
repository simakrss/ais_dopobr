"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.resolve(__dirname, "..", "app.js");
const source = fs.readFileSync(appPath, "utf8");
const start = source.indexOf("  function renderAutomaticExpenseRulesEditor(");
const end = source.indexOf("  function renderPaymentConstantRow(", start);
assert.ok(start >= 0 && end > start, "Не найден блок редактора правил назначения");

const block = source.slice(start, end);
const settings = [
  { marker: "АвторскаяСтавка", label: "Авторская ставка", value: "50" },
  { marker: "СтавкаОплатыСотруднику", label: "Ставка сотруднику", value: "500" }
];
const normalizePaymentConstantMarker = (value) => String(value || "")
  .trim()
  .replace(/^\[|\]$/gu, "")
  .replace(/[^A-Za-zА-Яа-яЁё0-9_]/gu, "");
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/gu, "&amp;")
  .replace(/</gu, "&lt;")
  .replace(/>/gu, "&gt;")
  .replace(/"/gu, "&quot;")
  .replace(/'/gu, "&#39;");
const escapeAttr = escapeHtml;
const formatPaymentConstantValue = (setting) => `${setting.value} ₽`;

const factory = new Function(
  "getPaymentConstantSettings",
  "normalizePaymentConstantMarker",
  "formatPaymentConstantValue",
  "escapeHtml",
  "escapeAttr",
  `${block}\nreturn { renderAutomaticExpenseRulesEditorContent };`
);
const { renderAutomaticExpenseRulesEditorContent } = factory(
  () => settings,
  normalizePaymentConstantMarker,
  formatPaymentConstantValue,
  escapeHtml,
  escapeAttr
);

function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&#39;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

const sample = [
  "Оплата преподавателю,[АвторскаяСтавка],-Симак Роман Сергеевич",
  "Оплата сотруднику,[СтавкаОплатыСотруднику]*2,Иванов И.И.;-Петров П.П.",
  "Печать документа об образовании,110,Печатная лавка, Москва",
  "Неизвестное правило,[НетТакойСтавки]"
].join("\n");
const rendered = renderAutomaticExpenseRulesEditorContent(sample);
const productionRules = [
  "Оплата преподавателю,[АвторскаяСтавка],-Симак Роман Сергеевич",
  "Оплата председателю ИАК,[СтавкаОплатыИАК]",
  "Оплата сотруднику,[СтавкаОплатыСотруднику],Симак Варвара Романовна",
  "Оплата сотруднику,[СтавкаОплатыСотруднику],Симак Юрий Романович",
  "Печать документа об образовании,110,Печатная лавка",
  "Почтовое отправление,130,Почта России"
].join("\n");

assert.equal(htmlToText(rendered), sample, "Подсветка изменила исходный текст правил");
assert.match(rendered, /payment-assignment-rule-token is-known/u);
assert.match(rendered, /payment-assignment-rule-token is-unresolved/u);
assert.match(rendered, /payment-assignment-rule-exclusion/u);
assert.match(rendered, /data-template-token="\[АвторскаяСтавка\]"/u);
assert.equal(renderAutomaticExpenseRulesEditorContent(""), "", "Пустой редактор должен показывать placeholder");
assert.match(renderAutomaticExpenseRulesEditorContent("Тип,"), /payment-assignment-rule-line is-invalid/u);
assert.match(renderAutomaticExpenseRulesEditorContent(",100"), /payment-assignment-rule-line is-invalid/u);
assert.equal(
  htmlToText(renderAutomaticExpenseRulesEditorContent(productionRules)),
  productionRules,
  "Штатные правила изменились после подсветки"
);

console.log("Payment assignment editor source round-trip: OK");
