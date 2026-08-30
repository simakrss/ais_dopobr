"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";

const {
  formatSystemDocumentsCardPath,
  systemDocumentsPathsEqual,
  sanitizeStudentDatabaseExportPayload,
  normalizeSharedApplicationData,
  normalizeSharedApplicationStatePatch
} = require("../app-server.js");

const studentPhoto = "\\Слушатели\\МаркосянМС\\Документы\\МаркосянМС.jpg";
const employeePhoto = "\\Сотрудники\\ИвановИИ\\Документы\\ИвановИИ.jpg";

assert.equal(
  formatSystemDocumentsCardPath("Слушатели/МаркосянМС/Документы/МаркосянМС.jpg"),
  studentPhoto
);
assert.equal(formatSystemDocumentsCardPath(studentPhoto), studentPhoto);
assert.equal(
  formatSystemDocumentsCardPath("АИС Допобразование/Сотрудники/ИвановИИ/Документы/ИвановИИ.jpg"),
  employeePhoto
);
assert.equal(
  formatSystemDocumentsCardPath("Y:\\АИС Допобразование\\Слушатели\\МаркосянМС\\Документы\\МаркосянМС.jpg"),
  "Y:\\АИС Допобразование\\Слушатели\\МаркосянМС\\Документы\\МаркосянМС.jpg"
);
assert.equal(formatSystemDocumentsCardPath("https://example.test/photo.jpg"), "https://example.test/photo.jpg");
assert.equal(
  systemDocumentsPathsEqual(
    "Слушатели/МаркосянМС/Документы/МаркосянМС.jpg",
    studentPhoto
  ),
  true
);

const exportPayload = sanitizeStudentDatabaseExportPayload({
  students: [{
    id: "student-1",
    uid: "1",
    name: "Маркосян Мария Сергеевна",
    photoPath: "Слушатели/МаркосянМС/Документы/МаркосянМС.jpg"
  }],
  contracts: [{
    id: "contract-1",
    name: "Иванов Иван Иванович",
    photoPath: "Сотрудники/ИвановИИ/Документы/ИвановИИ.jpg"
  }],
  directExpenses: [],
  generalExpenses: []
});
assert.equal(exportPayload.students[0].photoPath, studentPhoto);
assert.equal(exportPayload.contracts[0].photoPath, employeePhoto);

const normalizedState = normalizeSharedApplicationData({
  collections: {
    students: [{ id: "student-1", photoPath: "Слушатели/МаркосянМС/Документы/МаркосянМС.jpg" }],
    contracts: [{ id: "contract-1", photoPath: "Сотрудники/ИвановИИ/Документы/ИвановИИ.jpg" }]
  },
  dictionaries: {}
});
assert.equal(normalizedState.collections.students[0].photoPath, studentPhoto);
assert.equal(normalizedState.collections.contracts[0].photoPath, employeePhoto);

const normalizedPatch = normalizeSharedApplicationStatePatch({
  collections: {
    students: {
      upserts: [{ id: "student-1", photoPath: "Слушатели/МаркосянМС/Документы/МаркосянМС.jpg" }]
    },
    contracts: {
      replace: [{ id: "contract-1", photoPath: "Сотрудники/ИвановИИ/Документы/ИвановИИ.jpg" }]
    }
  }
});
assert.equal(normalizedPatch.collections.students.upserts[0].photoPath, studentPhoto);
assert.equal(normalizedPatch.collections.contracts.replace[0].photoPath, employeePhoto);

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
const helperStart = appSource.indexOf("  function normalizePersonPhotoCardPath");
const helperEnd = appSource.indexOf("\n\n  function isStudentSourcePhotoPath", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Не найден клиентский нормализатор пути фото.");
const helperSource = appSource.slice(helperStart, helperEnd).replace(/^  /gmu, "");
const normalizeClientPath = Function(`${helperSource}\nreturn normalizePersonPhotoCardPath;`)();
assert.equal(
  normalizeClientPath("Слушатели/МаркосянМС/Документы/МаркосянМС.jpg"),
  studentPhoto
);
assert.equal(
  normalizeClientPath("Сотрудники\\ИвановИИ\\Документы\\ИвановИИ.jpg"),
  employeePhoto
);
assert.match(appSource, /photoPath: normalizePersonPhotoCardPath\(student\.photoPath\)/u);
assert.match(appSource, /photoPath: normalizePersonPhotoCardPath\(contract\.photoPath\)/u);
assert.match(appSource, /values\.photoPath = normalizePersonPhotoCardPath\(values\.photoPath\)/u);

console.log("Person photo card path checks passed.");
