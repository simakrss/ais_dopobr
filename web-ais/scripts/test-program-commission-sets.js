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
this.upsertProgramCommissionSetForTest = upsertProgramCommissionSet;
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

// Editing a shared set cascades all four values only to programs linked to that set.
const setA = { id: "set-a", name: "Основная комиссия", ...commission("A") };
const setB = { id: "set-b", name: "Резервная комиссия", ...commission("B") };
const cascadePrograms = [
  { id: "linked-a-1", name: "Связанная A1", commissionSetId: setA.id, ...commission("A") },
  { id: "linked-a-2", name: "Связанная A2", commissionSetId: setA.id, ...commission("A") },
  { id: "linked-b", name: "Связанная B", commissionSetId: setB.id, ...commission("B") },
  { id: "individual", name: "Индивидуальная", commissionSetId: "", ...commission("Личная") }
];
const cascadeInputSnapshot = plain({ programs: cascadePrograms, commissionSets: [setA, setB] });
const changedA = commission("A изменена");
const cascadeResult = context.upsertProgramCommissionSetForTest(
  cascadePrograms,
  [setA, setB],
  setA.id,
  "Основная комиссия (обновлена)",
  changedA
);
assert.equal(cascadeResult.created, false);
assert.equal(cascadeResult.changed, true);
assert.equal(cascadeResult.commissionSets.length, 2);
const updatedSetA = cascadeResult.commissionSets.find((item) => item.id === setA.id);
assert.ok(updatedSetA, "Обновлённое множество должно сохранить свой id.");
cascadeResult.programs.slice(0, 2).forEach((program) => {
  assertProgramUsesSet(program, updatedSetA, program.name);
});
assert.deepEqual(
  plain(cascadeResult.programs[2]),
  cascadeInputSnapshot.programs[2],
  "Изменение множества A не должно менять программу множества B."
);
assert.deepEqual(
  plain(cascadeResult.programs[3]),
  cascadeInputSnapshot.programs[3],
  "Изменение множества A не должно менять программу без связи."
);
assert.deepEqual(
  plain(cascadeResult.commissionSets.find((item) => item.id === setB.id)),
  plain(setB),
  "Изменение множества A не должно менять множество B."
);
assert.deepEqual(
  plain({ programs: cascadePrograms, commissionSets: [setA, setB] }),
  cascadeInputSnapshot,
  "Каскад не должен мутировать входные данные."
);
const persistenceSafeResult = context.upsertProgramCommissionSetForTest(
  cascadePrograms,
  [setA, setB],
  setA.id,
  "Основная комиссия (без полных program upsert)",
  changedA,
  { materializeProgramSnapshots: false }
);
assert.deepEqual(
  plain(persistenceSafeResult.programs),
  plain(cascadePrograms),
  "Безопасное сохранение множества не должно пересоздавать полные записи связанных программ."
);
assert.equal(
  persistenceSafeResult.commissionSets.find((item) => item.id === setA.id).commissionChair,
  changedA.commissionChair
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
assert.match(commissionSaveSource, /materializeProgramSnapshots:\s*false/u);
assert.doesNotMatch(
  commissionSaveSource,
  /programRows\.splice/u,
  "Сохранение множества не должно отправлять полные снимки всех связанных программ."
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
assert.match(saveRecordSource, /getProgramCommissionStrictSaveOptions\(form\)/u);
assert.match(
  saveRecordSource,
  /flushSharedApplicationStateThroughGeneration\([\s\S]*?commissionStrictSaveOptions/u,
  "Изменение существующего множества должно сохраняться со строгой проверкой ревизии."
);
assert.match(
  saveRecordSource,
  /commissionStrictSaveOptions[\s\S]*?sharedStatePendingPatch[\s\S]*?Дождитесь завершения текущей синхронизации/u,
  "Строгое сохранение нельзя смешивать с уже ожидающими изменениями."
);
const strictRestoreSource = extractBetween(
  appSource,
  "  async function restoreFailedProgramCommissionSave",
  "\n  async function ensureRecordLockForSave"
);
assert.match(strictRestoreSource, /sharedStatePendingPatch = snapshot\.pendingPatch \? clone\(snapshot\.pendingPatch\) : null/u);
assert.doesNotMatch(
  strictRestoreSource,
  /localStorage\.removeItem/u,
  "Восстановление конфликта не должно безусловно удалять чужую локальную очередь."
);
assert.match(appSource, /data-program-commission-base-revision="\$\{sharedStateRevision\}"/u);
assert.match(appSource, /<option value=""[^>]*disabled>Выберите множество<\/option>/u);
assert.doesNotMatch(appSource, />Без общего множества</u);
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

console.log(
  "OK: множества комиссий — legacy-дедупликация, идемпотентность, каскад, Excel-перепривязка и поиск только по name."
);
