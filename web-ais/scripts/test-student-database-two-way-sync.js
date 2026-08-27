const assert = require("assert");
const {
  mergeStudentDatabaseSyncRecords,
  parseStudentDatabaseSyncComment,
  hashStudentDatabaseCriticalSnapshot,
  hashStudentDatabaseCriticalIdentity,
  resolveLegacyStudentDatabaseIndependentNoteMerge,
  resolveStudentDatabaseFieldLevelMerge,
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
