"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const serverPath = path.join(root, "app-server.js");
const serverSource = fs.readFileSync(serverPath, "utf8").replace(/\r\n/g, "\n");
const {
  normalizeStatisticsSourceSqlQuery,
  normalizeStatisticsSources,
  validateStatisticsSourceResultColumns,
  getStatisticsSourceDefinitions
} = require(serverPath);

const defaults = getStatisticsSourceDefinitions();
assert.equal(defaults.length, 9);
assert.equal(new Set(defaults.map((source) => source.id)).size, 9);
assert.equal(defaults.filter((source) => source.kind === "ais").length, 3);
assert.equal(defaults.filter((source) => source.kind === "sql").length, 6);
assert.ok(defaults.every((source) => source.consumers.length > 0));

const monthlySql = `
  SELECT
    2026 AS event_year,
    8 AS event_month,
    1 AS install_count,
    0 AS removal_count,
    '2026-08-01' AS first_at,
    '2026-08-31' AS last_at
`;
const normalizedMonthlySql = normalizeStatisticsSourceSqlQuery(monthlySql, "assistant.monthly");
assert.match(normalizedMonthlySql, /^SELECT/iu);
const changed = normalizeStatisticsSources([{ id: "assistant.monthly", sql: monthlySql }], defaults);
assert.equal(changed.find((source) => source.id === "assistant.monthly").sql, normalizedMonthlySql);
assert.equal(changed.find((source) => source.id === "assistant.versions").sql, defaults.find((source) => source.id === "assistant.versions").sql);

assert.throws(
  () => normalizeStatisticsSourceSqlQuery("UPDATE wp_ass_reg SET action = 1", "assistant.monthly"),
  /SELECT|UPDATE|не разрешена/iu
);
assert.throws(
  () => normalizeStatisticsSourceSqlQuery("SELECT 2026 AS event_year", "assistant.monthly"),
  /обязательные поля/iu
);
const fixedConnection = normalizeStatisticsSources([
  { id: "assistant.monthly", connection: "applications", sql: monthlySql }
], defaults).find((source) => source.id === "assistant.monthly");
assert.equal(fixedConnection.connection, "assistant");
assert.throws(
  () => normalizeStatisticsSources([{ id: "finance.receipts", sql: "SELECT 1 AS value" }], defaults),
  /формируется АИС|не изменяется/iu
);

assert.deepEqual(
  new Set(validateStatisticsSourceResultColumns(
    defaults.find((source) => source.id === "assistant.versions"),
    ["EVENT_YEAR", "event_month", "version_name", "event_count"]
  )),
  new Set(["event_year", "event_month", "version_name", "event_count"])
);
assert.throws(
  () => validateStatisticsSourceResultColumns(
    defaults.find((source) => source.id === "site.downloads"),
    ["event_type", "event_year"]
  ),
  /не вернул обязательные поля/iu
);

assert.match(serverSource, /publicStatisticsSources\(authUser\?\.role === "admin"\)/u);
assert.match(serverSource, /await Promise\.all\([\s\S]*testStatisticsSource/u);
assert.match(serverSource, /saveServerSettings\(\{ statisticsSources:/u);
assert.match(serverSource, /let serverSettingsSaveQueue = Promise\.resolve\(\)/u);
assert.match(serverSource, /const operation = serverSettingsSaveQueue\.then\(async \(\) =>/u);
assert.match(serverSource, /serverSettingsSaveQueue = operation\.catch\(\(\) => \{\}\)/u);
assert.match(serverSource, /"assistant\.versions":[\s\S]*AS version_name[\s\S]*action\s*=\s*1/u);

console.log("statistics sources checks: OK");
