"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
const serverSource = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8");

const tabsStart = appSource.indexOf("  const studentCardTabs = [");
const documentsStart = appSource.indexOf('    {\n      id: "documents",', tabsStart);
assert.ok(tabsStart >= 0 && documentsStart > tabsStart);
const mainTab = new Function("field", `${appSource.slice(tabsStart, documentsStart)}]; return studentCardTabs[0];`)(
  (key, label, type = "text", required = false) => ({ key, label, type, required })
);
assert.equal(mainTab.id, "main");
const identity = mainTab.sections.find((section) => section.title === "Обучающийся");
const dates = mainTab.sections.find((section) => section.title === "Сроки обучения");
assert.deepEqual(identity.fields.slice(0, 3).map((item) => item.key), ["name", "applicationDate", "nameEnglish"]);
assert.equal(identity.fields[1].type, "date");
assert.equal(identity.fields[1].label, "Дата подачи заявки");
assert.equal(mainTab.sections.flatMap((section) => section.fields).filter((item) => item.key === "applicationDate").length, 1);
assert.deepEqual(dates.fields.map((item) => item.key), ["startDate", "endDate", "extendedEndDate"]);

const renderStart = appSource.indexOf("  function renderStudentMainIdentity(");
const renderEnd = appSource.indexOf("\n\n  function renderStudentAddressField(", renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);
const fieldHtml = (item, record) => {
  assert.ok(item, "Every rendered field must have a definition");
  return `<input name="${item.key}" value="${record[item.key] || ""}">`;
};
const render = new Function(
  "renderStudentField", "renderStudentEnglishNameField", "renderStudentPhotoEditor", "renderStudentNameOptions",
  "renderStudentGenderField", "renderStudentContactLine", "renderStudentPhotoPathField", "orderStudentMainField",
  "renderStudentProgramLine", "renderStudentAddressField",
  `${appSource.slice(renderStart, renderEnd)}\nreturn renderStudentMainIdentity;`
)(fieldHtml, fieldHtml, () => "", () => "", () => "", () => "", () => "", () => 0, () => "", () => "");

for (const applicationDate of ["2026-09-08", ""]) {
  const html = render(identity, { name: "Тестова Анна", applicationDate });
  assert.equal((html.match(/name="applicationDate"/g) || []).length, 1);
  assert.ok(html.indexOf('name="name"') < html.indexOf('name="applicationDate"'));
  assert.ok(html.indexOf('name="applicationDate"') < html.indexOf('name="nameEnglish"'));
  assert.ok(html.includes(`name="applicationDate" value="${applicationDate}"`));
}
assert.match(serverSource, /"Дата подачи заявки": "applicationDate"/u, "Reuse the existing XLSB mapping");
console.log("Student main tab application date position, uniqueness and XLSB binding: OK");
