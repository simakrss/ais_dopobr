const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeStudentDatabaseDiscountPercent,
  sanitizeStudentDatabaseExportPayload
} = require("../app-server.js");

assert.equal(normalizeStudentDatabaseDiscountPercent(0.5), 50);
assert.equal(normalizeStudentDatabaseDiscountPercent(0.1), 10);
assert.equal(normalizeStudentDatabaseDiscountPercent(0.005), 0.5);
assert.equal(normalizeStudentDatabaseDiscountPercent(50), 50);
assert.equal(normalizeStudentDatabaseDiscountPercent("0,25"), 25);

const payload = sanitizeStudentDatabaseExportPayload({
  students: [{
    id: "student-percent-date",
    uid: "1001",
    name: "Тестовый слушатель",
    discount: 50,
    discountUnit: "percent",
    frdoDate: "2026-12-24"
  }],
  contracts: [],
  directExpenses: [],
  generalExpenses: []
});
assert.equal(payload.students[0].discount, 50);
assert.equal(payload.students[0].frdoDate, "2026-12-24");
assert.equal(payload.students[0].frdoStatus, "2026-12-24");

const syncScript = fs.readFileSync(
  path.join(__dirname, "sync-student-database.ps1"),
  "utf8"
);
assert.match(
  syncScript,
  /if \(\$FieldName -eq "discount"\) \{ return \$number \/ 100\.0 \}/u,
  "Перед записью в процентную ячейку скидка должна преобразовываться в долю."
);
assert.match(syncScript, /\$range\.NumberFormat = "0\.##%"/u);
assert.match(syncScript, /\$range\.NumberFormatLocal = "ДД\.ММ\.ГГГГ"/u);
assert.doesNotMatch(syncScript, /\$range\.NumberFormat = "yyyy-mm-dd"/u);

console.log("Student database percentage and FRDO date format tests passed.");
