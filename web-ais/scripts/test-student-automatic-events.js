const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "app.js");
const appServerPath = path.join(__dirname, "..", "app-server.js");
const appSource = fs.readFileSync(appPath, "utf8");
const appServerSource = fs.readFileSync(appServerPath, "utf8");

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

const ensureEventVisibleBlock = sourceBlock(
  appSource,
  "function ensureStudentEventVisibleForCompletion(",
  "function restoreStudentEventCompletionInCard("
);
const ensureStudentEventVisibleForCompletion = new Function(
  "csvList",
  "getStudentEventTemplates",
  "unique",
  ensureEventVisibleBlock + "\nreturn ensureStudentEventVisibleForCompletion;"
)(
  (value) => String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  () => [
    { key: "macro_hb0dir", label: "Отправлен электронный документ об образовании" },
    { key: "reviewRequested", label: "Запрошен отзыв" }
  ],
  (values) => [...new Set(values)]
);
const restoredElectronicEventRecord = {
  eventDeleted: "macro_hb0dir,reviewRequested",
  eventOrder: "docsListNotice",
  eventCustomKeys: "custom-notice,macro_hb0dir"
};
assert.equal(
  ensureStudentEventVisibleForCompletion(restoredElectronicEventRecord, "macro_hb0dir"),
  true,
  "Скрытая настроенная галочка должна быть восстановлена"
);
assert.deepEqual(restoredElectronicEventRecord, {
  eventDeleted: "reviewRequested",
  eventOrder: "docsListNotice,macro_hb0dir",
  eventCustomKeys: "custom-notice"
});
assert.equal(
  ensureStudentEventVisibleForCompletion(restoredElectronicEventRecord, "macro_hb0dir"),
  false,
  "Повторное восстановление не должно дублировать событие"
);
assert.equal(
  restoredElectronicEventRecord.eventOrder.split(",")
    .filter((key) => key === "macro_hb0dir").length,
  1,
  "Событие должно присутствовать в порядке ровно один раз"
);
assert.equal(
  restoredElectronicEventRecord.eventCustomKeys.split(",")
    .includes("macro_hb0dir"),
  false,
  "Настроенное событие не должно дублироваться среди пользовательских"
);

const educationDocumentEmailSentBlock = sourceBlock(
  appSource,
  "function markStudentEducationDocumentEmailSent(",
  "function isExplicitUncheckedEventState("
);
const markedEducationDocumentEvents = [];
const markStudentEducationDocumentEmailSent = new Function(
  "getStudentProgramTypeCode",
  "normalizeEventTemplateLabel",
  "getStudentEventTemplates",
  "buildMacroEventKey",
  "markStudentEventsCompleted",
  educationDocumentEmailSentBlock + "\nreturn markStudentEducationDocumentEmailSent;"
)(
  (student) => student.programType,
  (value) => String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim(),
  () => configuredEventTemplates,
  () => {
    throw new Error("Для настроенного события не должен использоваться запасной ключ");
  },
  (student, eventKey, dateValue, options) => {
    markedEducationDocumentEvents.push({
      studentId: student.id,
      eventKey,
      dateValue,
      options
    });
    return 17;
  }
);
const electronicDocumentEventLabel = "Отправлен электронный документ об образовании";
const clientStudentEventTemplatesBlock = sourceBlock(
  appSource,
  "const studentEventTemplates = [",
  "const studentEventProgramTypeOptions"
);
const clientStudentEventTemplates = new Function(
  clientStudentEventTemplatesBlock + "\nreturn studentEventTemplates;"
)();
const serverStudentEventTemplatesBlock = sourceBlock(
  appServerSource,
  "const STUDENT_EVENT_IMPORT_TEMPLATES = Object.freeze([",
  "const CONTRACT_EVENT_IMPORT_TEMPLATES"
);
const serverStudentEventTemplates = new Function(
  serverStudentEventTemplatesBlock + "\nreturn STUDENT_EVENT_IMPORT_TEMPLATES;"
)();
const clientElectronicDocumentEvent = clientStudentEventTemplates
  .find((event) => event.label === electronicDocumentEventLabel);
const serverElectronicDocumentEvent = serverStudentEventTemplates
  .find((event) => event.label === electronicDocumentEventLabel);
assert.equal(
  clientElectronicDocumentEvent?.key,
  "macro_hb0dir",
  "Клиентский шаблон должен использовать совместимый ключ электронной отправки"
);
assert.equal(
  serverElectronicDocumentEvent?.key,
  "macro_hb0dir",
  "Серверный шаблон импорта должен использовать тот же ключ электронной отправки"
);
assert.equal(
  clientElectronicDocumentEvent.key,
  serverElectronicDocumentEvent.key,
  "Ключи точной метки на клиенте и сервере должны совпадать"
);
const configuredEventTemplates = [
  { key: "another-event", label: "Отправлен оригинал документа об образовании" },
  { key: "configured-electronic-document-event", label: electronicDocumentEventLabel }
];

for (const programType of ["ДОП", "ПРО"]) {
  const student = {
    id: "electronic-" + programType,
    programType,
    eventTemplates: configuredEventTemplates
  };
  assert.equal(
    markStudentEducationDocumentEmailSent(student, {
      emailed: true,
      emailRecipientMode: "student"
    }),
    17,
    programType + ": helper должен возвращать результат отметки события"
  );
  assert.deepEqual(markedEducationDocumentEvents.at(-1), {
    studentId: student.id,
    eventKey: "configured-electronic-document-event",
    dateValue: "",
    options: { ensureVisible: true }
  }, programType + ": настроенная галочка должна отмечаться и восстанавливаться");
}

for (const programType of ["КПК", "ППП"]) {
  const student = {
    id: "maket-" + programType,
    programType,
    eventTemplates: configuredEventTemplates
  };
  assert.equal(
    markStudentEducationDocumentEmailSent(student, {
      emailed: true,
      emailRecipientMode: "student"
    }),
    17
  );
  assert.deepEqual(markedEducationDocumentEvents.at(-1), {
    studentId: student.id,
    eventKey: "educationDocMaketSent",
    dateValue: undefined,
    options: undefined
  }, programType + ": должна сохраняться отметка отправленного макета");
}

for (const [description, result] of [
  ["отправка отклонена", { emailed: false, emailRecipientMode: "student" }],
  ["результат отправки неизвестен", { emailed: null, emailRecipientMode: "student" }],
  ["отправлено в системный ящик", { emailed: true, emailRecipientMode: "system" }]
]) {
  const markedBefore = markedEducationDocumentEvents.length;
  assert.equal(
    markStudentEducationDocumentEmailSent({
      id: "not-sent-" + markedBefore,
      programType: "ДОП",
      eventTemplates: configuredEventTemplates
    }, result),
    0,
    description
  );
  assert.equal(
    markedEducationDocumentEvents.length,
    markedBefore,
    description + ": галочка не должна изменяться"
  );
}

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
assert.match(
  educationBlock,
  /markStudentEducationDocumentEmailSent\(record, result\)/u,
  "Одиночная отправка документа должна использовать общий helper"
);

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
assert.match(
  bulkDocumentBlock,
  /markStudentEducationDocumentEmailSent\(record, generated\)/u,
  "Массовая отправка документов должна использовать общий helper"
);

console.log("student automatic event checks: OK");
