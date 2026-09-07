const assert = require("assert");
const fs = require("fs");
const path = require("path");

function extractSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Source block not found: ${startMarker}`);
  return source.slice(start, end);
}

async function main() {
  const appPath = process.env.AIS_TEST_APP_SOURCE
    ? path.resolve(process.env.AIS_TEST_APP_SOURCE)
    : path.join(__dirname, "..", "app.js");
  const appSource = fs.readFileSync(appPath, "utf8").replace(/\r\n/g, "\n");

  const keyMapSource = extractSource(
    appSource,
    "  const contractDocumentRecognitionOcrFieldKeyMap",
    "\n\n  const contractDocumentRecognitionFieldGroups"
  );
  const getOcrFieldKey = new Function(
    `${keyMapSource}\nreturn getDocumentRecognitionOcrFieldKey;`
  )();
  assert.strictEqual(getOcrFieldKey("identityDocument"), "passportNumber");
  assert.strictEqual(getOcrFieldKey("identityIssueDate"), "passportDate");
  assert.strictEqual(getOcrFieldKey("address"), "registrationAddress");
  assert.strictEqual(getOcrFieldKey("educationDocumentDate"), "educationDocumentDate");

  const recognizeSource = extractSource(
    appSource,
    "  async function recognizeStudentDocumentFieldRegion",
    "\n\n  function setStudentDocumentRecognitionFieldControlValue"
  );
  let capturedRequest = null;
  const recognizeField = new Function(
    "getDocumentRecognitionOcrFieldKey",
    "fetchWithTimeout",
    "resolveDocumentProcessingOrigin",
    "documentProcessingApiUrl",
    "clamp",
    "normalizeStudentPhotoRotation",
    `${recognizeSource}\nreturn recognizeStudentDocumentFieldRegion;`
  )(
    getOcrFieldKey,
    async (url, options, timeout, timeoutMessage, readResponse) => {
      capturedRequest = { url, options, timeout, timeoutMessage };
      return readResponse({
        ok: true,
        json: async () => ({
          ok: true,
          key: "passportNumber",
          label: "Серия и номер паспорта",
          value: "12 34 567890",
          confidence: 0.91,
          evidence: "OCR fragment",
          recognitionRotation: 270
        })
      });
    },
    async () => "http://127.0.0.1:8081",
    (pathname, origin) => `${origin}${pathname}`,
    (value, min, max) => Math.max(min, Math.min(max, value)),
    (value) => {
      const normalized = Math.round((Number(value) || 0) / 90) * 90;
      return ((normalized % 360) + 360) % 360;
    }
  );
  const requestController = new AbortController();
  const recognized = await recognizeField("identityDocument", {
    mimeType: "image/jpeg",
    base64: "ZmFrZS1qcGVn"
  }, requestController.signal);
  assert.strictEqual(recognized.key, "passportNumber");
  assert.strictEqual(recognized.value, "12 34 567890");
  assert.strictEqual(recognized.recognitionRotation, 270);
  assert.strictEqual(
    capturedRequest.url,
    "http://127.0.0.1:8081/api/students/recognize-documents/field-region"
  );
  assert.strictEqual(capturedRequest.timeout, 270000);
  assert.strictEqual(capturedRequest.options.signal, requestController.signal);
  assert.deepStrictEqual(
    JSON.parse(capturedRequest.options.body),
    { key: "passportNumber", mimeType: "image/jpeg", base64: "ZmFrZS1qcGVn" }
  );

  const storeSource = extractSource(
    appSource,
    "  function storeStudentDocumentRecognitionTargetedField",
    "\n\n  function bindStudentDocumentRecognitionFieldPreviews"
  );
  const state = {
    modal: { draft: {}, hasDraftChanges: false },
    studentDocumentRecognitionPreviewCache: {
      recognizedAt: "2026-08-20T00:00:00.000Z",
      result: null
    },
    contractDocumentRecognitionPreviewCache: null
  };
  const normalizeResult = (value) => JSON.parse(JSON.stringify(value));
  const storeField = new Function(
    "isContractDocumentRecognitionDialog",
    "normalizeContractDocumentRecognitionResult",
    "normalizeStudentDocumentRecognitionResult",
    "collectContractFormDraft",
    "collectStudentFormDraft",
    "state",
    `${storeSource}\nreturn storeStudentDocumentRecognitionTargetedField;`
  )(
    () => false,
    normalizeResult,
    normalizeResult,
    () => ({ untouchedDraft: true }),
    () => ({ untouchedDraft: true }),
    state
  );
  const payload = {
    recognizedAt: "2026-08-20T00:00:00.000Z",
    fields: [
      { key: "name", value: "Иванов Иван" },
      { key: "passportNumber", value: "old" }
    ]
  };
  storeField({}, payload, { key: "passportNumber", value: "12 34 567890" });
  assert.deepStrictEqual(payload.fields, [
    { key: "name", value: "Иванов Иван" },
    { key: "passportNumber", value: "12 34 567890" }
  ]);
  assert.strictEqual(state.modal.draft.untouchedDraft, true);
  assert.strictEqual(
    state.modal.draft.documentRecognitionResult.fields.find((field) => field.key === "name").value,
    "Иванов Иван"
  );
  assert.strictEqual(
    state.studentDocumentRecognitionPreviewCache.result.fields.find((field) => field.key === "passportNumber").value,
    "12 34 567890"
  );
  assert.strictEqual(state.modal.hasDraftChanges, true);

  assert.match(appSource, /const alwaysVisibleKeys = new Set\(groups\.flatMap\(\(group\) => group\.keys\)\)/u);
  assert.match(appSource, /data-action="select-student-photo-area-any"/u);
  const recognitionFieldRenderer = extractSource(
    appSource,
    "  function renderStudentDocumentRecognitionField",
    "\n\n  function getStudentDocumentRecognitionPreviewFiles"
  );
  assert.doesNotMatch(
    recognitionFieldRenderer,
    /data-action="recognize-student-document-field-region"/u,
    "Большая кнопка точечного OCR не должна занимать место под каждым полем."
  );
  assert.match(recognitionFieldRenderer, /data-action="open-student-document-field-menu"/u);
  assert.match(recognitionFieldRenderer, /(?:aria-label|title)="Действия с полем/u);
  assert.match(recognitionFieldRenderer, /aria-haspopup="menu"/u);
  assert.match(appSource, /findStudentRecognitionRecommendedSourceFilePosition\(files, field\)/u);
  assert.match(appSource, /Поле: \$\{escapeHtml\(options\.fieldLabel\)\}/u);
  assert.match(appSource, /— рекомендуется/u);
  assert.match(appSource, /const recognitionFiles = getStudentDocumentRecognitionPreviewFiles\(payload\);/u);
  assert.match(appSource, /const previewPayload = \{ \.\.\.payload, files: recognitionFiles \};/u);
  assert.match(appSource, /\.filter\(\(\{ file \}\) => file && isStudentRecognitionRegionSourceFile\(file\)\)/u);
  assert.doesNotMatch(
    extractSource(
      appSource,
      "  function openStudentDocumentPhotoCropper",
      "\n\n  async function applyStudentDocumentRecognition"
    ),
    /!file\.error/u
  );
  assert.match(appSource, /maxOutputSize: 1800/u);
  assert.match(appSource, /await recognizeStudentDocumentFieldRegion\([\s\S]*?field\.key,[\s\S]*?normalizedCrop,[\s\S]*?requestController\.signal[\s\S]*?\)/u);
  assert.match(appSource, /onCancel: cancelTargetedRecognition/u);
  assert.match(appSource, /requestSequence !== targetedRecognitionSequence/u);
  assert.match(appSource, /error\?\.name !== "AbortError"/u);
  assert.match(appSource, /const checkbox = row\.querySelector\("\[data-ocr-field-enabled\]"\);[\s\S]*?checkbox\.checked = true;[\s\S]*?setStudentDocumentRecognitionFieldControlValue/u);
  assert.match(appSource, /aria-live="polite"/u);

  const fieldPopupSource = extractSource(
    appSource,
    "  function showFieldCopyPopup",
    "\n\n  function openSettingsDictionary"
  );
  assert.match(fieldPopupSource, /data-action="select-student-document-field-area"/u);
  assert.match(fieldPopupSource, /Источник, область и распознать/u);
  const previewBindingSource = extractSource(
    appSource,
    "  function bindStudentDocumentRecognitionFieldPreviews",
    "\n\n  function addStudentDocumentPhotoCandidate"
  );
  assert.doesNotMatch(previewBindingSource, /recognize-student-document-field-region/u);
  assert.match(
    previewBindingSource,
    /querySelector\("\[data-action='open-student-document-field-menu'\]"\)[\s\S]*?addEventListener\("click"/u
  );
  assert.match(previewBindingSource, /recognitionActionLabel:\s*"Источник, область и распознать"/u);
  assert.match(previewBindingSource, /input\.addEventListener\("contextmenu"/u);
  assert.match(previewBindingSource, /popup\.addEventListener\("contextmenu"/u);
  assert.ok(
    (previewBindingSource.match(
      /onSelectRecognitionArea:\s*\(\)\s*=>\s*selectFieldDocumentArea/gu
    ) || []).length >= 3,
    "Компактная кнопка, поле и предпросмотр должны запускать выбор области одного активного поля."
  );
  const escapeSource = extractSource(
    appSource,
    "  function closeTopmostWindowByEscape",
    "\n\n  function bindEvents"
  );
  assert.ok(
    escapeSource.indexOf('document.querySelector("[data-field-copy-popup]")')
      < escapeSource.indexOf('document.querySelector("[data-student-document-recognition-dialog]")'),
    "Escape должен закрывать меню поля раньше диалога распознавания."
  );
  assert.match(
    appSource,
    /event\.target === opener \|\| opener\.contains\(event\.target\)/u,
    "Триггер должен считаться частью открытого меню, чтобы повторный щелчок закрывал его."
  );
  assert.match(appSource, /popup\.addEventListener\("focusout"/u);

  const sourcePreferenceBlock = extractSource(
    appSource,
    "  const studentRecognitionFieldSourcePreferences",
    "\n\n  function getStudentDocumentRecognitionPreviewFiles"
  );
  const sourceHelpers = new Function(
    "getDocumentRecognitionOcrFieldKey",
    "findStudentRecognitionSourceFilePosition",
    "isStudentRecognitionRegionSourceFile",
    `${sourcePreferenceBlock}\nreturn { getStudentRecognitionFieldSourceScore, findStudentRecognitionRecommendedSourceFilePosition };`
  )(
    (key) => key,
    (files, source) => files.findIndex((file) => String(file.relativeName || "") === String(source || "")),
    () => true
  );
  const sourceFiles = [
    { relativeName: "СНИЛС.jpg", documentTypes: ["passport", "snils"] },
    { relativeName: "паспорт Колюпановой.pdf", documentTypes: ["passport"] },
    { relativeName: "Диплом И.Ю..docx", documentTypes: ["education"] }
  ];
  const passportCodeField = {
    key: "passportCode",
    label: "Код подразделения",
    sourceFile: "СНИЛС.jpg"
  };
  assert.strictEqual(
    sourceHelpers.findStudentRecognitionRecommendedSourceFilePosition(sourceFiles, passportCodeField),
    1
  );
  assert.ok(
    sourceHelpers.getStudentRecognitionFieldSourceScore(passportCodeField, sourceFiles[1])
      > sourceHelpers.getStudentRecognitionFieldSourceScore(passportCodeField, sourceFiles[0])
  );

  console.log("document recognition targeted-field tests: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
