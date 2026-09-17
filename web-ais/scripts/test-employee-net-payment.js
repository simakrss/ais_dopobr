"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
const defaults = source.match(/  const paymentSettingDefaults = \[[\s\S]*?^  ];/m)[0];
const c = vm.createContext({ PRIVATE_DEFAULTS: {}, unique: (values) => [...new Set(values)], state: { data: { dictionaries: {} }, tableSettings: {} } });
vm.runInContext(defaults + "\n" + [
  "normalizePaymentRateValue", "normalizePaymentConstantNumber", "isPaymentRateValueValid",
  "isPaymentConstantNumberValid", "normalizePaymentSettings", "normalizePaymentConstantMarker",
  "getEmployeeNetPayment", "getTableKeys", "getTableCellValue", "getPaymentConstantInputAttributes"
].map(extract).join("\n"), c);
assert.equal(c.getEmployeeNetPayment(10000), 8700);
assert.equal(c.getEmployeeNetPayment("100,50"), 87.44);
assert.equal(c.getEmployeeNetPayment(0), 0);
assert.equal(c.getEmployeeNetPayment(-100), -87);
assert.equal(c.getEmployeeNetPayment("invalid"), 0);
for (const [rate, expected] of [[0, 1000], [100, 0], [13, 870], [15.5, 845], ["13,25", 867.5]]) {
  const settings = [{ key: "incomeTaxRate", value: rate }];
  assert.equal(c.getEmployeeNetPayment(1000, settings), expected);
  assert.equal(c.normalizePaymentSettings(settings).find((s) => s.key === "incomeTaxRate").value, String(Number(String(rate).replace(",", "."))));
}
assert.equal(c.normalizePaymentSettings([]).find((s) => s.key === "incomeTaxRate").value, "13");
for (const rate of [-1, 101, NaN, Infinity]) assert.equal(c.isPaymentConstantNumberValid("incomeTaxRate", rate), false);
assert.equal(c.isPaymentConstantNumberValid("incomeTaxRate", 13), true);
assert.equal(c.isPaymentConstantNumberValid("employeeRate", 13), false);
assert.equal(c.isPaymentConstantNumberValid("employeeRate", 350), true);
assert.equal(c.getPaymentConstantInputAttributes({ key: "incomeTaxRate" }), 'min="0" max="100" step="0.01"');
const config = { collection: "contracts", table: ["name", "netAmount", "amount", "paid"] };
c.state.tableSettings.contracts = { order: ["paid", "name", "amount"] };
assert.deepEqual(Array.from(c.getTableKeys(config, "contracts")), ["paid", "name", "netAmount", "amount"]);
c.state.tableSettings.contracts.order = ["netAmount", "paid", "name", "amount"];
assert.deepEqual(Array.from(c.getTableKeys(config, "contracts")), c.state.tableSettings.contracts.order);
const employee = Object.freeze({ amount: 1000, paid: 200 });
assert.equal(c.getTableCellValue(config, employee, "netAmount"), 870);
c.state.data.dictionaries.paymentSettings = [{ key: "incomeTaxRate", value: "20" }];
assert.equal(c.getTableCellValue(config, employee, "netAmount"), 800, "Changing settings immediately recalculates existing rows");
assert.equal(c.getTableCellValue(config, employee, "amount"), 1000, "Gross amount is unchanged");
console.log("Employee net payment: OK");
