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
  templateUrl: "test/protocol.docx", templatePath: "", fields: [
    { name: "ФИО", formula: "=[ФИО]" }, { name: "ИО", formula: "" },
    { name: "Email", formula: "" }, { name: "Ссылка", formula: "" },
    { name: "ИОФ", formula: '=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"ИОФ")' }
  ],
  emailDeliveryMode: "student", emailSubjectTemplate: "Previous subject", emailMessageTemplate: "Previous message",
  emailTemplateValues: { Other: "Preserved" } });
const record = Object.freeze({ id: "one", name: "Слушатель Иван Иванович", email: "learner@example.test", programId: "p" });
const state = { data: { collections: {
  programs: [{ id: "p", name: "Программа", commissionSetId: "c", gradeReportUrl: "https://example.test/report" }],
  commissionSets: [{ id: "c", commissionChair: "Петров Пётр Петрович, председатель" }],
  contracts: [{ name: "Петров Петр Петрович", email: "chair@example.test" }, { name: "Петров Пётр Петрович", email: "CHAIR@example.test" }]
} } };
const calls = [], alerts = [], confirmations = [];
let inspection = { customProperties: [
  { name: "Тема сообщения", value: "Протокол: #ФИО#", source: "assistant-options" },
  { name: "Шаблон", value: "#ИО#, здравствуйте!\nПротокол по #ФИО#. Пользователь — #ИОФ#. <a href=\"#Ссылка#\">Результаты</a> [Логотип]", source: "assistant-options" },
  { name: "Логотип", value: '<img src="https://example.test/logo.png">', source: "assistant-constant" }
] };
const c = vm.createContext({
  state, unique: (values) => [...new Set(values)],
  getProgramRows: () => state.data.collections.programs,
  resolveProgramCommissionRecord: (program) => ({...program, ...state.data.collections.commissionSets[0]}),
  normalizeDocumentEmailDeliveryMode: (value) => value || "off",
  normalizeDocumentEmailTemplateValues: (values) => values || {},
  normalizeServerEmailSubject: (value) => String(value || "").trim(),
  resolveServerEmailRecipient: (email, unused, mode) => ({ recipient: mode === "system" ? "system@example.test" : email, sendToSystemMailbox: mode === "system" }),
  getProgramEducationEmailMessageTemplate: () => "",
  document: { querySelector: () => { throw new Error("Never focus student Email for chair problems"); } },
  alert: (message) => alerts.push(message), confirm: (message) => { confirmations.push(message); return true; },
  inspectDocumentTemplateSource: async (request) => { calls.push(request); return inspection; },
  getStudentCardDocumentTemplate: () => template,
  collectContractTemplateSourceValues: (student) => ({ "ФИО": student.name }),
  getContractTemplateRawSourceValue: (key, student) => student.workflowSourceValues?.[key] ?? (key === "ФИО" ? student.name : ""),
  getContractTemplateSourceValue: (key, student) => student.workflowSourceValues?.[key] ?? (key === "ФИО" ? student.name : ""),
  getEducationDocumentTrainingPlanRows: () => [], contractTemplateFieldDefaults: []
});
vm.runInContext([
  "normalizeProgramName", "getStudentContextProgram", "getProgramCommissionSetById", "normalizeEmployeeActPersonName",
  "getAttestationChairRecipient", "normalizeDocumentCustomPropertyName", "normalizeDocumentCustomPropertyValue",
  "getDocumentInspectionCustomProperties", "getDocumentEmailPropertiesFromInspection", "applyDocumentEmailTemplateMarkers",
  "prepareStudentDocumentEmailRequest", "loadStudentProtocolEmailTemplate", "prepareAttestationProtocolEmailRequest",
  "prepareStudentAttestationDocumentRecord", "formatStudentGradeSheetDisciplines", "formatEmployeeContractShortName",
  "normalizeContractTemplateField", "normalizeContractTemplateDocumentFields", "getContractFormulaDocumentReferences",
  "findContractTemplateFormulaCycle", "validateContractTemplateFormulaGraph", "evaluateContractTemplateFields",
  "evaluateContractTemplateField", "evaluateContractFormulaFallback", "isGetSqlQueryFormula",
  "resolveContractTemplateDateFormulaValue", "unwrapContractTemplateFormulaParentheses",
  "resolveContractTemplateFioFormulaValue", "inflectContractNamePartDative", "isChecked",
  "splitFullName", "inferStudentGender", "normalizeFioGender", "inflectRussianNamePart", "inflectRussianSimpleNamePart", "matchNameLetterCase"
].map(extract).join("\n"), c);
async function main() {
  const before = JSON.stringify(template);
  let loaded = await c.loadStudentProtocolEmailTemplate(template);
  assert.equal(calls[0].templateUrl, template.templateUrl);
  assert.equal(JSON.stringify(template), before, "Saved formulas/settings are not overwritten");
  assert.equal(loaded.fields, template.fields);
  assert.equal(loaded.emailTemplateValues.Other, "Preserved");
  const scoped = c.prepareStudentAttestationDocumentRecord(record, "studentAttestationProtocol");
  const fields = c.evaluateContractTemplateFields(scoped, loaded.fields);
  assert.equal(fields["ИО"], "Пётр Петрович", "Empty imported formula must not erase the chair's name");
  assert.equal(fields["ИОФ"], "Иван Иванович Слушатель", "Evaluate the actual saved Assistant formula before preview");
  let request = c.prepareStudentDocumentEmailRequest(loaded, scoped, fields, { "ФИО": record.name, ...scoped.workflowSourceValues });
  assert.equal(request.recipient, "chair@example.test");
  assert.match(request.recipientDescription, /председателя комиссии/);
  assert.match(confirmations[0], /chair@example.test/); assert.doesNotMatch(confirmations[0], /learner@example.test/);
  assert.equal(request.subject, "Протокол: " + record.name);
  assert.match(request.message, /Пётр Петрович, здравствуйте!/);
  assert.match(request.message, /Пользователь — Иван Иванович Слушатель/);
  assert.doesNotMatch(request.message, /СКЛОНЕНИЕ_ФИО|#ИОФ#|#ИО#/);
  assert.match(request.message, /https:\/\/example.test\/report/);
  assert.match(request.message, /<img src=/); assert.doesNotMatch(request.message, /#ФИО#|\[Логотип\]/);
  const batch = await c.prepareAttestationProtocolEmailRequest(record);
  assert.equal(batch.message, request.message); assert.equal(batch.recipient, request.recipient);
  const femaleRequest = await c.prepareAttestationProtocolEmailRequest({...record, name:"Пащенко Мария Александровна", gender:"Женский"});
  assert.match(femaleRequest.message, /Пётр Петрович, здравствуйте!/);
  assert.match(femaleRequest.message, /Пользователь — Мария Александровна Пащенко/);
  assert.doesNotMatch(femaleRequest.message, /СКЛОНЕНИЕ_ФИО|#ИОФ#|#ИО#/);
  assert.equal(c.evaluateContractTemplateField({name:"ИО",formula:"=[Обращение]"}, {...scoped,workflowSourceValues:{...scoped.workflowSourceValues,"Обращение":"Уважаемый председатель"}}, {}), "Уважаемый председатель", "Do not overwrite an explicit user formula");
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
