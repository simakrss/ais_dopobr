"use strict";
// Isolated browser fixture. No application login, real records, or site requests.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname,"..");
const source = fs.readFileSync(path.join(root,"app.js"),"utf8").replace(/\r\n/g,"\n");
const extract = name => source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`,"m"))[0];
(async()=>{
  const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1100,height:850}});
    await page.route("**/*", route=>route.fulfill({contentType:"text/html",body:`<style>${fs.readFileSync(path.join(root,"styles.css"),"utf8")}</style><form id="recordForm" data-config="programs"><input name="productId" value=""></form><button id="open">Добавить вариант</button>`}));
    await page.goto("http://127.0.0.1/isolated-variant-test");
    await page.addScriptTag({content:`
      const state={data:{collections:{programs:[{id:'copy',productId:'',siteProductPending:true},{id:'original',productId:'12'}]}}};
      let requests=[],isAdmin=true,rejectWrite=false;
      const isAdminUser=()=>isAdmin,isDatabaseDemoMode=()=>false,isSettingsDraftSessionActive=()=>false;
      const saveRecordFormBeforeContinuation=async()=> 'copy',getEffectiveLocalDocumentsMode=()=>true;
      const ensureRecordLockForSave=async()=>true,persist=()=>{},flushSharedApplicationState=async()=>true,refreshProgramSiteLinks=async()=>{};
      const createProgramSiteProgress=()=>({start(){},watch(){},local(){},stop(){},dispose(){}});
      const escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const renderProgramSiteLink=()=>'';
      const programSiteRequest=async(action,body)=>{
        requests.push({action,body});
        if(action==='preview-variant')return {hash:'preview',existingOffers:2,model:{productName:'Вариант <новый>',hours:144,price:6500,oldPrice:8000},landing:{title:'Общий лендинг',url:'https://edu-plus.ru/courses-pk/shared/'}};
        if(rejectWrite)throw Error('Лендинг изменился. Обновите проверку.');
        return {ok:true,isVariant:true,product:{id:99},landing:{url:'https://edu-plus.ru/courses-pk/shared/'},certificates:[]};
      };
      ${extract('openProgramSiteVariant')}
      document.querySelector('#open').onclick=()=>openProgramSiteVariant();
    `});
    await page.click("#open");
    await page.waitForFunction(()=>document.querySelector('[data-variant-preview]').textContent.includes('6500'));
    assert.equal(await page.locator('[data-variant-apply]').isEnabled(),false);
    assert.ok((await page.locator('[data-variant-preview]').textContent()).includes('Вариант <новый>'));
    await page.check('[data-variant-reviewed]');
    await page.click('[data-variant-apply]');
    await page.waitForFunction(()=>document.querySelector('[data-variant-status]').textContent.includes('Товар №99 создан'));
    assert.equal(await page.locator('input[name=productId]').inputValue(),'99');
    const saved=await page.evaluate(()=>({programs:state.data.collections.programs,requests}));
    assert.equal(saved.programs[0].siteProductPending,false);assert.equal(saved.programs[1].productId,'12');
    assert.deepEqual(saved.requests.map(item=>item.action),['preview-variant','add-variant']);
    assert.equal(await page.locator('[data-variant-apply]').isEnabled(),false);
    await page.click('[data-variant-close]');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{rejectWrite=true;state.data.collections.programs[0]={id:'copy',productId:'',siteProductPending:true};});
    await page.click('#open');
    await page.waitForFunction(()=>document.querySelector('[data-variant-preview]').textContent.includes('6500'));
    assert.equal(await page.locator('dialog').evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth),true,'Dialog must fit mobile viewport');
    await page.check('[data-variant-reviewed]');await page.click('[data-variant-apply]');
    await page.waitForFunction(()=>document.querySelector('[data-variant-status]').textContent.includes('Лендинг изменился'));
    assert.equal(await page.evaluate(()=>state.data.collections.programs[0].productId),'');
    assert.equal(await page.locator('[data-variant-apply]').isEnabled(),false);
    await page.press('dialog','Escape');
    assert.equal(await page.locator('dialog').count(),0);
    console.log('PASS: desktop/mobile variant dialog, explicit confirmation, product-code persistence, original isolation, failure and close behavior');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
