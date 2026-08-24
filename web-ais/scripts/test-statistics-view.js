"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8").replace(/\r\n/g, "\n");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

assert.match(appSource, /version: "1\.7\.253"/u);
assert.match(appSource, /\{ id: "statistics", label: "Статистика"/u);
const navigationBlock = sourceBlock(appSource, "const navItems = [", "const PROGRAM_LIST_FIELD_KEYS");
const navigationIds = [...navigationBlock.matchAll(/\{ id: "([^"]+)"/gu)].map((match) => match[1]);
assert.deepEqual(navigationIds.slice(0, 2), ["dashboard", "statistics"]);
assert.match(appSource, /NAV_ITEM_ORDER_LAYOUT_VERSION = "statistics-after-dashboard"/u);
assert.match(appSource, /dashboardIndex >= 0 \? dashboardIndex \+ 1 : 0/u);
assert.match(appSource, /state\.view === "statistics"\) return renderStatistics\(\)/u);
assert.match(appSource, /getOrderedTabs\("statistics", statisticsTabs\)/u);
assert.match(appSource, /data-orderable-tabs="statistics"/u);
assert.match(appSource, /Интерактивная статистика/u);
assert.match(appSource, /Доходы и затраты по месяцам, тыс\. руб\./u);
assert.match(appSource, /label: "Рентабельность"/u);
assert.match(appSource, /₽\/чел\./u);
assert.match(appSource, /Общие расходы не учитываются/u);
assert.match(appSource, /open-statistics-profitability-details/u);
assert.match(appSource, /Рентабельность по образовательным программам/u);
assert.match(appSource, /Суммарные доходы/u);
assert.match(appSource, /sort-statistics-income-programs/u);
assert.match(appSource, /renderStatisticsInstallDownloadChart/u);
assert.match(appSource, /renderStatisticsLocationChart/u);
assert.match(appSource, /sortStatisticsMonthSeries/u);
assert.match(appSource, /Популярные действия/u);
assert.match(appSource, /Экспорт CSV/u);

assert.doesNotMatch(appSource, /POWER_BI_ASSISTANT_SNAPSHOT/u);
assert.match(appSource, /fetch\(photoApiUrl\("\/api\/statistics\/assistant"\)/u);
assert.match(appSource, /обновляемые MySQL-запросы модели Power BI/u);

const sortStatisticsMonthSeriesBlock = sourceBlock(
  appSource,
  "function sortStatisticsMonthSeries(",
  "function buildStatisticsMonthlySeries("
);
const sortStatisticsMonthSeries = new Function(
  `${sortStatisticsMonthSeriesBlock}\nreturn sortStatisticsMonthSeries;`
)();
assert.deepEqual(
  sortStatisticsMonthSeries([
    { key: "2026-06" },
    { key: "2026-08" },
    { key: "2026-07" }
  ], 2).map((row) => row.key),
  ["2026-08", "2026-07"]
);

const renderStatisticsInstallDownloadChartBlock = sourceBlock(
  appSource,
  "function renderStatisticsInstallDownloadChart(",
  "function compactStatisticsItems("
);
const renderStatisticsInstallDownloadChart = new Function(`
  const state = { statistics: { filters: { year: "2026" } } };
  const escapeHtml = (value) => String(value ?? "");
  const escapeAttr = escapeHtml;
  const formatStatisticsInteger = (value) => String(Number(value) || 0);
  const statisticsMonthLabel = (key) => key;
  ${sortStatisticsMonthSeriesBlock}
  ${renderStatisticsInstallDownloadChartBlock}
  return renderStatisticsInstallDownloadChart;
`)();
const comparisonChart = renderStatisticsInstallDownloadChart([
  { key: "2026-07", label: "Июль", installs: 2, downloads: 1 },
  { key: "2026-08", label: "Август", installs: 5, downloads: 3 }
], [
  { key: "installs", label: "Установки", tone: "teal", total: 7 },
  { key: "downloads", label: "Скачивания", tone: "blue", total: 4 }
]);
assert.match(comparisonChart, /statistics-comparison-totals/u);
assert.ok(comparisonChart.indexOf("Август") < comparisonChart.indexOf("Июль"));
assert.match(comparisonChart, />7<\/strong>/u);
assert.match(comparisonChart, />4<\/strong>/u);
assert.match(comparisonChart, /<small>5<\/small>[\s\S]*<i class="tone-teal"/u);
assert.match(comparisonChart, /<small>3<\/small>[\s\S]*<i class="tone-blue"/u);
assert.doesNotMatch(comparisonChart, /<em>/u);

const renderStatisticsSeriesChartBlock = sourceBlock(
  appSource,
  "function renderStatisticsSeriesChart(",
  "function renderStatisticsInstallDownloadChart("
);
const renderStatisticsSeriesChart = new Function(`
  const escapeHtml = (value) => String(value ?? "");
  const escapeAttr = escapeHtml;
  const formatStatisticsInteger = (value) => String(Math.round(Number(value) || 0));
  const money = (value) => String(value);
  const statisticsMonthLabel = (key) => key;
  ${renderStatisticsSeriesChartBlock}
  return renderStatisticsSeriesChart;
`)();
const financeChart = renderStatisticsSeriesChart([
  { key: "2026-08", label: "Август", income: 125000 }
], [
  { key: "income", label: "Доходы", tone: "teal" }
], { money: true });
assert.match(financeChart, /<small>125<\/small>/u);
assert.doesNotMatch(financeChart, /т\.р\./u);
assert.match(financeChart, /--statistics-bar-height:100%/u);
assert.match(financeChart, /statistics-chart-bar-area[\s\S]*<small>125<\/small>[\s\S]*<i/u);

const studentProfitabilityBlock = sourceBlock(
  appSource,
  "function getStatisticsStudentRowKey(",
  "function buildStatisticsIncomeReport("
);
const calculateStatisticsStudentProfitability = new Function(
  `${studentProfitabilityBlock}\nreturn calculateStatisticsStudentProfitability;`
)();
assert.equal(calculateStatisticsStudentProfitability([
  { studentId: "1", amount: 100000 },
  { studentId: "2", amount: 50000 }
], [
  { studentId: "1", amount: 40000 },
  { studentId: "2", amount: 70000 }
]), 20000);
assert.equal(calculateStatisticsStudentProfitability([
  { studentId: "1", amount: 100000 }
], [
  { studentId: "", studentUid: "", amount: 90000 }
]), 100000);
assert.equal(calculateStatisticsStudentProfitability([], [
  { studentUid: "student-3", amount: 1200 }
]), null);
assert.equal(calculateStatisticsStudentProfitability([], []), null);
assert.equal(calculateStatisticsStudentProfitability([
  { studentId: "1", amount: 100 }
], [
  { studentId: "1", amount: 66.6 }
]), 33);
const programProfitabilityBlock = sourceBlock(
  appSource,
  "function buildStatisticsProgramProfitabilityRows(",
  "function buildStatisticsIncomeReport("
);
const buildStatisticsProgramProfitabilityRows = new Function(`
  ${studentProfitabilityBlock.split("function buildStatisticsProgramProfitabilityRows(")[0]}
  ${programProfitabilityBlock}
  return buildStatisticsProgramProfitabilityRows;
`)();
assert.deepEqual(buildStatisticsProgramProfitabilityRows([
  { id: "income-1", studentId: "1", program: "Программа А", amount: 100000 },
  { id: "income-2", studentId: "2", program: "Программа А", amount: 50000 },
  { id: "income-3", studentId: "3", program: "Программа Б", amount: 90000 }
], [
  { studentId: "1", program: "Программа А", amount: 40000 },
  { studentId: "2", program: "Программа А", amount: 70000 },
  { studentId: "3", program: "Программа Б", amount: 10000 },
  { studentId: "", program: "Программа А", amount: 999999 }
]), [
  { program: "Программа А", students: 2, income: 150000, expenses: 110000, profit: 40000, profitability: 20000, profitabilityPercent: 26.7 },
  { program: "Программа Б", students: 1, income: 90000, expenses: 10000, profit: 80000, profitability: 80000, profitabilityPercent: 88.9 }
]);
const incomeReportBlock = sourceBlock(appSource, "function buildStatisticsIncomeReport(", "function renderStatisticsIncome(");
assert.match(incomeReportBlock, /calculateStatisticsStudentProfitability\(income, directExpenses\)/u);
assert.doesNotMatch(incomeReportBlock, /calculateStatisticsStudentProfitability\([^)]*generalExpenses/u);
assert.match(incomeReportBlock, /buildStatisticsProgramProfitabilityRows\(income, directExpenses\)/u);
const programSortBlock = sourceBlock(
  appSource,
  "function sortStatisticsProgramRows(",
  "function getSortedStatisticsIncomeProgramRows("
);
const sortStatisticsProgramRows = new Function(`${programSortBlock}\nreturn sortStatisticsProgramRows;`)();
const sortablePrograms = [
  { program: "Бета", students: 3, income: 90000 },
  { program: "Альфа", students: 2, income: 120000 },
  { program: "Гамма", students: 1, income: 120000 }
];
assert.deepEqual(
  sortStatisticsProgramRows(sortablePrograms, { key: "income", dir: "desc" }, [
    { key: "program" }, { key: "students", numeric: true }, { key: "income", numeric: true }
  ]).map((row) => row.program),
  ["Альфа", "Гамма", "Бета"]
);
assert.deepEqual(
  sortStatisticsProgramRows(sortablePrograms, { key: "program", dir: "asc" }, [{ key: "program" }])
    .map((row) => row.program),
  ["Альфа", "Бета", "Гамма"]
);

const normalizeAssistantStatisticsBlock = sourceBlock(
  serverSource,
  "function normalizeAssistantStatisticsRows(",
  "async function readAssistantStatistics()"
);
const normalizeAssistantStatisticsRows = new Function(
  `${normalizeAssistantStatisticsBlock}\nreturn normalizeAssistantStatisticsRows;`
)();
const normalizedAssistantStatistics = normalizeAssistantStatisticsRows(
  [
    { event_year: 2026, event_month: 7, install_count: "4", removal_count: "1", first_at: "2026-07-01 10:00:00", last_at: "2026-07-31 10:00:00" },
    { event_year: 2026, event_month: 8, install_count: "3", removal_count: "2", first_at: "2026-08-01 10:00:00", last_at: "2026-08-20 10:00:00" }
  ],
  [
    { event_year: 2026, event_month: 8, version_name: "2.90", event_count: "3" }
  ],
  [
    { action_id: 1, action_name: "Обновление полей", action_count: "12" }
  ],
  [
    { event_year: 2026, event_month: 8, location_name: "Омск", install_count: "5", removal_count: "2" }
  ],
  [
    {
      id: "3962",
      event_year: 2026,
      event_month: 7,
      event_day: 19,
      event_at: "2026-07-19 10:00:00",
      location_name: "Санкт-Петербург",
      organization_name: "ВИ(ИТ)",
      email_address: "user@example.ru",
      version_name: "2.91 (12.06.2026)",
      action_id: 1
    }
  ]
);
assert.deepEqual(normalizedAssistantStatistics.years, [2026]);
assert.equal(normalizedAssistantStatistics.summary.installs, 7);
assert.equal(normalizedAssistantStatistics.summary.removals, 3);
assert.equal(normalizedAssistantStatistics.summary.actions, 12);
assert.deepEqual(normalizedAssistantStatistics.versions[0], {
  year: 2026,
  month: 8,
  label: "2.90",
  value: 3
});
assert.deepEqual(normalizedAssistantStatistics.locations[0], {
  year: 2026,
  month: 8,
  label: "Омск",
  installs: 5,
  removals: 2
});
assert.deepEqual(normalizedAssistantStatistics.downloadDetails[0], {
  id: 3962,
  year: 2026,
  month: 7,
  day: 19,
  date: "2026-07-19 10:00:00",
  location: "Санкт-Петербург",
  organization: "ВИ(ИТ)",
  email: "user@example.ru",
  version: "2.91 (12.06.2026)",
  action: "Установка"
});

const renderStatisticsLocationChartBlock = sourceBlock(
  appSource,
  "function renderStatisticsLocationChart(",
  "function compactStatisticsItems("
);
const renderStatisticsLocationChart = new Function(`
  const escapeHtml = (value) => String(value ?? "");
  const escapeAttr = escapeHtml;
  const formatStatisticsInteger = (value) => String(Number(value) || 0);
  ${renderStatisticsLocationChartBlock}
  return renderStatisticsLocationChart;
`)();
const locationChart = renderStatisticsLocationChart([
  { label: "Москва", installs: 10, removals: 2 },
  { label: "Омск", installs: 15, removals: 1 }
], { installs: 25, removals: 3 });
assert.ok(locationChart.indexOf("Омск") < locationChart.indexOf("Москва"));
assert.match(locationChart, /statistics-location-negative/u);
assert.match(locationChart, /Установки[\s\S]*25/u);
assert.match(locationChart, /Удаления[\s\S]*3/u);
assert.match(locationChart, /statistics-location-positive[\s\S]*<small>15<\/small>[\s\S]*<i/u);
assert.match(locationChart, /statistics-location-negative[\s\S]*<i[\s\S]*<small>1<\/small>/u);
assert.doesNotMatch(locationChart, /<em>/u);

const serverStatisticsBlock = sourceBlock(
  serverSource,
  "async function readPublicDownloadStatistics()",
  "function getSharedRecordLocksMySqlConnectionString()"
);
assert.match(serverStatisticsBlock, /FROM wp_dae_links/u);
assert.match(serverStatisticsBlock, /'generated' AS event_type/u);
assert.match(serverStatisticsBlock, /'downloaded' AS event_type/u);
assert.doesNotMatch(serverStatisticsBlock, /\b(?:email|fio|ip_used|form_content)\b/iu);
assert.match(serverSource, /requestUrl\.pathname === "\/api\/statistics\/downloads"/u);

const assistantStatisticsBlock = sourceBlock(
  serverSource,
  "async function readAssistantStatistics()",
  "async function handleAssistantStatistics(res)"
);
assert.match(assistantStatisticsBlock, /FROM wp_ass_reg/u);
assert.match(assistantStatisticsBlock, /FROM wp_ass_logs AS logs/u);
assert.match(assistantStatisticsBlock, /INNER JOIN wp_ass_logs_structure/u);
assert.match(assistantStatisticsBlock, /TRIM\(email\)/u);
assert.match(assistantStatisticsBlock, /TRIM\(org\)/u);
assert.match(assistantStatisticsBlock, /AND action = 1/u);
assert.doesNotMatch(assistantStatisticsBlock, /\b(?:fio|ip|notes)\b/iu);
assert.match(assistantStatisticsBlock, /TRIM\(location\)/u);
assert.match(serverSource, /requestUrl\.pathname === "\/api\/statistics\/assistant"/u);
assert.match(serverSource, /ASSISTANT_STATISTICS_MYSQL_CONNECTION_STRING/u);
assert.match(appSource, /data-admin-database-panel="statistics"/u);
assert.match(appSource, /data-action="test-assistant-statistics-mysql"/u);
const renderStatisticsAssistantBlock = sourceBlock(
  appSource,
  "function renderStatisticsAssistant()",
  "function getStatisticsFilterOptions()"
);
assert.match(renderStatisticsAssistantBlock, /Скачивания по месяцам/u);
assert.match(renderStatisticsAssistantBlock, /Детальная информация о скачиваниях/u);
assert.match(renderStatisticsAssistantBlock, /statisticsDownloadDetailColumns/u);
assert.match(renderStatisticsAssistantBlock, /\{ key: "downloads", label: "Скачивания"/u);
assert.doesNotMatch(renderStatisticsAssistantBlock, /\{ key: "installs", label: "Установки"/u);
assert.match(appSource, /data-statistics-filter="downloadQuery"/u);
assert.match(appSource, /data-action="sort-statistics-downloads"/u);
assert.match(appSource, /column\?\.numeric \|\| column\?\.date \? "desc" : "asc"/u);
assert.match(appSource, /\{ key: "date", label: "Дата", date: true \}/u);
assert.doesNotMatch(appSource, /\{ key: "year", label: "Год"/u);
const statisticsDownloadDateBlock = sourceBlock(
  appSource,
  "function statisticsDownloadDateSortValue(",
  "function getFilteredStatisticsDownloadDetails()"
);
const statisticsDownloadDateHelpers = new Function(`
  ${statisticsDownloadDateBlock}
  return { statisticsDownloadDateSortValue, formatStatisticsDownloadDate };
`)();
assert.equal(statisticsDownloadDateHelpers.statisticsDownloadDateSortValue({ year: 2026, month: 7, day: 19 }), 20260719);
assert.equal(statisticsDownloadDateHelpers.formatStatisticsDownloadDate({ year: 2026, month: 7, day: 19 }), "19.07.2026");
assert.match(renderStatisticsAssistantBlock, /statistics-ellipsis-cell/u);
assert.match(renderStatisticsAssistantBlock, /title="\$\{escapeAttr\(row\.email/u);
assert.match(appSource, /\["ID", "Дата", "Город", "Организация", "Email", "Версия", "Действие"\]/u);

assert.match(styles, /\.statistics-kpi-grid\s*\{/u);
assert.match(styles, /\.statistics-chart-columns\s*\{/u);
assert.match(styles, /\.statistics-chart-bar-area > small[\s\S]*bottom:\s*calc\(var\(--statistics-bar-height\) \+ 3px\)/u);
assert.match(styles, /\.statistics-comparison-chart\s*\{/u);
assert.match(styles, /\.statistics-comparison-totals\s*\{/u);
assert.match(styles, /\.statistics-location-chart\s*\{/u);
assert.match(styles, /\.statistics-location-negative\s*\{/u);
assert.match(styles, /\.statistics-download-table\s*\{/u);
assert.match(styles, /\.statistics-download-table \.statistics-ellipsis-cell[\s\S]*text-overflow:\s*ellipsis/u);
assert.match(styles, /\.statistics-download-table\s*\{[\s\S]*min-width:\s*760px/u);
assert.match(styles, /\.statistics-table-sort-button\s*\{/u);
assert.match(appSource, /key: "profitabilityPercent", label: "Рентабельность, %"/u);
assert.match(appSource, /STATISTICS_PROFITABILITY_TABLE_CONFIG_ID/u);
assert.match(appSource, /statistics-profitability-resize-handle/u);
assert.match(styles, /\.statistics-profitability-table\s*\{[\s\S]*table-layout:\s*fixed/u);
assert.match(styles, /\.statistics-program-name-cell\s*\{[\s\S]*text-overflow:\s*ellipsis/u);
assert.match(styles, /\.statistics-kpi-icon\s*\{/u);
assert.match(styles, /grid-auto-columns:\s*minmax\(24px, 1fr\)/u);
assert.match(styles, /grid-auto-columns:\s*minmax\(44px, 1fr\)/u);
assert.match(styles, /\.statistics-chart-period:last-child\s*\{/u);
assert.match(styles, /\.finance-month:last-child\s*\{/u);
assert.match(styles, /\.statistics-donut\s*\{/u);
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.statistics-filters/su);
const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authSource)?.[1] || "";
assert.ok(authBuild, "Не найден идентификатор сборки загрузчика");
assert.match(indexSource, new RegExp(`(?:styles\\.css|auth-bootstrap\\.js)\\?v=${authBuild}`, "u"));

console.log("statistics view checks: OK");
