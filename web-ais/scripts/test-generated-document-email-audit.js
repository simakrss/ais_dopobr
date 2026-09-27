"use strict";
// Exercise production generation -> mail -> scoped audit with synthetic records.
// SMTP, conversion, storage and audit persistence are all in-memory; no real mail is sent.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/g, "\n");
const server = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n?/g, "\n");
const extract = (source, name, indent = "") => {
  const match = source.match(new RegExp(`^${indent}(?:async )?function ${name}\\([\\s\\S]*?^${indent}}$`, "m"));
  assert.ok(match, name); return match[0];
};
const clientCode = ["downloadStudentDocumentFromTemplate", "sendServerEmail", "prepareDocumentStorageRequestForEmail"].map(name => extract(app, name, "  ")).join("\n");
const serverCode = ["handleServerEmail", "handleAuditRequest", "auditText", "auditFilterText", "parseAuditBoundary", "auditRowMatches", "getAuditFilters", "getAuditFilterOptions"].map(name => extract(server, name)).join("\n");

function fixture({ outcome = "success", recipientMode = "student", recipient = "person@example.test", previewDecision = "send", conversionError = false } = {}) {
  const rows = [], requests = []; let sends = 0;
  const backend = vm.createContext({
    Buffer, console: { warn() {} }, serverEmailRateLimits: new Map(), MAX_EMAIL_SUBJECT_LENGTH: 200,
    readJsonBody: async req => req.body, normalizeEmailSubject: value => String(value).trim(),
    normalizeServerEmailAttachments: body => body.attachment ? [body.attachment] : body.attachments || [],
    sendEmailThroughConfiguredMailbox: async () => {
      sends++;
      if (outcome !== "success") throw Object.assign(new Error("Тестовая ошибка SMTP"), {deliveryUnknown: outcome === "unknown"});
      return {login: "sender@example.test"};
    },
    safelyAppendAuditEntry: async row => rows.push({...row, createdAt: "2026-09-27T12:00:00Z", user: "test-manager"}),
    readAuditRows: async () => rows,
    sendJson: (res, status, payload) => Object.assign(res, {status, payload}),
    sendError: (res, status, error) => Object.assign(res, {status, payload: {ok: false, error}})
  });
  vm.runInContext(serverCode, backend);
  const state = {modal: {config: "contracts", id: "unrelated-card", draft: {name: "Другая карточка"}}};
  const emailRequest = () => ({recipient, recipientMode, recipientDescription: recipient, subject: "Тестовый документ", message: "Документ приложен"});
  const c = vm.createContext({
    state, queueMicrotask,
    window: {AIS_DOCUMENT_WORKFLOW: {getGenerationDateValues: () => ({})}},
    document: {querySelector: () => null},
    getCurrentContractCardValue: () => state.modal?.draft?.name || "", getCurrentStudentCardValue: () => state.modal?.draft?.name || "",
    normalizeServerEmailSubject: value => String(value).trim(),
    resolveServerEmailRecipient: (email, _event, mode) => ({recipient: mode === "system" ? "system@example.test" : email, sendToSystemMailbox: mode === "system"}),
    beginDocumentGeneration: () => "job", endDocumentGeneration() {}, getDocumentGenerationSignal: () => null,
    getDocumentGenerationRequestOptions: () => ({}), throwIfDocumentGenerationCancelled() {}, setDocumentGenerationStatus() {},
    awaitDocumentGenerationStage: async (_id, fn) => fn(),
    isChecked: Boolean, normalizeDocumentGenerationFormat: () => "pdf", normalizeDocumentEmailDeliveryMode: () => recipientMode,
    getStudentAttestationDocumentUnavailableReason: () => "", prepareStudentAttestationDocumentRecord: record => record,
    loadStudentProtocolEmailTemplate: async template => template,
    evaluateContractTemplateFields: () => ({}), collectContractTemplateSourceValues: () => ({}),
    ensureGeneratedDocumentFileName: () => "Документ.pdf", applyContractTemplateMarkers: value => value,
    getAdditionalDocumentStorageRequests: () => [], getEffectiveLocalDocumentsMode: () => true,
    prepareStudentDocumentEmailRequest: emailRequest,
    resolveDocumentProcessingOrigin: async () => {state.modal = {config: "students", id: "opened-during-generation", draft: {name: "Новое окно"}}; return "https://example.test";},
    requestGeneratedDocumentPreview: async () => ({blob: "pdf", previewToken: "token", fileName: "Документ.pdf"}),
    showGeneratedDocumentPreview: async () => true,
    showGeneratedDocumentEmailPreview: async () => previewDecision === "skip" ? {skipEmail: true} : previewDecision === "cancel" ? null : emailRequest(),
    cancelGeneratedDocumentPreview: async () => {}, prepareStudentDocumentStorageRequest: async () => ({}), documentProcessingApiUrl: url => url,
    fetchWithTimeout: async (url, options, _timeout, _message, consume) => {
      const body = JSON.parse(options.body);
      if (url === "send-mail.php") {
        requests.push(body); const res = {};
        await backend.handleServerEmail({headers: {"x-requested-with":"AIS-Web"}, socket: {remoteAddress:"fixture"}, body}, res, {login:"test-manager"});
        return consume({ok: res.status === 200, status: res.status, text: async () => JSON.stringify(res.payload)});
      }
      if (conversionError) throw Error("Тестовый сбой генерации");
      return consume({ok: true, headers: {get: () => null}, blob: async () => "pdf"});
    },
    getGeneratedDocumentResponseDetails: () => ({fileName: "Документ.pdf", outputFormat: "pdf"}),
    finishStudentDocumentGeneration: async () => ({localSaveResult: {saved: true}}),
    createStudentDocumentEmailAttachment: async () => ({fileName: "Документ.pdf", contentType: "application/pdf", base64: "synthetic"}),
    markStudentContractEmailSent() {},
    addAudit: (action, area, details, context) => rows.push({...context, action, area, details, createdAt:"2026-09-27T12:00:00Z"}),
    showDocumentGenerationNotice() {}, alert() {}, confirm: () => true
  });
  vm.runInContext(clientCode, c);
  return {c, state, rows, requests, get sends() {return sends;},
    run: (record, options = {}, kind = "education") => c.downloadStudentDocumentFromTemplate({title:"Тестовый документ",templatePath:"fixture.docx",documentKind:kind,previewBeforeGeneration:true}, record, null, "Ошибка", {quietEmail:true,...options}),
    history: async (entityType, entityId) => {const res={};await backend.handleAuditRequest({method:"GET"},res,{role:"manager"},new URL(`https://example.test/api/students/audit?entityType=${entityType}&entityId=${entityId}`));assert.equal(res.status,200);return res.payload.items;}
  };
}

async function main() {
  for (const entityType of ["students","contracts"]) {
    const test=fixture(),record={id:`${entityType}-one`,name:`Тест ${entityType}`};
    const result=await test.run(record,{entityType},entityType==="contracts" ? "employeeContract" : "education");
    assert.equal(result.emailed,true,JSON.stringify({rows:test.rows,requests:test.requests,result}));assert.equal(test.sends,1);
    const items=await test.history(entityType,record.id), mail=items.filter(item=>item.source==="smtp");
    assert.equal(items.length,2,'Generation and confirmed email belong to the same history');assert.equal(mail.length,1,'No duplicate client email audit');
    assert.equal(mail[0].action,"Отправлено письмо");assert.equal(mail[0].entityLabel,record.name);
    assert.match(mail[0].details,/Получатель: person@example.test/);assert.match(mail[0].details,/Вложения: Документ.pdf/);assert.match(mail[0].details,/Тема: Тестовый документ/);
    assert.equal((await test.history("students","opened-during-generation")).length,0);
    const body=test.requests[0];assert.equal(body.auditContext.entityId,record.id);assert.equal(body.auditContext[entityType==="contracts" ? "contractId":"studentId"],record.id);
  }
  const bulk=fixture();bulk.state.modal=null;
  for(const id of ["bulk-a","bulk-b"]) {assert.equal((await bulk.run({id,name:id})).emailed,true);assert.equal((await bulk.history("students",id)).filter(row=>row.source==="smtp").length,1);}
  const system=fixture({recipientMode:"system"});await system.run({id:"employee-system",name:"Сотрудник"},{entityType:"contracts"},"employeeAct");
  assert.match((await system.history("contracts","employee-system")).find(row=>row.source==="smtp").details,/system@example.test \(системный ящик\)/);
  const chair=fixture({recipient:"chair@example.test"});await chair.run({id:"protocol-student",name:"Слушатель"},{},"studentAttestationProtocol");
  assert.match((await chair.history("students","protocol-student")).find(row=>row.source==="smtp").details,/chair@example.test/);
  for(const outcome of ["failure","unknown"]) {
    const test=fixture({outcome});const result=await test.run({id:"failed",name:"Тест"});assert.equal(result.emailed,outcome==="unknown" ? null:false);
    const rows=await test.history("students","failed");assert.equal(rows.filter(row=>row.action==="Отправлено письмо").length,0);assert.equal(rows.find(row=>row.source==="smtp").action,outcome==="unknown" ? "Отправка письма не подтверждена":"Ошибка отправки письма");
  }
  for(const previewDecision of ["skip","cancel"]) {const test=fixture({previewDecision});await test.run({id:"skipped",name:"Тест"});assert.equal(test.sends,0);assert.equal(test.rows.some(row=>row.source==="smtp"),false);}
  const disabled=fixture();await disabled.run({id:"no-email",name:"Тест"},{skipEmail:true});assert.equal(disabled.sends,0);
  const failed=fixture({conversionError:true});await failed.run({id:"bad-file",name:"Тест"});assert.equal(failed.sends,0);
  const unsaved=fixture();await unsaved.run({name:"Не сохранён"});assert.equal(unsaved.requests[0].auditContext.entityId,"");assert.equal((await unsaved.history("students","opened-during-generation")).length,0);
  const delayed=fixture();delayed.state.modal={id:"original-card",draft:{name:"Исходное имя"}};
  await delayed.c.sendServerEmail({email:"person@example.test",subject:"Тест",message:"Текст",skipConfirmation:true,quiet:true,prepareAttachment:async()=>{delayed.state.modal={id:"another-card",draft:{name:"Другое имя"}};return {fileName:"Файл.pdf"};}});
  assert.equal(delayed.requests[0].auditContext.entityId,"original-card");assert.equal(delayed.requests[0].auditContext.entityName,"Исходное имя");
  // Online PHP handler consumes the same canonical context and logs attachments after SMTP.
  const php=fs.readFileSync(path.join(root,"send-mail.php"),"utf8");
  assert.match(php,/\$entityId = ais_audit_text\([\s\S]*?\$auditContext\['entityId'\]/);
  assert.match(php,/send_smtp_mail\([\s\S]*?'action' => 'Отправлено письмо'[\s\S]*?'entityType' => \$entityType[\s\S]*?'entityId' => \$entityId[\s\S]*?\$attachmentAuditText/);
  console.log('PASS: generation -> SMTP audit -> card history; students/employees/bulk/chair/system, captured identity, attachments, no duplicate/false success, skip/cancel/errors, online context parity');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
