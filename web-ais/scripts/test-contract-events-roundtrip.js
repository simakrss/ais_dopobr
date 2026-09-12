const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const {
  parseStudentDatabaseWorkbook,
  sanitizeStudentDatabaseExportPayload
} = require("../app-server.js");

const sourcePath = path.resolve(process.argv[2] || "Y:/АИС Допобразование/АИС Допобразование.xlsb");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-contract-events-"));
const inputPath = path.join(tempRoot, "input.xlsb");
const outputPath = path.join(tempRoot, "output.xlsb");
const payloadPath = path.join(tempRoot, "payload.json");
const syncScript = path.resolve(__dirname, "sync-student-database.ps1");
const testDate = "2026-08-10";

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

try {
  const sourceHash = sha256(sourcePath);
  fs.copyFileSync(sourcePath, inputPath);
  const imported = parseStudentDatabaseWorkbook(fs.readFileSync(inputPath));
  const target = imported.contracts.find((contract) => contract.name === "Симак Варвара Романовна")
    || imported.contracts[0];
  if (!target) fail("В книге нет договора для проверки.");
  target.eventOrder = [
    "portalAccessSent",
    ...String(target.eventOrder || "").split(",").map((value) => value.trim()).filter((value) => value && value !== "portalAccessSent")
  ].join(",");
  target.eventDeleted = String(target.eventDeleted || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value !== "portalAccessSent")
    .join(",");
  target.event_portalAccessSent_label = "Отправлены данные для доступа к порталу";
  target.event_portalAccessSent_date = testDate;
  target.event_portalAccessSent_state = "dated";

  const directExpenses = [
    ...(imported.directExpenses || []),
    ...(imported.students || []).flatMap((student) => student.directExpenses || [])
  ];
  const payload = sanitizeStudentDatabaseExportPayload({
    students: imported.students,
    contracts: imported.contracts,
    directExpenses,
    generalExpenses: imported.generalExpenses || [],
    agentPaymentRates: imported.agentPaymentRates
  });
  fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf8");

  const sync = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", syncScript,
    "-InputPath", inputPath,
    "-OutputPath", outputPath,
    "-PayloadPath", payloadPath
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (sync.status !== 0) fail(sync.stderr || sync.stdout || "Синхронизация тестовой книги завершилась с ошибкой.");
  const syncResult = String(sync.stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .findLast((item) => item?.type === "result");
  if (!syncResult) fail("Синхронизация не вернула итоговую статистику.");

  const roundTrip = parseStudentDatabaseWorkbook(fs.readFileSync(outputPath));
  const saved = roundTrip.contracts.find((contract) => contract.name === target.name);
  if (!saved) fail("Договор не найден после синхронизации.");
  if (saved.event_portalAccessSent_state !== "dated") fail("Статус события не сохранился.");
  if (saved.event_portalAccessSent_date !== testDate) fail("Дата события не сохранилась.");
  if (saved.event_portalAccessSent_label !== "Отправлены данные для доступа к порталу") fail("Название события не сохранилось.");

  const maxRowHeightPoints = Number(syncResult.contractMaxRowHeightPoints);
  if (!roundTrip.contracts.length) fail("Не найдены строки договоров для проверки высоты.");
  if (!Number.isFinite(maxRowHeightPoints) || maxRowHeightPoints > 15.01) {
    fail(`Высота строки превысила 15 пунктов: ${syncResult.contractMaxRowHeightPoints}.`);
  }
  if (sha256(sourcePath) !== sourceHash) fail("Исходная XLSB была изменена во время теста.");

  console.log(JSON.stringify({
    contract: saved.name,
    event: "portalAccessSent",
    date: saved.event_portalAccessSent_date,
    contractRows: roundTrip.contracts.length,
    maxRowHeightPoints,
    sourceUnchanged: true
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
