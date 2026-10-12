"use strict";
// Isolated real-browser editors, synthetic records only; no user settings or clipboard writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n?/g, "\n");
const extract = name => {
  const found = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(found, name);
  return found[0];
};
const names = [
  "bindTemplateTokenCursorInsertion", "bindCommunicationTemplateTokenDragLifecycle",
  "bindCommunicationTemplateDragAndDrop", "bindCommunicationTemplateFieldDialogFields", "bindDataFormulaConstructor",
  "bindContractTemplateConstructor", "bindProgramPaymentConstantPalette", "canInsertContractFormulaToken", "getContractFormulaEditorFieldName", "getContractFormulaTokenDocumentFieldName",
  "serializeCommunicationTemplateEditor", "getCommunicationTemplateEditorTextModel", "ensureCommunicationTemplateEditorTrailingLine",
  "getCommunicationTemplateRangeAtOffset", "getCommunicationTemplateEditorCaretOffset", "setCommunicationTemplateEditorCaretOffset",
  "getCommunicationTemplateNodeStartOffset", "replaceCommunicationTemplateEditorHtml", "getCommunicationTemplateDropRange",
  "syncCommunicationTemplateEditor", "refreshCommunicationTemplateEditor", "syncCommunicationTemplateFormulaEditor", "refreshCommunicationTemplateFormulaEditor",
  "renderCommunicationTemplateEditorContent", "renderCommunicationTemplateFormulaEditorContent", "renderCommunicationTemplateLinks", "renderCommunicationTemplateSyntax",
  "createCommunicationTemplateBlock", "createDataFormulaBlock", "syncDataFormulaEditor", "refreshDataFormulaEditor",
  "initializeCommunicationTemplateEditorHistory", "recordCommunicationTemplateEditorChange", "commitCommunicationTemplateEditorChange",
  "syncCommunicationTemplateEditorHistoryCurrent", "syncCommunicationTemplateEditorByType", "renderCommunicationTemplateEditorValue",
  "restoreCommunicationTemplateEditorHistoryValue", "undoCommunicationTemplateEditor", "redoCommunicationTemplateEditor", "handleCommunicationTemplateEditorHistoryKeydown"
];
for (const name of ["bindCommunicationTemplateDragAndDrop", "bindCommunicationTemplateFieldDialogFields", "bindContractTemplateConstructor", "bindDataFormulaConstructor", "bindDocumentEmailTemplateEditors", "bindProgramPaymentConstantPalette"]) {
  assert.match(extract(name), /bindTemplateTokenCursorInsertion\(/, name);
}
assert.doesNotMatch(source, /function insertContractTemplateToken\(/, "No append-only click path");
const editor = (id, attributes, input) => `<div id="${id}" contenteditable="true" ${attributes}>abcd</div><input name="${input}" type="hidden">`;
const button = (id, attributes, token = "{ФИО}") => `<button id="${id}" type="button" draggable="true" data-template-token="${token}" ${attributes}>${token}</button>`;
const messageForm = id => `<form id="${id}" data-action="save-communication-templates">${button(id + 'Token', 'class="communication-template-field-token"')}${editor(id + '0', 'data-template-editor data-template-index="0"', 'template0')}${editor(id + '1', 'data-template-editor data-template-index="1"', 'template1')}<input id="${id}Search" placeholder="Поиск"></form>`;
const html = `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif}form{padding:6px;border:1px solid #999} [contenteditable]{min-height:28px;white-space:pre-wrap;border:1px solid #ccc;margin:4px}button{padding:5px}.communication-template-block{background:#def}</style>
${messageForm('students')}${messageForm('employees')}
<section id="dialog"><form>${button('formulaToken', 'class="communication-template-field-token"')}${editor('formula', 'data-formula-editor', 'formula')}</form></section>
<form id="data" data-action="save-data-formulas">${button('dataToken', 'class="data-formula-token"')}${editor('data0', 'data-data-formula-editor data-formula-index="0"', 'formula0')}${editor('data1', 'data-data-formula-editor data-formula-index="1"', 'formula1')}</form>
<form id="contract" data-action="save-contract-template-fields"><input data-active-contract-name-input value="Текущее">${button('sourceToken', 'data-action="insert-contract-template-token"', '[Фото]')}${button('docToken', 'data-action="select-contract-document-token" data-contract-field-id="other"', '#Другое#')}${button('selfToken', 'data-action="select-contract-document-token" data-contract-field-id="self"', '#Текущее#')}${editor('contractEditor', 'data-contract-formula-editor', 'contract')}</form>
<form id="email">${button('emailToken', 'data-action="insert-document-email-token"')}${editor('subject', 'data-document-email-editor data-document-email-field="subject"', 'subject')}${editor('body', 'data-document-email-editor data-document-email-field="body"', 'body')}</form>
<form id="payment"><aside data-program-payment-constant-palette>${button('paymentToken', 'data-program-payment-constant-token="Ставка"', '[Ставка]')}</aside>${editor('paymentEditor', 'data-payment-formula-editor', 'amount')}</form>
<form id="automatic"><aside data-program-payment-constant-palette>${button('automaticToken', 'data-program-payment-constant-token="Ставка"', '[Ставка]')}</aside></form>
<script>
const escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),escapeAttr=escapeHtml;
const getCommunicationTemplateFieldDefinitions=()=>[{name:'ФИО'},{name:'Email'}];
const communicationTemplateEditorHistories=new WeakMap();let selectedField='',rejected=0;
const openTemplateEditorLink=()=>{},showCommunicationTemplateFieldMenu=()=>{},alert=()=>{rejected++};
const selectContractTemplateField=id=>{selectedField=id},showContractFormulaTokenMenu=()=>{},removeContractFormulaDropCaret=()=>{};
const collectContractTemplateForm=()=>({document:{fields:[]}});
const renderContractFormulaEditorContent=value=>escapeHtml(value),renderDataFormulaEditorContent=renderCommunicationTemplateEditorContent;
const syncContractFormulaEditor=e=>{e.closest('form').elements.contract.value=serializeCommunicationTemplateEditor(e)};
const refreshContractFormulaEditor=(e,p)=>replaceCommunicationTemplateEditorHtml(e,renderContractFormulaEditorContent(serializeCommunicationTemplateEditor(e)),p);
const syncDocumentEmailTemplateEditor=e=>{e.closest('form').elements[e.dataset.documentEmailField].value=serializeCommunicationTemplateEditor(e)};
const refreshDocumentEmailTemplateEditor=e=>{replaceCommunicationTemplateEditorHtml(e,renderCommunicationTemplateEditorContent(serializeCommunicationTemplateEditor(e)));syncDocumentEmailTemplateEditor(e)};
const normalizePaymentConstantMarker=value=>value,showProgramPaymentConstantMenu=()=>{};
const syncPaymentFormulaEditor=e=>{e.closest('form').elements.amount.value=serializeCommunicationTemplateEditor(e)};
const refreshPaymentFormulaEditor=e=>replaceCommunicationTemplateEditorHtml(e,escapeHtml(serializeCommunicationTemplateEditor(e)));
${names.map(extract).join("\n")}
bindCommunicationTemplateDragAndDrop();bindCommunicationTemplateFieldDialogFields(document.querySelector('#dialog'));bindDataFormulaConstructor();bindContractTemplateConstructor();
bindProgramPaymentConstantPalette();let automaticClicks=0;document.querySelector('#automaticToken').onclick=()=>{automaticClicks++};
document.querySelector('#paymentEditor').addEventListener('keydown',event=>handleCommunicationTemplateEditorHistoryKeydown(event,event.target));
const emailOptions={tokenSelector:'[data-action="insert-document-email-token"]',editorSelector:'[data-document-email-editor]',singleClick:true};
bindTemplateTokenCursorInsertion(document.querySelector('#email'),emailOptions);bindTemplateTokenCursorInsertion(document.querySelector('#email'),emailOptions);
document.querySelectorAll('#email [contenteditable]').forEach(e=>{e.addEventListener('blur',()=>refreshDocumentEmailTemplateEditor(e));e.addEventListener('keydown',ev=>handleCommunicationTemplateEditorHistoryKeydown(ev,e));});
window.reset=(id,text='abcd',start=2,end=start)=>{const e=document.getElementById(id);renderCommunicationTemplateEditorValue(e,text);communicationTemplateEditorHistories.delete(e);initializeCommunicationTemplateEditorHistory(e);e.focus();const a=getCommunicationTemplateRangeAtOffset(e,start),b=getCommunicationTemplateRangeAtOffset(e,end),s=getSelection();s.setBaseAndExtent(a.startContainer,a.startOffset,b.startContainer,b.startOffset);};
window.read=id=>{const e=document.getElementById(id);return {text:serializeCommunicationTemplateEditor(e),caret:getCommunicationTemplateEditorCaretOffset(e),undo:communicationTemplateEditorHistories.get(e)?.undo.length}};
</script>`;
async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.setContent(html);
    const reset = (id, text = "abcd", start = 2, end = start) => page.evaluate(args => reset(...args), [id, text, start, end]);
    const read = id => page.evaluate(id => read(id), id);
    for (const [id, tokenId, token] of [["students1", "studentsToken", "{ФИО}"], ["employees1", "employeesToken", "{ФИО}"], ["formula", "formulaToken", "{ФИО}"], ["data1", "dataToken", "{ФИО}"], ["contractEditor", "sourceToken", "[Фото]"], ["contractEditor", "docToken", "#Другое#"], ["body", "emailToken", "{ФИО}"], ["paymentEditor", "paymentToken", "[Ставка]"]]) {
      await reset(id);
      await page.locator('#' + tokenId).dblclick();
      assert.deepEqual(await read(id), { text: `ab${token}cd`, caret: 2 + token.length, undo: 1 }, id);
      await page.keyboard.press('Control+z');
      assert.equal((await read(id)).text, 'abcd', 'Undo ' + id);
      await page.keyboard.press('Control+y');
      assert.equal((await read(id)).text, `ab${token}cd`, 'Redo ' + id);
    }
    assert.equal((await read('students0')).text, 'abcd', 'Correct message, not the first one');
    assert.equal((await read('employees0')).text, 'abcd', 'Audience scope');
    assert.equal((await read('subject')).text, 'abcd', 'Email body, not subject');
    assert.equal(await page.locator('#payment input[name="amount"]').inputValue(), 'ab[Ставка]cd', 'Payment formula hidden input');
    await page.locator('#automaticToken').click();
    assert.equal(await page.evaluate(() => automaticClicks), 1, 'Unrelated automatic-rule palette retains its click handler');
    assert.equal(await page.evaluate(() => selectedField), '', 'Double click does not select another formula');
    await reset('students1', 'abc\n\n', 5);
    await page.locator('#studentsSearch').fill('test');
    await page.locator('#studentsToken').dblclick();
    assert.equal((await read('students1')).text, 'abc\n\n{ФИО}', 'Offsets survive blur/re-render/search');
    await reset('formula', 'abcdef', 1, 4);
    await page.locator('#formulaToken').dblclick();
    assert.equal((await read('formula')).text, 'a{ФИО}ef', 'Replace selection');
    await reset('formula', 'x{Email}y', 1);
    await page.locator('#formulaToken').dblclick();
    assert.equal((await read('formula')).text, 'x{ФИО}{Email}y', 'Adjacent atomic tokens');
    const before = await read('formula');
    await page.locator('#formula .communication-template-block').first().dblclick();
    assert.equal((await read('formula')).text, before.text, 'Double click within text does not duplicate it');
    await reset('contractEditor');
    await page.locator('#selfToken').dblclick();
    assert.equal((await read('contractEditor')).text, 'abcd');
    assert.equal(await page.evaluate(() => rejected), 1, 'Self-reference guard');
    await page.locator('#docToken').click();
    await page.waitForTimeout(550);
    assert.equal(await page.evaluate(() => selectedField), 'other', 'Single click still selects a document field');
    await reset('formula');
    await page.locator('#formulaToken').focus();
    await page.keyboard.press('Enter');
    assert.equal((await read('formula')).text, 'ab{ФИО}cd', 'Keyboard insertion');
    await page.locator('#formula').evaluate(e => e.contentEditable = 'false');
    await page.locator('#formulaToken').dblclick();
    assert.equal((await read('formula')).text, 'ab{ФИО}cd', 'Readonly target unchanged');
    await reset('students1');
    await page.evaluate(() => {
      const token=document.querySelector('#studentsToken'),editor=document.querySelector('#students1'),data=new DataTransfer();
      token.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
      editor.blur();
      editor.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:0,clientY:0}));
      token.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));
    });
    assert.equal((await read('students1')).text, 'abcd{ФИО}', 'Existing palette drag still works');
    await reset('students1');
    await page.locator('#studentsToken').dragTo(page.locator('#students1'), { targetPosition: { x: 40, y: 10 } });
    const dragged = (await read('students1')).text;
    assert.equal(dragged.split('{ФИО}').length, 2, 'Native mouse drag inserts exactly one block');
    assert.equal(dragged.replace('{ФИО}', ''), 'abcd', 'Native mouse drag preserves text');
    assert.deepEqual(errors, []);
    console.log('Formula double click: eight palette routes, exact cursor/selection, blur/re-render, active message/audience/dialog, single-copy/undo/redo, self-reference, keyboard, readonly, payment isolation and existing drag: OK');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
