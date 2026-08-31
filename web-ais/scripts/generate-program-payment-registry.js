const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const XLSX = require("../vendor/sheetjs/xlsx.full.min.js");

const appDirectory = path.resolve(__dirname, "..");
const defaultWorkbookPath = path.resolve(appDirectory, "..", "АИС Допобразование.xlsb");
const workbookPath = path.resolve(process.argv[2] || defaultWorkbookPath);
const outputPath = path.resolve(appDirectory, "data", "program-payment-registry.js");
const workbookBuffer = fs.readFileSync(workbookPath);
const workbook = XLSX.read(workbookBuffer, { type: "buffer", cellDates: true });
const worksheet = workbook.Sheets["Реестр программ"];

if (!worksheet) throw new Error("В файле не найден лист «Реестр программ».");

const rows = XLSX.utils.sheet_to_json(worksheet, {
  header: 1,
  defval: "",
  raw: true
});
const programHeaders = new Set(["Наименование программы", "Программа", "Наименование"]);
const headerRowIndex = rows.findIndex((row) => (
  row.some((value) => programHeaders.has(String(value || "").trim()))
  && row.some((value) => String(value || "").trim() === "Автор")
));

if (headerRowIndex < 0) {
  throw new Error("Не найдены колонки программы и автора.");
}

const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
const programColumn = headers.findIndex((value) => programHeaders.has(value));
const programFieldDefinitions = [
  ["Автор", "authorSource"],
  ["Квалификация", "qualification", "list"],
  ["Сфера деятельности", "activityScope", "list"],
  ["ФГОС", "fgos", "list"],
  ["ФГОС компетенция", "fgosCompetency", "list"],
  ["Профстандарт", "professionalStandard", "list"],
  ["Профстандарт трудовые функции", "professionalStandardFunctions", "list"],
  ["Область профессиональной деятельности (для ФРДО)", "frdoProfessionalArea", "list"],
  ["Вид экономической деятельности (для 1-ПК)", "economicActivity", "list"],
  ["Минимальный уровень образования слушателя", "minimumEducationLevel", "list"],
  ["Номер приказа", "programOrderNo"],
  ["Дата приказа", "programOrderDate", "date"],
  ["Папка ОП", "opFolder"],
  ["Имя файла ОП", "opFileName"],
  ["Председатель", "commissionChair", "list"],
  ["Член1", "commissionMember1", "list"],
  ["Член2", "commissionMember2", "list"],
  ["Секретарь", "secretary", "list"],
  ["Разработчик", "developer", "list"],
  ["Менеджер", "manager", "list"],
  ["Преподаватели", "teachers", "list"],
  ["Литература ОП", "literature", "list"]
].map(([header, key, type = "text"]) => ({
  index: headers.indexOf(header),
  key,
  type
}));

function normalizeListValue(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item ?? "").split(/\r?\n|;\s*/u))
    .map((item) => item.trim())
    .filter(Boolean))]
    .join("\n");
}

function normalizeDateValue(value) {
  let date = value instanceof Date ? value : null;
  if (!date && typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  if (date && !Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const source = String(value || "").trim();
  const ruMatch = /^(\d{2})[./-](\d{2})[./-](\d{4})$/u.exec(source);
  if (ruMatch) return `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}`;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/u.exec(source);
  return isoMatch ? `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}` : source;
}

const programs = rows.slice(headerRowIndex + 1)
  .map((row) => {
    const record = {
      name: String(row[programColumn] || "").trim()
    };
    programFieldDefinitions.forEach((definition) => {
      const value = definition.index >= 0 ? row[definition.index] : "";
      record[definition.key] = definition.type === "list"
        ? normalizeListValue(value)
        : (definition.type === "date" ? normalizeDateValue(value) : String(value ?? "").trim());
    });
    return record;
  })
  .filter((item) => item.name);

function getNamedCellValue(name) {
  const namedRange = (workbook.Workbook?.Names || [])
    .find((item) => String(item?.Name || "").trim() === name);
  const reference = String(namedRange?.Ref || "").trim();
  const separatorIndex = reference.lastIndexOf("!");
  if (separatorIndex < 0) return 0;
  let sheetName = reference.slice(0, separatorIndex).trim();
  if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
    sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
  }
  const cellAddress = reference.slice(separatorIndex + 1).split(":")[0].replace(/\$/g, "");
  return Number(workbook.Sheets[sheetName]?.[cellAddress]?.v || 0);
}

const rates = {
  employeeRate: getNamedCellValue("СтавкаОплатыСотруднику"),
  teacherRate: getNamedCellValue("СтавкаОплатыПреподавателю"),
  commissionChairRate: getNamedCellValue("СтавкаОплатыИАК"),
  practiceReviewRate: getNamedCellValue("СтавкаОплатыПроверкаПрактики")
};
const defaultPercentSource = getNamedCellValue("АвторскаяСтавка");
const defaultAuthorPercent = Math.abs(defaultPercentSource) <= 1
  ? defaultPercentSource * 100
  : defaultPercentSource;
const version = `2026-07-30-characteristics-${crypto
  .createHash("sha1")
  .update(workbookBuffer)
  .digest("hex")
  .slice(0, 10)}`;
const output = [
  "// Generated from АИС Допобразование.xlsb. Do not edit manually.",
  `window.AIS_PROGRAM_PAYMENT_REGISTRY_VERSION = ${JSON.stringify(version)};`,
  `window.AIS_PROGRAM_DEFAULT_AUTHOR_PAYMENT_PERCENT = ${JSON.stringify(defaultAuthorPercent)};`,
  `window.AIS_PAYMENT_RATES = ${JSON.stringify(rates, null, 2)};`,
  `window.AIS_PROGRAM_PAYMENT_REGISTRY = ${JSON.stringify(programs, null, 2)};`,
  ""
].join("\n");

fs.writeFileSync(outputPath, output, "utf8");
console.log(JSON.stringify({
  outputPath,
  version,
  programCount: programs.length,
  rates,
  defaultAuthorPercent
}));
