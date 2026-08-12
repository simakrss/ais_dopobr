"use strict";

const assert = require("node:assert/strict");
const {
  parseStudentMailboxMessage,
  parseStudentApplicationOrderEmail,
  mergeStudentApplicationRows,
  collectEmailMessageContent,
  parseImapBodyStructureAttachments,
  prepareStudentMailboxAttachmentForSave
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

const unpaidInSalesBody = [
  "Поступил заказ № 5555 от 12.08.2026 10:30",
  "Имя:",
  "Тестовая Пользовательница",
  "E-mail:",
  "test@example.ru",
  "Телефон:",
  "+79990000000",
  "Состав заказа:",
  "777",
  "Тестовая программа (72 ч)",
  "цена: 10 000 ₽, количество: 1 шт.",
  "Сумма:",
  "Итого к оплате: 10 000 ₽",
  "Способ получения товара:",
  "Электронно",
  "Москва",
  "Способ оплаты:",
  "Банковская карта",
  "Статус оплаты:",
  "не оплачен"
].join("\n");
const unpaidInSalesRaw = Buffer.from([
  "From: shop@example.ru",
  "To: mail@zifra-plus.ru",
  `Subject: =?UTF-8?B?${Buffer.from("Новый заказ № 5555").toString("base64")}?=`,
  "Date: Wed, 12 Aug 2026 10:30:00 +0300",
  "Message-ID: <insales-unpaid-test@example.ru>",
  "Content-Type: text/plain; charset=UTF-8",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from(unpaidInSalesBody).toString("base64")
].join("\r\n"), "utf8");
const unpaidInSalesRows = parseStudentApplicationOrderEmail(unpaidInSalesRaw);
assert.equal(unpaidInSalesRows.length, 1);
assert.equal(unpaidInSalesRows[0].paid, false);
assert.equal(unpaidInSalesRows[0].orderAmount, 10000);
assert.equal(unpaidInSalesRows[0].paymentAmount, 10000);

const distinctStoreRows = mergeStudentApplicationRows([
  unpaidInSalesRows[0],
  {
    ...unpaidInSalesRows[0],
    id: "mysql-5555-777",
    sourceType: "mysql",
    source: "Интернет-магазин / WooCommerce",
    paymentAmount: 0
  }
]);
assert.equal(distinctStoreRows.length, 2);
assert.equal(distinctStoreRows.find((row) => row.sourceType === "email").paymentAmount, 10000);

const bodyStructureResponse = Buffer.from([
  '* 7440 FETCH (UID 7932 BODYSTRUCTURE (("text" "plain" ("charset" "utf-8") NIL NIL "base64" 120 2 NIL NIL NIL NIL)("application" "pdf" ("name" "first.pdf") NIL NIL "base64" 400 NIL ("attachment" ("filename" "first.pdf")) NIL NIL)("image" "jpeg" NIL NIL NIL "base64" 800 NIL ("inline" ("filename" "photo.jpg")) NIL NIL) "mixed" ("boundary" "test") NIL NIL NIL))',
  'A0001 OK Fetch completed.'
].join("\r\n"), "latin1");
const bodyStructureAttachments = parseImapBodyStructureAttachments(bodyStructureResponse);
assert.equal(bodyStructureAttachments.get("7932").length, 2);
assert.deepEqual(bodyStructureAttachments.get("7932").map(({ fileName, contentType, size }) => ({
  fileName,
  contentType,
  size
})), [
  { fileName: "first.pdf", contentType: "application/pdf", size: 300 },
  { fileName: "photo.jpg", contentType: "image/jpeg", size: 600 }
]);

(async () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
  const pngAttachment = await prepareStudentMailboxAttachmentForSave({
    fileName: "photo.png",
    contentType: "application/octet-stream",
    bytes: pngBytes
  });
  assert.equal(pngAttachment.fileName, "photo.png");
  assert.equal(pngAttachment.converted, false);
  assert.deepEqual(pngAttachment.bytes, pngBytes);

  const pdfBytes = Buffer.from("%PDF-test", "ascii");
  const pdfAttachment = await prepareStudentMailboxAttachmentForSave({
    fileName: "document.bin",
    contentType: "application/pdf",
    bytes: pdfBytes
  });
  assert.equal(pdfAttachment.fileName, "document.bin");
  assert.equal(pdfAttachment.converted, false);
  assert.deepEqual(pdfAttachment.bytes, pdfBytes);

  const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
  const jpegAttachment = await prepareStudentMailboxAttachmentForSave({
    fileName: "photo.jpeg",
    contentType: "image/jpeg",
    bytes: jpegBytes
  });
  assert.equal(jpegAttachment.fileName, "photo.jpg");
  assert.equal(jpegAttachment.contentType, "image/jpeg");
  assert.deepEqual(jpegAttachment.bytes, jpegBytes);

  console.log("Student mailbox MIME parser: OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
