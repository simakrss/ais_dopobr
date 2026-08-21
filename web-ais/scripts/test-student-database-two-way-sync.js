const assert = require("assert");
const {
  mergeStudentDatabaseSyncRecords,
  parseStudentDatabaseSyncComment,
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
