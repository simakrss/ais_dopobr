"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
function extract(name) {
  let start = app.indexOf(`  function ${name}(`);
  if (start < 0) start = app.indexOf(`  async function ${name}(`);
  const next = /\n  (?:async )?function /g;
  next.lastIndex = start + 1;
  const end = next.exec(app)?.index;
  assert.ok(start >= 0 && end > start, name);
  return app.slice(start, end);
}
function array(name) {
  const start = app.indexOf(`  const ${name} = [`);
  return app.slice(start, app.indexOf("\n  ];", start) + 5);
}
const functions = ["getCardFieldFormulaBinding", "getCardFieldFormula", "setCardFieldFormula", "refreshCardFormulaValues", "bindCardFormulaRecalculation", "validateCardFieldFormula", "buildContractPortalCredentials", "applyStudentCommunicationTemplate", "resolveStudentCommunicationFormulaConditions", "isStudentCommunicationFormulaConditionTrue"];
const source = [array("dataFormulaDefaults"), array("dataFormulaTokenDefinitions"), array("studentCommunicationMessages"), array("employeeCommunicationMessages"), ...functions.map(extract)].join("\n");
const definitions = [{name: "СообщениеДоступаКарточки", formula: "Логин {ЛогинКарточки}; пароль {ПарольКарточки}; {ФИОКарточки}"}];
const state = {data: {dictionaries: {dataFormulas: [], communicationTemplates: ["А", "Б"], employeeCommunicationTemplates: ["В"], communicationTemplateFieldOverrides: {ДругойБлок: "Сохранить"}}}, modal: {draft: {name: "Черновик", note: "Не терять"}, autoFormulaFields: []}};
let generated = {note1: "Старый результат", note2: "Второй результат"};
const context = {
  state, Event: class { constructor(type) {this.type = type;} }, queueMicrotask,
  getStudentCommunicationAddressee: record => record.name || "",
  formatStudentCommunicationDate: value => value || "",
  getCommunicationTemplateFieldDefinitions: () => definitions.map(d => ({...d, formula: state.data.dictionaries.communicationTemplateFieldOverrides[d.name] ?? d.formula})),
  normalizeDataFormulaTemplates: values => values,
  normalizeCommunicationTemplates: values => [...values], normalizeEmployeeCommunicationTemplates: values => [...values],
  getCardGeneratedFormulaValues: () => generated,
  parseOrdersSdoDate: value => value ? new Date(value) : null,
  getGeneratedNumberFromDataFormula: (_key, date) => ({value: `№-${date.getUTCDate()}`})
};
vm.createContext(context);
vm.runInContext(source + "\nthis.numberDefaults = dataFormulaDefaults;", context);
state.data.dictionaries.dataFormulas = context.numberDefaults.map(d => ({...d}));
function form(config) {
  return {dataset: {config, id: "test-record"}, isConnected: true, elements: {}, events: {}, addEventListener(type, callback) {this.events[type] = callback;}};
}
function control(card, name, value = "") {
  const input = {name, value, dataset: {}, closest: selector => selector === "#recordForm" ? card : null,
    hasAttribute: () => false, dispatchEvent: event => card.events[event.type]?.({...event, target: input})};
  card.elements[name] = input;
  return input;
}
const student = form("students"), employee = form("contracts");
for (const definition of context.numberDefaults) assert.equal(context.getCardFieldFormulaBinding(control(student, definition.targetField)).key, definition.key);
assert.equal(context.getCardFieldFormulaBinding(control(employee, "contractNo")), null, "Employee incrementing numbers must not use student formulas");
assert.equal(context.getCardFieldFormulaBinding(control(student, "name")), null);
assert.equal(context.getCardFieldFormulaBinding(control(form("programs"), "note1")), null);
assert.equal(context.getCardFieldFormulaBinding(control(student, "portalAccessMessage")).index, 12);
assert.equal(context.getCardFieldFormulaBinding(control(employee, "message9")).index, 8);
const portalBinding = context.getCardFieldFormulaBinding(control(employee, "portalCredentials"));
assert.equal(portalBinding.kind, "field");
const numberBinding = context.getCardFieldFormulaBinding(student.elements.contractNo);
const originalSecondNumber = state.data.dictionaries.dataFormulas[1].template;
context.setCardFieldFormula(numberBinding, "ДОГ-{Год1}");
assert.equal(context.getCardFieldFormula(numberBinding), "ДОГ-{Год1}");
assert.equal(state.data.dictionaries.dataFormulas[1].template, originalSecondNumber);
const messageBinding = context.getCardFieldFormulaBinding(control(student, "note1"));
state.data.dictionaries.communicationTemplates[1] = "Чужая новая правка";
context.setCardFieldFormula(messageBinding, "Новая формула");
assert.deepEqual(state.data.dictionaries.communicationTemplates, ["Новая формула", "Чужая новая правка"]);
context.setCardFieldFormula(portalBinding, "Доступ: {ЛогинКарточки} / {ПарольКарточки}");
assert.equal(state.data.dictionaries.communicationTemplateFieldOverrides.ДругойБлок, "Сохранить");
assert.equal(context.buildContractPortalCredentials({login:"user",password:"pass"}), "Доступ: user / pass");
assert.equal(context.buildContractPortalCredentials({login:"user",password:"pass",portalCredentials:"Своя правка"}), "Своя правка");
assert.equal(context.buildContractPortalCredentials({login:"user",password:"changed",portalCredentials:"Своя правка"},{regenerate:true}), "Доступ: user / changed");
assert.equal(context.buildContractPortalCredentials({}), "");
context.setCardFieldFormula(portalBinding, "{КупонКарточки}; {НомерДоговораКарточки}; {ПредметДоговораКарточки}");
assert.equal(context.buildContractPortalCredentials({login:"user",coupon:"TEST",contractNo:"7",subject:"Вебинар"}), "TEST; 7; Вебинар");
assert.match(context.validateCardFieldFormula(numberBinding, "{Ошибка}"), /Неизвестный/);
assert.match(context.validateCardFieldFormula(numberBinding, ""), /Укажите/);
assert.equal(context.validateCardFieldFormula(numberBinding, "{Год1}{Месяц2}-{День2}"), "");
assert.match(context.validateCardFieldFormula(messageBinding, "{{если:ЕстьИмя}}текст"), /Закройте/);
assert.equal(context.validateCardFieldFormula(messageBinding, "{{если:ЕстьИмя}}Да{{иначе}}Нет{{конец}}"), "");
control(student, "note1", generated.note1);
control(student, "note2", "Ручной текст");
context.bindCardFormulaRecalculation(student);
generated = {note1:"Новый результат", note2:"Новый второй результат"};
context.refreshCardFormulaValues(student);
assert.equal(student.elements.note1.value, "Новый результат");
assert.equal(student.elements.note2.value, "Ручной текст");
context.refreshCardFormulaValues(student, {forceField:"note2"});
assert.equal(student.elements.note2.value, "Новый второй результат");
assert.equal(state.modal.draft.note, "Не терять");
assert.equal(state.modal.draft.name, "Черновик");
control(student, "contractDate", "2026-09-14");
state.modal.autoFormulaFields = ["contractNo"];
context.refreshCardFormulaValues(student);
assert.equal(student.elements.contractNo.value, "№-14");
student.elements.contractDate.value = "2026-09-15";
context.refreshCardFormulaValues(student);
assert.equal(student.elements.contractNo.value, "№-15");
context.getCardGeneratedFormulaValues = card => ({note1: `Договор ${card.elements.contractNo.value}`});
context.refreshCardFormulaValues(student, {forceField:"note1"});
student.elements.contractDate.value = "2026-09-16";
context.refreshCardFormulaValues(student);
assert.equal(student.elements.note1.value, "Договор №-16", "Dependent messages must see the recalculated number in the same update");
context.getCardGeneratedFormulaValues = () => generated;
assert.deepEqual(state.modal.autoFormulaFields, ["contractNo"], "Internal updates must not disable calculation");
student.elements.contractDate.value = "";
context.refreshCardFormulaValues(student);
assert.equal(student.elements.contractNo.value, "", "No silently substituted current date");
student.elements.contractNo.value = "Ручной-9";
student.events.input({target:student.elements.contractNo});
assert.equal(state.modal.autoFormulaFields.length, 0);
student.isConnected = false;
context.refreshCardFormulaValues(student, {forceField:"note1"});
assert.equal(student.elements.contractNo.value, "Ручной-9");
const editor = extract("openCardFieldFormulaSettings");
assert.doesNotMatch(editor, /state\.view\s*=|\brender\(\)|saveRecordForm/);
assert.match(editor, /getCardFieldFormula\(binding\) !== baseline/);
assert.match(editor, /flushSharedApplicationStateThroughGeneration\(generation\)/);
assert.match(editor, /canAccessView\("settings"\)/);
assert.match(editor, /isDatabaseDemoMode\(\)/);
assert.match(extract("showFieldCopyPopup"), /data-action="edit-card-field-formula"/);
for (const name of ["saveCommunicationTemplateField", "deleteCommunicationTemplateField", "restoreCommunicationTemplateField"]) {
  assert.match(extract(name), /if \(refreshCardAfterCommunicationFormulaChange\(\)\) return;/, `${name}: nested settings must preserve the card DOM`);
}
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
assert.match(css, /\.contract-documents-tab \.contract-form-grid textarea\[name="address"\] \{[^}]*height: 36px/);
assert.match(css, /\.contract-documents-tab \.orders-sdo-message \{[^}]*height: 112px/);
assert.match(css, /\.contract-documents-tab \.contract-passport-section \.contract-form-grid \{\s*grid-template-columns: repeat\(4/);
console.log("Card formulas: binding, permissions, isolated settings merge, validation, employee portal templates, dependent updates, manual overrides, missing dates and draft preservation: OK");

module.exports = {extract, array, app, root};

// Synthetic, loopback-only fixture for checking the real editor/section markup.
// All persistence and communication are replaced; production records are never read.
if (process.argv.includes("--serve")) {
  const browserFunctions = [...functions, "getCardGeneratedFormulaValues", "openCardFieldFormulaSettings", "renderDataFormulaDictionary", "bindDataFormulaConstructor", "syncDataFormulaEditor", "refreshDataFormulaEditor", "bindCommunicationTemplateFieldDialogFields", "syncCommunicationTemplateFormulaEditor", "refreshCommunicationTemplateFormulaEditor", "renderContractSdoSection", "renderOrdersSdoControl", "renderContractSection", "showFieldCopyPopup", "hideFieldCopyPopup", "handleFieldCopyPopupOutside",
    "serializeCommunicationTemplateEditor", "renderDataFormulaEditorContent", "renderCommunicationTemplateFormulaEditorContent", "renderCommunicationTemplateSyntax", "renderCommunicationTemplateFieldToken", "getCommunicationTemplateEditorCaretOffset", "setCommunicationTemplateEditorCaretOffset", "showCommunicationTemplateFieldMenu", "hideCommunicationTemplateFieldMenu", "closeCommunicationTemplateFieldMenuOnOutsideClick", "renderCommunicationTemplateFieldActionIcon", "showCommunicationTemplateFieldDialog", "sortCommunicationTemplateFieldDefinitions", "saveCommunicationTemplateField", "refreshCardAfterCommunicationFormulaChange", "restoreCommunicationTemplateField", "getCommunicationTemplateNodeStartOffset"];
  const browserSource = [array("dataFormulaDefaults"), array("dataFormulaTokenDefinitions"), array("studentCommunicationMessages"), array("employeeCommunicationMessages"), ...browserFunctions.map(extract)].join("\n");
  const browserSetup = `
    const state = {data:{dictionaries:{dataFormulas:[],communicationTemplates:Array(13).fill('Здравствуйте, {ФИОКарточки}! Логин: {ЛогинКарточки}'),employeeCommunicationTemplates:Array(9).fill('Здравствуйте, {ФИОКарточки}! Купон: {КупонКарточки}'),communicationTemplateFieldOverrides:{}}},modal:{draft:{},autoFormulaFields:[]}};
    const params = new URLSearchParams(location.search);
    let sharedStateChangeGeneration = 0, lastKnownClipboardText = '';
    const noop = () => {};
    const canAccessView = () => !params.has('noAccess'), isDatabaseDemoMode = () => false, isSettingsDraftSessionActive = () => false;
    const persist = () => {sharedStateChangeGeneration++}, addAudit = noop;
    const flushSharedApplicationStateThroughGeneration = async () => !params.has('offline');
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const escapeAttr = escapeHtml, unique = values => [...new Set(values)];
    const normalizeDataFormulaTemplates = values => dataFormulaDefaults.map(d=>({...d,...values.find(v=>v.key===d.key)}));
    const normalizeCommunicationTemplates = values => values, normalizeEmployeeCommunicationTemplates = values => values;
    const getCommunicationTemplateFieldDefinitions = () => [
      {name:'ФИОКарточки',formula:'{ФИОКарточки}'}, {name:'ЛогинКарточки',formula:'{ЛогинКарточки}'}, {name:'ПарольКарточки',formula:'{ПарольКарточки}'}, {name:'КупонКарточки',formula:'{КупонКарточки}'},
      {name:'СообщениеДоступаКарточки',formula:'Доступ к порталу https://portal.edu-plus.ru\\n\\nЛогин: {ЛогинКарточки}\\nПароль: {ПарольКарточки}'}
    ].map(d=>({...d,initialFormula:d.formula,formula:state.data.dictionaries.communicationTemplateFieldOverrides[d.name]??d.formula}));
    const normalizeCommunicationTemplateFieldName = value => value, getCommunicationTemplateFieldAlias = value => value, replaceCommunicationTemplateFieldAliases = value => value;
    const collectCommunicationTemplateFormDraft = noop, render = () => {throw Error('Card was unexpectedly re-rendered')};
    const getStudentCommunicationAddressee = record => record.name || '';
    const formatStudentCommunicationDate = value => value || '';
    const collectStudentFormDraft = () => Object.fromEntries(new FormData(document.getElementById('recordForm')));
    const collectContractFormDraft = collectStudentFormDraft;
    const generateStudentCommunicationMessages = record => Object.fromEntries(studentCommunicationMessages.map((m,i)=>[m.key,applyStudentCommunicationTemplate(state.data.dictionaries.communicationTemplates[i],{ФИОКарточки:record.name,ЛогинКарточки:record.login})]));
    const generateEmployeeCommunicationMessages = record => Object.fromEntries(employeeCommunicationMessages.map((m,i)=>[m.key,applyStudentCommunicationTemplate(state.data.dictionaries.employeeCommunicationTemplates[i],{ФИОКарточки:record.name,КупонКарточки:record.coupon})]));
    const parseOrdersSdoDate = value => value ? new Date(value) : null;
    const evaluateDataFormula = (formula,date) => formula.replaceAll('{Год1}',String(date.getFullYear()).slice(-1)).replaceAll('{Месяц2}',String(date.getMonth()+1).padStart(2,'0')).replaceAll('{День2}',String(date.getDate()).padStart(2,'0')).replaceAll('{ПорядковыйНомерЗаДату}','1');
    const getGeneratedNumberFromDataFormula = (key,date) => ({value:evaluateDataFormula(normalizeDataFormulaTemplates(state.data.dictionaries.dataFormulas).find(d=>d.key===key).template,date)});
    const getDataFormulaDateFieldLabel = () => 'Дата договора';
    const initializeCommunicationTemplateEditorHistory = noop, recordCommunicationTemplateEditorChange = noop, handleCommunicationTemplateEditorHistoryKeydown = () => false, commitCommunicationTemplateEditorChange = noop;
    const createCommunicationTemplateBlock = token => {const span=document.createElement('span');span.textContent=token;return span;};
    const createDataFormulaBlock = createCommunicationTemplateBlock;
    const renderOrdersSdoIcon = () => '<svg class="orders-sdo-icon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14"/></svg>';
    const renderCommunicationActionIcon = renderOrdersSdoIcon;
    const hideStudentDocumentRecognitionFieldMenu = noop, initializeFieldControlHistory = noop;
    const isFieldEditHistoryControl = control => !control.readOnly, canUndoFieldControl = () => false, canRedoFieldControl = () => false;
    const canPasteControlValue = () => false, readFieldClipboardText = async () => '', clamp = (x,min,max) => Math.max(min,Math.min(max,x));
    const copyTextToClipboard = noop, getControlCopyValue = control => control.value;
    const chooseUnsavedChangesAction = async () => 'discard';
    const fields = [['citizenship','Гражданство','text','Россия'],['birthDate','Дата рождения','date','1988-01-01'],['identityDocumentType','Документ','text','Паспорт'],['identityDocument','Серия и номер','text','0000 000000'],['identityIssueDate','Дата выдачи','date','2020-01-01'],['identityDepartmentCode','Код подразделения','text','000-000'],['snils','СНИЛС','text','000-000-000 00'],['inn','ИНН','text','000000000000'],['identityIssuer','Кем выдан','text','Отдел МВД России'],['address','Адрес регистрации','textarea','г. Москва, ул. Примерная, дом 1, квартира 2']];
    const renderContractFieldList = () => '<div class="form-grid contract-form-grid">'+fields.map(([key,label,type,value])=>'<label data-field-key="'+key+'"><span>'+label+'</span>'+(type==='textarea'?'<textarea name="'+key+'" rows="2">'+value+'</textarea>':'<input name="'+key+'" type="'+type+'" value="'+value+'">')+'</label>').join('')+'</div>';
    const card=document.getElementById('recordForm');
    if(card.dataset.config==='contracts') {
      document.getElementById('cardSections').innerHTML=renderContractSection('Паспортные данные',[],{},'contract-passport-section')+renderContractSdoSection({login:'test.teacher',password:'example',type:'Услуги'});
    } else {
      document.getElementById('cardSections').innerHTML='<label>Дата договора<input name="contractDate" type="date" value="2026-09-14"></label><label>Номер договора<input name="contractNo" value="609-14/ДО-1"></label><label>Логин<input name="login" value="student.test"></label><label>Сообщение<textarea name="note1" rows="5">Здравствуйте, Тестовая Карточка! Логин: student.test</textarea></label>';
    }
    card.addEventListener('submit',e=>e.preventDefault());
    card.querySelectorAll('input,textarea').forEach(input=>input.addEventListener('contextmenu',e=>{e.preventDefault();showFieldCopyPopup(input,e.clientX,e.clientY)}));
    bindCardFormulaRecalculation(card);
  `;
  const server = require("node:http").createServer((req,res)=>{
    const url = new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/styles.css'){res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'});return res.end(fs.readFileSync(path.join(root,'styles.css')));}
    if(url.pathname!=='/'){res.writeHead(404);return res.end();}
    const student = url.searchParams.has('student');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка карточки</title><link rel="stylesheet" href="/styles.css"><body><div class="modal-backdrop"><section class="modal contract-modal"><form id="recordForm" data-config="'+(student?'students':'contracts')+'" data-id="fixture"><header class="modal-head"><h2>Тестовая Карточка — '+(student?'слушатель':'сотрудник')+'</h2><button type="button" class="primary-button">Сохранить</button></header><input name="name" value="Тестовая Карточка" style="margin:8px"><input name="coupon" value="TEST15" hidden><div class="student-tabs"><button class="active" type="button">Документы, СДО</button></div><main class="contract-card-main"><div class="contract-documents-tab"><div class="student-document-recognition-toolbar"><button type="button" class="ghost-button">Загрузить из почты</button><button type="button" class="ghost-button">Распознать из папки</button></div><div id="cardSections" class="contract-documents-tab"></div></div></main></form></section></div><script>'+browserSource+'\n'+browserSetup+'</script></body></html>');
  });
  server.listen(0,'127.0.0.1',()=>console.log('Visual fixture: http://127.0.0.1:'+server.address().port+'/'));
}
