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
  "getAttestationChairRecipient", "getAttestationTaskProblem", "getAttestationTaskFingerprint", "refreshAttestationTaskSnapshot",
  "withAttestationStudentLock", "executeAttestationTask", "previewAttestationTask", "renderAttestationDashboardTile"];
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
  assert.equal(result.saved,true);assert.equal(result.eventSaved,true);assert.equal(result.emailed,true);assert.equal(result.blob,undefined);
  assert.equal(c.calls.find(x=>x.action==="send").request.email,"chair@example.test");
  assert.notEqual(c.calls.find(x=>x.action==="send").request.email,"learner@example.test");
  assert.equal(c.calls.find(x=>x.action==="event").key,"examSheetPrepared");
  assert.ok(c.calls.findIndex(x=>x.action==="generate")<c.calls.findIndex(x=>x.action==="event"));
  assert.ok(c.calls.findIndex(x=>x.action==="event")<c.calls.findIndex(x=>x.action==="send"));
  const options=c.calls.find(x=>x.action==="generate").options;
  assert.equal(options.skipEmail,true);assert.equal(options.requireStorage,true);assert.equal(options.storageRequest.promptLocalSave,false);assert.equal(options.storageRequest.autoSaveLocal,true);
  assert.equal(c.calls.filter(x=>x.action==="lock").at(-1).operation,"release");
  c=harness();c.local=false;result={};await c.executeAttestationTask(itemFor(c,"one","studentAttestationProtocol"),{sendEmail:false},result);
  assert.equal(c.calls.find(x=>x.action==="event").key,"macro_protocol");
  assert.equal(c.calls.find(x=>x.action==="generate").options.storageRequest.saveToYandexDisk,true);
  assert.equal(c.calls.some(x=>x.action==="send"),false);
  for(const flag of ["saveFails","cancelled","lockFails"]){
    c=harness();c[flag]=true;result={};
    try{await c.executeAttestationTask(itemFor(c),{sendEmail:true},result);}catch(e){assert.match(e.message,/Сохранение|занята/);}
    assert.equal(c.calls.some(x=>x.action==="event"||x.action==="send"),false,flag);
  }
  c=harness();c.sendFails=true;result={};item=itemFor(c);
  await assert.rejects(c.executeAttestationTask(item,{sendEmail:true},result),/отправка письма не подтверждена/);
  assert.equal(result.saved,true);assert.equal(result.eventSaved,true);assert.equal(c.isAttestationTaskCompleted(c.state.data.collections.students[0],item.definition),true);
  c.sendFails=false;await c.executeAttestationTask(item,{sendEmail:true},result);
  assert.equal(c.calls.filter(x=>x.action==="generate").length,1,"Retry email without regenerating a saved document");
  c=harness();c.sendFails=true;result={};item=itemFor(c);
  await assert.rejects(c.executeAttestationTask(item,{sendEmail:true},result));
  c.sendFails=false;c.state.data.collections.students[0].finalGrade="Хорошо";
  await assert.rejects(c.executeAttestationTask(itemFor(c),{sendEmail:true},result),/Старый файл не отправлен/);
  assert.equal(c.calls.filter(x=>x.action==="send").length,1,"A new confirmation cannot authorize an outdated cached attachment");
  c=harness();c.changeRecipientDuringGeneration=true;result={};
  await assert.rejects(c.executeAttestationTask(itemFor(c),{sendEmail:true},result),/изменились данные или адрес/);
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
  const script=setup+names.map(extract).join("\n")+extract("openAttestationTasksDialog")+dashboardFixture+`
    render=function(){document.querySelector('#tiles').innerHTML=renderFixtureDocumentTasks();document.querySelector('[data-action="open-attestation-tasks"]').onclick=openAttestationTasksDialog;};render();
    var realSend=sendServerEmail;sendServerEmail=async function(request){const result=await realSend(request);document.querySelector('#calls').textContent=calls.map(c=>c.action+(c.kind?' '+c.kind:'')).join(', ');sendFails=false;document.querySelector('#failure').checked=false;return result;};
    document.querySelector('#failure').onchange=e=>{sendFails=e.target.checked;};
    document.querySelector('#issued').onchange=e=>{state.data.collections.students[0].diplomaBlankNo=e.target.checked?'ТЕСТ-1':'';render();};
    document.querySelector('#narrow').onclick=()=>{const host=document.querySelector('#tiles');host.style.maxWidth=host.style.maxWidth?'':'900px';};
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('[data-attestation-tasks]')?.closeAttestationTasks();});
  `;
  const http=require("node:http");const server=http.createServer((req,res)=>{
    if(req.url==="/styles.css"){res.setHeader("Content-Type","text/css");return res.end(fs.readFileSync(path.join(root,"styles.css")));}
    res.setHeader("Content-Type","text/html; charset=utf-8");res.end(`<!doctype html><html lang="ru"><title>Итоговые документы — тест</title><link rel="stylesheet" href="/styles.css"><body style="padding:20px"><h2>Вымышленные данные. Реальные письма не отправляются</h2><label><input id="failure" type="checkbox">Ошибка первой отправки</label><label><input id="issued" type="checkbox" checked>Документ первого слушателя выдан</label><button id="narrow">Сузить рабочую область</button><div id="tiles" style="margin-top:16px"></div><pre id="calls"></pre><script>${script}</script></body></html>`);
  });server.listen(0,"127.0.0.1",()=>console.log('Attestation dashboard fixture: http://127.0.0.1:'+server.address().port+'/'));
}).catch(error=>{console.error(error);process.exitCode=1;});
