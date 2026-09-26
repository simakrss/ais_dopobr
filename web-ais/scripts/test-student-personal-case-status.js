const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`  function ${name}(`);
  assert(start >= 0, `Function ${name} was not found`);
  let brace = appSource.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = brace; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1);
    }
  }
  throw new Error(`Function ${name} is incomplete`);
}

const context = {};
vm.runInNewContext(`${extractFunction("getStoredCheckboxValue")}; this.fn = getStoredCheckboxValue;`, context);
const getStoredCheckboxValue = context.fn;

assert.strictEqual(getStoredCheckboxValue("students", "documentsStatus", true), "+");
assert.strictEqual(getStoredCheckboxValue("students", "documentsStatus", false), "");
assert.strictEqual(getStoredCheckboxValue("students", "consentPersonalData", true), "Да");
assert.strictEqual(getStoredCheckboxValue("generalExpenses", "accountingClosed", true), "+");

assert.match(
  appSource,
  /field\("documentsStatus",\s*"Личное дело сформировано",\s*"checkbox"\)/u,
  "The Results tab must contain the personal-case checkbox"
);
assert.match(appSource, /name="documentsStatus"[\s\S]*?value="\+"/u);
assert.match(appSource, /student-personal-case-toggle-card/u);
assert.match(appSource, /getStoredCheckboxValue\("students",\s*item\.key,\s*formData\.has\(item\.key\)\)/u);
assert.match(stylesSource, /\.student-personal-case-toggle-card[\s\S]*?background:\s*#fff7cc/u);
assert.match(stylesSource, /\.student-personal-case-toggle-input:checked\s*\+\s*\.student-personal-case-toggle-card[\s\S]*?background:\s*#dcfce7/u);
assert.match(serverSource, /"Признак оформления":\s*"documentsStatus"/u);

const { sanitizeStudentDatabaseExportPayload } = require(path.join(root, "app-server.js"));
const payload = sanitizeStudentDatabaseExportPayload({
  students: [
    { id: "student-on", uid: "1", name: "Включено", documentsStatus: "+" },
    { id: "student-off", uid: "2", name: "Выключено", documentsStatus: "" }
  ],
  contracts: [],
  directExpenses: [],
  generalExpenses: []
});

assert.strictEqual(payload.studentColumnMap["Признак оформления"], "documentsStatus");
assert.strictEqual(payload.students[0].documentsStatus, "+");
assert.strictEqual(payload.students[1].documentsStatus, "");

console.log("Student personal-case status tests passed.");
