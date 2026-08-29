const assert = require("assert");
const {
  mergeStudentDatabaseSyncRecords,
  parseStudentDatabaseSyncComment,
  hashStudentDatabaseCriticalSnapshot,
  hashStudentDatabaseCriticalIdentity,
  resolveLegacyStudentDatabaseIndependentNoteMerge,
  resolveStudentDatabaseFieldLevelMerge,
  resolveStudentDatabaseReconciliationAfterDirectionError,
  resolveStudentDatabaseCompleteReconciliation,
  validateStudentDatabaseReconciliationSelectionsAgainstOutput,
  applyStudentDatabaseFormulaBackedWebOverrides,
  validateStudentDatabaseFormulaBackedWebOverridesAgainstOutput,
  materializeStudentDatabaseReconciledCollections,
  buildStudentDatabaseSyncConflictDiagnosticReport,
  resolveStudentDatabaseSyncDirection,
  acquireStudentDatabaseSyncReservation,
  releaseStudentDatabaseSyncReservation,
  getActiveStudentDatabaseSyncReservation
} = require("../app-server");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicRows(result) {
  return result.students.map(({ __syncComment, ...student }) => student);
}

function assertMaterializedSyncRow(row, entity, recordId = row?.id) {
  assert.ok(row, `Не найдена материализованная запись ${entity}`);
  assert.equal(
    Object.prototype.hasOwnProperty.call(row, "databaseSync"),
    false,
    `В записи ${entity} не должно оставаться внутреннего объекта databaseSync`
  );
  assert.equal(typeof row.__syncComment, "string", `Для записи ${entity} нужна служебная метка`);
  const metadata = JSON.parse(row.__syncComment);
  assert.ok(metadata && typeof metadata === "object" && !Array.isArray(metadata));
  assert.equal(metadata.entity, entity);
  assert.equal(metadata.recordId, recordId);
  return metadata;
}

const initialWeb = [
  {
    id: "student-one",
    uid: "101",
    name: "Иванова Ирина Ивановна",
    applicationDate: "2026-08-01",
    program: "Программа 1",
    phone: "111",
    additionalStatus: "На зачисление"
  },
  {
    id: "student-two",
    uid: "102",
    name: "Петров Пётр Петрович",
    applicationDate: "2026-08-02",
    program: "Программа 2",
    phone: "222",
    additionalStatus: "Обучается"
  }
];

const first = mergeStudentDatabaseSyncRecords({
  webStudents: initialWeb,
  excelStudents: clone(initialWeb),
  synchronizedAt: "2026-08-20T10:00:00.000Z"
});
assert.deepStrictEqual(first.conflicts, []);
assert.strictEqual(first.students.length, 2);
assert.strictEqual(first.stats.unchanged, 2);
assert.ok(first.ledger.records["student-one"]);
assert.match(first.students[0].__syncComment, /"recordId":"student-one"/u);

const baselineWeb = publicRows(first);
const baselineExcel = clone(baselineWeb);

const excelChanged = clone(baselineExcel);
excelChanged[0].phone = "999";
const excelWins = mergeStudentDatabaseSyncRecords({
  webStudents: clone(baselineWeb),
  excelStudents: excelChanged,
  ledger: first.ledger,
  synchronizedAt: "2026-08-20T10:10:00.000Z"
});
assert.deepStrictEqual(excelWins.conflicts, []);
assert.strictEqual(excelWins.stats.imported, 1);
assert.strictEqual(excelWins.students.find((row) => row.id === "student-one").phone, "999");

const webChanged = clone(baselineWeb);
webChanged[1].phone = "777";
const webWins = mergeStudentDatabaseSyncRecords({
  webStudents: webChanged,
  excelStudents: clone(baselineExcel),
  ledger: first.ledger,
  synchronizedAt: "2026-08-20T10:20:00.000Z"
});
assert.deepStrictEqual(webWins.conflicts, []);
assert.strictEqual(webWins.stats.exported, 1);
assert.strictEqual(webWins.students.find((row) => row.id === "student-two").phone, "777");

const bothWeb = clone(baselineWeb);
const bothExcel = clone(baselineExcel);
bothWeb[0].phone = "333";
bothExcel[0].phone = "444";
const conflict = mergeStudentDatabaseSyncRecords({
  webStudents: bothWeb,
  excelStudents: bothExcel,
  ledger: first.ledger
});
assert.strictEqual(conflict.conflicts.length, 1);
assert.match(conflict.conflicts[0].reason, /Web, и в Excel/u);

const excelDeleted = mergeStudentDatabaseSyncRecords({
  webStudents: clone(baselineWeb),
  excelStudents: [clone(baselineExcel[1])],
  ledger: first.ledger
});
assert.deepStrictEqual(excelDeleted.conflicts, []);
assert.strictEqual(excelDeleted.stats.deletedFromWeb, 1);
assert.deepStrictEqual(excelDeleted.students.map((row) => row.id), ["student-two"]);

const webDeleted = mergeStudentDatabaseSyncRecords({
  webStudents: [clone(baselineWeb[1])],
  excelStudents: clone(baselineExcel),
  ledger: first.ledger
});
assert.deepStrictEqual(webDeleted.conflicts, []);
assert.strictEqual(webDeleted.stats.deletedFromExcel, 1);
assert.deepStrictEqual(webDeleted.students.map((row) => row.id), ["student-two"]);

const deleteAgainstChangeExcel = clone(baselineExcel);
deleteAgainstChangeExcel[0].phone = "555";
const deleteConflict = mergeStudentDatabaseSyncRecords({
  webStudents: [clone(baselineWeb[1])],
  excelStudents: deleteAgainstChangeExcel,
  ledger: first.ledger
});
assert.strictEqual(deleteConflict.conflicts.length, 1);
assert.match(deleteConflict.conflicts[0].reason, /удалена в Web, но изменена в Excel/u);

const newOnBothSides = mergeStudentDatabaseSyncRecords({
  webStudents: [
    ...clone(baselineWeb),
    { id: "student-web-new", uid: "103", name: "Новая Web", phone: "1" }
  ],
  excelStudents: [
    ...clone(baselineExcel),
    { id: "legacy-excel-row", uid: "104", name: "Новая Excel", phone: "2" }
  ],
  ledger: first.ledger
});
assert.deepStrictEqual(newOnBothSides.conflicts, []);
assert.strictEqual(newOnBothSides.students.length, 4);
assert.ok(newOnBothSides.students.some((row) => row.name === "Новая Web"));
assert.ok(newOnBothSides.students.some((row) => row.name === "Новая Excel"));

const duplicateUid = mergeStudentDatabaseSyncRecords({
  webStudents: [
    { id: "stable-a", uid: "726", name: "Альфа", applicationDate: "2026-01-01", program: "A" },
    { id: "stable-b", uid: "726", name: "Бета", applicationDate: "2026-01-02", program: "B" }
  ],
  excelStudents: [
    { id: "legacy-1", uid: "726", name: "Бета", applicationDate: "2026-01-02", program: "B" },
    { id: "legacy-2", uid: "726", name: "Альфа", applicationDate: "2026-01-01", program: "A" }
  ]
});
assert.deepStrictEqual(duplicateUid.conflicts, []);
assert.deepStrictEqual(
  duplicateUid.students.map((row) => row.id).sort(),
  ["stable-a", "stable-b"]
);

const commentMetadata = first.students[0].databaseSync;
const parsedComment = parseStudentDatabaseSyncComment({
  c: [{
    t: [
      "Пользовательское примечание",
      "",
      "[[AIS_SYNC_V1]]",
      JSON.stringify({
        v: 1,
        entity: "students",
        recordId: commentMetadata.recordId,
        baseHash: commentMetadata.baseHash,
        syncedAt: commentMetadata.syncedAt,
        workbookId: commentMetadata.workbookId
      }),
      "[[/AIS_SYNC_V1]]"
    ].join("\n")
  }]
});
assert.strictEqual(parsedComment.recordId, "student-one");
assert.strictEqual(parsedComment.baseHash, commentMetadata.baseHash);
assert.strictEqual(parsedComment.workbookId, commentMetadata.workbookId);
assert.strictEqual(parseStudentDatabaseSyncComment({ c: [{ t: "Обычное примечание" }] }), null);

const legacyWeb = [{ id: "legacy-one", uid: "201", name: "До меток", phone: "web" }];
const legacyExcel = [{ id: "student-db-201", uid: "201", name: "До меток", phone: "excel" }];
const legacyExcelWins = mergeStudentDatabaseSyncRecords({
  webStudents: legacyWeb,
  excelStudents: legacyExcel,
  webUpdatedAtById: new Map([["legacy-one", "2026-08-20T09:00:00.000Z"]]),
  lastSynchronizedAt: "2026-08-20T10:00:00.000Z",
  sourceModifiedAt: "2026-08-20T11:00:00.000Z"
});
assert.deepStrictEqual(legacyExcelWins.conflicts, []);
assert.strictEqual(legacyExcelWins.stats.imported, 1);
assert.strictEqual(legacyExcelWins.students[0].phone, "excel");

const legacyConflict = mergeStudentDatabaseSyncRecords({
  webStudents: legacyWeb,
  excelStudents: legacyExcel,
  webUpdatedAtById: new Map([["legacy-one", "2026-08-20T12:00:00.000Z"]]),
  lastSynchronizedAt: "2026-08-20T10:00:00.000Z",
  sourceModifiedAt: "2026-08-20T11:00:00.000Z"
});
assert.strictEqual(legacyConflict.conflicts.length, 1);
assert.match(legacyConflict.conflicts[0].reason, /После прошлой синхронизации/u);

const directionalBaselineData = {
  students: [
    {
      id: "student-web-note",
      uid: "301",
      name: "Добрышкина Екатерина Сергеевна",
      applicationDate: "2026-08-01",
      program: "Программа 1",
      note: ""
    },
    {
      id: "student-excel-note",
      uid: "302",
      name: "Прозаровская Любовь Александровна",
      applicationDate: "2026-08-02",
      program: "Программа 2",
      note: ""
    }
  ],
  contracts: [],
  directExpenses: [],
  generalExpenses: [],
  inventory: [],
  trainingPlans: [],
  programs: []
};
const directionalWebData = clone(directionalBaselineData);
directionalWebData.students[0].note = "Новое сообщение";
const directionalExcelData = clone(directionalBaselineData);
directionalExcelData.students[1].note = "Новое сообщение";
const directionalBaseline = {
  version: 2,
  sourceHash: "d".repeat(64),
  sourceIdentity: "e".repeat(64),
  webRevision: 15,
  synchronizedAt: "2026-08-20T10:00:00.000Z",
  criticalHash: hashStudentDatabaseCriticalSnapshot(directionalBaselineData),
  criticalIdentityHash: hashStudentDatabaseCriticalIdentity(directionalBaselineData)
};
const directionalAuditRows = [{
  createdAt: "2026-08-20T11:00:00.000Z",
  action: "Изменена запись",
  entityType: "students",
  entityId: "student-web-note",
  entityLabel: "Добрышкина Екатерина Сергеевна",
  source: "web",
  changes: [{
    field: "note",
    label: "Примечание",
    before: "",
    after: "Новое сообщение"
  }]
}];
const independentNotes = resolveLegacyStudentDatabaseIndependentNoteMerge({
  webData: directionalWebData,
  excelData: directionalExcelData,
  baseline: directionalBaseline,
  auditRows: directionalAuditRows
});
assert.ok(independentNotes);
assert.deepStrictEqual(independentNotes.stats, {
  webToExcel: 1,
  excelToWeb: 1,
  unchanged: 0
});
assert.strictEqual(independentNotes.students[0].note, "Новое сообщение");
assert.strictEqual(independentNotes.students[1].note, "Новое сообщение");
assert.deepStrictEqual(
  independentNotes.changes.map((change) => change.action).sort(),
  ["Excel → Web", "Web → Excel"]
);

const sameStudentExcelChange = clone(directionalBaselineData);
sameStudentExcelChange.students[0].note = "Другое сообщение";
assert.throws(
  () => resolveLegacyStudentDatabaseIndependentNoteMerge({
    webData: directionalWebData,
    excelData: sameStudentExcelChange,
    baseline: directionalBaseline,
    auditRows: directionalAuditRows
  }),
  /изменено и в Web, и в XLSB/u
);

const unrelatedWebAudit = clone(directionalAuditRows);
unrelatedWebAudit.push({
  ...directionalAuditRows[0],
  createdAt: "2026-08-20T11:05:00.000Z",
  changes: [{ field: "phone", before: "111", after: "222" }]
});
assert.strictEqual(resolveLegacyStudentDatabaseIndependentNoteMerge({
  webData: directionalWebData,
  excelData: directionalExcelData,
  baseline: directionalBaseline,
  auditRows: unrelatedWebAudit
}), null);

const sameStudentBaselineData = {
  students: [{
    id: "student-pashchenko",
    uid: "1148",
    name: "Пащенко Мария Александровна",
    applicationDate: "2026-05-08",
    program: "Программа 3",
    note: "",
    reviewPublished: false
  }],
  contracts: [],
  directExpenses: [],
  generalExpenses: [],
  inventory: [],
  trainingPlans: [],
  programs: []
};
const sameStudentWebData = clone(sameStudentBaselineData);
sameStudentWebData.students[0].note = "Добавлено в Web";
const sameStudentExcelData = clone(sameStudentBaselineData);
sameStudentExcelData.students[0].reviewPublished = true;
const sameStudentBaseline = {
  version: 2,
  sourceHash: "8".repeat(64),
  sourceIdentity: "9".repeat(64),
  webRevision: 16,
  synchronizedAt: "2026-08-20T10:00:00.000Z",
  criticalHash: hashStudentDatabaseCriticalSnapshot(sameStudentBaselineData),
  criticalIdentityHash: hashStudentDatabaseCriticalIdentity(sameStudentBaselineData)
};
const sameStudentAuditRows = [{
  createdAt: "2026-08-20T11:00:00.000Z",
  action: "Изменена запись",
  entityType: "students",
  entityId: "student-pashchenko",
  entityLabel: "Пащенко Мария Александровна",
  source: "web",
  changes: [{
    field: "note",
    label: "Примечание",
    before: "",
    after: "Добавлено в Web"
  }]
}];
const sameStudentDifferentFields = resolveStudentDatabaseFieldLevelMerge({
  webData: sameStudentWebData,
  excelData: sameStudentExcelData,
  baseline: sameStudentBaseline,
  auditRows: sameStudentAuditRows
});
assert.ok(sameStudentDifferentFields, "По-полевое слияние должно быть доступно");
assert.deepStrictEqual(sameStudentDifferentFields.conflicts, []);
assert.strictEqual(sameStudentDifferentFields.students[0].note, "Добавлено в Web");
assert.strictEqual(sameStudentDifferentFields.students[0].reviewPublished, true);
assert.deepStrictEqual(
  sameStudentDifferentFields.changes.map((change) => [change.field, change.action]).sort(),
  [["Отзыв на сайте", "Excel → Web"], ["Примечание", "Web → Excel"]].sort()
);

const oneSidedBaselineData = clone(sameStudentBaselineData);
Object.assign(oneSidedBaselineData.students[0], {
  additionalStatus: "обучающаяся",
  contractAmount: 8000,
  eventOrder: "enrollment,documents"
});
oneSidedBaselineData.directExpenses = [{
  id: "expense-formula-cache",
  uid: "1148",
  date: "2026-08-20",
  type: "Материалы",
  amount: 100,
  recommendation: "100"
}];
const oneSidedWebData = clone(oneSidedBaselineData);
Object.assign(oneSidedWebData.students[0], {
  contractAmount: 6000,
  eventOrder: "enrollment",
  databaseFixedValueOverrides: ["contractAmount"]
});
const oneSidedExcelData = clone(oneSidedBaselineData);
oneSidedExcelData.students[0].additionalStatus = "на продление";
oneSidedExcelData.students[0].databaseSyncFormulaFields = ["contractAmount"];
oneSidedExcelData.directExpenses[0].recommendation = "200";
oneSidedExcelData.directExpenses[0].databaseSyncFormulaFields = ["recommendation"];
const oneSidedBaseline = {
  ...sameStudentBaseline,
  criticalHash: hashStudentDatabaseCriticalSnapshot(oneSidedBaselineData),
  criticalIdentityHash: hashStudentDatabaseCriticalIdentity(oneSidedBaselineData)
};
const oneSidedAuditRows = [{
  createdAt: "2026-08-20T09:59:00.000Z",
  action: "Синхронизация",
  entityType: "database",
  changes: []
}, {
  createdAt: "2026-08-20T11:00:00.000Z",
  action: "Изменена запись",
  entityType: "students",
  entityId: "student-pashchenko",
  entityLabel: "Пащенко Мария Александровна",
  source: "web",
  changes: [{
    field: "contractAmount",
    before: 8000,
    after: 6000
  }, {
    field: "eventOrder",
    before: "enrollment,documents",
    after: "enrollment"
  }]
}];
const rawOneSidedReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: oneSidedWebData,
  excelData: oneSidedExcelData
});
assert.ok(
  rawOneSidedReconciliation.conflicts.length >= 3,
  "Сравнение только текущих снимков воспроизводит лишние вопросы"
);
const automaticOneSidedReconciliation = resolveStudentDatabaseReconciliationAfterDirectionError({
  errorCode: "STUDENT_DATABASE_DUAL_CRITICAL_CHANGE",
  webData: oneSidedWebData,
  excelData: oneSidedExcelData,
  baseline: oneSidedBaseline,
  auditRows: oneSidedAuditRows
});
assert.deepStrictEqual(automaticOneSidedReconciliation.conflicts, []);
assert.equal(automaticOneSidedReconciliation.completeReconciliation, undefined);
assert.equal(automaticOneSidedReconciliation.collections.students[0].contractAmount, 6000);
assert.equal(automaticOneSidedReconciliation.collections.students[0].additionalStatus, "на продление");
assert.equal(automaticOneSidedReconciliation.collections.students[0].eventOrder, "enrollment");
assert.equal(automaticOneSidedReconciliation.collections.directExpenses[0].recommendation, "100");
assert.equal(
  automaticOneSidedReconciliation.changes.some((change) => change.field === "Рекомендация оплаты"),
  false,
  "Производный результат формулы не должен считаться изменением"
);
const safeFallbackReconciliation = resolveStudentDatabaseReconciliationAfterDirectionError({
  errorCode: "STUDENT_DATABASE_DUAL_CRITICAL_CHANGE",
  webData: oneSidedWebData,
  excelData: oneSidedExcelData,
  baseline: oneSidedBaseline,
  auditRows: []
});
assert.equal(safeFallbackReconciliation.completeReconciliation, true);
assert.ok(safeFallbackReconciliation.conflicts.length > 0);
const nonReversibleMutationFallback = resolveStudentDatabaseReconciliationAfterDirectionError({
  errorCode: "STUDENT_DATABASE_DUAL_CRITICAL_CHANGE",
  webData: oneSidedWebData,
  excelData: oneSidedExcelData,
  baseline: oneSidedBaseline,
  auditRows: [...oneSidedAuditRows, {
    createdAt: "2026-08-20T11:05:00.000Z",
    action: "Автозаполнение для группового документа",
    entityType: "students",
    entityId: "student-pashchenko",
    source: "bulk-document-autofill",
    changes: []
  }]
});
assert.equal(
  nonReversibleMutationFallback.completeReconciliation,
  true,
  "Необратимая Web-мутация должна оставлять безопасный полный выбор"
);
assert.ok(nonReversibleMutationFallback.conflicts.length > 0);
const nestedExpenseWebData = clone(oneSidedWebData);
nestedExpenseWebData.directExpenses[0].amount = 150;
nestedExpenseWebData.directExpenses[0].databaseFixedValueOverrides = ["amount"];
const nestedExpenseExcelData = clone(oneSidedExcelData);
nestedExpenseExcelData.directExpenses[0].databaseSyncFormulaFields = ["amount", "recommendation"];
const nestedExpenseAuditRows = clone(oneSidedAuditRows);
nestedExpenseAuditRows[1].changes.push({
  field: "directExpenses",
  before: "[{amount:100}]",
  after: "[{amount:150}]"
});
const nestedExpenseFallback = resolveStudentDatabaseReconciliationAfterDirectionError({
  errorCode: "STUDENT_DATABASE_DUAL_CRITICAL_CHANGE",
  webData: nestedExpenseWebData,
  excelData: nestedExpenseExcelData,
  baseline: oneSidedBaseline,
  auditRows: nestedExpenseAuditRows
});
assert.equal(
  nestedExpenseFallback.completeReconciliation,
  true,
  "Необратимое изменение вложенной затраты с Web override нельзя принимать за Excel-only"
);
assert.ok(nestedExpenseFallback.conflicts.length > 0);
const truncatedAuditRows = clone(oneSidedAuditRows);
truncatedAuditRows[1].changes = Array.from({ length: 40 }, () => ({
  field: "contractAmount",
  before: 8000,
  after: 6000
}));
const truncatedAuditFallback = resolveStudentDatabaseReconciliationAfterDirectionError({
  errorCode: "STUDENT_DATABASE_DUAL_CRITICAL_CHANGE",
  webData: oneSidedWebData,
  excelData: oneSidedExcelData,
  baseline: oneSidedBaseline,
  auditRows: truncatedAuditRows
});
assert.equal(
  truncatedAuditFallback.completeReconciliation,
  true,
  "Потенциально усечённая запись из 40 изменений должна обрабатываться fail-closed"
);
const discontinuousAuditRows = clone(oneSidedAuditRows);
discontinuousAuditRows[1].changes[0].after = 7000;
const discontinuousAuditFallback = resolveStudentDatabaseReconciliationAfterDirectionError({
  errorCode: "STUDENT_DATABASE_DUAL_CRITICAL_CHANGE",
  webData: oneSidedWebData,
  excelData: oneSidedExcelData,
  baseline: oneSidedBaseline,
  auditRows: discontinuousAuditRows
});
assert.equal(
  discontinuousAuditFallback.completeReconciliation,
  true,
  "Разрыв цепочки current → audit.after должен запрещать автоматическое слияние"
);

const sameFieldExcelData = clone(sameStudentBaselineData);
sameFieldExcelData.students[0].note = "Добавлено в Excel";
const unresolvedSameField = resolveStudentDatabaseFieldLevelMerge({
  webData: sameStudentWebData,
  excelData: sameFieldExcelData,
  baseline: sameStudentBaseline,
  auditRows: sameStudentAuditRows
});
assert.equal(unresolvedSameField.conflicts.length, 1);
assert.equal(unresolvedSameField.conflicts[0].field, "Примечание");
assert.equal(unresolvedSameField.conflicts[0].web, "Добавлено в Web");
assert.equal(unresolvedSameField.conflicts[0].excel, "Добавлено в Excel");
assert.equal(unresolvedSameField.students, null);
const routedSameFieldConflict = resolveStudentDatabaseReconciliationAfterDirectionError({
  errorCode: "STUDENT_DATABASE_DUAL_CRITICAL_CHANGE",
  webData: sameStudentWebData,
  excelData: sameFieldExcelData,
  baseline: sameStudentBaseline,
  auditRows: sameStudentAuditRows
});
assert.equal(routedSameFieldConflict.completeReconciliation, undefined);
assert.equal(routedSameFieldConflict.conflicts.length, 1);
assert.equal(routedSameFieldConflict.conflicts[0].field, "Примечание");

const driftedBaselineData = clone(sameStudentBaselineData);
driftedBaselineData.students[0].phone = "+7 000 000-00-00";
const driftedBaseline = {
  ...sameStudentBaseline,
  criticalHash: hashStudentDatabaseCriticalSnapshot(driftedBaselineData)
};
const coveredAuditRows = [
  {
    createdAt: "2026-08-20T09:59:00.000Z",
    action: "Синхронизация",
    entityType: "database",
    changes: []
  },
  ...sameStudentAuditRows
];
const recoveredDriftConflict = resolveStudentDatabaseFieldLevelMerge({
  webData: sameStudentWebData,
  excelData: sameFieldExcelData,
  baseline: driftedBaseline,
  auditRows: coveredAuditRows
});
assert.ok(recoveredDriftConflict, "Полный журнал должен разрешать восстановление базовых полей");
assert.equal(recoveredDriftConflict.recoveredBaselineHashDrift, true);
assert.equal(recoveredDriftConflict.conflicts.length, 1);
assert.equal(recoveredDriftConflict.conflicts[0].field, "Примечание");
assert.equal(resolveStudentDatabaseFieldLevelMerge({
  webData: sameStudentWebData,
  excelData: sameFieldExcelData,
  baseline: driftedBaseline,
  auditRows: sameStudentAuditRows
}), null, "Без покрытия контрольной точки общий предохранитель должен сохраниться");
const changedIdentityExcelData = clone(sameFieldExcelData);
changedIdentityExcelData.students[0].uid = "9999";
assert.equal(resolveStudentDatabaseFieldLevelMerge({
  webData: sameStudentWebData,
  excelData: changedIdentityExcelData,
  baseline: driftedBaseline,
  auditRows: coveredAuditRows
}), null, "При изменении состава записей восстановление общего хеша запрещено");

const webDataWithIndependentAddition = clone(sameStudentWebData);
webDataWithIndependentAddition.students.push({
  id: "student-zagodarchuk-new",
  uid: "1171",
  name: "Загодарчук Инна Владимировна",
  applicationDate: "2026-08-27",
  program: "Программа 4",
  additionalStatus: "На зачисление (пока без документов)",
  endDate: "2031-12-31",
  note: "Новая заявка"
});
assert.equal(resolveStudentDatabaseFieldLevelMerge({
  webData: webDataWithIndependentAddition,
  excelData: sameFieldExcelData,
  baseline: sameStudentBaseline,
  auditRows: coveredAuditRows
}), null, "Новый Web-объект должен сохранить предохранитель автоматического слияния");
const diagnosticConflict = buildStudentDatabaseSyncConflictDiagnosticReport({
  webData: webDataWithIndependentAddition,
  excelData: sameFieldExcelData,
  baseline: sameStudentBaseline,
  auditRows: coveredAuditRows
});
assert.equal(diagnosticConflict.kind, "student-database-sync-difference-diagnostics");
assert.equal(diagnosticConflict.diagnosticOnly, true);
assert.equal(diagnosticConflict.count, 1);
assert.equal(diagnosticConflict.truncated, false);
assert.equal(diagnosticConflict.rows[0].record, "Пащенко Мария Александровна [1148]");
assert.equal(diagnosticConflict.rows[0].field, "Примечание");
assert.equal(diagnosticConflict.rows[0].baseline, "—");
assert.equal(diagnosticConflict.rows[0].web, "Добавлено в Web");
assert.equal(diagnosticConflict.rows[0].excel, "Добавлено в Excel");
assert.equal(
  diagnosticConflict.rows.some((row) => /Загодарчук/u.test(row.record)),
  false,
  "Одностороннее добавление нельзя выдавать за конкретное расхождение поля"
);
assert.equal(
  Object.prototype.hasOwnProperty.call(diagnosticConflict, "syncConflicts"),
  false,
  "Диагностический fallback не должен разрешать выбор источника"
);
const oneSidedDifference = buildStudentDatabaseSyncConflictDiagnosticReport({
  webData: webDataWithIndependentAddition,
  excelData: sameStudentBaselineData,
  baseline: sameStudentBaseline,
  auditRows: coveredAuditRows
});
assert.equal(oneSidedDifference.count, 1);
assert.equal(oneSidedDifference.rows[0].web, "Добавлено в Web");
assert.equal(oneSidedDifference.rows[0].excel, "—");
assert.match(oneSidedDifference.rows[0].reason, /в XLSB осталось значение/iu);
const uncoveredDiagnostic = buildStudentDatabaseSyncConflictDiagnosticReport({
  webData: sameStudentWebData,
  excelData: sameFieldExcelData,
  baseline: sameStudentBaseline,
  auditRows: sameStudentAuditRows
});
assert.equal(uncoveredDiagnostic.count, 0);
assert.match(uncoveredDiagnostic.note, /не покрывает контрольную точку/iu);

const completeReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: webDataWithIndependentAddition,
  excelData: sameFieldExcelData
});
assert.equal(completeReconciliation.completeReconciliation, true);
assert.equal(completeReconciliation.snapshotFallback, false);
assert.equal(completeReconciliation.collections, null);
assert.equal(completeReconciliation.students, null);
assert.deepStrictEqual(
  completeReconciliation.conflicts.map((conflict) => conflict.kind).sort(),
  ["field", "record-presence"]
);
const completeFieldConflict = completeReconciliation.conflicts.find((conflict) => (
  conflict.kind === "field" && conflict.fieldName === "note"
));
const completeWebPresenceConflict = completeReconciliation.conflicts.find((conflict) => (
  conflict.kind === "record-presence" && conflict.recordId === "student-zagodarchuk-new"
));
assert.ok(completeFieldConflict, "Полная сверка должна показать расхождение примечания Пащенко");
assert.ok(completeWebPresenceConflict, "Полная сверка должна показать Web-only заявку");

const excelDeletionAfterBaselineData = clone(sameStudentBaselineData);
excelDeletionAfterBaselineData.students = [];
const excelDeletionAfterBaselineReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: sameStudentBaselineData,
  excelData: excelDeletionAfterBaselineData,
  baseline: sameStudentBaseline,
  auditRows: [coveredAuditRows[0]],
  sourceModifiedAt: "2026-08-20T11:00:00.000Z"
});
const excelDeletionAfterBaselineConflict = excelDeletionAfterBaselineReconciliation.conflicts.find(
  (conflict) => conflict.kind === "record-presence"
    && conflict.recordId === "student-pashchenko"
);
assert.ok(
  excelDeletionAfterBaselineConflict,
  "Полная сверка должна показать удалённую после baseline запись XLSB"
);
assert.equal(
  excelDeletionAfterBaselineConflict.recommendedSource,
  "excel",
  "Если запись осталась в baseline и Web, но удалена только в XLSB, следует рекомендовать XLSB"
);

const allWebCompleteReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: webDataWithIndependentAddition,
  excelData: sameFieldExcelData,
  conflictResolutions: Object.fromEntries(
    completeReconciliation.conflicts.map((conflict) => [conflict.id, "web"])
  )
});
assert.deepStrictEqual(allWebCompleteReconciliation.conflicts, []);
assert.equal(
  hashStudentDatabaseCriticalSnapshot(allWebCompleteReconciliation.collections),
  hashStudentDatabaseCriticalSnapshot(webDataWithIndependentAddition)
);
assert.ok(
  allWebCompleteReconciliation.collections.students
    .find((student) => student.id === sameStudentWebData.students[0].id)
    ?.databaseFixedValueOverrides?.includes("note"),
  "Явно выбранное значение Web должно заменять формулу XLSB, если поле окажется формульным"
);
assert.equal(
  allWebCompleteReconciliation.students.some((student) => student.id === "student-zagodarchuk-new"),
  true
);
const retainedWebOnlyStudent = allWebCompleteReconciliation.students.find((student) => (
  student.id === "student-zagodarchuk-new"
));
assert.ok(retainedWebOnlyStudent.databaseFixedValueOverrides.includes("endDate"));
assert.ok(retainedWebOnlyStudent.databaseFixedValueOverrides.includes("note"));
assert.equal(retainedWebOnlyStudent.additionalStatus, "На зачисление (пока без документов)");
assert.equal(
  retainedWebOnlyStudent.databaseFixedValueOverrides.includes("additionalStatus"),
  false,
  "Дополнительный статус задаёт раздел строки XLSB и не должен считаться фиксированной ячейкой"
);
assert.ok(
  allWebCompleteReconciliation.verificationSelections.some((selection) => (
    selection.definitionKey === "students"
    && selection.recordId === "student-zagodarchuk-new"
    && selection.fieldName === "additionalStatus"
    && selection.expectedValue === "на зачисление (пока без документов)"
  )),
  "Выбранный дополнительный статус должен по-прежнему проверяться после записи XLSB"
);
assert.equal(
  validateStudentDatabaseReconciliationSelectionsAgainstOutput(
    allWebCompleteReconciliation.collections,
    clone(allWebCompleteReconciliation.collections),
    allWebCompleteReconciliation
  ).verifiedCollectionCount,
  7
);
const incorrectWebSelectionOutput = clone(allWebCompleteReconciliation.collections);
incorrectWebSelectionOutput.students[0].note = "Добавлено в Excel";
assert.throws(
  () => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
    allWebCompleteReconciliation.collections,
    incorrectWebSelectionOutput,
    allWebCompleteReconciliation
  ),
  /изменилось при записи|записано не в выбранном варианте/iu
);
const incorrectRetainedRecordOutput = clone(allWebCompleteReconciliation.collections);
incorrectRetainedRecordOutput.students.find((student) => (
  student.id === "student-zagodarchuk-new"
)).endDate = "2030-01-01";
assert.throws(
  () => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
    allWebCompleteReconciliation.collections,
    incorrectRetainedRecordOutput,
    allWebCompleteReconciliation
  ),
  /изменилось при записи|записано не в выбранном варианте/iu
);
const incorrectAdditionalStatusOutput = clone(allWebCompleteReconciliation.collections);
incorrectAdditionalStatusOutput.students.find((student) => (
  student.id === "student-zagodarchuk-new"
)).additionalStatus = "Обучающиеся";
assert.throws(
  () => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
    allWebCompleteReconciliation.collections,
    incorrectAdditionalStatusOutput,
    allWebCompleteReconciliation
  ),
  /изменилось при записи|записано не в выбранном варианте/iu
);
const missingSelectedRecordOutput = clone(allWebCompleteReconciliation.collections);
missingSelectedRecordOutput.students = missingSelectedRecordOutput.students.filter((student) => (
  student.id !== "student-zagodarchuk-new"
));
assert.throws(
  () => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
    allWebCompleteReconciliation.collections,
    missingSelectedRecordOutput,
    allWebCompleteReconciliation
  ),
  /Состав записей/iu
);
const unrelatedFormulaRecalculationOutput = clone(allWebCompleteReconciliation.collections);
unrelatedFormulaRecalculationOutput.students[0].endDate = "2032-01-01";
assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
  allWebCompleteReconciliation.collections,
  unrelatedFormulaRecalculationOutput,
  allWebCompleteReconciliation
));

const mixedCompleteReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: webDataWithIndependentAddition,
  excelData: sameFieldExcelData,
  conflictResolutions: {
    [completeFieldConflict.id]: "excel",
    [completeWebPresenceConflict.id]: "web"
  }
});
assert.deepStrictEqual(mixedCompleteReconciliation.conflicts, []);
assert.equal(mixedCompleteReconciliation.students[0].note, "Добавлено в Excel");
assert.equal(
  mixedCompleteReconciliation.students.some((student) => student.id === "student-zagodarchuk-new"),
  true
);

const reportedConflictWebData = {
  students: [
    {
      id: "student-pashchenko-1148",
      uid: "1148",
      name: "Пащенко Мария Александровна",
      applicationDate: "2026-07-09",
      program: "Программа 1",
      note: "Примечание Web"
    },
    {
      id: "student-prozarovskaya-1162",
      uid: "1162",
      name: "Прозаровская Любовь Александровна",
      applicationDate: "2026-08-26",
      program: "Программа 2",
      endDate: "2026-09-30",
      extendedEndDate: "2026-09-30"
    }
  ]
};
const reportedConflictExcelData = clone(reportedConflictWebData);
reportedConflictExcelData.students[0].note = "Примечание XLSB";
reportedConflictExcelData.students[1].endDate = "2026-08-26";
reportedConflictExcelData.students[1].extendedEndDate = "";
const reportedConflicts = resolveStudentDatabaseCompleteReconciliation({
  webData: reportedConflictWebData,
  excelData: reportedConflictExcelData
});
assert.deepEqual(
  reportedConflicts.conflicts.map((conflict) => conflict.fieldName).sort(),
  ["endDate", "extendedEndDate", "note"].sort(),
  "Три показанных пользователю расхождения должны разрешаться независимо"
);
const reportedResolvedFromWeb = resolveStudentDatabaseCompleteReconciliation({
  webData: reportedConflictWebData,
  excelData: reportedConflictExcelData,
  conflictResolutions: Object.fromEntries(
    reportedConflicts.conflicts.map((conflict) => [conflict.id, "web"])
  )
});
assert.equal(reportedResolvedFromWeb.conflicts.length, 0);
assert.equal(reportedResolvedFromWeb.students[0].note, "Примечание Web");
assert.equal(reportedResolvedFromWeb.students[1].endDate, "2026-09-30");
assert.equal(reportedResolvedFromWeb.students[1].extendedEndDate, "2026-09-30");
assert.ok(reportedResolvedFromWeb.students[0].databaseFixedValueOverrides.includes("note"));
assert.ok(reportedResolvedFromWeb.students[1].databaseFixedValueOverrides.includes("endDate"));
assert.ok(
  reportedResolvedFromWeb.students[1].databaseFixedValueOverrides.includes("extendedEndDate")
);
for (let choiceMask = 0; choiceMask < 8; choiceMask += 1) {
  const resolutions = Object.fromEntries(reportedConflicts.conflicts.map((conflict, index) => [
    conflict.id,
    (choiceMask & (1 << index)) ? "web" : "excel"
  ]));
  const resolved = resolveStudentDatabaseCompleteReconciliation({
    webData: reportedConflictWebData,
    excelData: reportedConflictExcelData,
    conflictResolutions: resolutions
  });
  assert.equal(resolved.conflicts.length, 0, `Комбинация выбора ${choiceMask} должна продолжить синхронизацию`);
  reportedConflicts.conflicts.forEach((conflict, index) => {
    const student = resolved.students.find((row) => row.uid === conflict.uid);
    const expectedRows = (choiceMask & (1 << index))
      ? reportedConflictWebData.students
      : reportedConflictExcelData.students;
    const expected = expectedRows.find((row) => row.uid === conflict.uid)?.[conflict.fieldName];
    assert.equal(
      student?.[conflict.fieldName] ?? "",
      expected ?? "",
      `Комбинация ${choiceMask}: поле ${conflict.fieldName}`
    );
  });
  assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
    resolved.collections,
    clone(resolved.collections),
    resolved
  ));
}
const allExcelReportedChoice = resolveStudentDatabaseCompleteReconciliation({
  webData: reportedConflictWebData,
  excelData: reportedConflictExcelData,
  conflictResolutions: Object.fromEntries(
    reportedConflicts.conflicts.map((conflict) => [conflict.id, "excel"])
  )
});
const thirdConstantValueOutput = clone(allExcelReportedChoice.collections);
thirdConstantValueOutput.students.find((student) => student.uid === "1162").endDate = "2026-10-01";
assert.throws(
  () => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
    allExcelReportedChoice.collections,
    thirdConstantValueOutput,
    allExcelReportedChoice
  ),
  /не в выбранном варианте/iu,
  "Для обычной ячейки выбор XLSB должен проверяться точно"
);
const formulaBackedReportedExcelData = clone(reportedConflictExcelData);
formulaBackedReportedExcelData.students[1].databaseSyncFormulaFields = ["endDate"];
const formulaBackedReportedConflicts = resolveStudentDatabaseCompleteReconciliation({
  webData: reportedConflictWebData,
  excelData: formulaBackedReportedExcelData
});
const formulaConflictByField = Object.fromEntries(
  formulaBackedReportedConflicts.conflicts.map((conflict) => [conflict.fieldName, conflict])
);
const mixedFormulaChoice = resolveStudentDatabaseCompleteReconciliation({
  webData: reportedConflictWebData,
  excelData: formulaBackedReportedExcelData,
  conflictResolutions: {
    [formulaConflictByField.note.id]: "excel",
    [formulaConflictByField.endDate.id]: "excel",
    [formulaConflictByField.extendedEndDate.id]: "web"
  }
});
assert.equal(mixedFormulaChoice.conflicts.length, 0);
const mixedFormulaStudent = mixedFormulaChoice.students.find((student) => student.uid === "1162");
assert.equal(mixedFormulaStudent.endDate, "2026-08-26");
assert.ok(mixedFormulaStudent.databaseFixedValueOverrides.includes("endDate"));
assert.equal(
  (mixedFormulaStudent.databaseSyncFormulaFields || []).includes("endDate"),
  false,
  "Явно выбранное показанное значение XLSB должно стать фиксированным"
);
const thirdFormulaValueOutput = clone(mixedFormulaChoice.collections);
thirdFormulaValueOutput.students.find((student) => student.uid === "1162").endDate = "2026-10-01";
assert.throws(
  () => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
    mixedFormulaChoice.collections,
    thirdFormulaValueOutput,
    mixedFormulaChoice
  ),
  /не в выбранном варианте/iu,
  "Третье пересчитанное значение не должно проходить вместо выбранного XLSB"
);

const excludedProgramFieldsWebData = clone(sameStudentWebData);
excludedProgramFieldsWebData.programs = [{
  id: "program-excluded-fields",
  name: "Одинаковая программа",
  landingCode: "same-program",
  promoMessage1: "Секрет Web"
}];
const excludedProgramFieldsExcelData = clone(sameFieldExcelData);
excludedProgramFieldsExcelData.programs = [{
  id: "program-excluded-fields",
  name: "Одинаковая программа",
  landingCode: "same-program",
  promoMessage1: "Старое значение XLSB"
}];
const excludedProgramFieldsConflicts = resolveStudentDatabaseCompleteReconciliation({
  webData: excludedProgramFieldsWebData,
  excelData: excludedProgramFieldsExcelData
});
assert.equal(excludedProgramFieldsConflicts.conflicts.length, 1);
assert.equal(excludedProgramFieldsConflicts.conflicts[0].fieldName, "note");
const excludedProgramFieldsResolved = resolveStudentDatabaseCompleteReconciliation({
  webData: excludedProgramFieldsWebData,
  excelData: excludedProgramFieldsExcelData,
  conflictResolutions: {
    [excludedProgramFieldsConflicts.conflicts[0].id]: "excel"
  }
});
assert.equal(excludedProgramFieldsResolved.snapshotFallback, false);
assert.equal(excludedProgramFieldsResolved.students[0].note, "Добавлено в Excel");
assert.equal(excludedProgramFieldsResolved.collections.programs[0].promoMessage1, "Секрет Web");

const formulaHoursWebData = clone(sameStudentBaselineData);
formulaHoursWebData.programs = [{
  id: "program-formula-hours",
  name: "Программа с формулой часов",
  landingCode: "formula-hours",
  hours: 36,
  databaseSyncFormulaFields: ["hours"]
}];
const formulaHoursExcelData = clone(formulaHoursWebData);
formulaHoursExcelData.programs[0].hours = 72;
assert.equal(
  hashStudentDatabaseCriticalSnapshot(formulaHoursWebData),
  hashStudentDatabaseCriticalSnapshot(formulaHoursExcelData),
  "Пересчитанные формульные часы программы не должны создавать конфликт"
);
const constantHoursWebData = clone(formulaHoursWebData);
const constantHoursExcelData = clone(formulaHoursExcelData);
constantHoursWebData.programs[0].databaseSyncFormulaFields = [];
constantHoursExcelData.programs[0].databaseSyncFormulaFields = [];
const constantHoursConflict = resolveStudentDatabaseCompleteReconciliation({
  webData: constantHoursWebData,
  excelData: constantHoursExcelData
});
assert.equal(constantHoursConflict.conflicts.length, 1);
assert.equal(constantHoursConflict.conflicts[0].kind, "snapshot-group");
const constantHoursFromWeb = resolveStudentDatabaseCompleteReconciliation({
  webData: constantHoursWebData,
  excelData: constantHoursExcelData,
  conflictResolutions: {
    [constantHoursConflict.conflicts[0].id]: "web"
  }
});
assert.equal(constantHoursFromWeb.conflicts.length, 0);
assert.ok(constantHoursFromWeb.collections.programs[0].databaseFixedValueOverrides.includes("hours"));

const explicitFormulaOverrideWebData = {
  students: [{
    id: "formula-student",
    uid: "801",
    name: "Формульный слушатель",
    endDate: "2026-09-30",
    databaseFixedValueOverrides: ["endDate"]
  }],
  directExpenses: [{
    id: "formula-expense",
    uid: "801",
    date: "2026-08-27",
    type: "Почта",
    amount: 900,
    databaseFixedValueOverrides: ["amount"]
  }],
  programs: [{
    id: "formula-program",
    name: "Формульная программа",
    landingCode: "formula-program",
    hours: 72,
    databaseFixedValueOverrides: ["hours"]
  }],
  trainingPlans: [{
    id: "formula-plan",
    code: "1",
    programName: "Формульная программа",
    discipline: "Раздел",
    theoryHours: 4,
    databaseFixedValueOverrides: ["theoryHours"]
  }]
};
const explicitFormulaOverrideExcelData = clone(explicitFormulaOverrideWebData);
[
  ...explicitFormulaOverrideExcelData.students,
  ...explicitFormulaOverrideExcelData.directExpenses,
  ...explicitFormulaOverrideExcelData.programs,
  ...explicitFormulaOverrideExcelData.trainingPlans
].forEach((record) => delete record.databaseFixedValueOverrides);
explicitFormulaOverrideExcelData.students[0].endDate = "2026-08-26";
explicitFormulaOverrideExcelData.students[0].databaseSyncFormulaFields = ["endDate"];
explicitFormulaOverrideExcelData.directExpenses[0].amount = 300;
explicitFormulaOverrideExcelData.directExpenses[0].databaseSyncFormulaFields = ["amount"];
explicitFormulaOverrideExcelData.programs[0].hours = 36;
explicitFormulaOverrideExcelData.programs[0].databaseSyncFormulaFields = ["hours"];
explicitFormulaOverrideExcelData.trainingPlans[0].theoryHours = 2;
explicitFormulaOverrideExcelData.trainingPlans[0].databaseSyncFormulaFields = ["theoryHours"];
const explicitFormulaOverrideTargets = applyStudentDatabaseFormulaBackedWebOverrides(
  explicitFormulaOverrideWebData,
  explicitFormulaOverrideExcelData
);
assert.equal(explicitFormulaOverrideTargets.length, 4);
assert.deepEqual(
  explicitFormulaOverrideTargets.map((target) => target.definitionKey).sort(),
  ["directExpenses", "programs", "students", "trainingPlans"]
);
const explicitFormulaOverrideOutput = clone(explicitFormulaOverrideWebData);
assert.equal(
  validateStudentDatabaseFormulaBackedWebOverridesAgainstOutput(
    explicitFormulaOverrideWebData,
    explicitFormulaOverrideOutput,
    explicitFormulaOverrideTargets
  ),
  4
);
const formulaStillPresentOutput = clone(explicitFormulaOverrideOutput);
formulaStillPresentOutput.programs[0].databaseSyncFormulaFields = ["hours"];
assert.throws(
  () => validateStudentDatabaseFormulaBackedWebOverridesAgainstOutput(
    explicitFormulaOverrideWebData,
    formulaStillPresentOutput,
    explicitFormulaOverrideTargets
  ),
  (error) => Number(error?.statusCode) === 409 && /фиксированное значение/iu.test(error.message)
);
const unmarkedFormulaDifferenceWebData = clone(explicitFormulaOverrideWebData);
[
  ...unmarkedFormulaDifferenceWebData.students,
  ...unmarkedFormulaDifferenceWebData.directExpenses,
  ...unmarkedFormulaDifferenceWebData.programs,
  ...unmarkedFormulaDifferenceWebData.trainingPlans
].forEach((record) => delete record.databaseFixedValueOverrides);
assert.deepEqual(
  applyStudentDatabaseFormulaBackedWebOverrides(
    unmarkedFormulaDifferenceWebData,
    explicitFormulaOverrideExcelData
  ),
  [],
  "Unmarked cached formula differences must never be frozen automatically"
);
const equalExplicitFormulaWebData = clone(explicitFormulaOverrideExcelData);
equalExplicitFormulaWebData.students[0].databaseFixedValueOverrides = ["endDate"];
const equalExplicitTargets = applyStudentDatabaseFormulaBackedWebOverrides(
  equalExplicitFormulaWebData,
  explicitFormulaOverrideExcelData
);
assert.equal(equalExplicitTargets.length, 1);
assert.equal(equalExplicitTargets[0].valueDiffers, false);
assert.equal(equalExplicitTargets[0].differs, true);

const webOnlyFormulaOverrideData = {
  programs: [{
    id: "web-only-program",
    name: "Новая программа Web",
    landingCode: "web-only-program",
    hours: 40,
    databaseFixedValueOverrides: ["hours"]
  }]
};
const webOnlyFormulaTargets = applyStudentDatabaseFormulaBackedWebOverrides(
  webOnlyFormulaOverrideData,
  { programs: [] }
);
assert.equal(webOnlyFormulaTargets.length, 1);
assert.equal(webOnlyFormulaTargets[0].missingInExcel, true);

const derivedFormulaWebData = clone(sameStudentBaselineData);
derivedFormulaWebData.contracts = [{
  id: "derived-contract",
  section: "Обучение",
  name: "Формульный договор",
  contractNo: "1",
  contractDate: "2026-08-27",
  amount: 100,
  paid: 50,
  balance: 50,
  message1: "Web cache"
}];
derivedFormulaWebData.generalExpenses = [{
  id: "derived-general-expense",
  section: "Общие",
  counterparty: "Контрагент",
  date: "2026-08-27",
  workType: "Работа",
  amount: 100,
  paid: 10
}];
const derivedFormulaExcelData = clone(derivedFormulaWebData);
derivedFormulaExcelData.contracts[0].amount = 200;
derivedFormulaExcelData.contracts[0].paid = 75;
derivedFormulaExcelData.contracts[0].balance = 125;
derivedFormulaExcelData.contracts[0].message1 = "XLSB cache";
derivedFormulaExcelData.generalExpenses[0].paid = 25;
assert.notEqual(
  hashStudentDatabaseCriticalSnapshot(derivedFormulaWebData),
  hashStudentDatabaseCriticalSnapshot(derivedFormulaExcelData),
  "Пересчитанные формульные поля должны оставаться под контролем изменений"
);
const derivedFormulaConflict = resolveStudentDatabaseCompleteReconciliation({
  webData: derivedFormulaWebData,
  excelData: derivedFormulaExcelData
});
assert.equal(derivedFormulaConflict.conflicts.length, 1);
assert.equal(derivedFormulaConflict.conflicts[0].kind, "snapshot");
assert.equal(derivedFormulaConflict.snapshotFallback, true);
const derivedFormulaReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: derivedFormulaWebData,
  excelData: derivedFormulaExcelData,
  conflictResolutions: { [derivedFormulaConflict.conflicts[0].id]: "excel" }
});
assert.deepStrictEqual(derivedFormulaReconciliation.conflicts, []);
assert.equal(derivedFormulaReconciliation.collections.contracts[0].amount, 200);
assert.equal(derivedFormulaReconciliation.collections.generalExpenses[0].paid, 25);
const recalculatedDerivedFormulaOutput = clone(derivedFormulaReconciliation.collections);
recalculatedDerivedFormulaOutput.contracts[0].amount = 300;
recalculatedDerivedFormulaOutput.contracts[0].balance = 225;
recalculatedDerivedFormulaOutput.generalExpenses[0].paid = 50;
assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
  derivedFormulaReconciliation.collections,
  recalculatedDerivedFormulaOutput,
  derivedFormulaReconciliation
));
const derivedFormulaFromWeb = resolveStudentDatabaseCompleteReconciliation({
  webData: derivedFormulaWebData,
  excelData: derivedFormulaExcelData,
  conflictResolutions: { [derivedFormulaConflict.conflicts[0].id]: "web" }
});
assert.deepStrictEqual(derivedFormulaFromWeb.conflicts, []);
assert.equal(
  (derivedFormulaFromWeb.collections.contracts[0].databaseFixedValueOverrides || [])
    .some((fieldName) => [
      "amount",
      "paid",
      "agencyAmount",
      "balance",
      "message1"
    ].includes(fieldName)),
  false,
  "Выбор Web не должен заменять формулы договоров фиксированными значениями"
);
assert.equal(
  (derivedFormulaFromWeb.collections.generalExpenses[0].databaseFixedValueOverrides || [])
    .includes("paid"),
  false,
  "Выбор Web не должен заменять формулу оплаты общих затрат"
);
const recalculatedDerivedFormulaFromWebOutput = clone(derivedFormulaFromWeb.collections);
recalculatedDerivedFormulaFromWebOutput.contracts[0].amount = 350;
recalculatedDerivedFormulaFromWebOutput.contracts[0].paid = 80;
recalculatedDerivedFormulaFromWebOutput.contracts[0].balance = 270;
recalculatedDerivedFormulaFromWebOutput.contracts[0].message1 = "Recalculated";
recalculatedDerivedFormulaFromWebOutput.generalExpenses[0].paid = 60;
assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
  derivedFormulaFromWeb.collections,
  recalculatedDerivedFormulaFromWebOutput,
  derivedFormulaFromWeb
));

const allExcelCompleteReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: webDataWithIndependentAddition,
  excelData: sameFieldExcelData,
  conflictResolutions: Object.fromEntries(
    completeReconciliation.conflicts.map((conflict) => [conflict.id, "excel"])
  )
});
assert.deepStrictEqual(allExcelCompleteReconciliation.conflicts, []);
assert.equal(
  hashStudentDatabaseCriticalSnapshot(allExcelCompleteReconciliation.collections),
  hashStudentDatabaseCriticalSnapshot(sameFieldExcelData)
);
assert.equal(
  allExcelCompleteReconciliation.students.some((student) => student.id === "student-zagodarchuk-new"),
  false
);
const incorrectExcelSelectionOutput = clone(allExcelCompleteReconciliation.collections);
incorrectExcelSelectionOutput.students[0].note = "Третье значение";
assert.throws(
  () => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
    allExcelCompleteReconciliation.collections,
    incorrectExcelSelectionOutput,
    allExcelCompleteReconciliation
  ),
  /изменилось при записи|записано не в выбранном варианте/iu
);

const excelDataWithIndependentAddition = clone(sameFieldExcelData);
excelDataWithIndependentAddition.students.push({
  id: "student-excel-only",
  uid: "1172",
  name: "Слушатель только в XLSB",
  applicationDate: "2026-08-27",
  program: "Программа 5",
  note: "Добавлено в Excel"
});
const excelOnlyPresenceReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: sameFieldExcelData,
  excelData: excelDataWithIndependentAddition
});
assert.equal(excelOnlyPresenceReconciliation.conflicts.length, 1);
assert.equal(excelOnlyPresenceReconciliation.conflicts[0].kind, "record-presence");
assert.equal(excelOnlyPresenceReconciliation.conflicts[0].recordId, "student-excel-only");
assert.equal(excelOnlyPresenceReconciliation.collections, null);
assert.equal(excelOnlyPresenceReconciliation.students, null);

const eventSettingsWebData = clone(sameStudentBaselineData);
eventSettingsWebData.macroSettings = {
  studentEventTemplates: [{ label: "Событие Web", includeTypes: [], excludeTypes: [] }],
  contractEventTemplates: []
};
const eventSettingsExcelData = clone(sameStudentBaselineData);
eventSettingsExcelData.macroSettings = {
  studentEventTemplates: [{ label: "Событие XLSB", includeTypes: [], excludeTypes: [] }],
  contractEventTemplates: []
};
const eventSettingsReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: eventSettingsWebData,
  excelData: eventSettingsExcelData
});
assert.equal(eventSettingsReconciliation.conflicts.length, 1);
assert.equal(eventSettingsReconciliation.conflicts[0].kind, "settings");
const resolvedEventSettingsFromExcel = resolveStudentDatabaseCompleteReconciliation({
  webData: eventSettingsWebData,
  excelData: eventSettingsExcelData,
  conflictResolutions: {
    [eventSettingsReconciliation.conflicts[0].id]: "excel"
  }
});
assert.deepStrictEqual(resolvedEventSettingsFromExcel.conflicts, []);
assert.equal(resolvedEventSettingsFromExcel.eventSettingsChoice, "excel");

const renamedProgramWebData = clone(sameStudentBaselineData);
renamedProgramWebData.programs = [{
  id: "renamed-program",
  name: "Новое имя Web",
  landingCode: "new-code",
  xlsbProgramName: "Старое имя XLSB",
  xlsbProgramLandingCode: "old-code",
  xlsbProgramRow: 25
}];
renamedProgramWebData.trainingPlans = [{
  id: "renamed-plan",
  programId: "renamed-program",
  programName: "Старое имя XLSB",
  code: "1",
  discipline: "Модуль",
  theoryHours: 1,
  practiceHours: 1,
  totalHours: 2
}];
const renamedProgramExcelData = clone(renamedProgramWebData);
renamedProgramExcelData.programs[0].name = "Старое имя XLSB";
renamedProgramExcelData.programs[0].landingCode = "old-code";
assert.notEqual(
  hashStudentDatabaseCriticalSnapshot(renamedProgramWebData),
  hashStudentDatabaseCriticalSnapshot(renamedProgramExcelData),
  "Изменение рабочего названия программы в Web должно считаться критичным даже при старом XLSB-алиасе"
);
const renamedProgramSnapshot = resolveStudentDatabaseCompleteReconciliation({
  webData: renamedProgramWebData,
  excelData: renamedProgramExcelData,
  forceSnapshotChoice: true
});
const renamedProgramFromWeb = resolveStudentDatabaseCompleteReconciliation({
  webData: renamedProgramWebData,
  excelData: renamedProgramExcelData,
  forceSnapshotChoice: true,
  conflictResolutions: { [renamedProgramSnapshot.conflicts[0].id]: "web" }
});
assert.equal(
  renamedProgramFromWeb.collections.programs[0].xlsbProgramName,
  "Старое имя XLSB",
  "Старое имя XLSB должно сохраниться как ключ поиска существующей строки при переименовании"
);
assert.equal(
  renamedProgramFromWeb.collections.programs[0].xlsbProgramLandingCode,
  "old-code",
  "Старый код XLSB должен сохраниться как ключ поиска существующей строки при переименовании"
);
assert.equal(renamedProgramFromWeb.collections.trainingPlans[0].programName, "Новое имя Web");
assert.ok(renamedProgramFromWeb.collections.programs[0].databaseFixedValueOverrides.includes("name"));
assert.ok(renamedProgramFromWeb.collections.programs[0].databaseFixedValueOverrides.includes("landingCode"));
const materializedRenamedProgram = materializeStudentDatabaseReconciledCollections(
  renamedProgramFromWeb.collections
);
assert.ok(materializedRenamedProgram.programs[0].databaseFixedValueOverrides.includes("name"));

const canonicalProgramWebData = clone(renamedProgramWebData);
canonicalProgramWebData.programs[0].name = "Выбранное имя Web";
canonicalProgramWebData.trainingPlans[0].programName = "Устаревшее имя Web";
const canonicalProgramExcelData = clone(canonicalProgramWebData);
canonicalProgramExcelData.programs[0].name = "Имя XLSB";
canonicalProgramExcelData.trainingPlans[0].programName = "Имя XLSB";
const canonicalProgramConflict = resolveStudentDatabaseCompleteReconciliation({
  webData: canonicalProgramWebData,
  excelData: canonicalProgramExcelData
});
const canonicalProgramGroupConflict = canonicalProgramConflict.conflicts.find((conflict) => (
  conflict.kind === "snapshot-group" && conflict.entity === "Программы и учебные планы"
));
assert.ok(canonicalProgramGroupConflict);
const canonicalProgramFromWeb = resolveStudentDatabaseCompleteReconciliation({
  webData: canonicalProgramWebData,
  excelData: canonicalProgramExcelData,
  conflictResolutions: { [canonicalProgramGroupConflict.id]: "web" }
});
assert.deepStrictEqual(canonicalProgramFromWeb.conflicts, []);
assert.equal(
  canonicalProgramFromWeb.collections.trainingPlans[0].programName,
  "Выбранное имя Web"
);
assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
  canonicalProgramFromWeb.collections,
  clone(canonicalProgramFromWeb.collections),
  canonicalProgramFromWeb
));

const formulaDerivedTrainingPlanCodes = clone(renamedProgramWebData);
formulaDerivedTrainingPlanCodes.trainingPlans[0].code = "57";
formulaDerivedTrainingPlanCodes.trainingPlans[0].totalHours = 999;
assert.equal(
  hashStudentDatabaseCriticalSnapshot(renamedProgramWebData),
  hashStudentDatabaseCriticalSnapshot(formulaDerivedTrainingPlanCodes),
  "Глобальный номер строки и формульный итог часов учебного плана не являются пользовательскими конфликтами"
);

const frdoCompositeWebData = clone(sameStudentBaselineData);
frdoCompositeWebData.students[0].frdoStatus = "";
frdoCompositeWebData.students[0].frdoDate = "2026-08-27";
frdoCompositeWebData.students[0].note = "Примечание Web";
const frdoCompositeExcelData = clone(sameStudentBaselineData);
frdoCompositeExcelData.students[0].frdoStatus = "Не выгружен";
delete frdoCompositeExcelData.students[0].frdoDate;
frdoCompositeExcelData.students[0].note = "Примечание XLSB";
const frdoCompositeConflicts = resolveStudentDatabaseCompleteReconciliation({
  webData: frdoCompositeWebData,
  excelData: frdoCompositeExcelData
});
const frdoConflict = frdoCompositeConflicts.conflicts.find((item) => item.fieldName === "frdoStatus");
const frdoNoteConflict = frdoCompositeConflicts.conflicts.find((item) => item.fieldName === "note");
assert.ok(frdoConflict);
assert.ok(frdoNoteConflict);
const resolvedFrdoComposite = resolveStudentDatabaseCompleteReconciliation({
  webData: frdoCompositeWebData,
  excelData: frdoCompositeExcelData,
  conflictResolutions: {
    [frdoConflict.id]: "excel",
    [frdoNoteConflict.id]: "web"
  }
});
assert.deepStrictEqual(resolvedFrdoComposite.conflicts, []);
assert.equal(resolvedFrdoComposite.students[0].frdoStatus, "Не выгружен");
assert.equal(Object.prototype.hasOwnProperty.call(resolvedFrdoComposite.students[0], "frdoDate"), false);
assert.equal(resolvedFrdoComposite.students[0].note, "Примечание Web");

const linkedExpenseWebData = clone(sameStudentBaselineData);
const linkedExpenseExcelData = clone(sameStudentBaselineData);
linkedExpenseExcelData.students[0].directExpenses = [{
  id: "linked-expense-xlsb",
  uid: linkedExpenseExcelData.students[0].uid,
  date: "2026-08-27",
  type: "Материалы",
  amount: 100,
  note: "Только XLSB"
}];
const linkedExpenseFallback = resolveStudentDatabaseCompleteReconciliation({
  webData: linkedExpenseWebData,
  excelData: linkedExpenseExcelData
});
assert.equal(linkedExpenseFallback.conflicts.length, 1);
assert.equal(linkedExpenseFallback.conflicts[0].kind, "snapshot-group");
const linkedExpenseFromExcel = resolveStudentDatabaseCompleteReconciliation({
  webData: linkedExpenseWebData,
  excelData: linkedExpenseExcelData,
  conflictResolutions: { [linkedExpenseFallback.conflicts[0].id]: "excel" }
});
assert.equal(linkedExpenseFromExcel.collections.students[0].directExpenses, undefined);
assert.equal(linkedExpenseFromExcel.collections.directExpenses.length, 1);
assert.equal(
  hashStudentDatabaseCriticalSnapshot({
    ...linkedExpenseFromExcel.collections,
    inventoryRows: linkedExpenseFromExcel.collections.inventory
  }),
  hashStudentDatabaseCriticalSnapshot(linkedExpenseExcelData)
);

const canonicalInventoryWebData = clone(sameStudentBaselineData);
canonicalInventoryWebData.inventoryRows = [{
  id: "canonical-inventory-unit",
  inventoryId: "canonical-inventory-paper",
  uid: "1148",
  date: "2026-08-27",
  itemType: "Paper",
  amount: 100,
  note: "Web"
}];
canonicalInventoryWebData.directExpenses = [{
  id: "canonical-inventory-expense",
  uid: "1148",
  date: "2026-08-27",
  type: "paper",
  amount: 100,
  note: "Web",
  inventoryId: "canonical-inventory-paper"
}];
const canonicalInventoryExcelData = clone(canonicalInventoryWebData);
canonicalInventoryExcelData.inventoryRows[0].itemType = "PAPER";
canonicalInventoryExcelData.inventoryRows[0].note = "XLSB";
canonicalInventoryExcelData.directExpenses[0].type = "PAPER";
canonicalInventoryExcelData.directExpenses[0].note = "XLSB";
const canonicalInventoryConflict = resolveStudentDatabaseCompleteReconciliation({
  webData: canonicalInventoryWebData,
  excelData: canonicalInventoryExcelData
});
const canonicalInventoryGroupConflict = canonicalInventoryConflict.conflicts.find((conflict) => (
  conflict.kind === "snapshot-group" && conflict.entity === "Запасы и прямые затраты"
));
assert.ok(canonicalInventoryGroupConflict);
const canonicalInventoryFromWeb = resolveStudentDatabaseCompleteReconciliation({
  webData: canonicalInventoryWebData,
  excelData: canonicalInventoryExcelData,
  conflictResolutions: { [canonicalInventoryGroupConflict.id]: "web" }
});
assert.deepStrictEqual(canonicalInventoryFromWeb.conflicts, []);
assert.equal(canonicalInventoryFromWeb.collections.directExpenses[0].type, "Paper");
const canonicalInventoryIntended = {
  ...canonicalInventoryFromWeb.collections,
  inventoryRows: canonicalInventoryFromWeb.collections.inventory
};
assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(
  canonicalInventoryIntended,
  clone(canonicalInventoryIntended),
  canonicalInventoryFromWeb
));

const legacyAllocatedInventoryCollections = {
  students: [],
  contracts: [],
  directExpenses: [],
  generalExpenses: [],
  inventory: [{
    id: "legacy-issued-unit",
    uid: "1148",
    date: "2026-08-27",
    itemType: "Бланк удостоверения",
    amount: 150,
    note: "Выдано слушателю",
    databaseSync: {
      recordId: "legacy-issued-unit",
      parentRecordId: "legacy-inventory-parent"
    }
  }],
  programs: [],
  trainingPlans: []
};
const materializedLegacyAllocation = materializeStudentDatabaseReconciledCollections(
  legacyAllocatedInventoryCollections,
  "2026-08-27T11:00:00.000Z"
);
assert.equal(materializedLegacyAllocation.directExpenses.length, 1);
assert.equal(materializedLegacyAllocation.directExpenses[0].uid, "1148");
assert.equal(materializedLegacyAllocation.directExpenses[0].type, "Бланк удостоверения");
assert.equal(materializedLegacyAllocation.directExpenses[0].inventoryLink, "Бланк удостоверения");
assertMaterializedSyncRow(materializedLegacyAllocation.directExpenses[0], "directExpenses");

const linkedExpenseWithoutDisplayLink = materializeStudentDatabaseReconciledCollections({
  ...legacyAllocatedInventoryCollections,
  directExpenses: [{
    id: "legacy-linked-expense",
    uid: "1148",
    date: "2026-08-27",
    type: "Бланк удостоверения",
    amount: 150,
    note: "Выдано слушателю",
    inventoryId: "legacy-inventory-parent",
    inventoryLink: ""
  }]
});
assert.equal(linkedExpenseWithoutDisplayLink.directExpenses.length, 1);
assert.equal(
  linkedExpenseWithoutDisplayLink.directExpenses[0].inventoryLink,
  "Бланк удостоверения"
);

const duplicateLookingAllocatedUnits = materializeStudentDatabaseReconciledCollections({
  ...legacyAllocatedInventoryCollections,
  inventory: ["first", "second"].map((suffix) => ({
    ...legacyAllocatedInventoryCollections.inventory[0],
    id: `legacy-issued-unit-${suffix}`,
    databaseSync: {
      recordId: `legacy-issued-unit-${suffix}`,
      parentRecordId: "legacy-inventory-parent"
    }
  }))
});
assert.equal(duplicateLookingAllocatedUnits.directExpenses.length, 2);
assert.equal(
  new Set(duplicateLookingAllocatedUnits.directExpenses.map((expense) => expense.id)).size,
  2,
  "Одинаковые по значениям выданные единицы с разными стабильными ID не должны схлопываться"
);

const reconciliationSyncTimestamp = "2026-08-27T12:00:00.000Z";
const materializedAllExcel = materializeStudentDatabaseReconciledCollections(
  allExcelCompleteReconciliation.collections,
  reconciliationSyncTimestamp
);
assert.equal(materializedAllExcel.students.length, 1);
const allExcelStudentMetadata = assertMaterializedSyncRow(
  materializedAllExcel.students[0],
  "students"
);
assert.equal(allExcelStudentMetadata.syncedAt, reconciliationSyncTimestamp);

const selectedExcelOnlyReconciliation = resolveStudentDatabaseCompleteReconciliation({
  webData: sameFieldExcelData,
  excelData: excelDataWithIndependentAddition,
  conflictResolutions: {
    [excelOnlyPresenceReconciliation.conflicts[0].id]: "excel"
  }
});
assert.deepStrictEqual(selectedExcelOnlyReconciliation.conflicts, []);
const materializedExcelOnly = materializeStudentDatabaseReconciledCollections(
  selectedExcelOnlyReconciliation.collections,
  reconciliationSyncTimestamp
);
const materializedExcelOnlyStudent = materializedExcelOnly.students.find((student) => (
  student.id === "student-excel-only"
));
assertMaterializedSyncRow(materializedExcelOnlyStudent, "students", "student-excel-only");

const syntheticReconciledCollections = {
  students: [{
    id: "synthetic-student",
    uid: "2001",
    name: "Синтетический слушатель",
    directExpenses: [{ id: "nested-expense", amount: 1 }],
    databaseSync: { recordId: "synthetic-student" }
  }],
  contracts: [{
    id: "synthetic-contract",
    number: "ДО-2001",
    databaseSync: { recordId: "synthetic-contract" }
  }],
  directExpenses: [{
    id: "synthetic-direct-expense",
    uid: "2001",
    amount: 100,
    databaseSync: { recordId: "synthetic-direct-expense" }
  }],
  generalExpenses: [{
    id: "synthetic-general-expense",
    section: "Связь",
    amount: 200,
    databaseSync: { recordId: "synthetic-general-expense" }
  }],
  inventory: [{
    id: "synthetic-inventory-unit",
    itemType: "Бланк",
    amount: 30,
    databaseSync: {
      recordId: "synthetic-inventory-unit",
      parentRecordId: "synthetic-inventory-parent"
    }
  }],
  programs: [{
    id: "synthetic-program",
    name: "Синтетическая программа",
    price: "12 345,50",
    databaseSync: { recordId: "synthetic-program" }
  }],
  trainingPlans: [{
    id: "synthetic-training-plan",
    programId: "synthetic-program",
    code: "900.0",
    programName: "  Синтетическая программа  ",
    discipline: "  Итоговая дисциплина  ",
    theoryHours: "10",
    practiceHours: "2,5",
    totalHours: "999",
    databaseSync: { recordId: "synthetic-training-plan" }
  }]
};
const materializedSynthetic = materializeStudentDatabaseReconciledCollections(
  syntheticReconciledCollections,
  reconciliationSyncTimestamp
);
const materializedEntities = {
  students: "students",
  contracts: "contracts",
  directExpenses: "directExpenses",
  generalExpenses: "generalExpenses",
  inventory: "inventoryUnits",
  programs: "programs",
  trainingPlans: "trainingPlans"
};
Object.entries(materializedEntities).forEach(([collectionName, entity]) => {
  assert.equal(materializedSynthetic[collectionName].length, 1, `Коллекция ${collectionName}`);
  const metadata = assertMaterializedSyncRow(materializedSynthetic[collectionName][0], entity);
  assert.equal(metadata.syncedAt, reconciliationSyncTimestamp);
});
const syntheticInventoryMetadata = JSON.parse(materializedSynthetic.inventory[0].__syncComment);
assert.equal(syntheticInventoryMetadata.parentRecordId, "synthetic-inventory-parent");
assert.ok(Array.isArray(materializedSynthetic.programs[0].providedFields));
assert.ok(materializedSynthetic.programs[0].providedFields.includes("price"));
assert.equal(materializedSynthetic.programs[0].price, 12345.5);
assert.equal(materializedSynthetic.trainingPlans[0].code, "900");
assert.equal(materializedSynthetic.trainingPlans[0].programName, "Синтетическая программа");
assert.equal(materializedSynthetic.trainingPlans[0].discipline, "Итоговая дисциплина");
assert.equal(materializedSynthetic.trainingPlans[0].theoryHours, 10);
assert.equal(materializedSynthetic.trainingPlans[0].practiceHours, 2.5);
assert.equal(materializedSynthetic.trainingPlans[0].totalHours, 12.5);
assert.equal(materializedSynthetic.students[0].directExpenses, undefined);

const conflictId = unresolvedSameField.conflicts[0].id;
const resolvedFromExcel = resolveStudentDatabaseFieldLevelMerge({
  webData: sameStudentWebData,
  excelData: sameFieldExcelData,
  baseline: sameStudentBaseline,
  auditRows: sameStudentAuditRows,
  conflictResolutions: { [conflictId]: "excel" }
});
assert.deepStrictEqual(resolvedFromExcel.conflicts, []);
assert.equal(resolvedFromExcel.students[0].note, "Добавлено в Excel");
assert.match(resolvedFromExcel.changes[0].action, /Конфликт: Excel → Web/u);

const resolvedFromWeb = resolveStudentDatabaseFieldLevelMerge({
  webData: sameStudentWebData,
  excelData: sameFieldExcelData,
  baseline: sameStudentBaseline,
  auditRows: sameStudentAuditRows,
  conflictResolutions: { [conflictId]: "web" }
});
assert.deepStrictEqual(resolvedFromWeb.conflicts, []);
assert.equal(resolvedFromWeb.students[0].note, "Добавлено в Web");
assert.match(resolvedFromWeb.changes[0].action, /Конфликт: Web → Excel/u);

const multiTableBaselineData = clone(sameStudentBaselineData);
multiTableBaselineData.directExpenses = [{
  id: "web-expense-1",
  uid: "1148",
  date: "2026-08-20",
  type: "Почтовое отправление",
  amount: 100,
  note: "Почта"
}, {
  id: "web-expense-2",
  uid: "1148",
  date: "2026-08-20",
  type: "Почтовое отправление",
  amount: 100,
  note: "Почта"
}];
const multiTableWebData = clone(multiTableBaselineData);
multiTableWebData.students[0].note = "Добавлено в Web";
const multiTableExcelData = clone(multiTableBaselineData);
multiTableExcelData.directExpenses = multiTableExcelData.directExpenses.map((expense, index) => ({
  ...expense,
  id: `excel-expense-${index + 1}`,
  amount: index === 0 ? 130 : expense.amount
}));
const multiTableMerge = resolveStudentDatabaseFieldLevelMerge({
  webData: multiTableWebData,
  excelData: multiTableExcelData,
  baseline: {
    ...sameStudentBaseline,
    criticalHash: hashStudentDatabaseCriticalSnapshot(multiTableBaselineData),
    criticalIdentityHash: hashStudentDatabaseCriticalIdentity(multiTableBaselineData)
  },
  auditRows: sameStudentAuditRows
});
assert.ok(multiTableMerge, "Изменения Excel в другой таблице должны войти в общее слияние");
assert.deepStrictEqual(multiTableMerge.conflicts, []);
assert.equal(multiTableMerge.collections.students[0].note, "Добавлено в Web");
assert.equal(multiTableMerge.collections.directExpenses[0].amount, 130);
assert.equal(multiTableMerge.collections.directExpenses[1].amount, 100);
assert.ok(multiTableMerge.changes.some((change) => (
  change.entity === "Прямые затраты"
  && change.field === "Сумма"
  && change.action === "Excel → Web"
)));

const baseline = {
  version: 1,
  sourceHash: "a".repeat(64),
  sourceIdentity: "1".repeat(64),
  webRevision: 42,
  synchronizedAt: "2026-08-20T10:00:00.000Z"
};
const directionBase = {
  baseline,
  currentWebRevision: 42,
  currentWebUpdatedAt: "2026-08-20T10:00:00.000Z",
  sourceHash: "a".repeat(64),
  sourceIdentity: "1".repeat(64),
  sourceModifiedAt: "2026-08-20T10:00:00.000Z"
};
assert.strictEqual(
  resolveStudentDatabaseSyncDirection(directionBase).direction,
  "unchanged"
);
assert.strictEqual(
  resolveStudentDatabaseSyncDirection({
    ...directionBase,
    sourceHash: "b".repeat(64)
  }).direction,
  "excel-to-web"
);
assert.throws(
  () => resolveStudentDatabaseSyncDirection({
    currentWebRevision: 50,
    currentWebUpdatedAt: "",
    sourceHash: "c".repeat(64),
    sourceModifiedAt: "2026-08-20T12:00:00.000Z",
    lastExportedAt: "2026-08-20T10:00:00.000Z"
  }),
  /не удалось получить время изменения/u
);
assert.throws(
  () => resolveStudentDatabaseSyncDirection({
    currentWebRevision: 50,
    currentWebUpdatedAt: "2026-08-20T09:00:00.000Z",
    sourceHash: "c".repeat(64),
    sourceModifiedAt: "",
    lastExportedAt: "2026-08-20T10:00:00.000Z"
  }),
  /не удалось получить время изменения/u
);
assert.strictEqual(
  resolveStudentDatabaseSyncDirection({
    ...directionBase,
    currentWebRevision: 43
  }).direction,
  "web-to-excel"
);
assert.throws(
  () => resolveStudentDatabaseSyncDirection({
    ...directionBase,
    sourceHash: "b".repeat(64),
    currentWebRevision: 43
  }),
  /изменились и Web-база, и файл XLSB/u
);
assert.throws(
  () => resolveStudentDatabaseSyncDirection({
    ...directionBase,
    sourceIdentity: "2".repeat(64)
  }),
  /Выбран другой файл или источник XLSB/u
);
assert.throws(
  () => resolveStudentDatabaseSyncDirection({
    currentWebRevision: 50,
    currentWebUpdatedAt: "2026-08-20T11:00:00.000Z",
    sourceHash: "c".repeat(64),
    sourceModifiedAt: "2026-08-20T12:00:00.000Z",
    lastExportedAt: "2026-08-20T10:00:00.000Z"
  }),
  /менялись и Web-база, и файл XLSB/u
);
assert.throws(
  () => resolveStudentDatabaseSyncDirection({
    currentWebRevision: 50,
    currentWebUpdatedAt: "2026-08-20T09:00:00.000Z",
    sourceHash: "c".repeat(64),
    sourceIdentity: "3".repeat(64),
    sourceModifiedAt: "2026-08-20T09:30:00.000Z",
    lastExportedAt: "2026-08-20T10:00:00.000Z"
  }),
  /Совпадение данных не доказано/u
);
assert.strictEqual(
  resolveStudentDatabaseSyncDirection({
    currentWebRevision: 50,
    currentWebUpdatedAt: "2026-08-20T09:00:00.000Z",
    sourceHash: "c".repeat(64),
    sourceModifiedAt: "2026-08-20T12:00:00.000Z",
    lastExportedAt: "2026-08-20T10:00:00.000Z"
  }).direction,
  "excel-to-web"
);

const generalExpenseSectionWeb = clone(sameStudentBaselineData);
generalExpenseSectionWeb.generalExpenses = [{
  id: "general-section-test",
  section: "Физлица",
  counterparty: "Контрагент",
  date: "2026-08-27",
  workType: "Услуга",
  amount: 100
}];
const generalExpenseSectionExcel = clone(generalExpenseSectionWeb);
generalExpenseSectionExcel.generalExpenses[0].section = "Организации";
assert.notEqual(
  hashStudentDatabaseCriticalSnapshot(generalExpenseSectionWeb),
  hashStudentDatabaseCriticalSnapshot(generalExpenseSectionExcel),
  "Перемещение общей затраты между разделами должно менять критический снимок"
);

const contractBooleanWeb = clone(sameStudentBaselineData);
contractBooleanWeb.contracts = [{
  id: "contract-bool",
  name: "Проверка флагов",
  contractNo: "1",
  accountingRecorded: "Да",
  notificationEmail: "Да"
}];
const contractBooleanExcel = clone(contractBooleanWeb);
contractBooleanExcel.contracts[0].accountingRecorded = true;
contractBooleanExcel.contracts[0].notificationEmail = true;
assert.equal(
  hashStudentDatabaseCriticalSnapshot(contractBooleanWeb),
  hashStudentDatabaseCriticalSnapshot(contractBooleanExcel),
  "Строковые и булевы представления флагов договора должны быть эквивалентны"
);

const customContractEventWeb = clone(sameStudentBaselineData);
customContractEventWeb.contracts = [{
  id: "contract-event",
  name: "Проверка события",
  contractNo: "2",
  additionalSettings: "",
  eventOrder: "customEvent_source",
  eventCustomKeys: "customEvent_source",
  event_customEvent_source_label: "Особое событие",
  event_customEvent_source_date: "2026-08-27",
  event_customEvent_source_state: "dated"
}];
const customContractEventExcel = clone(customContractEventWeb);
customContractEventExcel.contracts[0] = {
  ...customContractEventExcel.contracts[0],
  additionalSettings: [
    "[КарточкаКонтрагента]",
    "События=",
    "[КарточкаКонтрагента\\События]",
    "Выд=0",
    "[КарточкаКонтрагента\\События\\1]",
    "0=27.08.2026",
    "1=Особое событие"
  ].join("\n"),
  eventOrder: "imported_target",
  eventCustomKeys: "imported_target",
  event_imported_target_label: "Особое событие",
  event_imported_target_date: "2026-08-27",
  event_imported_target_state: "dated"
};
delete customContractEventExcel.contracts[0].event_customEvent_source_label;
delete customContractEventExcel.contracts[0].event_customEvent_source_date;
delete customContractEventExcel.contracts[0].event_customEvent_source_state;
assert.equal(
  hashStudentDatabaseCriticalSnapshot(customContractEventWeb),
  hashStudentDatabaseCriticalSnapshot(customContractEventExcel),
  "Случайный ключ пользовательского события и пересобранный служебный carrier не должны менять смысл снимка"
);

const customStudentEventBase = clone(sameStudentBaselineData);
const customStudentEventWeb = clone(customStudentEventBase);
customStudentEventWeb.students[0].eventOrder = "customEvent_added";
customStudentEventWeb.students[0].eventCustomKeys = "customEvent_added";
customStudentEventWeb.students[0].event_customEvent_added_label = "Непомеченное событие";
assert.notEqual(
  hashStudentDatabaseCriticalSnapshot(customStudentEventBase),
  hashStudentDatabaseCriticalSnapshot(customStudentEventWeb),
  "Добавление даже непомеченного пользовательского события должно менять критический снимок"
);
const importedCustomStudentEvent = clone(customStudentEventWeb);
importedCustomStudentEvent.students[0].eventOrder = "imported_added";
importedCustomStudentEvent.students[0].eventCustomKeys = "imported_added";
importedCustomStudentEvent.students[0].event_imported_added_label = "Непомеченное событие";
delete importedCustomStudentEvent.students[0].event_customEvent_added_label;
assert.equal(
  hashStudentDatabaseCriticalSnapshot(customStudentEventWeb),
  hashStudentDatabaseCriticalSnapshot(importedCustomStudentEvent),
  "Переименование технического ключа события при импорте не должно менять его смысл"
);
const deletedCustomStudentEvent = clone(customStudentEventWeb);
deletedCustomStudentEvent.students[0].eventDeleted = "customEvent_added";
assert.equal(
  hashStudentDatabaseCriticalSnapshot(customStudentEventBase),
  hashStudentDatabaseCriticalSnapshot(deletedCustomStudentEvent),
  "Удалённое событие не должно оставаться в снимке из-за старых полей карточки"
);

const statusCaseWeb = clone(sameStudentBaselineData);
const statusCaseExcel = clone(sameStudentBaselineData);
statusCaseWeb.students[0].additionalStatus = "обучающиеся";
statusCaseExcel.students[0].additionalStatus = "Обучающиеся";
assert.equal(
  hashStudentDatabaseCriticalSnapshot(statusCaseWeb),
  hashStudentDatabaseCriticalSnapshot(statusCaseExcel),
  "Регистр заголовка раздела слушателей не должен создавать ложный конфликт"
);

const mutuallyDeletedWeb = clone(sameStudentBaselineData);
mutuallyDeletedWeb.students = [{ id: "only-web-student", uid: "3101", name: "Только Web" }];
const mutuallyDeletedExcel = clone(sameStudentBaselineData);
mutuallyDeletedExcel.students = [{ id: "only-excel-student", uid: "3102", name: "Только XLSB" }];
const mutuallyDeletedInitial = resolveStudentDatabaseCompleteReconciliation({
  webData: mutuallyDeletedWeb,
  excelData: mutuallyDeletedExcel
});
const mutuallyDeletingChoices = Object.fromEntries(
  mutuallyDeletedInitial.conflicts.map((conflict) => [
    conflict.id,
    conflict.recordId === "only-web-student" ? "excel" : "web"
  ])
);
const nonEmptyStudentsFallback = resolveStudentDatabaseCompleteReconciliation({
  webData: mutuallyDeletedWeb,
  excelData: mutuallyDeletedExcel,
  conflictResolutions: mutuallyDeletingChoices
});
assert.equal(nonEmptyStudentsFallback.conflicts.length, 1);
assert.equal(nonEmptyStudentsFallback.conflicts[0].fieldName, "nonEmptyStudentsSnapshot");
const nonEmptyStudentsResolved = resolveStudentDatabaseCompleteReconciliation({
  webData: mutuallyDeletedWeb,
  excelData: mutuallyDeletedExcel,
  conflictResolutions: {
    ...mutuallyDeletingChoices,
    [nonEmptyStudentsFallback.conflicts[0].id]: "web"
  }
});
assert.equal(nonEmptyStudentsResolved.conflicts.length, 0);
assert.equal(nonEmptyStudentsResolved.collections.students.length, 1);
assert.equal(nonEmptyStudentsResolved.collections.students[0].id, "only-web-student");

const reservation = acquireStudentDatabaseSyncReservation("test-job", 50);
assert.match(reservation.token, /^[a-f0-9]{48}$/u);
assert.strictEqual(getActiveStudentDatabaseSyncReservation()?.token, reservation.token);
assert.throws(
  () => acquireStudentDatabaseSyncReservation("other-job", 50),
  /другая синхронизация XLSB/u
);
releaseStudentDatabaseSyncReservation("wrong-token");
assert.strictEqual(getActiveStudentDatabaseSyncReservation()?.token, reservation.token);
releaseStudentDatabaseSyncReservation(reservation.token);
assert.strictEqual(getActiveStudentDatabaseSyncReservation(), null);

console.log("Student database two-way sync tests passed.");
