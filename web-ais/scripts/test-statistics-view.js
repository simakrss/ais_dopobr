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

assert.match(appSource, /version: "1\.7\.266"/u);
assert.match(appSource, /\{ id: "statistics", label: "Статистика"/u);
const navigationBlock = sourceBlock(appSource, "const navItems = [", "const PROGRAM_LIST_FIELD_KEYS");
const navigationIds = [...navigationBlock.matchAll(/\{ id: "([^"]+)"/gu)].map((match) => match[1]);
assert.deepEqual(navigationIds.slice(0, 3), ["dashboard", "statistics", "advertising"]);
assert.match(appSource, /NAV_ITEM_ORDER_LAYOUT_VERSION = "advertising-after-statistics"/u);
assert.match(appSource, /dashboardIndex >= 0 \? dashboardIndex \+ 1 : 0/u);
assert.match(appSource, /state\.view === "statistics"\) return renderStatistics\(\)/u);
assert.match(appSource, /getOrderedTabs\("statistics", statisticsTabs\)/u);
assert.match(appSource, /data-orderable-tabs="statistics"/u);
assert.match(appSource, /Интерактивная статистика/u);
const statisticsTabsBlock = sourceBlock(appSource, "const statisticsTabs =", "const STATISTICS_SOURCE_CONSUMERS");
assert.match(statisticsTabsBlock, /\{ id: "sources", label: "Источники" \}/u);
assert.ok(statisticsTabsBlock.indexOf('id: "sources"') > statisticsTabsBlock.indexOf('id: "assistant"'));
const statisticsSourceConsumersBlock = sourceBlock(
  appSource,
  "const STATISTICS_SOURCE_CONSUMERS =",
  "const statisticsDownloadDetailColumns"
);
const statisticsSourceConsumers = new Function(`${statisticsSourceConsumersBlock}\nreturn STATISTICS_SOURCE_CONSUMERS;`)();
assert.equal(Object.keys(statisticsSourceConsumers).length, 9);
assert.ok(Object.values(statisticsSourceConsumers).every((consumers) => Array.isArray(consumers) && consumers.length));
assert.equal(new Set(Object.values(statisticsSourceConsumers).flat().map((consumer) => consumer.join("\u0000"))).size, 27);
assert.match(appSource, /activeTab === "sources"[\s\S]*renderStatisticsSources\(\)/u);
assert.match(appSource, /activeTab !== "sources" \? `<div class="statistics-filters">/u);
assert.match(appSource, /fetch\(photoApiUrl\("\/api\/statistics\/sources"\)/u);
assert.match(appSource, /fetch\(photoApiUrl\("\/api\/statistics\/sources\/test"\)/u);
assert.match(appSource, /data-action="save-statistics-sources"/u);
assert.match(appSource, /data-action="test-statistics-source"/u);
assert.match(
  appSource,
  /\[data-statistics-source-editor\] \[data-sql-query-editor\][\s\S]*addEventListener\("input"[\s\S]*syncStatisticsSourceDraftsFromDom/u
);
assert.match(appSource, /state\.statistics\.tab === "sources"\) syncStatisticsSourceDraftsFromDom\(\)/u);
assert.match(appSource, /Карта построения статистики/u);
assert.match(appSource, /const selected = fallback\.length \? fallback : supplied/u);
const statisticsSourceRendererBlock = sourceBlock(
  appSource,
  "function getStatisticsSourceDefinitions()",
  "function getStatisticsFilterOptions()"
);
const renderStatisticsSources = new Function(`
  const STATISTICS_SOURCE_CONSUMERS = ${JSON.stringify(statisticsSourceConsumers)};
  const state = { statistics: { sources: {
    loading: false,
    loaded: true,
    saving: false,
    testingId: "",
    error: "",
    message: "",
    testResults: {},
    data: { sources: [
      { id: "finance.receipts", label: "Поступления слушателей", kind: "ais", connection: "shared-state", readOnly: true, requiredColumns: [], consumers: ["income.total"] },
      { id: "assistant.monthly", label: "Установки и удаления Ассистента", kind: "sql", connection: "assistant", readOnly: false, requiredColumns: ["event_year"], consumers: ["assistant.installs"], sql: "SELECT 2026 AS event_year" }
    ] }
  } } };
  const escapeHtml = (value) => String(value ?? "");
  const escapeAttr = escapeHtml;
  const isAdminUser = () => true;
  const formatStatisticsInteger = (value) => String(Number(value) || 0);
  const renderSqlMiniIde = (value, options = {}) => '<input ' + (options.inputAttributes || '') + ' value="' + value + '">';
  ${statisticsSourceRendererBlock}
  return renderStatisticsSources;
`)();
const statisticsSourcesHtml = renderStatisticsSources();
assert.match(statisticsSourcesHtml, /Конструктор источников/u);
assert.match(statisticsSourcesHtml, /Поступления слушателей/u);
assert.match(statisticsSourcesHtml, /Установки и удаления Ассистента/u);
assert.match(statisticsSourcesHtml, /data-statistics-source-field="sql"/u);
assert.match(statisticsSourcesHtml, /Суммарные доходы/u);
assert.doesNotMatch(statisticsSourcesHtml, />income\.total</u);
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
assert.match(comparisonChart, /--statistics-bar-height:100%[\s\S]*<small>5<\/small>/u);
assert.match(styles, /\.statistics-comparison-bar-area > small[\s\S]*bottom: calc\(var\(--statistics-bar-height, 0%\) \+ 3px\)/u);
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

const statisticsDonutBlock = sourceBlock(
  appSource,
  "function compactStatisticsItems(",
  "function renderStatisticsRanking("
);
const renderStatisticsDonut = new Function(`
  const escapeHtml = (value) => String(value ?? "");
  const escapeAttr = escapeHtml;
  const formatStatisticsInteger = (value) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const money = (value) => String(value);
  ${statisticsDonutBlock}
  return renderStatisticsDonut;
`)();
const sourceDonut = renderStatisticsDonut("Источники заявок", [
  { label: "Почтовая рассылка", value: 16 },
  { label: "От коллег, знакомых", value: 15 },
  { label: "Поиск в интернете", value: 10 },
  { label: "Повторное обращение", value: 8 },
  { label: "Вконтакте", value: 6 },
  { label: "Телеграм", value: 5 },
  { label: "Прочие", value: 2 }
], { legendPercent: true });
assert.match(sourceDonut, /statistics-donut-legend-label/u);
assert.match(sourceDonut, /Почтовая рассылка<\/b><em>— 26%<\/em>/u);
assert.doesNotMatch(sourceDonut, /<em>16<\/em>/u);
const versionDonut = renderStatisticsDonut(
  "Версии",
  [{ label: "2.91 (12.06.2026)", value: 3 }],
  { legendInlineValue: true }
);
assert.match(versionDonut, /class="is-inline-value"/u);
assert.match(versionDonut, /2\.91 \(12\.06\.2026\)<\/b><em>— 3<\/em>/u);
assert.doesNotMatch(versionDonut, /300%/u);
assert.match(appSource, /renderStatisticsDonut\("Источники заявок", report\.sources, \{ legendPercent: true \}\)/u);
assert.match(appSource, /renderStatisticsDonut\("Версии Ассистента", report\.versions, \{ limit: 7, legendInlineValue: true \}\)/u);

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

const statisticsSqlDefaultsBlock = sourceBlock(
  serverSource,
  "const DEFAULT_STATISTICS_SQL_QUERIES",
  "const STATISTICS_SOURCE_DEFINITIONS"
);
const statisticsSourceDefinitionsBlock = sourceBlock(
  serverSource,
  "const STATISTICS_SOURCE_DEFINITIONS",
  "const ADVERTISING_EMAIL_HISTORY_STATE_KEY"
);
const statisticsSourceIds = [...statisticsSourceDefinitionsBlock.matchAll(/\bid: "([^"]+)"/gu)]
  .map((match) => match[1]);
assert.equal(statisticsSourceIds.length, 9);
assert.equal(new Set(statisticsSourceIds).size, 9);
assert.equal(statisticsSourceIds.filter((id) => id.startsWith("finance.")).length, 3);
assert.equal(statisticsSourceIds.filter((id) => !id.startsWith("finance.")).length, 6);
assert.match(statisticsSourceDefinitionsBlock, /id: "finance\.receipts"[\s\S]*kind: "ais"/u);
assert.match(statisticsSourceDefinitionsBlock, /id: "assistant\.monthly"[\s\S]*kind: "sql"/u);
assert.match(statisticsSourceDefinitionsBlock, /id: "site\.downloads"[\s\S]*connection: "applications"/u);
assert.match(statisticsSqlDefaultsBlock, /FROM wp_dae_links/u);
assert.match(statisticsSqlDefaultsBlock, /'generated' AS event_type/u);
assert.match(statisticsSqlDefaultsBlock, /'downloaded' AS event_type/u);
assert.doesNotMatch(statisticsSqlDefaultsBlock, /\b(?:fio|ip_used|form_content)\b/iu);
const assistantVersionsSqlBlock = sourceBlock(
  statisticsSqlDefaultsBlock,
  '"assistant.versions":',
  '"assistant.actions":'
);
assert.match(assistantVersionsSqlBlock, /\baction\s*=\s*1\b/u);

const serverStatisticsBlock = sourceBlock(
  serverSource,
  "async function readPublicDownloadStatistics()",
  "async function handlePublicDownloadStatistics(res)"
);
assert.match(serverStatisticsBlock, /getStatisticsSourceSql\("site\.downloads"\)/u);
assert.match(serverSource, /requestUrl\.pathname === "\/api\/statistics\/downloads"/u);

const assistantStatisticsBlock = sourceBlock(
  serverSource,
  "async function readAssistantStatistics()",
  "async function handleAssistantStatistics(res)"
);
for (const id of ["assistant.monthly", "assistant.versions", "assistant.actions", "assistant.locations", "assistant.downloadDetails"]) {
  assert.match(assistantStatisticsBlock, new RegExp(`getStatisticsSourceSql\\("${id.replace(".", "\\.")}\"\\)`, "u"));
}
assert.match(statisticsSqlDefaultsBlock, /FROM wp_ass_reg/u);
assert.match(statisticsSqlDefaultsBlock, /FROM wp_ass_logs AS logs/u);
assert.match(statisticsSqlDefaultsBlock, /INNER JOIN wp_ass_logs_structure/u);
assert.match(statisticsSqlDefaultsBlock, /TRIM\(email\)/u);
assert.match(statisticsSqlDefaultsBlock, /TRIM\(org\)/u);
assert.match(statisticsSqlDefaultsBlock, /TRIM\(location\)/u);
assert.match(serverSource, /requestUrl\.pathname === "\/api\/statistics\/assistant"/u);
assert.match(serverSource, /requestUrl\.pathname === "\/api\/statistics\/sources"/u);
assert.match(serverSource, /requestUrl\.pathname === "\/api\/statistics\/sources\/test"/u);
assert.match(serverSource, /normalizeStatisticsSourceSqlQuery/u);
assert.match(serverSource, /validateStatisticsSourceResultColumns/u);
assert.match(serverSource, /Настройки источников статистики доступны только администратору/u);
assert.match(serverSource, /ASSISTANT_STATISTICS_MYSQL_CONNECTION_STRING/u);
assert.match(appSource, /data-admin-database-panel="statistics"/u);
assert.match(appSource, /data-action="test-assistant-statistics-mysql"/u);
const renderStatisticsAssistantBlock = sourceBlock(
  appSource,
  "function renderStatisticsAssistant()",
  "function getStatisticsSourceDefinitions()"
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
assert.match(styles, /\.statistics-donut-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(140px, 0\.7fr\) minmax\(0, 1\.3fr\)/u);
assert.match(styles, /\.statistics-donut-legend-label\s*\{[\s\S]*display:\s*flex/u);
assert.match(styles, /\.statistics-donut-legend\s*>\s*span\.is-inline-value\s*\{[\s\S]*grid-template-columns:\s*10px minmax\(0, 1fr\)/u);
assert.match(styles, /\.statistics-donut-legend-label em\s*\{[\s\S]*flex:\s*0 0 auto/u);
assert.match(styles, /\.statistics-source-builder-panel\s*,/u);
assert.match(styles, /\.statistics-source-builder-list\s*\{/u);
assert.match(styles, /\.statistics-source-editor\s*\{/u);
assert.match(styles, /\.statistics-source-query \.sql-mini-ide-editor\s*\{/u);
assert.match(styles, /\.statistics-source-map-table\s*\{/u);
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.statistics-filters/su);
const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authSource)?.[1] || "";
assert.ok(authBuild, "Не найден идентификатор сборки загрузчика");
assert.match(indexSource, new RegExp(`(?:styles\\.css|auth-bootstrap\\.js)\\?v=${authBuild}`, "u"));

console.log("statistics view checks: OK");
