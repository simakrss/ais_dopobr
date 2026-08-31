"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function sourceBlock(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end);
}

const statisticsState = {
  statistics: {
    sources: {
      savedSqlById: { source_one: "SELECT 1" }
    }
  }
};
const statisticsDraftTools = new Function("state", "isStatisticsSourceReadOnly", `
  ${sourceBlock("  function getEditableStatisticsSourcePayload", "  async function saveStatisticsSources")}
  return { hasStatisticsSourceDraftChanges };
`)(statisticsState, (source) => source.readOnly === true);

assert.equal(statisticsDraftTools.hasStatisticsSourceDraftChanges([
  { id: "source_one", sql: "SELECT 1" }
]), false);
assert.equal(statisticsDraftTools.hasStatisticsSourceDraftChanges([
  { id: "source_one", sql: "SELECT 2" }
]), true);
assert.equal(statisticsDraftTools.hasStatisticsSourceDraftChanges([
  { id: "source_one", sql: "SELECT 2", readOnly: true }
]), false);

const advertisingState = {
  advertising: {
    settings: {
      sources: [{
        id: "saved_source",
        label: "Сохранённый источник",
        group: "SQL",
        kind: "sql",
        connection: "applications",
        sql: "SELECT email FROM contacts",
        enabled: true
      }]
    },
    settingsSavedSources: null,
    settingsDraftSources: null,
    settingsDirty: false,
    settingsMessage: ""
  }
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const advertisingDraftTools = new Function("state", "clone", `
  ${sourceBlock("  function parseAdvertisingWorkbookEditorValue", "  function syncAdvertisingSourceDraftsFromDom")}
  return {
    normalizeAdvertisingSourceDrafts,
    hasAdvertisingSourceDraftChanges,
    setAdvertisingSourceDrafts
  };
`)(advertisingState, clone);

const savedAdvertisingSources = advertisingDraftTools.normalizeAdvertisingSourceDrafts(
  advertisingState.advertising.settings.sources
);
advertisingState.advertising.settingsSavedSources = clone(savedAdvertisingSources);
advertisingState.advertising.settingsDraftSources = clone(savedAdvertisingSources);
assert.equal(advertisingDraftTools.hasAdvertisingSourceDraftChanges(savedAdvertisingSources), false);

advertisingDraftTools.setAdvertisingSourceDrafts([{
  ...savedAdvertisingSources[0],
  label: "Изменённый черновик"
}]);
assert.equal(advertisingState.advertising.settingsDirty, true);
assert.equal(advertisingState.advertising.settingsDraftSources[0].label, "Изменённый черновик");
assert.equal(
  advertisingState.advertising.settings.sources[0].label,
  "Сохранённый источник",
  "Черновик не должен менять рабочие источники до сохранения"
);

advertisingDraftTools.setAdvertisingSourceDrafts(savedAdvertisingSources);
assert.equal(advertisingState.advertising.settingsDirty, false);

assert.match(appSource, /data-statistics-source-draft-toolbar/u);
assert.match(appSource, /data-advertising-source-draft-toolbar/u);
assert.match(appSource, /data-action="discard-statistics-source-changes"/u);
assert.match(appSource, /data-action="discard-advertising-source-changes"/u);
assert.match(appSource, /Сохранить изменения/u);
assert.match(appSource, /settingsDraftSources/u);
assert.match(
  appSource,
  /advertising-source-header-connection[\s\S]*data-advertising-source-field="connection"[\s\S]*data-action="move-advertising-source"/u
);
assert.match(stylesSource, /\.source-draft-toolbar\.is-unsaved/u);
assert.match(stylesSource, /\.source-draft-save-button\.is-unsaved/u);
assert.match(stylesSource, /\.advertising-source-editor-grid \.advertising-source-query \{\s*grid-column: 1 \/ -1;/u);

console.log("Source settings draft tests passed.");
