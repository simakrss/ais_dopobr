"use strict";
// Isolated browser fixtures; synthetic clipboard events do not write the user's clipboard.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
const names = [
  "renderCommunicationTemplateAudienceForm", "renderCommunicationTemplateFieldToken", "renderCommunicationTemplateEditorContent",
  "renderCommunicationTemplateSyntax", "renderCommunicationTemplateLinks", "bindCommunicationTemplateFieldActions",
  "serializeCommunicationTemplateEditor", "getCommunicationTemplateEditorTextModel", "getCommunicationTemplateSelectedText",
  "getSelectedControlText", "handleCommunicationTemplateCopyEvent", "selectCommunicationTemplateToken",
  "appendCommunicationTemplateCopyAction", "showCommunicationTemplateFieldMenu", "renderCommunicationTemplateFieldActionIcon",
  "refreshCommunicationTemplateEditor", "replaceCommunicationTemplateEditorHtml", "ensureCommunicationTemplateEditorTrailingLine"
];
assert.match(extract("bindFieldEditHistory"), /addEventListener\("copy", handleCommunicationTemplateCopyEvent\)/);
assert.match(extract("bindFieldEditHistory"), /addEventListener\("click", selectCommunicationTemplateToken\)/);
for (const name of ["showCommunicationTemplateFieldMenu", "showContractFormulaTokenMenu", "showPaymentFormulaConstantMenu"]) {
  assert.match(extract(name), /appendCommunicationTemplateCopyAction\(/);
}
async function main() {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
  <style>body{padding:20px}#forms{width:850px}.communication-template-audience-panel{height:340px;margin:10px 0}.communication-template-field-list{min-height:65px}#other{width:850px}.communication-template-editor{min-height:60px}.communication-template-actions{display:none}</style>
  <main id="forms"></main><section id="other"></section><textarea id="native"></textarea><script>
  const state={communicationTemplateFieldsCollapsed:{}}, definitions=[{name:'ФИО',formula:'',initialFormula:''},{name:'Email',formula:'',initialFormula:''}];
  const getCommunicationTemplateFieldDefinitions=()=>definitions, escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'), escapeAttr=escapeHtml;
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));let lastKnownClipboardText='', dialogOpens=0;const copied=[];
  const copyTextToClipboard=text=>copied.push(text), showCommunicationTemplateFieldDialog=()=>dialogOpens++;
  const hideCommunicationTemplateFieldMenu=()=>document.querySelector('[data-communication-template-field-menu]')?.remove();
  const closeCommunicationTemplateFieldMenuOnOutsideClick=()=>{}, getCommunicationTemplateNodeStartOffset=()=>0;
  ${names.map(extract).join("\n")}
  window.renderForms=()=>{document.querySelector('#forms').innerHTML=['students','employees'].map(audience=>renderCommunicationTemplateAudienceForm({audience,messages:[{}],templates:['Начало {ФИО} — {Email} конец\\n\\n'],descriptions:['Тест'],templateFields:definitions,active:true})).join('');bindCommunicationTemplateFieldActions();};renderForms();
  document.addEventListener('copy',handleCommunicationTemplateCopyEvent);document.addEventListener('click',selectCommunicationTemplateToken);
  window.selectAll=editor=>{editor.focus();const r=document.createRange();r.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(r);};
  window.copySelection=(target)=>{const data=new DataTransfer();data.setData('text/html','<b>stale</b>');const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});target.dispatchEvent(event);return{text:data.getData('text/plain'),html:data.getData('text/html'),handled:event.defaultPrevented};};
  </script></html>`;
  const server = http.createServer((req,res) => {const css=req.url==='/styles.css';res.setHeader('Content-Type',css?'text/css':'text/html; charset=utf-8');res.end(css?fs.readFileSync(path.join(root,'styles.css')):html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
    const page=await browser.newPage({viewport:{width:1150,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const fields=page.locator('[data-communication-template-fields="students"]'), list=fields.locator('.communication-template-field-list');
    assert.equal(await list.isVisible(),true);
    const beforeHeight=await page.locator('[data-template-audience="students"] .communication-template-list').evaluate(e=>e.clientHeight);
    await fields.locator('summary').click();await page.waitForTimeout(30);
    assert.equal(await list.isVisible(),false);
    assert.ok(await page.locator('[data-template-audience="students"] .communication-template-list').evaluate(e=>e.clientHeight)>beforeHeight,'Collapsing frees message space');
    await page.evaluate(()=>renderForms());assert.equal(await list.isVisible(),false,'State survives re-render');
    assert.equal(await page.locator('[data-communication-template-fields="employees"] .communication-template-field-list').isVisible(),true,'Audiences independent');
    await fields.locator('summary').focus();await page.keyboard.press('Enter');await page.waitForTimeout(30);assert.equal(await list.isVisible(),true,'Keyboard toggle');
    await fields.locator('[data-action="add-communication-template-field"]').click();assert.equal(await page.evaluate(()=>dialogOpens),1);assert.equal(await list.isVisible(),true,'Add button does not collapse');
    for (const audience of ['students','employees']) {
      const editor=page.locator('[data-template-audience="'+audience+'"] [data-template-editor]');
      await editor.locator('[data-template-token="{ФИО}"]').click();
      assert.equal(await editor.evaluate(e=>getCommunicationTemplateSelectedText(e)),'{ФИО}','Click selects token');
      await editor.evaluate(e=>refreshCommunicationTemplateEditor(e,true));
      assert.deepEqual(await editor.evaluate(e=>copySelection(e)),{text:'{ФИО}',html:'',handled:true},'Copy token after rehighlight');
      await editor.evaluate(e=>selectAll(e));
      const all=await editor.evaluate(e=>copySelection(e));assert.equal(all.text,'Начало {ФИО} — {Email} конец\n\n');
      assert.equal(all.html,'');
      await editor.locator('[data-template-token="{ФИО}"]').click({button:'right'});
      await page.locator('[data-action="copy-template-token"]').click();
      assert.equal(await page.evaluate(()=>copied.at(-1)),all.text,'Context menu copies selected message including fields');
    }
    // Use actual mouse selection across ordinary text and both atomic fields.
    const editor=page.locator('[data-template-audience="students"] [data-template-editor]');
    const points=await editor.evaluate(e=>{getSelection().removeAllRanges();const a=document.createRange(),b=document.createRange();a.setStart(e.firstChild,0);a.collapse(true);b.setStart(e.lastChild.nodeType===3?e.lastChild:e.lastChild.previousSibling,6);b.collapse(true);return{a:a.getBoundingClientRect().toJSON(),b:b.getBoundingClientRect().toJSON()};});
    await page.mouse.move(points.a.x,points.a.y+5);await page.mouse.down();await page.mouse.move(points.b.x,points.b.y+5,{steps:12});await page.mouse.up();
    assert.match(await editor.evaluate(e=>copySelection(e).text),/\{ФИО\}.*\{Email\}/,'Mouse selection includes tokens');
    await editor.focus();await page.keyboard.press('Control+A');
    const saved=await editor.evaluate(e=>copySelection(e).text);
    assert.equal(saved,'Начало {ФИО} — {Email} конец\n\n','Keyboard select all');
    await page.keyboard.insertText(saved);await editor.evaluate(e=>refreshCommunicationTemplateEditor(e,true));
    assert.equal(await editor.locator('[data-template-token]').count(),2,'Plain clipboard insertion restores fields');
    assert.equal(await editor.evaluate(e=>serializeCommunicationTemplateEditor(e)),saved,'Round trip preserves blank lines');
    // All other editor kinds share the same atomic selection and clipboard handler.
    for(const attribute of ['data-formula-editor','data-contract-formula-editor','data-data-formula-editor','data-document-email-editor','data-payment-formula-editor','data-automatic-expense-rules-editor','data-document-save-folder-editor','data-document-path-value-editor']) {
      await page.evaluate(attr=>{document.querySelector('#other').innerHTML='<div class="communication-template-editor" '+attr+' contenteditable="true" role="textbox">До <span class="communication-template-block" contenteditable="false" data-template-token="{Поле}"><span>Видимое имя</span><button>×</button></span> после\n\n</div>';},attribute);
      const target=page.locator('#other [role="textbox"]');await target.locator('[data-template-token] > span').click();
      assert.equal(await target.evaluate(e=>copySelection(e).text),'{Поле}',attribute);
      await target.evaluate(e=>selectAll(e));assert.equal(await target.evaluate(e=>copySelection(e).text),'До {Поле} после\n\n',attribute+' full copy');
      await target.evaluate(e=>{const text=e.querySelector('[data-template-token] > span').firstChild,r=document.createRange();r.setStart(text,2);r.setEnd(text,5);getSelection().removeAllRanges();getSelection().addRange(r);});
      assert.equal(await target.evaluate(e=>copySelection(e).text),'{Поле}',attribute+' partial token becomes complete marker');
    }
    // Ordinary input fields and selections outside one editor retain native behavior.
    assert.equal(await page.locator('#native').evaluate(e=>copySelection(e).handled),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: collapsible palettes, independent state, keyboard/add, mouse/click selection, canonical clipboard markers in 10 editor types, menus, whitespace, native input isolation');
  } finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
