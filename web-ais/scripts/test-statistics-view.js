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

assert.match(appSource, /version: "1\.7\.224"/u);
assert.match(appSource, /\{ id: "statistics", label: "Статистика"/u);
assert.match(appSource, /state\.view === "statistics"\) return renderStatistics\(\)/u);
assert.match(appSource, /getOrderedTabs\("statistics", statisticsTabs\)/u);
assert.match(appSource, /data-orderable-tabs="statistics"/u);
assert.match(appSource, /Интерактивная статистика/u);
assert.match(appSource, /Доходы и затраты по месяцам/u);
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
assert.doesNotMatch(assistantStatisticsBlock, /\b(?:fio|email|ip|org|notes)\b/iu);
assert.match(assistantStatisticsBlock, /TRIM\(location\)/u);
assert.match(serverSource, /requestUrl\.pathname === "\/api\/statistics\/assistant"/u);
assert.match(serverSource, /ASSISTANT_STATISTICS_MYSQL_CONNECTION_STRING/u);
assert.match(appSource, /data-admin-database-panel="statistics"/u);
assert.match(appSource, /data-action="test-assistant-statistics-mysql"/u);

assert.match(styles, /\.statistics-kpi-grid\s*\{/u);
assert.match(styles, /\.statistics-chart-columns\s*\{/u);
assert.match(styles, /\.statistics-comparison-chart\s*\{/u);
assert.match(styles, /\.statistics-comparison-totals\s*\{/u);
assert.match(styles, /\.statistics-location-chart\s*\{/u);
assert.match(styles, /\.statistics-location-negative\s*\{/u);
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
