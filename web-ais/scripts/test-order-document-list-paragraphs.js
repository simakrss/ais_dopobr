const assert = require("node:assert/strict");
const { buildDocxZip, fillDocxMarkers, readDocxZipEntries } = require("../app-server.js");

const escapeXml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const properties = '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="45"/></w:numPr><w:jc w:val="both"/></w:pPr>';
const runProperties = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr>';
const run = (text) => `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const paragraph = (inner, id = "ABCDEF01") => `<w:p w14:paraId="${id}">${properties}${inner}</w:p>`;
const fieldStart = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>SUBJECT " "/6</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const fieldEnd = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const ordinaryField = '<w:p><w:fldSimple w:instr="SUBJECT &quot; &quot;/2"><w:r><w:t>Старая дата</w:t></w:r></w:fldSimple></w:p>';
const wordText = (xml) => [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join("");

function makeTemplate(fieldName, body) {
  const config = `[Поля\\6]\nИмяПоля=${fieldName}\nФормула==ПолучитьSQLзапрос("SELECT список")\nПозиция=6\n[Поля\\2]\nИмяПоля=Дата\nФормула==[Дата]\nПозиция=2\n`;
  return buildDocxZip([
    { name: "word/document.xml", content: Buffer.from(`<w:document><w:body>${ordinaryField}${body}<w:p><w:r><w:t>Контроль за исполнением</w:t></w:r></w:p></w:body></w:document>`) },
    { name: "docProps/custom.xml", content: Buffer.from(`<Properties xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="Опции1"><vt:lpwstr>${escapeXml(config)}</vt:lpwstr></property></Properties>`) }
  ]);
}

let cases = 0;
for (const name of ["Список", "СписокСвыдачей", "СписокБезВыдачи"]) {
  const marker = `#${name}#`;
  const fixtures = {
    complex: paragraph(fieldStart + run("Старый слушатель") + fieldEnd),
    simple: paragraph(`<w:fldSimple w:instr="SUBJECT &quot; &quot;/6">${run("Старый слушатель")}</w:fldSimple>`),
    marker: paragraph(run(marker)),
    markerInField: paragraph(fieldStart + run(marker) + fieldEnd),
    spanningField: paragraph(fieldStart + run("Старый слушатель")) + paragraph(run("Другой старый слушатель") + fieldEnd, "ABCDEF02"),
    matchingFirstItem: paragraph(fieldStart + run("Первый слушатель") + fieldEnd)
  };
  for (const [kind, fixture] of Object.entries(fixtures)) {
    for (const value of ["Первый слушатель", "Первый слушатель\nВторой слушатель", "\r\nПервый слушатель\r\n\r\nВторой слушатель\u000bТретий & <слушатель>\r\n"]) {
      const template = makeTemplate(name, fixture);
      const original = Buffer.from(template);
      const result = fillDocxMarkers(template, { [name]: value, "Дата": "01.08.2026" });
      const xml = readDocxZipEntries(result).find(entry => entry.name === "word/document.xml").content.toString();
      const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(match => match[0]);
      const list = paragraphs.filter(item => item.includes("<w:numPr>"));
      const lines = value.split(/\r\n|\r|\n|\u000b/).filter(line => line.trim());
      const label = `${name}/${kind}/${lines.length}`;
      assert.deepEqual(list.map(wordText), lines.map(escapeXml), label + ": один слушатель — один непустой пункт");
      for (const item of list) {
        assert.doesNotMatch(item, /w:fldChar|w:fldSimple|w:instrText|w:br\b/, label + ": список не должен оставаться вычисляемым полем Word");
        assert.ok(item.includes(properties), label + ": сохраняются нумерация и отступы");
        assert.ok(item.includes(runProperties), label + ": сохраняется Times New Roman 12 пт");
      }
      const ids = [...xml.matchAll(/w14:paraId="([^"]+)"/g)].map(match => match[1]);
      assert.equal(new Set(ids).size, ids.length, label + ": идентификаторы абзацев уникальны");
      assert.match(xml, /<w:fldSimple[^>]*>[\s\S]*?01\.08\.2026[\s\S]*?<\/w:fldSimple>/u, "Остальные поля Word продолжают заполняться");
      assert.equal(paragraphs.at(-1).includes("Контроль за исполнением"), true);
      assert.deepEqual(template, original, "Исходный шаблон и формулы не изменяются");
      cases += 1;
    }
  }
}
const withSurroundingText = makeTemplate("Список", paragraph(run("До: ") + fieldStart + run("Старый") + fieldEnd + run(" после.")));
const withSurroundingXml = readDocxZipEntries(fillDocxMarkers(withSurroundingText, { "Список": "Первый\nВторой" })).find(entry => entry.name === "word/document.xml").content.toString();
const surroundingList = [...withSurroundingXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(match => match[0]).filter(item => item.includes("<w:numPr>"));
assert.deepEqual(surroundingList.map(wordText), ["До: Первый", "Второй после."], "Текст до и после поля сохраняется один раз");
console.log(`Order document list paragraphs: ${cases + 1} checks passed`);
