const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const XLSX = require("../vendor/sheetjs/xlsx.full.min.js");
const {
  parseStudentDatabaseWorkbook,
  parseStudentDatabaseMacroSettings,
  sanitizeStudentDatabaseExportPayload
} = require("../app-server.js");

const sourcePath = path.resolve(process.argv[2] || "Y:/АИС Допобразование/АИС Допобразование.xlsb");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-payment-rules-"));
const inputPath = path.join(tempRoot, "input.xlsb");
const outputPath = path.join(tempRoot, "output.xlsb");
const payloadPath = path.join(tempRoot, "payload.json");
const syncScript = path.resolve(__dirname, "sync-student-database.ps1");
const expectedRules = [
  "Оплата преподавателю,[АвторскаяСтавка],-Тестовый сотрудник",
  "Оплата председателю ИАК,[СтавкаОплатыИАК]",
  "Почтовое отправление,150,Тестовая почта"
].join("\n");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getMacroSetting(filePath, key) {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true });
  const definedName = (workbook.Workbook?.Names || []).find((item) => item.Name === "НастройкиМакросов");
  if (!definedName) throw new Error("В книге отсутствует диапазон «НастройкиМакросов».");
  const reference = String(definedName.Ref || "").replace(/^=/u, "");
  const separator = reference.lastIndexOf("!");
  const sheetName = reference.slice(0, separator).replace(/^'|'$/gu, "").replace(/''/gu, "'");
  const address = reference.slice(separator + 1).replace(/\$/gu, "").split(":")[0];
  const text = String(workbook.Sheets[sheetName]?.[address]?.v || "");
  const match = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}=(.*)$`, "mu").exec(text);
  return match ? match[1] : null;
}

function buildMacroWorkbook(text) {
  return {
    Workbook: { Names: [{ Name: "НастройкиМакросов", Ref: "'Настройки'!$AA$2" }] },
    Sheets: { Настройки: { AA2: { t: "s", v: text } } }
  };
}

try {
  const missingKey = parseStudentDatabaseMacroSettings(buildMacroWorkbook("События=Тест"));
  if (Object.prototype.hasOwnProperty.call(missingKey.macroSettings, "automaticExpenseRules")) {
    throw new Error("Отсутствующий ключ правил ошибочно трактуется как пустой.");
  }
  const emptyKey = parseStudentDatabaseMacroSettings(buildMacroWorkbook("АвтоНазнОплат="));
  if (
    !Object.prototype.hasOwnProperty.call(emptyKey.macroSettings, "automaticExpenseRules")
    || emptyKey.macroSettings.automaticExpenseRules !== ""
  ) {
    throw new Error("Пустой ключ правил не сохраняется как явное пустое значение.");
  }
  const sourceHash = sha256(sourcePath);
  const preservedSetting = getMacroSetting(sourcePath, "UpdateServer");
  fs.copyFileSync(sourcePath, inputPath);
  const imported = parseStudentDatabaseWorkbook(fs.readFileSync(inputPath));
  if (!Object.prototype.hasOwnProperty.call(imported.macroSettings, "automaticExpenseRules")) {
    throw new Error("Импорт не отличает существующий ключ правил от отсутствующего.");
  }
  const directExpenses = [
    ...(imported.directExpenses || []),
    ...(imported.students || []).flatMap((student) => student.directExpenses || [])
  ];
  const expectedStudentEvents = imported.macroSettings.studentEventTemplates.map((event, index) => ({
    ...event,
    ...(index === 0 ? { includeTypes: ["КПК", "ППП"], excludeTypes: [] } : {})
  }));
  const expectedContractEvents = [...imported.macroSettings.contractEventTemplates].reverse();
  const payload = sanitizeStudentDatabaseExportPayload({
    students: imported.students,
    contracts: imported.contracts,
    directExpenses,
    generalExpenses: imported.generalExpenses || [],
    paymentConstants: imported.paymentConstants,
    agentPaymentRates: imported.agentPaymentRates,
    macroSettings: {
      ...imported.macroSettings,
      studentEventTemplates: expectedStudentEvents,
      contractEventTemplates: expectedContractEvents,
      automaticExpenseRules: expectedRules
    }
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
  if (sync.status !== 0) {
    throw new Error(sync.stderr || sync.stdout || "Синхронизация тестовой книги завершилась с ошибкой.");
  }
  const syncResult = String(sync.stdout || "")
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .findLast((item) => item?.type === "result");
  if (!syncResult) throw new Error("Синхронизация не вернула итоговую статистику.");

  const roundTrip = parseStudentDatabaseWorkbook(fs.readFileSync(outputPath));
  if (roundTrip.macroSettings.automaticExpenseRules !== expectedRules) {
    throw new Error("Правила назначения оплат изменились после повторного импорта.");
  }
  if (getMacroSetting(outputPath, "АвтоНазнОплат") !== expectedRules.replace(/\n/gu, "\u000b\u000b")) {
    throw new Error("Правила назначения оплат записаны не в формате двойного VT.");
  }
  if (Number(syncResult.automaticExpenseRules) !== 3) {
    throw new Error(`Некорректная статистика правил: ${syncResult.automaticExpenseRules}.`);
  }
  if (
    JSON.stringify(roundTrip.macroSettings.studentEventTemplates.map((event) => ({
      label: event.label,
      includeTypes: event.includeTypes,
      excludeTypes: event.excludeTypes
    }))) !== JSON.stringify(expectedStudentEvents.map((event) => ({
      label: event.label,
      includeTypes: event.includeTypes,
      excludeTypes: event.excludeTypes
    })))
  ) {
    throw new Error("Настройки событий слушателей изменились после повторного импорта.");
  }
  if (
    JSON.stringify(roundTrip.macroSettings.contractEventTemplates.map((event) => event.label))
      !== JSON.stringify(expectedContractEvents.map((event) => event.label))
  ) {
    throw new Error("Настройки событий сотрудников изменились после повторного импорта.");
  }
  if (Number(syncResult.studentEventTemplates) !== expectedStudentEvents.length) {
    throw new Error(`Некорректная статистика событий слушателей: ${syncResult.studentEventTemplates}.`);
  }
  if (Number(syncResult.contractEventTemplates) !== expectedContractEvents.length) {
    throw new Error(`Некорректная статистика событий сотрудников: ${syncResult.contractEventTemplates}.`);
  }
  if (getMacroSetting(outputPath, "UpdateServer") !== preservedSetting) {
    throw new Error("При записи правил изменена соседняя настройка диапазона.");
  }
  if (sha256(sourcePath) !== sourceHash) {
    throw new Error("Исходная XLSB была изменена во время теста.");
  }

  console.log(JSON.stringify({
    paymentRules: syncResult.automaticExpenseRules,
    studentEvents: roundTrip.macroSettings.studentEventTemplates.length,
    employeeEvents: roundTrip.macroSettings.contractEventTemplates.length,
    preservedNeighbor: true,
    sourceUnchanged: true
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
