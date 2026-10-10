"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"app.js"),"utf8").replace(/\r\n/g,"\n");
const extract=name=>source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`,"m"))[0];
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route("**/*",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:`<style>${fs.readFileSync(path.join(root,"styles.css"),"utf8")}</style><button id="open">Обновить программы на сайтах</button>`}));
  await page.goto('http://127.0.0.1/bulk-isolated');
  await page.addScriptTag({content:`
    let requests=[],isAdmin=true,failSave=false,duplicate=false,holdWrite=false,resumeWrite=null,flushFailures=0;
    const seed=()=>[{id:'p1',name:'Курс <основной>',type:'КПК',price:4200,oldPrice:7000},{id:'p2',name:'Второй курс',type:'ППП',price:3000,oldPrice:6000},{id:'missing',name:'Без лендинга',type:'ПРО',price:1000,oldPrice:2000}];
    const state={data:{collections:{programs:seed()}}};
    const isAdminUser=()=>isAdmin,isDatabaseDemoMode=()=>false,isSettingsDraftSessionActive=()=>false,getSelected=()=>['p1'];
    const persist=()=>{},render=()=>{},addAudit=()=>{},getProgramPromoSyncFields=()=>({promoMessage1:'Актуальная цена'});
    const recordLockClientId='client',recordLockEntityType=()=> 'programs',acquireRecordLock=async()=>true,releaseRecordLock=async()=>{};
    const flushSharedApplicationState=async()=>{if(failSave&&state.data.collections.programs[0].siteSync&&flushFailures++===0)return false;return true;};
    const sharedStateChangeGeneration=1,flushSharedApplicationStateThroughGeneration=flushSharedApplicationState;
    const createProgramSiteProgress=()=>({start(){},watch(){},phase(){},local(){},stop(){},dispose(){}});
    const escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const escapeAttr=value=>escapeHtml(value).replace(/"/g,'&quot;');
    const programSiteRequest=async(action,body)=>{
      requests.push({action,body:structuredClone(body)});
      const p=state.data.collections.programs.find(item=>item.id===body.programId);
      if(p.id==='missing')throw Error('Лендинг не найден');
      const options=body.pricing;
      const price=options.changePrices?(options.manualPrice!==undefined?Number(options.manualPrice):Math.ceil(p.price*(1+Number(options.percent)/100)/Number(options.step))*Number(options.step)):p.price;
      const id=duplicate?12:p.id==='p1'?12:13;
      if(action==='preview-bulk-sync')return {model:{type:p.type},hash:'h',product:{id,price:p.price},landing:{id:42,offers:[{productId:id,price:p.price}]},bulk:{quote:'quote-'+p.id,settings:structuredClone(options),basePrice:p.price,baseOldPrice:p.oldPrice,price,oldPrice:p.oldPrice}};
      if(holdWrite)await new Promise(resolve=>{resumeWrite=resolve;});
      return {ok:true,price,oldPrice:p.oldPrice,landing:{id:42,url:'https://edu-plus.ru/course/'},product:{id}};
    };
    ${extract('programBulkPriceChanged')}
    ${extract('showProgramPriceUpdateReminder')}
    ${extract('openProgramSiteBulkSync')}
    document.querySelector('#open').onclick=()=>openProgramSiteBulkSync();
  `});
  const open=async()=>{await page.click('#open');await page.waitForSelector('[data-bulk-rows] tr');};
  const preview=async()=>{await page.click('[data-bulk-preview]');await page.waitForFunction(()=>!document.querySelector('[data-bulk-close]').disabled);};
  const apply=async()=>{await page.check('[data-bulk-confirm]');await page.click('[data-bulk-apply]');};
  const dismissReminder=async()=>{await page.waitForSelector('[data-program-price-reminder]');assert.match(await page.locator('[data-program-price-reminder]').textContent(),/приказ о наборе и коммерческие предложения/);await page.getByRole('button',{name:'Понятно',exact:true}).click();};
  await open();
  assert.equal(await page.locator('[data-bulk-apply]').isEnabled(),false);
  await page.check('[data-bulk-change-prices]');await preview();
  assert.equal(await page.locator('[data-bulk-price]').nth(0).inputValue(),'5000');
  assert.equal(await page.locator('[data-bulk-price]').nth(1).inputValue(),'3500');
  assert.equal(await page.evaluate(()=>requests.filter(x=>x.action==='sync-bulk-item').length),0,'Preview is read-only');
  await page.locator('[data-bulk-price]').nth(0).fill('4900');await page.locator('[data-bulk-price]').nth(0).press('Tab');
  assert.match(await page.locator('[data-bulk-rows] tr').nth(0).textContent(),/требуется пересчёт/);
  await preview();
  assert.equal(await page.locator('[data-bulk-price]').nth(0).inputValue(),'4900');
  assert.equal(await page.locator('[data-bulk-price]').nth(1).inputValue(),'3500','Manual override cannot affect other rows');
  if(process.env.AIS_TEST_SCREENSHOT)await page.screenshot({path:process.env.AIS_TEST_SCREENSHOT});
  await apply();await dismissReminder();
  let result=await page.evaluate(()=>({requests,programs:state.data.collections.programs}));
  assert.equal(result.programs[0].price,'4900');assert.equal(result.programs[1].price,'3500');assert.equal(result.programs[2].price,1000);
  assert.equal(result.programs[0].promoMessage1,'Актуальная цена');
  assert.equal(result.requests.filter(x=>x.action==='sync-bulk-item').length,2);
  const downloadPromise=page.waitForEvent('download');
  await page.click('[data-bulk-report]');
  const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'Обновление программ на сайтах.csv');
  const csv=fs.readFileSync(await download.path(),'utf8');
  assert.match(csv,/Курс <основной>/);assert.match(csv,/4900/);assert.match(csv,/Обновлены оба сайта и АИС/);
  await preview();
  assert.equal(await page.locator('[data-bulk-apply]').isEnabled(),false,'Completed rows cannot be replayed');
  await page.click('[data-bulk-close]');
  // Failed AIS save resumes only persistence, never compounds the percentage.
  await page.evaluate(()=>{state.data.collections.programs=seed();requests=[];failSave=true;});
  await open();await page.check('[data-bulk-change-prices]');await preview();await apply();await dismissReminder();
  assert.match(await page.locator('[data-bulk-rows] tr').nth(0).textContent(),/сохранение.*не подтверждено/);
  await apply();await dismissReminder();
  result=await page.evaluate(()=>({requests,programs:state.data.collections.programs}));
  assert.equal(result.requests.filter(x=>x.action==='sync-bulk-item'&&x.body.programId==='p1').length,1,'Save retry never repeats site writes');
  assert.equal(result.programs[0].price,'5000');assert.equal(result.programs[1].price,'3500');
  await page.click('[data-bulk-close]');
  // Stop drains the in-flight request and leaves later programs untouched.
  await page.evaluate(()=>{state.data.collections.programs=seed();requests=[];failSave=false;holdWrite=true;});
  await open();await page.check('[data-bulk-change-prices]');await preview();await apply();
  await page.waitForFunction(()=>typeof resumeWrite==='function');
  await page.click('[data-bulk-stop]');await page.evaluate(()=>{holdWrite=false;resumeWrite();});await dismissReminder();
  assert.equal(await page.evaluate(()=>requests.filter(x=>x.action==='sync-bulk-item').length),1);
  assert.equal(await page.evaluate(()=>state.data.collections.programs[1].price),3000);
  await page.click('[data-bulk-close]');
  await page.evaluate(()=>{state.data.collections.programs=seed();requests=[];duplicate=true;});
  await page.setViewportSize({width:390,height:844});await open();await preview();
  assert.match(await page.locator('[data-bulk-rows]').textContent(),/Один товар привязан/);
  assert.equal(await page.locator('[data-bulk-apply]').isEnabled(),false);
  assert.equal(await page.locator('dialog[open]').evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth),true);
  await page.press('dialog','Escape');await page.evaluate(()=>{isAdmin=false;});await page.click('#open');
  assert.equal(await page.locator('dialog').count(),0);
  console.log('PASS: bulk preview, manual per-row prices, confirmation, skip/mapping guards, no replay, save-only retry, cancellation, reminder, report controls and mobile/admin behavior');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
