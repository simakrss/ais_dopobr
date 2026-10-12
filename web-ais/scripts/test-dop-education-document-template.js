"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/gu, "\n");
const dopTemplatePath = path.join(root, "storage", "document-templates", "Сертификат ДОП.docx");

assert.ok(fs.existsSync(dopTemplatePath), "Шаблон сертификата ДОП должен входить в поставку");
assert.ok(fs.statSync(dopTemplatePath).size > 1_000_000, "Шаблон сертификата ДОП не должен быть пустым");
assert.match(
  appSource,
  /dopCertificate:\s*"Документы\/Сертификат ДОП\.docx"/u,
  "Для локального режима должен использоваться путь к Сертификату ДОП в общей папке документов"
);

const dopDefinitionStart = appSource.indexOf('id: "education-document-certificate-dop"');
const proDefinitionStart = appSource.indexOf('id: "education-document-certificate-dop-pro"');
assert.ok(dopDefinitionStart >= 0 && proDefinitionStart > dopDefinitionStart, "Не найдены определения сертификатов ДОП и ПРО");
const dopDefinition = appSource.slice(dopDefinitionStart, proDefinitionStart);
const proDefinition = appSource.slice(proDefinitionStart, appSource.indexOf("  ];", proDefinitionStart));

assert.match(dopDefinition, /title:\s*"Сертификат ДОП"/u);
assert.match(dopDefinition, /templateUrl:\s*defaultDocumentTemplateWebDavSources\.dopCertificate/u);
assert.match(dopDefinition, /templatePath:\s*"storage\/document-templates\/Сертификат ДОП\.docx"/u);
assert.match(dopDefinition, /programTypes:\s*\["ДОП"\]/u);
assert.doesNotMatch(dopDefinition, /programTypes:\s*\[[^\]]*"ПРО"/u);
assert.match(proDefinition, /title:\s*"Сертификат ПРО"/u);
assert.match(proDefinition, /programTypes:\s*\["ПРО"\]/u);
assert.doesNotMatch(proDefinition, /programTypes:\s*\[[^\]]*"ДОП"/u);

assert.match(
  appSource,
  /"education-document-certificate-dop": \["ДОП"\],[\s\S]*"education-document-certificate-dop-pro": \["ПРО"\]/u,
  "Существующая общая привязка сертификата должна автоматически разделяться для ДОП и ПРО"
);
assert.match(
  appSource,
  /const preferredTemplateId = \{[\s\S]*"ДОП": "education-document-certificate-dop",[\s\S]*"ПРО": "education-document-certificate-dop-pro"[\s\S]*matchingTemplates\.find/u,
  "Автоматический выбор документа должен отдавать приоритет системным сертификатам ДОП и ПРО"
);

console.log("DOP education document template checks: OK");
