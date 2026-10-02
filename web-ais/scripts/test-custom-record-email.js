"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createEmailMessage,
  normalizeServerEmailAttachments
} = require("../app-server.js");

const pdfBytes = Buffer.from("%PDF-test", "ascii");
const textBytes = Buffer.from("Проверка", "utf8");
const attachments = normalizeServerEmailAttachments({
  attachments: [
    {
      fileName: "Документ.pdf",
      contentType: "application/octet-stream",
      base64: pdfBytes.toString("base64")
    },
    {
      fileName: "Комментарий.txt",
      contentType: "",
      base64: textBytes.toString("base64")
    }
  ]
});

assert.equal(attachments.length, 2);
assert.equal(attachments[0].contentType, "application/pdf");
assert.equal(attachments[1].contentType, "text/plain");
assert.deepEqual(
  normalizeServerEmailAttachments({
    attachment: {
      fileName: "Документ.pdf",
      contentType: "application/pdf",
      base64: pdfBytes.toString("base64")
    }
  }).map((item) => item.fileName),
  ["Документ.pdf"],
  "legacy single attachments must remain supported"
);
assert.throws(
  () => normalizeServerEmailAttachments({
    attachments: [{
      fileName: "Запуск.exe",
      contentType: "application/octet-stream",
      base64: Buffer.from("MZ", "ascii").toString("base64")
    }]
  }),
  /не поддерживается/u
);
assert.throws(
  () => normalizeServerEmailAttachments({
    attachments: [{
      fileName: "Подмена.pdf",
      contentType: "application/pdf",
      base64: Buffer.from("not-pdf", "ascii").toString("base64")
    }]
  }),
  /не соответствует/u
);

const message = createEmailMessage({
  from: "mail@edu-plus.ru",
  to: "student@example.ru",
  subject: "Произвольное письмо",
  message: "<b>Здравствуйте!</b>",
  attachments,
  requestDeliveryAndReadReceipts: true
});
assert.match(message, /^Content-Type: multipart\/mixed;/mu);
assert.equal(
  (message.match(/^Content-Disposition: attachment;/gmu) || []).length,
  2,
  "every selected file must become a MIME attachment"
);
assert.match(message, /filename\*=UTF-8''%D0%94%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82\.pdf/u);
assert.match(message, /^Content-Type: text\/html; charset=UTF-8$/mu);

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const phpSource = fs.readFileSync(path.join(root, "send-mail.php"), "utf8");
const styleSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert.match(appSource, /data-action="open-custom-record-email"/u);
assert.match(appSource, /data-custom-record-email-composer/u);
assert.match(appSource, /data-custom-record-email-dropzone/u);
assert.match(appSource, /entityType:\s*isContract\s*\?\s*"contracts"\s*:\s*"students"/u);
assert.match(appSource, /messageType:\s*"Произвольное письмо"/u);
assert.match(appSource, /\{\s*attachments:\s*resolvedAttachments\s*\}/u);
assert.match(serverSource, /auditAttachmentNames\.length\s*\?\s*`Вложения:/u);
assert.match(phpSource, /function normalize_email_attachments/u);
assert.match(phpSource, /\$attachmentAuditText/u);
assert.match(styleSource, /\.custom-record-email-dialog/u);
assert.match(styleSource, /\.custom-record-email-dropzone\.is-dragover/u);

console.log("Custom record email composer tests passed.");
