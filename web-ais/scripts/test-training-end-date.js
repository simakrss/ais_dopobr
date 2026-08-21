const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requestedSource = String(process.env.AIS_TEST_APP_SOURCE || "").trim();
const appPath = requestedSource
  ? path.resolve(process.cwd(), requestedSource)
  : path.resolve(__dirname, "..", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function formatIsoDate(date) {
  if (!(date instanceof Date) && Object.prototype.toString.call(date) !== "[object Date]") return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

const programs = {
  duration: { name: "Курс со сроком", type: "КПК", duration: "2 нед.", hours: 300, groupIndex: "КПК" },
  fallback: { name: "Курс по часам", type: "КПК", duration: "", hours: 41, groupIndex: "ЧАС" },
  pro: { name: "Вебинар", type: "ПРО", duration: "", hours: 1, groupIndex: "ПРО" }
};

const context = {
  parseOrdersSdoDate: parseIsoDate,
  formatOrdersSdoDate: formatIsoDate,
  normalizeEducationProgramType(value) {
    const text = String(value || "").trim().toUpperCase();
    if (text.includes("ПРО")) return "ПРО";
    if (text.includes("КПК")) return "КПК";
    return text;
  },
  todayIso: () => "2026-08-20",
  findProgramByName: (name) => Object.values(programs).find((item) => item.name === name) || null,
  getStudentProgramHours(record) {
    const program = Object.values(programs).find((item) => item.name === record.program);
    return String(record.hours || "").trim() || program?.hours || "";
  },
  getGeneratedNumberFromDataFormula: (key) => ({ value: `${key}-1` }),
  getStudentGroupNumber: (name, date) => `${name}-${date}`,
  getEducationDocumentAutofillValues: (record, options) => ({
    diplomaIssueDate: options.issueDate,
    protocolDate: options.issueDate
  })
};
vm.createContext(context);
vm.runInContext(
  `${extractBetween("  function parseTrainingProgramDuration", "  function setOrdersSdoFieldValue")}
   ${extractBetween("  function getStudentBulkBaseDate", "  async function persistStudentBulkChanges")}
   this.getTrainingEndDate = getTrainingEndDate;
   this.prepareStudentRecordForBulkDocument = prepareStudentRecordForBulkDocument;`,
  context
);

const endDate = (startDate, options) => formatIsoDate(context.getTrainingEndDate(startDate, options));

assert.equal(endDate("2026-08-03", { duration: "2 нед.", hours: 300 }), "2026-08-17");
assert.equal(endDate("2026-08-03", { duration: "2 недели" }), "2026-08-17");
assert.equal(endDate("2026-08-03", { duration: "10 дней" }), "2026-08-13");
assert.equal(endDate("2026-08-03", { duration: "1 мес.", hours: 1 }), "2026-09-03");
assert.equal(endDate("2026-01-31", { duration: "1 месяц" }), "2026-02-28");
assert.equal(endDate("2026-08-03", { duration: "1,5 мес." }), "2026-09-18");
assert.equal(endDate("2026-08-03", { duration: "", hours: 1 }), "2026-08-10");
assert.equal(endDate("2026-08-03", { hours: 40 }), "2026-08-10");
assert.equal(endDate("2026-08-03", { hours: 40.1 }), "2026-08-17");
assert.equal(endDate("2026-08-03", { hours: 80 }), "2026-08-17");
assert.equal(endDate("2026-08-09", { duration: "2 нед." }), "2026-08-24");
assert.equal(endDate("2026-08-08", { duration: "2 нед." }), "2026-08-22");
assert.equal(endDate("2026-08-09", { hours: 1 }), "2026-08-17");
assert.equal(endDate("2026-08-03", { duration: "неизвестно", hours: 300 }), "");
assert.equal(endDate("2026-08-03", { duration: "", hours: 0 }), "");
assert.equal(endDate("не дата", { duration: "2 нед." }), "");

assert.equal(
  endDate("2026-08-03", { hours: 1, programType: "ПРО", sameDayForPro: true }),
  "2026-08-03",
  "В групповой генерации у ПРО начало и окончание должны совпадать"
);
assert.equal(
  endDate("2026-08-09", { hours: 1, programType: "ПРО", sameDayForPro: true }),
  "2026-08-09",
  "Для ПРО совпадение начала и окончания важнее общего переноса окончания с воскресенья"
);
assert.equal(
  endDate("2026-08-03", { hours: 1, programType: "ПРО" }),
  "2026-08-10",
  "Исключение ПРО должно включаться только групповым сценарием"
);

const durationBulk = context.prepareStudentRecordForBulkDocument({
  id: "student-duration",
  program: programs.duration.name,
  hours: 300,
  endDate: "2026-12-31"
}, "contract", "2026-08-03");
assert.equal(durationBulk.startDate, "2026-08-03");
assert.equal(durationBulk.endDate, "2026-08-17");

const fallbackBulk = context.prepareStudentRecordForBulkDocument({
  id: "student-fallback",
  program: programs.fallback.name,
  hours: 41,
  endDate: "2026-12-31"
}, "enrollmentOrder", "2026-08-03", "ORDER-1");
assert.equal(fallbackBulk.startDate, "2026-08-03");
assert.equal(fallbackBulk.endDate, "2026-08-17");

const proBulk = context.prepareStudentRecordForBulkDocument({
  id: "student-pro",
  program: programs.pro.name,
  hours: 1,
  endDate: "2026-12-31"
}, "contract", "2026-08-03");
assert.equal(proBulk.startDate, "2026-08-03");
assert.equal(proBulk.endDate, "2026-08-03");

const educationBulk = context.prepareStudentRecordForBulkDocument({
  id: "student-education",
  program: programs.duration.name,
  hours: 300,
  startDate: "2026-08-03",
  endDate: "2026-12-31"
}, "education", "2026-08-20", "ORDER-2");
assert.equal(educationBulk.endDate, "2026-08-17");
assert.equal(educationBulk.expulsionDate, "2026-08-20");
assert.equal(educationBulk.diplomaIssueDate, "2026-08-20");
assert.equal(educationBulk.protocolDate, "2026-08-20");

const educationWithoutTrainingStart = context.prepareStudentRecordForBulkDocument({
  id: "student-education-without-start",
  program: programs.duration.name,
  hours: 300,
  endDate: "2026-07-31"
}, "education", "2026-08-20", "ORDER-2B");
assert.equal(educationWithoutTrainingStart.startDate || "", "");
assert.equal(educationWithoutTrainingStart.endDate, "2026-07-31");
assert.equal(educationWithoutTrainingStart.diplomaIssueDate, "2026-08-20");

const certificateBulk = context.prepareStudentRecordForBulkDocument({
  id: "student-certificate",
  program: programs.duration.name,
  hours: 300,
  startDate: "2026-08-03",
  endDate: "2026-12-31"
}, "studyCertificate", "2026-08-20");
assert.equal(certificateBulk.endDate, "2026-08-17");

const expulsionBulk = context.prepareStudentRecordForBulkDocument({
  id: "student-expulsion",
  program: programs.duration.name,
  hours: 300,
  startDate: "2026-08-03",
  endDate: "2026-12-31"
}, "expulsionOrder", "2026-08-20", "ORDER-3");
assert.equal(expulsionBulk.endDate, "2026-08-17");
assert.equal(expulsionBulk.expulsionDate, "2026-08-20");

const proEducationBulk = context.prepareStudentRecordForBulkDocument({
  id: "student-pro-education",
  program: programs.pro.name,
  hours: 1,
  startDate: "2026-08-03",
  endDate: "2026-12-31"
}, "education", "2026-08-20", "ORDER-4");
assert.equal(proEducationBulk.endDate, "2026-08-03");
assert.equal(proEducationBulk.diplomaIssueDate, "2026-08-20");
assert.equal(proEducationBulk.expulsionDate, "2026-08-20");

assert.doesNotMatch(appSource, /с Shift — по 54 часам/iu);
const contextSource = extractBetween(
  "  function getOrdersSdoAutofillContext",
  "  function generateTrainingEndDate"
);
assert.match(contextSource, /const duration\s*=\s*String\(program\.duration\s*\|\|\s*""\)/u);
assert.match(contextSource, /if\s*\(!duration\s*&&\s*\(!Number\.isFinite\(hours\)\s*\|\|\s*hours\s*<=\s*0\)\)/u);
const manualGenerateSource = extractBetween(
  "  function generateTrainingEndDate",
  "  function autoFillOrdersSdo"
);
assert.match(manualGenerateSource, /getTrainingEndDate\(startDate,\s*\{\s*duration:\s*context\.duration,\s*hours:\s*context\.hours\s*\}\)/u);
const fullAutofillSource = extractBetween(
  "  function autoFillOrdersSdo",
  "  function evaluateDataFormula"
);
assert.match(fullAutofillSource, /getTrainingEndDate\(baseDateValue,\s*\{\s*duration:\s*context\.duration,\s*hours:\s*context\.hours\s*\}\)/u);
assert.match(appSource, /duration:\s*program\?\.duration,[\s\S]*sameDayForPro:\s*true/u);

const bulkSource = extractBetween(
  "  function prepareStudentRecordForBulkDocument",
  "  async function persistStudentBulkChanges"
);
assert.doesNotMatch(bulkSource, /record\.endDate\s*=\s*(?:baseDate|issueDate)/u);

console.log("Training end date tests passed.");
