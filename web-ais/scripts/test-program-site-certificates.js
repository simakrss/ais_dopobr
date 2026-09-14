"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const samples = require("../program-site-certificates");
const server = require("../app-server");
const PDF = require("../vendor/pdf-lib.min.js");
const program = {id: "sample-only", name: "Тестовый онлайн-семинар", nameEnglish: "Test online seminar", type: "ПРО",
  hours: 2, webinarDate: "2026-09-30", landingCode: "test_webinar"};
const templatePath = path.resolve(__dirname, "../storage/document-templates/Сертификат ПРО.docx");
async function main() {
  const source = samples.sampleSource(program);
  assert.equal(source["Дата выдачи"], "30.09.2026");
  assert.equal(source["Прогр обуч факт_ENG"], program.nameEnglish);
  assert.equal(source["Email"], "");
  assert.throws(() => samples.sampleSource({...program, nameEnglish: ""}), /английском/);
  const settings = samples.templateSettings({});
  assert.equal(settings.id, samples.TEMPLATE_ID);
  assert.equal(samples.templateSettings({dictionaries: {documentTemplates: [{...settings, templatePath: "custom.docx"}]}}).templatePath, "custom.docx");
  const fields = samples.evaluateFields({fields: [{name: "A", formula: '=#B# & "!"'}, {name: "B", formula: '=[Прогр обуч факт_ENG]'}]}, source, server.evaluateDocumentFormula);
  assert.equal(fields.A, "Test online seminar!");
  assert.throws(() => samples.evaluateFields({fields: [{name: "A", formula: "=#B#"}, {name: "B", formula: "=#A#"}]}, source, server.evaluateDocumentFormula), /Рекурсия/);
  const templateBytes = fs.readFileSync(templatePath);
  let generatedDocx;
  let renderPages = [];
  const pdf = await PDF.PDFDocument.create(); pdf.addPage(); pdf.addPage();
  const services = {
    pdf: PDF,
    loadTemplate: async request => {assert.equal(request.preferLocalTemplate, true); return templateBytes;},
    evaluate: server.evaluateDocumentFormula, applyFormulas: server.applyCustomDocumentPropertyFormulas,
    createQr: server.createDocumentQrCodeImage,
    fill: (...args) => {
      assert.equal(args[1]["ФИО"], "ОБРАЗЕЦ"); assert.equal(args[1]["ФИО_ENG"], "SAMPLE");
      assert.equal(args[1]["РегНомер_ENG"], "SAMPLE");
      assert.equal(args[1]["Прогр обуч факт_ENG"], program.nameEnglish);
      assert.match(args[1]["Прогр обуч факт"], /Тестовый онлайн-семинар/);
      generatedDocx = server.fillDocxMarkers(...args); return generatedDocx;
    },
    convert: async () => Buffer.from(await pdf.save()),
    render: async (bytes, page) => {renderPages.push(page); assert.equal((await PDF.PDFDocument.load(bytes)).getPageCount(), 2); return {pageCount: 2, preview: {mimeType: "image/jpeg", base64: "mock"}};}
  };
  const prepared = await samples.prepare(program, {}, true, services);
  const retry = await samples.prepare(program, {}, true, services);
  assert.equal(prepared.hash, retry.hash);
  const changed = await samples.prepare({...program, nameEnglish: "Different"}, {}, true, services);
  assert.notEqual(prepared.hash, changed.hash);
  const custom = await samples.prepare(program, {dictionaries: {documentTemplates: [{...settings, fields: [{name: "Прогр обуч факт", formula: '="custom"'}]}]}}, true, services);
  assert.notEqual(prepared.hash, custom.hash);
  const override = await samples.prepare(program, {dictionaries: {documentTemplates: [{...settings, sampleUseTemplateDefaults: false,
    fields: [{name: "Прогр обуч факт", formula: '="Custom: " & [Прогр обуч факт]'}, {name: "Прогр обуч факт_ENG", formula: ""}]}]}}, true, {
      ...services, fill: (bytes, values) => {assert.equal(values["Прогр обуч факт"], "Custom: " + program.name); assert.equal(values["Прогр обуч факт_ENG"], program.nameEnglish); return bytes;}
    });
  await override.generate();
  renderPages = [];
  assert.deepEqual((await prepared.generate()).map(image => image.language), ["ru", "en"]);
  assert.deepEqual(renderPages, [1, 2]);
  assert.ok(generatedDocx.length > 100000);
  assert.deepEqual(fs.readFileSync(templatePath), templateBytes, "Retained template never edited");
  const entries = server.readDocxZipEntries(generatedDocx);
  const xml = entries.find(entry => entry.name === "word/document.xml").content.toString();
  assert.match(xml, /ОБРАЗЕЦ/); assert.match(xml, /SAMPLE/);
  assert.match(xml, /Test online seminar/);
  const single = await PDF.PDFDocument.create(); single.addPage();
  await assert.rejects(samples.markSamplePdf(await single.save(), PDF), /две страницы/);
  for (const name of ["word/styles.xml", "word/fontTable.xml", "word/settings.xml"]) {
    const original = server.readDocxZipEntries(templateBytes).find(entry => entry.name === name);
    assert.deepEqual(entries.find(entry => entry.name === name).content, original.content, name + " preserved");
  }
  assert.ok(!fs.readFileSync(path.resolve(__dirname, "../program-site-certificates.js"), "utf8").includes("collections.students"));
  console.log("PASS: RU/EN sample context, constructor template/formulas, date separators, no real student/counter, immutable source, QR, content freshness, two-page guard, watermark, both rendered images");
}
main().catch(error => {console.error(error); process.exitCode = 1;});
