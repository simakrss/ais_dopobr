const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  sanitizeStudentDatabaseExportPayload,
  validateStudentDatabaseProgramStructure
} = require("../app-server.js");

function sanitize(overrides = {}) {
  return sanitizeStudentDatabaseExportPayload({
    students: [{ id: "student-1", uid: "101", name: "Тестовый слушатель" }],
    contracts: [],
    directExpenses: [],
    generalExpenses: [],
    ...overrides
  });
}

const optionalPayload = sanitize();
assert.equal(optionalPayload.inventoryProvided, false);
assert.equal(optionalPayload.trainingPlansProvided, false);
assert.deepEqual(optionalPayload.inventoryRows, []);

const emptyInventoryPayload = sanitize({ inventory: [] });
assert.equal(emptyInventoryPayload.inventoryProvided, true);
assert.deepEqual(emptyInventoryPayload.inventory, []);
assert.deepEqual(emptyInventoryPayload.inventoryRows, []);

const payload = sanitize({
  directExpenses: [{
    id: "expense-1",
    uid: "101",
    date: "2026-08-20T12:00:00.000Z",
    amount: "25,50",
    note: "Выдано",
    inventoryId: "inventory-1",
    inventoryLink: "Почтовый конверт"
  }],
  inventory: [{
    id: "inventory-1",
    date: "2026-08-01T00:00:00.000Z",
    itemType: "Почтовый конверт",
    amount: "30,00",
    note: "Остаток",
    balance: 2
  }],
  trainingPlans: [{
    id: "plan-1",
    programId: "program-1",
    code: 1,
    programName: "Тестовая программа",
    discipline: "Раздел 1",
    theoryHours: "2,5",
    practiceHours: 3,
    totalHours: "5,5",
    teacher: "Преподаватель"
  }],
  programs: [{
    name: "Тестовая программа",
    xlsbProgramName: "Тестовая программа",
    xlsbProgramRow: 2,
    price: "12000,50",
    hours: 72,
    authorSource: "Автор",
    manager: "",
    promoMessage1Provided: false,
    promoMessage2Provided: false,
    emailMessageTemplateProvided: false
  }]
});

assert.equal(payload.inventoryProvided, true);
assert.equal(payload.inventory.length, 1);
assert.equal(payload.inventory[0].balance, 2);
assert.deepEqual(payload.inventoryRows.map(({ __syncComment, ...row }) => row), [
  {
    date: "2026-08-20",
    itemType: "Почтовый конверт",
    amount: 25.5,
    note: "Выдано",
    uid: "101"
  },
  {
    date: "2026-08-01",
    itemType: "Почтовый конверт",
    amount: 30,
    note: "Остаток",
    uid: ""
  },
  {
    date: "2026-08-01",
    itemType: "Почтовый конверт",
    amount: 30,
    note: "Остаток",
    uid: ""
  }
]);
const managedCommentMetadata = [
  ...payload.students,
  ...payload.directExpenses,
  ...payload.inventoryRows,
  ...payload.trainingPlans,
  ...payload.programs
].map((record) => JSON.parse(record.__syncComment));
assert.ok(managedCommentMetadata.length > 0);
assert.equal(
  new Set(managedCommentMetadata.map((metadata) => metadata.syncedAt)).size,
  1,
  "Все метки одного экспорта должны иметь общий syncedAt."
);
managedCommentMetadata.forEach((metadata) => {
  assert.equal(metadata.v, 1);
  assert.ok(metadata.entity);
  assert.ok(metadata.recordId);
  assert.match(metadata.syncedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
});
assert.equal(
  JSON.parse(payload.inventoryRows[0].__syncComment).parentRecordId,
  "inventory-1"
);
assert.equal(payload.trainingPlansProvided, true);
assert.equal(payload.trainingPlans[0].theoryHours, 2.5);
assert.equal(payload.trainingPlans[0].practiceHours, 3);
assert.equal(payload.trainingPlans[0].totalHours, 5.5);
assert.deepEqual(
  payload.programs[0].providedFields,
  ["name", "price", "hours", "authorSource", "manager"]
);
assert.equal(payload.programs[0].price, 12000.5);

assert.deepEqual(
  validateStudentDatabaseProgramStructure(
    [{
      name: "Новое отображаемое имя",
      landingCode: "new-code",
      xlsbProgramName: "Программа 1",
      xlsbProgramLandingCode: "old-code"
    }],
    [{
      name: "Программа 1",
      landingCode: "old-code",
      xlsbProgramRow: 2
    }]
  ),
  { matched: 1, webCount: 1, excelCount: 1 }
);
assert.deepEqual(
  validateStudentDatabaseProgramStructure(
    [{
      id: "program-stable-1",
      name: "Полностью новое имя",
      landingCode: "new-code"
    }],
    [{
      id: "program-stable-1",
      databaseSync: { recordId: "program-stable-1" },
      name: "Старое имя",
      landingCode: "old-code",
      xlsbProgramRow: 2
    }]
  ),
  { matched: 1, webCount: 1, excelCount: 1 },
  "Программа должна сопоставляться по точному служебному ID после переименования."
);
assert.throws(
  () => validateStudentDatabaseProgramStructure(
    [{ id: "program-web", name: "Одинаковое имя", landingCode: "same" }],
    [{
      id: "program-excel",
      databaseSync: { recordId: "program-excel" },
      name: "Одинаковое имя",
      landingCode: "same"
    }]
  ),
  /Структура листа/u,
  "При наличии AIS_SYNC нельзя подменять точный ID совпадением изменяемых полей."
);
assert.throws(
  () => validateStudentDatabaseProgramStructure(
    [
      { name: "Программа 1", landingCode: "one" },
      { name: "Только Web", landingCode: "web-only" }
    ],
    [{ name: "Программа 1", landingCode: "one" }]
  ),
  /Создание и удаление программ.+XLSB не изменён/u
);
assert.throws(
  () => validateStudentDatabaseProgramStructure(
    [{ name: "Программа 1", landingCode: "one" }],
    [
      { name: "Программа 1", landingCode: "one" },
      { name: "Только Excel", landingCode: "excel-only" }
    ]
  ),
  /Создание и удаление программ.+XLSB не изменён/u
);

assert.throws(
  () => sanitize({
    inventory: [{
      id: "bad-balance",
      itemType: "Конверт",
      balance: 1.5
    }]
  }),
  /целым неотрицательным числом/u
);
assert.throws(
  () => sanitize({
    inventory: [
      { id: "one", itemType: "Конверт", balance: 1 },
      { id: "two", itemType: " конверт ", balance: 1 }
    ]
  }),
  /повторяется вид ТМЦ/u
);
assert.throws(
  () => sanitize({
    trainingPlans: [{ discipline: "Без программы" }]
  }),
  /не указана программа/u
);
[
  {
    name: "слушатели",
    overrides: {
      students: [
        { id: "duplicate-id", uid: "1", name: "Один" },
        { id: "duplicate-id", uid: "2", name: "Два" }
      ]
    }
  },
  {
    name: "договоры",
    overrides: {
      contracts: [
        { id: "duplicate-id", name: "Один" },
        { id: "duplicate-id", name: "Два" }
      ]
    }
  },
  {
    name: "прямые затраты",
    overrides: {
      directExpenses: [
        { id: "duplicate-id", uid: "1", date: "2026-01-01", type: "A", amount: 1 },
        { id: "duplicate-id", uid: "2", date: "2026-01-02", type: "B", amount: 2 }
      ]
    }
  },
  {
    name: "общие затраты",
    overrides: {
      generalExpenses: [
        { id: "duplicate-id", section: "Организации", counterparty: "A", workType: "A" },
        { id: "duplicate-id", section: "Организации", counterparty: "B", workType: "B" }
      ]
    }
  },
  {
    name: "запасы",
    overrides: {
      inventory: [
        { id: "duplicate-id", itemType: "A", balance: 1 },
        { id: "duplicate-id", itemType: "B", balance: 1 }
      ]
    }
  },
  {
    name: "учебные планы",
    overrides: {
      trainingPlans: [
        { id: "duplicate-id", programName: "A", discipline: "A" },
        { id: "duplicate-id", programName: "B", discipline: "B" }
      ]
    }
  },
  {
    name: "программы",
    overrides: {
      programs: [
        { id: "duplicate-id", name: "A" },
        { id: "duplicate-id", name: "B" }
      ]
    }
  }
].forEach(({ name, overrides }) => {
  assert.throws(
    () => sanitize(overrides),
    /повторяется (?:служебный ID|идентификатор)/u,
    "Дубликат ID должен блокировать экспорт: " + name
  );
});

const powershellSource = fs.readFileSync(
  path.join(__dirname, "sync-student-database.ps1"),
  "utf8"
);
assert.match(powershellSource, /function Update-InventorySheet/u);
assert.match(powershellSource, /function Update-TrainingPlanSheet/u);
assert.match(powershellSource, /function Set-ProgramManagedValueCell/u);
assert.match(powershellSource, /function Update-AisSyncCommentsForRows/u);
assert.match(powershellSource, /function Get-AisSyncCommentMetadata/u);
assert.match(
  powershellSource,
  /Update-AisSyncCommentsForRows \$sheet \$recordByRow \$startRow \$lastRow 1/u
);
assert.match(
  powershellSource,
  /Update-AisSyncCommentsForRows \$sheet \$programRecordByRow \$startRow \$lastRow 1/u
);
assert.match(
  powershellSource,
  /function Get-AisSyncHumanCommentText[\s\S]*?\[regex\]::Replace\(\$source, \$managedPattern, ""\)/u,
  "Пользовательская часть примечания должна сохраняться отдельно от AIS_SYNC."
);
assert.match(
  powershellSource,
  /\$humanTextByRecordId\[\$existingRecordId\]\s*=\s*\$humanText/u,
  "Пользовательская часть примечания должна переноситься вместе со стабильным ID."
);
assert.match(
  powershellSource,
  /Set-AisSyncCommentCell \$parent ""/u,
  "Устаревший AIS_SYNC должен очищаться без удаления пользовательского текста."
);
assert.match(
  powershellSource,
  /if \(\$currentFormula\.StartsWith\("="\)\)[\s\S]{0,320}?return "formula"/u
);
assert.match(powershellSource, /Ensure-ContractFormulaRows \$sheet \$columns/u);

const serverSource = fs.readFileSync(path.join(__dirname, "..", "app-server.js"), "utf8");
assert.match(
  serverSource,
  /inventoryDatabaseSyncFields:[\s\S]*?"balance"/u
);
assert.match(
  serverSource,
  /studentDatabaseSyncFields:[\s\S]*?"additionalStatus"[\s\S]*?"enrollmentOrderDate"[\s\S]*?"expulsionOrderDate"/u
);
assert.doesNotMatch(serverSource, /Полное удаление листа «Запасы» пока не поддерживается/u);
assert.doesNotMatch(serverSource, /На листе «Прямые затраты» не найдено ни одной заполненной строки/u);

const directionalExportStart = serverSource.indexOf("async function buildStudentDatabaseExport");
const excelToWebBranchStart = serverSource.indexOf(
  'if (directionalSyncResult.direction === "excel-to-web") {',
  directionalExportStart
);
const excelToWebImportBuild = serverSource.indexOf(
  "const importPayload = buildStudentDatabaseImportResult",
  excelToWebBranchStart
);
const excelToWebProgramValidation = serverSource.indexOf(
  "validateStudentDatabaseProgramStructure(",
  excelToWebBranchStart
);
assert.ok(directionalExportStart >= 0 && excelToWebBranchStart > directionalExportStart);
assert.ok(
  excelToWebProgramValidation > excelToWebBranchStart
    && excelToWebProgramValidation < excelToWebImportBuild,
  "Excel → Web должен проверить добавление и удаление программ до подготовки импорта."
);

console.log(JSON.stringify({
  inventoryRows: payload.inventoryRows.length,
  trainingPlans: payload.trainingPlans.length,
  programManagedFields: payload.programs[0].providedFields
}, null, 2));
