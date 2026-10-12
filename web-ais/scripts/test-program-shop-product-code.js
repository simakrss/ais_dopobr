"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8").replace(/\r\n?/gu, "\n");
const { sanitizeStudentDatabaseExportPayload } = require("../app-server");

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing source block: ${startMarker}`);
  return source.slice(start, end);
}

const escape = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const context = vm.createContext({
  state: { modal: { config: "programs" } },
  escapeAttr: escape,
  escapeHtml: escape
});
vm.runInContext(between("  function field(", "  const MONEY_INPUT_STEP"), context);
const programConfig = between("    programs: {\n      title: \"Реестр программ\"", "    trainingPlans: {")
  .replace(/^\s*programs:\s*/u, "").replace(/,\s*$/u, "");
context.config = vm.runInContext(`(${programConfig})`, context);
vm.runInContext(between("  function renderField(", "  function renderStudentModal("), context);
const item = context.config.fields.find((field) => field.key === "productId");
assert.ok(item, "The program card exposes the existing productId field");
assert.equal(item.label, "Код товара в магазине");
assert.equal(item.required, false);
assert.equal(item.options?.programTab, undefined, "The field belongs to Основное");
assert.equal(context.config.fields[context.config.fields.indexOf(item) - 1].key, "landingCode");
assert.match(context.renderField(item, { productId: 5112 }), /name="productId"[^>]*value="5112"/u);
assert.match(context.renderField(item, {}), /name="productId"[^>]*value=""/u);
assert.doesNotMatch(context.renderField(item, {}), /readonly|required/u);

// Exercise the actual card serializer and database export with synthetic records only.
const saveBlock = between("  function saveFormRecord(", "\n    if (isStudentCard || isContractCard) {");
const serializeStart = saveBlock.indexOf("    fields.forEach((item) => {");
assert.ok(serializeStart > 0);
for (const input of ["5112", "5160", ""]) {
  context.fields = [item];
  context.formData = new Map([["productId", input]]);
  context.values = {};
  vm.runInContext(saveBlock.slice(serializeStart), context);
  assert.equal(context.values.productId, input, "Saving retains the code; empty stays empty, not zero");
  const exported = sanitizeStudentDatabaseExportPayload({
    students: [{ id: "test-student", uid: "1", name: "Тест" }],
    contracts: [], directExpenses: [], generalExpenses: [],
    programs: [{ id: "test-product-code", name: "Тестовая программа", ...context.values }]
  });
  assert.equal(exported.programColumnMap["Код"], "productId");
  assert.ok(exported.programs[0].providedFields.includes("productId"));
  assert.equal(exported.programs[0].productId, input === "" ? "" : Number(input));
}
context.fields = [item];
context.formData = new Map();
context.values = {};
vm.runInContext(saveBlock.slice(serializeStart), context);
assert.equal(Object.hasOwn(context.values, "productId"), false, "An absent control does not overwrite the code");
console.log("Program shop product code: main-tab field, existing/blank values, save and Excel export — OK");
