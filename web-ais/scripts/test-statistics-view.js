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

assert.match(appSource, /version: "1\.7\.213"/u);
assert.match(appSource, /\{ id: "statistics", label: "Статистика"/u);
assert.match(appSource, /state\.view === "statistics"\) return renderStatistics\(\)/u);
assert.match(appSource, /getOrderedTabs\("statistics", statisticsTabs\)/u);
assert.match(appSource, /data-orderable-tabs="statistics"/u);
assert.match(appSource, /Интерактивная статистика/u);
assert.match(appSource, /Доходы и затраты по месяцам/u);
assert.match(appSource, /Популярные действия/u);
assert.match(appSource, /Экспорт CSV/u);

const snapshotBlock = sourceBlock(
  appSource,
  "  const POWER_BI_ASSISTANT_SNAPSHOT",
  "  const GENERAL_EXPENSE_SECTIONS"
);
const snapshot = new Function(
  `${snapshotBlock.replace("  const POWER_BI_ASSISTANT_SNAPSHOT", "const POWER_BI_ASSISTANT_SNAPSHOT")}\nreturn POWER_BI_ASSISTANT_SNAPSHOT;`
)();
assert.equal(
  snapshot.monthlyInstalls.reduce((sum, [, count]) => sum + count, 0),
  snapshot.installs,
  "Сумма месячных установок должна совпадать с итогом PBIX"
);
assert.equal(snapshot.actionsTotal, 77038);
assert.ok(snapshot.topActions.length >= 10);

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

assert.match(styles, /\.statistics-kpi-grid\s*\{/u);
assert.match(styles, /\.statistics-chart-columns\s*\{/u);
assert.match(styles, /\.statistics-donut\s*\{/u);
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.statistics-filters/su);
const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authSource)?.[1] || "";
assert.ok(authBuild, "Не найден идентификатор сборки загрузчика");
assert.match(indexSource, new RegExp(`(?:styles\\.css|auth-bootstrap\\.js)\\?v=${authBuild}`, "u"));

console.log("statistics view checks: OK");
