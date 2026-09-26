const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requestedSource = String(process.env.AIS_TEST_APP_SOURCE || "").trim();
const appPath = requestedSource
  ? path.resolve(process.cwd(), requestedSource)
  : path.resolve(__dirname, "..", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

const context = {};
vm.createContext(context);
vm.runInContext(
  `${extractBetween("  const MONEY_INPUT_STEP", "  function synchronizeSettingsDictionariesWithSelectableValues")}
   this.getMoneyInputStepAttribute = getMoneyInputStepAttribute;
   this.synchronizeMoneyInputStepBase = synchronizeMoneyInputStepBase;
   this.bindMoneyInputStepControls = bindMoneyInputStepControls;
   this.MONEY_INPUT_STEP_VALUE = MONEY_INPUT_STEP;`,
  context
);

assert.equal(context.MONEY_INPUT_STEP_VALUE, 50);
[
  ["students", "contractAmount"],
  ["students", "monthlyAmount"],
  ["students", "paidAmount"],
  ["students", "balance"],
  ["students", "expenseTotal"],
  ["contracts", "amount"],
  ["contracts", "paid"],
  ["contracts", "agencyAmount"],
  ["contracts", "balance"],
  ["programs", "price"],
  ["programs", "oldPrice"],
  ["webinars", "payment"],
  ["directExpenses", "amount"],
  ["generalExpenses", "amount"],
  ["inventory", "amount"]
].forEach(([configId, key]) => {
  assert.equal(
    context.getMoneyInputStepAttribute(configId, key),
    'data-money-input step="50"',
    `${configId}.${key} должен изменяться с шагом 50 рублей`
  );
});

[
  ["students", "discount"],
  ["students", "daysUntilEnd"],
  ["students", "hours"],
  ["programs", "hours"],
  ["trainingPlans", "totalHours"],
  ["inventory", "balance"],
  ["documentTemplates", "fieldsCount"],
  ["inventory", "unknown"]
].forEach(([configId, key]) => {
  assert.equal(
    context.getMoneyInputStepAttribute(configId, key),
    "",
    `${configId}.${key} не является денежной суммой`
  );
});

function createFakeMoneyInput(value, nonNegative = false) {
  const listeners = {};
  const attributes = new Map([["value", String(value)]]);
  if (nonNegative) attributes.set("data-money-nonnegative", "");
  return {
    value: String(value),
    dataset: {},
    validationMessage: "",
    listeners,
    setAttribute(name, nextValue) {
      attributes.set(name, String(nextValue));
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    setCustomValidity(message) {
      this.validationMessage = String(message || "");
    },
    addEventListener(name, listener) {
      listeners[name] = listener;
    }
  };
}

const editableLegacyInput = createFakeMoneyInput("290", true);
context.bindMoneyInputStepControls({
  querySelectorAll: () => [editableLegacyInput]
});
assert.equal(editableLegacyInput.dataset.moneyInputBound, "true");
assert.equal(editableLegacyInput.getAttribute("value"), "290");
editableLegacyInput.value = "300";
editableLegacyInput.listeners.input();
assert.equal(
  editableLegacyInput.getAttribute("value"),
  "300",
  "Ручной ввод должен становиться новой базой шага, а не блокироваться старым остатком"
);
assert.equal(editableLegacyInput.validationMessage, "");
editableLegacyInput.value = "0";
editableLegacyInput.listeners.change();
assert.equal(editableLegacyInput.getAttribute("value"), "0");
assert.equal(editableLegacyInput.validationMessage, "");
editableLegacyInput.value = "-50";
editableLegacyInput.listeners.input();
assert.match(editableLegacyInput.validationMessage, /не может быть отрицательной/u);
editableLegacyInput.value = "345.5";
editableLegacyInput.listeners.input();
assert.equal(editableLegacyInput.getAttribute("value"), "345.5");
assert.equal(editableLegacyInput.validationMessage, "");

const genericRenderer = extractBetween("  function renderField", "  function renderStudentModal");
assert.match(genericRenderer, /getMoneyInputStepAttribute\(state\.modal\?\.config, item\.key\)/u);
assert.match(genericRenderer, /moneyStepAttribute[\s\S]*?programExternalLinkAttrs/u);

const studentRenderer = extractBetween("  function renderStudentField", "  function getStudentOrderAdminUrlTemplate");
assert.match(studentRenderer, /getMoneyInputStepAttribute\("students", item\.key\)/u);
assert.match(studentRenderer, /moneyStepAttribute[\s\S]*?calculated-finance-field/u);
assert.match(studentRenderer, /name="\$\{item\.key\}" type="number"[\s\S]*?step="0\.01"/u);

const paymentConstantContext = {
  MONEY_INPUT_STEP: 50,
  getPaymentConstantUnit(setting) {
    return setting?.unit || (setting?.key === "authorRate" ? "%" : "");
  }
};
vm.createContext(paymentConstantContext);
vm.runInContext(
  `${extractBetween("  function getPaymentConstantInputAttributes", "  function formatPaymentConstantValue")}
   this.getPaymentConstantInputAttributes = getPaymentConstantInputAttributes;`,
  paymentConstantContext
);
assert.equal(
  paymentConstantContext.getPaymentConstantInputAttributes({ key: "employeeRate", value: 350 }),
  'data-money-input data-money-nonnegative step="50"'
);
assert.equal(
  paymentConstantContext.getPaymentConstantInputAttributes({ key: "custom", value: 233 }),
  'data-money-input data-money-nonnegative step="50"'
);
assert.equal(
  paymentConstantContext.getPaymentConstantInputAttributes({ key: "authorRate", value: 50 }),
  'min="0" step="10"'
);

[
  /data-employee-payment-field="amount"[^>]*data-money-input[^>]*data-money-nonnegative[^>]*step="\$\{MONEY_INPUT_STEP\}"/u,
  /name="paymentAmount"[^>]*data-money-input[^>]*data-money-nonnegative[^>]*step="\$\{MONEY_INPUT_STEP\}"/u,
  /name="payment\$\{n\}Amount"[^>]*data-money-input[^>]*step="\$\{MONEY_INPUT_STEP\}"/u,
  /name="expense\$\{n\}Amount"[^>]*data-money-input[^>]*step="\$\{MONEY_INPUT_STEP\}"/u,
  /name="directExpense\$\{index\}Amount"[^>]*data-money-input[^>]*step="\$\{MONEY_INPUT_STEP\}"/u,
  /name="studentExpenseEditorAmount"[^>]*data-money-input[^>]*step="\$\{MONEY_INPUT_STEP\}"/u
].forEach((pattern) => assert.match(appSource, pattern));

assert.match(
  appSource,
  /data-payment-constant-field="value"[^>]*\$\{getPaymentConstantInputAttributes\(setting\)\}/u
);
assert.match(
  appSource,
  /name="value"[^>]*\$\{getPaymentConstantInputAttributes\(currentSetting, currentSetting\?\.value \?\? "0"\)\}/u
);
assert.match(appSource, /function bindEvents\(\)[\s\S]*?bindMoneyInputStepControls\(document\)/u);
assert.match(appSource, /openStudentExpenseEditor[\s\S]*?bindMoneyInputStepControls\(document\.querySelector\("\[data-student-expense-editor\]"\)\)/u);
assert.match(appSource, /openEmployeeExpenseEditor[\s\S]*?bindMoneyInputStepControls\(document\.querySelector\("\[data-employee-expense-editor\]"\)\)/u);
assert.match(appSource, /openPaymentConstantEditor[\s\S]*?document\.body\.appendChild\(backdrop\);\s*bindMoneyInputStepControls\(backdrop\)/u);
assert.match(appSource, /name="applicationsMysqlPort" type="number" min="1" max="65535"/u);

console.log("Money input step tests passed.");
