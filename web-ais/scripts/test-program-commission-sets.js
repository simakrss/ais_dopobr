"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n?/gu, "\n");
const registrySource = fs.readFileSync(
  path.join(root, "data", "program-payment-registry.js"),
  "utf8"
).replace(/\r\n?/gu, "\n");

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Не найдено начало блока: ${startMarker}`);
  assert.ok(end > start, `Не найден конец блока: ${endMarker}`);
  return source.slice(start, end).replace(/^  /gmu, "");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

let generatedId = 0;
const context = {
  makeId: (prefix) => `${prefix}-test-${++generatedId}`,
  state: { data: { collections: { commissionSets: [], programs: [] } } }
};
context.getProgramRows = () => context.state.data.collections.programs;
vm.createContext(context);
vm.runInContext(
  [
    extractBetween(
      appSource,
      "  const PROGRAM_COMMISSION_FIELD_KEYS",
      "\n  const PROGRAM_FIELD_ALIASES"
    ),
    extractBetween(
      appSource,
      "  function normalizeProgramName",
      "\n  function compareProgramNames"
    ),
    extractBetween(
      appSource,
      "  function buildLegacyRecordId",
      "\n  function ensureDirectExpenseId"
    ),
    extractBetween(
      appSource,
      "  function normalizeProgramCommissionValue",
      "\n  function normalizeProgramRecord"
    ),
    extractBetween(
      appSource,
      "  function findProgramCommissionSourceByName",
      "\n  function applyProgramCommissionSource"
    ),
    `this.programCommissionFieldKeysForTest = [...PROGRAM_COMMISSION_FIELD_KEYS];
this.synchronizeProgramCommissionSetsForTest = synchronizeProgramCommissionSets;
this.resolveProgramCommissionRecordForTest = resolveProgramCommissionRecord;
this.prepareImportedProgramCommissionLinksForTest = prepareImportedProgramCommissionLinks;
this.findProgramCommissionSourceByNameForTest = findProgramCommissionSourceByName;`
  ].join("\n\n"),
  context
);

const commissionFieldKeys = [
  "commissionChair",
  "commissionMember1",
  "commissionMember2",
  "secretary"
];
assert.deepEqual(
  plain(context.programCommissionFieldKeysForTest),
  commissionFieldKeys,
  "Состав комиссии должен содержать ровно четыре общих поля; commissionSetId является отдельной связью."
);

function commission(prefix) {
  return {
    commissionChair: `${prefix}: председатель`,
    commissionMember1: `${prefix}: член 1`,
    commissionMember2: `${prefix}: член 2`,
    secretary: `${prefix}: секретарь`
  };
}

function normalizedCommissionSignature(value = {}) {
  return commissionFieldKeys
    .map((key) => String(value[key] || "").replace(/\r\n?/gu, "\n").trim())
    .join("\u001f");
}

function assertProgramUsesSet(program, commissionSet, message) {
  assert.equal(program.commissionSetId, commissionSet.id, `${message}: неверная связь commissionSetId.`);
  commissionFieldKeys.forEach((key) => {
    assert.equal(program[key], commissionSet[key], `${message}: не синхронизировано поле ${key}.`);
  });
}

// Legacy migration: equal four-field compositions collapse into one deterministic set.
const legacyA = commission("A");
const legacyB = commission("B");
const legacyPrograms = [
  { id: "legacy-1", name: "Программа 1", ...legacyA },
  {
    id: "legacy-2",
    name: "Программа 2",
    commissionChair: `  ${legacyA.commissionChair}\r\n`,
    commissionMember1: legacyA.commissionMember1,
    commissionMember2: legacyA.commissionMember2,
    secretary: legacyA.secretary
  },
  { id: "legacy-3", name: "Программа 3", ...legacyB },
  { id: "legacy-empty", name: "Без комиссии" }
];
const legacySnapshot = plain(legacyPrograms);
const migratedLegacy = context.synchronizeProgramCommissionSetsForTest(legacyPrograms, []);
assert.equal(migratedLegacy.commissionSets.length, 2, "Одинаковые legacy-составы должны дедуплицироваться.");
assert.equal(
  migratedLegacy.programs[0].commissionSetId,
  migratedLegacy.programs[1].commissionSetId,
  "Программы с одинаковым legacy-составом должны ссылаться на одно множество."
);
assert.notEqual(
  migratedLegacy.programs[0].commissionSetId,
  migratedLegacy.programs[2].commissionSetId,
  "Разные legacy-составы не должны объединяться."
);
assert.equal(migratedLegacy.programs[3].commissionSetId, "", "Пустой legacy-состав не должен создавать множество.");
assert.deepEqual(legacyPrograms, legacySnapshot, "Миграция не должна изменять входные программы.");
const migratedLegacyAgain = context.synchronizeProgramCommissionSetsForTest(
  migratedLegacy.programs,
  migratedLegacy.commissionSets
);
assert.deepEqual(
  plain(migratedLegacyAgain),
  plain(migratedLegacy),
  "Повторная синхронизация legacy-составов должна быть идемпотентной."
);
const editedLegacySet = {
  ...migratedLegacy.commissionSets[0],
  commissionChair: "Новый председатель общего legacy-множества"
};
const legacyProgramsWithoutStoredLinks = legacyPrograms.map((program) => ({ ...program }));
const resolvedEditedLegacy = context.synchronizeProgramCommissionSetsForTest(
  legacyProgramsWithoutStoredLinks,
  [editedLegacySet, migratedLegacy.commissionSets[1]]
);
assert.equal(
  resolvedEditedLegacy.programs[0].commissionSetId,
  editedLegacySet.id,
  "Legacy-программа без сохранённой связи должна находить изменённое множество по стабильному ID."
);
assert.equal(
  resolvedEditedLegacy.programs[0].commissionChair,
  editedLegacySet.commissionChair,
  "Изменённый общий состав не должен откатываться к старому legacy-снимку после загрузки."
);
assert.equal(
  resolvedEditedLegacy.commissionSets.length,
  2,
  "После изменения legacy-множества не должен создаваться дубликат со старым составом."
);

// Pin the current registry migration: its non-empty legacy records form five shared sets.
const registryWindow = {};
vm.runInNewContext(registrySource, { window: registryWindow });
const registryPrograms = registryWindow.AIS_PROGRAM_PAYMENT_REGISTRY;
assert.ok(Array.isArray(registryPrograms), "Не удалось загрузить реестр образовательных программ.");
const registryProgramsWithCommission = registryPrograms.filter((program) => (
  commissionFieldKeys.some((key) => String(program[key] || "").trim())
));
const registryLegacySignatures = new Set(
  registryProgramsWithCommission.map(normalizedCommissionSignature)
);
assert.equal(registryLegacySignatures.size, 5, "Текущий legacy-реестр должен содержать пять уникальных составов.");
const migratedRegistry = context.synchronizeProgramCommissionSetsForTest(registryPrograms, []);
assert.equal(
  migratedRegistry.commissionSets.length,
  registryLegacySignatures.size,
  "Каждый уникальный legacy-состав должен создать ровно одно множество."
);
assert.equal(
  migratedRegistry.programs.filter((program) => program.commissionSetId).length,
  registryProgramsWithCommission.length,
  "Каждая программа с legacy-комиссией должна получить пятую сущность связи commissionSetId."
);
const migratedRegistrySetsById = new Map(
  migratedRegistry.commissionSets.map((commissionSet) => [commissionSet.id, commissionSet])
);
migratedRegistry.programs.filter((program) => program.commissionSetId).forEach((program) => {
  assertProgramUsesSet(
    program,
    migratedRegistrySetsById.get(program.commissionSetId),
    `Программа ${program.name || "без названия"}`
  );
});
assert.deepEqual(
  plain(context.synchronizeProgramCommissionSetsForTest(
    migratedRegistry.programs,
    migratedRegistry.commissionSets
  )),
  plain(migratedRegistry),
  "Миграция фактического реестра должна быть идемпотентной."
);

// Editing one central set changes effective values everywhere without mutating program records.
const setA = { id: "set-a", name: "Основная комиссия", ...commission("A") };
const setB = { id: "set-b", name: "Резервная комиссия", ...commission("B") };
const cascadePrograms = [
  { id: "linked-a-1", name: "Связанная A1", commissionSetId: setA.id, ...commission("A") },
  { id: "linked-a-2", name: "Связанная A2", commissionSetId: setA.id, ...commission("A") },
  { id: "linked-b", name: "Связанная B", commissionSetId: setB.id, ...commission("B") },
  { id: "individual", name: "Индивидуальная", commissionSetId: "", ...commission("Личная") }
];
const cascadeInputSnapshot = plain(cascadePrograms);
const changedA = commission("A изменена");
const updatedSetA = { ...setA, name: "Основная комиссия (обновлена)", ...changedA };
const updatedSets = [updatedSetA, setB];
cascadePrograms.slice(0, 2).forEach((program) => {
  assertProgramUsesSet(
    context.resolveProgramCommissionRecordForTest(program, updatedSets),
    updatedSetA,
    program.name
  );
});
assert.deepEqual(
  plain(context.resolveProgramCommissionRecordForTest(cascadePrograms[2], updatedSets)),
  plain(cascadePrograms[2]),
  "Изменение множества A не должно менять программу множества B."
);
assert.deepEqual(
  plain(context.resolveProgramCommissionRecordForTest(cascadePrograms[3], updatedSets)),
  plain(cascadePrograms[3]),
  "Изменение множества A не должно менять программу без связи."
);
assert.deepEqual(
  plain(updatedSets.find((item) => item.id === setB.id)),
  plain(setB),
  "Изменение множества A не должно менять множество B."
);
assert.deepEqual(
  plain(cascadePrograms),
  cascadeInputSnapshot,
  "Централизованное изменение не должно мутировать полные записи программ."
);

// Every one of the four managed Excel fields is sufficient to detach a stale shared link.
commissionFieldKeys.forEach((changedField) => {
  const previous = {
    id: `excel-${changedField}`,
    name: `Excel ${changedField}`,
    commissionSetId: setA.id,
    ...commission("A")
  };
  const imported = { ...previous, [changedField]: `${previous[changedField]} (из Excel)` };
  const prepared = context.prepareImportedProgramCommissionLinksForTest(
    [imported],
    [previous],
    [setA, setB],
    [changedField]
  );
  assert.equal(
    prepared[0].commissionSetId,
    "",
    `Изменение Excel-поля ${changedField} должно снять прежнюю связь.`
  );
});

// Full Excel flow: only the changed program is relinked; its neighbour keeps set A.
const previousExcelPrograms = [
  { id: "excel-changed", name: "Изменённая", commissionSetId: setA.id, ...commission("A") },
  { id: "excel-unchanged", name: "Неизменённая", commissionSetId: setA.id, ...commission("A") },
  { id: "excel-already-b", name: "Уже B", commissionSetId: setB.id, ...commission("B") }
];
const importedExcelPrograms = [
  { ...previousExcelPrograms[0], ...commission("B") },
  { ...previousExcelPrograms[1] },
  { ...previousExcelPrograms[2] }
];
const preparedExcelPrograms = context.prepareImportedProgramCommissionLinksForTest(
  importedExcelPrograms,
  previousExcelPrograms,
  [setA, setB],
  commissionFieldKeys
);
assert.equal(preparedExcelPrograms[0].commissionSetId, "", "Изменённая программа должна быть отвязана до синхронизации.");
assert.equal(preparedExcelPrograms[1].commissionSetId, setA.id, "Неизменённая программа должна сохранить связь A.");
assert.equal(preparedExcelPrograms[2].commissionSetId, setB.id, "Посторонняя программа должна сохранить связь B.");
const relinkedExcel = context.synchronizeProgramCommissionSetsForTest(
  preparedExcelPrograms,
  [setA, setB]
);
assert.equal(relinkedExcel.commissionSets.length, 2, "Совпавший состав не должен создавать дубликат множества.");
assertProgramUsesSet(relinkedExcel.programs[0], setB, "Изменённая Excel-программа");
assertProgramUsesSet(relinkedExcel.programs[1], setA, "Неизменённая Excel-программа");
assertProgramUsesSet(relinkedExcel.programs[2], setB, "Посторонняя Excel-программа");
assert.deepEqual(plain(relinkedExcel.commissionSets), plain([setA, setB]), "Excel-импорт не должен изменять общие множества.");

const brandNewCommission = commission("Новая из Excel");
const preparedBrandNew = context.prepareImportedProgramCommissionLinksForTest(
  [{ ...previousExcelPrograms[0], ...brandNewCommission }, { ...previousExcelPrograms[1] }],
  previousExcelPrograms.slice(0, 2),
  [setA, setB],
  commissionFieldKeys
);
const relinkedBrandNew = context.synchronizeProgramCommissionSetsForTest(preparedBrandNew, [setA, setB]);
assert.equal(relinkedBrandNew.commissionSets.length, 3, "Новый Excel-состав должен создать одно новое множество.");
assert.notEqual(relinkedBrandNew.programs[0].commissionSetId, setA.id);
assert.notEqual(relinkedBrandNew.programs[0].commissionSetId, setB.id);
assert.equal(relinkedBrandNew.programs[1].commissionSetId, setA.id, "Соседняя программа не должна перепривязываться.");
assertProgramUsesSet(
  relinkedBrandNew.programs[0],
  relinkedBrandNew.commissionSets.find((item) => item.id === relinkedBrandNew.programs[0].commissionSetId),
  "Программа с новым Excel-составом"
);

// Commission source lookup must inspect program.name and no other program field.
const searchTarget = {
  id: "search-target",
  name: "Охрана труда: основная программа",
  shortName: "SHORT-NAME-ONLY-MARKER",
  landingCode: "LANDING-ONLY-MARKER",
  type: "TYPE-ONLY-MARKER",
  hours: "987654-HOURS-ONLY-MARKER",
  commissionChair: "CHAIR-ONLY-MARKER",
  commissionMember1: "MEMBER-ONLY-MARKER"
};
context.state.data.collections.programs = [
  searchTarget,
  { id: "search-other", name: "Пожарная безопасность" },
  { id: "search-ambiguous-1", name: "Общая программа один" },
  { id: "search-ambiguous-2", name: "Общая программа два" }
];
const exactSource = context.findProgramCommissionSourceByNameForTest("  ОХРАНА   ТРУДА: ОСНОВНАЯ ПРОГРАММА  ");
assert.equal(exactSource.program?.id, searchTarget.id, "Точный поиск должен находить программу по name.");
assert.equal(exactSource.ambiguous, false);
const partialSource = context.findProgramCommissionSourceByNameForTest("труда: основная");
assert.equal(partialSource.program?.id, searchTarget.id, "Частичный поиск должен искать только внутри name.");
[
  ["shortName", searchTarget.shortName],
  ["landingCode", searchTarget.landingCode],
  ["type", searchTarget.type],
  ["hours", searchTarget.hours],
  ["commissionChair", searchTarget.commissionChair],
  ["commissionMember1", searchTarget.commissionMember1]
].forEach(([field, query]) => {
  const result = context.findProgramCommissionSourceByNameForTest(query);
  assert.equal(result.program, null, `Источник комиссии не должен находиться только по полю ${field}.`);
  assert.equal(result.ambiguous, false);
});
const excludedCurrent = context.findProgramCommissionSourceByNameForTest(searchTarget.name, searchTarget.id);
assert.equal(excludedCurrent.program, null, "Текущая программа не должна предлагаться как источник самой себе.");
const ambiguousSource = context.findProgramCommissionSourceByNameForTest("общая программа");
assert.equal(ambiguousSource.program, null);
assert.equal(ambiguousSource.ambiguous, true, "Несколько совпадений по name должны отмечаться как неоднозначные.");

const commissionSaveSource = extractBetween(
  appSource,
  "  function applyProgramCommissionConfiguration",
  "\n  function saveFormRecord"
);
assert.match(commissionSaveSource, /const commissionSet = getProgramCommissionSetById\(selectedId\)/u);
assert.match(commissionSaveSource, /values\.commissionSetId = commissionSet\.id/u);
assert.match(commissionSaveSource, /values\[key\] = normalizeProgramCommissionValue\(commissionSet\[key\]\)/u);
assert.doesNotMatch(
  commissionSaveSource,
  /upsertProgramCommissionSet|state\.data\.collections\.commissionSets/u,
  "Карточка программы не должна изменять центральные множества комиссий."
);
const assignmentStrictSource = extractBetween(
  appSource,
  "  function getProgramCommissionAssignmentStrictSaveOptions",
  "\n  function saveFormRecord"
);
const assignmentStrictContext = {
  unique: (values) => [...new Set(values)]
};
vm.createContext(assignmentStrictContext);
vm.runInContext(
  `${assignmentStrictSource.replace(/^  /gmu, "")}
this.getProgramCommissionAssignmentStrictSaveOptionsForTest = getProgramCommissionAssignmentStrictSaveOptions;`,
  assignmentStrictContext
);
const assignmentForm = (selectedId, originalId = "set-a", id = "program-1") => ({
  dataset: {
    id,
    config: "programs",
    programCommissionOriginalSetId: originalId,
    programCommissionBaseRevision: "17"
  },
  querySelector: () => ({ value: selectedId })
});
assert.equal(
  assignmentStrictContext.getProgramCommissionAssignmentStrictSaveOptionsForTest(assignmentForm("set-a")),
  null,
  "Неизменённая связь не должна переводить обычное сохранение программы в строгий режим."
);
const pendingRecoveryForm = assignmentForm("set-a");
pendingRecoveryForm.dataset.programCommissionPendingAuditIds = JSON.stringify(["audit-delayed"]);
assert.equal(
  assignmentStrictContext.getProgramCommissionAssignmentStrictSaveOptionsForTest(pendingRecoveryForm)?.strictRevision,
  true,
  "Неподтверждённая попытка должна оставаться строгой даже после возврата исходного выбора."
);
const changedAssignmentOptions = JSON.parse(JSON.stringify(
  assignmentStrictContext.getProgramCommissionAssignmentStrictSaveOptionsForTest(assignmentForm("set-b"))
));
assert.equal(changedAssignmentOptions.strictRevision, true);
assert.equal(changedAssignmentOptions.baseRevision, 17);
const duplicatedProgramOptions = JSON.parse(JSON.stringify(
  assignmentStrictContext.getProgramCommissionAssignmentStrictSaveOptionsForTest(
    assignmentForm("set-a", "set-a", "")
  )
));
assert.equal(
  duplicatedProgramOptions.strictRevision,
  true,
  "Новая или дублированная программа с готовой связью должна проверять существование множества строго."
);
assert.equal(
  assignmentStrictContext.getProgramCommissionAssignmentStrictSaveOptionsForTest(
    assignmentForm("", "", "")
  ),
  null,
  "Новая программа без комиссии не требует строгого сохранения."
);
const programCommissionSectionSource = extractBetween(
  appSource,
  "  function renderProgramCommissionSection",
  "\n  function renderProgramParticipantsSection"
);
assert.match(programCommissionSectionSource, /select name="commissionSetId" data-program-commission-set-select/u);
assert.match(programCommissionSectionSource, /data-action="apply-program-commission-source"/u);
assert.match(programCommissionSectionSource, /Настройки → Комиссии/u);
assert.doesNotMatch(programCommissionSectionSource, /PROGRAM_COMMISSION_NEW_SET_VALUE|commissionSetName|data-program-commission-set-name/u);
assert.doesNotMatch(
  programCommissionSectionSource,
  /fields\.map\(\(item\) => renderField/u,
  "В карточке программы состав множества должен отображаться без редактируемых полей."
);
const importSource = extractBetween(
  appSource,
  "  async function importStudentsFromDatabase",
  "\n  function importJson"
);
assert.match(
  importSource,
  /const nextPrograms = prepareImportedProgramCommissionLinks\([\s\S]*?isSynchronizationImport\s*\?\s*payload\.programDatabaseSyncFields\s*:\s*PROGRAM_COMMISSION_FIELD_KEYS/u,
  "Изменения комиссии нужно учитывать и при обычной загрузке XLSB, и при синхронизации."
);
const exportProgramsSource = extractBetween(
  appSource,
  "  function buildStudentDatabaseExportPrograms",
  "\n  function buildStudentDatabaseExportProgramDictionaries"
);
assert.match(exportProgramsSource, /normalizeProgramRecord\(resolveProgramCommissionRecord\(source\)\)/u);
const saveRecordSource = extractBetween(appSource, "  async function saveRecord", "\n  function normalizeStudentPhotoRotation");
assert.match(appSource, /data-program-commission-original-set-id="\$\{escapeAttr\(record\?\.commissionSetId \|\| ""\)\}"/u);
assert.match(appSource, /data-program-commission-base-revision="\$\{sharedStateRevision\}"/u);
assert.match(saveRecordSource, /prepareProgramCommissionAssignmentSave\(form\)/u);
assert.match(saveRecordSource, /flushProgramCommissionAssignmentSave\(commissionAssignmentSave, generation\)/u);
assert.doesNotMatch(saveRecordSource, /getProgramCommissionStrictSaveOptions/u);
const continuationSaveSource = extractBetween(
  appSource,
  "  async function saveRecordFormBeforeContinuation",
  "\n  function resetStudentCardTransientState"
);
assert.match(continuationSaveSource, /prepareProgramCommissionAssignmentSave\(formElement\)/u);
assert.match(continuationSaveSource, /reconcileProgramCommissionAssignmentBeforeRetry\(formElement\)/u);
assert.match(
  continuationSaveSource,
  /flushProgramCommissionAssignmentSave\(commissionAssignmentSave, generation\)/u,
  "Сохранение перед закрытием или переходом тоже должно проверять ревизию назначения комиссии."
);
const assignmentRestoreSource = extractBetween(
  appSource,
  "  async function restoreFailedProgramCommissionAssignmentSave",
  "\n  async function flushProgramCommissionAssignmentSave"
);
assert.match(assignmentRestoreSource, /const confirmedProgram[\s\S]*?const currentAttemptCommitted = Boolean/u);
assert.match(
  assignmentRestoreSource,
  /const confirmedAuditIds = new Set[\s\S]*?context\.attemptAuditIds\.every/u,
  "Неопределённый POST считается подтверждённым только по уникальной записи атомарного аудита."
);
assert.match(assignmentRestoreSource, /context\.priorAttemptAuditIds\?\.some/u);
assert.match(assignmentRestoreSource, /form\.dataset\.id = knownCommittedProgram \? String\(context\.savedId/u);
assert.match(assignmentRestoreSource, /form\.dataset\.programCommissionOriginalSetId = String/u);
assert.match(assignmentRestoreSource, /form\.dataset\.programCommissionBaseRevision = String\(sharedStateRevision\)/u);
assert.match(assignmentRestoreSource, /form\.dataset\.programCommissionPendingSavedId = String/u);
assert.match(assignmentRestoreSource, /setProgramCommissionPendingAuditIds\(form, pendingAuditIds\)/u);
assert.match(
  assignmentRestoreSource,
  /form\.dataset\.programCommissionPendingSavedId = String\([\s\S]*?persistSharedStateRecovery\(\);[\s\S]*?reloadSharedApplicationState/u,
  "До контрольного GET новая форма должна получить повторно используемый id даже при полном отсутствии сети."
);
const formSaveSource = extractBetween(appSource, "  function saveFormRecord", "\n  function getFormSubmitButton");
assert.match(formSaveSource, /deferPost: deferAuditPost/u);
assert.match(formSaveSource, /deferredAuditEntries\?\.push\(auditEntry\)/u);
assert.match(
  formSaveSource,
  /const pendingSavedId = isProgramCard[\s\S]*?String\(formElement\.dataset\.programCommissionPendingSavedId \|\| ""\)\.trim\(\)[\s\S]*?savedId = pendingSavedId \|\| makeId\(config\.collection\)/u,
  "Повтор неопределённого создания должен использовать тот же id и не создавать дубль программы."
);
assert.match(formSaveSource, /pendingSavedId && existingIndex >= 0/u);
assert.match(appSource, /postDeferredProgramCommissionAssignmentAudit\(context\)/u);
assert.match(saveRecordSource, /reconcileProgramCommissionAssignmentBeforeRetry\(form\)/u);
const assignmentRetrySource = extractBetween(
  appSource,
  "  async function reconcileProgramCommissionAssignmentBeforeRetry",
  "\n  function saveFormRecord"
);
assert.match(
  assignmentRetrySource,
  /getProgramCommissionPendingAuditIds\(formElement\)\.length/u,
  "После неопределённого strict POST повторная попытка должна сохранять защиту даже при возврате исходного выбора."
);
assert.match(
  assignmentRetrySource,
  /!hasPendingAssignmentRecovery && !sharedStateConflict && !sharedStateOffline/u
);
assert.doesNotMatch(
  assignmentRetrySource,
  /if \(confirmedProgram\) setProgramCommissionPendingAuditIds\(formElement, \[\]\)/u,
  "Один лишь факт существования программы не подтверждает запоздавший strict POST."
);
assert.match(
  assignmentRestoreSource,
  /setProgramCommissionPendingAuditIds\(form, currentAttemptCommitted \? \[\] : pendingAuditIds\)/u,
  "Маркеры должны сохраняться, пока не подтверждена именно свежая строгая попытка."
);
const settingsSaveSource = extractBetween(
  appSource,
  "  async function saveSettingsDraftChanges",
  "\n  function cancelSettingsDraftChanges"
);
const sharedFlushSource = extractBetween(
  appSource,
  "  function flushSharedApplicationState",
  "\n  async function performSharedApplicationStateSave"
);
const sharedGenerationFlushSource = extractBetween(
  appSource,
  "  async function flushSharedApplicationStateThroughGeneration",
  "\n  function saveSharedApplicationStateInBackground"
);
assert.match(settingsSaveSource, /programCommissionSettingsChanged[\s\S]*?strictRevision:\s*true/u);
assert.match(
  settingsSaveSource,
  /programCommissionSettingsChanged[\s\S]*?await waitForActiveSharedApplicationStateSave\(\)[\s\S]*?createProgramCommissionSettingsSaveSnapshot\(\)/u,
  "Строгое сохранение множеств должно дождаться активной записи и продолжиться с новым снимком автоматически."
);
assert.doesNotMatch(
  settingsSaveSource,
  /Дождитесь завершения текущей синхронизации|Отмените черновик, обновите раздел и повторите изменение/u,
  "Сохранение комиссий не должно возвращать пользователя к ручному повтору при обычной гонке общей базы."
);
assert.match(settingsSaveSource, /requestAuthoritativeSharedStateForSettingsSave\(\)/u);
assert.match(settingsSaveSource, /attempt < SETTINGS_SHARED_STATE_SAVE_MAX_ATTEMPTS/u);
assert.match(
  settingsSaveSource,
  /applyProgramCommissionSettingsRebase\(prepared, payload\);\s*persist\(\{ forceSettingsDraft: true, scheduleSharedSave: false \}\);/u,
  "Strict retry комиссий не должен создавать конкурирующее фоновое сохранение."
);
assert.match(
  settingsSaveSource,
  /\} else \{\s*persist\(\{ forceSettingsDraft: true \}\);\s*sharedStateSaveStarted = true;[\s\S]*?allowSettingsDraft:\s*true/u,
  "Обычные настройки должны по-прежнему использовать стандартное автопланирование persist."
);
assert.match(settingsSaveSource, /baseRevision:\s*prepared\.revision/u);
assert.match(settingsSaveSource, /deferRevisionConflict:\s*true/u);
assert.match(settingsSaveSource, /deferLockedSave:\s*true/u);
assert.equal(
  (settingsSaveSource.match(/allowSettingsDraft:\s*true/gu) || []).length,
  2,
  "Обе явные ветки сохранения настроек должны обходить общую защиту settings draft только в своём контролируемом flush."
);
assert.equal(
  (settingsSaveSource.match(/\[409, 423\]\.includes\(Number\(error\?\.status\)\)/gu) || []).length,
  2,
  "Flush-снимок и strict POST должны повторяться после временного конфликта ревизии или блокировки."
);
assert.match(settingsSaveSource, /createProgramCommissionSettingsSaveSnapshot\(\)/u);
assert.match(settingsSaveSource, /prepareProgramCommissionSettingsRebase\(/u);
assert.match(settingsSaveSource, /applyProgramCommissionSettingsRebase\(/u);
assert.doesNotMatch(settingsSaveSource, /restoreFailedProgramCommissionSettingsSave\(/u);
assert.match(
  settingsSaveSource,
  /restoreSettingsDraftSharedStateQueueAfterFailure\(programCommissionSaveSnapshot\)/u
);
assert.match(
  appSource,
  /function restoreSettingsDraftSharedStateQueueAfterFailure\([\s\S]*?sharedStateDirty = false;\s*persistSharedStateRecovery\(\);\s*sharedStateDirty = pendingDirty;/u,
  "Recovery должен записывать только подтверждённую очередь, временно исключая несохранённый settings draft."
);
assert.match(
  appSource,
  /if \(error\.status === 423\) \{\s*if \(strictRevision && options\.deferLockedSave === true\) throw error;[\s\S]*?alert\([\s\S]*?reloadSharedApplicationState/u,
  "Отложенный strict 423 должен попасть в retry до alert и reload."
);
assert.match(
  appSource,
  /function persist\(options = \{\}\)[\s\S]*?if \(sharedStateReady && options\.scheduleSharedSave !== false\) \{\s*scheduleSharedApplicationStateSave\(\);/u,
  "Флаг scheduleSharedSave=false должен подавлять только постановку фонового таймера."
);
assert.match(sharedFlushSource, /isSettingsDraftSessionActive\(\)\s*&& saveOptions\.allowSettingsDraft !== true/u);
assert.doesNotMatch(sharedFlushSource, /settingsDraftSaving/u);
assert.match(sharedGenerationFlushSource, /isSettingsDraftSessionActive\(\)\s*&& options\.allowSettingsDraft !== true/u);
assert.doesNotMatch(sharedGenerationFlushSource, /settingsDraftSaving/u);
assert.match(
  appSource,
  /function beginSettingsDraftSession\([\s\S]*?state\.settingsDraftSharedBaseData = sharedBaseDataAtOpen[\s\S]*?state\.settingsDraftPendingPatch = mergeSharedApplicationStatePatches/u
);
assert.match(
  appSource,
  /function createProgramCommissionSettingsSaveSnapshot\([\s\S]*?state\.settingsDraftSharedBaseData[\s\S]*?state\.settingsDraftPendingPatch/u
);
assert.match(
  appSource,
  /async function waitForActiveSharedApplicationStateSave\([\s\S]*?window\.clearTimeout\(sharedStateSaveTimer\);\s*sharedStateSaveTimer = 0;/u
);
assert.match(
  appSource,
  /const confirmedData = payload\.data[\s\S]*?ensureDataShape\([\s\S]*?sharedStateBaseData = clone\(confirmedData \|\| data\)/u,
  "Подтверждённый baseline должен храниться после материализации множеств и не создавать ложные каскадные upsert."
);

const serverReconciliationSource = extractBetween(
  serverSource,
  "function materializeStudentDatabaseReconciledCollections",
  "\nfunction normalizeTargetedStudentFieldPatchText"
);
assert.match(serverReconciliationSource, /collections\.commissionSets/u);
assert.match(serverReconciliationSource, /getLegacyCommissionSetId/u);
assert.match(serverReconciliationSource, /nextProgram\[fieldName\]\s*=/u);
assert.match(serverReconciliationSource, /programsWithEffectiveCommissions\.map/u);

async function runProgramCommissionAssignmentRecoveryTests() {
  const form = {
    dataset: {
      id: "",
      initialSnapshot: "attempted",
      programCommissionOriginalSetId: "set-a",
      programCommissionBaseRevision: "17"
    }
  };
  const recoveryRuntime = {
    state: {
      data: { collections: { programs: [], audit: [] } },
      lastEditedRow: { config: "", id: "" },
      tablePages: {},
      modal: { config: "programs", id: "", hasDraftChanges: true }
    },
    sharedStatePendingPatch: null,
    sharedStateDirty: false,
    sharedStateConflict: false,
    sharedStateConflictShown: false,
    sharedStateSyncBlockedReason: "",
    sharedStateOffline: false,
    sharedStateRevision: 17,
    reloadFails: false,
    reloadData: { collections: { programs: [], audit: [] } },
    clone: (value) => JSON.parse(JSON.stringify(value)),
    unique: (values) => [...new Set(values)],
    ensureDataShape: (value) => value,
    persistStateToLocalStorage: () => {},
    persistSharedStateRecovery: () => {},
    updateSharedStateStatusUi: () => {},
    captureFormSnapshot: () => "confirmed",
    setTablePageForRow: () => {},
    document: { querySelector: () => form },
    setProgramCommissionPendingAuditIds: (target, values = []) => {
      const ids = [...new Set(values.map(String).filter(Boolean))];
      if (ids.length) target.dataset.programCommissionPendingAuditIds = JSON.stringify(ids);
      else delete target.dataset.programCommissionPendingAuditIds;
    }
  };
  recoveryRuntime.reloadSharedApplicationState = async () => {
    if (recoveryRuntime.reloadFails) throw new Error("offline");
    recoveryRuntime.state.data = recoveryRuntime.clone(recoveryRuntime.reloadData);
    recoveryRuntime.sharedStateRevision = 18;
  };
  vm.createContext(recoveryRuntime);
  vm.runInContext(
    `${assignmentRestoreSource.replace(/^  /gmu, "")}
this.restoreFailedProgramCommissionAssignmentSaveForTest = restoreFailedProgramCommissionAssignmentSave;`,
    recoveryRuntime
  );
  const makeContext = (snapshotOverrides = {}) => ({
    snapshot: {
      data: { collections: { programs: [], audit: [] } },
      lastEditedRow: { config: "", id: "" },
      tablePages: {},
      modal: { config: "programs", id: "", hasDraftChanges: true },
      formId: "",
      formInitialSnapshot: "baseline",
      pendingSavedId: "",
      originalCommissionSetId: "set-a",
      pendingPatch: null,
      dirty: false,
      syncBlockedReason: "",
      ...snapshotOverrides
    },
    savedId: "program-new",
    attemptedProgram: { id: "program-new", commissionSetId: "set-a" },
    attemptAuditIds: ["audit-attempt"],
    priorAttemptAuditIds: []
  });

  recoveryRuntime.reloadFails = true;
  const offlineResult = await recoveryRuntime.restoreFailedProgramCommissionAssignmentSaveForTest(makeContext());
  assert.equal(offlineResult.committed, false);
  assert.equal(form.dataset.id, "");
  assert.equal(
    form.dataset.programCommissionPendingSavedId,
    "program-new",
    "Повтор после POST/GET failure должен сохранить generated id."
  );
  assert.deepEqual(JSON.parse(form.dataset.programCommissionPendingAuditIds), ["audit-attempt"]);

  recoveryRuntime.reloadFails = false;
  recoveryRuntime.reloadData = {
    collections: {
      programs: [{ id: "program-new", commissionSetId: "set-a" }],
      audit: [{ id: "audit-attempt" }]
    }
  };
  const committedResult = await recoveryRuntime.restoreFailedProgramCommissionAssignmentSaveForTest(makeContext());
  assert.equal(committedResult.committed, true);
  assert.equal(form.dataset.id, "program-new");
  assert.equal(form.dataset.programCommissionOriginalSetId, "set-a");
  assert.equal(form.dataset.programCommissionPendingSavedId, undefined);

  recoveryRuntime.reloadData = {
    collections: {
      programs: [{ id: "program-new", commissionSetId: "set-a" }],
      audit: [{ id: "audit-previous" }]
    }
  };
  const delayedCommitContext = makeContext();
  delayedCommitContext.attemptAuditIds = ["audit-retry"];
  delayedCommitContext.priorAttemptAuditIds = ["audit-previous"];
  const delayedCommitResult = await recoveryRuntime.restoreFailedProgramCommissionAssignmentSaveForTest(
    delayedCommitContext
  );
  assert.equal(delayedCommitResult.committed, false);
  assert.equal(delayedCommitResult.priorCommitted, true);
  assert.equal(form.dataset.id, "program-new");
  assert.equal(form.dataset.programCommissionPendingSavedId, undefined);
  assert.deepEqual(
    JSON.parse(form.dataset.programCommissionPendingAuditIds),
    ["audit-previous", "audit-retry"],
    "Подтверждение предыдущей попытки не должно снимать защиту с ещё не подтверждённой свежей попытки."
  );

  recoveryRuntime.reloadData = {
    collections: {
      programs: [{ id: "program-existing", commissionSetId: "set-b" }],
      audit: []
    }
  };
  const collidedContext = makeContext({
    data: {
      collections: {
        programs: [{ id: "program-existing", commissionSetId: "set-a" }],
        audit: []
      }
    },
    formId: "program-existing",
    originalCommissionSetId: "set-a"
  });
  collidedContext.savedId = "program-existing";
  collidedContext.attemptedProgram = { id: "program-existing", commissionSetId: "set-b" };
  const collisionResult = await recoveryRuntime.restoreFailedProgramCommissionAssignmentSaveForTest(collidedContext);
  assert.equal(
    collisionResult.committed,
    false,
    "Совпавший target commissionSetId без уникального audit marker не подтверждает наш POST."
  );
  assert.deepEqual(JSON.parse(form.dataset.programCommissionPendingAuditIds), ["audit-attempt"]);
}

runProgramCommissionAssignmentRecoveryTests()
  .then(() => {
    console.log(
      "OK: множества комиссий — legacy-дедупликация, идемпотентность, каскад, Excel-перепривязка и поиск только по name."
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
