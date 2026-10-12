"use strict";
// Isolated DOM fixture, all mail queries/imports are mocked. No real mailbox access.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"app.js"),"utf8").replace(/\r\n/g,"\n");
const extract=name=>source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`,"m"))[0];
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.setContent(`<style>${fs.readFileSync(path.join(root,"styles.css"),"utf8")}</style><button id="open">Письма</button>`);
    await page.addScriptTag({content:`
      const calls=[],alerts=[];
      let learnerEmail='learner@example.test',hasChair=true;
      const record=()=>({id:'s',name:'Тестовый Слушатель',email:learnerEmail});
      const collectStudentFormDraft=record,collectContractFormDraft=record;
      const getAvailableStudentDocumentMailboxes=()=>[{id:'mail',login:'inbox@example.test',label:'Ящик'}];
      const DEFAULT_STUDENT_APPLICATIONS_EMAIL={login:'inbox@example.test'};
      const getContractDocumentsFolder=()=> 'Employees/Test',getStudentYandexDocumentsFolder=()=> 'Students/Test';
      const getStudentMailboxOptionLabel=()=> 'Ящик';
      const getStudentMailboxChair=()=>hasChair?{name:'Тестовый Председатель',emails:['chair@example.test'],warning:''}:{name:'',emails:[],warning:'В комиссии программы не указан председатель ИАК.'};
      const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const escapeAttr=escapeHtml,renderStudentMailboxMessageText=escapeHtml,formatDateTimeRu=value=>value,formatBytes=value=>value+' Б',photoApiUrl=value=>value;
      const alert=message=>alerts.push(message);
      const fetch=async(url,options)=>{
        const body=JSON.parse(options.body);calls.push({url,body});
        if(url.endsWith('/import'))return {ok:true,json:async()=>({messages:1,files:[{name:'Протокол.pdf'}],importedAttachments:1})};
        const messages=[{uid:'1',subject:'От слушателя',from:'learner@example.test',to:'inbox@example.test',attachments:[{index:0,name:'Документы.pdf',size:100}]}];
        if(body.chairEmails.length)messages.push({uid:'2',subject:'Протокол <проверка>',from:'chair@example.test',to:'inbox@example.test',fromChair:true,attachments:[{index:0,name:'Протокол.pdf',size:200}]});
        return {ok:true,json:async()=>({messages,total:messages.length,warnings:[]})};
      };
      ${extract('studentMailboxDateOffset')}
      ${extract('openStudentMailboxDocuments')}
      document.querySelector('#open').onclick=openStudentMailboxDocuments;
    `});
    await page.click('#open');
    await page.waitForFunction(()=>document.querySelectorAll('[data-student-mailbox-message]').length===2);
    assert.equal(await page.locator('[data-mailbox-include-chair]').isChecked(),true);
    assert.equal(await page.locator('[data-message-part]:checked').count(),0,"No auto-import or preselection of unrelated protocols");
    assert.match(await page.locator('[data-message-uid="2"]').textContent(),/Председатель ИАК программы/);
    assert.match(await page.locator('[data-message-uid="2"]').textContent(),/Протокол <проверка>/);
    await page.uncheck('[data-mailbox-include-chair]');
    await page.waitForFunction(()=>document.querySelectorAll('[data-student-mailbox-message]').length===1);
    await page.check('[data-mailbox-include-chair]');
    await page.waitForFunction(()=>document.querySelectorAll('[data-student-mailbox-message]').length===2);
    await page.check('[data-message-uid="2"] [data-message-part="attachment"]');
    await page.click('[data-action="import-student-mailbox"]');
    await page.waitForFunction(()=>!document.querySelector('[data-student-mailbox-dialog]'));
    const saved=await page.evaluate(()=>calls.at(-1).body);
    assert.deepEqual(saved.selections,[{uid:'2',includeText:false,attachmentIndexes:[0]}]);
    assert.equal(saved.folder,'Students/Test');assert.equal(saved.studentId,'s');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{learnerEmail='';});await page.click('#open');
    await page.waitForFunction(()=>document.querySelectorAll('[data-student-mailbox-message]').length===2);
    const query=await page.evaluate(()=>calls.at(-1).body);assert.equal(query.email,'');assert.deepEqual(query.chairEmails,['chair@example.test']);
    assert.equal(await page.locator('.student-mailbox-dialog').evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth),true);
    await page.locator('[data-action="close-student-mailbox"]').first().click();
    await page.evaluate(()=>{document.querySelector('#open').dataset.mailboxEntityType='contract';});await page.click('#open');
    await page.waitForFunction(()=>document.querySelectorAll('[data-student-mailbox-message]').length===1);
    assert.equal(await page.locator('[data-mailbox-include-chair]').count(),0);
    assert.deepEqual(await page.evaluate(()=>calls.at(-1).body.chairEmails),[]);
    await page.locator('[data-action="close-student-mailbox"]').first().click();
    await page.evaluate(()=>{document.querySelector('#open').dataset.mailboxEntityType='student';hasChair=false;});await page.click('#open');
    await page.waitForFunction(()=>document.querySelectorAll('[data-student-mailbox-message]').length===1);
    assert.equal(await page.locator('[data-mailbox-include-chair]').isEnabled(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: default chairman search, opt-out, no automatic selection, protocol-only import to student folder, empty learner email, employee isolation and mobile dialog');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
