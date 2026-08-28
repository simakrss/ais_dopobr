const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "app.js");
const stylesPath = path.join(__dirname, "..", "styles.css");
const appSource = fs.readFileSync(appPath, "utf8");
const stylesSource = fs.readFileSync(stylesPath, "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Не найден блок: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Не найден конец блока: ${endMarker}`);
  return source.slice(start, end);
}

const previewHtmlBlock = sourceBlock(
  appSource,
  "function documentEmailMessageContainsHtml(",
  "function showGeneratedDocumentEmailPreview("
);
const helpers = new Function(`
  const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
  ${previewHtmlBlock}
  return { documentEmailMessageContainsHtml, buildGeneratedDocumentEmailPreviewHtml };
`)();

assert.equal(helpers.documentEmailMessageContainsHtml("Строка 1\nСтрока 2"), false);
assert.equal(helpers.documentEmailMessageContainsHtml("Здравствуйте!<br><b>Документы</b>"), true);

const plainPreview = helpers.buildGeneratedDocumentEmailPreviewHtml("5 < 6\nВторая строка");
assert.match(plainPreview, /5 &lt; 6/u);
assert.match(plainPreview, /ais-email-plain-text/u);
assert.match(plainPreview, /white-space: pre-wrap/u);

const htmlPreview = helpers.buildGeneratedDocumentEmailPreviewHtml(
  '<p>Здравствуйте!</p><a href="https://edu-plus.ru">Сайт</a><img src="https://edu-plus.ru/logo.png">'
);
assert.match(htmlPreview, /<p>Здравствуйте!<\/p>/u);
assert.match(htmlPreview, /<base target="_blank">/u);
assert.match(htmlPreview, /<img src="https:\/\/edu-plus\.ru\/logo\.png">/u);

const fullDocumentPreview = helpers.buildGeneratedDocumentEmailPreviewHtml(
  "<!doctype html><html><head><title>Письмо</title></head><body>Текст</body></html>"
);
assert.match(fullDocumentPreview, /<head>\s*<meta charset="utf-8">/u);
assert.match(fullDocumentPreview, /<title>Письмо<\/title>/u);

const previewDialogBlock = sourceBlock(
  appSource,
  "function showGeneratedDocumentEmailPreview(",
  "function applyDocumentEmailTemplateMarkers("
);
assert.match(previewDialogBlock, /Предварительный просмотр письма/u);
assert.match(previewDialogBlock, /Получатель/u);
assert.match(previewDialogBlock, /Тема/u);
assert.match(previewDialogBlock, /Вложение/u);
assert.match(previewDialogBlock, /data-generated-document-email-subject-input/u);
assert.match(previewDialogBlock, /data-generated-document-email-message-input/u);
assert.match(previewDialogBlock, /data-action="edit-generated-document-email"/u);
assert.match(previewDialogBlock, /data-action="apply-generated-document-email"/u);
assert.match(previewDialogBlock, /frame\.srcdoc = buildGeneratedDocumentEmailPreviewHtml\(nextMessage\)/u);
assert.match(previewDialogBlock, /return \{ \.\.\.emailRequest, subject, message \}/u);
assert.match(previewDialogBlock, /sandbox="allow-popups allow-popups-to-escape-sandbox"/u);
assert.doesNotMatch(previewDialogBlock, /allow-scripts/u);

const generationBlock = sourceBlock(
  appSource,
  "async function downloadStudentDocumentFromTemplate(",
  "async function openStudentEducationDocument("
);
const documentPreviewIndex = generationBlock.indexOf("showGeneratedDocumentPreview(preview.blob");
const emailPreviewIndex = generationBlock.indexOf("showGeneratedDocumentEmailPreview(emailRequest");
const storageIndex = generationBlock.indexOf("prepareStudentDocumentStorageRequest(");
assert.ok(documentPreviewIndex >= 0, "Не найден предварительный просмотр документа.");
assert.ok(emailPreviewIndex > documentPreviewIndex, "Письмо должно показываться после документа.");
assert.ok(storageIndex > emailPreviewIndex, "Отправка и сохранение не должны начинаться до подтверждения письма.");
assert.match(generationBlock, /cancelGeneratedDocumentPreview\(pendingPreviewToken, documentProcessingOrigin\)/u);
assert.match(generationBlock, /let emailRequest = prepareStudentDocumentEmailRequest/u);
assert.match(generationBlock, /emailRequest = reviewedEmailRequest/u);

const escapeBlock = sourceBlock(appSource, "function closeTopmostWindowByEscape()", "function bindEvents(");
assert.match(escapeBlock, /data-generated-document-email-preview/u);
assert.match(escapeBlock, /closeGeneratedDocumentEmailPreview/u);

assert.match(stylesSource, /\.generated-document-email-preview-dialog/u);
assert.match(stylesSource, /\.generated-document-email-frame/u);
assert.match(stylesSource, /\.generated-document-email-workspace\.is-editing/u);
assert.match(stylesSource, /\.generated-document-email-editor/u);
assert.match(
  stylesSource,
  /\[data-action="confirm-generated-document-preview"\]\s*\{[\s\S]{0,120}grid-column:\s*auto;[\s\S]{0,120}grid-row:\s*auto;[\s\S]{0,220}width:\s*max-content;/u
);
assert.match(stylesSource, /@media \(max-width: 720px\)[\s\S]*\.generated-document-email-summary/u);

console.log("generated document email preview checks: OK");
