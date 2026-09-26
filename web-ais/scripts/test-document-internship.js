"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const server = require("../app-server.js");
const escapeXml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const runStyle = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr>';
const run = (value) => `<w:r>${runStyle}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
const readXml = (bytes) => server.readDocxZipEntries(bytes).find((entry) => entry.name === "word/document.xml").content.toString();
const paragraphText = (xml) => [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join("");
const formula = '=ЕСЛИ([Стажировка]="+";"со стажировкой";"НЕ ДОЛЖНО ПОЯВИТЬСЯ")';
const unchecked = [undefined, null, "", false, 0, "0", "false", "off", "нет", "не", "ложь"];
const checked = ["+", true, 1, "1", "true", "Да", "on"];
let cases = 0;

function makeTemplate(kind, expression = formula) {
  const config = `[Поля\\18]\nИмяПоля=Стажировка\nФормула=${expression}\nПозиция=13\nСкрытьПустые=0\n`;
  const field = kind === "simple"
    ? `<w:fldSimple w:instr="SUBJECT &quot;Старый результат&quot;/18">${run("Старый результат")}</w:fldSimple>`
    : kind === "marker" ? run("#Стажировка#")
      : `<w:r>${runStyle}<w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>SUBJECT "Старый результат"/18</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("Старый результат")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  return server.buildDocxZip([
    { name: "word/document.xml", content: Buffer.from(`<w:document><w:body><w:p>${run("Обучение ")}${field}${run(" завершено.")}</w:p><w:p>${run("Итоговая аттестация")}</w:p></w:body></w:document>`) },
    { name: "docProps/core.xml", content: Buffer.from('<cp:coreProperties><dc:subject>Итоговая аттестация</dc:subject></cp:coreProperties>') },
    { name: "docProps/custom.xml", content: Buffer.from(`<Properties><property name="Опции1"><vt:lpwstr>${escapeXml(config)}</vt:lpwstr></property><property name="Связанное поле"><vt:lpwstr>${escapeXml('="#Стажировка#"')}</vt:lpwstr></property></Properties>`) }
  ]);
}

for (const kind of ["complex", "simple", "marker"]) {
  for (const flag of [...unchecked, ...checked]) {
    const template = makeTemplate(kind);
    const original = Buffer.from(template);
    const sourceValues = { "Стажировка": flag };
    const values = server.applyCustomDocumentPropertyFormulas(template, { "Стажировка": "Старый результат" }, sourceValues);
    assert.equal(sourceValues["Стажировка"], flag, "Never mutate source data");
    const expected = checked.includes(flag) ? "со стажировкой" : "";
    assert.equal(values["Стажировка"], expected, `${kind}/${flag}: checkbox controls formula`);
    assert.equal(values["Связанное поле"], expected, "Dependent fields see the final, not stale, value");
    const output = server.fillDocxMarkers(template, values);
    const paragraphs = [...readXml(output).matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
    assert.equal(paragraphText(paragraphs[0]), `Обучение ${expected} завершено.`);
    assert.doesNotMatch(paragraphs[0], /w:fldChar|w:fldSimple|w:instrText|Итоговая|Старый|НЕ ДОЛЖНО/u, "No live Word field can overwrite the result during PDF conversion");
    assert.ok(paragraphs[0].includes(runStyle), "Template font is preserved");
    assert.equal(paragraphText(paragraphs[1]), "Итоговая аттестация", "Do not remove actual final attestation");
    assert.deepEqual(template, original, "Never modify source templates/formulas");
    cases++;
  }
  for (const expression of ['="Практика по программе: " & [Прогр обуч факт]', '=ЕСЛИ([Стажировка]="+";"";"ошибка")']) {
    const template = makeTemplate(kind, expression);
    const values = server.applyCustomDocumentPropertyFormulas(template, {}, { "Стажировка": "+", "Прогр обуч факт": "Тестовая программа" });
    assert.equal(values["Стажировка"], expression.includes("Практика") ? "Практика по программе: Тестовая программа" : "", "Use the actual configured formula, not a hardcoded phrase");
    cases++;
  }
}

// Exercise both real education templates, including all alternative Word text boxes.
for (const name of ["Удостоверение о повышении квалификации_v1.docx", "Диплом о переподготовке_v1.docx"]) {
  const template = fs.readFileSync(path.resolve(__dirname, "../storage/document-templates", name));
  const original = Buffer.from(template);
  for (const flag of ["", "+"]) {
    const values = server.applyCustomDocumentPropertyFormulas(template, { "УчебныйПлан": "Основы программы\t34\tЗачтено\nИтоговая аттестация\t2\tзачтено" }, { "Стажировка": flag });
    const output = server.fillDocxMarkers(template, values);
    const xml = readXml(output);
    if (name.startsWith("Удостоверение")) {
      assert.equal(values["Стажировка"], flag ? "со стажировкой" : "");
      const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match) => match[0]).filter((item) => /прошел\(а\)/.test(paragraphText(item)));
      assert.ok(paragraphs.length > 0);
      paragraphs.forEach((paragraph) => {
        assert.doesNotMatch(paragraph, /w:fldChar|w:fldSimple|w:instrText|Итоговая аттестация/u);
        assert.equal(paragraphText(paragraph).includes("со стажировкой"), Boolean(flag));
      });
    } else {
      assert.equal(values["Стажировка"], undefined, "Do not invent an internship field absent from this diploma template");
    }
    assert.match(xml, /Итоговая аттестация/u, "The training plan keeps final attestation");
    assert.deepEqual(template, original);
    cases++;
  }
}

// The client must also suppress an unchecked field before previews/email/file names.
const appSource = fs.readFileSync(path.resolve(__dirname, "../app.js"), "utf8");
function extract(start, end) {
  const from = appSource.indexOf(start), to = appSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return appSource.slice(from, to);
}
const context = vm.createContext({});
vm.runInContext(extract("  function isChecked(", "  function getStoredCheckboxValue(") + extract("  function evaluateContractTemplateField(", "  function evaluateContractFormulaFallback("), context);
for (const internship of unchecked.filter((value) => value !== "ложь")) {
  assert.equal(context.evaluateContractTemplateField({ name: "Стажировка", formula: '=1/0' }, { internship }, {}), "");
  cases++;
}
console.log(`Document internship: ${cases} checks passed (checkbox, formulas, Word fields, certificate and diploma).`);
