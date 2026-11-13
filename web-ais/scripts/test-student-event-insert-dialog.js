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

const sidePanelBlock = sourceBlock(
  appSource,
  "function renderStudentSidePanel(",
  "function renderStudentEventRow("
);
assert.match(sidePanelBlock, /data-action="add-student-event"/u);
assert.match(sidePanelBlock, /data-event-entity="\$\{escapeAttr\(entityType\)\}"/u);

const insertBlock = sourceBlock(
  appSource,
  "function getStudentEventInsertContext(",
  "function deleteStudentEvent("
);
assert.doesNotMatch(insertBlock, /window\.prompt/u);
assert.match(insertBlock, /getContractEventTemplates\(\)/u);
assert.match(insertBlock, /getStudentEventTemplatesForRecord\(record\)/u);
assert.match(insertBlock, /availableTemplates = context\.templates\.filter/u);
assert.match(insertBlock, />Типовое событие<\/button>/u);
assert.match(insertBlock, />Своё событие<\/button>/u);
assert.match(insertBlock, /name="customLabel"/u);
assert.match(insertBlock, /name="date" type="date"/u);
assert.match(insertBlock, /Все типовые события уже добавлены/u);
assert.match(insertBlock, /data-event-deleted/u);
assert.match(insertBlock, /data-event-custom-keys/u);
assert.match(insertBlock, /normalizeEventTemplateLabel\(customLabel\)/u);
assert.match(insertBlock, /renderStudentEventRow\(\{ key, label, custom \}, eventRecord\)/u);

const contextBlock = sourceBlock(
  appSource,
  "function getStudentEventInsertContext(",
  "function createCustomStudentEventKey("
);
const getStudentEventInsertContext = new Function(`
  const state = { modal: { config: "students" } };
  const collectStudentFormDraft = () => ({ id: "student", educationType: "КПК" });
  const collectContractFormDraft = () => ({ id: "employee" });
  const getStudentEventTemplatesForRecord = (record) => [{ key: "student-event", recordId: record.id }];
  const getContractEventTemplates = () => [{ key: "employee-event" }];
  ${contextBlock}
  return getStudentEventInsertContext;
`)();
assert.deepEqual(getStudentEventInsertContext("student"), {
  entityType: "student",
  entityLabel: "слушателя",
  record: { id: "student", educationType: "КПК" },
  templates: [{ key: "student-event", recordId: "student" }]
});
assert.deepEqual(getStudentEventInsertContext("contract"), {
  entityType: "contract",
  entityLabel: "сотрудника",
  record: { id: "employee" },
  templates: [{ key: "employee-event" }]
});

const addBlock = sourceBlock(appSource, "function addStudentEvent(", "function deleteStudentEvent(");
assert.match(addBlock, /showStudentEventInsertDialog/u);
assert.match(addBlock, /trigger\?\.dataset\.eventEntity/u);

const escapeBlock = sourceBlock(appSource, "function closeTopmostWindowByEscape()", "function bindEvents(");
assert.match(escapeBlock, /data-student-event-insert-dialog/u);
assert.match(escapeBlock, /closeStudentEventInsertDialog/u);

assert.match(stylesSource, /\.student-event-insert-dialog/u);
assert.match(stylesSource, /\.student-event-insert-tabs/u);
assert.match(stylesSource, /@media \(max-width: 600px\)[\s\S]*\.student-event-insert-backdrop/u);

console.log("student and employee event insert dialog checks: OK");
