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

const students = [
  ...Array.from({ length: 16 }, (_, index) => ({
    id: `kpk-${index + 1}`,
    registrationNo: `${index + 1}/26-ПК`
  })),
  ...Array.from({ length: 28 }, (_, index) => ({
    id: `pro-${index + 1}`,
    registrationNo: `${index + 1}/26-ПРО`
  })),
  ...Array.from({ length: 16 }, (_, index) => ({
    id: `ppp-${index + 1}`,
    registrationNo: `${index + 1}/26-ПП`
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `dop-${index + 1}`,
    registrationNo: `${index + 1}/26-ДОП`
  })),
  { id: "dobryshkina", registrationNo: "29/26-ПК" },
  { id: "previous-year", registrationNo: "99/25-ПК" }
];

const context = {
  state: {
    data: {
      collections: {
        students,
        contracts: []
      }
    }
  },
  educationRegistrationTypeCodeDefaults: [{ code: "ПК" }],
  getEducationRegistrationTypeCode(programType) {
    return {
      "КПК": "ПК",
      "ППП": "ПП",
      "ПРО": "ПРО",
      "ДОП": "ДОП"
    }[programType] || programType;
  }
};

vm.createContext(context);
vm.runInContext(
  `${extractBetween("  function evaluateDataFormula", "  function parseOrdersSdoDate")}
   this.getNextDataFormulaYearSequence = getNextDataFormulaYearSequence;
   this.createDate = (year, month, day) => new Date(year, month - 1, day);`,
  context
);

const formula = {
  targetField: "registrationNo",
  template: "{ПорядковыйНомерЗаГод}/{Год2}-{СокращениеТипаПрограммы}"
};
const issueDate = context.createDate(2026, 8, 26);
const next = (programType, currentId = "") => context.getNextDataFormulaYearSequence(
  formula,
  issueDate,
  currentId,
  {
    programType,
    programTypeCode: context.getEducationRegistrationTypeCode(programType)
  }
);

assert.equal(
  next("КПК", "dobryshkina"),
  17,
  "Для Добрышкиной должен использоваться номер следующего удостоверения ПК, а не общий максимум"
);
assert.equal(
  next("КПК"),
  18,
  "Ошибочный старый номер не должен сдвигать счётчик: учитывается количество документов вида"
);
assert.equal(next("ППП"), 17, "Дипломы ПП должны иметь отдельную годовую последовательность");
assert.equal(next("ПРО"), 29, "Сертификаты ПРО должны иметь отдельную годовую последовательность");
assert.equal(next("ДОП"), 5, "Документы ДОП должны иметь отдельную годовую последовательность");

console.log("Education document registration sequence tests passed.");
