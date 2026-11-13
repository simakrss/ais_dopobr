"use strict";
// Synthetic card only: no records or accounting data are saved.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/g, "\n");
const extract = name => {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
};
const functions = ["renderContractAccountingToggle", "renderField", "isChecked", "getStoredCheckboxValue"].map(extract).join("\n");
const field = {key: "accountingRecorded", label: "Договор передан в бухгалтерию", type: "checkbox"};
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const context = vm.createContext({state: {modal: {config: "contracts"}}, escapeAttr: escape, escapeHtml: escape});
vm.runInContext(functions, context);
for (const [value, checked] of [["",false],[null,false],["Нет",false],[false,false],["Да",true],["+",true],[true,true],[1,true]]) {
  const html = context.renderField(field, {accountingRecorded: value});
  assert.equal(/ checked[ >]/.test(html), checked);
  assert.match(html, /data-field-key="accountingRecorded"/);
  assert.match(html, /name="accountingRecorded" type="checkbox" role="switch" value="Да"/);
  assert.match(html, /student-personal-case-toggle-card/);
  assert.equal(context.getStoredCheckboxValue("contracts",field.key,checked),checked ? "Да" : "");
}
assert.equal(context.getStoredCheckboxValue("students","documentsStatus",true),"+");
assert.doesNotMatch(context.renderField({key:"notificationEmail",label:"Email",type:"checkbox"},{}),/contract-accounting-toggle/);
assert.match(context.renderContractAccountingToggle({...field,label:'Тест <img src=x onerror="bad">'},""),/&lt;img/);

async function browserTests() {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">
  <style>body{padding:16px}main{max-width:850px;margin:auto}</style><main><form id="recordForm" data-config="contracts"><div class="form-grid contract-form-grid"><label><span>Номер договора</span><input name="contractNo" value="ТЕСТ"></label>${context.renderField(field,{})}</div></form></main><script>
  ${extract("getStoredCheckboxValue")}
  let changes=0;const form=document.querySelector('form');form.addEventListener('change',()=>changes++);
  const saved=()=>getStoredCheckboxValue('contracts','accountingRecorded',form.elements.accountingRecorded.checked);
  </script></html>`;
  const server=http.createServer((req,res)=>{const css=req.url==='/styles.css';res.setHeader('Content-Type',css?'text/css':'text/html; charset=utf-8');res.end(css?fs.readFileSync(path.join(root,'styles.css')):html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
    for (const width of [1100,375]) {
      const page=await browser.newPage({viewport:{width,height:700}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const toggle=page.getByRole('switch',{name:field.label}),card=page.locator('.student-personal-case-toggle-card');
      assert.equal(await toggle.isChecked(),false);assert.equal(await page.locator('.is-pending').isVisible(),true);assert.equal(await page.locator('.is-complete').isVisible(),false);
      const off=await card.evaluate(e=>({color:getComputedStyle(e).backgroundColor,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width}));
      assert.equal(off.color,'rgb(255, 247, 204)');assert.ok(off.height>=48);assert.ok(off.width<=width-32);
      await card.click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.student-personal-case-toggle-card')).backgroundColor==='rgb(220, 252, 231)');assert.equal(await toggle.isChecked(),true);assert.equal(await page.evaluate(()=>saved()),'Да');
      assert.equal(await card.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(220, 252, 231)');assert.equal(await page.locator('.is-complete').isVisible(),true);
      await toggle.focus();await page.keyboard.press('Space');assert.equal(await toggle.isChecked(),false);assert.equal(await page.evaluate(()=>saved()),'');assert.equal(await page.evaluate(()=>changes),2);
      assert.notEqual(await card.evaluate(e=>getComputedStyle(e).outlineStyle),'none','Keyboard focus is visible');
      await toggle.evaluate(e=>e.disabled=true);await card.click({force:true});assert.equal(await toggle.isChecked(),false);assert.equal(await page.evaluate(()=>changes),2,'Read-only card cannot toggle');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');assert.deepEqual(errors,[]);await page.close();
    }
  } finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  console.log('PASS: accounting switch, stored values, yellow/green states, full-row layout, keyboard/focus, readonly and desktop/mobile');
}
browserTests().catch(error=>{console.error(error);process.exitCode=1;});
