const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const requestedSource = String(process.env.AIS_TEST_APP_SOURCE || "").trim();
const appSource = fs.readFileSync(
  requestedSource ? path.resolve(process.cwd(), requestedSource) : path.join(root, "app.js"),
  "utf8"
);

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

const context = {
  PRO_STUDENT_ADDITIONAL_STATUS: "Вебинары",
  PRO_STUDENT_ARCHIVE_ADDITIONAL_STATUS: "Вебинары. Архив"
};
vm.createContext(context);
vm.runInContext(
  `${extractBetween("  function normalizeEducationProgramType", "  function isFrdoProgramType")}
   this.resolveProStudentAdditionalStatus = resolveProStudentAdditionalStatus;`,
  context
);

const resolve = (record, type, options) => context.resolveProStudentAdditionalStatus(record, type, options);

assert.equal(
  resolve({ status: "На зачисление", additionalStatus: "" }, "ПРО", { imported: true }),
  "Вебинары",
  "Импорт заявки ПРО должен назначать активный раздел вебинаров"
);
assert.equal(
  resolve({ status: "Отчислен", additionalStatus: "Вебинары" }, "ПРО", { imported: true }),
  "Вебинары. Архив",
  "При импорте сразу в статусе «Отчислен» архив должен иметь приоритет"
);
assert.equal(
  resolve({ status: "Отчислен", additionalStatus: "Ручное значение" }, "ПРО"),
  "Вебинары. Архив",
  "Установка статуса «Отчислен» для ПРО должна назначать архив"
);
assert.equal(
  resolve({ status: "Учится", additionalStatus: "Ручное значение" }, "ПРО"),
  "Ручное значение",
  "Обычное сохранение ПРО не должно перезаписывать ручной дополнительный статус"
);
assert.equal(
  resolve({ status: "Отчислен", additionalStatus: "Другой раздел" }, "КПК", { imported: true }),
  "Другой раздел",
  "Правила ПРО не должны затрагивать другие типы программ"
);
assert.equal(
  resolve({ status: "  ОТЧИСЛЕН  ", additionalStatus: "" }, "про"),
  "Вебинары. Архив",
  "Сравнение вида программы и статуса должно быть нечувствительно к регистру и пробелам"
);
assert.equal(
  resolve({ status: "Учится", educationType: "ПРО", additionalStatus: "" }, "", { imported: true }),
  "Вебинары",
  "При отсутствии явного вида программы должен использоваться educationType карточки"
);

assert.match(
  appSource,
  /record\.additionalStatus\s*=\s*resolveProStudentAdditionalStatus\([\s\S]*?\{\s*imported:\s*true\s*\}/u,
  "Импорт заявок должен вызывать правило с признаком imported"
);
assert.match(
  appSource,
  /educationType:\s*String\(program\?\.type\s*\|\|\s*getStudentApplicationInferredProgramType\(row\)/u,
  "Вид выбранной программы из реестра должен иметь приоритет над текстовым предположением заявки"
);
assert.match(
  appSource,
  /previousStatus\s*!==\s*nextStatus[\s\S]*?values\.additionalStatus\s*=\s*resolveStudentAdditionalStatusAfterMainStatusChange/u,
  "Карточка должна применять правило при изменении основного статуса"
);
assert.match(
  appSource,
  /function bulkSetStatus[\s\S]*?resolveProStudentAdditionalStatus\([\s\S]*?proArchiveCount/u,
  "Массовая смена статуса должна применять правило ПРО"
);
assert.match(
  appSource,
  /studentAdditionalStatuses:\s*\[[\s\S]*?PRO_STUDENT_ADDITIONAL_STATUS[\s\S]*?PRO_STUDENT_ARCHIVE_ADDITIONAL_STATUS/u,
  "Оба автоматических значения должны присутствовать в справочнике"
);
assert.match(
  appSource,
  /\["status",\s*"program",\s*"educationType"\][\s\S]*?syncProStudentAdditionalStatusControl/u,
  "Поле дополнительного статуса должно обновляться в открытой карточке"
);

console.log("PRO student additional status tests passed.");
