const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverPath = path.resolve(__dirname, "..", "app-server.js");
const workerPath = path.resolve(__dirname, "..", "student-import-worker.js");
const syncScriptPath = path.resolve(__dirname, "sync-student-database.ps1");
const {
  assertCommunicationTemplateNamedRangeWorkbookOutput,
  getCommunicationTemplateNamedRangeMismatches,
  parseCommunicationTemplateNamedRangeValues,
  sanitizeStudentDatabaseCommunicationTemplateFields,
  sanitizeStudentDatabaseExportPayload
} = require(serverPath);

function createWorkbook({ values = {}, formulas = {}, names = [] } = {}) {
  const worksheet = {};
  Object.entries(values).forEach(([address, value]) => {
    worksheet[address] = { t: "s", v: value };
    if (Object.prototype.hasOwnProperty.call(formulas, address)) {
      worksheet[address].f = formulas[address];
    }
  });
  return {
    Workbook: { Names: names },
    Sheets: { "Настройки": worksheet }
  };
}

const sourceWorkbook = createWorkbook({
  names: [
    { Name: "ПереченьДокументовДПП", Ref: "'Настройки'!$AR$2" },
    { Name: "ПереченьДокументовДОП", Ref: "'Настройки'!$AR$3" },
    { Name: "АдресАнкеты", Ref: "'Настройки'!$AQ$2" },
    { Name: "СсылкаНаОплату", Ref: "'Настройки'!$AU$3", Sheet: 0 },
    { Name: "СсылкаНаОплатуПродления", Ref: "'Настройки'!$AU$2:$AU$3" },
    { Name: "СсылкиСоцсети", Ref: "'Настройки'!$AF$3" }
  ],
  values: {
    AR2: "ДПП строка 1\rДПП строка 2",
    AR3: "",
    AQ2: "https://survey.example",
    AU3: "local-only",
    AU2: "multi-cell",
    AF3: ""
  },
  formulas: {
    AR2: '"ДПП строка 1"&CHAR(13)&"ДПП строка 2"',
    AR3: '""'
  }
});

assert.deepEqual(parseCommunicationTemplateNamedRangeValues(sourceWorkbook), {
  "ПереченьДокументовДПП": "ДПП строка 1\nДПП строка 2",
  "ПереченьДокументовДОП": "",
  "АдресАнкеты": "https://survey.example",
  "СсылкиСоцсети": ""
});

const fields = [
  {
    name: "ПереченьДокументов",
    formula: "{{если:ДПО}}ДПП 1\r\nДПП 2{{иначе}}{{конец}}"
  },
  { name: "СсылкаАнкеты", formula: "https://survey.new" },
  { name: "СсылкаОплаты", formula: "" },
  { name: "СсылкаОплатыПродления", formula: "https://extend.new" },
  { name: "СсылкиСоцсети", formula: "social\rline" }
];
const sanitized = sanitizeStudentDatabaseCommunicationTemplateFields(fields);
assert.equal(sanitized.communicationTemplateFieldsProvided, true);
assert.deepEqual(sanitized.communicationTemplateNamedRangeValues, {
  "ПереченьДокументовДПП": "ДПП 1\nДПП 2",
  "ПереченьДокументовДОП": "",
  "АдресАнкеты": "https://survey.new",
  "СсылкаНаОплату": "",
  "СсылкаНаОплатуПродления": "https://extend.new",
  "СсылкиСоцсети": "social\nline"
});
assert.deepEqual(sanitizeStudentDatabaseCommunicationTemplateFields(undefined), {
  communicationTemplateFieldsProvided: false,
  communicationTemplateNamedRangeValues: {}
});
assert.throws(
  () => sanitizeStudentDatabaseCommunicationTemplateFields([
    { name: "ЧужоеПоле", formula: "x" }
  ]),
  /не разрешено/u
);
assert.throws(
  () => sanitizeStudentDatabaseCommunicationTemplateFields([
    { name: "СсылкаАнкеты", formula: "x" },
    { name: "ссылкаанкеты", formula: "y" }
  ]),
  /повторно/u
);
assert.throws(
  () => sanitizeStudentDatabaseCommunicationTemplateFields([
    { name: "ПереченьДокументов", formula: "без условных ветвей" }
  ]),
  /должно содержать ветви/u
);
assert.throws(
  () => sanitizeStudentDatabaseCommunicationTemplateFields([
    { name: "СсылкиСоцсети", formula: "bad\u0000value" }
  ]),
  /нулевой символ/u
);
assert.throws(
  () => sanitizeStudentDatabaseCommunicationTemplateFields([
    { name: "СсылкиСоцсети", formula: "x".repeat(32768) }
  ]),
  /32767/u
);

const exportPayload = sanitizeStudentDatabaseExportPayload({
  students: [{ id: "student-1", uid: "1", name: "Тест" }],
  contracts: [],
  directExpenses: [],
  generalExpenses: [],
  communicationTemplateFields: fields
});
assert.equal(exportPayload.communicationTemplateFieldsProvided, true);
assert.deepEqual(
  exportPayload.communicationTemplateNamedRangeValues,
  sanitized.communicationTemplateNamedRangeValues
);

const verificationSource = createWorkbook({
  names: [
    { Name: "ПереченьДокументовДПП", Ref: "Настройки!$AR$2" },
    { Name: "ПереченьДокументовДОП", Ref: "Настройки!$AR$3" },
    { Name: "АдресАнкеты", Ref: "Настройки!$AQ$2" }
  ],
  values: { AR2: "old dpp", AR3: "old dop", AQ2: "old survey" },
  formulas: { AR2: '"old dpp"', AR3: '"old dop"' }
});
const verificationOutput = createWorkbook({
  names: [
    { Name: "ПереченьДокументовДПП", Ref: "Настройки!$AR$2" },
    { Name: "ПереченьДокументовДОП", Ref: "Настройки!$AR$3" },
    { Name: "АдресАнкеты", Ref: "Настройки!$AQ$2" }
  ],
  values: { AR2: "new\rdpp", AR3: "", AQ2: "new survey" },
  formulas: { AR2: '"new"&CHAR(13)&"dpp"', AR3: '""' }
});
const verification = assertCommunicationTemplateNamedRangeWorkbookOutput(
  verificationSource,
  verificationOutput,
  {
    "ПереченьДокументовДПП": "new\ndpp",
    "ПереченьДокументовДОП": "",
    "АдресАнкеты": "new survey",
    "СсылкиСоцсети": "missing in workbook"
  }
);
assert.deepEqual(verification, {
  provided: true,
  requested: 4,
  verified: 3,
  skipped: 1,
  formulaPreserved: 2
});

const formulaLostOutput = createWorkbook({
  names: verificationOutput.Workbook.Names,
  values: { AR2: "new\rdpp", AR3: "", AQ2: "new survey" },
  formulas: { AR3: '""' }
});
assert.throws(
  () => assertCommunicationTemplateNamedRangeWorkbookOutput(
    verificationSource,
    formulaLostOutput,
    { "ПереченьДокументовДПП": "new\ndpp" }
  ),
  /утратил текстовую формулу/u
);
assert.throws(
  () => assertCommunicationTemplateNamedRangeWorkbookOutput(
    verificationSource,
    verificationOutput,
    { "АдресАнкеты": "wrong" }
  ),
  /не совпадает с Web-базой/u
);

assert.deepEqual(
  getCommunicationTemplateNamedRangeMismatches(
    { "АдресАнкеты": "web", "СсылкаНаОплату": "missing" },
    { "адресанкеты": "excel" }
  ),
  ["АдресАнкеты"]
);
assert.deepEqual(
  getCommunicationTemplateNamedRangeMismatches(
    { "АдресАнкеты": "same\nline", "СсылкаНаОплату": "missing" },
    { "АдресАнкеты": "same\rline" }
  ),
  []
);

const serverSource = fs.readFileSync(serverPath, "utf8");
const workerSource = fs.readFileSync(workerPath, "utf8");
const syncScriptSource = fs.readFileSync(syncScriptPath, "utf8");
const psFunctionStart = syncScriptSource.indexOf("function Update-CommunicationTemplateNamedRanges");
const psFunctionEnd = syncScriptSource.indexOf("function Set-ExcelCellValue", psFunctionStart);
assert.ok(psFunctionStart >= 0 && psFunctionEnd > psFunctionStart);
const psFunction = syncScriptSource.slice(psFunctionStart, psFunctionEnd);
assert.doesNotMatch(psFunction, /Set-WorkbookDefinedName|\.Names\.Add/u);
assert.match(psFunction, /CountLarge/u);
assert.match(psFunction, /Test-StaticCommunicationTemplateTextFormula/u);
assert.match(psFunction, /\.Value2\s*=\s*\[string\]\$value/u);
assert.match(psFunction, /\[void\]\$targetRange\.Calculate\(\)/u);
assert.match(syncScriptSource, /CHAR\(13\)/u);
assert.match(syncScriptSource, /8192/u);
assert.match(syncScriptSource, /communicationTemplateNamedRangesSkipped/u);
assert.ok(
  syncScriptSource.indexOf("Update-CommunicationTemplateNamedRanges $workbook $payload")
    < syncScriptSource.lastIndexOf("$workbook.SaveAs($OutputPath, 50)"),
  "Именованные диапазоны должны обновляться до SaveAs"
);
assert.match(serverSource, /assertCommunicationTemplateNamedRangeOutput\([\s\S]*?const downloadOnly/u);
assert.match(workerSource, /workerPayload\.options/u);

console.log("Student database communication-template server tests passed.");
