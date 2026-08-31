"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const {
  smtpResponseSupportsExtension,
  createEmailEnvelopeCommands,
  createEmailMessage,
  getRemainingSmtpTimeout,
  writeSmtpSocketData
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
assert.match(serverSource, /const SMTP_SESSION_DEADLINE_MS = 120 \* 1000;/u);
assert.match(serverSource, /await writeData\([\s\S]+SMTP_MESSAGE_TIMEOUT_MS\);/u);
assert.match(serverSource, /deliveryError\.deliveryUnknown = true;/u);
assert.match(serverSource, /Отправка письма не подтверждена/u);
assert.match(phpSource, /const AIS_MAIL_SMTP_DEADLINE_SECONDS = 120\.0;/u);
assert.match(phpSource, /smtp_remaining_timeout\(/u);
assert.match(phpSource, /final class SmtpDeliveryUnknownException/u);
assert.match(phpSource, /final class SmtpResponseRejectedException/u);
assert.match(phpSource, /if \(\$code > 0\)[\s\S]+SmtpResponseRejectedException[\s\S]+throw new RuntimeException\(\$message\)/u);
assert.match(phpSource, /catch \(SmtpResponseRejectedException \$error\)[\s\S]+catch \(Throwable \$error\)/u);
assert.match(phpSource, /smtp_command\(\$socket, 'QUIT',[\s\S]+catch \(Throwable \$error\)/u);

const boundedTimeout = getRemainingSmtpTimeout(Date.now() + 1000, "SMTP test", 30000);
assert.ok(boundedTimeout > 0 && boundedTimeout <= 1000);
assert.throws(
  () => getRemainingSmtpTimeout(Date.now() - 1, "SMTP test", 30000),
  /общий лимит времени SMTP-соединения/u
);

class BackpressureSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writeCallback = null;
  }

  write(_value, callback) {
    this.writeCallback = callback;
    return false;
  }

  destroy() {
    this.destroyed = true;
  }
}

async function testSmtpBackpressure() {
  const backpressureSocket = new BackpressureSocket();
  let writeSettled = false;
  const writePromise = writeSmtpSocketData(
    backpressureSocket,
    "message",
    Date.now() + 1000,
    "SMTP write",
    1000
  ).then(() => {
    writeSettled = true;
  });
  backpressureSocket.writeCallback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writeSettled, false, "SMTP write must wait for backpressure to drain");
  backpressureSocket.emit("drain");
  await writePromise;
  assert.equal(writeSettled, true);
}

testSmtpBackpressure().then(() => {
  console.log("Email delivery/read receipt request tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
