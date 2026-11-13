"use strict";
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright"),enrollment=require("../student-enrollment");
const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"app.js"),"utf8");
const ui=source.slice(source.indexOf("  function renderStudentPortalOpenButton("),source.indexOf("  async function saveStudentAwardFile("));
const htmlBuilder=source.slice(source.indexOf("  function documentEmailMessageContainsHtml("),source.indexOf("  function showGeneratedDocumentEmailPreview("));
const record={id:"one",name:"Тестовый слушатель",email:"student@example.test",program:"Тестовая программа КПК",educationType:"КПК",studentPortalEnabled:true,studentPortalLogin:"student_test",studentPortalPassword:"123456"};
let previewCount=0,sendCount=0,rejectStale=false,unknown=false;const seen=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://test");
 if(url.pathname==="/styles.css"){res.setHeader("Content-Type","text/css");res.end(fs.readFileSync(path.join(root,"styles.css")));return;}
 if(url.pathname.endsWith("/access-email")){
  let raw="";for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);seen.push(body);assert.equal(url.searchParams.get("studentId"),"one");
  res.setHeader("Content-Type","application/json");
  if(body.operation==="preview"){previewCount++;await new Promise(resolve=>setTimeout(resolve,100));res.end(JSON.stringify({ok:true,email:record.email,subject:"Доступ в личный кабинет",name:record.name,message:enrollment.welcomeMessage(record,{repeat:true}),revision:"fixture-v"+previewCount}));return;}
  sendCount++;await new Promise(resolve=>setTimeout(resolve,150));
  if(rejectStale){rejectStale=false;res.statusCode=409;res.end(JSON.stringify({error:"Данные доступа изменились. Обновите предпросмотр письма."}));return;}
  if(unknown){res.statusCode=409;res.end(JSON.stringify({error:"Результат отправки неизвестен. Проверьте журнал перед повторной отправкой."}));return;}
  res.end(JSON.stringify({ok:true,message:"Письмо отправлено на student@example.test."}));return;
 }
 res.setHeader("Content-Type","text/html; charset=utf-8");res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><main><div id="actions"></div><input id="cardDraft" value="Несохраненное изменение"></main><script>
 const state={modal:{id:'one'},data:{collections:{students:[${JSON.stringify(record)}]}}};
 const escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');const escapeAttr=escapeHtml;
 const isDatabaseDemoMode=()=>false,getCurrentAuthUser=()=>({role:'manager'});
 window.AIS_AUTH_API={appUrl:p=>p,request:async(p,options)=>{const response=await fetch('/'+p,options),body=await response.json();if(!response.ok){const e=Error(body.error);e.status=response.status;throw e;}return body;}};
 ${htmlBuilder}
 ${ui}
 document.querySelector('#actions').innerHTML=renderStudentPortalOpenButton(state.data.collections.students[0]);document.querySelector('[data-student-portal-menu]').onclick=openStudentPortalMenu;
 </script>`);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||"msedge",headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on("pageerror",e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
  const open=async()=>{await page.locator('[data-student-portal-menu]').click();await page.locator('[data-student-access-email]').click();await page.getByText('Проверьте получателя и текст письма.',{exact:true}).waitFor();};
  await open();assert.equal(sendCount,0);assert.equal(previewCount,1);
  assert.match(await page.locator('[data-access-email-to]').inputValue(),/student@example.test/);
  const frame=page.frameLocator('[data-access-email-frame]');await frame.getByText('123456',{exact:true}).waitFor();assert.ok(await frame.getByText('Отправить на проверку',{exact:false}).isVisible());
  assert.equal(await page.locator('[data-access-email-send]').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(15, 118, 110)');
  const out=path.join(root,'.runtime/student-access-email-test');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'desktop.png')});
  await page.locator('[data-access-email-close]').click();assert.equal(sendCount,0);assert.equal(await page.locator('#cardDraft').inputValue(),'Несохраненное изменение');
  await open();rejectStale=true;await page.locator('[data-access-email-send]').click();await page.getByText('Данные доступа изменились. Обновите предпросмотр письма.',{exact:false}).waitFor();assert.equal(await page.locator('[data-access-email-send]').isDisabled(),true);
  await page.locator('[data-access-email-refresh]').click();await page.getByText('Проверьте получателя и текст письма.',{exact:true}).waitFor();
  const subject=page.locator('[data-access-email-subject]');await subject.fill('');await page.locator('[data-access-email-send]').click();await page.getByText('Укажите тему письма.',{exact:true}).waitFor();assert.equal(sendCount,1);
  await subject.fill('Индивидуальная инструкция слушателю');await page.locator('[data-access-email-edit]').click();
  const editor=frame.locator('body[contenteditable="true"]');await editor.waitFor();await editor.press('Control+End');await editor.press('Enter');await editor.press('Enter');await page.keyboard.insertText('Индивидуальное дополнение к инструкции.');
  assert.ok((await editor.innerText()).trimEnd().endsWith('Индивидуальное дополнение к инструкции.'),'Caret remains at the end after empty paragraphs');
  await editor.evaluate(body=>{const data=new DataTransfer();data.setData('text/html','<img src=x onerror="parent.pasteExecuted=true">');data.setData('text/plain',' Вставленный текст');body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  assert.equal(await frame.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.pasteExecuted),undefined);
  await page.locator('[data-access-email-edit]').click();assert.equal(await frame.locator('body').getAttribute('contenteditable'),'false');
  const previewBefore=previewCount;await page.locator('[data-access-email-refresh]').click();await frame.getByText('Индивидуальное дополнение к инструкции.',{exact:false}).waitFor();assert.equal(previewCount,previewBefore);assert.equal(await subject.inputValue(),'Индивидуальная инструкция слушателю');
  assert.ok(await frame.locator('a[href="https://edu-plus.ru/lms/"]').isVisible());
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=392));
  const rect=await page.locator('dialog[open]').boundingBox();assert.ok(rect.x>=0&&rect.width<=390&&rect.height<=844);const sendRect=await page.locator('[data-access-email-send]').boundingBox();assert.ok(sendRect.y+sendRect.height<=rect.y+rect.height,'Send stays visible on mobile');await page.screenshot({path:path.join(out,'mobile.png')});
  await page.locator('[data-access-email-send]').evaluate(button=>{button.click();button.click();});await page.getByText('Письмо отправлено на student@example.test.',{exact:true}).waitFor();assert.equal(sendCount,2);assert.equal(await page.locator('[data-access-email-send]').isDisabled(),true);
  const attempts=seen.filter(b=>b.operation==='send');assert.notEqual(attempts[0].requestId,attempts[1].requestId);assert.equal(attempts[1].subject,'Индивидуальная инструкция слушателю');assert.ok(attempts[1].message.includes('Индивидуальное дополнение к инструкции.'));assert.ok(attempts[1].message.includes('123456'));assert.equal(await subject.isDisabled(),true);
  await page.locator('[data-access-email-close]').click();await open();unknown=true;await page.locator('[data-access-email-send]').click();await page.getByText('Результат отправки неизвестен. Проверьте историю действий и папку «Отправленные» перед повторной отправкой.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-access-email-send]').isDisabled(),true);assert.equal(await page.locator('[data-access-email-refresh]').isDisabled(),true);assert.equal(await subject.isDisabled(),true);assert.equal(await page.locator('[data-access-email-edit]').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log('PASS: editable subject/rich text, preserved draft/links/caret, plaintext paste, exact edited send, standard preview dialog, recipient/credentials/instructions, cancel without send, stale refresh, double-click protection, unknown-delivery guard, unchanged card and mobile layout');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
