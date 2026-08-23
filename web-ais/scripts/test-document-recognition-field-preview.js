const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const server = require("../app-server");

async function main() {
  assert.strictEqual(server.isVisualOcrDocument({ contentType: "image/jpeg" }), true);
  assert.strictEqual(server.isVisualOcrDocument({ contentType: "application/pdf" }), true);
  assert.strictEqual(server.isVisualOcrDocument({
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }), true);
  assert.strictEqual(server.isVisualOcrDocument({ contentType: "text/plain" }), false);

  assert.strictEqual(
    server.mergeOcrFieldSourceFiles("Паспорт.pdf; сведения.txt", "сведения.txt; Диплом.docx"),
    "Паспорт.pdf; сведения.txt; Диплом.docx"
  );
  assert.strictEqual(server.getOcrFieldSourceSuitability("passportCode", {
    relativeName: "СНИЛС.jpg",
    documentTypes: ["passport", "snils"]
  }), -1000);
  assert.ok(server.getOcrFieldSourceSuitability("passportCode", {
    relativeName: "паспорт Колюпановой.pdf",
    documentTypes: ["passport"]
  }) > 100);
  const aggregatedPassportFields = server.aggregateOcrFieldCandidates([
    {
      relativeName: "СНИЛС.jpg",
      documentTypes: ["passport", "snils"],
      fields: [{ key: "passportCode", value: "212-604", confidence: 0.99 }]
    },
    {
      relativeName: "паспорт Колюпановой.pdf",
      documentTypes: ["passport"],
      fields: [{ key: "passportCode", value: "610-068", confidence: 0.82 }]
    }
  ]);
  assert.strictEqual(
    aggregatedPassportFields.find((field) => field.key === "passportCode")?.value,
    "610-068"
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

  const clientPath = process.env.AIS_TEST_APP_SOURCE
    ? path.resolve(process.env.AIS_TEST_APP_SOURCE)
    : path.join(__dirname, "..", "app.js");
  const clientSource = fs.readFileSync(clientPath, "utf8").replace(/\r\n/g, "\n");
  const previewKindStart = clientSource.indexOf("  function isStudentRecognitionVisualFile");
  const previewKindEnd = clientSource.indexOf(
    "\n\n  function normalizeStudentRecognitionFileName",
    previewKindStart
  );
  assert.ok(previewKindStart >= 0 && previewKindEnd > previewKindStart);
  const previewKinds = new Function(
    "normalizeStudentPhotoRotation",
    `${clientSource.slice(previewKindStart, previewKindEnd)}\nreturn { isStudentRecognitionVisualFile, getStudentRecognitionPreviewKind, getStudentRecognitionRecommendedPage, getStudentRecognitionPageRotation };`
  )((value) => ((Math.round((Number(value) || 0) / 90) * 90) % 360 + 360) % 360);
  const docxContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  assert.strictEqual(previewKinds.getStudentRecognitionPreviewKind({
    fileName: "Скан диплома.docx",
    contentType: docxContentType,
    textExtraction: "ocr"
  }), "image");
  assert.strictEqual(previewKinds.getStudentRecognitionPreviewKind({
    fileName: "Диплом со сканом.docx",
    contentType: docxContentType,
    textExtraction: "mixed"
  }), "image");
  assert.strictEqual(previewKinds.getStudentRecognitionPreviewKind({
    fileName: "Анкета.docx",
    contentType: docxContentType,
    textExtraction: "text"
  }), "text");
  const scannedDiploma = {
    pages: [
      { page: 1, characters: 115, rotation: 90 },
      { page: 2, characters: 920, rotation: 90 }
    ]
  };
  assert.strictEqual(
    previewKinds.getStudentRecognitionRecommendedPage(scannedDiploma, { key: "educationDocumentNumber" }),
    2
  );
  assert.strictEqual(previewKinds.getStudentRecognitionPageRotation(scannedDiploma, 2), 90);
  const sourceCompatibilityStart = clientSource.indexOf(
    "  function isStudentDocumentRecognitionFieldSourceCompatible"
  );
  const sourceCompatibilityEnd = clientSource.indexOf(
    "\n\n  function normalizeStudentDocumentRecognitionResult",
    sourceCompatibilityStart
  );
  assert.ok(sourceCompatibilityStart >= 0 && sourceCompatibilityEnd > sourceCompatibilityStart);
  const isSourceCompatible = new Function(
    `${clientSource.slice(sourceCompatibilityStart, sourceCompatibilityEnd)}\nreturn isStudentDocumentRecognitionFieldSourceCompatible;`
  )();
  assert.strictEqual(isSourceCompatible({ key: "passportCode", sourceFile: "СНИЛС.jpg" }), false);
  assert.strictEqual(isSourceCompatible({ key: "passportCode", sourceFile: "паспорт Колюпановой.pdf" }), true);
  assert.strictEqual(isSourceCompatible({ key: "passportCode", sourceFile: "скан.pdf" }), true);
  assert.strictEqual(isSourceCompatible({
    key: "passportCode",
    sourceFile: "СНИЛС.jpg; паспорт Колюпановой.pdf"
  }), true);
  assert.strictEqual(isSourceCompatible({ key: "snils", sourceFile: "паспорт Колюпановой.pdf" }), false);
  assert.match(
    clientSource,
    /value\.fields\.slice\(0, 40\)\.filter\(isStudentDocumentRecognitionFieldSourceCompatible\)/u
  );
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
    { id: "passport", keys: ["birthDate", "passportNumber", "passportDate", "passportCode", "passportIssuer"] },
    { id: "education", keys: ["educationDocumentSeries", "educationDocumentNumber", "educationDocumentDate", "educationDocumentIssuer", "educationDocumentSurname"] },
    { id: "application", keys: ["phone"] }
  ];
  const displayFields = getDisplayFields(
    { groups: studentGroups },
    [{ key: "passportNumber", value: "40 25 398117", label: "Passport" }]
  );
  assert.deepStrictEqual(
    displayFields.map((field) => field.key),
    [
      "birthDate",
      "passportNumber",
      "passportDate",
      "passportCode",
      "passportIssuer",
      "educationDocumentSeries",
      "educationDocumentNumber",
      "educationDocumentDate",
      "educationDocumentIssuer",
      "educationDocumentSurname",
      "phone"
    ]
  );
  assert.strictEqual(displayFields.find((field) => field.key === "passportDate").recognitionMissing, true);
  assert.strictEqual(displayFields.find((field) => field.key === "passportDate").value, "");
  assert.strictEqual(displayFields.find((field) => field.key === "birthDate").recognitionMissing, true);
  assert.strictEqual(displayFields.find((field) => field.key === "educationDocumentDate").recognitionMissing, true);
  assert.strictEqual(displayFields.find((field) => field.key === "educationDocumentDate").label, "Дата выдачи документа об образовании");
  assert.strictEqual(displayFields.find((field) => field.key === "phone").recognitionMissing, true);
  const contractDisplayFields = getDisplayFields({
    isContract: true,
    groups: [{
      id: "passport",
      keys: ["name", "identityDocument", "identityIssueDate", "identityDepartmentCode", "identityIssuer"]
    }]
  }, []);
  assert.deepStrictEqual(
    contractDisplayFields.map((field) => field.key),
    ["name", "identityDocument", "identityIssueDate", "identityDepartmentCode", "identityIssuer"]
  );
  assert.ok(contractDisplayFields.every((field) => field.recognitionMissing === true));

  const dateHelpersStart = clientSource.indexOf("  const studentDocumentRecognitionDisplayDateKeys");
  const dateHelpersEnd = clientSource.indexOf("\n\n  function getDocumentRecognitionAlternativeValues", dateHelpersStart);
  assert.ok(dateHelpersStart >= 0 && dateHelpersEnd > dateHelpersStart);
  const dateHelpersSource = clientSource.slice(dateHelpersStart, dateHelpersEnd);
  const dateHelpers = new Function(
    dateHelpersSource + "\nreturn { normalizeStudentDocumentRecognitionDate, formatStudentDocumentRecognitionDate, normalizeRecognitionComparisonValue };"
  )();
  assert.strictEqual(dateHelpers.formatStudentDocumentRecognitionDate("2016-03-05"), "05.03.2016");
  assert.strictEqual(dateHelpers.formatStudentDocumentRecognitionDate("2016-03-05T00:00:00.000Z"), "05.03.2016");
  assert.strictEqual(dateHelpers.normalizeStudentDocumentRecognitionDate("05.03.2016"), "2016-03-05");
  assert.strictEqual(dateHelpers.normalizeStudentDocumentRecognitionDate("29.02.2016"), "2016-02-29");
  assert.strictEqual(dateHelpers.normalizeStudentDocumentRecognitionDate("29.02.2015"), "");
  assert.strictEqual(dateHelpers.normalizeStudentDocumentRecognitionDate("31.04.2016"), "");
  assert.strictEqual(
    dateHelpers.normalizeRecognitionComparisonValue("educationDocumentDate", "05.03.2016"),
    dateHelpers.normalizeRecognitionComparisonValue("educationDocumentDate", "2016-03-05")
  );
  assert.match(clientSource, /studentDocumentRecognitionDisplayDateKeys\.has\(key\)[\s\S]*?normalizeStudentDocumentRecognitionDate\(value\)/u);
  assert.match(clientSource, /value="\$\{escapeAttr\(displayValue\)\}"/u);
  assert.match(clientSource, /Сейчас в карточке:[\s\S]*?escapeHtml\(currentDisplayValue\)/u);
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
  assert.match(clientSource, /recognizedFieldPreview \|\| \(availableFiles\.length \? \{[\s\S]*?page: recommendedPage,[\s\S]*?\} : null\)/u);
  assert.match(clientSource, /const recognitionFiles = getStudentDocumentRecognitionPreviewFiles\(payload\);/u);
  assert.match(clientSource, /const previewPayload = \{ \.\.\.payload, files: recognitionFiles \};/u);
  assert.match(clientSource, /data-action="select-student-photo-area-any"/u);
  assert.match(clientSource, /data-action="recognize-student-document-field-region"/u);
  const fieldContextMenuStart = clientSource.indexOf("  function showFieldCopyPopup");
  const fieldContextMenuEnd = clientSource.indexOf("\n\n  function openSettingsDictionary", fieldContextMenuStart);
  assert.ok(fieldContextMenuStart >= 0 && fieldContextMenuEnd > fieldContextMenuStart);
  const fieldContextMenuSource = clientSource.slice(fieldContextMenuStart, fieldContextMenuEnd);
  assert.match(fieldContextMenuSource, /function showFieldCopyPopup\(control, x, y, options = \{\}\)/u);
  assert.match(fieldContextMenuSource, /data-action="copy-field-value"/u);
  assert.match(fieldContextMenuSource, /data-action="paste-field-value"/u);
  assert.match(fieldContextMenuSource, /data-action="delete-field-value"/u);
  assert.match(fieldContextMenuSource, /data-action="undo-field-change"/u);
  assert.match(fieldContextMenuSource, /data-action="redo-field-change"/u);
  assert.match(fieldContextMenuSource, /data-action="select-student-document-field-area"/u);
  assert.match(fieldContextMenuSource, /typeof options\.onSelectRecognitionArea === "function"/u);
  const recognitionPreviewBindingStart = clientSource.indexOf("  function bindStudentDocumentRecognitionFieldPreviews");
  const recognitionPreviewBindingEnd = clientSource.indexOf("\n\n  function addStudentDocumentPhotoCandidate", recognitionPreviewBindingStart);
  assert.ok(recognitionPreviewBindingStart >= 0 && recognitionPreviewBindingEnd > recognitionPreviewBindingStart);
  const recognitionPreviewBindingSource = clientSource.slice(
    recognitionPreviewBindingStart,
    recognitionPreviewBindingEnd
  );
  assert.match(recognitionPreviewBindingSource, /showFieldCopyPopup\(input,[\s\S]*?onSelectRecognitionArea:/u);
  assert.match(recognitionPreviewBindingSource, /showFieldCopyPopup\(activeInput,[\s\S]*?onSelectRecognitionArea:/u);
  assert.match(recognitionPreviewBindingSource, /preserveView[\s\S]*?&& activeInput[\s\S]*?&& !popup\.hidden/u);
  assert.doesNotMatch(recognitionPreviewBindingSource, /activeInput === input/u);
  assert.match(clientSource, /documentProcessingApiUrl\("\/api\/students\/recognize-documents\/field-region", recognitionOrigin\)/u);
  assert.match(clientSource, /body: JSON\.stringify\(\{ key, mimeType, base64 \}\)/u);
  assert.match(clientSource, /title: "Повторное распознавание"/u);
  assert.match(clientSource, /fieldLabel,/u);
  assert.match(clientSource, /findStudentRecognitionRecommendedSourceFilePosition\(files, field\)/u);
  assert.match(clientSource, /initialRotation = useExistingRegion/u);
  assert.match(clientSource, /rotateStudentPhotoNormalizedRect\(fieldPreview\.box, -initialRotation\)/u);
  assert.match(clientSource, /initialRotation,/u);
  assert.match(clientSource, /getStudentRecognitionRecommendedPage\(recommendedFile, field\)/u);
  assert.match(clientSource, /getStudentRecognitionPageRotation\(recommendedFile, initialPage\)/u);
  assert.match(clientSource, /initialPage,/u);
  assert.match(clientSource, /— рекомендуется/u);
  assert.match(clientSource, /useLabel: "Распознать это поле"/u);
  assert.match(clientSource, /maxOutputSize: 1800/u);
  assert.match(clientSource, /storeStudentDocumentRecognitionTargetedField\([\s\S]*?payload,[\s\S]*?field/u);
  assert.match(clientSource, /\.filter\(\(\{ file \}\) => file && isStudentRecognitionRegionSourceFile\(file\)\)/u);
  assert.match(clientSource, /Нет изображений, PDF или DOCX со сканами, доступных для выбора области\./u);

  const serverSource = fs.readFileSync(path.join(__dirname, "..", "app-server.js"), "utf8");
  assert.match(serverSource, /kind: "text"/u);
  assert.match(serverSource, /kind: "image"/u);
  assert.match(serverSource, /MAX_OFFICE_ZIP_UNCOMPRESSED_BYTES/u);
  assert.match(serverSource, /rotation: \(\(Math\.round\(\(Number\(page\?\.rotation\)/u);

  console.log("document recognition field preview tests: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
