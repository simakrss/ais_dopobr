"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const server = require(path.join(root, "app-server.js"));

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

const clientResolverSource = sourceBlock(
  appSource,
  "function resolveContractTemplateAddressSourceKey(",
  "const defaultDocumentTemplateId"
);
const resolveContractTemplateAddressSourceKey = new Function(
  `${clientResolverSource}\nreturn resolveContractTemplateAddressSourceKey;`
)();

assert.equal(
  resolveContractTemplateAddressSourceKey("Адрес постоянного места жительства (регистрации по паспорту)"),
  "registrationAddress"
);
assert.equal(resolveContractTemplateAddressSourceKey("Адрес регистрации по паспорту"), "registrationAddress");
assert.equal(resolveContractTemplateAddressSourceKey("Адрес места регистрации"), "registrationAddress");
assert.equal(resolveContractTemplateAddressSourceKey("Адрес места жительства"), "mailingAddress");
assert.equal(resolveContractTemplateAddressSourceKey("Адрес для отправки документов"), "mailingAddress");
assert.match(
  sourceBlock(appSource, "function getContractTemplateRawSourceValue(", "function getIssuedEducationDocumentName("),
  /resolveContractTemplateAddressSourceKey\(normalized\)/u
);

const registrationAddress = "ДНР, г. Донецк, ул. Логинова, д. 71";
const mailingAddress = "283112, ДНР, г. Донецк, ул. Логинова, д. 71";
const sourceValues = {
  "Адрес места регистрации": registrationAddress,
  "Адрес места жительства": mailingAddress
};

assert.equal(
  server.evaluateDocumentFormula(
    "=[Адрес постоянного места жительства (регистрации по паспорту)]",
    { fieldValues: {}, sourceValues }
  ),
  registrationAddress
);
assert.equal(
  server.evaluateDocumentFormula(
    "=[Адрес для отправки документов]",
    { fieldValues: {}, sourceValues }
  ),
  mailingAddress
);

const customProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
 <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Опции1"><vt:lpwstr>[Поля\\64]_x000d_
ИмяПоля=Адрес постоянного места жительства (регистрации по паспорту)_x000d_
Формула==[Адрес постоянного места жительства (регистрации по паспорту)]_x000d_
Позиция=1_x000d_
[Поля\\19]_x000d_
ИмяПоля=Адрес для отправки документов_x000d_
Формула==[Адрес для отправки документов]_x000d_
Позиция=2_x000d_</vt:lpwstr></property>
</Properties>`;
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>SUBJECT "old-registration"/64</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>old-registration</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>SUBJECT "old-mailing"/19</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>old-mailing</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
</w:body></w:document>`;
const template = server.buildDocxZip([
  { name: "docProps/custom.xml", content: Buffer.from(customProperties, "utf8") },
  { name: "word/document.xml", content: Buffer.from(documentXml, "utf8") }
]);
const resolvedValues = server.applyCustomDocumentPropertyFormulas(template, {}, sourceValues);
const generated = server.fillDocxMarkers(template, resolvedValues);
const generatedXml = server.readDocxZipEntries(generated)
  .find((entry) => entry.name === "word/document.xml")
  .content.toString("utf8");

assert.match(generatedXml, /SUBJECT "ДНР, г\. Донецк, ул\. Логинова, д\. 71"\/64/u);
assert.match(generatedXml, />ДНР, г\. Донецк, ул\. Логинова, д\. 71</u);
assert.match(generatedXml, /SUBJECT "283112, ДНР, г\. Донецк, ул\. Логинова, д\. 71"\/19/u);
assert.match(generatedXml, />283112, ДНР, г\. Донецк, ул\. Логинова, д\. 71</u);

console.log("contract Assistant address fields tests: OK");
