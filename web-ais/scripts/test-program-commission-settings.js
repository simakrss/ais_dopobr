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
const tableSource = extractBetween(
  "  function renderProgramCommissionSettingsDictionary",
  "\n  function programCommissionSetsEqual"
);
const dialogSource = extractBetween(
  "  function openProgramCommissionSettingDialog",
  "\n  function addProgramCommissionSetting"
);
const bindingSource = extractBetween(
  "  function bindProgramCommissionSettingsControls",
  "\n  const dictionarySearchStaticContent"
);
assert.match(tableSource, /data-program-commission-settings-table-wrap/u);
assert.match(tableSource, /role="region"[\s\S]*?<table class="program-commission-settings-table"/u);
assert.match(tableSource, /<thead>[\s\S]*?<tbody>/u);
assert.match(tableSource, /<th scope="col">Название<\/th>[\s\S]*?<th scope="col">Состав комиссии<\/th>[\s\S]*?<th scope="col">Программ<\/th>/u);
assert.match(tableSource, /data-program-commission-set-row/u);
assert.match(tableSource, /program-commission-settings-cell-value[\s\S]*?title="\$\{escapeMultilineAttr\(compositionTitle\)\}"/u);
assert.doesNotMatch(tableSource, /<form|<input|<textarea/u, "В таблице не должно быть постоянно раскрытых полей редактирования.");
assert.doesNotMatch(tableSource, /program-commission-settings-card|program-commission-settings-grid/u);
assert.match(editorSource, /data-action="add-program-commission-set"/u);
assert.match(editorSource, /data-action="open-program-commission-set"/u);
assert.match(editorSource, /data-action="remove-program-commission-set"/u);
assert.match(dialogSource, /role="dialog"[\s\S]*?aria-modal="true"/u);
assert.match(dialogSource, /form data-action="save-program-commission-set-dialog"/u);
assert.match(dialogSource, /name="name"[\s\S]*?required/u);
assert.match(dialogSource, /PROGRAM_COMMISSION_FIELD_KEYS[\s\S]*?textarea name="\$\{escapeAttr\(field\.key\)\}"/u);
assert.match(dialogSource, /program-commission-setting-dialog-usage[\s\S]*?usage\.names/u);
for (const key of ["commissionChair", "commissionMember1", "commissionMember2", "secretary"]) {
  assert.ok(
    appSource.includes(`"${key}"`),
    `Не найдено обязательное поле состава комиссии ${key}.`
  );
}
assert.match(dialogSource, /Укажите название множества комиссии/u);
assert.match(dialogSource, /Названия множеств комиссий не должны повторяться/u);
assert.match(dialogSource, /hasUnsavedFormChanges\(form\)[\s\S]*?chooseUnsavedChangesAction/u);
assert.match(
  dialogSource,
  /commissionSet\s*\?\s*\(state\.data\.collections\.commissionSets \|\| \[\]\)\.map\([\s\S]*?\? nextCommissionSet\s*:\s*item[\s\S]*?\)\)\s*:\s*\[nextCommissionSet,\s*\.\.\.\(state\.data\.collections\.commissionSets \|\| \[\]\)\]/u,
  "Редактирование должно заменять только выбранное множество, а создание — сохранять все существующие."
);
assert.match(dialogSource, /id:\s*commissionSet\?\.id \|\| makeId\("commission-set"\)/u);
assert.match(
  dialogSource,
  /const trapFocus = \(event\) => \{[\s\S]*?event\.key !== "Tab"[\s\S]*?document\.activeElement === first[\s\S]*?document\.activeElement === last/u,
  "Модальная форма должна удерживать клавиатурный фокус внутри себя."
);
assert.match(editorSource, /if \(usage\.count\)[\s\S]*?Сначала выберите для них другой состав комиссии/u);
assert.doesNotMatch(
  dialogSource,
  /state\.data\.collections\.programs\s*=|programRows\.splice/u,
  "Модальный редактор множеств не должен перезаписывать полные записи программ."
);
assert.doesNotMatch(dialogSource, /\bpersist\(\)/u, "Модальная форма должна оставлять финальное сохранение общей кнопке настроек.");
assert.match(dialogSource, /markSettingsDraftDirty\(\)/u);
assert.match(dialogSource, /form\?\.addEventListener\("submit"/u);
assert.match(editorSource, /function addProgramCommissionSetting\(\)[\s\S]*?openProgramCommissionSettingDialog\(\)/u);
assert.match(
  bindingSource,
  /data-action="add-program-commission-set"[\s\S]*?addEventListener\("click", addProgramCommissionSetting\)/u,
  "Кнопка создания должна открывать модальную форму."
);
assert.match(
  bindingSource,
  /data-action="open-program-commission-set"[\s\S]*?addEventListener\("click", \(\) => openProgramCommissionSettingDialog\(button\.dataset\.commissionSetId\)\)/u,
  "Название и кнопка редактирования должны открывать выбранное множество."
);
assert.match(
  bindingSource,
  /data-program-commission-set-row[\s\S]*?row\.addEventListener\("click"[\s\S]*?event\.target\.closest\("button, a, input, select, textarea"\)[\s\S]*?openProgramCommissionSettingDialog\(row\.dataset\.commissionSetId\)/u,
  "Щелчок по свободной области строки должен открывать выбранное множество, не перехватывая кнопки действий."
);
assert.match(
  bindingSource,
  /data-action="remove-program-commission-set"[\s\S]*?addEventListener\("click", \(\) => removeProgramCommissionSetting\(button\)\)/u,
  "Кнопка удаления должна быть подключена."
);
assert.match(
  appSource,
  /\bbindProgramCommissionSettingsControls\(\);/u,
  "Обработчики таблицы комиссий должны подключаться после render()."
);
assert.match(
  appSource,
  /const programCommissionDialog = document\.querySelector\("\[data-program-commission-setting-dialog\]"\)[\s\S]*?closeProgramCommissionSettingDialog/u,
  "Escape должен закрывать верхнюю модальную форму комиссии через общую маршрутизацию окон."
);

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
assert.match(styleSource, /\.program-commission-settings\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\)[\s\S]*?overflow:\s*hidden/u);
assert.match(styleSource, /\.program-commission-settings-table-wrap\s*\{[\s\S]*?min-height:\s*180px[\s\S]*?overflow:\s*auto/u);
assert.match(styleSource, /\.program-commission-settings-table\s*\{[\s\S]*?table-layout:\s*fixed/u);
assert.match(
  styleSource,
  /\.program-commission-settings-cell-value\s*\{[\s\S]*?overflow:\s*hidden[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/u
);
assert.match(styleSource, /\.program-commission-setting-dialog\s*\{[\s\S]*?max-height:[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\)[\s\S]*?overflow:\s*hidden/u);
assert.match(styleSource, /\.program-commission-setting-dialog-body\s*\{[\s\S]*?overflow:\s*auto/u);
assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*?\.program-commission-setting-dialog-fields[\s\S]*?grid-template-columns:\s*1fr/u);
assert.match(
  styleSource,
  /@media \(max-width: 720px\)[\s\S]*?\.program-commission-settings-table\s*\{[\s\S]*?min-width:\s*0[\s\S]*?\.program-commission-settings-table th:nth-child\(2\)[\s\S]*?display:\s*none/u,
  "На мобильном сводный состав должен скрываться, чтобы таблица помещалась во вкладку без горизонтального растяжения."
);

console.log("Program commission settings tests passed.");
