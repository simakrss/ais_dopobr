const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const XLSX = require("../vendor/sheetjs/xlsx.full.min.js");
const {
  parseStudentDatabaseWorkbook,
  sanitizeStudentDatabaseExportPayload,
  buildStudentDatabaseSynchronizedChanges
} = require("../app-server.js");

const sourcePath = path.resolve(
  process.argv[2]
    || "Y:/АИС Допобразование/АИС Допобразование.xlsb"
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-managed-sheets-"));
const keepArtifacts = process.env.AIS_KEEP_TEST_ARTIFACTS === "1";
const inputPath = path.join(tempRoot, "input.xlsb");
const outputPath = path.join(tempRoot, "output.xlsb");
const payloadPath = path.join(tempRoot, "payload.json");
const metadataPayloadPath = path.join(tempRoot, "metadata-payload.json");
const metadataOutputPath = path.join(tempRoot, "metadata-unused.xlsb");
const syncScript = path.resolve(__dirname, "sync-student-database.ps1");
const syncMetadataSheets = [
  { sheetName: "База", entity: "students" },
  { sheetName: "Реестр договоров", entity: "contracts" },
  { sheetName: "Прямые затраты", entity: "directExpenses" },
  { sheetName: "Общие затраты", entity: "generalExpenses" },
  { sheetName: "Запасы", entity: "inventoryUnits" },
  { sheetName: "Реестр программ", entity: "programs" },
  { sheetName: "Учебные планы", entity: "trainingPlans" }
];

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
  const before = readRaw(inputPath);
  const baseRows = XLSX.utils.sheet_to_json(before.Sheets["База"], {
    header: 1,
    defval: "",
    raw: true
  });
  const baseHeaderRowIndex = baseRows.findIndex((row) => row.includes("uid") && row.includes("ФИО"));
  const baseHeaders = baseRows[baseHeaderRowIndex].map((value) => String(value || "").trim());
  const contractAmountColumnIndex = baseHeaders.findIndex((header) => (
    header === "Сумма по договору (руб)" || header === "Сумма  по договору (руб)"
  ));
  const fixedValueTarget = imported.students.find((student) => {
    const rowIndex = Number(student.databaseSyncSourceRow) - 1;
    if (rowIndex < 0 || contractAmountColumnIndex < 0) return false;
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: contractAmountColumnIndex });
    return Boolean(getCell(before, "База", address).f);
  });
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
  const deletedProgram = imported.programPaymentSettings.find((program) => (
    program.id !== programTarget?.id
    && String(program.id || "").trim() !== String(trainingTarget?.programId || "").trim()
    && String(program.name || "").trim() !== String(trainingTarget?.programName || "").trim()
  ));
  assert.ok(
    inventoryTarget && trainingTarget && programTarget && deletedProgram && fixedValueTarget,
    "Не найдены строки для round-trip проверки."
  );

  const runId = Date.now();
  const inventoryNote = `Round-trip запас ${runId}`;
  const trainingTeacher = `Round-trip преподаватель ${runId}`;
  const programManager = `Round-trip менеджер ${runId}`;
  const insertedProgram = {
    id: `roundtrip-program-${runId}`,
    name: `Автоматически добавленная программа ${runId} (5 ч)`,
    shortName: `Автоматически добавленная программа ${runId}`,
    status: "Набор",
    landingCode: `roundtrip-${runId}`,
    price: 5000,
    type: "ДОП",
    hours: 5,
    duration: "1 нед.",
    studyForm: "Дистанционная",
    authorSource: "Тестовый автор"
  };
  const insertedTrainingPlan = {
    id: `roundtrip-plan-${runId}`,
    programId: insertedProgram.id,
    code: imported.trainingPlans.length + 1,
    programName: insertedProgram.name,
    discipline: `Тестовая дисциплина ${runId}`,
    description: "Строка добавлена автоматическим round-trip тестом",
    theoryHours: 2,
    practiceHours: 3,
    totalHours: 999,
    attestation: "Зачет",
    teacher: "Тестовый преподаватель",
    materials: "Тестовые материалы",
    content: "Тестовое содержание"
  };
  const inventory = imported.inventory.map((item) => (
    item.id === inventoryTarget.id ? { ...item, note: inventoryNote } : { ...item }
  ));
  const trainingPlans = [
    ...imported.trainingPlans.map((item) => (
      item.xlsbTrainingPlanRow === trainingTarget.xlsbTrainingPlanRow
        ? { ...item, teacher: trainingTeacher }
        : { ...item }
    )).filter((item) => (
      String(item.programId || "").trim() !== String(deletedProgram.id || "").trim()
      && String(item.programName || "").trim() !== String(deletedProgram.name || "").trim()
    )),
    insertedTrainingPlan
  ];
  const programs = [
    ...imported.programPaymentSettings
      .filter((program) => program.id !== deletedProgram.id)
      .map((program) => (
        program.xlsbProgramRow === programTarget.xlsbProgramRow
          ? { ...program, manager: programManager }
          : { ...program }
      )),
    insertedProgram
  ];
  const directExpenses = flattenDirectExpenses(imported);
  const fixedContractAmount = Number(fixedValueTarget.contractAmount || 0) + 1;
  const students = imported.students.map((student) => (
    student.id === fixedValueTarget.id
      ? {
          ...student,
          contractAmount: fixedContractAmount,
          databaseFixedValueOverrides: ["contractAmount"]
        }
      : student
  ));
  const payload = sanitizeStudentDatabaseExportPayload({
    students,
    contracts: imported.contracts,
    directExpenses,
    generalExpenses: imported.generalExpenses,
    inventory,
    trainingPlans,
    programs,
    agentPaymentRates: imported.agentPaymentRates || {}
  });
  payload.programsReplaceAll = true;
  assert.equal(payload.inventoryRows.length, imported.inventoryUnitCount);
  fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf8");

  const programRow = Number(programTarget.xlsbProgramRow);
  const fixedValueAddress = XLSX.utils.encode_cell({
    r: Number(fixedValueTarget.databaseSyncSourceRow) - 1,
    c: contractAmountColumnIndex
  });
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
  assert.equal(result.programRowsInserted, 1);
  assert.equal(result.programRowsDeleted, 1);
  assert.equal(result.programRowsSorted, programs.length);
  assert.ok(result.programArchiveRows > 0);
  assert.ok(result.programManagedCells > 0, "Управляемые поля реестра программ не обновлялись.");
  assert.ok(
    result.programFormulaCellsPreserved > 0,
    "Не зафиксировано сохранение формульных ячеек реестра программ."
  );
  assert.equal(result.studentFixedValueOverridesApplied, 1);
  assert.equal(result.studentFormulaCellsReplaced, 1);

  const after = readRaw(outputPath);
  assert.equal(getCell(after, "База", fixedValueAddress).f, undefined);
  assert.equal(Number(getCell(after, "База", fixedValueAddress).v), fixedContractAmount);
  assert.doesNotMatch(getCommentText(after, "Запасы", "A2"), /\[\[AIS_SYNC_V1\]\]/u);
  assert.doesNotMatch(getCommentText(after, "Учебные планы", "A2"), /\[\[AIS_SYNC_V1\]\]/u);
  assert.doesNotMatch(
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

  const syncMetadataRows = readSyncMetadataRows(outputPath);
  const roundTrip = parseStudentDatabaseWorkbook(
    fs.readFileSync(outputPath),
    () => {},
    { syncMetadataRows }
  );
  const synchronizedChanges = buildStudentDatabaseSynchronizedChanges(imported, roundTrip);
  assert.ok(synchronizedChanges.totalCount > 0, "Протокол не нашёл изменения в сформированном XLSB.");
  assert.ok(
    synchronizedChanges.rows.some((change) => (
      change.entity === "Слушатели"
      && change.record.includes(String(fixedValueTarget.uid))
      && change.field === "Сумма по договору (руб)"
      && change.after === String(fixedContractAmount)
    )),
    "Протокол не показал фактическую замену формулы суммы договора."
  );
  assert.ok(
    synchronizedChanges.rows.some((change) => (
      change.entity === "Программы"
      && change.record === insertedProgram.name
      && change.action === "Добавлено"
    )),
    "Протокол не показал добавленную программу."
  );
  assert.ok(
    synchronizedChanges.rows.some((change) => (
      change.entity === "Программы"
      && change.record === deletedProgram.name
      && change.action === "Удалено"
    )),
    "Протокол не показал удалённую программу."
  );
  assert.equal(roundTrip.inventoryUnitCount, imported.inventoryUnitCount);
  assert.ok(roundTrip.inventoryDatabaseSyncFields.includes("balance"));
  assert.equal(
    roundTrip.inventory.find((item) => item.id === inventoryTarget.id)?.note,
    inventoryNote
  );
  assert.equal(
    roundTrip.trainingPlans.find((item) => item.id === trainingTarget.id)?.teacher,
    trainingTeacher
  );
  assert.ok(
    roundTrip.trainingPlans.some((item) => item.id === trainingTarget.id),
    "Служебный ID строки учебного плана не сохранился."
  );
  const updatedProgramResult = roundTrip.programPaymentSettings.find((program) => (
    program.id === programTarget.id
  ));
  if (!updatedProgramResult) {
    console.error(JSON.stringify({
      expectedProgram: {
        id: programTarget.id,
        name: programTarget.name,
        sourceRow: programTarget.xlsbProgramRow
      },
      managerMatches: roundTrip.programPaymentSettings
        .filter((program) => program.manager === programManager)
        .map((program) => ({ id: program.id, name: program.name, row: program.xlsbProgramRow })),
      nearbyPrograms: roundTrip.programPaymentSettings
        .filter((program) => program.name === programTarget.name)
        .map((program) => ({ id: program.id, manager: program.manager, row: program.xlsbProgramRow }))
    }, null, 2));
  }
  assert.equal(updatedProgramResult?.manager, programManager);
  assert.ok(
    roundTrip.programPaymentSettings.some((program) => program.id === programTarget.id),
    "Служебный ID программы не сохранился."
  );
  const insertedProgramResult = roundTrip.programPaymentSettings.find((program) => (
    program.id === insertedProgram.id
  ));
  assert.ok(insertedProgramResult, "Отсутствующая программа не была добавлена в XLSB.");
  assert.equal(insertedProgramResult.name, insertedProgram.name);
  assert.equal(insertedProgramResult.status, "Набор");
  assert.ok(getCell(after, "Реестр программ", `B${insertedProgramResult.xlsbProgramRow}`).f);
  assert.ok(getCell(after, "Реестр программ", `M${insertedProgramResult.xlsbProgramRow}`).f);
  assert.equal(
    roundTrip.programPaymentSettings.some((program) => program.id === deletedProgram.id),
    false,
    "Удалённая в Web программа осталась в XLSB."
  );
  const insertedTrainingPlanResult = roundTrip.trainingPlans.find((item) => (
    item.id === insertedTrainingPlan.id
  ));
  assert.ok(insertedTrainingPlanResult, "Новая строка учебного плана не была записана в XLSB.");
  assert.equal(insertedTrainingPlanResult.programName, insertedProgram.name);
  assert.equal(insertedTrainingPlanResult.discipline, insertedTrainingPlan.discipline);
  assert.equal(Number(insertedTrainingPlanResult.totalHours), 5);
  let archiveStarted = false;
  roundTrip.programPaymentSettings.forEach((program) => {
    const isArchive = /архив/iu.test(String(program.status || ""));
    if (isArchive) archiveStarted = true;
    else assert.equal(archiveStarted, false, "Активная программа находится после архивной.");
  });
  assert.equal(sha256(sourcePath), sourceHash, "Исходная XLSB была изменена во время теста.");

  console.log(JSON.stringify({
    inventoryItems: result.inventoryItems,
    inventoryUnits: result.inventoryUnits,
    trainingPlans: result.trainingPlans,
    programRowsInserted: result.programRowsInserted,
    programRowsDeleted: result.programRowsDeleted,
    programRowsSorted: result.programRowsSorted,
    programManagedCells: result.programManagedCells,
    programFormulaCellsPreserved: result.programFormulaCellsPreserved,
    vbaPreserved: true,
    sourceUnchanged: true
  }, null, 2));
} finally {
  if (keepArtifacts) console.error(`Артефакты теста: ${tempRoot}`);
  else fs.rmSync(tempRoot, { recursive: true, force: true });
}

function readSyncMetadataRows(filePath) {
  fs.writeFileSync(metadataPayloadPath, JSON.stringify({
    readSyncMetadataOnly: true,
    syncMetadataSheets
  }), "utf8");
  const readResult = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", syncScript,
    "-InputPath", filePath,
    "-OutputPath", metadataOutputPath,
    "-PayloadPath", metadataPayloadPath
  ], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 2 * 60 * 1000
  });
  assert.equal(readResult.status, 0, readResult.stderr || readResult.stdout);
  const resultLine = String(readResult.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith("{") && line.includes('"readSyncMetadataOnly":true'));
  assert.ok(resultLine, "Microsoft Excel не вернул служебные свойства AIS_SYNC.");
  return JSON.parse(resultLine).syncMetadataRows || [];
}
