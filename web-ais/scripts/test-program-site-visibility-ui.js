"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"app.js"),"utf8").replace(/\r\n/g,"\n");
const extract=name=>source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`,"m"))[0];
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:850}});
    await page.route("**/*",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:`<style>${fs.readFileSync(path.join(root,"styles.css"),"utf8")}</style><form id="recordForm" data-config="programs"></form><button id="open">Видимость вариантов</button>`}));
    await page.goto("http://127.0.0.1/isolated-visibility-test");
    await page.addScriptTag({content:`
      let requests=[],isAdmin=true,rejectWrite=false,refreshed=0;
      const isAdminUser=()=>isAdmin,isDatabaseDemoMode=()=>false,isSettingsDraftSessionActive=()=>false;
      const saveRecordFormBeforeContinuation=async()=> 'copy',ensureRecordLockForSave=async()=>true;
      const refreshProgramSiteLinks=async()=>{refreshed++;};
      const createProgramSiteProgress=()=>({start(){},stop(){},dispose(){}});
      const escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const escapeAttr=value=>escapeHtml(value).replace(/"/g,'&quot;');
      const plan={exists:true,landing:{id:42,version:'v1',variantVisibility:true},product:{id:99},products:[{id:12,title:'Базовый курс 72 ч',hidden:false},{id:99,title:'Вариант <новый> 144 ч',hidden:true}]};
      const programSiteRequest=async(action,body)=>{
        requests.push({action,body});
        if(action==='resolve')return structuredClone(plan);
        if(rejectWrite)throw Error('Лендинг изменился.');
        plan.products.find(item=>item.id===body.productId).hidden=body.hidden;
        return {ok:true,...body};
      };
      ${extract('openProgramSiteVisibility')}
      document.querySelector('#open').onclick=()=>openProgramSiteVisibility();
    `});
    await page.click('#open');
    await page.waitForFunction(()=>document.querySelector('[data-visibility-product]').options.length===2);
    assert.equal(await page.locator('[data-visibility-product]').inputValue(),'99');
    assert.equal(await page.locator('[data-visibility-visible]').isChecked(),false);
    assert.equal(await page.locator('[data-visibility-save]').isEnabled(),false);
    assert.match(await page.locator('[data-visibility-product]').textContent(),/Вариант <новый>/);
    await page.check('[data-visibility-visible]');
    await page.click('[data-visibility-save]');
    await page.waitForFunction(()=>!document.querySelector('dialog'));
    let result=await page.evaluate(()=>({requests,plan,refreshed}));
    assert.deepEqual(result.requests[1],{action:'set-variant-visibility',body:{programId:'copy',productId:99,hidden:false,landingId:42,version:'v1'}});
    assert.equal(result.plan.products[0].hidden,false);assert.equal(result.refreshed,1);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{rejectWrite=true;});
    await page.click('#open');
    await page.waitForFunction(()=>document.querySelector('[data-visibility-product]').options.length===2);
    assert.equal(await page.locator('dialog').evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth),true);
    await page.uncheck('[data-visibility-visible]');
    await page.click('[data-visibility-save]');
    await page.waitForFunction(()=>document.querySelector('[data-visibility-status]').textContent.includes('Лендинг изменился'));
    assert.equal(await page.locator('[data-visibility-save]').isEnabled(),false,'Stale action requires fresh list');
    await page.click('[data-visibility-refresh]');
    await page.waitForFunction(()=>document.querySelector('[data-visibility-visible]').checked);
    await page.selectOption('[data-visibility-product]','12');
    assert.equal(await page.locator('[data-visibility-save]').isEnabled(),false,'Changing selection alone does not write');
    if(process.env.AIS_TEST_SCREENSHOT) await page.screenshot({path:process.env.AIS_TEST_SCREENSHOT});
    await page.press('dialog','Escape');
    assert.equal(await page.locator('dialog').count(),0);
    await page.evaluate(()=>{isAdmin=false;});await page.click('#open');
    assert.equal(await page.locator('dialog').count(),0);
    console.log('PASS: visibility dialog on desktop/mobile, selection, explicit save, no-op, restoration, error recovery, close and admin guard');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
