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

class FakeInput {
  constructor(value = "") {
    this.value = value;
    this.events = [];
  }

  dispatchEvent(event) {
    this.events.push(event.type);
  }
}

class FakeSelect extends FakeInput {
  constructor(value = "", optionValues = []) {
    super(value);
    this.options = optionValues.map((optionValue) => ({ value: optionValue, textContent: optionValue }));
  }

  appendChild(option) {
    this.options.push(option);
  }
}

const context = {
  STUDENT_LEARNING_ADDITIONAL_STATUS: "Обучающиеся",
  PRO_STUDENT_ADDITIONAL_STATUS: "Вебинары",
  PRO_STUDENT_ARCHIVE_ADDITIONAL_STATUS: "Вебинары. Архив",
  HTMLInputElement: FakeInput,
  HTMLSelectElement: FakeSelect,
  Event: class FakeEvent {
    constructor(type) {
      this.type = type;
    }
  },
  document: {
    createElement() {
      return { value: "", textContent: "" };
    }
  },
  findProgramByName() {
    return null;
  }
};
vm.createContext(context);
vm.runInContext(
  `${extractBetween("  function normalizeEducationProgramType", "  function isFrdoProgramType")}
   ${extractBetween("  function syncProStudentAdditionalStatusControl", "  function getStudentCardTitle")}
   this.resolveProStudentAdditionalStatus = resolveProStudentAdditionalStatus;
   this.resolveStudentAdditionalStatusAfterMainStatusChange = resolveStudentAdditionalStatusAfterMainStatusChange;
   this.syncProStudentAdditionalStatusControl = syncProStudentAdditionalStatusControl;`,
  context
);

const resolveAfterChange = (record, type) => (
  context.resolveStudentAdditionalStatusAfterMainStatusChange(record, type)
);

assert.equal(
  resolveAfterChange({ status: "Учится", additionalStatus: "На зачисление" }, "КПК"),
  "Обучающиеся",
  "Статус «Учится» должен назначать дополнительный статус «Обучающиеся»"
);
assert.equal(
  resolveAfterChange({ status: "  УЧИТСЯ  ", additionalStatus: "Ручное значение" }, "ПРО"),
  "Обучающиеся",
  "Правило должно работать без учёта регистра, пробелов и вида программы"
);
assert.equal(
  resolveAfterChange({ status: "В работе", additionalStatus: "Ручное значение" }, "КПК"),
  "Ручное значение",
  "Другие статусы обычных программ не должны менять дополнительный статус"
);
assert.equal(
  resolveAfterChange({ status: "Отчислен", additionalStatus: "Вебинары" }, "ПРО"),
  "Вебинары. Архив",
  "Архивное правило ПРО должно сохраниться"
);
assert.equal(
  context.resolveProStudentAdditionalStatus(
    { status: "Учится", additionalStatus: "Ручное значение" },
    "ПРО"
  ),
  "Ручное значение",
  "Открытие карточки без смены статуса не должно перезаписывать ручное значение"
);

const additionalStatus = new FakeSelect("На зачисление", ["На зачисление"]);
const form = {
  dataset: { config: "students" },
  elements: {
    status: new FakeSelect("Учится", ["Учится"]),
    additionalStatus,
    program: new FakeInput("Обычная программа"),
    educationType: new FakeInput("КПК")
  }
};
assert.equal(context.syncProStudentAdditionalStatusControl(form, { mainStatusChanged: true }), true);
assert.equal(additionalStatus.value, "Обучающиеся");
assert.deepEqual(additionalStatus.events, ["input"]);
assert.ok(
  additionalStatus.options.some((option) => option.value === "Обучающиеся"),
  "Автоматическое значение должно добавляться в select открытой карточки"
);

assert.match(
  appSource,
  /studentAdditionalStatuses:\s*\[[\s\S]*?STUDENT_LEARNING_ADDITIONAL_STATUS/u,
  "«Обучающиеся» должны присутствовать в справочнике дополнительных статусов"
);
assert.match(
  appSource,
  /syncProStudentAdditionalStatusControl\(recordForm,\s*\{\s*mainStatusChanged:\s*targetName\s*===\s*"status"\s*\}\)/u,
  "Автоматическое правило должно запускаться непосредственно при смене статуса в карточке"
);
assert.match(
  appSource,
  /previousStatus\s*!==\s*nextStatus\)[\s\S]*?values\.additionalStatus\s*=\s*resolveStudentAdditionalStatusAfterMainStatusChange/u,
  "Сохранение карточки должно повторно закреплять правило при изменении статуса"
);

console.log("Student study additional status tests passed.");
