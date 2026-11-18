"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const server = require("../app-server");
const samples = require("../program-site-certificates");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const names = ["СфераДеятельности", "Сфера деятельности"];

function createClientContext(programs) {
  const context = {
    getProgramRows: () => programs,
    findProgramByName: name => programs.find(program => program.name === name),
    resolveContractTemplateAddressSourceKey: () => "",
    resolveContractTemplateFioFormulaValue: () => null,
    resolveContractTemplateDateFormulaValue: () => null,
    contractTemplateSourceFieldMap: {}, contractTemplateSourceFieldNames: names,
    contractTemplateFieldDefaults: []
  };
  vm.createContext(context);
  const functions = ["normalizeProgramName", "normalizeTrainingPlanProgramName", "getTrainingPlanHours",
    "findEducationDocumentProgram", "getContractTemplateRawSourceValue", "getContractTemplateSourceValue",
    "isContractDateSource", "collectContractTemplateSourceValues", "isGetSqlQueryFormula",
    "evaluateContractFormulaFallback", "evaluateContractTemplateField"];
  vm.runInContext(functions.map(name => {
    const match = app.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}$`, "m"));
    assert.ok(match, name); return match[0];
  }).join("\n"), context);
  return context;
}

function main() {
  const program = { id: "p300", name: "Методическая работа (300 ч)", shortName: "Методическая работа", hours: 300,
    type: "ППП", qualification: "Методист", activityScope: "  Предметно-методическая деятельность в высшем образовании  " };
  const other = { ...program, id: "p72", name: "Методическая работа (72 ч)", hours: 72, type: "КПК", activityScope: "Другая сфера" };
  const programs = [other, program];
  const c = createClientContext(programs);
  const record = { program: program.name, hours: 300, qualification: "Квалификация слушателя" };
  const expected = program.activityScope.trim();
  const before = JSON.stringify({ record, programs });
  for (const name of names) {
    assert.equal(c.getContractTemplateRawSourceValue(name, record), expected);
    assert.equal(c.collectContractTemplateSourceValues(record)[name], expected);
    assert.equal(c.evaluateContractTemplateField({ name, formula: `=[${name}]` }, record, {}), expected);
    assert.equal(c.evaluateContractTemplateField({ name, formula: '=ПолучитьSQLзапрос("SELECT [Сфера деятельности] FROM [Реестр программ$]")' }, record, {}), expected);
    assert.equal(c.getContractTemplateRawSourceValue(name, { ...record, program: program.shortName }), expected, "Choose the matching hour variant");
    assert.equal(c.getContractTemplateRawSourceValue(name, { ...record, programId: program.id, program: "Старое название" }), expected, "Explicit program ID survives renaming");
    assert.equal(c.getContractTemplateRawSourceValue(name, { program: program.shortName }), "", "Ambiguous variants must not borrow an arbitrary scope");
    assert.equal(c.getContractTemplateRawSourceValue(name, { ...record, program: "Нет такой программы" }), "");
    assert.equal(c.getContractTemplateRawSourceValue(name, { ...record, workflowSourceValues: { [name]: "Явное значение" } }), "Явное значение");
    assert.equal(server.evaluateDocumentFormula(`=[${name}]`, { fieldValues: {}, sourceValues: c.collectContractTemplateSourceValues(record) }), expected);
  }
  assert.equal(c.getContractTemplateRawSourceValue("Квалификация", record), record.qualification, "Qualification is a separate field");
  assert.equal(server.evaluateDocumentFormula('="Моя сфера"', { fieldValues: {}, sourceValues: c.collectContractTemplateSourceValues(record) }), "Моя сфера", "Explicit custom formulas are preserved");
  assert.equal(JSON.stringify({ record, programs }), before, "Source records are never changed");
  for (const empty of [undefined, null, "", "   "]) {
    const blank = createClientContext([{ ...program, activityScope: empty }]);
    assert.equal(blank.getContractTemplateRawSourceValue(names[0], record), "", "Never replace an empty scope with qualification or program type");
  }

  // Exercise retained Word formulas and actual diploma markers, without saving a real document or changing a template.
  const bytes = fs.readFileSync(path.join(root, "storage/document-templates/Диплом о переподготовке_v1.docx"));
  const original = Buffer.from(bytes);
  const source = { ...c.collectContractTemplateSourceValues(record), "Квалификация": "QUALIFICATION_ONLY", "УчебныйПлан": "Модуль\t300\tЗачтено" };
  const values = server.applyCustomDocumentPropertyFormulas(bytes, { "СфераДеятельности": "", "Квалификация": "" }, source);
  assert.equal(values["СфераДеятельности"], expected, "Retained SQL formula uses the correct source");
  assert.equal(values["Квалификация"], "QUALIFICATION_ONLY");
  const output = server.fillDocxMarkers(bytes, values);
  const entries = server.readDocxZipEntries(output);
  const xml = entries.find(entry => entry.name === "word/document.xml").content.toString();
  assert.ok(xml.includes(expected), "The diploma itself contains the scope");
  assert.ok(xml.includes("QUALIFICATION_ONLY"), "The qualification remains in its own field");
  const trainingPlanRow = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
    .map(match => match[0])
    .find(rowXml => rowXml.includes("Модуль"));
  assert.ok(trainingPlanRow, "The generated diploma contains a training-plan row");
  const trainingPlanCells = [...trainingPlanRow.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
    .map(match => match[0]);
  const numberCell = trainingPlanCells[0] || "";
  assert.match(numberCell, /<w:vAlign\b[^>]*w:val="center"/u, "The number cell keeps vertical centering from the template");
  assert.match(numberCell, /<w:jc\b[^>]*w:val="center"/u, "The number remains horizontally centered");
  assert.match(numberCell, /<w:t\b[^>]*>1\.<\/w:t>/u, "The number is written as ordinary centered text");
  assert.doesNotMatch(numberCell, /<w:numPr\b/u, "Automatic list labels must not shift the visible number above the cell centre");
  assert.doesNotMatch(numberCell, /<w:ind\b/u, "The former list indentation is removed with automatic numbering");
  for (const name of ["word/styles.xml", "word/fontTable.xml", "word/settings.xml"]) {
    assert.deepEqual(entries.find(entry => entry.name === name).content, server.readDocxZipEntries(bytes).find(entry => entry.name === name).content);
  }
  assert.deepEqual(bytes, original);

  for (const type of ["ППП", "КПК", "ДОП", "ПРО"]) {
    const sampleProgram = { ...program, type, nameEnglish: "Sample program", siteSampleDate: "2026-09-23", webinarDate: "2026-09-23",
      landingCode: "sample_scope", siteTrainingPlan: [{ discipline: "Модуль", totalHours: 300 }] };
    for (const name of names) {
      assert.equal(samples.sampleSource(sampleProgram)[name], expected, type);
      assert.equal(samples.sampleSource({ ...sampleProgram, activityScope: "" })[name], "", "Sample must not substitute a qualification");
    }
  }
  console.log("Education activity scope: correct program field, aliases/SQL/formulas, IDs/hour variants, no qualification fallback, retained diploma and all sample types: OK");
}

if (require.main === module) main();
module.exports = { createClientContext };
