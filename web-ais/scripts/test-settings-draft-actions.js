"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function extractFunction(name) {
  const regularStart = appSource.indexOf(`  function ${name}(`);
  const start = regularStart >= 0
    ? regularStart
    : appSource.indexOf(`  async function ${name}(`);
  assert.ok(start >= 0, `Не найдена функция ${name}`);
  const bodyStart = appSource.indexOf(") {", start) + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1).replace(/^  /gmu, "");
    }
  }
  throw new Error(`Функция ${name} не завершена`);
}

assert.match(appSource, /function renderSettings\(\) \{\s*beginSettingsDraftSession\(\);/u);
assert.match(appSource, /data-action="cancel-settings-changes"[\s\S]*data-action="save-settings-changes"/u);
assert.match(appSource, /function persist\(options = \{\}\)[\s\S]*isSettingsDraftSessionActive\(\)[\s\S]*options\.forceSettingsDraft !== true[\s\S]*markSettingsDraftDirty\(\);\s*return;/u);
assert.match(appSource, /function cancelSettingsDraftChanges[\s\S]*JSON\.parse\(state\.settingsDraftBaseline\)[\s\S]*persistStateToLocalStorage\(state\.data\)/u);
assert.match(appSource, /async function saveSettingsDraftChanges[\s\S]*applySettingsEditorDrafts\(\)[\s\S]*persist\(\{ forceSettingsDraft: true \}\)[\s\S]*flushSharedApplicationStateThroughGeneration/u);
assert.match(
  appSource,
  /function isSettingsDraftSaveBusy\(\)[\s\S]*state\.settingsDraftSaving \|\| settingsDraftSavePreparing/u,
  "Предварительное ожидание общей базы должно считаться активным сохранением настроек."
);
assert.match(
  appSource,
  /async function saveSettingsDraftChanges[\s\S]*if \(state\.settingsDraftSaving \|\| settingsDraftSavePreparing\) return false;[\s\S]*settingsDraftSavePreparing = true;[\s\S]*await waitForActiveSharedApplicationStateSave\(\)[\s\S]*state\.settingsDraftSaving = true/u,
  "Повторный щелчок не должен запускать второе сохранение, пока первое ждёт общую базу."
);
assert.match(
  appSource,
  /async function saveSettingsDraftChanges[\s\S]*finally \{[\s\S]*settingsDraftSavePreparing = false;[\s\S]*state\.settingsDraftSaving = false;[\s\S]*updateSettingsDraftActions\(\)/u,
  "Оба признака занятости должны сниматься после успеха или ошибки."
);
assert.match(
  appSource,
  /function setSettingsDraftInteractionLocked\(locked\)[\s\S]*?\.settings-page-panel[\s\S]*?setAttribute\("inert", ""\)[\s\S]*?setAttribute\("aria-busy", "true"\)[\s\S]*?removeAttribute\("inert"\)[\s\S]*?removeAttribute\("aria-busy"\)/u,
  "Вся панель настроек должна блокироваться через inert и aria-busy во время сохранения."
);
assert.match(
  appSource,
  /<section class="panel settings-page-panel" \$\{settingsDraftSaveBusy \? 'inert aria-busy="true"' : ""\}>/u,
  "Повторный render во время ожидания должен создавать панель уже с inert и aria-busy."
);
assert.match(
  appSource,
  /settingsDraftSavePreparing = true;[\s\S]*?setSettingsDraftInteractionLocked\(true\);[\s\S]*?settingsDraftSavePreparing = false;\s*state\.settingsDraftSaving = true;[\s\S]*?finally \{[\s\S]*?state\.settingsDraftSaving = false;\s*setSettingsDraftInteractionLocked\(false\);/u,
  "inert должен оставаться установленным непрерывно и на preparing, и на saving, снимаясь только в finally."
);
assert.match(appSource, /function applySettingsEditorDrafts[\s\S]*form\.requestSubmit\(\)[\s\S]*settingsDraftMutationGeneration/u);
assert.match(appSource, /function captureSettingsFormSnapshot[\s\S]*data-student-event-setting-row[\s\S]*data-contract-event-setting-row/u);
assert.match(appSource, /captureSettingsFormSnapshot\(form\)[\s\S]*form\.dataset\.settingsDraftBaseline/u);
assert.match(appSource, /async function savePendingSettingsBeforeExit[\s\S]*saveSettingsBeforeExit[\s\S]*saveAdminSettingsBeforeExit/u);
assert.match(appSource, /if \(targetView === "settings"\) return applySettingsEditorDrafts\(\);/u);
assert.equal((appSource.match(/savePendingSettingsBeforeExit\(/gu) || []).length, 5);
assert.match(appSource, /if \(!state\.adminSettingsDirty && !hasUnsavedSettingsChanges\(\)\) return;/u);
assert.match(appSource, /if \(isSettingsDraftSessionActive\(\) && !state\.settingsDraftSaving\) \{\s*state\.settingsDraftAuditEntries\.push\(entry\);/u);
assert.match(appSource, /preserveSettingsDraftData = isSettingsDraftSessionActive\(\) && !state\.settingsDraftSaving/u);
assert.match(appSource, /class="ghost-button settings-apply-button"[^>]*>Применить/u);
const flushSource = extractFunction("flushSharedApplicationState");
assert.match(flushSource, /isSettingsDraftSessionActive\(\)\s*&& saveOptions\.allowSettingsDraft !== true/u);
assert.doesNotMatch(
  flushSource,
  /settingsDraftSaving/u,
  "Фоновый flush должен блокироваться на всём протяжении settings-сессии, включая явное saving."
);
assert.match(
  appSource,
  /async function flushSharedApplicationStateThroughGeneration[\s\S]*?isSettingsDraftSessionActive\(\)\s*&& options\.allowSettingsDraft !== true[\s\S]*?return true;/u,
  "Generation flush должен иметь такую же независимую от saving защиту settings draft."
);
assert.equal(
  (extractFunction("saveSettingsDraftChanges").match(/allowSettingsDraft:\s*true/gu) || []).length,
  2,
  "Только две контролируемые ветки saveSettingsDraftChanges должны явно разрешать flush черновика."
);
assert.match(
  appSource,
  /function beginSettingsDraftSession\([\s\S]*?settingsDraftSharedBaseData = sharedBaseDataAtOpen[\s\S]*?settingsDraftPendingPatch = mergeSharedApplicationStatePatches/u
);
assert.match(
  appSource,
  /async function waitForActiveSharedApplicationStateSave\([\s\S]*?window\.clearTimeout\(sharedStateSaveTimer\);\s*sharedStateSaveTimer = 0;/u
);

assert.match(stylesSource, /\.settings-page-actions\s*\{[\s\S]*justify-content:\s*flex-end/u);
assert.match(stylesSource, /\.settings-save-all-button\.is-unsaved\s*\{[\s\S]*background:\s*#d97706/u);
assert.match(stylesSource, /@media \(max-width: 720px\)[\s\S]*\.settings-page-actions\s*\{[\s\S]*width:\s*100%/u);

const checkbox = {
  type: "checkbox",
  tagName: "INPUT",
  name: "",
  checked: false,
  value: "on",
  isContentEditable: false,
  getAttribute: () => "КПК"
};
const rows = [
  { dataset: { studentEventSettingKey: "first" } },
  { dataset: { studentEventSettingKey: "second" } }
];
const fakeForm = {
  querySelectorAll(selector) {
    if (selector.includes("input")) return [checkbox];
    if (selector.includes("data-student-event-setting-row")) return rows;
    return [];
  }
};
const context = {
  Array,
  Boolean,
  JSON,
  String,
  serializeCommunicationTemplateEditor: () => ""
};
vm.createContext(context);
vm.runInContext(`${extractFunction("captureSettingsFormSnapshot")}; this.capture = captureSettingsFormSnapshot;`, context);
const initialSnapshot = context.capture(fakeForm);
checkbox.checked = true;
assert.notEqual(context.capture(fakeForm), initialSnapshot, "Галочка события должна помечать форму изменённой");
const checkedSnapshot = context.capture(fakeForm);
rows.reverse();
assert.notEqual(context.capture(fakeForm), checkedSnapshot, "Порядок событий должен помечать форму изменённой");

const persistCalls = [];
const persistContext = {
  state: {
    data: { collections: {} },
    settingsDraftSaving: true
  },
  sharedStateReady: true,
  sharedStateDirty: false,
  sharedStateChangeGeneration: 7,
  registryRowSearchTextCache: new WeakMap(),
  programTrainingPlanHoursSummaryCache: { rows: null, values: new WeakMap() },
  isDatabaseDemoMode: () => false,
  isSettingsDraftSessionActive: () => true,
  markSettingsDraftDirty: () => persistCalls.push("mark-dirty"),
  persistStateToLocalStorage: () => persistCalls.push("local"),
  persistSharedStateRecovery: () => persistCalls.push("recovery"),
  updateSharedStateStatusUi: () => persistCalls.push("status"),
  scheduleSharedApplicationStateSave: () => persistCalls.push("schedule")
};
vm.createContext(persistContext);
vm.runInContext(
  `${extractFunction("persist")}; this.persistForTest = persist;`,
  persistContext
);
persistContext.persistForTest({ forceSettingsDraft: true, scheduleSharedSave: false });
assert.deepEqual(
  persistCalls,
  ["local", "recovery", "status"],
  "Strict retry должен обновить local/recovery/status, но не ставить конкурентный таймер."
);
assert.equal(persistContext.sharedStateDirty, true);
assert.equal(persistContext.sharedStateChangeGeneration, 8);
persistCalls.length = 0;
persistContext.persistForTest({ forceSettingsDraft: true });
assert.deepEqual(
  persistCalls,
  ["local", "recovery", "status", "schedule"],
  "Обычный persist должен по-прежнему автоматически планировать сохранение общей базы."
);
assert.equal(persistContext.sharedStateChangeGeneration, 9);

let performedFlushes = 0;
const flushContext = {
  state: { settingsDraftSaving: true },
  sharedStateSavePromise: null,
  isSettingsDraftSessionActive: () => true,
  performSharedApplicationStateSave: () => {
    performedFlushes += 1;
    return Promise.resolve(true);
  }
};
vm.createContext(flushContext);
vm.runInContext(
  `${flushSource}; this.flushForTest = flushSharedApplicationState;`,
  flushContext
);
flushContext.flushForTest();
assert.equal(
  performedFlushes,
  0,
  "Даже при settingsDraftSaving фоновый вызов без allowSettingsDraft не должен начинать POST."
);
flushContext.flushForTest({ allowSettingsDraft: true });
assert.equal(performedFlushes, 1, "Явная ветка сохранения должна иметь возможность выполнить контролируемый flush.");

console.log("Settings draft actions checks: OK");
