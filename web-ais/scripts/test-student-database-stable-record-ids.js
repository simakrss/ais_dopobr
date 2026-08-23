const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("../vendor/sheetjs/xlsx.full.min.js");
const {
  parseStudentDatabaseWorkbook,
  getStudentDatabaseHumanCommentText,
  resolveStudentDatabaseHumanCommentAssignments,
  assertStudentDatabaseHumanCommentsRelocated,
  reconcileStudentDatabaseImportIdsWithWeb,
  buildStudentDatabaseSyncAnnotationPayload,
  assertStudentDatabaseMetadataOnlyOutput,
  assertStudentDatabaseCommentOnlyOutput
} = require("../app-server.js");

const SYNCED_AT = "2026-08-20T12:34:56.789Z";

function syncComment(entity, recordId, parentRecordId = "") {
  return [
    "Пользовательское примечание",
    "",
    "[[AIS_SYNC_V1]]",
    JSON.stringify({
      v: 1,
      entity,
      recordId,
      syncedAt: SYNCED_AT,
      ...(parentRecordId ? { parentRecordId } : {})
    }),
    "[[/AIS_SYNC_V1]]"
  ].join("\n");
}

function addSheet(workbook, name, rows) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
  return worksheet;
}

function addComment(worksheet, address, text) {
  worksheet[address].c = [{ a: "AIS", t: text }];
}

function buildWorkbook() {
  const workbook = XLSX.utils.book_new();
  const students = addSheet(workbook, "База", [
    ["uid", "ФИО"],
    ["101", "Слушатель Один"],
    ["102", "Слушатель Два"]
  ]);
  addComment(students, "A2", syncComment("students", "student-stable-1"));
  addComment(students, "A3", syncComment("students", "student-stable-2"));

  addSheet(workbook, "Настройки", [["Параметр"], [""]]);

  const programs = addSheet(workbook, "Реестр программ", [
    ["Наименование программы", "Автор", "Код лендинга"],
    ["Программа Один", "Автор", "landing-one"]
  ]);
  addComment(programs, "A2", syncComment("programs", "program-stable-1"));

  const plans = addSheet(workbook, "Учебные планы", [
    ["Код", "Наименование программы", "Дисциплины"],
    ["1", "Программа Один", "Раздел Один"]
  ]);
  addComment(plans, "A2", syncComment("trainingPlans", "plan-stable-1"));

  const inventory = addSheet(workbook, "Запасы", [
    ["Дата", "Вид ТМЦ", "Сумма", "Примечание", "uid"],
    ["2026-08-01", "Конверт", 10, "Выдан", "101"],
    ["2026-08-01", "Конверт", 10, "Остаток", ""]
  ]);
  addComment(
    inventory,
    "A2",
    syncComment("inventoryUnits", "inventory-unit-stable-1", "inventory-stable-1")
  );
  addComment(
    inventory,
    "A3",
    syncComment("inventoryUnits", "inventory-unit-stable-2", "inventory-stable-1")
  );

  const directExpenses = addSheet(workbook, "Прямые затраты", [
    ["uid", "Дата", "Вид затрат", "Сумма", "Примечание", "Связь с запасами"],
    ["101", "2026-08-01", "Конверт", 10, "Выдан", "Конверт"]
  ]);
  addComment(
    directExpenses,
    "A2",
    syncComment("directExpenses", "direct-expense-stable-1")
  );

  const contracts = addSheet(workbook, "Реестр договоров", [
    ["ФИО", "Договор", "Вид договора"],
    ["ДЕЙСТВУЮЩИЕ ДОГОВОРА", "", ""],
    ["Контрагент Один", "15", "Оказание услуг"],
    ["ПАРТНЕРСКАЯ ПРОГРАММА", "", ""],
    ["", "", ""],
    ["ИСТЕКШИЕ ДОГОВОРА", "", ""]
  ]);
  addComment(contracts, "A3", syncComment("contracts", "contract-stable-1"));

  const generalExpenses = addSheet(workbook, "Общие затраты", [
    ["Контрагент", "Дата", "Вид работ", "Описание", "Сумма"],
    ["Физлица", "", "", "", ""],
    ["Исполнитель Один", "2026-08-01", "Работа Один", "", 100],
    ["Организации", "", "", "", ""],
    ["Организация Один", "2026-08-02", "Работа Два", "", 200]
  ]);
  addComment(
    generalExpenses,
    "A3",
    syncComment("generalExpenses", "general-expense-stable-1")
  );
  addComment(
    generalExpenses,
    "A5",
    syncComment("generalExpenses", "general-expense-stable-2")
  );
  return workbook;
}

function toBytes(workbook) {
  return XLSX.write(workbook, {
    bookType: "xlsb",
    type: "buffer",
    cellComments: true
  });
}

function flattenDirectExpenses(result) {
  return [
    ...result.directExpenses,
    ...result.students.flatMap((student) => student.directExpenses || [])
  ];
}

function assertStableIds(result) {
  assert.deepEqual(
    result.students.map((row) => row.id).sort(),
    ["student-stable-1", "student-stable-2"]
  );
  assert.equal(result.contracts[0].id, "contract-stable-1");
  assert.deepEqual(
    result.generalExpenses.map((row) => row.id),
    ["general-expense-stable-1", "general-expense-stable-2"]
  );
  assert.equal(result.inventory[0].id, "inventory-stable-1");
  assert.equal(result.trainingPlans[0].id, "plan-stable-1");
  assert.equal(result.programPaymentSettings[0].id, "program-stable-1");
  const directExpense = flattenDirectExpenses(result)
    .find((row) => row.id === "direct-expense-stable-1");
  assert.ok(directExpense);
  assert.equal(directExpense.inventoryId, "inventory-stable-1");
}

const workbook = buildWorkbook();
const parsedWorkbook = parseStudentDatabaseWorkbook(toBytes(workbook));
assertStableIds(parsedWorkbook);
const validationMetadataPlan = buildStudentDatabaseSyncAnnotationPayload(parsedWorkbook, SYNCED_AT);
const validationMetadataWorkbook = buildWorkbook();
validationMetadataPlan.syncMetadataRows.forEach((entry) => {
  const address = XLSX.utils.encode_cell({ r: entry.row - 1, c: 0 });
  delete validationMetadataWorkbook.Sheets[entry.sheetName][address].c;
});
const validationMetadataBytes = toBytes(validationMetadataWorkbook);
assertStableIds(parseStudentDatabaseWorkbook(
  validationMetadataBytes,
  () => {},
  { syncMetadataRows: validationMetadataPlan.syncMetadataRows }
));
assert.throws(
  () => parseStudentDatabaseWorkbook(validationMetadataBytes, () => {}, {
    syncMetadataRows: validationMetadataPlan.syncMetadataRows.map((entry, index) => (
      index === 0
        ? { ...entry, metadata: JSON.stringify({ ...JSON.parse(entry.metadata), entity: "contracts" }) }
        : entry
    ))
  }),
  /находится на листе записей типа/u
);

const firstSyncWorkbook = buildWorkbook();
[
  ["База", "A2"],
  ["База", "A3"],
  ["Реестр программ", "A2"],
  ["Учебные планы", "A2"],
  ["Запасы", "A2"],
  ["Запасы", "A3"],
  ["Прямые затраты", "A2"],
  ["Реестр договоров", "A3"],
  ["Общие затраты", "A3"],
  ["Общие затраты", "A5"]
].forEach(([sheetName, address]) => {
  firstSyncWorkbook.Sheets[sheetName][address].c = [{ a: "User", t: "Пользовательское примечание" }];
});
const firstSyncParsed = parseStudentDatabaseWorkbook(toBytes(firstSyncWorkbook));
const firstSyncDirectExpenses = flattenDirectExpenses(firstSyncParsed);
const cloneWithoutSync = (record, id) => {
  const cloned = JSON.parse(JSON.stringify(record));
  delete cloned.databaseSync;
  delete cloned.databaseSyncSourceRow;
  cloned.id = id;
  return cloned;
};
const webPayload = {
  students: firstSyncParsed.students.map((record, index) => cloneWithoutSync(record, `web-student-${index + 1}`)),
  contracts: firstSyncParsed.contracts.map((record, index) => cloneWithoutSync(record, `web-contract-${index + 1}`)),
  directExpenses: firstSyncDirectExpenses.map((record, index) => cloneWithoutSync(record, `web-direct-${index + 1}`)),
  generalExpenses: firstSyncParsed.generalExpenses.map((record, index) => cloneWithoutSync(record, `web-general-${index + 1}`)),
  inventory: firstSyncParsed.inventory.map((record, index) => cloneWithoutSync(record, `web-inventory-${index + 1}`)),
  trainingPlans: firstSyncParsed.trainingPlans.map((record, index) => cloneWithoutSync(record, `web-plan-${index + 1}`)),
  programs: firstSyncParsed.programPaymentSettings.map((record, index) => cloneWithoutSync(record, `web-program-${index + 1}`))
};
reconcileStudentDatabaseImportIdsWithWeb(firstSyncParsed, webPayload);
assert.deepEqual(firstSyncParsed.students.map((record) => record.id), ["web-student-1", "web-student-2"]);
assert.equal(firstSyncParsed.contracts[0].id, "web-contract-1");
assert.equal(firstSyncDirectExpenses[0].id, "web-direct-1");
assert.deepEqual(
  firstSyncParsed.generalExpenses.map((record) => record.id),
  ["web-general-1", "web-general-2"]
);
assert.equal(firstSyncParsed.inventory[0].id, "web-inventory-1");
assert.equal(firstSyncParsed.trainingPlans[0].id, "web-plan-1");
assert.equal(firstSyncParsed.programPaymentSettings[0].id, "web-program-1");
assert.equal(
  firstSyncParsed.databaseSyncInventoryUnits.every((unit) => unit.inventoryId === "web-inventory-1"),
  true
);
const firstSyncPlan = buildStudentDatabaseSyncAnnotationPayload(firstSyncParsed, SYNCED_AT);
assert.equal(
  firstSyncPlan.syncCommentRows.some((row) => row.recordId.startsWith("student-db-")),
  false,
  "Первая Excel → Web синхронизация должна записать итоговые Web ID, а не row-based ID"
);

const conflictingStableWorkbook = buildWorkbook();
const conflictingStableParsed = parseStudentDatabaseWorkbook(toBytes(conflictingStableWorkbook));
assert.throws(
  () => reconcileStudentDatabaseImportIdsWithWeb(conflictingStableParsed, webPayload),
  /Служебный ID[^.]*не найден в Web-базе/iu
);

addComment(workbook.Sheets["Настройки"], "A1", "Чужое примечание A1");
XLSX.utils.sheet_add_aoa(workbook.Sheets["База"], [[""]], { origin: "A4" });
workbook.Sheets["База"].A4 = workbook.Sheets["База"].A4 || { t: "s", v: "" };
addComment(
  workbook.Sheets["База"],
  "A4",
  syncComment("students", "stale-deleted-student")
);
const annotationSourceBytes = toBytes(workbook);
const annotationSource = parseStudentDatabaseWorkbook(annotationSourceBytes);
const annotationPayload = buildStudentDatabaseSyncAnnotationPayload(annotationSource, SYNCED_AT);
assert.equal(annotationPayload.commentOnly, true);
assert.equal(annotationPayload.syncCommentRows.length, 10);
assert.deepEqual(
  [...new Set(annotationPayload.syncCommentRows.map((row) => row.entity))].sort(),
  [
    "contracts",
    "directExpenses",
    "generalExpenses",
    "inventoryUnits",
    "programs",
    "students",
    "trainingPlans"
  ]
);
assert.equal(
  annotationPayload.syncCommentRows.every((row) => JSON.parse(row.metadata).syncedAt === SYNCED_AT),
  true
);

function applyAnnotationPayload(bytes, payload, { cleanupStale = true } = {}) {
  const annotated = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const targetKeys = new Set(payload.syncCommentRows.map((row) => `${row.sheetName}\u0000${row.row}`));
  const targetRecordKeys = new Set(payload.syncCommentRows.map((row) => (
    `${row.sheetName}\u0000${row.entity}\u0000${row.recordId}`
  )));
  const sourceEntries = [];
  payload.syncCommentSheets.forEach(({ sheetName, entity }) => {
    Object.entries(annotated.Sheets[sheetName]).forEach(([address, cell]) => {
      if (address.startsWith("!") || !Array.isArray(cell?.c)) return;
      const coordinate = XLSX.utils.decode_cell(address);
      if (coordinate.c !== 0 || coordinate.r < 1) return;
      const commentText = cell.c.map((comment) => comment.t || "").join("\n");
      const match = /\[\[AIS_SYNC_V1\]\]([\s\S]*?)\[\[\/AIS_SYNC_V1\]\]/u.exec(commentText);
      const metadata = match ? JSON.parse(match[1]) : null;
      sourceEntries.push({
        sheetName,
        entity,
        row: coordinate.r + 1,
        recordId: String(metadata?.recordId || ""),
        humanText: getStudentDatabaseHumanCommentText(commentText)
      });
    });
  });
  const targetHumanTextByKey = new Map(resolveStudentDatabaseHumanCommentAssignments(
    sourceEntries,
    payload.syncCommentRows
  ).map((row) => [`${row.sheetName}\u0000${row.row}`, row.humanText]));
  payload.syncCommentRows.forEach((row) => {
    const address = XLSX.utils.encode_cell({ r: row.row - 1, c: 0 });
    const cell = annotated.Sheets[row.sheetName][address];
    const humanText = targetHumanTextByKey.get(`${row.sheetName}\u0000${row.row}`) || "";
    cell.c = [{
      a: "AIS",
      t: [
        humanText,
        humanText ? "" : null,
        "[[AIS_SYNC_V1]]",
        row.metadata,
        "[[/AIS_SYNC_V1]]"
      ].filter((value) => value !== null).join("\n")
    }];
  });
  if (cleanupStale) {
    payload.syncCommentSheets.forEach(({ sheetName }) => {
      const sheet = annotated.Sheets[sheetName];
      Object.entries(sheet).forEach(([address, cell]) => {
        if (address.startsWith("!") || !Array.isArray(cell?.c)) return;
        const coordinate = XLSX.utils.decode_cell(address);
        if (coordinate.c !== 0 || coordinate.r < 1) return;
        if (targetKeys.has(`${sheetName}\u0000${coordinate.r + 1}`)) return;
        const commentText = cell.c.map((comment) => comment.t || "").join("\n");
        if (!commentText.includes("[[AIS_SYNC_V1]]") && !commentText.includes("[[/AIS_SYNC_V1]]")) return;
        const match = /\[\[AIS_SYNC_V1\]\]([\s\S]*?)\[\[\/AIS_SYNC_V1\]\]/u.exec(commentText);
        const metadata = match ? JSON.parse(match[1]) : null;
        const movedRecordKey = metadata
          ? `${sheetName}\u0000${metadata.entity}\u0000${metadata.recordId}`
          : "";
        const humanText = movedRecordKey && targetRecordKeys.has(movedRecordKey)
          ? ""
          : getStudentDatabaseHumanCommentText(commentText);
        if (humanText) cell.c = [{ a: "User", t: humanText }];
        else delete cell.c;
      });
    });
  }
  return annotated;
}

const annotationOutputWorkbook = applyAnnotationPayload(annotationSourceBytes, annotationPayload);
const annotationOutputBytes = toBytes(annotationOutputWorkbook);
assert.doesNotThrow(() => assertStudentDatabaseCommentOnlyOutput(
  annotationSourceBytes,
  annotationOutputBytes,
  annotationPayload
));
assert.equal(
  annotationOutputWorkbook.Sheets["Настройки"].A1.c[0].t,
  "Чужое примечание A1"
);
assert.equal(annotationOutputWorkbook.Sheets["База"].A4.c[0].t, "Пользовательское примечание");

const metadataOutputWorkbook = applyAnnotationPayload(annotationSourceBytes, annotationPayload);
annotationPayload.syncMetadataRows.forEach((entry) => {
  const address = XLSX.utils.encode_cell({ r: entry.row - 1, c: 0 });
  const cell = metadataOutputWorkbook.Sheets[entry.sheetName][address];
  const humanText = getStudentDatabaseHumanCommentText(
    (cell.c || []).map((comment) => comment.t || "").join("\n")
  );
  if (humanText) cell.c = [{ a: "User", t: humanText }];
  else delete cell.c;
});
assert.doesNotThrow(() => assertStudentDatabaseMetadataOnlyOutput(
  annotationSourceBytes,
  toBytes(metadataOutputWorkbook),
  annotationPayload
));

const staleNotCleanedWorkbook = applyAnnotationPayload(
  annotationSourceBytes,
  annotationPayload,
  { cleanupStale: false }
);
assert.throws(
  () => assertStudentDatabaseCommentOnlyOutput(
    annotationSourceBytes,
    toBytes(staleNotCleanedWorkbook),
    annotationPayload
  ),
  /устаревшая метка не очищена/u
);

const changedValueWorkbook = applyAnnotationPayload(annotationSourceBytes, annotationPayload);
changedValueWorkbook.Sheets["База"].B2.v = "Недопустимое изменение";
assert.throws(
  () => assertStudentDatabaseCommentOnlyOutput(
    annotationSourceBytes,
    toBytes(changedValueWorkbook),
    annotationPayload
  ),
  /изменено значение или формула/u
);

const changedForeignCommentWorkbook = applyAnnotationPayload(annotationSourceBytes, annotationPayload);
changedForeignCommentWorkbook.Sheets["Настройки"].A1.c[0].t = "Потеряно";
assert.throws(
  () => assertStudentDatabaseCommentOnlyOutput(
    annotationSourceBytes,
    toBytes(changedForeignCommentWorkbook),
    annotationPayload
  ),
  /изменено чужое примечание/u
);

const changedHumanCommentWorkbook = applyAnnotationPayload(annotationSourceBytes, annotationPayload);
changedHumanCommentWorkbook.Sheets["База"].A2.c[0].t = changedHumanCommentWorkbook
  .Sheets["База"].A2.c[0].t.replace("Пользовательское примечание", "Чужой текст");
assert.throws(
  () => assertStudentDatabaseCommentOnlyOutput(
    annotationSourceBytes,
    toBytes(changedHumanCommentWorkbook),
    annotationPayload
  ),
  /потерян пользовательский текст/u
);

assert.equal(
  getStudentDatabaseHumanCommentText(syncComment("students", "student-stable-1")),
  "Пользовательское примечание"
);
assert.deepEqual(
  resolveStudentDatabaseHumanCommentAssignments(
    [
      { sheetName: "База", entity: "students", row: 2, recordId: "A", humanText: "Текст A" },
      { sheetName: "База", entity: "students", row: 3, recordId: "B", humanText: "Текст B" },
      { sheetName: "База", entity: "students", row: 4, recordId: "", humanText: "Новая строка" }
    ],
    [
      { sheetName: "База", entity: "students", row: 2, recordId: "B" },
      { sheetName: "База", entity: "students", row: 3, recordId: "A" },
      { sheetName: "База", entity: "students", row: 4, recordId: "C" }
    ]
  ).map((entry) => entry.humanText),
  ["Текст B", "Текст A", "Новая строка"]
);

function syncCommentWithHuman(humanText, entity, recordId) {
  return syncComment(entity, recordId).replace("Пользовательское примечание", humanText);
}
const swappedSourceWorkbook = buildWorkbook();
addComment(swappedSourceWorkbook.Sheets["База"], "A2", syncCommentWithHuman("Текст A", "students", "student-stable-1"));
addComment(swappedSourceWorkbook.Sheets["База"], "A3", syncCommentWithHuman("Текст B", "students", "student-stable-2"));
const swappedSourceBytes = toBytes(swappedSourceWorkbook);
const swappedOutputWorkbook = XLSX.read(swappedSourceBytes, { type: "buffer", cellDates: true });
addComment(swappedOutputWorkbook.Sheets["База"], "A2", syncCommentWithHuman("Текст B", "students", "student-stable-2"));
addComment(swappedOutputWorkbook.Sheets["База"], "A3", syncCommentWithHuman("Текст A", "students", "student-stable-1"));
assert.doesNotThrow(() => assertStudentDatabaseHumanCommentsRelocated(
  swappedSourceBytes,
  toBytes(swappedOutputWorkbook),
  annotationPayload.syncCommentSheets
));
const physicalNoteOutputWorkbook = XLSX.read(swappedSourceBytes, { type: "buffer", cellDates: true });
addComment(physicalNoteOutputWorkbook.Sheets["База"], "A2", syncCommentWithHuman("Текст A", "students", "student-stable-2"));
addComment(physicalNoteOutputWorkbook.Sheets["База"], "A3", syncCommentWithHuman("Текст B", "students", "student-stable-1"));
assert.throws(
  () => assertStudentDatabaseHumanCommentsRelocated(
    swappedSourceBytes,
    toBytes(physicalNoteOutputWorkbook),
    annotationPayload.syncCommentSheets
  ),
  /пользовательский текст не перенесён по ID/u
);

const commentOnlySwapPlan = buildStudentDatabaseSyncAnnotationPayload(
  parseStudentDatabaseWorkbook(swappedSourceBytes),
  SYNCED_AT
);
const commentOnlyStudentRows = commentOnlySwapPlan.syncCommentRows
  .filter((row) => row.sheetName === "База");
const firstStudentMarker = {
  recordId: commentOnlyStudentRows[0].recordId,
  metadata: commentOnlyStudentRows[0].metadata
};
commentOnlyStudentRows[0].recordId = commentOnlyStudentRows[1].recordId;
commentOnlyStudentRows[0].metadata = commentOnlyStudentRows[1].metadata;
commentOnlyStudentRows[1].recordId = firstStudentMarker.recordId;
commentOnlyStudentRows[1].metadata = firstStudentMarker.metadata;
const commentOnlySwapOutput = applyAnnotationPayload(swappedSourceBytes, commentOnlySwapPlan);
const commentOnlySwapOutputBytes = toBytes(commentOnlySwapOutput);
assert.doesNotThrow(() => assertStudentDatabaseCommentOnlyOutput(
  swappedSourceBytes,
  commentOnlySwapOutputBytes,
  commentOnlySwapPlan
));
assert.match(commentOnlySwapOutput.Sheets["База"].A2.c[0].t, /^Текст B\n/u);
assert.match(commentOnlySwapOutput.Sheets["База"].A3.c[0].t, /^Текст A\n/u);

const movedStalePlan = {
  ...commentOnlySwapPlan,
  syncCommentRows: commentOnlySwapPlan.syncCommentRows.filter((row) => (
    row.sheetName !== "База" || row.row === 2
  ))
};
const movedStaleOutput = applyAnnotationPayload(swappedSourceBytes, movedStalePlan);
assert.equal(
  Array.isArray(movedStaleOutput.Sheets["База"].A3.c),
  false,
  "После переноса примечание не должно оставаться копией на прежней строке"
);
assert.doesNotThrow(() => assertStudentDatabaseCommentOnlyOutput(
  swappedSourceBytes,
  toBytes(movedStaleOutput),
  movedStalePlan
));
const powerShellSource = fs.readFileSync(
  path.resolve(__dirname, "sync-student-database.ps1"),
  "utf8"
);
assert.match(powerShellSource, /\$humanTextByRecordId\[\$existingRecordId\]\s*=\s*\$humanText/u);
assert.match(
  powerShellSource,
  /if \(\$humanTextByRecordId\.ContainsKey\(\$recordId\)\)[\s\S]*?elseif \(\$unmanagedHumanTextByRow\.ContainsKey/u
);
assert.match(powerShellSource, /-HumanText \$humanText -UseProvidedHumanText/u);
assert.match(powerShellSource, /Get-ObjectProperty \$payload "syncMetadataOnly"/u);
assert.match(powerShellSource, /function Set-AisSyncValidationCell/u);
assert.match(powerShellSource, /\$validation\.Add\(7, 1, 1, "=1=1"\)/u);
assert.match(powerShellSource, /\$validation\.ErrorMessage = \$text/u);
assert.match(powerShellSource, /Set-AisSyncCommentCell \$cell "" -HumanText \$humanText/u);
assert.match(powerShellSource, /function Read-AisSyncValidationMetadataWorkbook/u);
assert.match(
  powerShellSource,
  /\$targetRecordIdsBySheet\[\$sheetName\]\.Contains\(\$staleRecordId\)[\s\S]*?-HumanText "" -UseProvidedHumanText/u
);

const inventoryRowAddedWorkbook = buildWorkbook();
XLSX.utils.sheet_add_aoa(
  inventoryRowAddedWorkbook.Sheets["Запасы"],
  [["2026-08-02", "Конверт", 10, "Добавлено вручную", ""]],
  { origin: "A4" }
);
const inventoryRowAddedResult = parseStudentDatabaseWorkbook(toBytes(inventoryRowAddedWorkbook));
assert.equal(inventoryRowAddedResult.inventory.length, 1);
assert.equal(inventoryRowAddedResult.inventory[0].id, "inventory-stable-1");
assert.equal(inventoryRowAddedResult.inventory[0].balance, 2);

workbook.Sheets["База"].B2.v = "Полностью новое имя слушателя";
workbook.Sheets["Реестр договоров"].A3.v = "Полностью новый контрагент";
workbook.Sheets["Реестр договоров"].B3.v = "999";
workbook.Sheets["Прямые затраты"].C2.v = "Новый вид ТМЦ";
workbook.Sheets["Общие затраты"].A3.v = "Новый исполнитель";
workbook.Sheets["Общие затраты"].C3.v = "Новая работа";
workbook.Sheets["Запасы"].B2.v = "Новый вид ТМЦ";
workbook.Sheets["Запасы"].B3.v = "Новый вид ТМЦ";
workbook.Sheets["Учебные планы"].B2.v = "Новое имя программы";
workbook.Sheets["Учебные планы"].C2.v = "Новая дисциплина";
workbook.Sheets["Реестр программ"].A2.v = "Новое имя программы";
workbook.Sheets["Реестр программ"].C2.v = "new-landing";
assertStableIds(parseStudentDatabaseWorkbook(toBytes(workbook)));

["A", "B"].forEach((column) => {
  const first = workbook.Sheets["База"][column + "2"];
  workbook.Sheets["База"][column + "2"] = workbook.Sheets["База"][column + "3"];
  workbook.Sheets["База"][column + "3"] = first;
});
assertStableIds(parseStudentDatabaseWorkbook(toBytes(workbook)));

addComment(
  workbook.Sheets["База"],
  "A3",
  syncComment("students", "student-stable-2")
);
assert.throws(
  () => parseStudentDatabaseWorkbook(toBytes(workbook)),
  /повторяется служебный ID/u
);

console.log("Student database stable XLSB record ID tests passed.");
