"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";
const server = require("../app-server.js");
const serverSource = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const escapeXml = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const photoPath = "\\Сотрудники\\Тестовый сотрудник\\Фото.png";
const image = server.createDocumentQrCodeImage("Synthetic image fixture");
const run = text => `<w:r><w:t>${escapeXml(text)}</w:t></w:r>`;
function template(properties = {}, indexed = false) {
  const content = indexed
    ? `<w:fldSimple w:instr="SUBJECT &quot;cached&quot;/1">${run("cached")}</w:fldSimple><w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/></wp:inline></w:drawing></w:r>`
    : run("#Фото# | #Картинка# | #ПутьСохр# | #QRкод#");
  return server.buildDocxZip([
    { name: "[Content_Types].xml", content: Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>') },
    { name: "word/_rels/document.xml.rels", content: Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>') },
    { name: "word/document.xml", content: Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${content}</w:p></w:body></w:document>`) },
    { name: "docProps/custom.xml", content: Buffer.from(`<Properties>${Object.entries(properties).map(([name, value]) => `<property name="${escapeXml(name)}"><vt:lpwstr>${escapeXml(value)}</vt:lpwstr></property>`).join("")}</Properties>`) }
  ]);
}
const assistant = formula => `[Поля\\1]\nИмяПоля=Фото\nПозиция=1\nФормула=${formula}\n`;
const xml = bytes => server.readDocxZipEntries(bytes).find(entry => entry.name === "word/document.xml").content.toString();
function render(bytes, resolved) {
  const values = { ...resolved.fieldValues };
  const images = {};
  for (const [name, source] of Object.entries(resolved.imageSources)) {
    images[name] = source ? image : null;
    values[name] = "";
  }
  return xml(server.fillDocxMarkers(bytes, values, images, null, null, { clearImageFields: resolved.clearImageFields }));
}
function resolve(formula, { name = "Фото", properties = {}, custom = false, values = {} } = {}) {
  const bytes = template(properties);
  const source = { Фото: photoPath };
  let fields = { Фото: photoPath, ПутьСохр: photoPath, ...values };
  if (custom) fields = server.applyCustomDocumentPropertyFormulas(bytes, fields, source);
  return server.resolveDocumentImageFields(bytes, fields, source, [{ name, formula }], custom);
}
const plainContext = { sourceValues: { Фото: photoPath }, fieldValues: { Фото: "overridden output" } };
assert.equal(server.evaluateDocumentFormula("=[Фото]", plainContext), photoPath);
assert.equal(server.evaluateDocumentFormula('="Файл: " & [Фото]', plainContext), `Файл: ${photoPath}`);
assert.equal(server.evaluateDocumentFormula('="[Фото]"', plainContext), photoPath);
assert.equal(server.evaluateDocumentFormula("=#Фото#", plainContext), "overridden output");
assert.equal(server.evaluateDocumentFormula("=ИЗОБРАЖЕНИЕ([Фото])", plainContext), photoPath, "Ordinary formula consumers still receive a string");
for (const formula of ["=[Фото]", "=ПутьДокумента(1) & [Фото]", '="ИЗОБРАЖЕНИЕ([Фото])"', '=[Фото] // ИЗОБРАЖЕНИЕ([Фото])']) {
  const result = resolve(formula);
  assert.deepEqual(result.imageSources, {});
  const output = render(template(), result);
  assert.ok(output.includes(photoPath));
  assert.doesNotMatch(output, /<w:drawing/);
  assert.equal(result.fieldValues.ПутьСохр, photoPath);
}
for (const name of ["Фото", "Картинка"]) {
  for (const formula of ["=ИЗОБРАЖЕНИЕ([Фото])", "=Изображение (ПутьДокумента(1) & [Фото])", '=ЕСЛИ(ИСТИНА;ИЗОБРАЖЕНИЕ([Фото]);"")', "=ИЗОБРАЖЕНИЕ(#ПутьСохр#)"]) {
    const result = resolve(formula, { name });
    assert.deepEqual(result.imageSources, { [name]: photoPath });
    assert.match(render(template(), result), /<w:drawing/);
  }
}
for (const formula of ['=ЕСЛИ(ЛОЖЬ;ИЗОБРАЖЕНИЕ([Фото]);[Фото])', '=ЛЕВСИМВ(ИЗОБРАЖЕНИЕ([Фото]);2)']) {
  assert.deepEqual(resolve(formula).imageSources, {}, "Only an image-valued result inserts a picture");
}
assert.deepEqual(resolve('=ИЗОБРАЖЕНИЕ("")').imageSources, { Фото: "" });
assert.deepEqual(resolve('=ИЗОБРАЖЕНИЕ("another.png")').imageSources, { Фото: "another.png" }, "Load the formula argument, not the record's photo");
for (const properties of [{ Фото: "=[Фото]" }, { Опции1: assistant("=[Фото]") }]) {
  const result = resolve("=ИЗОБРАЖЕНИЕ([Фото])", { custom: true, properties });
  assert.deepEqual(result.imageSources, {}, "Current template path formula overrides the constructor's old image default");
  assert.equal(result.fieldValues.Фото, photoPath);
}
for (const properties of [{ Фото: "=ИЗОБРАЖЕНИЕ([Фото])" }, { Опции1: assistant("=ИЗОБРАЖЕНИЕ([Фото])") }]) {
  assert.deepEqual(resolve("=[Фото]", { custom: true, properties }).imageSources, { Фото: photoPath });
}
for (const formula of ["=[Фото]", '=ЕСЛИ(ЛОЖЬ;ИЗОБРАЖЕНИЕ([Фото]);[Фото])', '=ЕСЛИ(ЛОЖЬ;ИЗОБРАЖЕНИЕ([Фото]);"")']) {
  const bytes = template({ Опции1: assistant(formula) }, true);
  const values = server.applyCustomDocumentPropertyFormulas(bytes, { Фото: photoPath }, { Фото: photoPath });
  const result = server.resolveDocumentImageFields(bytes, values, { Фото: photoPath }, [], true);
  const output = render(bytes, result);
  assert.doesNotMatch(output, /<w:drawing/, "A cached Assistant photo must not survive a text/empty formula");
  if (values.Фото) assert.ok(output.includes(photoPath));
}
const indexedImage = template({ Опции1: assistant("=ИЗОБРАЖЕНИЕ([Фото])") }, true);
assert.match(render(indexedImage, server.resolveDocumentImageFields(indexedImage, { Фото: photoPath }, { Фото: photoPath }, [], true)), /r:embed="rId/);

function extractHandler() {
  const start = serverSource.indexOf("async function handleContractDocument(");
  const end = serverSource.indexOf("\nasync function ", start + 1);
  return serverSource.slice(start, end);
}
async function main() {
  const loads = [], conversions = [];
  let response, preview, bytes = template();
  const runtime = {
    ...server, Buffer,
    readJsonBody: async req => req.body,
    throwIfDocumentGenerationCancelled: () => {},
    documentWorkflow: { getGenerationDateValues: () => ({}), getDefinition: () => null },
    loadTemplateBytesForRequest: async () => bytes,
    prepareAdditionalDocumentSaveTargets: () => [],
    loadContractPhoto: async fields => { loads.push(fields.Фото); return fields.Фото === "missing.png" ? null : image; },
    normalizeGeneratedDocumentFormat: value => value || "docx",
    safeDocumentFileName: (name, format) => `${name}.${format}`,
    convertDocxBytesToPdf: async docx => { conversions.push(docx); return Buffer.from("%PDF-fixture"); },
    assertGeneratedDocumentPreviewRequestAllowed: async () => {},
    registerGeneratedDocumentPreview: async generated => { preview = generated; return "fixture"; },
    generatedDocumentRequestBackend: () => "local",
    generatedDocumentContentType: () => "application/pdf",
    sendFile: (_res, status) => { assert.equal(status, 200); response = preview; },
    sendGeneratedDocumentResponse: async (_res, generated) => { response = generated; },
    sendError: (_res, status, error) => { throw new Error(`${status}: ${error}`); }
  };
  vm.createContext(runtime);
  vm.runInContext(extractHandler(), runtime);
  const request = { fieldValues: { Фото: photoPath, ПутьСохр: photoPath }, sourceValues: { Фото: photoPath }, fileName: "Test" };
  for (const documentKind of ["", "employeeContract", "employeeAct", "studentGradeSheet", "studentAttestationProtocol"]) {
    for (const outputFormat of ["docx", "pdf"]) {
      for (const previewOnly of [false, true]) {
        for (const fieldFormulas of [undefined, [{ name: "Фото", formula: "=[Фото]" }], [{ name: "Фото", formula: "=ИЗОБРАЖЕНИЕ([Фото])" }]]) {
          loads.length = 0;
          await runtime.handleContractDocument({ body: { ...request, documentKind, fieldFormulas, outputFormat, previewOnly } }, {}, {});
          const resultXml = xml(response.editableBytes);
          if (fieldFormulas?.[0]?.formula.includes("ИЗОБРАЖЕНИЕ")) {
            assert.deepEqual(loads, [photoPath]);
            assert.match(resultXml, /<w:drawing/);
          } else {
            assert.deepEqual(loads, [], "A plain photo path never loads image bytes");
            assert.doesNotMatch(resultXml, /<w:drawing/);
            assert.ok(resultXml.includes(photoPath));
          }
        }
      }
    }
  }
  await runtime.handleContractDocument({ body: { ...request, fieldFormulas: [{ name: "Фото", formula: '=ИЗОБРАЖЕНИЕ("missing.png")' }] } }, {}, {});
  assert.ok(xml(response.editableBytes).includes(photoPath), "Missing image does not erase ПутьСохр");
  bytes = template({ Опции1: assistant("=[Фото]") }, true);
  loads.length = 0;
  await runtime.handleContractDocument({ body: { ...request, useCustomDocumentProperties: true, fieldFormulas: [{ name: "Фото", formula: "=ИЗОБРАЖЕНИЕ([Фото])" }] } }, {}, {});
  assert.deepEqual(loads, []);
  assert.ok(xml(response.editableBytes).includes(photoPath));
  assert.doesNotMatch(xml(response.editableBytes), /<w:drawing/);
  bytes = template();
  await runtime.handleContractDocument({ body: { ...request, fieldValues: { ...request.fieldValues, QRкод: "Synthetic QR" } } }, {}, {});
  assert.match(xml(response.editableBytes), /<w:drawing/, "QR-code generation is unchanged");
  assert.ok(conversions.length > 0);
  assert.match(appSource, /fieldFormulas: \(documentTemplate\.fields \|\| \[\]\)\.map/);
  assert.match(appSource, /fieldFormulas: \(template\.fields \|\| \[\]\)\.map/);
  console.log("Explicit document images: source paths, Assistant/constructor precedence, conditional formulas, indexed/cache cleanup, employee/student documents, preview/PDF pipeline, missing files and QR: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
