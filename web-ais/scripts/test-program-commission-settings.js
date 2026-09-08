"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");
const styleSource = fs.readFileSync(path.join(root, "styles.css"), "utf8").replace(/\r\n?/gu, "\n");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Не найдено начало блока: ${startMarker}`);
  assert.ok(end > start, `Не найден конец блока: ${endMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

const settingsSource = extractBetween("  function renderSettings", "\n  function escapeDictionarySearchRegExp");
assert.match(
  settingsSource,
  /key:\s*"commissionSets"[\s\S]*?title:\s*dictionaryTitle\("commissionSets"\)[\s\S]*?values:\s*state\.data\.collections\.commissionSets \|\| \[\]/u,
  "В настройках должен быть отдельный пункт, использующий центральную коллекцию commissionSets."
);
assert.match(settingsSource, /const isProgramCommissionSettings = selectedKey === "commissionSets"/u);
assert.match(settingsSource, /isSpecialDictionary[\s\S]*?isProgramCommissionSettings/u);
assert.match(settingsSource, /isProgramCommissionSettings[\s\S]*?renderProgramCommissionSettingsDictionary\(selectedValues\)/u);
assert.match(
  settingsSource,
  /isIssuedDocumentSettings \|\| isProgramCommissionSettings \|\| isNotificationSettings[\s\S]*?\? "" : `[\s\S]*?data-action="dict-sort"/u,
  "Для центральных множеств не должны показываться действия обычного строкового справочника."
);
assert.match(appSource, /commissionSets:\s*"Комиссии"/u);

const editorSource = extractBetween(
  "  function getProgramCommissionSetUsage",
  "\n  const dictionarySearchStaticContent"
);
assert.match(editorSource, /data-action="save-program-commission-sets"/u);
assert.match(editorSource, /data-action="add-program-commission-set"/u);
assert.match(editorSource, /data-action="remove-program-commission-set"/u);
assert.match(editorSource, /data-program-commission-settings-field="name"/u);
for (const key of ["commissionChair", "commissionMember1", "commissionMember2", "secretary"]) {
  assert.ok(
    appSource.includes(`"${key}"`),
    `Не найдено обязательное поле состава комиссии ${key}.`
  );
}
assert.match(editorSource, /Названия множеств комиссий не должны повторяться/u);
assert.match(editorSource, /if \(usage\.count\)[\s\S]*?Сначала выберите для них другой состав комиссии/u);
assert.match(editorSource, /state\.data\.collections\.commissionSets = commissionSets/u);
assert.doesNotMatch(
  editorSource,
  /state\.data\.collections\.programs\s*=|programRows\.splice/u,
  "Редактор множеств не должен перезаписывать полные записи программ."
);
assert.match(editorSource, /markSettingsDraftDirty\(\)/u);
assert.match(editorSource, /form\?\.addEventListener\("submit", saveProgramCommissionSettings\)/u);

const usageContext = {
  state: {
    settingsDraftBaseline: JSON.stringify({
      collections: {
        commissionSets: [
          { id: "set-a", name: "Основная" },
          { id: "set-b", name: "Резервная" }
        ]
      }
    }),
    data: {
      collections: {
        commissionSets: [{ id: "set-b", name: "Резервная" }],
        programs: [
          { id: "p-1", name: "Программа Б", commissionSetId: "set-a" },
          { id: "p-2", name: "Программа А", commissionSetId: "set-a" },
          { id: "p-3", name: "Другая", commissionSetId: "set-b" }
        ]
      }
    }
  },
  sharedStateBaseData: {
    collections: {
      commissionSets: [
        { id: "set-a", name: "Основная" },
        { id: "set-b", name: "Резервная" }
      ]
    }
  },
  unique: (values) => [...new Set(values)]
};
vm.createContext(usageContext);
vm.runInContext(
  `${extractBetween("  function getProgramCommissionSetUsage", "\n  function renderProgramCommissionSettingsDictionary")}
${extractBetween("  function getRemovedUsedProgramCommissionSet", "\n  function createProgramCommissionSettingsSaveSnapshot")}
this.getProgramCommissionSetUsageForTest = getProgramCommissionSetUsage;
this.getRemovedUsedProgramCommissionSet = getRemovedUsedProgramCommissionSet;`,
  usageContext
);
const usage = JSON.parse(JSON.stringify(usageContext.getProgramCommissionSetUsageForTest("set-a")));
assert.deepEqual(usage, { count: 2, names: ["Программа А", "Программа Б"] });
const blockedRemoval = JSON.parse(JSON.stringify(usageContext.getRemovedUsedProgramCommissionSet()));
assert.equal(blockedRemoval.commissionSet.id, "set-a");
assert.equal(blockedRemoval.usage.count, 2, "Повторное сохранение не должно удалить множество, которое успела использовать другая программа.");
usageContext.state.settingsDraftBaseline = JSON.stringify({
  collections: { commissionSets: [{ id: "set-b", name: "Резервная" }] }
});
const blockedPendingRemoval = JSON.parse(JSON.stringify(usageContext.getRemovedUsedProgramCommissionSet()));
assert.equal(blockedPendingRemoval.commissionSet.id, "set-a");
assert.equal(
  blockedPendingRemoval.usage.count,
  2,
  "Удаление из автономного pending patch должно проверяться по серверному baseline."
);

const settingsSaveSource = extractBetween(
  "  async function saveSettingsDraftChanges",
  "\n  function cancelSettingsDraftChanges"
);
assert.match(settingsSaveSource, /programCommissionSettingsChanged[\s\S]*?strictRevision:\s*true/u);
assert.match(settingsSaveSource, /state\.settingsDraftBaseRevision/u);
assert.match(
  appSource,
  /function hasProgramCommissionSettingsChanges\([\s\S]*?sharedStatePendingPatch[\s\S]*?sharedBaseline/u,
  "Изменение commissionSets из автономной очереди тоже должно включать строгий режим."
);
assert.doesNotMatch(
  settingsSaveSource,
  /sharedStateRevision > state\.settingsDraftBaseRevision[\s\S]*?settingsDraftBaseRevision = sharedStateRevision/u,
  "Базовую ревизию нельзя повышать без rebase состояния и черновика."
);
assert.match(settingsSaveSource, /flushSharedApplicationStateThroughGeneration\(targetGeneration, sharedSaveOptions\)/u);
assert.match(settingsSaveSource, /getRemovedUsedProgramCommissionSet\(\)[\s\S]*?Отмените удаление/u);
assert.match(settingsSaveSource, /createProgramCommissionSettingsSaveSnapshot\(\)/u);
assert.match(settingsSaveSource, /restoreFailedProgramCommissionSettingsSave\(programCommissionSaveSnapshot\)/u);

const restoreSource = extractBetween(
  "  async function restoreFailedProgramCommissionSettingsSave",
  "\n  async function saveSettingsDraftChanges"
);
assert.match(restoreSource, /sharedStatePendingPatch = snapshot\.pendingPatch \? clone\(snapshot\.pendingPatch\) : null/u);
assert.match(restoreSource, /persistSharedStateRecovery\(\)[\s\S]*?reloadSharedApplicationState/u);
assert.match(restoreSource, /applySharedApplicationStatePatchLocally\(latestBaseline, snapshot\.draftPatch\)/u);
assert.match(restoreSource, /snapshot\.trainingEndNotificationSettings[\s\S]*?Object\.assign\(state\.data\.meta/u);
assert.match(
  restoreSource,
  /applySharedApplicationStatePatchLocally\(latestBaseline, snapshot\.draftPatch\)[\s\S]*?render\(\)/u,
  "После rebase редактор должен отобразить множества, добавленные другим пользователем."
);
assert.doesNotMatch(restoreSource, /localStorage\.removeItem/u);

assert.match(appSource, /commissionSets:\s*\[[\s\S]*?Председатель комиссии/u);
assert.match(styleSource, /\.program-commission-settings-card\s*\{/u);
assert.match(styleSource, /\.program-commission-settings-grid\s*\{/u);
assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*?\.program-commission-settings-grid/u);

console.log("Program commission settings tests passed.");
