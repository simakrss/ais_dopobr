const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const server = require("../app-server");

async function main() {
  assert.strictEqual(server.isVisualOcrDocument({ contentType: "image/jpeg" }), true);
  assert.strictEqual(server.isVisualOcrDocument({ contentType: "application/pdf" }), true);
  assert.strictEqual(server.isVisualOcrDocument({ contentType: "text/plain" }), false);

  assert.strictEqual(
    server.mergeOcrFieldSourceFiles("Паспорт.pdf; сведения.txt", "сведения.txt; Диплом.docx"),
    "Паспорт.pdf; сведения.txt; Диплом.docx"
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-ocr-preview-"));
  try {
    const textPath = path.join(tempRoot, "сведения.txt");
    fs.writeFileSync(textPath, "ФИО: Иванова Анна Сергеевна\n<script>alert(1)</script>", "utf8");
    const preview = await server.renderOcrDocumentTextPreview({
      source: "local",
      fileName: "сведения.txt",
      relativeName: "сведения.txt",
      contentType: "text/plain",
      localPath: textPath
    });
    assert.strictEqual(preview.kind, "text");
    assert.strictEqual(preview.page, 1);
    assert.strictEqual(preview.pageCount, 1);
    assert.match(preview.text, /Иванова Анна Сергеевна/u);
    assert.match(preview.text, /<script>alert\(1\)<\/script>/u);

    const longPath = path.join(tempRoot, "длинный.txt");
    fs.writeFileSync(longPath, "Я".repeat(200100), "utf8");
    const longPreview = await server.renderOcrDocumentTextPreview({
      source: "local",
      fileName: "длинный.txt",
      relativeName: "длинный.txt",
      contentType: "text/plain",
      localPath: longPath
    });
    assert.strictEqual(longPreview.truncated, true);
    assert.match(longPreview.text, /Предпросмотр сокращён/u);
    assert.ok(longPreview.text.length < 201000);

    const csvPath = path.join(tempRoot, "данные.csv");
    fs.writeFileSync(csvPath, "ФИО;СНИЛС\nИванова Анна;123-456-789 00", "utf8");
    const rtfPath = path.join(tempRoot, "данные.rtf");
    fs.writeFileSync(rtfPath, "{\\rtf1\\ansi Recognized RTF text}", "ascii");
    const docxPath = path.join(tempRoot, "данные.docx");
    fs.writeFileSync(docxPath, server.buildDocxZip([
      {
        name: "word/document.xml",
        content: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Текст из DOCX</w:t></w:r></w:p></w:body></w:document>', "utf8")
      },
      { name: "word/media/large.bin", content: Buffer.alloc(6 * 1024 * 1024, 7) }
    ]));
    const odtPath = path.join(tempRoot, "данные.odt");
    fs.writeFileSync(odtPath, server.buildDocxZip([
      {
        name: "content.xml",
        content: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="office" xmlns:text="text"><office:body><text:p>Текст из ODT</text:p></office:body></office:document-content>', "utf8")
      },
      { name: "Pictures/large.bin", content: Buffer.alloc(6 * 1024 * 1024, 9) }
    ]));
    const formatFixtures = [
      { filePath: csvPath, contentType: "text/csv", expected: /Иванова Анна/u },
      { filePath: rtfPath, contentType: "application/rtf", expected: /Recognized RTF text/u },
      { filePath: docxPath, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", expected: /Текст из DOCX/u },
      { filePath: odtPath, contentType: "application/vnd.oasis.opendocument.text", expected: /Текст из ODT/u }
    ];
    for (const fixture of formatFixtures) {
      const formatPreview = await server.renderOcrDocumentTextPreview({
        source: "local",
        fileName: path.basename(fixture.filePath),
        relativeName: path.basename(fixture.filePath),
        contentType: fixture.contentType,
        localPath: fixture.filePath
      });
      assert.strictEqual(formatPreview.kind, "text");
      assert.match(formatPreview.text, fixture.expected);
    }

    const oversizedPath = path.join(tempRoot, "слишком-большой.txt");
    fs.writeFileSync(oversizedPath, "x");
    fs.truncateSync(oversizedPath, 24 * 1024 * 1024 + 1);
    await assert.rejects(() => server.renderOcrDocumentTextPreview({
      source: "local",
      fileName: "слишком-большой.txt",
      relativeName: "слишком-большой.txt",
      contentType: "text/plain",
      localPath: oversizedPath
    }), /превышает 24 МБ/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const clientSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const displayFieldsStart = clientSource.indexOf("  function getDocumentRecognitionDisplayFields");
  const displayFieldsEnd = clientSource.indexOf("\n\n  function storeStudentDocumentRecognitionResult", displayFieldsStart);
  assert.ok(displayFieldsStart >= 0 && displayFieldsEnd > displayFieldsStart);
  const displayFieldsSource = clientSource.slice(displayFieldsStart, displayFieldsEnd);
  const getDisplayFields = new Function(
    "isContractDocumentRecognitionDialog",
    "getDocumentRecognitionFieldGroups",
    "getDocumentRecognitionFieldDefinition",
    "normalizeDocumentRecognitionCitizenshipField",
    `${displayFieldsSource}\nreturn getDocumentRecognitionDisplayFields;`
  )(
    (dialog) => Boolean(dialog?.isContract),
    (dialog) => dialog.groups,
    (key) => ({ label: `Label ${key}` }),
    (field) => field
  );
  const studentGroups = [
    { id: "passport", keys: ["passportNumber", "passportDate", "passportCode", "passportIssuer"] },
    { id: "education", keys: ["educationDocumentSeries", "educationDocumentNumber", "educationDocumentIssuer", "educationDocumentSurname"] },
    { id: "application", keys: ["phone"] }
  ];
  const displayFields = getDisplayFields(
    { groups: studentGroups },
    [{ key: "passportNumber", value: "40 25 398117", label: "Passport" }]
  );
  assert.deepStrictEqual(
    displayFields.map((field) => field.key),
    [
      "passportNumber",
      "passportDate",
      "passportCode",
      "passportIssuer",
      "educationDocumentSeries",
      "educationDocumentNumber",
      "educationDocumentIssuer",
      "educationDocumentSurname"
    ]
  );
  assert.strictEqual(displayFields.find((field) => field.key === "passportDate").recognitionMissing, true);
  assert.strictEqual(displayFields.find((field) => field.key === "passportDate").value, "");
  assert.strictEqual(displayFields.some((field) => field.key === "phone"), false);
  const contractDisplayFields = getDisplayFields({
    isContract: true,
    groups: [{
      id: "passport",
      keys: ["name", "identityDocument", "identityIssueDate", "identityDepartmentCode", "identityIssuer"]
    }]
  }, []);
  assert.deepStrictEqual(
    contractDisplayFields.map((field) => field.key),
    ["identityIssueDate", "identityDepartmentCode", "identityIssuer"]
  );
  assert.ok(contractDisplayFields.every((field) => field.recognitionMissing === true));
  assert.match(clientSource, /data-ocr-field-preview-text/u);
  assert.match(clientSource, /data-ocr-preview-rotate-left/u);
  assert.match(clientSource, /data-ocr-preview-rotate-right/u);
  assert.match(clientSource, /\.filter\(\(\{ file \}\) => file && getStudentRecognitionPreviewKind\(file\)\)/u);
  assert.match(clientSource, /textPreview\.textContent = String\(pageResult\.text/u);
  assert.match(clientSource, /rotationCache\.set\(getActivePreviewCacheKey\(\), view\.rotation\)/u);
  assert.match(clientSource, /rotate\(\$\{normalizePreviewRotation\(view\.rotation\)\}deg\)/u);
  assert.match(clientSource, /previewLoadController\?\.abort\(\)/u);
  assert.match(clientSource, /signal: controller\.signal/u);
  assert.match(clientSource, /Не распознано — заполните вручную/u);
  assert.match(clientSource, /recognizedFieldPreview \|\| \(availableFiles\.length \? \{ page: 1 \} : null\)/u);

  const serverSource = fs.readFileSync(path.join(__dirname, "..", "app-server.js"), "utf8");
  assert.match(serverSource, /kind: "text"/u);
  assert.match(serverSource, /kind: "image"/u);
  assert.match(serverSource, /MAX_OFFICE_ZIP_UNCOMPRESSED_BYTES/u);

  console.log("document recognition field preview tests: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
