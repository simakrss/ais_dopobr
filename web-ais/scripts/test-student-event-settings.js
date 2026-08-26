const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "app.js");
const stylesPath = path.join(__dirname, "..", "styles.css");
const appSource = fs.readFileSync(appPath, "utf8");
const stylesSource = fs.readFileSync(stylesPath, "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Не найден блок: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Не найден конец блока: ${endMarker}`);
  return source.slice(start, end);
}

const optionsBlock = sourceBlock(
  appSource,
  "const studentEventProgramTypeOptions",
  "const STUDENT_APPLICATION_REUSABLE_DOCUMENT_FIELDS"
);
const conditionBlock = sourceBlock(
  appSource,
  "function normalizeEventTemplateProgramTypes(",
  "function studentEventTemplateMatchesProgram("
);
const helpers = new Function(`
  const unique = (values) => [...new Set(values)];
  const normalizeEducationProgramType = (value) => String(value || "").trim().toUpperCase();
  const studentEventTemplates = [];
  const contractEventTemplates = [];
  const state = { data: { meta: {} } };
  const buildMacroEventKey = (label) => label;
  ${optionsBlock}
  ${conditionBlock}
  return {
    studentEventProgramTypeOptions,
    getStudentEventEnabledProgramTypes,
    buildStudentEventProgramConditions
  };
`)();

assert.deepEqual(
  helpers.studentEventProgramTypeOptions.map((item) => item.value),
  ["КПК", "ППП", "ДОП", "ПРО"]
);
assert.deepEqual(
  helpers.getStudentEventEnabledProgramTypes({ excludeTypes: ["ПРО"] }),
  ["КПК", "ППП", "ДОП"]
);
assert.deepEqual(
  helpers.getStudentEventEnabledProgramTypes({ includeTypes: ["КПК", "ППП"] }),
  ["КПК", "ППП"]
);
assert.deepEqual(
  helpers.buildStudentEventProgramConditions(["КПК", "ППП", "ДОП", "ПРО"]),
  { includeTypes: [], excludeTypes: [] }
);
assert.deepEqual(
  helpers.buildStudentEventProgramConditions([]),
  { includeTypes: [], excludeTypes: ["КПК", "ППП", "ДОП", "ПРО"] }
);
assert.deepEqual(
  helpers.buildStudentEventProgramConditions(["КПК", "ППП"], { includeTypes: ["КПК"] }),
  { includeTypes: ["КПК", "ППП"], excludeTypes: [] }
);
assert.deepEqual(
  helpers.buildStudentEventProgramConditions(["КПК", "ППП", "ДОП"], { excludeTypes: ["ПРО"] }),
  { includeTypes: [], excludeTypes: ["ПРО"] }
);

const settingsBlock = sourceBlock(appSource, "function renderSettings()", "function escapeDictionarySearchRegExp(");
assert.match(settingsBlock, /key: "studentEventSettings"/u);
assert.match(settingsBlock, /renderStudentEventSettingsDictionary\(selectedValues\)/u);

const saveBlock = sourceBlock(appSource, "function collectStudentEventSettings(", "function saveSdoSettings(");
assert.match(saveBlock, /state\.data\.meta\.studentEventTemplates = settings/u);
assert.match(saveBlock, /buildStudentEventProgramConditions/u);

const catalogBlock = sourceBlock(appSource, "function getStudentEventCatalog(", "function csvList(");
assert.match(catalogBlock, /activeTemplateKeys/u);
assert.match(catalogBlock, /filledTemplateKeys/u);
const getStudentEventCatalog = new Function(`
  const configured = [
    { key: "common", label: "Общее событие" },
    { key: "limited", label: "Ограниченное событие" }
  ];
  const getStudentEventTemplates = () => configured;
  const csvList = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const unique = (values) => [...new Set(values)];
  const normalizeEventState = (value, date) => value || date ? "dated" : "";
  ${catalogBlock}
  return getStudentEventCatalog;
`)();
assert.deepEqual(
  getStudentEventCatalog({ eventOrder: "common,limited" }, [{ key: "common", label: "Общее событие" }])
    .map((item) => item.key),
  ["common"]
);
assert.deepEqual(
  getStudentEventCatalog({
    eventOrder: "common,limited",
    event_limited_state: "dated",
    event_limited_date: "2026-08-26"
  }, [{ key: "common", label: "Общее событие" }]).map((item) => item.key),
  ["common", "limited"]
);

assert.match(stylesSource, /\.student-event-settings-table/u);
assert.match(stylesSource, /\.student-event-setting-programs/u);
assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*\.student-event-setting-row/u);

console.log("student event settings checks: OK");
