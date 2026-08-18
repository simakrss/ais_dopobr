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
  process.argv[2] || "Y:/АИС Допобразование/АИС Допобразование — копия.xlsb"
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-frdo-date-"));
const inputPath = path.join(tempRoot, "input.xlsb");
const outputPath = path.join(tempRoot, "output.xlsb");
const payloadPath = path.join(tempRoot, "payload.json");
const syncScript = path.resolve(__dirname, "sync-student-database.ps1");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function buildExportPayload(students, imported = {}) {
  return sanitizeStudentDatabaseExportPayload({
    students,
    contracts: imported.contracts || [],
    directExpenses: imported.directExpenses || [],
    generalExpenses: imported.generalExpenses || [],
    agentPaymentRates: imported.agentPaymentRates || {}
  });
}

function getFrdoCells(filePath) {
  const workbook = XLSX.read(fs.readFileSync(filePath), {
    type: "buffer",
    cellDates: false,
    cellNF: true,
    cellText: true
  });
  const sheet = workbook.Sheets["База"];
  assert.ok(sheet, "В книге отсутствует лист «База».");
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  let headerRow = -1;
  let frdoColumn = -1;
  for (let row = range.s.r; row <= Math.min(range.e.r, 100) && headerRow < 0; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (String(cell?.v || "").trim() === "ФРДО") {
        headerRow = row;
        frdoColumn = column;
        break;
      }
    }
  }
  assert.ok(headerRow >= 0 && frdoColumn >= 0, "Не найдена колонка ФРДО.");
  const cells = [];
  for (let row = headerRow + 1; row <= range.e.r; row += 1) {
    const address = XLSX.utils.encode_cell({ r: row, c: frdoColumn });
    const cell = sheet[address];
    if (cell && cell.v !== "" && cell.v !== null && cell.v !== undefined) {
      cells.push({ address, ...cell });
    }
  }
  return cells;
}

try {
  assert.ok(fs.existsSync(sourcePath), `Не найдена тестовая XLSB: ${sourcePath}`);
  const sourceHash = sha256(sourcePath);

  const isoStudent = buildExportPayload([{
    id: "iso",
    uid: "iso",
    name: "ISO",
    frdoStatus: "2026-05-20T00:00:00.000Z"
  }]).students[0];
  assert.equal(isoStudent.frdoStatus, "2026-05-20");

  const preferredDateStudent = buildExportPayload([{
    id: "preferred",
    uid: "preferred",
    name: "Preferred",
    frdoDate: "2026-08-13",
    frdoStatus: "Не требуется"
  }]).students[0];
  assert.equal(preferredDateStudent.frdoStatus, "2026-08-13");
  assert.equal(preferredDateStudent.frdoDate, "2026-08-13");

  const textStudent = buildExportPayload([{
    id: "text",
    uid: "text",
    name: "Text",
    frdoStatus: "Не требуется"
  }]).students[0];
  assert.equal(textStudent.frdoStatus, "Не требуется");

  fs.copyFileSync(sourcePath, inputPath);
  const imported = parseStudentDatabaseWorkbook(fs.readFileSync(inputPath));
  const dateStudent = imported.students.find((student) => student.frdoDate);
  const notRequiredStudent = imported.students.find((student) => student.frdoStatus === "Не требуется");
  assert.ok(dateStudent, "При импорте не найдена нативная дата ФРДО.");
  assert.match(dateStudent.frdoDate, /^\d{4}-\d{2}-\d{2}$/u);
  assert.equal(dateStudent.frdoStatus, undefined);
  assert.ok(notRequiredStudent, "Текстовый статус «Не требуется» потерян при импорте.");
  assert.equal(notRequiredStudent.frdoDate, undefined);

  const payload = buildExportPayload(imported.students, {
    ...imported,
    directExpenses: [
      ...(imported.directExpenses || []),
      ...imported.students.flatMap((student) => student.directExpenses || [])
    ]
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
  assert.equal(sync.status, 0, sync.stderr || sync.stdout || "Синхронизация завершилась с ошибкой.");

  const frdoCells = getFrdoCells(outputPath);
  assert.ok(frdoCells.some((cell) => cell.t === "n"), "Даты ФРДО не записаны как числа Excel.");
  assert.ok(
    frdoCells.filter((cell) => cell.t === "n").every((cell) => Number.isInteger(cell.v)),
    "Дата ФРДО содержит дробную временную часть."
  );
  assert.ok(
    frdoCells.filter((cell) => cell.t === "n").every((cell) => (
      String(cell.z || "")
        .toLowerCase()
        .replace(/\\/gu, "")
        .split(";")[0] === "yyyy-mm-dd"
    )),
    `Для даты ФРДО не установлен формат yyyy-mm-dd: ${[
      ...new Set(frdoCells.filter((cell) => cell.t === "n").map((cell) => cell.z || ""))
    ].join(", ")}`
  );
  assert.ok(
    frdoCells.every((cell) => !String(cell.v).includes("T")),
    "В колонке ФРДО осталась ISO-строка с T."
  );
  assert.ok(
    frdoCells.some((cell) => cell.t === "s" && cell.v === "Не требуется"),
    "Текстовый статус «Не требуется» потерян при синхронизации."
  );

  const roundTrip = parseStudentDatabaseWorkbook(fs.readFileSync(outputPath));
  const savedDateStudent = roundTrip.students.find((student) => student.uid === dateStudent.uid);
  const savedTextStudent = roundTrip.students.find((student) => student.uid === notRequiredStudent.uid);
  assert.equal(savedDateStudent?.frdoDate, dateStudent.frdoDate);
  assert.equal(savedDateStudent?.frdoStatus, undefined);
  assert.equal(savedTextStudent?.frdoStatus, "Не требуется");
  assert.equal(savedTextStudent?.frdoDate, undefined);
  assert.equal(sha256(sourcePath), sourceHash, "Исходная XLSB была изменена во время теста.");

  console.log(JSON.stringify({
    importedDate: dateStudent.frdoDate,
    numericDates: frdoCells.filter((cell) => cell.t === "n").length,
    textStatuses: frdoCells.filter((cell) => cell.t === "s").length,
    sourceUnchanged: true
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
