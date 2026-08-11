"use strict";

const assert = require("node:assert/strict");
const {
  parseStudentMailboxMessage,
  collectEmailMessageContent
} = require("../app-server.js");

const subject = "Документы слушателя";
const boundary = "ais-test-boundary";
const raw = Buffer.from([
  "From: =?UTF-8?B?0JjQstCw0L0g0JjQstCw0L3QvtCy?= <student@example.ru>",
  "To: mail@edu-plus.ru",
  `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
  "Date: Tue, 11 Aug 2026 10:30:00 +0300",
  "Message-ID: <mail-test@example.ru>",
  `Content-Type: multipart/mixed; boundary="${boundary}"`,
  "",
  `--${boundary}`,
  "Content-Type: text/plain; charset=UTF-8",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("Здравствуйте! Направляю документы.").toString("base64"),
  `--${boundary}`,
  "Content-Type: application/pdf; name*=UTF-8''%D0%9F%D0%B0%D1%81%D0%BF%D0%BE%D1%80%D1%82.pdf",
  "Content-Disposition: attachment; filename*=UTF-8''%D0%9F%D0%B0%D1%81%D0%BF%D0%BE%D1%80%D1%82.pdf",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-test").toString("base64"),
  `--${boundary}--`,
  ""
].join("\r\n"), "utf8");

const content = collectEmailMessageContent(raw);
assert.equal(content.plain.length, 1);
assert.equal(content.attachments.length, 1);
assert.equal(content.attachments[0].fileName, "Паспорт.pdf");
assert.equal(content.attachments[0].bytes.toString("utf8"), "%PDF-test");

const message = parseStudentMailboxMessage("42", raw);
assert.equal(message.uid, "42");
assert.equal(message.subject, subject);
assert.match(message.from, /student@example\.ru/);
assert.match(message.text, /Направляю документы/);
assert.equal(message.attachments.length, 1);
assert.equal(message.messageId, "mail-test@example.ru");

console.log("Student mailbox MIME parser: OK");
