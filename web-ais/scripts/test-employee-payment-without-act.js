"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "app-server.js"), "utf8");
const stylesSource = fs.readFileSync(path.resolve(__dirname, "..", "styles.css"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
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
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Функция ${name} не завершена.`);
}

const context = {
  formatOrdersSdoDate: () => "",
  document: {}
};
vm.createContext(context);
vm.runInContext(`
  const EMPLOYEE_PAYMENT_ACT_STATUS_WITHOUT = "Без акта";
  ${extractFunction(appSource, "normalizeEmployeePaymentActStatus")}
  ${extractFunction(appSource, "isEmployeePaymentWithoutActStatus")}
  ${extractFunction(appSource, "isEmployeePaymentCompletedActStatus")}
  ${extractFunction(appSource, "getEmployeePaymentActCheckboxState")}
  ${extractFunction(appSource, "applyEmployeePaymentActCheckboxState")}
  ${extractFunction(appSource, "getEmployeePaymentActStatusControl")}
  ${extractFunction(appSource, "cycleEmployeePaymentActCheckbox")}
  ${extractFunction(appSource, "normalizeEmployeePaymentDateInput")}
  ${extractFunction(appSource, "isEmployeePaymentSettled")}
  ${extractFunction(appSource, "getEmployeePaymentActFilterValue")}
  ${extractFunction(appSource, "getEmployeePaymentActFilterOptions")}
  ${extractFunction(appSource, "setEmployeePaymentSourceField")}
  this.api = {
    applyEmployeePaymentActCheckboxState,
    cycleEmployeePaymentActCheckbox,
    getEmployeePaymentActFilterOptions,
    getEmployeePaymentActFilterValue,
    isEmployeePaymentSettled,
    setEmployeePaymentSourceField
  };
`, context);

const statusControl = { value: "" };
const container = { querySelector: () => statusControl };
const attributes = {};
const checkbox = {
  checked: false,
  indeterminate: false,
  disabled: false,
  dataset: { employeePaymentActState: "none" },
  setAttribute: (name, value) => { attributes[name] = value; },
  closest(selector) {
    return selector.startsWith("input[") ? this : container;
  }
};
const event = { target: checkbox };
const root = { contains: (element) => element === checkbox };

assert.equal(context.api.cycleEmployeePaymentActCheckbox(event, root), true);
assert.equal(checkbox.dataset.employeePaymentActState, "formed");
assert.equal(checkbox.checked, true);
assert.equal(statusControl.value, "Отправлен");

assert.equal(context.api.cycleEmployeePaymentActCheckbox(event, root), true);
assert.equal(checkbox.dataset.employeePaymentActState, "without");
assert.equal(checkbox.checked, false);
assert.equal(checkbox.indeterminate, true);
assert.equal(attributes["aria-checked"], "mixed");
assert.equal(statusControl.value, "Без акта");

assert.equal(context.api.cycleEmployeePaymentActCheckbox(event, root), true);
assert.equal(checkbox.dataset.employeePaymentActState, "none");
assert.equal(checkbox.indeterminate, false);
assert.equal(statusControl.value, "");

const directExpense = { act: "+", actStatus: "Получен" };
context.api.setEmployeePaymentSourceField("direct", directExpense, "act", {
  checked: false,
  indeterminate: true,
  dataset: { employeePaymentActState: "without" }
});
assert.equal(directExpense.act, "");
assert.equal(directExpense.actStatus, "Без акта");
assert.equal(context.api.isEmployeePaymentSettled(directExpense), true);
assert.equal(context.api.getEmployeePaymentActFilterValue(directExpense), "without");

context.api.setEmployeePaymentSourceField("direct", directExpense, "actStatus", { value: "Отправлен" });
assert.equal(directExpense.act, "+");
context.api.setEmployeePaymentSourceField("direct", directExpense, "actStatus", { value: "Без акта" });
assert.equal(directExpense.act, "");

assert.deepEqual(
  JSON.parse(JSON.stringify(context.api.getEmployeePaymentActFilterOptions())),
  [
    ["", "Все"],
    ["none", "Не сформирован"],
    ["formed", "Сформирован"],
    ["sent", "Отправлен"],
    ["received", "Получен"],
    ["without", "Без акта"]
  ]
);

const serverContext = {
  normalizePartnerDate: (value) => String(value || "").trim(),
  normalizePartnerIdentity: (value) => String(value || "").trim().toLocaleLowerCase("ru-RU")
};
vm.createContext(serverContext);
vm.runInContext(`
  ${extractFunction(serverSource, "isPartnerPaymentSettled")}
  this.isPartnerPaymentSettled = isPartnerPaymentSettled;
`, serverContext);
assert.equal(serverContext.isPartnerPaymentSettled({ actStatus: "Без акта" }), true);
assert.equal(serverContext.isPartnerPaymentSettled({ actStatus: "Отправлен" }), false);

assert.match(appSource, /<option value="without">Без акта<\/option>/u);
assert.match(appSource, /data-employee-payment-act-state=/u);
assert.match(stylesSource, /input\[data-employee-payment-field="act"\]:indeterminate::after/u);

console.log("Employee payment without-act tri-state tests passed.");
