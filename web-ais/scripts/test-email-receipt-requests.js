"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

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

async function testPerMessageReceiptOptions() {
  const clientSend = appSource.match(/^  async function sendServerEmail\([\s\S]*?^  \}\r?$/mu)?.[0];
  const smtpSend = serverSource.match(/^async function sendEmailThroughConfiguredMailbox\([\s\S]*?^\}\r?$/mu)?.[0];
  assert.ok(clientSend && smtpSend, "Use production client and SMTP functions");
  const bodies = [];
  const send = vm.runInNewContext(`(${clientSend})`, {
    state: {},
    normalizeServerEmailSubject: String,
    resolveServerEmailRecipient: email => ({ recipient: email, sendToSystemMailbox: false }),
    fetchWithTimeout: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return { response: { ok: true }, payload: { ok: true } };
    }
  });
  for (const choice of [undefined, true, false]) {
    assert.equal(await send({
      email: recipient, subject: "Вебинар", message: "Напоминание",
      entityId: "test", entityName: "Тест", quiet: true, skipConfirmation: true,
      requestDeliveryAndReadReceipts: choice
    }), true);
    assert.equal(bodies.at(-1).requestDeliveryAndReadReceipts, choice);
    assert.equal(Object.hasOwn(bodies.at(-1), "requestDeliveryAndReadReceipts"), choice !== undefined);
  }
  assert.match(serverSource, /requestDeliveryAndReadReceipts: body\.requestDeliveryAndReadReceipts/u);
  for (const defaultValue of [true, false]) {
    for (const supportsDsn of [true, false]) {
      for (const choice of [undefined, true, false]) {
        const settings = Object.freeze({ login: sender, requestDeliveryAndReadReceipts: defaultValue });
        const commands = []; const data = [];
        const smtp = vm.runInNewContext(`(${smtpSend})`, {
          createEmailEnvelopeCommands, createEmailMessage, SMTP_MESSAGE_TIMEOUT_MS: 60000,
          assertSmtpResponse: response => assert.equal(response.code, 250),
          runAuthenticatedSmtpSession: callback => callback({
            settings, supportsDsn,
            writeCommand: async command => commands.push(command),
            writeData: async value => data.push(value),
            waitForResponse: async () => ({ code: 250 })
          })
        });
        const effective = choice ?? defaultValue;
        const result = await smtp({ to: recipient, subject: "Вебинар", message: "Тест", requestDeliveryAndReadReceipts: choice });
        assert.equal(result.requestDeliveryAndReadReceipts, effective, "Audit must use the per-message choice");
        assert.equal(result.readReceiptRequested, effective);
        assert.equal(result.deliveryReceiptRequested, effective && supportsDsn);
        assert.equal(commands[0].includes("RET=HDRS"), effective && supportsDsn);
        assert.equal(commands[1].includes("NOTIFY=SUCCESS,FAILURE,DELAY"), effective && supportsDsn);
        assert.equal(data[0].includes("Disposition-Notification-To:"), effective);
        assert.equal(settings.requestDeliveryAndReadReceipts, defaultValue, "Global settings are not changed");
      }
    }
  }
  const invalidSmtp = vm.runInNewContext(`(${smtpSend})`, {
    runAuthenticatedSmtpSession: () => assert.fail("Invalid values must be rejected before connecting to SMTP")
  });
  for (const invalid of [null, "false", "true", 0, 1, [], {}]) {
    await assert.rejects(invalidSmtp({ requestDeliveryAndReadReceipts: invalid }), /Некорректная настройка/u);
  }

  const phpHelper = phpSource.match(/^function apply_email_receipt_override\([\s\S]*?^\}/mu)?.[0];
  assert.ok(phpHelper);
  assert.match(phpSource, /\$settings = apply_email_receipt_override\(load_mail_settings\(\), \$data\);/u);
  const phpScript = `declare(strict_types=1);\n${phpHelper}\n
      $results = [];
      foreach ([true, false] as $default) {
        $settings = ['requestDeliveryAndReadReceipts' => $default];
        foreach ([[], ['requestDeliveryAndReadReceipts' => true], ['requestDeliveryAndReadReceipts' => false]] as $data) {
          $result = apply_email_receipt_override($settings, $data);
          $results[] = [$result['requestDeliveryAndReadReceipts'], $settings['requestDeliveryAndReadReceipts']];
        }
      }
      $rejected = 0;
      foreach ([null, 'false', 'true', 0, 1, [], new stdClass()] as $invalid) {
        try { apply_email_receipt_override([], ['requestDeliveryAndReadReceipts' => $invalid]); }
        catch (InvalidArgumentException $error) { $rejected++; }
      }
      echo json_encode(['results' => $results, 'rejected' => $rejected]);`;
  const phpTest = spawnSync(process.env.PHP_BINARY || "php", ["-r", phpScript], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.ifError(phpTest.error);
  assert.equal(phpTest.status, 0, phpTest.stderr);
  assert.deepEqual(JSON.parse(phpTest.stdout), {
    results: [[true, true], [true, true], [false, true], [false, false], [true, false], [false, false]],
    rejected: 7
  });
}

testSmtpBackpressure().then(testPerMessageReceiptOptions).then(() => {
  console.log("Email delivery/read receipt request tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
