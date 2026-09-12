const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
const authSource = fs.readFileSync(path.resolve(__dirname, "..", "auth-bootstrap.js"), "utf8");
const indexSource = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, "Не найдено начало блока: " + startMarker);
  assert.ok(end > start, "Не найден конец блока: " + endMarker);
  return source.slice(start, end).replace(/^  /gmu, "");
}

let nextId = 0;
const context = {
  STUDENT_DUPLICATE_PERSONAL_FIELD_KEYS: [
    "name", "phone", "email", "customerEmail", "workPlace", "position",
    "employmentCategory", "ovzStatus", "birthDate", "citizenship",
    "passportNumber", "educationDocumentNumber", "login", "password",
    "portalAccess", "portalNotes", "nameEnglish", "registrationAddress",
    "mailingAddress", "photoPath", "photoData", "photoUrl"
  ],
  PROGRAM_DUPLICATE_FIELD_KEYS: [
    "name", "nameEnglish", "shortName", "status", "price", "type", "hours", "landingCode",
    "promoMessage1", "emailMessageTemplate", "commissionSetId"
  ],
  PROGRAM_DUPLICATE_TRAINING_PLAN_FIELD_KEYS: [
    "discipline", "description", "theoryHours", "practiceHours",
    "attestation", "teacher", "materials", "content"
  ],
  DEFAULT_STUDENT_ADDITIONAL_STATUS: "На зачисление (пока без документов)",
  clone: (value) => JSON.parse(JSON.stringify(value)),
  normalizeProgramName: (value) => String(value || "").replace(/\s+/gu, " ").trim().toLowerCase(),
  normalizeProgramRecord: (value) => ({ ...value }),
  normalizeProgramAuthorPayments: (values, source) => (Array.isArray(values)
    ? values.map((item) => ({ ...item }))
    : String(source || "").split(",").filter(Boolean).map((recipient, index) => ({
        id: `legacy-${index}`,
        recipient: recipient.trim(),
        amountFormula: "[АвторскаяСтавка]"
      }))),
  formatProgramAuthorPaymentSource: (values) => values.map((item) => item.recipient).join(", "),
  makeId: (prefix) => `${prefix}-new-${++nextId}`
};
vm.createContext(context);
vm.runInContext(
  extractBetween(
    appSource,
    "  function copyDuplicateFieldValue",
    "\n  function buildEmployeeContractDuplicateDraft"
  ) + `
this.buildStudentDuplicateDraftForTest = buildStudentDuplicateDraft;
this.buildProgramDuplicateDraftForTest = buildProgramDuplicateDraft;
this.buildProgramDuplicateTrainingPlanRowsForTest = buildProgramDuplicateTrainingPlanRows;`,
  context
);

const sourceStudent = {
  id: "student-17",
  uid: "1171",
  name: "Иванова Мария Петровна",
  nameEnglish: "Maria Ivanova",
  phone: "+7 900 000-00-00",
  email: "student@example.test",
  customerEmail: "customer@example.test",
  workPlace: "Школа № 1",
  position: "Учитель",
  employmentCategory: "Работает",
  ovzStatus: "Нет",
  birthDate: "1990-02-03",
  citizenship: "Россия",
  passportNumber: "1111 222222",
  educationDocumentNumber: "12345",
  login: "m.ivanova",
  password: "secret",
  portalAccess: "+",
  portalNotes: "Одна учётная запись для нескольких программ",
  registrationAddress: "Москва",
  mailingAddress: "101000, Москва",
  photoPath: "\\Слушатели\\Иванова\\photo.jpg",
  photoData: "data:image/jpeg;base64,AAA",
  photoUrl: "/lms/api/student-photo?id=17",
  status: "Учится",
  additionalStatus: "Осваивает программу",
  program: "Исходная программа",
  studyForm: "Заочная",
  educationType: "КПК",
  hours: 72,
  applicationDate: "2026-01-01",
  startDate: "2026-02-01",
  endDate: "2026-04-01",
  extendedEndDate: "2026-04-15",
  fundingSource: "За счет организации",
  contractNo: "Д-17",
  contractAmount: 15000,
  payment1Amount: 15000,
  enrollmentOrderNo: "17",
  finalGrade: "Отлично",
  diplomaBlankNo: "Б-17",
  directExpenses: [{ id: "expense-17", amount: 1000 }],
  event_portalCredentialsSent_state: "+",
  sourceApplicationKey: "order:17",
  sourceOrderId: "17",
  databaseSync: { recordId: "student-17" },
  databaseSyncSourceRow: 42,
  databaseSyncFormulaFields: ["hours"],
  databaseFixedValueOverrides: ["contractAmount"],
  __syncComment: "service"
};
const sourceStudentSnapshot = JSON.parse(JSON.stringify(sourceStudent));
const studentDraft = context.buildStudentDuplicateDraftForTest(sourceStudent);

[
  "name", "nameEnglish", "phone", "email", "customerEmail", "workPlace",
  "position", "employmentCategory", "ovzStatus", "birthDate", "citizenship",
  "passportNumber", "educationDocumentNumber", "login", "password",
  "portalAccess", "portalNotes", "registrationAddress", "mailingAddress",
  "photoPath", "photoData", "photoUrl"
].forEach((fieldName) => {
  assert.equal(studentDraft[fieldName], sourceStudent[fieldName], "Не перенесено персональное поле: " + fieldName);
});
assert.equal(studentDraft.status, "На зачисление");
assert.equal(studentDraft.additionalStatus, context.DEFAULT_STUDENT_ADDITIONAL_STATUS);
assert.equal(studentDraft.program, "");
assert.equal(studentDraft.studyForm, "");
assert.equal(studentDraft.educationType, "");
assert.equal(studentDraft.hours, "");
assert.equal(studentDraft.applicationDate, "");
assert.equal(studentDraft.startDate, "");
assert.equal(studentDraft.endDate, "");
assert.equal(studentDraft.extendedEndDate, "");
assert.equal(studentDraft.fundingSource, "Собственные средства");
assert.deepEqual(Array.from(studentDraft.directExpenses), []);
[
  "id", "uid", "contractNo", "contractAmount", "payment1Amount",
  "enrollmentOrderNo", "finalGrade", "diplomaBlankNo",
  "event_portalCredentialsSent_state", "sourceApplicationKey", "sourceOrderId",
  "databaseSync", "databaseSyncSourceRow", "databaseSyncFormulaFields",
  "databaseFixedValueOverrides", "__syncComment"
].forEach((fieldName) => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(studentDraft, fieldName),
    false,
    "В новую карточку слушателя перенесено служебное/операционное поле: " + fieldName
  );
});
assert.deepEqual(sourceStudent, sourceStudentSnapshot, "Исходная карточка слушателя изменилась.");

const sourceProgram = {
  id: "program-1",
  name: "Охрана труда (72 ч)",
  nameEnglish: "Occupational safety (72 h)",
  shortName: "Охрана труда",
  status: "Действует",
  price: 9000,
  type: "КПК",
  hours: 72,
  landingCode: "ot-72",
  commissionSetId: "commission-set-main",
  promoMessage1: "Описание программы",
  emailMessageTemplate: "Письмо",
  authorSource: "Иванов И.И.",
  author: "Иванов И.И.",
  defaultAuthorPaymentPercent: 50,
  authorPayments: [{ id: "program-author-old", recipient: "Иванов И.И.", amountFormula: "50%" }],
  xlsbProgramName: "Охрана труда (72 ч)",
  xlsbProgramLandingCode: "ot-72",
  xlsbProgramRow: 25,
  promoMessage1Provided: true,
  promoMessage1Touched: true,
  providedFields: ["name", "hours"],
  productId: "woocommerce-product-17",
  landingPosition: 3,
  databaseSync: { recordId: "program-1" },
  databaseSyncSourceRow: 25,
  databaseSyncFormulaFields: ["hours"],
  databaseFixedValueOverrides: ["price"],
  __syncComment: "service"
};
const sourceProgramSnapshot = JSON.parse(JSON.stringify(sourceProgram));
const existingPrograms = [
  sourceProgram,
  { name: "Копия — Охрана труда (72 ч)", shortName: "Копия — Охрана труда" },
  { name: "Копия 2 — Охрана труда", shortName: "Копия 2 — Охрана труда (72 ч)" }
];
const programDraft = context.buildProgramDuplicateDraftForTest(sourceProgram, existingPrograms);

assert.equal(programDraft.name, "Копия 3 — Охрана труда (72 ч)");
assert.equal(programDraft.nameEnglish, sourceProgram.nameEnglish);
assert.equal(programDraft.shortName, "Копия 3 — Охрана труда");
assert.match(programDraft.name, /\(72 ч\)$/u, "Суффикс с часами должен остаться в конце названия.");
assert.equal(programDraft.status, sourceProgram.status);
assert.equal(programDraft.price, sourceProgram.price);
assert.equal(programDraft.hours, sourceProgram.hours);
assert.equal(programDraft.commissionSetId, sourceProgram.commissionSetId);
assert.equal(
  programDraft.landingCode,
  sourceProgram.landingCode,
  "Вариация программы должна сохранить общий код лендинга."
);
assert.equal(programDraft.promoMessage1, sourceProgram.promoMessage1);
assert.equal(programDraft.emailMessageTemplate, sourceProgram.emailMessageTemplate);
assert.equal(programDraft.authorPayments.length, 1);
assert.equal(programDraft.authorPayments[0].recipient, "Иванов И.И.");
assert.equal(programDraft.authorPayments[0].amountFormula, "50%");
assert.notEqual(programDraft.authorPayments[0].id, sourceProgram.authorPayments[0].id);
assert.equal(programDraft.authorSource, "Иванов И.И.");
[
  "id", "xlsbProgramName", "xlsbProgramLandingCode", "xlsbProgramRow",
  "promoMessage1Provided", "promoMessage1Touched", "databaseSync",
  "databaseSyncSourceRow", "databaseSyncFormulaFields",
  "databaseFixedValueOverrides", "__syncComment", "providedFields",
  "productId", "landingPosition", "defaultAuthorPaymentPercent"
].forEach((fieldName) => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(programDraft, fieldName),
    false,
    "В копию программы перенесено служебное поле: " + fieldName
  );
});
assert.deepEqual(sourceProgram, sourceProgramSnapshot, "Исходная программа изменилась.");

const savedProgramCopy = { id: "program-copy", ...programDraft };
const applicationProgramContext = {
  state: {
    data: {
      collections: {
        programs: [savedProgramCopy, sourceProgram]
      }
    }
  },
  getStudentApplicationInferredProgramType: (row) => row.inferredType,
  studentApplicationProgramMatchesInferredType: (program, inferredType) => (
    !inferredType || program.type === inferredType
  ),
  resolveStoredStudentApplicationProgram: () => null,
  getStudentApplicationProgramTitle: (row) => row.programTitle,
  normalizeProgramName: context.normalizeProgramName,
  normalizeStudentApplicationProgramName: context.normalizeProgramName,
  getStudentApplicationProgramHours: () => 72
};
applicationProgramContext.getProgramRows = () => (
  applicationProgramContext.state.data.collections.programs
);
vm.createContext(applicationProgramContext);
vm.runInContext(
  extractBetween(
    appSource,
    "  function getStudentApplicationProgram(row, selectedProgramId = \"\")",
    "\n  function getStudentApplicationProgramRecommendation"
  ) + "\nthis.getStudentApplicationProgramForTest = getStudentApplicationProgram;",
  applicationProgramContext
);
const sharedLandingMatch = applicationProgramContext.getStudentApplicationProgramForTest({
  productId: sourceProgram.landingCode,
  programTitle: sourceProgram.name,
  inferredType: sourceProgram.type
});
assert.equal(
  sharedLandingMatch?.id,
  sourceProgram.id,
  "При общем лендинге точное название должно выбирать нужную вариацию, а не первую запись."
);

const sourcePlanRows = [
  {
    id: "plan-1",
    programId: "program-1",
    programName: sourceProgram.name,
    code: "7",
    discipline: "Раздел 1",
    description: "Описание",
    theoryHours: 20,
    practiceHours: 10,
    totalHours: 777,
    attestation: "Зачёт",
    teacher: "Петров П.П.",
    materials: "Пособие",
    content: "Темы",
    databaseSync: { recordId: "plan-1" },
    databaseSyncSourceRow: 81,
    databaseSyncFormulaFields: ["theoryHours"],
    databaseFixedValueOverrides: ["practiceHours"],
    xlsbTrainingPlanRow: 81,
    __syncComment: "service"
  }
];
const sourcePlanSnapshot = JSON.parse(JSON.stringify(sourcePlanRows));
const planDraft = context.buildProgramDuplicateTrainingPlanRowsForTest(sourcePlanRows, programDraft.name);
assert.equal(planDraft.length, 1);
assert.equal(planDraft[0].id, "");
assert.equal(planDraft[0].programId, "");
assert.equal(planDraft[0].programName, programDraft.name);
assert.equal(planDraft[0].code, "1");
[
  "discipline", "description", "theoryHours", "practiceHours", "attestation",
  "teacher", "materials", "content"
].forEach((fieldName) => {
  assert.equal(planDraft[0][fieldName], sourcePlanRows[0][fieldName], "Не скопировано поле учебного плана: " + fieldName);
});
[
  "databaseSync", "databaseSyncSourceRow", "databaseSyncFormulaFields",
  "databaseFixedValueOverrides", "xlsbTrainingPlanRow", "__syncComment"
].forEach((fieldName) => {
  assert.equal(Object.prototype.hasOwnProperty.call(planDraft[0], fieldName), false);
});
assert.deepEqual(sourcePlanRows, sourcePlanSnapshot, "Исходный учебный план изменился.");

let nextPlanId = 0;
const syncState = {
  data: {
    collections: {
      trainingPlans: JSON.parse(JSON.stringify(sourcePlanRows))
    }
  }
};
const planSyncContext = {
  state: syncState,
  normalizeOptionalNumber: (value) => String(value ?? "").trim() === "" ? "" : Number(value),
  calculateTrainingPlanTotalHours: (theory, practice) => Number(theory || 0) + Number(practice || 0),
  makeId: (prefix) => `${prefix}-new-${++nextPlanId}`,
  studentDatabaseFixedValuesEqual: (left, right) => String(left ?? "") === String(right ?? ""),
  isTrainingPlanRowLinkedToProgram: (item, program) => {
    const programId = String(program?.id || "");
    const rowProgramId = String(item?.programId || "");
    if (programId && rowProgramId) return programId === rowProgramId;
    if (rowProgramId) return false;
    return String(item?.programName || "").trim().toLowerCase()
      === String(program?.name || "").trim().toLowerCase();
  }
};
vm.createContext(planSyncContext);
vm.runInContext(
  extractBetween(
    appSource,
    "  function collectProgramTrainingPlanRows",
    "\n  function saveFormRecord"
  ) + "\nthis.syncProgramTrainingPlanRowsForTest = syncProgramTrainingPlanRows;",
  planSyncContext
);
const duplicatePlanInputs = Object.entries(planDraft[0]).map(([fieldName, value]) => ({
  dataset: { planField: fieldName },
  type: ["theoryHours", "practiceHours", "totalHours"].includes(fieldName) ? "number" : "text",
  value: String(value ?? "")
}));
const duplicatePlanForm = {
  dataset: { config: "programs" },
  querySelectorAll: (selector) => {
    assert.equal(selector, "[data-program-training-plan-row]");
    return [{
      querySelectorAll: (fieldSelector) => {
        assert.equal(fieldSelector, "[data-plan-field]");
        return duplicatePlanInputs;
      }
    }];
  }
};
planSyncContext.syncProgramTrainingPlanRowsForTest(
  duplicatePlanForm,
  "program-copy",
  { name: programDraft.name },
  {}
);
assert.equal(syncState.data.collections.trainingPlans.length, 2);
assert.deepEqual(
  syncState.data.collections.trainingPlans[0],
  sourcePlanRows[0],
  "Сохранение копии не должно удалять или перепривязывать исходную строку плана."
);
const savedPlanCopy = syncState.data.collections.trainingPlans[1];
assert.equal(savedPlanCopy.id, "trainingPlans-new-1");
assert.equal(savedPlanCopy.programId, "program-copy");
assert.equal(savedPlanCopy.programName, programDraft.name);
assert.equal(savedPlanCopy.totalHours, 30);
assert.deepEqual(Array.from(savedPlanCopy.databaseFixedValueOverrides), ["practiceHours", "theoryHours"]);
assert.deepEqual(Array.from(savedPlanCopy.databaseSyncFormulaFields), []);

const studentModalSource = extractBetween(
  appSource,
  "  function renderStudentModal",
  "\n  function getStudentCardTitle"
);
const studentPrimaryActionsSource = extractBetween(
  studentModalSource,
  '<div class="student-card-primary-actions">',
  '<div class="student-card-secondary-actions">'
);
assert.match(appSource, /data-action="copy-program-with-training-plan"[\s\S]{0,320}<span>Дублировать<\/span>/u);
assert.match(appSource, /data-action="copy-student-new-enrollment"[\s\S]{0,360}<span>Дублировать<\/span>/u);
assert.match(studentModalSource, /student-card-secondary-actions[\s\S]{0,900}data-action="copy-student-new-enrollment"/u);
assert.doesNotMatch(studentPrimaryActionsSource, /data-action="copy-student-new-enrollment"/u);
assert.match(appSource, /function copyProgramWithTrainingPlan\([\s\S]*?getProgramTrainingPlanRows\(source\)[\s\S]*?duplicateTrainingPlanRows/u);
assert.match(appSource, /function copyStudentForNewEnrollment\([\s\S]*?buildStudentDuplicateDraft\(source\)/u);
assert.match(appSource, /function renderProgramTrainingPlanSection\(record, rowsOverride = null\)/u);
assert.match(appSource, /Array\.isArray\(state\.modal\?\.duplicateTrainingPlanRows\)/u);
assert.match(appSource, /const APPLICATION_RELEASE = Object\.freeze\(\{\s*version: "1\.7\.427"/u);
assert.match(authSource, /20260912-multiple-document-outputs-v1/u);
assert.match(indexSource, /20260912-multiple-document-outputs-v1/u);

console.log("Program and student duplication checks: OK");
