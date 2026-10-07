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
vm.runInContext(["sumBy", "percent", "calculateDashboardStudentProfit", "calculateDashboardStudentProfitSummary"].map(extract).join("\n"), context);
function check(students, profit, ratio) {
  const snapshot = JSON.stringify(students);
  const result = context.calculateDashboardStudentProfitSummary(students);
  assert.equal(result.profit, profit);
  assert.equal(result.averageProfitability, ratio);
  assert.equal(JSON.stringify(students), snapshot, "Summary must not modify payment data");
}
check([{ paidAmount: 1000, expenses: 200 }], 800, 80);
check([{ paidAmount: 1000, expenses: 200 }, { paidAmount: 9000, expenses: 8000 }], 1800, 18);
check([{ paidAmount: 1000, detailedPayments: 1500, expenses: 500 }], 1000, 100);
check([{ paidAmount: 1000, expenses: 1500 }], -500, -50);
check([{ paidAmount: 1000, expenses: 1000 }], 0, 0);
check([{ paidAmount: 0, expenses: 200 }], -200, null);
check([{ paidAmount: "100,50" }], 0, null);
check([{ paidAmount: "100.5", expenses: 20.1 }], 80.4, 80);
check([], 0, null);
check([{ paidAmount: 1495330, expenses: 1495330 - 719953 }], 719953, 48.15);
check([{ paidAmount: 1000, expenses: 1000.001 }], 0, 0);
assert.equal(context.percent(48.15, 2), "48,15%");
assert.equal(context.percent(48.15), "48,2%", "Other percentage displays keep existing precision");
assert.match(source, /title="Прибыль ÷ внесено слушателями × 100%/u);
assert.match(source, /percent\(profitSummary.averageProfitability, 2\)/u);
console.log("Dashboard profitability: total profit / received amount, 48.15% example, aggregate ratio, zero/negative/decimal cases: OK");
