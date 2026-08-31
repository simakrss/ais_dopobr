"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.resolve(__dirname, "..", "app.js");
const source = fs.readFileSync(appPath, "utf8");
const start = source.indexOf("  const studentBulkOperationDefinitions = Object.freeze([");
const end = source.indexOf("  function openStudentBulkOperationsDialog()", start);
assert.ok(start >= 0 && end > start, "Не найден блок плана групповых операций");

const calls = [];
const runners = {
  runStudentBulkMessage: async (...args) => { calls.push(["message", ...args]); return { success: 2 }; },
  runStudentBulkEvents: async (...args) => { calls.push(["event", ...args]); return { success: 2 }; },
  runStudentBulkOrderDetails: async (...args) => { calls.push(["orderDetails", ...args]); return { success: 2 }; },
  runStudentBulkFrdoDate: async (...args) => { calls.push(["frdoDate", ...args]); return { success: 2 }; },
  runStudentBulkPortalAccess: async (...args) => { calls.push(["portalAccess", ...args]); return { success: 2 }; },
  runStudentBulkDocuments: async (...args) => { calls.push(["document", ...args]); return { success: 2 }; }
};
const studentCommunicationMessages = [{ key: "portalAccessMessage", label: "Доступ к порталу" }];
const studentBulkDocumentOperations = [{ key: "education", label: "Документы об образовании" }];
const parseOrdersSdoDate = (value) => /^\d{4}-\d{2}-\d{2}$/u.test(String(value || "")) ? new Date(`${value}T00:00:00`) : null;
const factory = new Function(
  "studentCommunicationMessages",
  "studentBulkDocumentOperations",
  "parseOrdersSdoDate",
  ...Object.keys(runners),
  `${source.slice(start, end)}\nreturn { formatStudentBulkOperationCount, getStudentBulkOperationLabel, validateStudentBulkOperation, getStudentBulkOperationSignature, findStudentBulkOperationConflict, mergeStudentBulkOperationResult, runStudentBulkOperation, executeStudentBulkOperationPlan };`
);
const helpers = factory(
  studentCommunicationMessages,
  studentBulkDocumentOperations,
  parseOrdersSdoDate,
  ...Object.values(runners)
);

assert.equal(helpers.validateStudentBulkOperation({ type: "message", messageKey: "portalAccessMessage" }), "");
assert.equal(helpers.formatStudentBulkOperationCount(1), "1 операцию");
assert.equal(helpers.formatStudentBulkOperationCount(2), "2 операции");
assert.equal(helpers.formatStudentBulkOperationCount(5), "5 операций");
assert.equal(helpers.formatStudentBulkOperationCount(12), "12 операций");
assert.match(helpers.validateStudentBulkOperation({ type: "event", events: [] }), /событие/u);
assert.match(helpers.validateStudentBulkOperation({ type: "frdoDate", frdoDate: "" }), /дату/u);
assert.equal(
  helpers.getStudentBulkOperationLabel({ type: "document", documentOperation: "education" }),
  "Сформировать документы: Документы об образовании"
);
assert.equal(
  helpers.getStudentBulkOperationSignature({
    type: "message",
    messageKey: "portalAccessMessage",
    generationFormat: "pdf"
  }),
  helpers.getStudentBulkOperationSignature({
    type: "message",
    messageKey: "portalAccessMessage",
    generationFormat: "docx"
  }),
  "Скрытые параметры не должны маскировать дубль операции"
);
assert.equal(
  helpers.findStudentBulkOperationConflict([
    { type: "portalAccess", portalEventDate: "2026-08-12" },
    { type: "portalAccess", portalEventDate: "2026-08-13" }
  ]).index,
  1,
  "Две отправки доступа должны считаться конфликтом"
);
assert.equal(
  helpers.findStudentBulkOperationConflict([
    { type: "event", events: [{ key: "sent", date: "2026-08-12" }] },
    { type: "event", events: [{ key: "sent", date: "2026-08-13" }] }
  ]).index,
  1,
  "Одно событие с разными датами должно считаться конфликтом"
);
assert.equal(
  helpers.findStudentBulkOperationConflict([
    { type: "orderDetails", orderType: "enrollment", orderDate: "2026-08-13", orderNo: "1" },
    { type: "document", documentOperation: "enrollmentOrder", operationDate: "2026-08-13", autoFill: true }
  ]).index,
  1,
  "Автозаполнение документа не должно перезаписывать сформированные реквизиты приказа"
);
assert.equal(
  helpers.findStudentBulkOperationConflict([
    { type: "orderDetails", orderType: "enrollment", orderDate: "2026-08-13", orderNo: "1" },
    { type: "document", documentOperation: "enrollmentOrder", operationDate: "2026-08-13", autoFill: false }
  ]),
  null,
  "Документ без автозаполнения можно формировать после реквизитов приказа"
);
assert.ok(
  helpers.findStudentBulkOperationConflict([
    { type: "portalAccess", portalEventDate: "2026-08-13" },
    { type: "event", events: [{ key: "portalCredentialsSent", date: "2026-08-13" }] }
  ]),
  "Отправка доступа уже проставляет соответствующее событие"
);
assert.ok(
  helpers.findStudentBulkOperationConflict([
    { type: "portalAccess", portalEventDate: "2026-08-13" },
    { type: "message", messageKey: "portalAccessMessage" }
  ]),
  "Отправка доступа уже отправляет соответствующее сообщение"
);

const total = { success: 0, skipped: 0, failed: 0, details: [], notices: [] };
helpers.mergeStudentBulkOperationResult(total, { type: "message", messageKey: "portalAccessMessage" }, {
  success: 2,
  skipped: 1,
  failed: 0,
  notice: "Ожидает синхронизации",
  details: [{ tone: "warning", name: "Иванов", message: "Пропущен" }]
});
assert.deepEqual([total.success, total.skipped, total.failed], [2, 1, 0]);
assert.match(total.details[0].name, /Доступ к порталу/u);
assert.match(total.details[1].name, /Доступ к порталу.*Иванов/u);
assert.deepEqual(total.notices, ["Ожидает синхронизации"]);

(async () => {
  const records = [{ id: "1" }, { id: "2" }];
  const progress = () => {};
  await helpers.runStudentBulkOperation({ type: "message", messageKey: "portalAccessMessage" }, records, progress);
  await helpers.runStudentBulkOperation({
    type: "document",
    documentOperation: "education",
    operationDate: "2026-08-13",
    autoFill: true,
    generationFormat: "pdf",
    emailDeliveryMode: "off"
  }, records, progress);
  assert.equal(calls[0][0], "message");
  assert.equal(calls[1][0], "document");
  assert.equal(calls[1][2], "education");
  const store = new Map([["1", { id: "1", first: false, second: false }]]);
  let reads = 0;
  await helpers.executeStudentBulkOperationPlan([
    { type: "message", messageKey: "portalAccessMessage" },
    { type: "event", events: [{ key: "completed", date: "2026-08-13" }] }
  ], ["1"], {
    getRecords: (ids) => {
      reads += 1;
      return ids.map((id) => ({ ...store.get(id) })).filter(Boolean);
    },
    runOperation: async (operation, freshRecords) => {
      const record = freshRecords[0];
      if (operation.type === "message") store.set(record.id, { ...record, first: true });
      else {
        assert.equal(record.first, true, "Вторая операция получила устаревшую запись");
        store.set(record.id, { ...record, second: true });
      }
      return { success: 1, skipped: 0, failed: 0, details: [] };
    }
  });
  assert.equal(reads, 2, "Записи должны перечитываться перед каждой операцией");
  assert.deepEqual(store.get("1"), { id: "1", first: true, second: true });
  assert.match(source, /const currentRecords = getRecords\(recordIds\);/u, "Перед каждым шагом записи должны перечитываться");
  assert.match(source, /for \(let index = 0; index < operations\.length; index \+= 1\)/u, "Операции должны выполняться последовательно");
  assert.doesNotMatch(source, /name="frdoDate"[^>]+required/u, "Скрытое поле ФРДО не должно блокировать submit");
  console.log("Student bulk operation plan: OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
