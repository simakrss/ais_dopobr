const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  applyEducationCostDiscountStatement,
  buildDocxZip,
  fillDocxMarkers,
  formatEducationCostDiscountPercent,
  readDocxZipEntries,
  resolveEducationCostDiscountPercent
} = require("../app-server.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const extractWordText = (xml) => [...String(xml || "").matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
  .map((match) => match[1])
  .join("");

assert.match(appSource, /"Скидка", "Осн# скидки"/u, "Скидка отсутствует в источниках конструктора документов.");
assert.match(appSource, /"Скидка": "discount"/u, "Поле скидки слушателя не связано с источником документа.");
assert.match(
  appSource,
  /normalized === "Скидка"\) return getContractDocumentDiscountPercent\(record\)/u,
  "Процент скидки не нормализуется перед генерацией документа."
);
assert.match(appSource, /describedPercent - storedPercent \* 100/u, "Старые значения 1/100 не исправляются при генерации.");
assert.match(
  serverSource,
  /outputFieldValues\["Скидка"\] = resolveEducationCostDiscountPercent\([\s\S]*?sourceValues\["Осн# скидки"\]/u,
  "Процент и основание скидки не передаются в итоговый DOCX."
);

assert.equal(formatEducationCostDiscountPercent("15"), "15");
assert.equal(formatEducationCostDiscountPercent("12.50%"), "12,5");
assert.equal(formatEducationCostDiscountPercent(" 7,25 % "), "7,25");
assert.equal(formatEducationCostDiscountPercent(0), "");
assert.equal(formatEducationCostDiscountPercent(101), "");
assert.equal(resolveEducationCostDiscountPercent(50, "Итого 50%"), "50");
assert.equal(resolveEducationCostDiscountPercent(1, "Итого 100%"), "100");
assert.equal(resolveEducationCostDiscountPercent("", "Итого 25%"), "25");
assert.equal(resolveEducationCostDiscountPercent(30, "Итого 40%"), "30");

const originalSentence = "Прошу предоставить скидку на обучение";
const expectedSentence = "Прошу предоставить скидку в размере 15 % на обучение";
const statementXml = [
  "<w:document>",
  "<w:p><w:r><w:t>Заявление о снижении стоимости образовательных услуг</w:t></w:r></w:p>",
  `<w:p><w:r><w:t>${originalSentence}</w:t></w:r></w:p>`,
  "</w:document>"
].join("");
assert.match(applyEducationCostDiscountStatement(statementXml, 15), new RegExp(expectedSentence, "u"));
assert.match(applyEducationCostDiscountStatement(statementXml, ""), new RegExp(originalSentence, "u"));
assert.equal(
  (applyEducationCostDiscountStatement(statementXml, 15).match(/в размере/gu) || []).length,
  1,
  "Процент скидки не должен добавляться повторно."
);

const splitStatementXml = [
  "<w:document>",
  "<w:p><w:r><w:t>Заявление о снижении стоимости</w:t></w:r><w:r><w:t> образовательных услуг</w:t></w:r></w:p>",
  "<w:p><w:r><w:t>Прошу предоставить </w:t></w:r><w:r><w:t>скидку на </w:t></w:r><w:r><w:t>обучение</w:t></w:r></w:p>",
  "<w:p><w:r><w:t>Другой маркер #Скидка#</w:t></w:r></w:p>",
  "</w:document>"
].join("");
const splitStatementResult = applyEducationCostDiscountStatement(splitStatementXml, 15);
assert.match(splitStatementResult, /Прошу предоставить скидку в размере 15 % на обучение/u);
assert.match(splitStatementResult, /Другой маркер #Скидка#/u, "Посторонний маркер не должен отключать вставку в заявление.");

const splitMarkerXml = statementXml.replace(
  originalSentence,
  "Прошу предоставить скидку в размере #Скидка# % на обучение"
).replace("#Скидка#", "#Скид</w:t></w:r><w:r><w:t>ка#");
assert.match(
  extractWordText(applyEducationCostDiscountStatement(splitMarkerXml, "7,5")),
  /Прошу предоставить скидку в размере 7,5 % на обучение/u,
  "Маркер процента должен обрабатываться даже после разделения Word на несколько runs."
);

const portableTemplatePath = path.join(root, "storage", "document-templates", "employee-contract-general-no-stamp.docx");
const portableEntries = readDocxZipEntries(fs.readFileSync(portableTemplatePath));
const portableDocument = portableEntries.find((entry) => entry.name === "word/document.xml");
assert.ok(portableDocument, "В переносимом DOCX-тесте отсутствует word/document.xml.");
portableDocument.content = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:r><w:t>Заявление о снижении стоимости образовательных услуг</w:t></w:r></w:p>
    <w:p><w:r><w:t>Прошу предоставить </w:t></w:r><w:r><w:t>скидку на обучение</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body></w:document>`,
  "utf8"
);
const portableGenerated = fillDocxMarkers(buildDocxZip(portableEntries), { "Скидка": "22,5" });
const portableGeneratedXml = readDocxZipEntries(portableGenerated)
  .find((entry) => entry.name === "word/document.xml")
  ?.content.toString("utf8") || "";
assert.match(portableGeneratedXml, /Прошу предоставить скидку в размере 22,5 % на обучение/u);

const templatePaths = [
  "Y:/АИС Допобразование/Документы/Заявление+договор_ДПП (повыш. квалиф. и профпереп.).docx",
  "Y:/АИС Допобразование/Документы/Заявление_ДПП (повыш. квалиф. и профпереп.).docx"
];
templatePaths.filter((templatePath) => fs.existsSync(templatePath)).forEach((templatePath) => {
  const templateBytes = fs.readFileSync(templatePath);
  const generated = fillDocxMarkers(templateBytes, { "Скидка": "12,5" });
  const generatedXml = readDocxZipEntries(generated)
    .filter((entry) => /^word\/.+\.xml$/iu.test(entry.name))
    .map((entry) => entry.content.toString("utf8"))
    .join("\n");
  assert.match(
    generatedXml,
    /Прошу предоставить скидку в размере 12,5 % на обучение/u,
    "Процент скидки не появился в действующем шаблоне заявления."
  );

  const markerEntries = readDocxZipEntries(templateBytes);
  markerEntries.forEach((entry) => {
    if (!/^word\/.+\.xml$/iu.test(entry.name)) return;
    entry.content = Buffer.from(
      entry.content.toString("utf8").replace(
        originalSentence,
        "Прошу предоставить скидку в размере #Скидка# % на обучение"
      ),
      "utf8"
    );
  });
  const markerGenerated = fillDocxMarkers(buildDocxZip(markerEntries), { "Скидка": "12,5" });
  const markerXml = readDocxZipEntries(markerGenerated)
    .filter((entry) => /^word\/.+\.xml$/iu.test(entry.name))
    .map((entry) => entry.content.toString("utf8"))
    .join("\n");
  assert.match(markerXml, /Прошу предоставить скидку в размере 12,5 % на обучение/u);
  assert.doesNotMatch(markerXml, /#Скидка#/u);
});

console.log("Проверка процента скидки в заявлении пройдена.");
