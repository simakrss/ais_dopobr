"use strict";
// Read-only reference inspection is optional. All recipients and sends are synthetic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
const template = Object.freeze({ id: "protocol", documentKind: "studentAttestationProtocol", title: "Протокол",
  templateUrl: "test/protocol.docx", templatePath: "", fields: [{ name: "ФИО", formula: "=[ФИО]" }],
  emailDeliveryMode: "student", emailSubjectTemplate: "Previous subject", emailMessageTemplate: "Previous message",
  emailTemplateValues: { Other: "Preserved" } });
const record = Object.freeze({ id: "one", name: "Слушатель Иван Иванович", email: "learner@example.test", programId: "p" });
const state = { data: { collections: {
  programs: [{ id: "p", name: "Программа", commissionSetId: "c" }],
  commissionSets: [{ id: "c", commissionChair: "Петров Пётр Петрович, председатель" }],
  contracts: [{ name: "Петров Петр Петрович", email: "chair@example.test" }, { name: "Петров Пётр Петрович", email: "CHAIR@example.test" }]
} } };
const calls = [], alerts = [], confirmations = [];
let inspection = { customProperties: [
  { name: "Тема сообщения", value: "Протокол: #ФИО#", source: "assistant-options" },
  { name: "Шаблон", value: "#ИО#, здравствуйте!\nПротокол по #ФИО#. <a href=\"#Ссылка#\">Результаты</a> [Логотип]", source: "assistant-options" },
  { name: "Логотип", value: '<img src="https://example.test/logo.png">', source: "assistant-constant" }
] };
const c = vm.createContext({
  state, unique: (values) => [...new Set(values)],
  getProgramRows: () => state.data.collections.programs,
  resolveProgramCommissionRecord: () => state.data.collections.commissionSets[0],
  normalizeDocumentEmailDeliveryMode: (value) => value || "off",
  normalizeDocumentEmailTemplateValues: (values) => values || {},
  normalizeServerEmailSubject: (value) => String(value || "").trim(),
  resolveServerEmailRecipient: (email, unused, mode) => ({ recipient: mode === "system" ? "system@example.test" : email, sendToSystemMailbox: mode === "system" }),
  getProgramEducationEmailMessageTemplate: () => "",
  document: { querySelector: () => { throw new Error("Never focus student Email for chair problems"); } },
  alert: (message) => alerts.push(message), confirm: (message) => { confirmations.push(message); return true; },
  inspectDocumentTemplateSource: async (request) => { calls.push(request); return inspection; },
  getStudentCardDocumentTemplate: () => template,
  prepareStudentAttestationDocumentRecord: (student) => ({ ...student, workflowSourceValues: { "ИО": "Пётр Петрович", "Ссылка": "https://example.test/report" } }),
  collectContractTemplateSourceValues: (student) => ({ "ФИО": student.name }),
  evaluateContractTemplateFields: (student) => ({ "ФИО": student.name })
});
vm.runInContext([
  "normalizeProgramName", "getStudentContextProgram", "getProgramCommissionSetById", "normalizeEmployeeActPersonName",
  "getAttestationChairRecipient", "normalizeDocumentCustomPropertyName", "normalizeDocumentCustomPropertyValue",
  "getDocumentInspectionCustomProperties", "getDocumentEmailPropertiesFromInspection", "applyDocumentEmailTemplateMarkers",
  "prepareStudentDocumentEmailRequest", "loadStudentProtocolEmailTemplate", "prepareAttestationProtocolEmailRequest"
].map(extract).join("\n"), c);
async function main() {
  const before = JSON.stringify(template);
  let loaded = await c.loadStudentProtocolEmailTemplate(template);
  assert.equal(calls[0].templateUrl, template.templateUrl);
  assert.equal(JSON.stringify(template), before, "Saved formulas/settings are not overwritten");
  assert.equal(loaded.fields, template.fields);
  assert.equal(loaded.emailTemplateValues.Other, "Preserved");
  let request = c.prepareStudentDocumentEmailRequest(loaded, record, {}, { "ИО": "Пётр Петрович", "ФИО": record.name, "Ссылка": "https://example.test/report" });
  assert.equal(request.recipient, "chair@example.test");
  assert.match(request.recipientDescription, /председателя комиссии/);
  assert.match(confirmations[0], /chair@example.test/); assert.doesNotMatch(confirmations[0], /learner@example.test/);
  assert.equal(request.subject, "Протокол: " + record.name);
  assert.match(request.message, /Пётр Петрович, здравствуйте!/);
  assert.match(request.message, /https:\/\/example.test\/report/);
  assert.match(request.message, /<img src=/); assert.doesNotMatch(request.message, /#ФИО#|\[Логотип\]/);
  const batch = await c.prepareAttestationProtocolEmailRequest(record);
  assert.equal(batch.message, request.message); assert.equal(batch.recipient, request.recipient);
  state.data.collections.contracts.push({ name: "Петров Пётр Петрович", email: "other@example.test" });
  assert.equal(c.prepareStudentDocumentEmailRequest(loaded, record, {}, {}), false);
  assert.match(alerts.pop(), /несколько адресов/);
  state.data.collections.contracts = [];
  assert.equal(c.prepareStudentDocumentEmailRequest(loaded, record, {}, {}), false);
  assert.match(alerts.pop(), /Email председателя/);
  request = c.prepareStudentDocumentEmailRequest({ ...loaded, emailDeliveryMode: "system" }, record, {}, {});
  assert.equal(request.recipient, "system@example.test");
  request = c.prepareStudentDocumentEmailRequest({ ...loaded, documentKind: "studentGradeSheet" }, record, {}, {});
  assert.equal(request.recipient, "learner@example.test", "Other student documents keep their recipient");
  assert.equal(c.prepareStudentDocumentEmailRequest({ ...loaded, emailDeliveryMode: "off" }, record, {}, {}), null);
  const count = calls.length;
  const other = { ...template, documentKind: "education" };
  assert.equal(await c.loadStudentProtocolEmailTemplate(other), other); assert.equal(calls.length, count);
  inspection = { customProperties: [] };
  await assert.rejects(() => c.loadStudentProtocolEmailTemplate(template), /не заполнен «Шаблон»/);
  c.inspectDocumentTemplateSource = async () => { throw new Error("Template unavailable"); };
  await assert.rejects(() => c.loadStudentProtocolEmailTemplate(template), /Template unavailable/);
  assert.match(extract("showStudentDocumentActionMenu"), /studentAttestationProtocol" \? "председателю"/);
  assert.match(extract("renderDocumentEmailSettings"), /Председатель комиссии/);
  assert.match(extract("downloadStudentDocumentFromTemplate"), /email: emailRequest\.recipient/);
  assert.doesNotMatch(extract("downloadStudentDocumentFromTemplate"), /email: String\(record\.email/);
  assert.match(extract("executeAttestationTask"), /await prepareAttestationProtocolEmailRequest\(record\)/);
  assert.match(extract("executeAttestationTask"), /message: protocolEmail\?\.message/);
  const referenceIndex = process.argv.indexOf("--reference-template");
  if (referenceIndex !== -1) {
    const server = require("../app-server");
    const properties = c.getDocumentEmailPropertiesFromInspection(server.inspectDocxTemplate(fs.readFileSync(process.argv[referenceIndex + 1])));
    assert.ok(properties.subject.found && properties.message.found);
    assert.match(properties.message.value, /#ИО#/); assert.match(properties.message.value, /#ФИО#/);
    assert.match(properties.message.value, /#Ссылка#/); assert.ok(properties.templateValues["Логотип"]);
    console.log("Reference Word mail properties verified read-only.");
  }
  console.log("Protocol chair email tests passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
