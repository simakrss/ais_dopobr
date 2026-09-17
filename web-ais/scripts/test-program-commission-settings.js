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
const sharedFlushSource = extractBetween(
  "  function flushSharedApplicationState",
  "\n  async function performSharedApplicationStateSave"
);
const sharedGenerationFlushSource = extractBetween(
  "  async function flushSharedApplicationStateThroughGeneration",
  "\n  function saveSharedApplicationStateInBackground"
);
const beginSettingsDraftSource = extractBetween(
  "  function beginSettingsDraftSession",
  "\n  function endSettingsDraftSession"
);
const settingsSaveSnapshotSource = extractBetween(
  "  function createProgramCommissionSettingsSaveSnapshot",
  "\n  async function restoreFailedProgramCommissionSettingsSave"
);
const waitForSharedSaveSource = extractBetween(
  "  async function waitForActiveSharedApplicationStateSave",
  "\n  function waitForSettingsSharedStateRetry"
);
assert.match(settingsSaveSource, /programCommissionSettingsChanged[\s\S]*?strictRevision:\s*true/u);
assert.match(
  appSource,
  /function hasProgramCommissionSettingsChanges\([\s\S]*?sharedStatePendingPatch[\s\S]*?sharedBaseline/u,
  "Изменение commissionSets из автономной очереди тоже должно включать строгий режим."
);
assert.doesNotMatch(
  settingsSaveSource,
  /sharedStateRevision > state\.settingsDraftBaseRevision[\s\S]*?settingsDraftBaseRevision = sharedStateRevision/u,
  "Базовую ревизию нельзя повышать без авторитетного снимка и трёхстороннего rebase."
);
assert.doesNotMatch(
  settingsSaveSource,
  /Дождитесь завершения текущей синхронизации|Отмените черновик, обновите раздел и повторите изменение/u,
  "Активную запись и обычный конфликт ревизий нужно обработать автоматически, без старого ручного сценария."
);
assert.match(
  settingsSaveSource,
  /settingsDraftSavePreparing = true;[\s\S]*?await waitForActiveSharedApplicationStateSave\(\)[\s\S]*?settingsDraftSavePreparing = false;\s*state\.settingsDraftSaving = true/u,
  "Ожидание активной записи должно начаться до основного сохранения, оставаясь видимым как занятое состояние настроек."
);
assert.equal(
  (settingsSaveSource.match(/state\.settingsDraftSaving = true/gu) || []).length,
  1,
  "Основное сохранение настроек должно запускаться один раз после предварительного ожидания."
);
assert.match(settingsSaveSource, /requestAuthoritativeSharedStateForSettingsSave\(\)/u);
assert.match(
  settingsSaveSource,
  /applyProgramCommissionSettingsRebase\(prepared, payload\);\s*persist\(\{ forceSettingsDraft: true, scheduleSharedSave: false \}\);[\s\S]*?flushSharedApplicationStateThroughGeneration/u,
  "Strict retry комиссий должен сам запускать единственный flush без параллельного фонового таймера."
);
assert.match(
  settingsSaveSource,
  /\} else \{\s*persist\(\{ forceSettingsDraft: true \}\);\s*sharedStateSaveStarted = true;[\s\S]*?flushSharedApplicationStateThroughGeneration\(targetGeneration,\s*\{\s*allowSettingsDraft:\s*true\s*\}\)/u,
  "Обычное сохранение настроек должно сохранить стандартное автопланирование общей базы."
);
assert.equal(
  (settingsSaveSource.match(/persist\(\{ forceSettingsDraft: true, scheduleSharedSave: false \}\)/gu) || []).length,
  1,
  "В strict-цикле комиссий должен быть ровно один путь persist без фонового планирования."
);
assert.match(
  appSource,
  /async function requestAuthoritativeSharedStateForSettingsSave\(\)[\s\S]*?requestSharedApplicationState\("flush=1"[\s\S]*?payload\.syncPending === true[\s\S]*?payload\.pendingCount/u,
  "Перед rebase нужен один авторитетный снимок после завершения серверной очереди."
);
assert.match(
  settingsSaveSource,
  /attempt < SETTINGS_SHARED_STATE_SAVE_MAX_ATTEMPTS[\s\S]*?attempt > 0[\s\S]*?waitForSettingsSharedStateRetry\(attempt\)/u,
  "Повтор при гонке ревизий должен быть ограничен константой и иметь короткую задержку."
);
assert.match(
  settingsSaveSource,
  /flushSharedApplicationStateThroughGeneration\(targetGeneration,\s*\{[\s\S]*?strictRevision:\s*true[\s\S]*?baseRevision:\s*prepared\.revision[\s\S]*?deferRevisionConflict:\s*true[\s\S]*?allowSettingsDraft:\s*true/u,
  "Strict 409 должен возвращаться в цикл rebase/retry, а не включать глобальный конфликт и ручное восстановление."
);
assert.match(
  settingsSaveSource,
  /deferRevisionConflict:\s*true,\s*deferLockedSave:\s*true/u,
  "Strict 423 также должен возвращаться в ограниченный цикл ожидания и повтора."
);
assert.equal(
  (settingsSaveSource.match(/\[409, 423\]\.includes\(Number\(error\?\.status\)\)/gu) || []).length,
  2,
  "И авторитетный flush=1, и strict POST должны одинаково повторяться после 409/423."
);
assert.match(settingsSaveSource, /getRemovedUsedProgramCommissionSet\(\)[\s\S]*?Отмените удаление/u);
assert.match(settingsSaveSource, /createProgramCommissionSettingsSaveSnapshot\(\)/u);
assert.match(settingsSaveSource, /prepareProgramCommissionSettingsRebase\(\s*programCommissionSaveSnapshot,\s*payload\s*\)/u);
assert.match(settingsSaveSource, /applyProgramCommissionSettingsRebase\(prepared, payload\)/u);
assert.doesNotMatch(
  settingsSaveSource,
  /restoreFailedProgramCommissionSettingsSave\(/u,
  "Обычный 409 не должен откатывать интерфейс и требовать повторного ввода."
);
assert.match(
  appSource,
  /if \(strictRevision && options\.deferRevisionConflict === true\) \{\s*throw error;/u,
  "Транспорт общей базы должен уметь отдать strict 409 вызывающему коду для ограниченного повтора."
);
assert.match(
  appSource,
  /if \(error\.status === 423\) \{\s*if \(strictRevision && options\.deferLockedSave === true\) throw error;[\s\S]*?alert\([\s\S]*?reloadSharedApplicationState/u,
  "При deferLockedSave strict 423 должен выбрасываться до alert и reload общей базы."
);
assert.match(
  appSource,
  /function persist\(options = \{\}\)[\s\S]*?sharedStateDirty = true;[\s\S]*?if \(sharedStateReady && options\.scheduleSharedSave !== false\) \{\s*scheduleSharedApplicationStateSave\(\);/u,
  "persist должен пропускать только автопланирование, сохраняя dirty/generation/recovery для ручного strict flush."
);
assert.match(
  sharedFlushSource,
  /isSettingsDraftSessionActive\(\)\s*&& saveOptions\.allowSettingsDraft !== true/u,
  "Одиночный flush не должен отправлять state.data активного settings draft без явного разрешения."
);
assert.doesNotMatch(
  sharedFlushSource,
  /settingsDraftSaving/u,
  "Защита одиночного flush должна действовать также во время settingsDraftSaving."
);
assert.match(
  sharedGenerationFlushSource,
  /isSettingsDraftSessionActive\(\)\s*&& options\.allowSettingsDraft !== true/u,
  "Generation flush не должен отправлять активный settings draft без явного разрешения."
);
assert.doesNotMatch(
  sharedGenerationFlushSource,
  /settingsDraftSaving/u,
  "Защита generation flush не должна зависеть от промежуточного флага saving."
);
assert.match(
  beginSettingsDraftSource,
  /sharedBaseDataAtOpen = clone\(sharedStateBaseData \|\| baselineData\)[\s\S]*?state\.settingsDraftSharedBaseData = sharedBaseDataAtOpen[\s\S]*?state\.settingsDraftPendingPatch = mergeSharedApplicationStatePatches\(\s*sharedStatePendingPatch,\s*buildSharedApplicationStatePatch\(sharedBaseDataAtOpen, baselineData\)/u,
  "При открытии настроек нужно зафиксировать отдельные shared baseline и pending patch."
);
assert.match(
  settingsSaveSnapshotSource,
  /sharedBaseData:\s*clone\(state\.settingsDraftSharedBaseData \|\| sharedStateBaseData \|\| baselineData\)[\s\S]*?pendingPatch:\s*state\.settingsDraftPendingPatch/u,
  "Commission snapshot должен использовать снимки начала settings-сессии."
);
assert.match(
  settingsSaveSource,
  /state\.settingsDraftBaseline = JSON\.stringify\(state\.data\);[\s\S]*?state\.settingsDraftSharedBaseData = clone\(sharedStateBaseData \|\| state\.data\);[\s\S]*?state\.settingsDraftPendingPatch = sharedStatePendingPatch/u,
  "После успеха baseline, shared baseline и pending settings-сессии должны обновиться вместе."
);
assert.match(
  waitForSharedSaveSource,
  /while \(sharedStateSavePromise\)[\s\S]*?window\.clearTimeout\(sharedStateSaveTimer\);\s*sharedStateSaveTimer = 0;/u,
  "После ожидания активного Promise старый таймер фонового flush должен быть отменён."
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const rebaseContext = {
  clone: (value) => structuredClone(value),
  state: { data: { collections: { programs: [] } } },
  unique: (values) => [...new Set(values)],
  PROGRAM_COMMISSION_FIELD_KEYS: [
    "commissionChair",
    "commissionMember1",
    "commissionMember2",
    "secretary"
  ],
  TRAINING_END_NOTIFICATION_SERVER_META_KEYS: new Set(),
  withTrainingEndNotificationServerMeta: (data) => structuredClone(data)
};
vm.createContext(rebaseContext);
vm.runInContext(
  `${extractBetween("  function sharedStateValuesEqual", "\n  function mergeSharedApplicationStatePatches")}
${extractBetween("  function applySharedApplicationStatePatchRaw", "\n  function applySharedApplicationStatePatchLocally")}
${extractBetween("  function getProgramCommissionSetUsage", "\n  function renderProgramCommissionSettingsDictionary")}
${extractBetween("  function hasSharedApplicationStatePatchChanges", "\n  function createProgramCommissionSettingsSaveSnapshot")}
this.buildPatchForTest = buildSharedApplicationStatePatch;
this.mergeDraftForTest = mergeProgramCommissionSettingsDraft;
this.prepareRebaseForTest = prepareProgramCommissionSettingsRebase;`,
  rebaseContext
);

const baselineData = {
  collections: {
    commissionSets: [{
      id: "set-a",
      name: "Основная",
      commissionChair: "Председатель исходный",
      commissionMember1: "Член исходный",
      commissionMember2: "",
      secretary: ""
    }],
    programs: [{ id: "program-a", name: "Программа до", commissionSetId: "set-a" }],
    students: [{ id: "student-a", note: "до" }]
  },
  dictionaries: {},
  meta: {}
};
const localData = structuredClone(baselineData);
localData.collections.commissionSets[0].commissionChair = "Председатель локальный";
localData.collections.commissionSets.unshift({
  id: "set-local",
  name: "Локальная комиссия",
  commissionChair: "Новый председатель",
  commissionMember1: "",
  commissionMember2: "",
  secretary: ""
});
const latestData = structuredClone(baselineData);
latestData.collections.commissionSets[0].commissionMember1 = "Член от другого пользователя";
latestData.collections.commissionSets.push({
  id: "set-remote",
  name: "Чужая комиссия",
  commissionChair: "Чужой председатель",
  commissionMember1: "",
  commissionMember2: "",
  secretary: ""
});
latestData.collections.programs[0].name = "Программа изменена другим пользователем";
latestData.collections.students[0].note = "чужое изменение";

const localPatch = rebaseContext.buildPatchForTest(baselineData, localData);
const preparedRebase = plain(rebaseContext.prepareRebaseForTest({
  baselineData,
  localData,
  sharedBaseData: baselineData,
  draftPatch: localPatch,
  pendingPatch: null
}, {
  exists: true,
  data: latestData,
  revision: 42
}));
assert.equal(preparedRebase.conflict, undefined);
assert.equal(preparedRebase.revision, 42);
assert.equal(
  preparedRebase.data.collections.programs[0].name,
  "Программа изменена другим пользователем",
  "Rebase не должен откатывать чужую правку программы."
);
assert.equal(
  preparedRebase.data.collections.students[0].note,
  "чужое изменение",
  "Rebase не должен перезаписывать чужие данные из других коллекций."
);
const rebasedOutgoingPatch = plain(rebaseContext.buildPatchForTest(
  preparedRebase.serverData,
  preparedRebase.data
));
assert.equal(
  rebasedOutgoingPatch.collections.programs,
  undefined,
  "Чужая правка программы уже входит в server baseline и не должна повторно отправляться как локальный upsert."
);
const mergedMainSet = preparedRebase.data.collections.commissionSets.find((item) => item.id === "set-a");
assert.equal(mergedMainSet.commissionChair, "Председатель локальный");
assert.equal(
  mergedMainSet.commissionMember1,
  "Член от другого пользователя",
  "Трёхстороннее слияние должно совместить изменения разных полей одного множества."
);
assert.ok(preparedRebase.data.collections.commissionSets.some((item) => item.id === "set-local"));
assert.ok(
  preparedRebase.data.collections.commissionSets.some((item) => item.id === "set-remote"),
  "Множество, добавленное другим пользователем, должно сохраниться."
);

const conflictingLatest = structuredClone(latestData);
conflictingLatest.collections.commissionSets.find((item) => item.id === "set-a").commissionChair = "Другой председатель";
const semanticConflict = plain(rebaseContext.prepareRebaseForTest({
  baselineData,
  localData,
  sharedBaseData: baselineData,
  draftPatch: localPatch,
  pendingPatch: null
}, {
  exists: true,
  data: conflictingLatest,
  revision: 43
}));
assert.equal(semanticConflict.conflict.kind, "commission-field");
assert.equal(semanticConflict.conflict.fieldLabel, "Председатель комиссии");

const deletionLocalData = structuredClone(baselineData);
deletionLocalData.collections.commissionSets = [];
deletionLocalData.collections.programs = [];
const freshlyUsedLatest = structuredClone(baselineData);
freshlyUsedLatest.collections.programs.push({
  id: "program-new",
  name: "Новая чужая программа",
  commissionSetId: "set-a"
});
const freshUsageConflict = plain(rebaseContext.mergeDraftForTest(
  baselineData,
  deletionLocalData,
  freshlyUsedLatest
));
assert.equal(freshUsageConflict.conflict.kind, "used");
assert.equal(
  freshUsageConflict.conflict.count,
  2,
  "Перед удалением нужно учитывать актуальное использование множества из свежего серверного снимка."
);

const recoverySnapshots = [];
const queueBaseData = structuredClone(baselineData);
const queueConfirmedBaseline = structuredClone(baselineData);
queueConfirmedBaseline.collections.commissionSets[0].commissionMember2 = "Подтверждённое сервером значение";
const queueDraftData = structuredClone(queueConfirmedBaseline);
queueDraftData.collections.commissionSets[0].commissionChair = "Ещё не подтверждённый черновик";
Object.assign(rebaseContext, {
  state: {
    settingsDraftBaseline: JSON.stringify(queueConfirmedBaseline),
    data: queueDraftData
  },
  sharedStateBaseData: queueBaseData,
  sharedStatePendingPatch: null,
  sharedStateDirty: true,
  sharedStateConflict: true,
  sharedStateConflictShown: true,
  sharedStateOffline: true,
  sharedStateSyncBlockedReason: "conflict",
  persistStateToLocalStorage: () => {},
  persistSharedStateRecovery() {
    recoverySnapshots.push({
      dirty: rebaseContext.sharedStateDirty,
      pendingPatch: structuredClone(rebaseContext.sharedStatePendingPatch)
    });
  },
  updateSharedStateStatusUi: () => {}
});
vm.runInContext(
  `${extractBetween(
    "  function restoreSettingsDraftSharedStateQueueAfterFailure",
    "\n  async function saveSettingsDraftChanges"
  )}
this.restoreSettingsDraftSharedStateQueueAfterFailureForTest = restoreSettingsDraftSharedStateQueueAfterFailure;`,
  rebaseContext
);
rebaseContext.restoreSettingsDraftSharedStateQueueAfterFailureForTest({
  conflict: false,
  conflictShown: false,
  offline: false,
  syncBlockedReason: ""
});
assert.equal(recoverySnapshots.length, 1);
assert.equal(
  recoverySnapshots[0].dirty,
  false,
  "Recovery нужно сохранять при временном sharedStateDirty=false, чтобы state.data с черновиком не подмешался в pending patch."
);
const queuedCommission = recoverySnapshots[0].pendingPatch.collections.commissionSets.upserts
  .find((item) => item.id === "set-a");
assert.equal(queuedCommission.commissionMember2, "Подтверждённое сервером значение");
assert.equal(
  queuedCommission.commissionChair,
  "Председатель исходный",
  "В pending должна попасть только разница подтверждённого baseline, а не несохранённое значение из state.data."
);
assert.notEqual(queuedCommission.commissionChair, "Ещё не подтверждённый черновик");
assert.equal(
  rebaseContext.sharedStateDirty,
  true,
  "После сохранения recovery sharedStateDirty должен восстановиться из наличия pending patch."
);
assert.equal(
  rebaseContext.sharedStateConflict,
  false,
  "Ошибка strict POST не должна оставлять восстановленную очередь заблокированной conflict latch."
);
assert.equal(rebaseContext.sharedStateConflictShown, false);
assert.equal(rebaseContext.sharedStateOffline, false);
assert.equal(
  rebaseContext.sharedStateSyncBlockedReason,
  "",
  "После ошибки strict POST нужно вернуть syncBlockedReason, зафиксированный до попытки."
);

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
