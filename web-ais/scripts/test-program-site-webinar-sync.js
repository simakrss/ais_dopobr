"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pg = require("../program-site-generator");
const join = "https://salutejazz.ru/calls/new?psw=AbCd_123&name=%D0%90#join";
const program = {id:"sync-test",type:"ПРО",name:"Webinar",price:500,oldPrice:800,hours:2,landingCode:"old_code",promoSite:"https://edu-plus.ru/new_code",webinarJoinUrl:join,
  sitePublication:{landing:{id:42},product:{id:12}},siteSync:{landing:{id:42},product:{id:12}}};
const landing = {id:42,slug:"old_code",status:"publish",postType:"other-course",url:"https://edu-plus.ru/other_course/old_code/",version:"landing-v1",offers:[{productId:12,hours:2}],fields:{}};
const product = {id:12,slug:"old_code",status:"publish",url:"https://zifra-plus.ru/product/old_code/",version:"product-v1"};
const calls = [];
async function call(site,endpoint,payload) {
  calls.push({site,endpoint,payload});
  if (endpoint === "/resolve-site") { assert.equal(payload.landingId,42,"Resolve original ID, never search new slug");return structuredClone(landing); }
  if (endpoint === "/sync-product/12") return structuredClone(product);
  if (endpoint === "/check-sync") return {ok:true};
  if (endpoint === "/sync-existing") return {id:site === "edu"?42:12,status:"publish",slug:payload.model.slug || "old_code",url:site === "edu"?payload.model.landingUrl:`https://zifra-plus.ru/product/${payload.model.slug || 'old_code'}/`};
  assert.fail(endpoint);
}
async function main() {
  assert.deepEqual(pg.syncTarget({...program,landingCode:"new_code"}),{landingId:42});
  assert.deepEqual(pg.syncTarget({...program,siteSync:{landing:{id:43}}}),{landingId:43},"Latest sync ID wins over publication address");
  assert.equal(pg.normalizeSyncProgram(program).joinUrl,join);
  assert.equal(pg.normalizeSyncProgram(program).slug,"new_code");
  assert.equal(pg.normalizeSyncProgram({...program,webinarJoinUrl:""}).joinUrl,undefined);
  assert.equal(pg.normalizeSyncProgram({...program,promoSite:"https://edu-plus.ru/?p=42"}).slug,undefined,"Legacy ID URLs do not rename posts");
  for(const type of ["ДОП","КПК","ППП"]) assert.equal(pg.normalizeSyncProgram({...program,type,webinarJoinUrl:"invalid"}).joinUrl,undefined);
  for(const webinarJoinUrl of ["javascript:alert(1)","http://salutejazz.ru/calls/1","https://user:pass@salutejazz.ru/calls/1"]) assert.throws(()=>pg.normalizeSyncProgram({...program,webinarJoinUrl}));
  const plan = await pg.previewSync(program,call,12);
  assert.equal(plan.model.landingUrl,"https://edu-plus.ru/other_course/new_code/");
  const untouched = await pg.previewSync({...program,promoSite:landing.url,webinarJoinUrl:""},call,12);
  assert.equal(untouched.model.slug,undefined); assert.equal(untouched.model.joinUrl,undefined,"Unchanged legacy program still supports price-only sync");
  for(const change of [{webinarJoinUrl:"https://salutejazz.ru/calls/changed"},{promoSite:"https://edu-plus.ru/different_code"}]) {
    calls.length = 0;
    await assert.rejects(pg.synchronize({...program,...change},call,12,plan.hash),/изменились/);
    assert.ok(calls.every(item=>item.endpoint !== "/sync-existing"));
  }
  calls.length = 0;
  const result = await pg.synchronize(program,call,12,plan.hash);
  assert.equal(result.gradeReportUrl,join); assert.equal(result.landingCode,"new_code"); assert.equal(result.type,"ПРО");
  assert.equal(result.landing.id,42); assert.equal(result.product.id,12);
  assert.deepEqual(calls.filter(item=>["/check-sync","/sync-existing"].includes(item.endpoint)).map(item=>item.site+item.endpoint),["edu/check-sync","shop/check-sync","shop/sync-existing","edu/sync-existing"]);
  for(const item of calls.filter(item=>item.endpoint === "/sync-existing")) {
    assert.equal(item.payload.model.joinUrl,join); assert.equal(item.payload.model.slug,"new_code"); assert.equal(item.payload.landingStatus,"publish");
  }
  calls.length=0;
  await assert.rejects(pg.synchronize(program,async(...args)=>{if(args[0]==="shop"&&args[1]==="/check-sync")throw Error("Filename occupied");return call(...args);},12,plan.hash),/occupied/);
  assert.ok(!calls.some(item=>item.endpoint === "/sync-existing"));
  await assert.rejects(pg.synchronize(program,async(...args)=>{if(args[0]==="edu"&&args[1]==="/sync-existing")throw Error("Concurrent landing edit");return call(...args);},12,plan.hash),/Магазин обновлён/);
  // Retrying after a partial rename still addresses the same original landing.
  assert.deepEqual(pg.syncTarget({...program,siteSync:{landing:{id:42,url:landing.url},product:{id:12,url:result.product.url}}}),{landingId:42});

  const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
  const syncStart=app.indexOf("  async function openProgramSiteSync(");
  const syncEnd=app.indexOf("  function renderProgramGeneratorFields(",syncStart);
  const source=app.slice(syncStart,syncEnd);
  assert.match(source,/data-sync-jazz/); assert.match(source,/if \(jazzInput\) \{[\s\S]*?saveRecordFormBeforeContinuation/);
  assert.match(source,/\[jazzInput, dateInput, timeInput, sampleInput\]\.forEach\(input => input\?\.addEventListener\("input", \(\) => \{\s*plan = null; apply.disabled = true;/);
  const saveStart=source.indexOf("        current.siteSync = result;");
  const saveEnd=source.indexOf('        status.textContent = "Информация о программе успешно',saveStart);
  assert.ok(saveStart>0&&saveEnd>saveStart);
  const baseline=[{name:"landingCode",value:"old_code"},{name:"gradeReportUrl",value:"old-report"},{name:"name",value:"saved-name"}];
  const current={type:"ПРО",gradeReportUrl:"old-report"}; const events=[];
  const card={elements:{},dataset:{initialSnapshot:JSON.stringify(baseline)}};
  for(const item of baseline) card.elements[item.name]={value:item.value,dispatchEvent:event=>events.push(event)};
  card.elements.name.value="unsaved-name";
  let persisted;
  const context={current,result,card,Event,promoParameters:program,getProgramPromoSyncFields:()=>({}),persist:()=>{persisted=structuredClone(current);},flushSharedApplicationState:async()=>true,progress:{local(){}}};
  vm.createContext(context);
  await vm.runInContext(`(async()=>{${source.slice(saveStart,saveEnd)}})()`,context);
  assert.equal(persisted.gradeReportUrl,join); assert.equal(persisted.landingCode,"new_code");
  assert.equal(card.elements.gradeReportUrl.value,join); assert.equal(card.elements.landingCode.value,"new_code");
  assert.equal(card.elements.name.value,"unsaved-name");
  assert.equal(JSON.parse(card.dataset.initialSnapshot)[2].value,"saved-name","Other unsaved fields are not marked clean");
  console.log("PASS: PRO sync parameters, stable post identity, unchanged promo preservation, preflight ordering, stale-plan safety, partial retry and saved card fields");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
