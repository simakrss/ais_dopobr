"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
function control(dataset) {
  return {
    dataset, open: false, isConnected: true, events: {},
    addEventListener(type, handler) { this.events[type] = handler; }
  };
}
const expenses = control({ dashboardFinanceSection: "expenses" });
const chart = control({ dashboardFinanceSection: "chart" });
const metric = control({ metric: "direct" });
const defaultExpansion = source.match(/dashboardFinanceExpanded: (\{[^\n]+\})/u);
assert.ok(defaultExpansion);
const state = {
  data: { collections: { students: [{ paidAmount: 1000 }], generalExpenses: [{ amount: 200 }] } },
  dashboardFinanceExpanded: vm.runInNewContext(`(${defaultExpansion[1]})`),
  financeChart: { revenue: true, direct: true, general: true }
};
let lastRender = "";
const context = vm.createContext({
  state,
  document: { querySelectorAll(selector) {
    if (selector === "[data-dashboard-finance-section]") return [expenses, chart];
    if (selector === "[data-action='toggle-finance-metric']") return [metric];
    return [];
  } },
  sumBy: (values, key) => values.reduce((total, item) => total + Number(item[key] || 0), 0),
  getAllDirectExpenses: () => [{ amount: 150 }],
  calculateDashboardStudentProfitSummary: () => ({ profit: 850, averageProfitability: 85 }),
  calculateDashboardStudentReceivable: () => 300,
  buildFinanceSeries: () => [{ key: "2026-10", label: "Октябрь", revenue: 1000, direct: 150, general: 200 }],
  countBy: () => ({}), getOrderedDashboardStudentStatuses: () => [],
  renderAttestationDashboardTile: () => "", renderDeferredStartDashboardTile: () => "",
  getIssuedDocumentRows: () => [], getIssuedDocumentDeadlineDays: () => 30,
  todayIso: () => "2026-10-06", miniTable: () => "", calculateDaysUntilDate: () => 0,
  escapeHtml: String, escapeAttr: String, money: (value) => `${value} ₽`, percent: (value) => `${value}%`,
  render: () => { lastRender = context.renderDashboard(); }
});
const financeMetrics = source.match(/  const financeMetrics = \[[\s\S]*?^  \];/mu);
assert.ok(financeMetrics);
vm.runInContext(financeMetrics[0] + "\n" + [
  "renderDashboard", "bindDashboardFinanceControls", "renderFinanceChart",
  "getActiveFinanceMetrics", "sortFinanceSeries", "financeBar"
].map(extract).join("\n"), context);

function detailsBlock(html, key) {
  const match = html.match(new RegExp(`<details[^>]*data-dashboard-finance-section="${key}"[^>]*>[\\s\\S]*?<\\/details>`));
  assert.ok(match, key);
  return match[0];
}
function isOpen(html, key) {
  return /\sopen(?:\s|>)/u.test(detailsBlock(html, key).split(">")[0] + ">");
}

const initial = context.renderDashboard();
assert.equal(isOpen(initial, "expenses"), false);
assert.equal(isOpen(initial, "chart"), false);
const topSummary = initial.match(/<div class="finance-summary">([\s\S]*?)<\/div>/u)[1];
assert.deepEqual([...topSummary.matchAll(/data-finance-metric="([^"]+)"/gu)].map((match) => match[1]),
  ["revenue", "receivable", "profit"], "Profit immediately follows receivable in the always-visible summary");
assert.match(topSummary, /1000 ₽/u);
assert.match(topSummary, /300 ₽/u);
assert.match(topSummary, /850 ₽/u);
const expenseContent = detailsBlock(initial, "expenses");
assert.match(expenseContent, /<summary>Прямые и общие затраты<\/summary>/u);
assert.deepEqual([...expenseContent.matchAll(/data-finance-metric="([^"]+)"/gu)].map((match) => match[1]), ["direct", "general"]);
assert.match(expenseContent, /150 ₽/u);
assert.match(expenseContent, /200 ₽/u);
assert.ok(initial.indexOf('data-finance-metric="profit"') < initial.indexOf('data-dashboard-finance-section="expenses"'));
assert.ok(initial.indexOf('data-dashboard-finance-section="expenses"') < initial.indexOf('data-dashboard-finance-section="chart"'));
assert.match(detailsBlock(initial, "chart"), /<summary>График<\/summary>/u);
assert.match(detailsBlock(initial, "chart"), /data-action="toggle-finance-metric" data-metric="direct"/u);

context.bindDashboardFinanceControls();
expenses.open = true;
expenses.events.toggle();
assert.equal(isOpen(context.renderDashboard(), "expenses"), true);
assert.equal(isOpen(context.renderDashboard(), "chart"), false, "Sections expand independently");
chart.open = true;
chart.events.toggle();
metric.events.click();
assert.equal(state.financeChart.direct, false);
assert.equal(isOpen(lastRender, "chart"), true, "Changing a metric must keep the chart expanded after rendering");
assert.equal(isOpen(lastRender, "expenses"), true);
assert.match(detailsBlock(lastRender, "chart"), /data-metric="direct"[^>]*aria-pressed="false"/u);
chart.open = false;
chart.events.toggle();
assert.equal(isOpen(context.renderDashboard(), "chart"), false);
chart.isConnected = false;
chart.open = true;
chart.events.toggle();
assert.equal(state.dashboardFinanceExpanded.chart, false, "Queued events from replaced DOM must not overwrite current state");
context.buildFinanceSeries = () => [];
assert.match(detailsBlock(context.renderDashboard(), "chart"), /Нет данных для графика/u);
assert.match(extract("bindEvents"), /bindDashboardFinanceControls\(\)/u);
assert.match(styles, /details > summary\s*\{\s*cursor: pointer;/u);
assert.match(styles, /\.dashboard-finance-details > summary:focus-visible/u);
console.log("Dashboard finance collapse: OK");
