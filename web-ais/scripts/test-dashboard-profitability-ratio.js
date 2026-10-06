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
const context = vm.createContext({
  sumStudentPayments: (record) => Number(record.detailedPayments || 0),
  sumStudentExpenses: (record) => Number(record.expenses || 0)
});
vm.runInContext(["sumBy", "calculateDashboardStudentProfit", "calculateDashboardStudentProfitSummary"].map(extract).join("\n"), context);
function check(students, profit, ratio) {
  const snapshot = JSON.stringify(students);
  const result = context.calculateDashboardStudentProfitSummary(students);
  assert.equal(result.profit, profit);
  assert.equal(result.averageProfitability, ratio);
  assert.equal(JSON.stringify(students), snapshot, "Summary must not modify payment data");
}
check([{ paidAmount: 1000, expenses: 200 }], 800, 125);
check([{ paidAmount: 1000, expenses: 200 }, { paidAmount: 9000, expenses: 8000 }], 1800, 555.6);
check([{ paidAmount: 1000, detailedPayments: 1500, expenses: 500 }], 1000, 100);
check([{ paidAmount: 1000, expenses: 1500 }], -500, -200);
check([{ paidAmount: 1000, expenses: 1000 }], 0, null);
check([{ paidAmount: 0, expenses: 200 }], -200, 0);
check([{ paidAmount: "100,50" }], 0, null);
check([{ paidAmount: "100.5", expenses: 20.1 }], 80.4, 125);
check([], 0, null);
console.log("Dashboard profitability: received amount / total profit, aggregate ratio, zero/negative/decimal cases: OK");
