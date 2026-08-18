const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appPath = path.resolve(__dirname, "..", "app.js");
const stylesPath = path.resolve(__dirname, "..", "styles.css");
const appSource = fs.readFileSync(appPath, "utf8");
const stylesSource = fs.readFileSync(stylesPath, "utf8");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

const context = {};
vm.createContext(context);
vm.runInContext(
  `${extractBetween(
    "  function parseTrainingPlanHoursValue",
    "  function getStudentGroupNumber"
  )}
  this.calculateSummary = calculateProgramTrainingPlanHoursSummary;
  this.getStatus = getProgramTrainingPlanHoursStatus;
  this.getMismatchTitle = getProgramTrainingPlanHoursMismatchTitle;`,
  context
);

const balanced = context.calculateSummary(300, [
  { totalHours: 30 },
  { totalHours: 26 },
  { totalHours: 244 }
]);
assert.deepEqual(
  JSON.parse(JSON.stringify(balanced)),
  {
    hasPlan: true,
    programHours: 300,
    distributedHours: 300,
    remainingHours: 0,
    mismatch: false
  }
);
assert.match(context.getStatus(balanced), /Все часы программы распределены/iu);
assert.equal(context.getMismatchTitle(balanced), "");

const underAllocated = context.calculateSummary("300", [
  { totalHours: "120" },
  { totalHours: "160" }
]);
assert.equal(underAllocated.distributedHours, 280);
assert.equal(underAllocated.remainingHours, 20);
assert.equal(underAllocated.mismatch, true);
assert.match(context.getStatus(underAllocated), /не распределено 20 ч/iu);
assert.match(context.getMismatchTitle(underAllocated), /Нераспределено: 20 ч/iu);

const overAllocated = context.calculateSummary(300, [
  { totalHours: 200 },
  { totalHours: 110 }
]);
assert.equal(overAllocated.remainingHours, -10);
assert.equal(overAllocated.mismatch, true);
assert.match(context.getStatus(overAllocated), /превышает объём программы на 10 ч/iu);

const missingProgramHours = context.calculateSummary("", [{ totalHours: 40 }]);
assert.equal(missingProgramHours.programHours, null);
assert.equal(missingProgramHours.remainingHours, null);
assert.equal(missingProgramHours.mismatch, true);
assert.match(context.getStatus(missingProgramHours), /Укажите объём часов программы/iu);

const emptyPlan = context.calculateSummary("128", []);
assert.equal(emptyPlan.hasPlan, false);
assert.equal(emptyPlan.distributedHours, 0);
assert.equal(emptyPlan.remainingHours, 128);
assert.equal(emptyPlan.mismatch, false);
assert.match(context.getStatus(emptyPlan), /пока не заполнен/iu);

const decimalHours = context.calculateSummary("128,5", [
  { totalHours: "100,25" },
  { totalHours: "28,25" },
  { totalHours: "ошибка" }
]);
assert.equal(decimalHours.distributedHours, 128.5);
assert.equal(decimalHours.remainingHours, 0);
assert.equal(decimalHours.mismatch, false);

assert.match(
  appSource,
  /data-program-training-plan-hours-summary[\s\S]*Нераспределено[\s\S]*data-program-training-plan-remaining-hours/u,
  "На вкладке учебного плана должен отображаться нераспределённый объём"
);
assert.match(
  appSource,
  /fieldItem\.key === "hours"[\s\S]*program-hours-mismatch-cell/u,
  "В реестре программ объём часов с расхождением должен подсвечиваться"
);
assert.match(
  appSource,
  /\[name="hours"\][\s\S]*addEventListener\("input"[\s\S]*data-plan-field="totalHours"[\s\S]*refreshProgramTrainingPlanHoursState/u,
  "Сверка должна обновляться при изменении объёма программы и строк плана"
);
assert.match(
  stylesSource,
  /input\[name="hours"\]\.is-hours-mismatch[\s\S]*#dc2626[\s\S]*\.program-training-plan-hours-summary\.is-mismatch/iu,
  "Для расхождения должна быть красная визуальная индикация"
);

console.log("Program training plan hours tests passed.");
