const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Не найден блок: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Не найден конец блока: ${endMarker}`);
  return source.slice(start, end);
}

const completionBlock = sourceBlock(
  appSource,
  "function applyStudentEventCompletion(",
  "function updateStudentEventCompletionInCard("
);
const applyStudentEventCompletion = new Function(`${completionBlock}\nreturn applyStudentEventCompletion;`)();
const record = {};
assert.equal(
  applyStudentEventCompletion(record, "sourceDocsReceived", "2026-08-24", "Получен пакет исходных документов"),
  true
);
assert.deepEqual(record, {
  event_sourceDocsReceived_state: "dated",
  event_sourceDocsReceived_date: "2026-08-24",
  event_sourceDocsReceived_label: "Получен пакет исходных документов"
});
assert.equal(
  applyStudentEventCompletion(record, "sourceDocsReceived", "2026-08-24", "Получен пакет исходных документов"),
  false
);

const exportBlock = sourceBlock(appSource, "function exportStudentToSdo()", "function exportEmployeeToSdo()");
assert.match(exportBlock, /markStudentEventsCompleted\(record, "portalAccountCreated"\)/u);

const portalEmailBlock = sourceBlock(
  appSource,
  "async function emailPortalAccessMessage(",
  "function getCurrentStudentCardValue("
);
assert.match(portalEmailBlock, /sent === true && !sendToSystemMailbox/u);
assert.match(portalEmailBlock, /"portalCredentialsSent"/u);

const recognitionBlock = sourceBlock(
  appSource,
  "async function startStudentDocumentRecognition(",
  "async function uploadStoredPhoto("
);
assert.match(recognitionBlock, /if \(!isContract\)/u);
assert.match(recognitionBlock, /"sourceDocsReceived"/u);

const educationBlock = sourceBlock(
  appSource,
  "async function openStudentEducationDocument(",
  "async function openStudentStudyCertificateDocument("
);
assert.match(educationBlock, /result\?\.emailed === true/u);
assert.match(educationBlock, /result\.emailRecipientMode !== "system"/u);
assert.match(educationBlock, /"educationDocMaketSent"/u);

const extensionBlock = sourceBlock(
  appSource,
  "async function openStudentTrainingExtensionDocument(",
  "async function openStudentTrainingReductionDocument("
);
assert.match(extensionBlock, /result\?\.emailed === true/u);
assert.match(extensionBlock, /result\.emailRecipientMode !== "system"/u);
assert.match(extensionBlock, /markStudentEventsCompleted\(record, "extensionDocsSent"\)/u);

const reductionBlock = sourceBlock(
  appSource,
  "async function openStudentTrainingReductionDocument(",
  "async function openStudentCardBoundDocument("
);
assert.match(reductionBlock, /result\?\.emailed === true/u);
assert.match(reductionBlock, /result\.emailRecipientMode !== "system"/u);
assert.match(reductionBlock, /markStudentEventsCompleted\(record, "reductionDocsSent"\)/u);

const enrollmentBlock = sourceBlock(
  appSource,
  "async function openStudentEnrollmentOrderDocument(",
  "async function openStudentExpulsionOrderDocument("
);
assert.match(enrollmentBlock, /result\?\.generated/u);
assert.match(enrollmentBlock, /"enrollmentOrderPrepared"/u);

const expulsionBlock = sourceBlock(
  appSource,
  "async function openStudentExpulsionOrderDocument(",
  "function getEmployeeContractDocumentFields("
);
assert.match(expulsionBlock, /result\?\.generated/u);
assert.match(expulsionBlock, /"expulsionOrderPrepared"/u);

const bulkMessageBlock = sourceBlock(
  appSource,
  "async function runStudentBulkMessage(",
  "async function runStudentBulkEvents("
);
assert.match(bulkMessageBlock, /messageKey === "portalAccessMessage"/u);
assert.match(bulkMessageBlock, /markStudentEventsCompleted\(record, "portalCredentialsSent"\)/u);

const bulkDocumentBlock = sourceBlock(
  appSource,
  "async function runStudentBulkDocuments(",
  "const studentBulkOperationDefinitions"
);
assert.match(bulkDocumentBlock, /"enrollmentOrderPrepared"/u);
assert.match(bulkDocumentBlock, /"expulsionOrderPrepared"/u);
assert.match(bulkDocumentBlock, /"educationDocMaketSent"/u);

console.log("student automatic event checks: OK");
