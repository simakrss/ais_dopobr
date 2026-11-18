"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
const c = vm.createContext({
  state: { data: { collections: { students: [] } } },
  isDatabaseDemoMode: () => false, getCurrentAuthUser: () => ({ role: "manager" }),
  escapeAttr: String, escapeHtml: String, escapeMultilineAttr: String, getEducationDocumentButtonTitle: () => "Сертификат",
  buildStudentDocumentGenerationTooltip: () => "Конверт", renderOrdersSdoIcon: () => "",
  studentAttestationDocumentTemplateDefinitions: [], renderStudentLayoutRemarks: () => ""
});
vm.runInContext(["studentCabinetProgramAllowed", "renderStudentPortalOpenButton", "renderEducationDocumentActions", "saveStudentAwardFile"].map(extract).join("\n"), c);
const marker = '      if (documentAuditContext.entityType === "students" && studentCabinetProgramAllowed(record)';
const start = source.indexOf(marker), end = source.indexOf('      setDocumentGenerationStatus(generationTaskId, `Завершение формирования:', start);
assert.ok(start >= 0 && end > start);
let uploaded = 0, warnings = 0;
c.saveStudentAwardFile = async () => uploaded++;
c.alert = () => warnings++;
c.setDocumentGenerationStatus = () => {};
c.getEducationDocumentTemplateForRecord = () => ({ id: "custom" });
c.generationTaskId = "test"; c.generatedBlob = {}; c.outputFormat = "pdf";
c.documentAuditContext = { entityType: "students", entityId: "s" };
(async () => {
  for (const type of ["ПРО", "КПК", "ППП", "ДОП", "", "ИТ"]) {
    const allowed = ["КПК", "ППП", "ДОП"].includes(type), record = { id: "s", educationType: type, studentPortalEnabled: true };
    assert.equal(Boolean(c.renderStudentPortalOpenButton(record)), allowed);
    const html = c.renderEducationDocumentActions(record);
    assert.equal(html.includes('data-action="upload-student-award-scan"'), allowed);
    assert.ok(html.includes('data-action="open-student-education-document"'), "Webinar certificate generation remains available");
    c.record = record;
    for (const id of ["education-document-certificate", "custom"]) {
      c.documentTemplate = { id }; uploaded = 0;
      await vm.runInContext(`(async () => {${source.slice(start, end)}})()`, c);
      assert.equal(uploaded, Number(allowed), `${type || "unknown"}: only qualifying programs save a cabinet layout`);
    }
  }
  assert.equal(warnings, 0, "Webinars skip cabinet saving without an erroneous failure alert");
  console.log("Cabinet program types: OK; staff controls and automatic layout saving exclude PRO and unknown types, certificate generation stays available.");
})().catch(error => { console.error(error); process.exitCode = 1; });
