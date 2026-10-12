"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverPath = path.join(__dirname, "..", "app-server.js");
const appPath = path.join(__dirname, "..", "app.js");
const serverSource = fs.readFileSync(serverPath, "utf8");
const appSource = fs.readFileSync(appPath, "utf8");
const {
  buildDocxZip,
  extractStudentMailboxZipAttachments,
  getStudentMailboxArchiveKind
} = require(serverPath);

const pdfBytes = Buffer.from("%PDF-1.4\nmail archive fixture\n%%EOF", "ascii");
const textBytes = Buffer.from("Сведения о слушателе", "utf8");
const zipBytes = buildDocxZip([
  { name: "Документы/Паспорт.pdf", content: pdfBytes },
  { name: "Анкета.txt", content: textBytes },
  { name: "../escape.txt", content: Buffer.from("unsafe") },
  { name: "Запустить.cmd", content: Buffer.from("echo unsafe") },
  { name: "empty-folder/", content: Buffer.alloc(0) }
]);
const attachment = {
  fileName: "Документы слушателя.zip",
  contentType: "application/zip",
  bytes: zipBytes
};

assert.equal(getStudentMailboxArchiveKind(attachment), "zip");
assert.equal(getStudentMailboxArchiveKind({
  fileName: "Документы.docx",
  contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  bytes: zipBytes
}), "", "DOCX не должен ошибочно считаться почтовым архивом");
assert.equal(getStudentMailboxArchiveKind({
  fileName: "scan.7z",
  contentType: "application/x-7z-compressed",
  bytes: Buffer.from([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])
}), "7z");

const extracted = extractStudentMailboxZipAttachments(attachment);
assert.deepEqual(extracted.files.map((file) => file.fileName), ["Паспорт.pdf", "Анкета.txt"]);
assert.equal(extracted.files[0].contentType, "application/pdf");
assert.equal(extracted.files[0].bytes.equals(pdfBytes), true);
assert.equal(extracted.files[1].bytes.equals(textBytes), true);
assert.equal(extracted.totalBytes, pdfBytes.length + textBytes.length);
assert.match(extracted.warnings.join("\n"), /небезопасный путь/u);
assert.match(extracted.warnings.join("\n"), /потенциально опасный файл/u);
assert.equal(extracted.files.some((file) => /escape/iu.test(file.fileName)), false);

assert.throws(
  () => extractStudentMailboxZipAttachments({ ...attachment, bytes: Buffer.from("not a zip") }),
  /ZIP-архив/u
);
const oversizedZip = buildDocxZip([{
  name: "oversized.txt",
  content: Buffer.alloc(24 * 1024 * 1024 + 1)
}]);
const oversizedResult = extractStudentMailboxZipAttachments({ ...attachment, bytes: oversizedZip });
assert.equal(oversizedResult.files.length, 0);
assert.match(oversizedResult.warnings.join("\n"), /слишком большой файл/u);

const tooManyEntriesZip = buildDocxZip(Array.from({ length: 201 }, (_, index) => ({
  name: `file-${index + 1}.txt`,
  content: Buffer.from("test")
})));
assert.throws(
  () => extractStudentMailboxZipAttachments({ ...attachment, bytes: tooManyEntriesZip }),
  /больше 200 файлов/u
);
assert.match(serverSource, /await saveAttachment\(archiveEntry, \{[\s\S]*archiveEntry: true/u);
assert.match(serverSource, /extractedArchiveFiles \+= 1/u);
assert.match(serverSource, /распаковано из архивов/u);
assert.match(appSource, /Из архивов распаковано файлов/u);

console.log("mailbox archive extraction tests: OK");
