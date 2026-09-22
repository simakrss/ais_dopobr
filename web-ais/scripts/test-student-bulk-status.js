"use strict";
// In-memory records only: no production data, emails or shared-state writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  \\}$`, "m"));
  assert.ok(match, name); return match[0];
}
const names = ["getStudentBulkStatusOptions", "runStudentBulkStatus", "getRowsByIds", "replaceStudentBulkRecord",
  "persistStudentBulkChanges", "resolveStudentAdditionalStatusAfterMainStatusChange", "resolveProStudentAdditionalStatus",
  "normalizeEducationProgramType", "renderStudentStatusOptions"];
const constants = source.match(/  const STUDENT_STATUS_ORDER = Object.freeze\(\[[\s\S]*?\]\);/u)[0]
  + ["STUDENT_LEARNING_ADDITIONAL_STATUS", "PRO_STUDENT_ADDITIONAL_STATUS", "PRO_STUDENT_ARCHIVE_ADDITIONAL_STATUS"]
    .map(name => source.match(new RegExp(`  const ${name} = [^;]+;`, "u"))[0]).join("\n");
const plan = source.slice(source.indexOf("  const studentBulkOperationDefinitions = Object.freeze(["), source.indexOf("  function openStudentBulkOperationsDialog()"));
const production = constants + "\n" + names.map(extract).join("\n") + plan;
function fixtureData() {
  return {
    dictionaries: {
      statuses: ["На зачисление", "Учится", "Отчислен"],
      studentAdditionalStatuses: ["Обучающиеся", "Вебинары", "Вебинары. Архив", "На зачисление (отложенный старт)", "Пользовательский статус", "Пользовательский статус", "Тест <b> & \"кавычки\"", ""]
    },
    collections: {
      students: [
        {id:"a", name:"Тестовый слушатель А", status:"На зачисление", additionalStatus:"Старое значение", program:"Тест ППП", notes:"Не менять", event_ready_state:"checked"},
        {id:"b", name:"Тестовый слушатель Б", status:"На зачисление", additionalStatus:"Вебинары", program:"Тест ПРО"},
        {id:"locked", name:"Заблокированная запись", status:"На зачисление", additionalStatus:"Не менять"},
        {id:"other", name:"Не выбранный слушатель", status:"На зачисление", additionalStatus:"Не менять"}
      ],
      programs: [{name:"Тест ППП",type:"ППП"},{name:"Тест ПРО",type:"ПРО"}]
    }
  };
}
const escapeHtml = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function harness(options = {}) {
  const state = {data:fixtureData()}, audits = [], progress = [], saved = [], locks = [];
  let active = "";
  const c = {
    state, configs:{students:{title:"Слушатели"}}, unique: values => [...new Set(values)],
    findProgramByName: name => state.data.collections.programs.find(p=>p.name===name),
    escapeHtml, escapeAttr:escapeHtml,
    acquireRecordLock: async (collection,id,settings) => {
      locks.push(["acquire",id]); assert.equal(collection,"students"); assert.equal(settings.promptTakeover,false);
      if (id === "locked") return false;
      if (options.failLock === id) throw Error("Ошибка блокировки");
      active = id; options.onAcquire?.(id,state); return true;
    },
    releaseRecordLock: async () => {locks.push(["release",active]); active="";},
    addAudit: (...args) => audits.push(args),
    persist: () => { assert.ok(active,"Save before releasing the record lock"); },
    flushSharedApplicationState: async () => {
      saved.push(JSON.parse(JSON.stringify(state.data.collections.students)));
      options.onSave?.();
      if (options.offline) throw Error("Тест: нет сети");
      return true;
    }
  };
  vm.createContext(c); vm.runInContext(production,c);
  return {c,state,audits,saved,locks,progress,update:(...args)=>progress.push(args)};
}
async function test() {
  let h = harness();
  assert.deepEqual([...h.c.getStudentBulkStatusOptions("status")], h.state.data.dictionaries.statuses);
  assert.equal(h.c.getStudentBulkStatusOptions("additionalStatus").filter(v=>v==="Пользовательский статус").length,1);
  assert.equal(h.c.getStudentBulkStatusOptions("additionalStatus").includes(""),false);
  assert.equal(h.c.getStudentBulkStatusOptions("notes").length,0);
  const rendered = h.c.renderStudentStatusOptions(h.c.getStudentBulkStatusOptions("additionalStatus"));
  assert.ok(rendered.includes("&lt;b&gt; &amp; &quot;кавычки&quot;"));
  const before = JSON.stringify(h.state);
  for(const [field,value] of [["notes","x"],["status",""],["status","Неизвестный"],["additionalStatus","Неизвестный"]]) {
    await assert.rejects(h.c.runStudentBulkStatus(h.state.data.collections.students,field,value,h.update),/справочника/u);
  }
  assert.equal(JSON.stringify(h.state),before);assert.equal(h.locks.length,0);

  let result = await h.c.runStudentBulkStatus(h.state.data.collections.students.slice(0,3),"additionalStatus"," Пользовательский статус ",h.update);
  assert.deepEqual([result.success,result.skipped,result.failed],[2,1,0]);
  const rows = h.state.data.collections.students;
  assert.equal(rows[0].additionalStatus,"Пользовательский статус");assert.equal(rows[1].additionalStatus,"Пользовательский статус");
  assert.equal(rows[0].status,"На зачисление");assert.equal(rows[0].notes,"Не менять");assert.equal(rows[0].event_ready_state,"checked");
  assert.equal(rows[2].additionalStatus,"Не менять");assert.equal(rows[3].additionalStatus,"Не менять");
  assert.equal(h.saved.length,2);assert.equal(h.audits.length,2);
  assert.equal(h.audits[0][3].changes[0].field,"additionalStatus");
  assert.equal(h.audits[0][3].changes[0].before,"Старое значение");
  assert.equal(h.locks.filter(item=>item[0]==="release").length,2);
  result = await h.c.runStudentBulkStatus(rows.slice(0,2),"additionalStatus","Пользовательский статус",h.update);
  assert.deepEqual([result.success,result.skipped],[0,2]);assert.equal(h.audits.length,2);

  h=harness();
  await h.c.runStudentBulkStatus(h.state.data.collections.students.slice(0,2),"status","Учится",h.update);
  assert.ok(h.state.data.collections.students.slice(0,2).every(row=>row.status==="Учится"&&row.additionalStatus==="Обучающиеся"));
  assert.equal(h.audits[0][3].changes.length,2,"Automatic additional-status change is also audited");
  await h.c.runStudentBulkStatus(h.state.data.collections.students.slice(0,2),"status","Отчислен",h.update);
  assert.equal(h.state.data.collections.students[0].additionalStatus,"Обучающиеся");
  assert.equal(h.state.data.collections.students[1].additionalStatus,"Вебинары. Архив");

  h=harness({onAcquire:(id,state)=>{state.data.collections.students.find(row=>row.id===id).notes="Обновлено после выбора";}});
  const stale = {...h.state.data.collections.students[0]};
  await h.c.runStudentBulkStatus([stale],"status","Учится",h.update);
  assert.equal(h.state.data.collections.students[0].notes,"Обновлено после выбора","Read the latest record after acquiring its lock");
  h=harness({onAcquire:(id,state)=>{state.data.collections.students=state.data.collections.students.filter(row=>row.id!==id);}});
  result=await h.c.runStudentBulkStatus([h.state.data.collections.students[0]],"status","Учится",h.update);
  assert.equal(result.skipped,1);assert.equal(h.saved.length,0);assert.equal(h.locks.at(-1)[0],"release");
  h=harness({failLock:"a"});
  result=await h.c.runStudentBulkStatus(h.state.data.collections.students.slice(0,2),"status","Учится",h.update);
  assert.deepEqual([result.success,result.failed],[1,1]);assert.equal(h.locks.filter(item=>item[0]==="release").length,1);
  h=harness({offline:true});
  result=await h.c.runStudentBulkStatus(h.state.data.collections.students.slice(0,2),"status","Учится",h.update);
  assert.equal(result.success,2);assert.match(result.notice,/ожидают синхронизации/u);
  assert.equal(result.notice.match(/ожидают синхронизации/gu).length,1);

  const abort = new AbortController();
  h=harness({onSave:()=>abort.abort()});
  result=await h.c.runStudentBulkStatus(h.state.data.collections.students.slice(0,2),"status","Учится",h.update,abort.signal);
  assert.equal(result.success,1);assert.equal(result.cancelled,true);assert.equal(h.state.data.collections.students[1].status,"На зачисление");
  const stopped=harness();
  result=await stopped.c.runStudentBulkStatus(stopped.state.data.collections.students,"status","Учится",stopped.update,abort.signal);
  assert.equal(result.cancelled,true);assert.equal(stopped.locks.length,0);

  h=harness();
  const planResult=await h.c.executeStudentBulkOperationPlan([
    {type:"status",statusValue:"Учится"},{type:"additionalStatus",statusValue:"Пользовательский статус"}
  ],["a","b"],{onProgress:h.update});
  assert.equal(planResult.result.success,4);
  assert.ok(h.state.data.collections.students.slice(0,2).every(row=>row.status==="Учится"&&row.additionalStatus==="Пользовательский статус"));
  assert.equal(h.saved.length,4);
  await h.c.runStudentBulkStatus(h.state.data.collections.students.slice(0,2),"status","Учится",h.update);
  assert.equal(h.saved.length,4,"An unchanged main status must preserve an explicitly selected additional status");
  assert.equal(h.state.data.collections.students[0].additionalStatus,"Пользовательский статус");
  const abortOnLock = new AbortController();
  h=harness({onAcquire:()=>abortOnLock.abort()});
  result=await h.c.runStudentBulkStatus(h.state.data.collections.students.slice(0,2),"status","Учится",h.update,abortOnLock.signal);
  assert.equal(result.cancelled,true);assert.equal(h.saved.length,0);assert.equal(h.locks.at(-1)[0],"release");
  const dialog=extract("openStudentBulkOperationsDialog");
  for(const field of ["bulkStatus","bulkAdditionalStatus"])assert.match(dialog,new RegExp(`name="${field}"`,"u"));
  assert.match(dialog,/statusValue: type === "status" \? value\("bulkStatus"\)/u);
  assert.doesNotMatch(dialog,/name="bulk(?:Additional)?Status"[^>]*required/u,"Hidden inputs must not block unrelated operations");
  assert.match(dialog,/if \(!confirm\(/u);
  console.log("Student bulk statuses: dictionaries, validation, exact selection, locks, fresh records, persistence, audit, status rules, cancellation and sequential plans: OK");
}
function serveFixture() {
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка групповых статусов</title><link rel="stylesheet" href="/styles.css"><body><main style="padding:24px"><h1>Тест групповых операций</h1><p>Только вымышленные записи. Общая база не изменяется.</p><button id="open">Групповые операции</button><pre id="confirmation"></pre><pre id="records"></pre></main><script>
    const state={data:${JSON.stringify(fixtureData())}},configs={students:{title:'Слушатели'}};
    const unique=values=>[...new Set(values)],escapeHtml=${escapeHtml.toString()},escapeAttr=escapeHtml;
    const findProgramByName=name=>state.data.collections.programs.find(p=>p.name===name);
    const getSelected=()=>['a','b','locked'];
    const confirm=message=>{document.getElementById('confirmation').textContent='Тестовое подтверждение: '+message;return true;};
    const acquireRecordLock=async(_type,id)=>id!=='locked',releaseRecordLock=async()=>{},addAudit=()=>{},persist=()=>{},flushSharedApplicationState=async()=>true;
    const studentCommunicationMessages=[{key:'portalAccessMessage',label:'Доступ к порталу'}],studentBulkDocumentOperations=[{key:'education',label:'Документы об образовании'}];
    const todayIso=()=> '2026-09-22',parseOrdersSdoDate=value=>value?new Date(value):null;
    const getStudentEventTemplates=()=>[],generateStudentCommunicationMessages=()=>({}),getStudentBulkDocumentTemplate=()=>null,getDocumentGenerationSignal=()=>null;
    const render=()=>{document.getElementById('records').textContent=state.data.collections.students.map(r=>r.name+': '+r.status+' / '+r.additionalStatus).join('\\n');};
    ${production}
    ${extract("openStudentBulkOperationsDialog")}
    ${extract("showStudentBulkOperationResult")}
    document.getElementById('open').addEventListener('click',openStudentBulkOperationsDialog);render();
    </script></body></html>`;
  require("node:http").createServer((req,res)=>{
    if(req.url==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(html);}
    else if(req.url==="/styles.css"){res.writeHead(200,{"Content-Type":"text/css"});res.end(fs.readFileSync(path.join(root,"styles.css")));}
    else {res.writeHead(404);res.end();}
  }).listen(0,"127.0.0.1",function(){console.log(`Bulk statuses fixture: http://127.0.0.1:${this.address().port}/`);});
}
if(process.argv.includes("--serve"))serveFixture();
else test().catch(error=>{console.error(error);process.exitCode=1;});
