"use strict";
// Isolated editors and synthetic text; no settings or production data are written.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"app.js"),"utf8").replace(/\r\n?/g,"\n");
function extract(name){const m=source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`,"m"));assert.ok(m,name);return m[0];}
const names=["serializeCommunicationTemplateEditor","getCommunicationTemplateEditorCaretOffset","setCommunicationTemplateEditorCaretOffset","getCommunicationTemplateRangeAtOffset","getCommunicationTemplateNodeStartOffset","refreshCommunicationTemplateEditor","syncCommunicationTemplateEditor","renderCommunicationTemplateEditorContent","renderCommunicationTemplateSyntax","renderCommunicationTemplateLinks"];
names.push("getCommunicationTemplateEditorTextModel", "ensureCommunicationTemplateEditorTrailingLine", "replaceCommunicationTemplateEditorHtml");
names.push("handleCommunicationTemplateLineBreak");
const refreshers=["refreshCommunicationTemplateEditor", "refreshCommunicationTemplateFormulaEditor", "refreshTemplateLinkEditor", "refreshContractFormulaEditor", "refreshAutomaticExpenseRulesEditor", "refreshPaymentFormulaEditor", "refreshDocumentEmailTemplateEditor", "refreshDocumentPathValueEditor", "refreshDocumentSaveFolderEditor", "refreshDataFormulaEditor", "refreshAdminSqlQueryEditor"];
names.push(...refreshers.slice(1));
names.push("renderCommunicationTemplateFormulaEditorContent", "initializeCommunicationTemplateEditorHistory", "recordCommunicationTemplateEditorChange", "commitCommunicationTemplateEditorChange", "restoreCommunicationTemplateEditorHistoryValue", "undoCommunicationTemplateEditor", "redoCommunicationTemplateEditor", "renderCommunicationTemplateEditorValue", "syncCommunicationTemplateEditorByType");
async function main(){
 const functions=names.map(extract).join("\n");
 const html=`<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><script src="/field-html-links.js"></script><form><div id="editor" class="communication-template-editor" contenteditable="true" data-template-editor data-template-index="0" role="textbox" style="height:100px;overflow:auto">Строка</div><input name="template0" type="hidden"><input name="formula" type="hidden"></form><button id="outside">Снаружи</button><textarea id="native"></textarea><script>
 const escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),escapeAttr=escapeHtml;
 const getCommunicationTemplateFieldDefinitions=()=>[{name:'ФИО'}];
 const communicationTemplateEditorHistories=new WeakMap();
 const collectContractTemplateForm=()=>({document:{fields:[]}}),getDocumentEmailEditorTokens=()=>[];
 const renderContractFormulaEditorContent=renderCommunicationTemplateEditorContent,renderAutomaticExpenseRulesEditorContent=renderCommunicationTemplateEditorContent,renderPaymentFormulaEditorContent=renderCommunicationTemplateEditorContent,renderDocumentEmailEditorContent=renderCommunicationTemplateEditorContent,renderDocumentPathValueEditorContent=renderCommunicationTemplateEditorContent,renderDocumentSaveFolderEditorContent=renderCommunicationTemplateEditorContent,renderDataFormulaEditorContent=renderCommunicationTemplateEditorContent,renderAdminSqlQuerySyntax=renderCommunicationTemplateEditorContent;
 const syncContractFormulaEditor=()=>{},syncAutomaticExpenseRulesEditor=()=>{},syncPaymentFormulaEditor=()=>{},syncDocumentEmailTemplateEditor=()=>{},syncDocumentPathValueEditor=()=>{},syncDocumentSaveFolderEditor=()=>{},syncDataFormulaEditor=()=>{},syncAdminSqlQueryEditor=()=>{},updateSqlMiniIdeLineNumbers=()=>{},updateSqlMiniIdeValidation=()=>{},updateSqlMiniIdeBracketHighlight=()=>{};
 ${functions}
 const editor=document.querySelector('#editor');let timer; window.refresher='refreshCommunicationTemplateEditor';
 editor.addEventListener('beforeinput',event=>handleCommunicationTemplateLineBreak(event,editor));
 editor.addEventListener('input',()=>{window.lastInputDom=editor.innerHTML;recordCommunicationTemplateEditorChange(editor);syncCommunicationTemplateEditor(editor);clearTimeout(timer);timer=setTimeout(()=>window[window.refresher](editor,true),140);});
 editor.addEventListener('blur',()=>{clearTimeout(timer);window[window.refresher](editor,false);});
 window.reset=(text='Строка')=>{clearTimeout(timer);editor.dataset.composing='';replaceCommunicationTemplateEditorHtml(editor,renderCommunicationTemplateEditorContent(text));communicationTemplateEditorHistories.delete(editor);initializeCommunicationTemplateEditorHistory(editor);editor.focus();setCommunicationTemplateEditorCaretOffset(editor,text.length);};
 </script></html>`;
 const server=http.createServer((req,res)=>{const asset=["/styles.css","/field-html-links.js"].includes(req.url);res.setHeader("Content-Type",asset?(req.url.endsWith('.css')?"text/css":"text/javascript"):"text/html; charset=utf-8");res.end(asset?fs.readFileSync(path.join(root,req.url.slice(1))):html);});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));let browser;
 try{
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
  for(const refresher of refreshers){
  await page.evaluate(name=>{window.refresher=name;reset('Строка {ФИО} https://example.test/');},refresher);
  for(let n=1;n<=3;n++){
   await page.keyboard.press('Enter');await page.waitForTimeout(220);
   const result=await page.evaluate(()=>({text:serializeCommunicationTemplateEditor(editor),caret:getCommunicationTemplateEditorCaretOffset(editor),html:editor.innerHTML,raw:window.lastInputDom}));
   assert.equal(result.text,'Строка {ФИО} https://example.test/'+'\n'.repeat(n),refresher+JSON.stringify(result));assert.equal(result.caret,result.text.length,refresher+JSON.stringify(result));
  }
  await page.keyboard.insertText('Продолжение');await page.waitForTimeout(220);
  assert.equal(await page.evaluate(()=>serializeCommunicationTemplateEditor(editor)),'Строка {ФИО} https://example.test/\n\n\nПродолжение',refresher);
  assert.equal(await page.locator('#editor [data-template-external-url]').count(),1,'Live link highlight lost');
  await page.keyboard.press('Shift+Enter');await page.waitForTimeout(220);
  const shifted=await page.evaluate(()=>({text:serializeCommunicationTemplateEditor(editor),raw:window.lastInputDom,html:editor.innerHTML}));
  assert.ok(shifted.text.endsWith('Продолжение\n'),refresher+' Shift+Enter '+JSON.stringify(shifted));
  await page.keyboard.press('Backspace');await page.waitForTimeout(220);
  assert.ok((await page.evaluate(()=>serializeCommunicationTemplateEditor(editor))).endsWith('Продолжение'),refresher+' Backspace');
  }
  for(const initial of ['', '{ФИО}', 'abc\ndef']){
   await page.evaluate(text=>{window.refresher='refreshCommunicationTemplateEditor';reset(text);},initial);
   await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.waitForTimeout(220);
   assert.equal(await page.evaluate(()=>serializeCommunicationTemplateEditor(editor)),initial+'\n\n','Empty/token-only editor');
   await page.keyboard.insertText('Z');await page.waitForTimeout(220);
   assert.equal(await page.evaluate(()=>serializeCommunicationTemplateEditor(editor)),initial+'\n\nZ');
  }
  await page.evaluate(()=>{reset('abcdef');const model=getCommunicationTemplateEditorTextModel(editor),a=model.rangeAt(4),b=model.rangeAt(2);getSelection().setBaseAndExtent(a.startContainer,a.startOffset,b.startContainer,b.startOffset);});
  await page.keyboard.press('Enter');await page.waitForTimeout(220);
  assert.deepEqual(await page.evaluate(()=>({text:serializeCommunicationTemplateEditor(editor),caret:getCommunicationTemplateEditorCaretOffset(editor)})),{text:'ab\nef',caret:3},'Replace backward selection with line break');
  await page.keyboard.insertText('Z');await page.waitForTimeout(220);
  assert.equal(await page.evaluate(()=>serializeCommunicationTemplateEditor(editor)),'ab\nZef','Continue on inserted middle line');
  await page.evaluate(()=>{window.refresher='refreshCommunicationTemplateEditor';reset('abc\n\n');});
  await page.keyboard.insertText('Z');await page.waitForTimeout(220);
  await page.evaluate(()=>undoCommunicationTemplateEditor(editor));assert.equal(await page.evaluate(()=>serializeCommunicationTemplateEditor(editor)),'abc\n\n');
  await page.evaluate(()=>redoCommunicationTemplateEditor(editor));assert.equal(await page.evaluate(()=>serializeCommunicationTemplateEditor(editor)),'abc\n\nZ');
  const checks=await page.evaluate(()=>{
   const check=(ok,label)=>{if(!ok)throw Error(label);};
   for(const [html,text] of [['abc\n\n','abc\n\n'],['<div>abc</div><div><br></div><div><br></div>','abc\n\n'],['abc<div>def</div>','abc\ndef'],['<div>abc</div>def','abc\ndef'],['<div>abc</div><span>def</span>','abc\ndef'],['<p>abc</p><p>def</p>','abc\ndef'],['abc<br><br>','abc\n'],['<br>','']]){
    editor.innerHTML=html;check(serializeCommunicationTemplateEditor(editor)===text,'DOM serialization: '+html);
    for(let i=0;i<=text.length;i++){const model=getCommunicationTemplateEditorTextModel(editor),r=model.rangeAt(i);check(model.offsetAt(r.startContainer,r.startOffset)===i,'Offset roundtrip '+html+': '+i);}
   }
   reset('abc\n\n');setCommunicationTemplateEditorCaretOffset(editor,4);refreshCommunicationTemplateEditor(editor,true);check(getCommunicationTemplateEditorCaretOffset(editor)===4,'Caret on empty middle line');
   reset('abc\n\ndef');const model=getCommunicationTemplateEditorTextModel(editor),a=model.rangeAt(7),b=model.rangeAt(2);getSelection().setBaseAndExtent(a.startContainer,a.startOffset,b.startContainer,b.startOffset);refreshCommunicationTemplateEditor(editor,true);
   check(getCommunicationTemplateEditorTextModel(editor).offsetAt(getSelection().anchorNode,getSelection().anchorOffset)===7&&getCommunicationTemplateEditorTextModel(editor).offsetAt(getSelection().focusNode,getSelection().focusOffset)===2,'Backward selection');
   reset(Array.from({length:50},(_,i)=>'Строка '+i).join('\n')+'\n\n');editor.scrollTop=160;const top=editor.scrollTop;refreshCommunicationTemplateEditor(editor,true);check(editor.scrollTop===top,'Scroll position');
   editor.dataset.composing='true';const before=editor.innerHTML;refreshCommunicationTemplateEditor(editor,true);check(editor.innerHTML===before,'IME DOM must not be rebuilt');editor.dataset.composing='';
   document.querySelector('#outside').focus();refreshCommunicationTemplateEditor(editor,true);check(document.activeElement.id==='outside','Delayed highlight stole focus');
   reset('a\n\n');document.querySelector('#outside').focus();check(serializeCommunicationTemplateEditor(editor)==='a\n\n'&&document.querySelector('[name=template0]').value==='a\n\n','Blur/saved value loses lines');
   return true;
  });assert.equal(checks,true);
  await page.locator('#native').fill('https://example.test/');await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.waitForTimeout(220);assert.equal(await page.locator('#native').inputValue(),'https://example.test/\n\n');
  assert.deepEqual(errors,[]);
  console.log('PASS: 11 editor refresh paths, Enter/Shift+Enter/Backspace, literal/block lines, token/link highlighting, caret/selection/scroll, undo/redo, IME, blur/saved value, native textarea');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
