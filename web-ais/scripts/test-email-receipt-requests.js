"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  smtpResponseSupportsExtension,
  createEmailEnvelopeCommands,
  createEmailMessage
} = require("../app-server.js");

const sender = "mail@edu-plus.ru";
const recipient = "student@example.ru";
const ehloWithDsn = {
  code: 250,
  message: "250-smtp.example.ru\n250-SIZE 52428800\n250-DSN\n250 AUTH LOGIN"
};

assert.equal(smtpResponseSupportsExtension(ehloWithDsn, "DSN"), true);
assert.equal(smtpResponseSupportsExtension(ehloWithDsn, "SIZE"), true);
assert.equal(
  smtpResponseSupportsExtension("250-smtp.example.ru\n250-XDSN\n250 AUTH LOGIN", "DSN"),
  false
);

assert.deepEqual(
  createEmailEnvelopeCommands({
    from: sender,
    to: recipient,
    requestDeliveryAndReadReceipts: true,
    supportsDsn: true
  }),
  {
    mailFrom: `MAIL FROM:<${sender}> RET=HDRS`,
    recipient: `RCPT TO:<${recipient}> NOTIFY=SUCCESS,FAILURE,DELAY`,
    requestDeliveryReceipt: true
  }
);
assert.deepEqual(
  createEmailEnvelopeCommands({
    from: sender,
    to: recipient,
    requestDeliveryAndReadReceipts: true,
    supportsDsn: false
  }),
  {
    mailFrom: `MAIL FROM:<${sender}>`,
    recipient: `RCPT TO:<${recipient}>`,
    requestDeliveryReceipt: false
  }
);
assert.deepEqual(
  createEmailEnvelopeCommands({
    from: sender,
    to: recipient,
    requestDeliveryAndReadReceipts: false,
    supportsDsn: true
  }),
  {
    mailFrom: `MAIL FROM:<${sender}>`,
    recipient: `RCPT TO:<${recipient}>`,
    requestDeliveryReceipt: false
  }
);

const messageWithReceipt = createEmailMessage({
  from: sender,
  to: recipient,
  subject: "Проверка",
  message: "Текст письма",
  requestDeliveryAndReadReceipts: true
});
assert.match(messageWithReceipt, /^Disposition-Notification-To: <mail@edu-plus\.ru>$/mu);
assert.equal((messageWithReceipt.match(/^Disposition-Notification-To:/gmu) || []).length, 1);

const messageWithoutReceipt = createEmailMessage({
  from: sender,
  to: recipient,
  subject: "Проверка",
  message: "Текст письма",
  requestDeliveryAndReadReceipts: false
});
assert.doesNotMatch(messageWithoutReceipt, /^Disposition-Notification-To:/mu);

const attachmentMessage = createEmailMessage({
  from: sender,
  to: recipient,
  subject: "Документ",
  message: "Документ во вложении",
  attachment: {
    fileName: "Документ.pdf",
    contentType: "application/pdf",
    bytes: Buffer.from("%PDF-test", "ascii")
  },
  requestDeliveryAndReadReceipts: true
});
assert.match(attachmentMessage, /^Disposition-Notification-To: <mail@edu-plus\.ru>$/mu);
assert.match(attachmentMessage, /^Content-Type: multipart\/mixed;/mu);

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const phpSource = fs.readFileSync(path.join(root, "send-mail.php"), "utf8");

assert.match(appSource, /name="emailRequestDeliveryAndReadReceipts"/u);
assert.match(appSource, /emailRequestDeliveryAndReadReceipts\s*!==\s*false/u);
assert.match(serverSource, /emailRequestDeliveryAndReadReceipts:\s*true/u);
assert.match(serverSource, /body\.emailRequestDeliveryAndReadReceipts\s*!==\s*false/u);
assert.match(phpSource, /Disposition-Notification-To:/u);
assert.match(phpSource, /RET=HDRS/u);
assert.match(phpSource, /NOTIFY=SUCCESS,FAILURE,DELAY/u);
assert.match(phpSource, /function smtp_response_supports_extension/u);
assert.match(phpSource, /smtp_response_supports_extension\(\$ehloResponse, 'DSN'\)/u);

console.log("Email delivery/read receipt request tests passed.");
