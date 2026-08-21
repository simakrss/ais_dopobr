const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const XLSX = require("../vendor/sheetjs/xlsx.full.min.js");
const {
  parseStudentDatabaseWorkbook,
  sanitizeStudentDatabaseExportPayload
} = require("../app-server.js");

const sourcePath = path.resolve(
  process.argv[2]
    || "Y:/АИС Допобразование/АИС Допобразование.xlsb"
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-managed-sheets-"));
const inputPath = path.join(tempRoot, "input.xlsb");
const outputPath = path.join(tempRoot, "output.xlsb");
const payloadPath = path.join(tempRoot, "payload.json");
const syncScript = path.resolve(__dirname, "sync-student-database.ps1");

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : fs.readFileSync(value);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readRaw(filePath) {
  return XLSX.read(fs.readFileSync(filePath), {
    type: "buffer",
    bookVBA: true,
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
    cellComments: true
  });
}

function getCell(workbook, sheetName, address) {
  const sheet = workbook.Sheets[sheetName];
  assert.ok(sheet, `В книге отсутствует лист «${sheetName}».`);
  return sheet[address] || {};
}

function getCommentText(workbook, sheetName, address) {
  return (getCell(workbook, sheetName, address).c || [])
    .map((comment) => String(comment?.t || ""))
    .join("\n");
}

function flattenDirectExpenses(imported) {
  return [
    ...(imported.directExpenses || []),
    ...imported.students.flatMap((student) => student.directExpenses || [])
  ];
}

try {
  assert.ok(fs.existsSync(sourcePath), `Не найдена тестовая XLSB: ${sourcePath}`);
  const sourceHash = sha256(sourcePath);
  fs.copyFileSync(sourcePath, inputPath);

  const imported = parseStudentDatabaseWorkbook(fs.readFileSync(inputPath));
  assert.ok(imported.inventory.length, "В исходной книге нет запасов.");
  assert.ok(imported.trainingPlans.length, "В исходной книге нет учебных планов.");
  assert.ok(imported.programPaymentSettings.length, "В исходной книге нет реестра программ.");
  assert.ok(
    imported.inventoryDatabaseSyncFields.includes("balance"),
    "Поле остатка не объявлено управляемым при Excel → Web."
  );

  const inventoryTarget = imported.inventory.find((item) => Number(item.balance) > 0);
  const trainingTarget = imported.trainingPlans[0];
  const programTarget = imported.programPaymentSettings.find((program) => (
    Number(program.xlsbProgramRow) > 1
  ));
  assert.ok(inventoryTarget && trainingTarget && programTarget, "Не найдены строки для round-trip проверки.");

  const inventoryNote = `Round-trip запас ${Date.now()}`;
  const trainingTeacher = `Round-trip преподаватель ${Date.now()}`;
  const programManager = `Round-trip менеджер ${Date.now()}`;
  const inventory = imported.inventory.map((item) => (
    item.id === inventoryTarget.id ? { ...item, note: inventoryNote } : { ...item }
  ));
  const trainingPlans = imported.trainingPlans.map((item) => (
    item.xlsbTrainingPlanRow === trainingTarget.xlsbTrainingPlanRow
      ? { ...item, teacher: trainingTeacher }
      : { ...item }
  ));
  const programs = imported.programPaymentSettings.map((program) => (
    program.xlsbProgramRow === programTarget.xlsbProgramRow
      ? { ...program, manager: programManager }
      : { ...program }
  ));
  const directExpenses = flattenDirectExpenses(imported);
  const payload = sanitizeStudentDatabaseExportPayload({
    students: imported.students,
    contracts: imported.contracts,
    directExpenses,
    generalExpenses: imported.generalExpenses,
    inventory,
    trainingPlans,
    programs,
    agentPaymentRates: imported.agentPaymentRates || {}
  });
  assert.equal(payload.inventoryRows.length, imported.inventoryUnitCount);
  fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf8");

  const before = readRaw(inputPath);
  const programRow = Number(programTarget.xlsbProgramRow);
  const formulaSnapshot = {
    trainingCode: getCell(before, "Учебные планы", "A2").f,
    trainingTotal: getCell(before, "Учебные планы", "E2").f,
    programShortName: getCell(before, "Реестр программ", `B${programRow}`).f,
    programHours: getCell(before, "Реестр программ", `M${programRow}`).f
  };
  const commentSnapshot = {
    inventoryUid: getCommentText(before, "Запасы", "E1"),
    trainingPractice: getCommentText(before, "Учебные планы", "G1")
  };
  const styleSnapshot = {
    inventoryType: JSON.stringify(getCell(before, "Запасы", "B2").s || {}),
    trainingProgram: JSON.stringify(getCell(before, "Учебные планы", "B2").s || {})
  };

  const sync = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", syncScript,
    "-InputPath", inputPath,
    "-OutputPath", outputPath,
    "-PayloadPath", payloadPath
  ], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000
  });
  assert.equal(
    sync.status,
    0,
    sync.stderr || sync.stdout || "Синхронизация завершилась с ошибкой."
  );
  assert.ok(fs.existsSync(outputPath), "Microsoft Excel не создал выходной XLSB.");

  const resultLine = String(sync.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith("{") && line.includes('"type":"result"'));
  assert.ok(resultLine, `Не найден итоговый JSON PowerShell:\n${sync.stdout}`);
  const result = JSON.parse(resultLine);
  assert.equal(result.inventoryItems, inventory.length);
  assert.equal(result.inventoryUnits, payload.inventoryRows.length);
  assert.equal(result.trainingPlans, trainingPlans.length);
  assert.ok(result.programManagedCells > 0, "Управляемые поля реестра программ не обновлялись.");
  assert.ok(
    result.programFormulaCellsPreserved > 0,
    "Не зафиксировано сохранение формульных ячеек реестра программ."
  );

  const after = readRaw(outputPath);
  assert.match(getCommentText(after, "Запасы", "A2"), /\[\[AIS_SYNC_V1\]\]/u);
  assert.match(getCommentText(after, "Учебные планы", "A2"), /\[\[AIS_SYNC_V1\]\]/u);
  assert.match(
    getCommentText(after, "Реестр программ", `A${programRow}`),
    /\[\[AIS_SYNC_V1\]\]/u
  );
  assert.deepEqual({
    trainingCode: getCell(after, "Учебные планы", "A2").f,
    trainingTotal: getCell(after, "Учебные планы", "E2").f,
    programShortName: getCell(after, "Реестр программ", `B${programRow}`).f,
    programHours: getCell(after, "Реестр программ", `M${programRow}`).f
  }, formulaSnapshot, "Формулы управляемых листов изменились.");
  assert.deepEqual({
    inventoryUid: getCommentText(after, "Запасы", "E1"),
    trainingPractice: getCommentText(after, "Учебные планы", "G1")
  }, commentSnapshot, "Служебные комментарии заголовков потеряны.");
  assert.deepEqual({
    inventoryType: JSON.stringify(getCell(after, "Запасы", "B2").s || {}),
    trainingProgram: JSON.stringify(getCell(after, "Учебные планы", "B2").s || {})
  }, styleSnapshot, "Стили управляемых строк изменились.");
  assert.ok(before.vbaraw?.length, "В исходной книге не найден VBA-проект.");
  assert.ok(after.vbaraw?.length, "VBA-проект потерян после сохранения.");

  const roundTrip = parseStudentDatabaseWorkbook(fs.readFileSync(outputPath));
  assert.equal(roundTrip.inventoryUnitCount, imported.inventoryUnitCount);
  assert.ok(roundTrip.inventoryDatabaseSyncFields.includes("balance"));
  assert.equal(
    roundTrip.inventory.find((item) => item.id === inventoryTarget.id)?.note,
    inventoryNote
  );
  assert.equal(
    roundTrip.trainingPlans.find((item) => (
      item.xlsbTrainingPlanRow === trainingTarget.xlsbTrainingPlanRow
    ))?.teacher,
    trainingTeacher
  );
  assert.ok(
    roundTrip.trainingPlans.some((item) => item.id === trainingTarget.id),
    "Служебный ID строки учебного плана не сохранился."
  );
  assert.equal(
    roundTrip.programPaymentSettings.find((program) => (
      program.xlsbProgramRow === programTarget.xlsbProgramRow
    ))?.manager,
    programManager
  );
  assert.ok(
    roundTrip.programPaymentSettings.some((program) => program.id === programTarget.id),
    "Служебный ID программы не сохранился."
  );
  assert.equal(sha256(sourcePath), sourceHash, "Исходная XLSB была изменена во время теста.");

  console.log(JSON.stringify({
    inventoryItems: result.inventoryItems,
    inventoryUnits: result.inventoryUnits,
    trainingPlans: result.trainingPlans,
    programManagedCells: result.programManagedCells,
    programFormulaCellsPreserved: result.programFormulaCellsPreserved,
    vbaPreserved: true,
    sourceUnchanged: true
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
