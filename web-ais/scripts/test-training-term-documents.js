const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  applyCustomDocumentPropertyFormulas,
  evaluateDocumentFormula,
  fillDocxMarkers,
  readDocxZipEntries
} = require("../app-server.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Не найден блок: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Не найден конец блока: ${endMarker}`);
  return source.slice(start, end);
}

assert.match(appSource, /trainingExtension:\s*"Документы\/Заявление\+доп\. согл_продление обучения\.docx"/u);
assert.match(appSource, /trainingReduction:\s*"Документы\/Заявление\+доп\. согл_сокращение обучения\.docx"/u);
assert.match(appSource, /documentKind:\s*"trainingExtension"/u);
assert.match(appSource, /documentKind:\s*"trainingReduction"/u);
assert.match(appSource, /id:\s*trainingExtensionDocumentTemplateId[\s\S]*?useCustomDocumentProperties:\s*"1"[\s\S]*?documentKind:\s*"trainingExtension"/u);
assert.match(appSource, /id:\s*trainingReductionDocumentTemplateId[\s\S]*?useCustomDocumentProperties:\s*"1"[\s\S]*?documentKind:\s*"trainingReduction"/u);
assert.match(appSource, /\[trainingExtensionDocumentTemplateId,\s*trainingReductionDocumentTemplateId\][\s\S]*?existing\.useCustomDocumentProperties\s*=\s*"1"/u);
assert.match(appSource, /"Продленная дата окончания обучения":\s*"extendedEndDate"/u);
assert.match(appSource, /data-document-context-kind="\$\{escapeAttr\(documentKind\)\}"/u);

const ordersRow = appSource.match(/<div class="orders-sdo-contract-document-row">([\s\S]*?)<\/div>/u)?.[1] || "";
assert.ok(ordersRow.indexOf('"trainingExtension"') >= 0, "Кнопка продления отсутствует в строке документов.");
assert.ok(ordersRow.indexOf('"trainingReduction"') > ordersRow.indexOf('"trainingExtension"'), "Кнопка сокращения должна идти после продления.");
assert.ok(ordersRow.indexOf("renderStudentContractButton") > ordersRow.indexOf('"trainingReduction"'), "Кнопка договора должна быть последней.");

assert.match(appSource, /open-student-training-extension-document'\]"\)\?\.addEventListener\("click", openStudentTrainingExtensionDocument\)/u);
assert.match(appSource, /open-student-training-reduction-document'\]"\)\?\.addEventListener\("click", openStudentTrainingReductionDocument\)/u);
assert.match(appSource, /function bindStudentDocumentActionMenus\(\)[\s\S]*?querySelectorAll\("\[data-document-context-kind\]"\)/u);
assert.match(stylesSource, /\.orders-sdo-contract-document-row\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?padding-left:\s*0;/u);

assert.equal(
  evaluateDocumentFormula(
    `=ТЕКСТ(ПСТР([Продленная дата окончания обучения];1;10);"ДД.ММ.ГГГГ")`,
    {
      fieldValues: {},
      sourceValues: { "Продленная дата окончания обучения": "2026-09-30" }
    }
  ),
  "30.09.2026"
);

const emailDateFormulaHelpers = new Function(`
  const getContractTemplateRawSourceValue = (name, record) => record[name] ?? "";
  const formatContractDate = (value) => {
    const text = String(value || "").trim();
    const iso = /^(\\d{4})-(\\d{2})-(\\d{2})/u.exec(text);
    if (iso) return [iso[3], iso[2], iso[1]].join(".");
    if (/^\\d{2}\\.\\d{2}\\.\\d{4}$/u.test(text)) return text;
    const date = value instanceof Date ? value : new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return [
      String(date.getDate()).padStart(2, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getFullYear())
    ].join(".");
  };
  ${sourceBlock(
    appSource,
    "function resolveContractTemplateDateFormulaValue(",
    "function evaluateContractTemplateField("
  )}
  return { resolveContractTemplateDateFormulaValue };
`)();

assert.deepEqual(
  emailDateFormulaHelpers.resolveContractTemplateDateFormulaValue(
    `=ТЕКСТ(ПСТР([Продленная дата окончания обучения];1;8);"ДД.ММ.ГГГГ")`,
    { "Продленная дата окончания обучения": "2026-09-30" }
  ),
  { matched: true, value: "30.09.2026" }
);
assert.deepEqual(
  emailDateFormulaHelpers.resolveContractTemplateDateFormulaValue(
    `=ТЕКСТ(ПСТР([Продленная дата окончания обучения];1;10);"ДД.ММ.ГГГГ")`,
    { "Продленная дата окончания обучения": "2026-09-30" }
  ),
  { matched: true, value: "30.09.2026" }
);
assert.deepEqual(
  emailDateFormulaHelpers.resolveContractTemplateDateFormulaValue(
    `=ТЕКСТ(ТДАТА();"ДД.ММ.ГГГГ")  //=ТЕКСТ(ПСТР([Дата окончания обучения];1;10);"ДД.ММ.ГГГГ")`,
    {},
    new Date(2026, 7, 27)
  ),
  { matched: true, value: "27.08.2026" }
);

const emailMarkerHelpers = new Function(`
  ${sourceBlock(
    appSource,
    "function applyDocumentEmailTemplateMarkers(",
    "function getProgramEducationEmailMessageTemplate("
  )}
  return { applyDocumentEmailTemplateMarkers };
`)();
const resolvedExtensionDate = emailDateFormulaHelpers.resolveContractTemplateDateFormulaValue(
  `=ТЕКСТ(ПСТР([Продленная дата окончания обучения];1;8);"ДД.ММ.ГГГГ")`,
  { "Продленная дата окончания обучения": "2026-09-30" }
).value;
const extensionEmailMessage = emailMarkerHelpers.applyDocumentEmailTemplateMarkers(
  "Продление обучения до #Продленная дата окончания обучения#.",
  { "Продленная дата окончания обучения": resolvedExtensionDate }
);
assert.equal(extensionEmailMessage, "Продление обучения до 30.09.2026.");
assert.doesNotMatch(extensionEmailMessage, /ТЕКСТ|ПСТР/u);

const sourceFiles = [
  "Y:/АИС Допобразование/Документы/Заявление+доп. согл_продление обучения.docx",
  "Y:/АИС Допобразование/Документы/Заявление+доп. согл_сокращение обучения.docx"
];
const sampleFieldValues = {
  Email: "student@example.com",
  "N Договора": "606-01",
  "Адрес места регистрации": "644000, г. Омск",
  "Вид курсов": "Программа повышения квалификации (72 ч.)",
  "Дата рождения_обуч": "01.01.1990",
  ДатаДоговора: "26.08.2026",
  ДатаПодачи: "26.08.2026",
  ИО: "Иван Иванович",
  Пасп_Обуч_Дата: "01.01.2020",
  Пасп_Обуч_Кем: "ОВД России",
  Паспорт_обуч: "1234 567890",
  "Продленная дата окончания обучения": "30.09.2026",
  ПутьСохр: "",
  СрокПо: "26.08.2026",
  Тел_обуч: "+7 900 000-00-00",
  ФИО_обуч: "Иванов Иван Иванович",
  ФИО_обуч_род: "Иванова Ивана Ивановича"
};
sourceFiles.filter((filePath) => fs.existsSync(filePath)).forEach((filePath) => {
  const assistantValues = applyCustomDocumentPropertyFormulas(
    fs.readFileSync(filePath),
    sampleFieldValues,
    {
      ...sampleFieldValues,
      "Дата окончания обучения": "15.09.2026"
    }
  );
  assert.equal(assistantValues["Продленная дата окончания обучения"], "30.09.2026");
  if (filePath.includes("продление")) {
    assert.match(assistantValues.СрокПо, /^\d{2}\.\d{2}\.\d{4}$/u);
    assert.doesNotMatch(assistantValues.СрокПо, /ТЕКСТ|\/\//u);
  }
  if (filePath.includes("сокращение")) {
    assert.match(assistantValues.ДатаПодачи, /^\d{2}\.\d{2}\.\d{4}$/u);
  }
  const generated = fillDocxMarkers(fs.readFileSync(filePath), sampleFieldValues);
  assert.equal(generated.subarray(0, 2).toString("ascii"), "PK");
  const entries = readDocxZipEntries(generated);
  assert.ok(entries.some((entry) => entry.name === "word/document.xml"));
  const wordXml = entries
    .filter((entry) => /^word\/.+\.xml$/iu.test(entry.name))
    .map((entry) => entry.content.toString("utf8"))
    .join("\n");
  assert.match(wordXml, /30\.09\.2026/u);
});

console.log("Проверка документов продления и сокращения обучения пройдена.");
