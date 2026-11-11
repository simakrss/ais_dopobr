"use strict";
const fs=require("node:fs"), path=require("node:path"), assert=require("node:assert/strict");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "playwright");
const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
const functions=source.slice(source.indexOf("  function getEnrollmentReviewStudents("),source.indexOf("  function isStudentAwaitingEnrollment("));
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || "msedge",headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="tiles"></main>');
    await page.addStyleTag({path:path.join(__dirname,"../styles.css")});
    await page.evaluate(()=>{
      window.state={data:{collections:{students:[
        {id:'a',name:'Первый <script>bad</script>',program:'КПК',enrollmentReviewStatus:'На проверке',enrollmentSubmittedAt:'2026-11-01T12:00:00Z',enrollmentDocuments:[{name:'passport.pdf'}],studentPortalDocumentsFolder:'Слушатели/a/Документы'},
        {id:'b',name:'Второй',program:'ДОП',enrollmentReviewStatus:'На проверке',enrollmentSubmittedAt:'2026-11-02T12:00:00Z'},
        {id:'c',name:'Черновик',enrollmentReviewStatus:'Заполняется'},
        {id:'d',name:'Проверен',enrollmentReviewStatus:'Проверено',enrollmentSubmittedAt:'2026-10-01'}
      ]}}};
      window.canAccessView=()=>true; window.isSettingsDraftSessionActive=()=>false;
      window.escapeHtml=window.escapeAttr=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      window.render=()=>{}; window.refreshAttestationTaskSnapshot=async()=>{};
      window.openAttestationTaskStudentCard=(id,backdrop,session,done)=>{window.openedCard=id;window.cardRows=session.rows.map(row=>row.record.id);done('');};
      window.getStudentYandexDocumentsFolder=r=>r.photoPath;
      window.openStudentWebDavDocumentsManager=async(folder,name,options)=>{window.openedDocuments={folder,name,file:options.selectedFileName};options.onClose();};
    });
    await page.addScriptTag({content:functions+`document.getElementById('tiles').innerHTML='<div class="dashboard-document-tasks with-enrollment-review">'+renderEnrollmentReviewDashboardTile()+'</div>';document.querySelector('[data-action="open-enrollment-review"]').onclick=openEnrollmentReviewDialog;`});
    assert.equal(await page.locator('[data-action="open-enrollment-review"] strong').textContent(),'2');
    await page.locator('[data-action="open-enrollment-review"]').click();
    assert.equal(await page.locator('[data-review-student]').count(),2);
    assert.equal(await page.locator('[data-enrollment-review] script').count(),0);
    await page.locator('[data-review-student="a"]').click(); assert.equal(await page.evaluate(()=>window.openedCard),'a');
    await page.locator('[data-review-documents="a"]').click();
    assert.deepEqual(await page.evaluate(()=>window.openedDocuments),{folder:'Слушатели/a/Документы',name:'Первый <script>bad</script>',file:'passport.pdf'});
    await page.evaluate(()=>state.data.collections.students[0].enrollmentReviewStatus='Проверено');
    await page.locator('[data-review-refresh]').click(); assert.equal(await page.locator('[data-review-student]').count(),1);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.locator('.enrollment-review-dialog').evaluate(e=>e.getBoundingClientRect().width<=window.innerWidth));
    assert.ok(await page.locator('.attestation-task-table-scroll').evaluate(e=>e.scrollWidth>e.clientWidth));
    await page.locator('[data-review-close]').click(); assert.equal(await page.locator('[data-enrollment-review]').count(),0);
    await page.evaluate(()=>{state.data.collections.students=[];}); assert.equal(await page.evaluate(()=>renderEnrollmentReviewDashboardTile()),'');
    assert.deepEqual(errors,[]); console.log('PASS: review tile, current queue, card navigation, document preview selection, escaping, refresh and mobile layout');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
