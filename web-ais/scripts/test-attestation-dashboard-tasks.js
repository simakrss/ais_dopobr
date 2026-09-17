"use strict";
// Isolated state and transport: never generate real documents or send real email.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
const setup = `
var state={data:{meta:{},collections:{
 programs:[{id:'ppp',name:'Переподготовка',type:'ППП',commissionSetId:'c'},{id:'kpk',name:'Повышение квалификации',type:'КПК',commissionSetId:'c'},{id:'dop',name:'ДОП',type:'ДОП'},{id:'pro',name:'Вебинар',type:'ПРО'}],
 commissionSets:[{id:'c',commissionChair:'Петров Пётр Петрович, председатель'}],
 contracts:[{name:'Петров Петр Петрович',email:'chair@example.test'},{name:'Петров Пётр Петрович',email:'CHAIR@example.test'}],
 students:[{id:'one',name:'Альфаков Иван Иванович',programId:'ppp',program:'Переподготовка',email:'learner@example.test'},
 {id:'two',name:'Бетов Петр Петрович',programId:'kpk',program:'Повышение квалификации'},
 {id:'done',name:'Готовый',programId:'ppp',event_examSheetPrepared_state:'checked',event_macro_protocol_state:'dated',event_macro_protocol_date:'2026-09-17'},
 {id:'signed',name:'Подписанный',programId:'ppp',event_examSheetPrepared_state:'checked',event_signedProtocol_state:'checked'},
 {id:'other',name:'Прочий',programId:'dop'},{id:'webinar',name:'Вебинар',programId:'pro'},{id:'stale',name:'Удаленная программа',programId:'missing',program:'Переподготовка'}],trainingPlans:[]}}};
state.data.collections.students.forEach(student=>{student.diplomaBlankNo='БЛАНК-'+student.id;});
state.data.collections.students.push({id:'not-issued',name:'Без выдачи',programId:'ppp'},
 {id:'previous-education',name:'Только предыдущее образование',programId:'kpk',educationDocumentNumber:'12345',educationDocumentDate:'2020-01-01'},
 {id:'only-date',name:'Только дата',programId:'ppp',diplomaIssueDate:'2026-09-17'});
var sharedStateReady=true,sharedStateDirty=false,sharedStateSaveRunning=false,sharedStateChangeGeneration=0,sharedStateConflict=false;
var activeRecordLock=null,recordLockClientId='fixture',calls=[],sendFails=false,saveFails=false,cancelled=false,lockFails=false,denied=false,demo=false,local=true,changeRecipientDuringGeneration=false,failEventFlush=false,mutateSnapshot=null;
var studentDocumentsFolderTemplateMarker='#Папка документов слушателя#';
var template={id:'template',templateUrl:'fixture.docx',fields:[],generationFormat:'pdf',fileNameTemplate:'Тест'};
function unique(values){return [...new Set(values)];}
function canAccessView(){return !denied;} function isDatabaseDemoMode(){return demo;} function isSettingsDraftSessionActive(){return false;}
function getStudentEventTemplates(){return [{key:'examSheetPrepared',label:'Сформирована зачетно-экзаменационная ведомость'}, {key:'macro_protocol',label:'Сформирован протокол итоговой аттестации'}, {key:'signedProtocol',label:'Подписан протокол итоговой аттестации'}];}
function resolveProgramCommissionRecord(program){return {...program,...state.data.collections.commissionSets.find(c=>c.id===program.commissionSetId)};}
function getStudentCardDocumentTemplate(kind){return {...template,documentKind:kind};}
function getMissingStudentDocumentFields(){return [];}
function getEducationDocumentTrainingPlanRows(){return [{discipline:'Тест',attestation:'Зачет'}];}
function getStudentYandexDocumentsFolder(record){return 'Слушатели/'+record.id+'/Документы';}
function getEffectiveLocalDocumentsMode(){return local;}
function recordLockEntityType(value){return value;} function recordLockKey(type,id){return type+':'+id;}
async function requestSharedRecordLocks({body}){calls.push({action:'lock',operation:body.action,id:body.entityId});if(lockFails&&body.action==='acquire')throw Object.assign(new Error('busy'),{status:423});}
async function flushSharedApplicationStateThroughGeneration(){calls.push({action:'flush'});if(failEventFlush&&sharedStateDirty)return false;sharedStateDirty=false;return true;}
async function requestSharedApplicationState(){const data=JSON.parse(JSON.stringify(state.data));if(mutateSnapshot)mutateSnapshot(data);return {exists:true,writable:true,data};}
function applySharedApplicationState(payload){state.data=payload.data;}
function markStudentEventsCompleted(record,key,date,options){calls.push({action:'event',key,options});const target=state.data.collections.students.find(s=>s.id===record.id);target['event_'+key+'_state']='dated';target['event_'+key+'_date']='2026-09-17';sharedStateDirty=true;sharedStateChangeGeneration++;}
async function downloadStudentDocumentFromTemplate(template,record,button,title,options){calls.push({action:'generate',id:record.id,kind:template.documentKind,options});if(changeRecipientDuringGeneration)state.data.collections.contracts.forEach(p=>p.email='changed@example.test');return cancelled?{cancelled:true}:{generated:true,fileName:'Документ.pdf',outputFormat:'pdf',blob:'fixture-pdf',storageResult:saveFails?{}:(local?{localSaveResult:{saved:true}}:{yandexSaveResult:{saved:true}})};}
async function createStudentDocumentEmailAttachment(blob,fileName){return {fileName,base64:'TEST'};}
async function prepareAttestationProtocolEmailRequest(record){calls.push({action:'protocol-properties',id:record.id});return {subject:'Тема из свойств протокола',message:'Текст из свойств протокола: '+record.name,recipient:'chair@example.test'};}
async function sendServerEmail(request){calls.push({action:'send',request});return !sendFails;}
function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escapeAttr(value){return escapeHtml(value);}
function render(){} function alert(message){calls.push({action:'alert',message});}
function prepareStudentAttestationDocumentRecord(record){return {...record,workflowSourceValues:{}};}
function beginDocumentGeneration(){calls.push({action:'preview-start'});return 1;} function endDocumentGeneration(){calls.push({action:'preview-end'});}
async function resolveDocumentProcessingOrigin(){return 'fixture';}
async function requestGeneratedDocumentPreview(body){calls.push({action:'preview-request',body});return {blob:'fixture-preview',previewToken:'temporary'};}
function evaluateContractTemplateFields(){return {};} function collectContractTemplateSourceValues(){return {};}
function isChecked(value){return Boolean(value);}
async function showGeneratedDocumentPreview(blob,options){calls.push({action:'preview-show',options});return false;}
async function cancelGeneratedDocumentPreview(token){calls.push({action:'preview-cancel',token});}
`;
const names = ["normalizeProgramName", "getStudentContextProgram", "getProgramCommissionSetById", "normalizeEmployeeActPersonName", "hasStudentEducationDocumentIssued",
  "isExplicitUncheckedEventState", "normalizeEventState", "getStudentAttestationDocumentUnavailableReason",
  "getAttestationTaskDefinitions", "getAttestationTaskEventKeys", "isAttestationTaskCompleted", "getPendingAttestationRows",
  "getAttestationChairRecipient", "getAttestationTaskEmailRecipient", "getAttestationTaskEmailPlan", "getAttestationTaskProblem", "getAttestationTaskFingerprint", "refreshAttestationTaskSnapshot",
  "withAttestationStudentLock", "executeAttestationTask", "previewAttestationTask", "renderAttestationDashboardTile", "openAttestationTaskStudentCard"];
function harness() {
  const c=vm.createContext({window:{setInterval:()=>1,clearInterval:()=>{}}, console});
  vm.runInContext(setup+names.map(extract).join("\n"),c);
  return c;
}
function itemFor(c,id="one",kind="studentGradeSheet") {
  const record=c.state.data.collections.students.find(s=>s.id===id), definition=c.getAttestationTaskDefinitions().find(d=>d.kind===kind);
  return {studentId:id,definition,email:c.getAttestationChairRecipient(record).email,fingerprint:c.getAttestationTaskFingerprint(record,definition)};
}
async function main() {
  let c=harness();
  assert.equal(c.getPendingAttestationRows().length,3);
  assert.equal(c.getPendingAttestationRows().reduce((sum,row)=>sum+row.documents.length,0),4);
  assert.equal(c.getPendingAttestationRows().some(row=>['not-issued','previous-education','only-date'].includes(row.record.id)),false,"Only issued education documents, not earlier education or date alone");
  const registrationOnly={id:'registration-only',name:'Регистрационный номер',programId:'ppp',registrationNo:' 99 ',diplomaBlankNo:'  '};
  c.state.data.collections.students.push(registrationOnly);
  assert.equal(c.getPendingAttestationRows().find(row=>row.record.id==='registration-only').documents.length,2);
  registrationOnly.registrationNo='  ';
  assert.equal(c.getPendingAttestationRows().some(row=>row.record.id==='registration-only'),false);
  assert.match(c.getAttestationTaskProblem(registrationOnly,c.getAttestationTaskDefinitions()[0]),/выданного документа/);
  assert.equal(c.getPendingAttestationRows().find(row=>row.record.id==="signed").documents[0].kind,"studentAttestationProtocol","Signing is not generation");
  assert.equal(c.getAttestationChairRecipient(c.state.data.collections.students[0]).email,"chair@example.test","Deduplicate contracts and normalize ё/е");
  c.state.data.collections.contracts.push({name:"Петров Петр Петрович",email:"different@example.test"});
  assert.ok(c.getAttestationChairRecipient(c.state.data.collections.students[0]).error,"Ambiguous addresses must not be guessed");
  const definition=c.getAttestationTaskDefinitions()[1];
  assert.equal(c.isAttestationTaskCompleted({event_custom_label:"Сформирован протокол итоговой аттестации",event_custom_state:"checked"},definition),true);
  assert.equal(c.isAttestationTaskCompleted({event_macro_protocol_state:"unchecked",event_macro_protocol_date:"2026-01-01"},definition),false);
  c=harness();let result={};let item=itemFor(c);
  await c.executeAttestationTask(item,{sendEmail:true,previewEach:false},result);
  assert.equal(result.saved,true);assert.equal(result.eventSaved,true);assert.equal(result.emailed,undefined);assert.equal(result.blob,undefined);
  assert.equal(c.calls.some(x=>x.action==="send"),false,"PPP grade sheets must not be emailed even with a valid chair");
  assert.equal(c.calls.find(x=>x.action==="event").key,"examSheetPrepared");
  assert.ok(c.calls.findIndex(x=>x.action==="generate")<c.calls.findIndex(x=>x.action==="event"));
  const options=c.calls.find(x=>x.action==="generate").options;
  assert.equal(options.skipEmail,true);assert.equal(options.requireStorage,true);assert.equal(options.storageRequest.promptLocalSave,false);assert.equal(options.storageRequest.autoSaveLocal,true);
  assert.equal(c.calls.filter(x=>x.action==="lock").at(-1).operation,"release");
  c=harness();c.local=false;result={};await c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:false},result);
  assert.equal(c.calls.find(x=>x.action==="event").key,"macro_protocol");
  assert.equal(c.calls.find(x=>x.action==="generate").options.storageRequest.saveToYandexDisk,true);
  assert.equal(c.calls.some(x=>x.action==="send"),false);
  c=harness();result={};await c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:true},result);
  assert.equal(result.emailed,true);
  assert.equal(c.calls.find(x=>x.action==="send").request.subject,"Тема из свойств протокола");
  assert.match(c.calls.find(x=>x.action==="send").request.message,/Текст из свойств протокола/);
  assert.equal(c.calls.find(x=>x.action==="send").request.email,"chair@example.test");
  assert.ok(c.calls.findIndex(x=>x.action==="event")<c.calls.findIndex(x=>x.action==="send"));
  c=harness();result={};c.prepareAttestationProtocolEmailRequest=async()=>{throw new Error("Нет свойств протокола");};
  await assert.rejects(c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:true},result),/Нет свойств/);
  assert.equal(result.saved,true);assert.equal(c.calls.some(x=>x.action==="send"),false);
  c=harness();result={};c.prepareAttestationProtocolEmailRequest=async()=>{c.state.data.collections.contracts.forEach(p=>p.email="new@example.test");return {subject:"Тема",message:"Текст"};};
  await assert.rejects(c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:true},result),/изменились данные или адрес/);
  assert.equal(c.calls.some(x=>x.action==="send"),false,"Recheck the chair after loading Word properties");
  for (const commissionSetId of ["", "deleted-commission", "c"]) {
    c=harness();c.state.data.collections.programs.find(p=>p.id==="kpk").commissionSetId=commissionSetId;
    const learner=c.state.data.collections.students.find(s=>s.id==="two");learner.email="learner@example.test";
    const sheetDefinition=c.getAttestationTaskDefinitions()[0];
    assert.equal(c.getAttestationTaskProblem(learner,sheetDefinition),"");
    const recipient=c.getAttestationTaskEmailRecipient(learner,sheetDefinition);
    assert.equal(recipient.error,"");assert.equal(recipient.email,"");assert.match(recipient.skipReason,/ведомость/);
    if(commissionSetId!=="c")assert.ok(c.getAttestationTaskEmailRecipient(learner,c.getAttestationTaskDefinitions()[1]).error,"Protocol still requires a commission");
    result={};await c.executeAttestationTask(itemFor(c,"two"),{sendEmail:true},result);
    assert.equal(result.saved,true);assert.equal(result.eventSaved,true);assert.equal(result.emailed,undefined);
    assert.equal(result.blob,undefined);assert.match(result.message,/письмо председателю не отправляется/);
    assert.equal(c.calls.some(x=>x.action==="send"),false,"Never send a KPK grade sheet, with or without a commission");
    assert.equal(c.calls.find(x=>x.action==="generate").options.storageRequest.autoSaveLocal,true);
    assert.equal(c.calls.find(x=>x.action==="event").key,"examSheetPrepared");
    await c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:true},{});
    assert.equal(c.calls.filter(x=>x.action==="send").length,1,"Mixed batch sends only the document with a chair");
    assert.equal(c.calls.find(x=>x.action==="send").request.email,"chair@example.test");
  }
  c=harness();c.state.data.collections.programs.find(p=>p.id==="ppp").commissionSetId="";
  await assert.rejects(c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:true},{}),/комиссия/);
  assert.equal(c.calls.some(x=>x.action==="generate"||x.action==="send"),false,"PPP protocol requirements are preserved");
  c=harness();c.state.data.collections.contracts=[];
  await assert.rejects(c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:true},{}),/Email председателя/);
  assert.equal(c.calls.some(x=>x.action==="send"),false,"An assigned chair's invalid email is not silently ignored");
  result={};await c.executeAttestationTask(itemFor(c,"one"),{sendEmail:true},result);
  assert.equal(result.saved,true);assert.equal(c.calls.some(x=>x.action==="send"),false,"A chair email error must not block a grade sheet");
  c=harness();c.state.data.collections.programs.find(p=>p.id==="kpk").commissionSetId="";c.saveFails=true;
  await assert.rejects(c.executeAttestationTask(itemFor(c,"two"),{sendEmail:true},{}),/Сохранение/);
  assert.equal(c.calls.some(x=>x.action==="event"||x.action==="send"),false);
  for(const flag of ["saveFails","cancelled","lockFails"]){
    c=harness();c[flag]=true;result={};
    try{await c.executeAttestationTask(itemFor(c),{sendEmail:true},result);}catch(e){assert.match(e.message,/Сохранение|занята/);}
    assert.equal(c.calls.some(x=>x.action==="event"||x.action==="send"),false,flag);
  }
  c=harness();c.sendFails=true;result={};item=itemFor(c,"one","studentAttestationProtocol");
  await assert.rejects(c.executeAttestationTask(item,{sendEmail:true},result),/отправка письма не подтверждена/);
  assert.equal(result.saved,true);assert.equal(result.eventSaved,true);assert.equal(c.isAttestationTaskCompleted(c.state.data.collections.students[0],item.definition),true);
  c.sendFails=false;await c.executeAttestationTask(item,{sendEmail:true},result);
  assert.equal(c.calls.filter(x=>x.action==="generate").length,1,"Retry email without regenerating a saved document");
  c=harness();c.sendFails=true;result={};item=itemFor(c,"one","studentAttestationProtocol");
  await assert.rejects(c.executeAttestationTask(item,{sendEmail:true},result));
  c.sendFails=false;c.state.data.collections.students[0].finalGrade="Хорошо";
  await assert.rejects(c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:true},result),/Старый файл не отправлен/);
  assert.equal(c.calls.filter(x=>x.action==="send").length,1,"A new confirmation cannot authorize an outdated cached attachment");
  c=harness();c.changeRecipientDuringGeneration=true;result={};
  await assert.rejects(c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:true},result),/изменились данные или адрес/);
  assert.equal(result.saved,true);assert.equal(c.calls.some(x=>x.action==="send"),false);
  c=harness();item=itemFor(c);c.mutateSnapshot=data=>{data.collections.students[0].name="Чужая правка";};
  await assert.rejects(c.executeAttestationTask(item,{sendEmail:true},{}),/изменились/);
  assert.equal(c.calls.some(x=>x.action==="generate"||x.action==="send"),false);
  c=harness();item=itemFor(c);c.mutateSnapshot=data=>{data.collections.students[0].diplomaBlankNo='';};
  await assert.rejects(c.executeAttestationTask(item,{sendEmail:true},{}),/изменились/);
  assert.equal(c.calls.some(x=>x.action==="generate"||x.action==="send"),false,"Recheck issuance when confirmed data changes");
  c=harness();c.failEventFlush=true;result={};
  await assert.rejects(c.executeAttestationTask(itemFor(c),{sendEmail:true},result),/отметка события/);
  assert.equal(result.saved,true);assert.equal(c.calls.some(x=>x.action==="send"),false);
  c=harness();item=itemFor(c);c.activeRecordLock={key:"students:one"};
  await assert.rejects(c.executeAttestationTask(item,{sendEmail:true},{}),/закройте карточку/);
  assert.equal(c.calls.length,0,"Never release a card's unrelated active lock");
  c=harness();await c.previewAttestationTask(c.state.data.collections.students[0],c.getAttestationTaskDefinitions()[0]);
  assert.equal(c.calls.some(x=>["generate","event","send"].includes(x.action)),false);
  assert.equal(c.calls.find(x=>x.action==="preview-show").options.readOnly,true);
  assert.equal(c.calls.some(x=>x.action==="preview-cancel"),true);
  for (const kind of ["studentGradeSheet", "studentAttestationProtocol"]) {
    for (const outcome of ["saved", "cancelled", "saveFails"]) {
      c=harness();c.cancelled=outcome==="cancelled";c.saveFails=outcome==="saveFails";
      vm.runInContext(`function collectStudentFormDraft(){return state.data.collections.students[0];} function validateStudentDocumentRequiredFields(){return true;} `+extract("openStudentCardBoundDocument"),c);
      // The card uses the same generator without batch-only options.
      c.downloadStudentDocumentFromTemplate=async()=>({cancelled:c.cancelled,storageResult:c.cancelled||c.saveFails?{}:{localSaveResult:{saved:true}}});
      await c.openStudentCardBoundDocument(null,kind,"missing","error");
      assert.equal(c.calls.some(x=>x.action==="event"),outcome==="saved","Card generation marks events only after confirmed storage");
    }
  }
  c=harness();
  let observerCallback, disconnected=false, resumed=0;
  c.document={body:{}};
  c.MutationObserver=class {constructor(callback){observerCallback=callback;} observe(){} disconnect(){disconnected=true;}};
  c.openStudentCardById=async(id,ids)=>{assert.equal(id,"one");assert.ok(ids.includes("one"));c.state.modal={config:"students",id};};
  const cardSession={rows:c.getPendingAttestationRows(),selected:new Set(["one:studentAttestationProtocol"]),results:new Map([["one:studentAttestationProtocol",{saved:true,blob:"cached"}]]),running:false,busy:false};
  const backdrop={hidden:false};
  await c.openAttestationTaskStudentCard("one",backdrop,cardSession,()=>resumed++);
  assert.equal(backdrop.hidden,true);assert.equal(cardSession.busy,true);assert.equal(resumed,0);
  observerCallback();assert.equal(resumed,0,"An open card keeps the task list suspended");
  c.state.modal=null;observerCallback();
  assert.equal(resumed,1);assert.equal(disconnected,true);assert.equal(backdrop.hidden,false);assert.equal(cardSession.busy,false);
  assert.equal(cardSession.selected.size,1);assert.equal(cardSession.results.get("one:studentAttestationProtocol").blob,"cached","Returning from a card preserves saved attachments and selection");
  observerCallback();assert.equal(resumed,1,"Resume exactly once");
  c.openStudentCardById=async()=>{throw new Error("Test lock failure");};
  let openingError="";await c.openAttestationTaskStudentCard("one",backdrop,cardSession,error=>{openingError=error;});
  assert.equal(openingError,"Test lock failure");assert.equal(backdrop.hidden,false);assert.equal(cardSession.busy,false);
  cardSession.running=true;openingError="";await c.openAttestationTaskStudentCard("one",backdrop,cardSession,()=>{throw new Error("Should not open during generation");});
  assert.equal(backdrop.hidden,false);
  const dialogSource=extract("openAttestationTasksDialog");
  const gradeItem={definition:{kind:"studentGradeSheet"},email:"chair@example.test"};
  const protocolItem={definition:{kind:"studentAttestationProtocol"},email:"chair@example.test"};
  const fiveDocuments=[gradeItem,gradeItem,gradeItem,gradeItem,protocolItem];
  const mailPlan=c.getAttestationTaskEmailPlan(fiveDocuments,true);
  assert.equal(mailPlan.emailItems.length,1,"Five documents in the screenshot must produce only one protocol email");
  assert.equal(mailPlan.emailItems[0],protocolItem);assert.equal(mailPlan.saveOnlyCount,4);
  assert.equal(c.getAttestationTaskEmailPlan([gradeItem],true).emailItems.length,0,"Single-grade-sheet action never sends");
  assert.equal(c.getAttestationTaskEmailPlan(fiveDocuments,false).emailItems.length,0);
  assert.equal(c.getAttestationTaskEmailPlan([protocolItem,{...protocolItem,email:"other@example.test"}],true).emailItems.length,2);
  assert.match(dialogSource,/getAttestationTaskEmailPlan\(items, options.sendEmail\)/);
  assert.match(dialogSource,/row.documents.find\(\(definition\) => definition.kind === "studentAttestationProtocol"\)/,"Keep the protocol chair visible even when grade sheet is the first column");
  assert.match(dialogSource,/Отправить протоколы председателям комиссий/);
  assert.match(dialogSource,/Только сохранение в папки слушателей, без отправки писем/);
  assert.doesNotMatch(dialogSource,/Ведомости КПК без комиссии/);
  assert.match(extract("executeAttestationTask"),/const sendEmail = options.sendEmail && item.definition.kind === "studentAttestationProtocol"/);
  assert.match(dialogSource,/data-task-student/);assert.match(dialogSource,/input\.indeterminate = checkedCount > 0/);
  assert.match(dialogSource,/const requestedKeys = new Set\(onlyKey \? \[onlyKey\] : session.selected\)/);
  assert.match(dialogSource,/if \(!requestedKeys.has\(key\)/);
  assert.match(dialogSource,/requestGeneration\(button.dataset.taskGenerateOne\)/);
  assert.match(dialogSource,/openAttestationTaskStudentCard\(button.dataset.taskOpenStudent/);
  assert.match(extract("closeTopmostWindowByEscape"),/attestationTasks && !attestationTasks.hidden/);
  console.log("Attestation dashboard: counts/legacy flags, eligibility, chair deduplication, fresh snapshots, locks, save-before-event-before-email, failures/retries, preview-only and no learner-email fallback: OK");
}
main().then(()=>{
  if(!process.argv.includes("--serve"))return;
  const start=source.indexOf('      <div class="dashboard-document-tasks ');
  const end=source.indexOf('      <section class="panel">',start);
  assert.ok(start>0&&end>start);
  const dashboardFixture=`function renderFixtureDocumentTasks(){
    const pendingIssuedDocuments=Array(6).fill({}),frdoWidgetTone='',frdoDeadlineDays=30,overdueIssuedDocumentsCount=0;
    const frdoDeadlineLabel='До ближайшего срока: 28 дн.',frdoDaysIndicatorLabel='Осталось дней: 28';
    return \`${source.slice(start,end)}\`;
  }`;
  const fixtureSetup=setup+(process.argv.includes("--kpk-no-commission")?"state.data.collections.programs.find(p=>p.id==='kpk').commissionSetId='';":"");
  const script=fixtureSetup+names.map(extract).join("\n")+extract("openAttestationTasksDialog")+dashboardFixture+`
    render=function(){document.querySelector('#tiles').innerHTML=renderFixtureDocumentTasks();document.querySelector('[data-action="open-attestation-tasks"]').onclick=openAttestationTasksDialog;};render();
    var realSend=sendServerEmail;sendServerEmail=async function(request){const result=await realSend(request);document.querySelector('#calls').textContent=calls.map(c=>c.action+(c.kind?' '+c.kind:'')).join(', ');sendFails=false;document.querySelector('#failure').checked=false;return result;};
    document.querySelector('#failure').onchange=e=>{sendFails=e.target.checked;};
    document.querySelector('#issued').onchange=e=>{state.data.collections.students[0].diplomaBlankNo=e.target.checked?'ТЕСТ-1':'';render();};
    document.querySelector('#narrow').onclick=()=>{const host=document.querySelector('#tiles');host.style.maxWidth=host.style.maxWidth?'':'900px';};
    async function openStudentCardById(id){state.modal={config:'students',id};const card=document.createElement('div');card.dataset.fixtureCard='';card.className='modal-backdrop';card.innerHTML='<section class="modal" style="padding:24px"><h2>Карточка: '+escapeHtml(state.data.collections.students.find(s=>s.id===id).name)+'</h2><p>Тестовая карточка без записи в базу</p><button data-fixture-card-close class="primary-button">Закрыть карточку</button></section>';document.body.appendChild(card);card.querySelector('button').onclick=()=>{state.modal=null;card.remove();};}
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){const card=document.querySelector('[data-fixture-card]');if(card){state.modal=null;card.remove();}else document.querySelector('[data-attestation-tasks]:not([hidden])')?.closeAttestationTasks();}});
  `;
  const http=require("node:http");const server=http.createServer((req,res)=>{
    if(req.url==="/styles.css"){res.setHeader("Content-Type","text/css");return res.end(fs.readFileSync(path.join(root,"styles.css")));}
    res.setHeader("Content-Type","text/html; charset=utf-8");res.end(`<!doctype html><html lang="ru"><title>Итоговые документы — тест</title><link rel="stylesheet" href="/styles.css"><body style="padding:20px"><h2>Вымышленные данные. Реальные письма не отправляются</h2><label><input id="failure" type="checkbox">Ошибка первой отправки</label><label><input id="issued" type="checkbox" checked>Документ первого слушателя выдан</label><button id="narrow">Сузить рабочую область</button><div id="tiles" style="margin-top:16px"></div><pre id="calls"></pre><script>${script}</script></body></html>`);
  });server.listen(0,"127.0.0.1",()=>console.log('Attestation dashboard fixture: http://127.0.0.1:'+server.address().port+'/'));
}).catch(error=>{console.error(error);process.exitCode=1;});
