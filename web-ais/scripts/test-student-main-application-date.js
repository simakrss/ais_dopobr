"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
const serverSource = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");

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
  return `<label><span>${item.label}${item.required ? " *" : ""}</span><input name="${item.key}" value="${record[item.key] || ""}" type="${item.type === "date" ? "date" : "text"}"></label>`;
};
const extract = (name) => {
  const start = appSource.indexOf(`  function ${name}(`);
  const end = appSource.indexOf("\n\n  function ", start + 1);
  assert.ok(start >= 0 && end > start);
  return appSource.slice(start, end);
};
const escape = value => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const englishName = new Function("escapeHtml", "escapeAttr", `${extract("renderStudentEnglishNameField")}\nreturn renderStudentEnglishNameField;`)(escape, escape);
const gender = new Function("escapeHtml", "escapeAttr", `${extract("renderStudentGenderField")}\nreturn renderStudentGenderField;`)(escape, escape);
const nameOptions = new Function("isChecked", `${extract("renderStudentNameOptions")}\nreturn renderStudentNameOptions;`)(() => false);
const render = new Function(
  "renderStudentField", "renderStudentEnglishNameField", "renderStudentPhotoEditor", "renderStudentNameOptions",
  "renderStudentGenderField", "renderStudentContactLine", "renderStudentPhotoPathField", "orderStudentMainField",
  "renderStudentProgramLine", "renderStudentAddressField",
  `${appSource.slice(renderStart, renderEnd)}\nreturn renderStudentMainIdentity;`
)(fieldHtml, englishName, () => '<div class="photo-preview"><span>ТА</span></div>', nameOptions,
  gender, () => '<div class="student-contact-line"><label class="student-contact-field"><span>Email</span><input name="email" value="test@example.com"></label><label class="student-contact-field"><span>Телефон</span><input name="phone" value="+79990000000"></label><label class="student-contact-field"><span>Адрес мессенджера</span><input name="messengerUrl" value=""></label></div>',
  () => '<label class="student-photo-path-field"><span>Фото</span><div class="student-photo-path-control"><input name="photoPath" value=""><button class="icon-button" type="button">…</button><button class="icon-button" type="button">+</button></div></label>',
  () => 0, () => "", () => "");

for (const applicationDate of ["2026-09-08", ""]) {
  const html = render(identity, { name: "Тестова Анна", applicationDate });
  assert.equal((html.match(/name="applicationDate"/g) || []).length, 1);
  assert.ok(html.indexOf('name="name"') < html.indexOf('name="applicationDate"'));
  assert.ok(html.indexOf('name="applicationDate"') < html.indexOf('name="nameEnglish"'));
  assert.ok(html.includes(`name="applicationDate" value="${applicationDate}"`));
  const header = html.slice(html.indexOf('class="student-name-date-row"'), html.indexOf('class="student-name-stack"'));
  assert.ok(header.includes('name="name"') && header.includes('name="applicationDate"'));
  assert.ok(header.includes('title="Дата подачи заявки"'));
  assert.ok(header.includes('Дата заявки'));
}
assert.match(stylesSource, /\.student-name-date-row\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*grid-template-columns:\s*inherit;/u);
assert.match(stylesSource, /\.student-name-status-grid \.student-status-stack\s*\{\s*display:\s*contents;/u);
assert.match(stylesSource, /\.student-name-status-grid \.student-status-stack > label:first-child\s*\{[^}]*grid-row:\s*2;/u);
assert.match(stylesSource, /@media \(max-width: 720px\)\s*\{\s*\.student-name-status-grid \.student-name-date-row > label,[\s\S]*?grid-template-columns:\s*1fr;/u);
assert.match(serverSource, /"Дата подачи заявки": "applicationDate"/u, "Reuse the existing XLSB mapping");
console.log("Student header date: next to name, shared alignment, responsive layout, uniqueness and unchanged XLSB binding: OK");

if (process.argv.includes("--serve")) {
  const record = {name: "Тестова Анна Александровна", applicationDate: "2026-09-13", nameEnglish: "Testova Anna", gender: "Женский", uid: "123", source: "Поиск в интернете"};
  require("node:http").createServer((request, response) => {
    if (request.url === "/styles.css") {
      response.setHeader("Content-Type", "text/css; charset=utf-8"); response.end(stylesSource); return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (request.url === "/card") {
      response.end(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><body style="margin:0;background:white"><form class="student-main-tab"><section class="form-section"><div class="form-section-head"><h3>Обучающийся</h3></div>${render(identity, record)}</section></form></body></html>`); return;
    }
    response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка расположения даты заявки</title><body style="font:14px sans-serif"><p>Тестовая карточка — без доступа к рабочей базе</p><button onclick="document.querySelector('iframe').style.width='980px'">980 px</button><button onclick="document.querySelector('iframe').style.width='740px'">740 px</button><button onclick="document.querySelector('iframe').style.width='390px'">390 px</button><br><iframe title="Тестовая карточка" src="/card" style="width:980px;height:720px;border:1px solid #ddd;margin-top:12px"></iframe></body></html>`);
  }).listen(0, "127.0.0.1", function () { console.log(`Fixture: http://127.0.0.1:${this.address().port}/`); });
}
