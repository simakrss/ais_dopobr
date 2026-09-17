"use strict";
// Isolated data/transport. No real programs, clipboard or production APIs are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
const setup = `
var server={collections:{programs:[{id:"p",type:"КПК",name:"Тестовая программа",promoMessage1:"Первый текст\\nhttps://example.test/course",promoMessage2:"Второй текст",price:3000}],students:[{id:"s",name:"Тест"}]}};
var state={data:JSON.parse(JSON.stringify(server)),modal:{config:"students",id:"s",draft:{note:"Несохранённый черновик"}}};
var sharedStateReady=true,sharedStateDirty=false,sharedStateSaveRunning=false,sharedStatePollRunning=false,sharedStateChangeGeneration=0;
var activeRecordLock={key:"students:s"},recordLockClientId="fixture",calls=[],denied=false,demo=false,locked=false,readFailure=false,saveFailure=false,race=false,flushCount=0;
function canAccessView(){return !denied;} function isDatabaseDemoMode(){return demo;} function isSettingsDraftSessionActive(){return false;}
function recordLockEntityType(id){return id;} function recordLockKey(type,id){return type+":"+id;}
async function requestSharedRecordLocks({body}){calls.push(body.action);if(locked&&body.action==="acquire")throw Object.assign(new Error("busy"),{status:423});return {};}
async function requestSharedApplicationState(){if(readFailure)throw Error("Нет связи");if(race)sharedStateDirty=true;return {exists:true,writable:true,data:JSON.parse(JSON.stringify(server))};}
function applySharedApplicationState(payload){state.data=JSON.parse(JSON.stringify(payload.data));}
function addAudit(){calls.push("audit");} function persist(){calls.push("persist");sharedStateDirty=true;sharedStateChangeGeneration++;}
async function flushSharedApplicationStateThroughGeneration(){flushCount++;if(saveFailure&&sharedStateDirty)return false;if(sharedStateDirty)server=JSON.parse(JSON.stringify(state.data));sharedStateDirty=false;return true;}
`;
const saving = ["getStudentProgramPromoField", "saveStudentProgramPromoMessage"].map(extract).join("\n");
function harness() {
  const c = vm.createContext({window:{setInterval:()=>1,clearInterval:()=>{}},console});
  vm.runInContext(setup + saving, c); return c;
}
async function tests() {
  let c = harness();
  assert.equal(c.getStudentProgramPromoField({promoMessage1:"Первое",promoMessage2:"Второе"}),"promoMessage1");
  assert.equal(c.getStudentProgramPromoField({promoMessage1:" \n",promoMessage2:"Второе"}),"promoMessage2");
  assert.equal(c.getStudentProgramPromoField({}),"promoMessage1");
  const draft = JSON.stringify(c.state.modal);
  const first = c.server.collections.programs[0].promoMessage1;
  c.server.collections.programs[0].price=7000;
  await c.saveStudentProgramPromoMessage("p","promoMessage1","Правка\nhttps://example.test/new",first);
  assert.equal(c.server.collections.programs[0].promoMessage1,"Правка\nhttps://example.test/new");
  assert.equal(c.server.collections.programs[0].price,7000,"Concurrent unrelated program changes survive");
  assert.equal(c.server.collections.programs[0].promoMessage2,"Второй текст");
  assert.equal(c.server.collections.programs[0].promoMessage1Touched,true);
  assert.equal(c.activeRecordLock.key,"students:s");
  assert.equal(JSON.stringify(c.state.modal),draft,"Listener draft is untouched");
  assert.deepEqual(Array.from(c.calls),["acquire","renew","audit","persist","release"]);
  c=harness();
  await c.saveStudentProgramPromoMessage("p","promoMessage2","","Второй текст");
  assert.equal(c.server.collections.programs[0].promoMessage2,"");
  assert.equal(c.server.collections.programs[0].promoMessage2Touched,true,"Cleared text must export to XLSB");
  assert.equal(c.server.collections.programs[0].promoMessage1,first);
  for(const [flag,pattern] of [["denied",/недоступно/],["demo",/недоступно/],["locked",/занята/],["readFailure",/Нет связи/],["race",/другая запись/]]) {
    c=harness();c[flag]=true;
    await assert.rejects(c.saveStudentProgramPromoMessage("p","promoMessage1","Правка",first),pattern);
    assert.equal(c.calls.includes("persist"),false,flag+" must not mutate program");
    assert.equal(c.server.collections.programs[0].promoMessage1,first);
  }
  c=harness();c.server.collections.programs[0].promoMessage1="Чужая правка";
  await assert.rejects(c.saveStudentProgramPromoMessage("p","promoMessage1","Моя правка",first),/уже изменено/);
  assert.equal(c.server.collections.programs[0].promoMessage1,"Чужая правка");
  assert.equal(c.calls.includes("persist"),false);
  assert.equal(c.calls.at(-1),"release");
  c=harness();c.saveFailure=true;
  await assert.rejects(c.saveStudentProgramPromoMessage("p","promoMessage1","Правка",first),/не подтверждено/);
  assert.equal(c.server.collections.programs[0].promoMessage1,first);
  assert.equal(c.state.data.collections.programs[0].promoMessage1,"Правка","Failed save retains recovery draft");
  assert.equal(c.calls.at(-1),"release");
  c=harness();c.server.collections.programs[0].promoMessage1="Уже сохранено";
  await c.saveStudentProgramPromoMessage("p","promoMessage1","Уже сохранено",first);
  assert.equal(c.server.collections.programs[0].promoMessage1,"Уже сохранено","Retry after unknown result is idempotent");
  assert.match(extract("closeTopmostWindowByEscape"),/closeStudentProgramPromoDialog/);
  assert.match(source,/promoDialog.closeStudentProgramPromoDialog\?\.\(\);\n\s+restoreCancelledAisHistoryNavigation/);
  console.log("PASS: promo source/fallback, exact field save/clear, fresh record merge, independent lock, conflicts, permissions, recovery and close integration");
}
tests().then(()=>{
  if(!process.argv.includes("--serve"))return;
  const uiNames=["openStudentProgramPromoDialog","renderProgramPromoMessageEditor","syncProgramPromoEditor","serializeCommunicationTemplateEditor","bindProgramPromoEditors","insertPlainTextIntoContentEditable","chooseUnsavedChangesAction","closeTopmostWindowByEscape"];
  const script=setup+saving+uiNames.map(extract).join("\n")+`
    var unsavedChangesDialogSession=null;
    function escapeHtml(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");} var escapeAttr=escapeHtml;
    function renderCommunicationTemplateLinks(value){return window.AISFieldHtmlLinks?.renderLinks(value)||escapeHtml(value);}
    function initializeCommunicationTemplateEditorHistory(){} function recordCommunicationTemplateEditorChange(){} function handleCommunicationTemplateEditorHistoryKeydown(){return false;}
    function refreshTemplateLinkEditor(){} function openTemplateEditorLink(){} function showFieldCopyPopup(){} function hideFieldCopyPopup(){}
    async function copyTextToClipboard(value){document.querySelector('#copied').textContent=value;}
    var originalFlush=flushSharedApplicationStateThroughGeneration;
    flushSharedApplicationStateThroughGeneration=async()=>{await new Promise(resolve=>setTimeout(resolve,200));const result=await originalFlush();document.querySelector('#saved').textContent=server.collections.programs[0].promoMessage1+' | '+server.collections.programs[0].promoMessage2;return result;};
    document.querySelector('#open').onclick=event=>openStudentProgramPromoDialog(state.data.collections.programs[0],event.currentTarget);
    document.querySelector('#fallback').onclick=event=>{server.collections.programs[0].promoMessage1=' ';state.data=JSON.parse(JSON.stringify(server));openStudentProgramPromoDialog(state.data.collections.programs[0],event.currentTarget);};
    document.querySelector('#conflict').onchange=event=>{if(event.target.checked)server.collections.programs[0].promoMessage1='Чужая правка';};
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('[data-student-program-promo-dialog]')){event.preventDefault();closeTopmostWindowByEscape();}});
    window.addEventListener('error',event=>document.querySelector('#errors').textContent+=event.message);
    window.addEventListener('unhandledrejection',event=>document.querySelector('#errors').textContent+=event.reason);
  `;
  const http=require("node:http");
  const server=http.createServer((req,res)=>{
    if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript; charset=utf-8");return res.end(script);}
    if(["/styles.css","/field-html-links.js"].includes(req.url)){res.setHeader("Content-Type",req.url.endsWith("css")?"text/css":"text/javascript");return res.end(fs.readFileSync(path.join(root,req.url.slice(1))));}
    res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<!doctype html><html lang="ru"><title>Промосообщение — тест</title><link rel="stylesheet" href="styles.css"><body style="padding:16px"><button id="open">Копировать промосообщение</button><button id="fallback">Первое пустое</button><label><input id="conflict" type="checkbox">Чужая правка</label><h3>Копия</h3><pre id="copied"></pre><h3>Сохранено</h3><pre id="saved"></pre><pre id="errors"></pre><script src="field-html-links.js"></script><script src="fixture.js"></script></body></html>');
  });
  server.listen(0,"127.0.0.1",()=>console.log(`Promo UI fixture: http://127.0.0.1:${server.address().port}/`));
}).catch(error=>{console.error(error);process.exitCode=1;});
