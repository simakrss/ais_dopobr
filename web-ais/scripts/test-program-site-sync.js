"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pg = require("../program-site-generator");
const program = {id:"qa-program",type:"КПК",name:"Учебная программа (72 ч)",nameEnglish:"Educational programme",hours:72,price:6000,oldPrice:8000,landingCode:"3878",duration:"2 недели",studyForm:"Заочная"};
const landing = {id:3878,title:"Название на сайте",version:"landing-v1",url:"https://edu-plus.ru/courses-pk/pk-test/",editUrl:"https://edu-plus.ru/wp-admin/post.php?post=3878&action=edit",
  fields:{reviews:"Не передавать в форму"},offers:[{index:0,productId:12,hours:"72",price:"5000"},{index:1,productId:13,hours:"72",price:"7000"}]};
const products = [12,13].map((id,i)=>({id,title:i ? "Удостоверение — 72 ч" : "Сертификат — 72 ч",price:i?7000:5000,version:`product-${id}-v1`,url:`https://zifra-plus.ru/product/test-${id}/`,editUrl:`https://zifra-plus.ru/wp-admin/post.php?post=${id}&action=edit`}));
const call = async (site,endpoint,body) => endpoint === "/resolve-site" ? structuredClone(landing) : endpoint.startsWith("/sync-product/") ? structuredClone(products.find(item=>item.id === Number(endpoint.split("/").at(-1)))) : endpoint === "/check-sync" ? {ok:true} : endpoint === "/sync-existing" ? {id: site === "edu" ? landing.id : body.productId,url:site === "edu" ? landing.url : products[0].url,editUrl:site === "edu" ? landing.editUrl : products[0].editUrl} : assert.fail(endpoint);
async function main() {
  assert.deepEqual(pg.syncTarget(program),{landingId:3878});
  assert.deepEqual(pg.syncTarget({...program,landingCode:"pk-test"}),{slug:"pk-test"});
  assert.deepEqual(pg.syncTarget({...program,landingCode:"",promoSite:"https://edu-plus.ru/?p=3878"}),{landingId:3878});
  assert.throws(()=>pg.syncTarget({...program,landingCode:"../evil"}));
  assert.throws(()=>pg.syncTarget({...program,landingCode:"",promoSite:"https://evil.example/pk-test/"}));
  for (const type of ["ДОП","КПК","ППП","ПРО"]) assert.equal(pg.normalizeSyncProgram({...program,type}).type,type,"No meeting, English name, description or samples required for sync");
  for (const patch of [{price:""},{price:null},{price:-1},{hours:0},{name:""}]) assert.throws(()=>pg.normalizeSyncProgram({...program,...patch}));
  assert.equal(pg.normalizeSyncProgram({...program,price:0}).price,0);
  const ambiguous = await pg.previewSync(program,call);
  assert.equal(ambiguous.product,null); assert.equal(ambiguous.hash,"");
  assert.equal(ambiguous.landing.fields,undefined);
  const plan = await pg.previewSync(program,call,13);
  assert.equal(plan.product.id,13); assert.equal(plan.hash.length,64);
  assert.equal((await pg.previewSync({...program,siteSync:{product:{id:13}}},call)).product.id,13);
  await assert.rejects(pg.previewSync(program,call,999),/не связан/);
  const calls=[];
  const traced=async (...args)=>{calls.push(args);return call(...args);};
  const done=await pg.synchronize(program,traced,13,plan.hash);
  assert.equal(done.ok,true);
  assert.deepEqual(calls.filter(c=>["/check-sync","/sync-existing"].includes(c[1])).map(c=>c[0]+c[1]),["edu/check-sync","shop/check-sync","shop/sync-existing","edu/sync-existing"]);
  for (const changed of [{...program,price:10},{...program,name:"Другое название"}]) {
    calls.length=0;await assert.rejects(pg.synchronize(changed,traced,13,plan.hash),/изменились/);
    assert.ok(!calls.some(c=>c[1]==="/sync-existing"));
  }
  calls.length=0;
  await assert.rejects(pg.synchronize(program,async(...args)=>{calls.push(args);if(args[1]==="/check-sync" && args[0]==="edu") throw new Error("ACF missing");return call(...args);},13,plan.hash),/ACF/);
  assert.ok(!calls.some(c=>c[1]==="/sync-existing"));
  await assert.rejects(pg.synchronize(program,async(site,endpoint,body)=>{if(endpoint==="/sync-existing" && site==="edu") throw new Error("stale");return call(site,endpoint,body);},13,plan.hash),/Магазин обновлён.*лендинга не подтверждено/);
  await assert.rejects(pg.synchronize(program,async(site,endpoint,body)=>{if(endpoint==="/sync-existing" && site==="shop") throw new Error("timeout");return call(site,endpoint,body);},13,plan.hash),/Лендинг не изменялся/);
  const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8"),css=fs.readFileSync(path.join(__dirname,"../styles.css"),"utf8");
  assert.match(css,/\.program-form-grid label\[data-field-key="nameEnglish"\]/);
  assert.match(css,/\.program-site-generator-fields\[hidden\]\s*\{\s*display: none !important/);
  assert.match(app,/control\.setAttribute\("form", "recordForm"\)/);
  assert.match(app,/generatorHome.appendChild\(generatorFields\)/);
  assert.match(app,/data-action="sync-program-with-sites"/);
  console.log("PASS: legacy ID/slug, all 4 types, ambiguous offers, remembered product, authoritative values, stale preview, both-site preflight, partial failure, compact UI contracts");
}
main().catch(error=>{console.error(error);process.exitCode=1;});

// Browser QA serves actual UI functions and styles with an isolated in-memory API.
if (process.argv.includes("--serve")) {
  const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
  const source=app.slice(app.indexOf("  function renderProgramSiteLink("),app.indexOf("  function renderProgramModal("));
  const fieldsSource=app.slice(app.indexOf('        field("name", "Наименование программы"'),app.indexOf('        field("qualification", "Квалификация"'));
  const renderFieldSource=app.slice(app.indexOf("  function renderField("),app.indexOf("  function renderStudentModal("));
  const server=require("node:http").createServer(async(req,res)=>{
    if(req.url === "/styles.css") {res.writeHead(200,{"Content-Type":"text/css"});return res.end(fs.readFileSync(path.join(__dirname,"../styles.css")));}
    if(req.url !== "/") {res.writeHead(404);return res.end();}
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
    res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Карточка программы — проверка</title><link rel="stylesheet" href="/styles.css"><body><main style="max-width:1000px;margin:20px auto;padding:16px;background:white"><h2>Карточка программы</h2><form id="recordForm" data-config="programs" data-id="qa-program"><div class="form-grid program-form-grid" id="main"></div><hr><div id="site"></div><button type="button" id="generator">Создать на сайте</button></form><p id="saved" role="status"></p></main><script>
      const state={data:{dictionaries:{programTypes:['ПРО','ДОП','КПК','ППП'],programStatuses:['Действует'],studyForms:['Заочная']},collections:{programs:[${JSON.stringify(program)}]}},modal:{config:'programs',id:'qa-program'},programCardTab:'site'};
      const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const escapeAttr=escapeHtml, unique=values=>[...new Set(values)], isAdminUser=()=>true,isDatabaseDemoMode=()=>false,isSettingsDraftSessionActive=()=>false,ensureRecordLockForSave=async()=>true;
      const field=(key,label,type='text',required=false,dict=null,options={})=>({key,label,type,required,dict,options});
      const configs={programs:{fields:[${fieldsSource}]}};
      const getProgramLandingPageUrl=value=>'https://edu-plus.ru/?p='+value,getProgramPromoUrl=()=>'',photoApiUrl=value=>value,getEffectiveLocalDocumentsMode=()=>true;
      const getMoneyInputStepAttribute=()=>'', renderStudentStatusOptions=(values,current)=>values.map(value=>'<option>'+escapeHtml(value)+'</option>').join('');
      const renderProgramHoursField=(label,value,required)=>label+'<input name="hours" type="number" value="'+value+'"></label>';
      const persist=()=>document.getElementById('saved').textContent='Результат сохранён в тестовой базе',flushSharedApplicationState=async()=>true,render=()=>{};
      const saveRecordFormBeforeContinuation=async(form)=>{Object.assign(state.data.collections.programs[0],Object.fromEntries(new FormData(form)));document.getElementById('saved').textContent='Параметры сохранены: '+(state.data.collections.programs[0].siteDescription||'');return 'qa-program';};
      let syncWrites=0;
      const fetch=async(url,options)=>{const body=options?.body?JSON.parse(options.body):{};let result;
        const products=${JSON.stringify(products)},landing=${JSON.stringify(landing)};
        if(url.endsWith('/templates')) result={templates:[{id:42,title:'Прототип курса',postType:'courses-pk',url:landing.url}]};
        else if(url.endsWith('/sync')) {syncWrites++;result={ok:true,landing,product:products.find(item=>item.id===body.productId),syncedAt:new Date().toISOString()};document.getElementById('saved').dataset.writes=syncWrites;}
        else if(url.endsWith('/prepare')||url.endsWith('/publish')) result={ok:true,stage:'prepared',type:'КПК',templateId:42,hash:'qa',landing,product:products[0]};
        else result={ok:true,landing,products,product:products.find(item=>item.id===body.productId)||null,model:{...state.data.collections.programs[0],productName:state.data.collections.programs[0].name},hash:body.productId?'qa-plan':''};
        return {ok:true,json:async()=>result};};
      ${renderFieldSource}
      ${source}
      const record=state.data.collections.programs[0];
      document.getElementById('main').innerHTML=configs.programs.fields.filter(item=>!item.options.programTab).map(item=>renderField(item,record)).join('');
      document.getElementById('site').innerHTML=renderProgramSitePanel(record);
      document.getElementById('recordForm').insertAdjacentHTML('beforeend',renderProgramGeneratorFields(record));
      document.querySelector('[data-action="sync-program-with-sites"]').addEventListener('click',openProgramSiteSync);
      document.getElementById('generator').addEventListener('click',openProgramSiteGenerator);
      refreshProgramSiteLinks();
    </script></body></html>`);
  });
  server.listen(0,"127.0.0.1",()=>console.log(`UI fixture: http://127.0.0.1:${server.address().port}/`));
}
