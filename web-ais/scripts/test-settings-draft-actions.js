"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`  function ${name}(`);
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

console.log("Settings draft actions checks: OK");
