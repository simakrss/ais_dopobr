"use strict";
// Isolated synthetic messages only; no application settings or database writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}$`, "m"));
  assert.ok(match, name);
  return match[0];
}
const exemptions = source.match(/  const SHIFT_DRAG_EXEMPT_SELECTOR = \[[\s\S]*?\].join\(", "\);/)[0];
const functions = [
  "isShiftDragExemptElement", "getShiftRequiredDragElement", "annotateShiftRequiredDraggableElements", "bindShiftDragRequirement",
  "renderCommunicationTemplateAudienceForm", "renderCommunicationTemplateEditorContent", "renderCommunicationTemplateFormulaEditorContent",
  "renderCommunicationTemplateLinks", "renderCommunicationTemplateSyntax", "renderCommunicationTemplateFieldToken",
  "bindCommunicationTemplateTokenDragLifecycle", "bindCommunicationTemplateDragAndDrop", "bindCommunicationTemplateFieldDialogFields",
  "createCommunicationTemplateBlock", "getCommunicationTemplateDropRange", "getCommunicationTemplateNodeStartOffset",
  "syncCommunicationTemplateEditor", "refreshCommunicationTemplateEditor", "serializeCommunicationTemplateEditor",
  "syncCommunicationTemplateFormulaEditor", "refreshCommunicationTemplateFormulaEditor",
  "getCommunicationTemplateEditorCaretOffset", "setCommunicationTemplateEditorCaretOffset",
  "initializeCommunicationTemplateEditorHistory", "recordCommunicationTemplateEditorChange", "commitCommunicationTemplateEditorChange",
  "syncCommunicationTemplateEditorHistoryCurrent", "syncCommunicationTemplateEditorByType", "renderCommunicationTemplateEditorValue",
  "restoreCommunicationTemplateEditorHistoryValue", "undoCommunicationTemplateEditor", "redoCommunicationTemplateEditor",
  "handleCommunicationTemplateEditorHistoryKeydown"
].map(extract).join("\n");

class Target {
  constructor() { this.events = new Map(); }
  addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn); }
  removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
  fire(type, properties = {}) { for (const fn of [...(this.events.get(type) || [])]) fn({ type, ...properties }); }
}
function unitTests() {
  for (const selector of ["form[data-action='save-communication-templates'] [data-template-token]", ".communication-template-field-dialog [data-template-token]", "[data-card-message-formula] [data-template-token]"]) {
    assert.ok(exemptions.includes(selector), selector);
  }
  const document = new Target(), form = new Target(), context = { document };
  const token = { classList: { remove() {} }, closest: () => token };
  form.contains = item => item === token;
  vm.createContext(context);
  vm.runInContext(extract("bindCommunicationTemplateTokenDragLifecycle"), context);
  const drag = context.bindCommunicationTemplateTokenDragLifecycle(form);
  form.fire("pointerdown", { button: 2, target: token });
  assert.equal(drag.isActive(), false, "Context menu must not start drag");
  form.fire("pointerdown", { button: 0, target: token });
  assert.equal(drag.isActive(), true, "Protect before focus/blur");
  document.fire("pointerup");
  assert.equal(drag.isActive(), false, "Click without dragging cleans up");
  form.fire("pointerdown", { button: 0, target: token });
  document.fire("pointercancel");
  assert.equal(drag.isActive(), false);
  form.fire("pointerdown", { button: 0, target: token });
  form.fire("dragstart", { target: token });
  document.fire("pointercancel");
  assert.equal(drag.isActive(), true, "Native pointercancel after dragstart must preserve source");
  document.fire("dragend");
  assert.equal(drag.isActive(), false);
  form.fire("dragstart", { target: token });
  drag.finish();
  assert.equal(drag.isActive(), false, "Drop cleans up before re-render removes source");
  for (const name of ["pointerup", "pointercancel", "dragend"]) assert.equal(document.events.get(name)?.size, 0, `No ${name} listener leak`);
  for (const name of ["bindCommunicationTemplateDragAndDrop", "bindCommunicationTemplateFieldDialogFields"]) {
    const code = extract(name);
    assert.match(code, /bindCommunicationTemplateTokenDragLifecycle\(/);
    assert.match(code, /if \(!drag\.isActive\(\)\) refreshCommunicationTemplate/);
    assert.match(code, /drag\.finish\(\)/);
    assert.match(code, /commitCommunicationTemplateEditorChange\(/);
    assert.match(code, /setCommunicationTemplateEditorCaretOffset\(editor, caretOffset\)/);
  }
  console.log("Message field drag lifecycle, immediate drag exemptions, cleanup and integration checks: OK");
}

function serveFixture() {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Перетаскивание полей сообщений</title>
  <link rel="stylesheet" href="/styles.css"><style>
  body{padding:20px}.fixture{max-width:1100px;margin:auto}.communication-template-form{height:auto;min-height:0;display:grid;grid-template-columns:230px 1fr;gap:16px}.communication-template-editor{min-height:80px;height:80px}.communication-template-list{height:auto}.communication-template-field-list{max-height:160px}.communication-template-actions{display:none}.communication-template-audience-panel{margin:16px 0}#formula{padding:12px;background:white}#result{white-space:pre-wrap}
  </style><main class="fixture"><h1>Перетаскивание полей сообщений</h1><p>Тестовые данные — изменения не сохраняются в систему. Перетащите поле без Shift.</p><button type="button" id="run" class="primary-button">Проверить перенос и отмену</button><output id="result" role="status"></output><div id="forms"></div><section id="formula"><form data-card-message-formula><h2>Формула сообщения из карточки</h2><div data-formula-editor contenteditable="true" class="communication-template-editor" role="textbox" aria-label="Формула поля"></div><input type="hidden" name="formula"><div id="formula-fields"></div></form></section></main><script>
  const definitions=[{name:'ФИО'},{name:'Email'}];
  const getCommunicationTemplateFieldDefinitions=()=>definitions;
  const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const escapeAttr=escapeHtml,openTemplateEditorLink=()=>false,showSystemHelpTooltip=()=>{},showCommunicationTemplateFieldMenu=()=>{};
  const communicationTemplateEditorHistories=new WeakMap();let shiftDragRequirementBound=false;const DRAG_TOOLTIP_DELAY_MS=1000;
  ${exemptions}
  ${functions}
  document.getElementById('forms').innerHTML=['students','employees'].map(audience=>'<h2>'+(audience==='students'?'Слушатель':'Сотрудник')+'</h2>'+renderCommunicationTemplateAudienceForm({audience,messages:[{},{}],templates:['А {ФИО} Б {Email} В','Второе сообщение.'],descriptions:['Основное','Дополнительное'],templateFields:definitions,active:true})).join('');
  document.querySelector('[data-formula-editor]').innerHTML=renderCommunicationTemplateFormulaEditorContent('А {ФИО} Б {Email} В');
  document.getElementById('formula-fields').innerHTML=definitions.map(field=>renderCommunicationTemplateFieldToken(field)).join('');
  bindCommunicationTemplateDragAndDrop();bindCommunicationTemplateFieldDialogFields(document.getElementById('formula'));bindShiftDragRequirement();
  document.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>event.preventDefault()));
  document.getElementById('run').addEventListener('click',async()=>{
    const report=document.getElementById('result'),passed=[];
    const check=(condition,label)=>{if(!condition)throw Error(label);passed.push(label);};
    const initial='А {ФИО} Б {Email} В';
    const reset=(editor,value)=>{renderCommunicationTemplateEditorValue(editor,value);communicationTemplateEditorHistories.delete(editor);initializeCommunicationTemplateEditorHistory(editor);};
    const point=(editor,atStart)=>{const text=atStart?editor.firstChild:editor.lastChild,r=document.createRange();r.setStart(text,atStart?0:text.length);r.collapse(true);const b=r.getBoundingClientRect();return{x:b.x+(atStart?0.1:-0.1),y:b.y+b.height/2};};
    const perform=async(source,editor,{atStart=false,cancel=false,blur=false}={})=>{
      const sourceEditor=source.closest('[data-template-editor],[data-formula-editor]'),data=new DataTransfer();
      source.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));
      if(blur&&sourceEditor) sourceEditor.dispatchEvent(new FocusEvent('blur'));
      check(source.isConnected,'Source remains attached before dragstart');
      const started=source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));
      check(started,'Drag allowed without Shift');
      source.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));
      if(sourceEditor){sourceEditor.dispatchEvent(new InputEvent('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,180));check(source.isConnected,'Highlight timer preserves dragged source');}
      const p=point(editor,atStart);
      if(!cancel){editor.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientX:p.x,clientY:p.y}));editor.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:p.x,clientY:p.y}));}
      source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));
    };
    try{
      for(const audience of ['students','employees']){
        const form=document.querySelector('[data-template-audience="'+audience+'"]'),[editor,other]=form.querySelectorAll('[data-template-editor]');
        reset(editor,initial);reset(other,'Второе сообщение.');
        const palette=form.querySelector('button[data-template-token="{ФИО}"]');
        check(palette.draggable,audience+': palette draggable without Shift');
        await perform(palette,editor);
        check(serializeCommunicationTemplateEditor(editor)===initial+'{ФИО}',audience+': palette copies field');
        check(palette.isConnected,audience+': palette unchanged');
        check(form.elements.template0.value===initial+'{ФИО}',audience+': hidden value synced');
        undoCommunicationTemplateEditor(editor);check(serializeCommunicationTemplateEditor(editor)===initial,audience+': undo insertion');
        redoCommunicationTemplateEditor(editor);check(serializeCommunicationTemplateEditor(editor)===initial+'{ФИО}',audience+': redo insertion');
        reset(editor,initial);
        await perform(editor.querySelector('[data-template-token="{ФИО}"]'),editor,{blur:true});
        check(serializeCommunicationTemplateEditor(editor)==='А  Б {Email} В{ФИО}',audience+': move forward, no duplicate');
        undoCommunicationTemplateEditor(editor);check(serializeCommunicationTemplateEditor(editor)===initial,audience+': undo move');
        await perform(editor.querySelector('[data-template-token="{Email}"]'),editor,{atStart:true});
        check(serializeCommunicationTemplateEditor(editor)==='{Email}А {ФИО} Б  В',audience+': move backward');
        reset(editor,initial);
        await perform(editor.querySelector('[data-template-token="{ФИО}"]'),other,{blur:true});
        check(serializeCommunicationTemplateEditor(editor)==='А  Б {Email} В'&&serializeCommunicationTemplateEditor(other)==='Второе сообщение.{ФИО}',audience+': move between messages');
        check(form.elements.template0.value==='А  Б {Email} В'&&form.elements.template1.value==='Второе сообщение.{ФИО}',audience+': both hidden values synced');
        reset(editor,initial);
        await perform(editor.querySelector('[data-template-token]'),editor,{cancel:true});
        check(serializeCommunicationTemplateEditor(editor)===initial,audience+': cancelled drag leaves text unchanged');
        check(!form.querySelector('.is-dragging,.is-drop-target'),audience+': highlights cleaned up');
      }
      const formula=document.querySelector('[data-formula-editor]');reset(formula,initial);
      await perform(formula.querySelector('[data-template-token="{ФИО}"]'),formula,{blur:true});
      check(serializeCommunicationTemplateEditor(formula)==='А  Б {Email} В{ФИО}','Card formula move');
      check(formula.closest('form').elements.formula.value==='А  Б {Email} В{ФИО}','Card formula hidden value');
      undoCommunicationTemplateEditor(formula);check(serializeCommunicationTemplateEditor(formula)===initial,'Card formula undo');
      await perform(document.querySelector('#formula-fields [data-template-token="{Email}"]'),formula);
      check(serializeCommunicationTemplateEditor(formula)===initial+'{Email}','Card formula palette copy');
      report.textContent='PASS: '+passed.length+' browser assertions';report.dataset.result='pass';
    }catch(error){report.textContent='FAIL: '+error.message+' (passed '+passed.length+')';report.dataset.result='fail';console.error(error);}
  });
  </script></html>`;
  require("node:http").createServer((req,res)=>{
    if(req.url==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(html);}
    else if(req.url==="/styles.css"){res.writeHead(200,{"Content-Type":"text/css"});res.end(styles);}
    else {res.writeHead(404);res.end();}
  }).listen(0,"127.0.0.1",function(){console.log(`Message field fixture: http://127.0.0.1:${this.address().port}/`);});
}
unitTests();
if (process.argv.includes("--serve")) serveFixture();
