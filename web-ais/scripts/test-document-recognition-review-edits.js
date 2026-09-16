"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
const names = ["normalizeStudentDocumentRecognitionPreview", "normalizeStudentDocumentRecognitionPreviewReference",
  "normalizeStudentDocumentRecognitionPagePreview", "normalizeStudentDocumentRecognitionResult",
  "isContractDocumentRecognitionDialog", "collectStudentDocumentRecognitionEdits", "saveStudentDocumentRecognitionEdits",
  "applyStudentDocumentRecognition", "bindStudentDocumentRecognitionSelectAll", "isStudentRecognitionVisualFile",
  "isStudentRecognitionTextFile", "getStudentRecognitionPreviewKind", "storeStudentDocumentRecognitionTargetedField"];
function makeRow(key, value, checked = false) {
  const checkbox = {checked};
  const row = {dataset:{ocrRecognitionField:key}, querySelector:sel=>sel.includes("field-value")?input:sel.includes("field-enabled")?checkbox:null};
  const input = {value, matches:sel=>sel.includes("field-value"),closest:()=>row,focus(){}};
  return {row,input,checkbox};
}
function harness(contract = false) {
  const key = contract ? "address" : "registrationAddress";
  const collection = contract ? "contracts" : "students";
  const initial = {id:"test-1",name:"Тестовая карточка",[key]:"г. Москва",email:"kept@example.invalid"};
  const fields = [
    {key,value:initial[key],sourceFile:"Паспорт.pdf",confidence:0.9,previewReference:{page:2}},
    {key:"passportIssuer",value:"ОШИБКА OCR",sourceFile:"Паспорт.pdf",confidence:0.6},
    {key:"passportDate",value:"2020-01-01",sourceFile:"Паспорт.pdf",confidence:0.9},
    {key:"phone",value:"wrong",confidence:0.3}
  ];
  const controls = [makeRow(key,"г. Москва, ул. Тестовая, д. 15"),makeRow("passportIssuer","ОТДЕЛ МВД",false),makeRow("passportDate","21.05.2020",false),makeRow("phone","",false)];
  const payload = {recognizedAt:"2026-09-16T10:00:00Z",fields,files:[{fileName:"Паспорт.pdf",pagePreviews:[{page:2,mimeType:"image/jpeg",base64:"eA=="}]}]};
  const listeners = {};
  const allToggle = {addEventListener(){}};
  const dialog = {
    dataset:{documentRecognitionEntity:contract?"contract":"student",documentRecognitionRecordId:"test-1"},
    studentDocumentRecognitionPayload:payload,studentDocumentRecognitionFields:fields,
    querySelectorAll:sel=>sel==="[data-ocr-recognition-field]"?controls.map(c=>c.row):[],
    querySelector:sel=>sel==="[data-ocr-select-all-fields]"?allToggle:null,
    addEventListener:(name,fn)=>{listeners[name]=fn;},closeStudentDocumentRecognitionDialog(){this.closed=true;}
  };
  const state = {modal:{config:collection,id:"test-1",draft:{}},data:{collections:{students:contract?[]:[initial],contracts:contract?[initial]:[]}},tableSettings:{}};
  let saves=0;
  const context = vm.createContext({
    state, console, clamp:(v,min,max)=>Math.min(max,Math.max(min,v)),normalizeStudentPhotoRotation:v=>Number(v)||0,
    isStudentDocumentRecognitionFieldSourceCompatible:()=>true,
    normalizeStudentDocumentRecognitionPhotoCandidate:v=>v,
    getStudentDocumentRecognitionDateInputFormat:key=>key.endsWith("Date")?"ru":"",
    normalizeStudentDocumentRecognitionDate:v=>String(v).replace(/^(\d{2})\.(\d{2})\.(\d{4})$/,"$3-$2-$1"),
    collectStudentFormDraft:()=>({...initial,...state.modal.draft}),collectContractFormDraft:()=>({...initial,...state.modal.draft}),
    addAudit(){},persist(){saves++;},render(){},requestAnimationFrame:fn=>fn(),
    document:{querySelector:()=>null,getElementById:()=>({})},ensureRecordLockForSave:async()=>true,CSS:{escape:v=>v},alert:message=>{throw Error(message);},
    studentDocumentRecognitionFieldGroups:[{id:"passport",keys:[key,"passportIssuer","passportDate"]}],
    contractDocumentRecognitionFieldGroups:[{id:"passport",keys:[key]}],getStudentDocumentFieldTab:()=>"main"
  });
  vm.runInContext(names.map(extract).join("\n"),context);
  context.normalizeContractDocumentRecognitionResult = context.normalizeStudentDocumentRecognitionResult;
  return {context,state,dialog,controls,listeners,key,collection,getSaves:()=>saves};
}
async function main() {
  for (const contract of [false,true]) {
    const h=harness(contract),c=h.context;
    c.bindStudentDocumentRecognitionSelectAll(h.dialog);
    h.listeners.input({target:h.controls[0].input});
    assert.equal(h.controls[0].checkbox.checked,true,"Editing a conflicting address selects it for transfer");
    h.listeners.change({target:h.controls[1].input});
    assert.equal(h.controls[1].checkbox.checked,true,"Select controls also select changed fields");
    h.controls[1].checkbox.checked=false;
    const saved=c.saveStudentDocumentRecognitionEdits(h.dialog);
    assert.equal(saved.fields.find(f=>f.key===h.key).value,h.controls[0].input.value);
    assert.equal(saved.fields.find(f=>f.key==="passportIssuer").value,"ОТДЕЛ МВД");
    assert.equal(saved.fields.find(f=>f.key==="passportIssuer").selected,false,"Unchecked corrections are retained without being applied");
    assert.equal(saved.fields.find(f=>f.key==="passportDate").value,"2020-05-21");
    assert.equal(saved.fields.find(f=>f.key==="phone").value,"");
    assert.equal(h.state.data.collections[h.collection][0][h.key],"г. Москва","Saving OCR review never changes card address implicitly");
    assert.equal(h.state.data.collections[h.collection][0].email,"kept@example.invalid");
    assert.equal(saved.files[0].pagePreviews,undefined,"Shared result must not contain scanned document images");
    const cache=h.state[contract?"contractDocumentRecognitionPreviewCache":"studentDocumentRecognitionPreviewCache"];
    assert.equal(cache.result.files[0].pagePreviews.length,1,"Session cache retains document previews");
    const reopened=c.normalizeStudentDocumentRecognitionResult(JSON.parse(JSON.stringify(saved)));
    assert.equal(reopened.fields.find(f=>f.key===h.key).value,h.controls[0].input.value);
    const oldPayload={...h.dialog.studentDocumentRecognitionPayload,fields:[{key:"passportIssuer",value:"old"}]};
    c.storeStudentDocumentRecognitionTargetedField(h.dialog,oldPayload,{key:"passportIssuer",value:"NEW OCR"});
    assert.equal(h.state.modal.draft.documentRecognitionResult.fields.find(f=>f.key===h.key).value,h.controls[0].input.value,"Targeted OCR must preserve previously saved corrections");
    await c.applyStudentDocumentRecognition(h.dialog);
    assert.equal(h.state.modal.draft[h.key],h.controls[0].input.value);
    assert.equal(h.state.modal.draft.passportIssuer,undefined,"Unchecked field is not applied to card");
    assert.equal(h.state.modal.draft.documentRecognitionResult.fields.find(f=>f.key==="passportIssuer").value,"ОТДЕЛ МВД");
    assert.equal(h.dialog.closed,true);
    assert.ok(h.getSaves()>=2);
    h.state.modal.readOnly=true;
    assert.throws(()=>c.saveStudentDocumentRecognitionEdits(h.dialog),/только для чтения/);
    h.state.modal.readOnly=false;h.state.modal.id="another";
    assert.throws(()=>c.saveStudentDocumentRecognitionEdits(h.dialog),/Карточка/);
    c.isStudentDocumentRecognitionFieldSourceCompatible=()=>false;
    assert.ok(c.normalizeStudentDocumentRecognitionResult(saved).fields.some(f=>f.key===h.key),"Explicit corrections survive OCR source heuristics");
  }
  const c=harness().context;
  for (const fileName of ["СНИЛС.pdf","СНИЛС.JPG","Скан.tiff"]) {
    assert.equal(c.getStudentRecognitionPreviewKind({fileName,contentType:"application/octet-stream"}),"image");
  }
  assert.equal(c.getStudentRecognitionPreviewKind({fileName:"Инструкция.txt",contentType:"text/plain"}),"text");
  const previewBinding=extract("bindStudentDocumentRecognitionFieldPreviews");
  assert.match(previewBinding,/activeFilePosition === recommendedFilePosition/);
  assert.match(previewBinding,/activePage === fieldPreview.page/);
  assert.match(previewBinding,/showingFullPage \|\| activeField\?\.key === key/);
  assert.match(previewBinding,/if \(!preserveCurrentView\) \{[\s\S]*?previewLoadController\?\.abort\(\)/);
  const preservedExpression=previewBinding.match(/const preserveCurrentView = Boolean\(([\s\S]*?)\n      \);/)[1];
  const canPreserve=new Function("activeFilePosition","recommendedFilePosition","activePage","page","showingFullPage","oldKey","key",`
    const preserveView=true,activeInput={},popup={hidden:false},activeField={key:oldKey},field={},fieldPreview={page},image={hasAttribute:()=>true},view={baseWidth:200,baseHeight:300};return Boolean(${preservedExpression});`);
  assert.equal(canPreserve(0,1,1,1,true,"passportNumber","snils"),false,"Passport image cannot remain when SNILS is focused");
  assert.equal(canPreserve(0,0,1,2,true,"passportNumber","registrationAddress"),false,"Address page replaces passport first page");
  assert.equal(canPreserve(0,0,1,1,false,"passportNumber","passportDate"),false,"Cropped fragment cannot represent another field");
  assert.equal(canPreserve(0,0,1,1,true,"passportNumber","passportDate"),true,"Keep zoom on same full page");
  assert.match(extract("renderStudentDocumentRecognitionField"),/typeof field.selected === "boolean" \? field.selected/);
  console.log("PASS: OCR corrected address transfer, all-field persistence/reopen, dates, cache, identity guard, source heuristics, MIME fallback and preview switching");
}
function serveFixture() {
  const previewNames = ["normalizeStudentRecognitionFileName","getStudentRecognitionFileKey","findStudentRecognitionSourceFilePosition",
    "getStudentDocumentRecognitionPreviewFiles","findStudentDocumentRecognitionPagePreview","getStudentRecognitionRecommendedPage",
    "getStudentRecognitionPageRotation","clampStudentDocumentRecognitionPreviewPosition","getStudentDocumentRecognitionPreviewOverlap",
    "setStudentDocumentRecognitionPreviewPosition","positionStudentDocumentRecognitionPreview","bindStudentDocumentRecognitionFieldPreviews"];
  const start=source.indexOf('<aside class="student-document-recognition-preview"');
  const aside=source.slice(start,source.indexOf("</aside>",start)+8);
  assert.ok(start>0 && aside.includes("data-ocr-field-preview-image"));
  const script=`
    const state={modal:{config:"students",id:"fixture",draft:{}},data:{collections:{students:[{id:"fixture",name:"Тестовая карточка",registrationAddress:"г. Москва"}]}}};
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),normalizeStudentPhotoRotation=v=>Number(v)||0;
    const escapeHtml=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;"),escapeAttr=escapeHtml;
    const STUDENT_DOCUMENT_RECOGNITION_PREVIEW_POSITION_KEY="ocr-fixture-position",STUDENT_DOCUMENT_RECOGNITION_PREVIEW_SIZE_KEY="ocr-fixture-size";
    const isStudentDocumentRecognitionFieldSourceCompatible=()=>true,normalizeStudentDocumentRecognitionPhotoCandidate=v=>v;
    const getStudentDocumentRecognitionDateInputFormat=()=>"",getStudentDocumentFieldTab=()=>"main",ensureRecordLockForSave=async()=>true;
    const collectStudentFormDraft=()=>({...state.data.collections.students[0],...state.modal.draft}),collectContractFormDraft=collectStudentFormDraft;
    const addAudit=()=>{},persist=()=>{},hideStudentDocumentRecognitionFieldMenu=()=>{};
    const studentDocumentRecognitionFieldGroups=[{id:"passport",keys:["passportNumber","registrationAddress"]},{id:"identity",keys:["snils"]}];
    const normalizeInn=v=>v,formatSnils=v=>v,updateStudentDocumentRecognitionIdentityValidation=()=>true;
    ${names.map(extract).join("\n")}
    ${previewNames.map(extract).join("\n")}
    const normalizeContractDocumentRecognitionResult=normalizeStudentDocumentRecognitionResult;
    function makePreview(text,color,page){const canvas=document.createElement("canvas");canvas.width=600;canvas.height=400;const ctx=canvas.getContext("2d");ctx.fillStyle=color;ctx.fillRect(0,0,600,400);ctx.fillStyle="#172c29";ctx.font="bold 36px Arial";ctx.fillText(text,30,90);ctx.font="24px Arial";ctx.fillText("ТЕСТОВЫЙ ДОКУМЕНТ",30,160);return {page,mimeType:"image/jpeg",base64:canvas.toDataURL("image/jpeg").split(",")[1]};}
    const payload={recognizedAt:"2026-09-16T10:00:00Z",fields:[
      {key:"passportNumber",label:"Паспорт",value:"12 34 567890",sourceFile:"Паспорт.pdf",previewReference:{page:1}},
      {key:"registrationAddress",label:"Адрес регистрации",value:"г. Москва",sourceFile:"Паспорт.pdf",previewReference:{page:2}},
      {key:"snils",label:"СНИЛС",value:"123-456-789 00",sourceFile:"СНИЛС.pdf",previewReference:{page:1}}
    ],files:[{fileName:"Паспорт.pdf",contentType:"application/pdf",pageCount:2,pagePreviews:[makePreview("ПАСПОРТ — 1", "#d0eadd",1),makePreview("РЕГИСТРАЦИЯ — 2","#ecd2b4",2)]},{fileName:"СНИЛС.pdf",contentType:"application/octet-stream",pageCount:1,pagePreviews:[makePreview("СНИЛС — 1","#c5e3f5",1)]}]};
    function render(){document.querySelector('#card-address').textContent=collectStudentFormDraft().registrationAddress;}
    document.querySelector('#open').onclick=()=>{
      const edited=state.modal.draft.documentRecognitionResult||state.data.collections.students[0].documentRecognitionResult;
      const result={...payload,...edited,files:payload.files};
      const fields=result.fields,dialog=document.createElement('div');
      dialog.className='modal-backdrop student-document-recognition-backdrop';
      dialog.dataset.documentRecognitionEntity='student';dialog.dataset.documentRecognitionRecordId='fixture';
      dialog.studentDocumentRecognitionPayload=result;dialog.studentDocumentRecognitionFields=fields;
      dialog.innerHTML='<section class="modal student-document-recognition-modal"><header class="modal-head"><h2>Проверка распознавания</h2></header><div class="student-document-recognition-result"><label><input type="checkbox" data-ocr-select-all-fields> Выбрать все</label><p data-ocr-selected-fields-count></p>'+fields.map(field=>'<div class="student-document-recognition-field" data-ocr-recognition-field="'+field.key+'"><label><input type="checkbox" data-ocr-field-enabled '+(field.selected?'checked':'')+'>'+field.label+'</label><input aria-label="'+field.label+'" data-ocr-field-value value="'+escapeAttr(field.value)+'"></div>').join('')+'</div>'+${JSON.stringify(aside)}+'<footer class="modal-actions"><button id="fixture-close">Закрыть</button><button id="fixture-save">Сохранить исправления</button><button id="fixture-apply">Применить выбранное</button><span id="fixture-status"></span></footer></section>';
      document.body.append(dialog);dialog.closeStudentDocumentRecognitionDialog=()=>dialog.remove();
      bindStudentDocumentRecognitionSelectAll(dialog);bindStudentDocumentRecognitionFieldPreviews(dialog,fields,result);
      dialog.querySelector('#fixture-close').onclick=()=>dialog.remove();
      dialog.querySelector('#fixture-save').onclick=()=>{saveStudentDocumentRecognitionEdits(dialog);dialog.querySelector('#fixture-status').textContent='Исправления сохранены';};
      dialog.querySelector('#fixture-apply').onclick=()=>applyStudentDocumentRecognition(dialog);
    };render();
  `;
  const server=require("node:http").createServer((req,res)=>{
    if(req.url==="/styles.css"){res.setHeader("Content-Type","text/css");return res.end(fs.readFileSync(path.join(root,"styles.css")));}
    if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");return res.end(script);}
    res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<!doctype html><html lang="ru"><title>Проверка исправлений OCR</title><link rel="stylesheet" href="styles.css"><body style="padding:24px"><h2>Тестовая карточка — без рабочей базы</h2><p>Адрес: <span id="card-address"></span></p><button id="open">Открыть распознавание</button><script src="fixture.js"></script></body></html>');
  });
  server.listen(0,"127.0.0.1",()=>console.log(`OCR review UI fixture: http://127.0.0.1:${server.address().port}/`));
}
main().then(()=>{if(process.argv.includes("--serve"))serveFixture();}).catch(error=>{console.error(error);process.exitCode=1;});
