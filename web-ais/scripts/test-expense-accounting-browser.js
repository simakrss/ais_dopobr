"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."), source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const extract = name => { const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m")); assert.ok(match, name); return match[0]; };
const bindingStart = source.indexOf('    document.querySelectorAll("[data-general-expense-number-filter-option]")');
const bindingEnd = source.indexOf('    document.querySelector("[data-action=\'clear-student-imported-view\']")', bindingStart);
assert.ok(bindingStart > 0 && bindingEnd > bindingStart);
const functions = ["isGeneralExpensePersonalCard", "isChecked", "parseTableSortDate", "getGeneralExpenseNumberGroup", "matchesGeneralExpenseNumberFilter", "formatGeneralExpenseMultiFilterLabel", "renderGeneralExpenseNumberFilter", "getGeneralExpenseAccountingRows", "renderGeneralExpenseAccountingDashboardTile", "openGeneralExpenseAccountingDialog", "renderStudentLayoutRemarks"].map(extract).join("\n");
const script = `
const rows = [
 {id:'old',counterparty:'Просроченный расход',date:'2026-08-01',bkExpenseNo:'101',amount:100},
 {id:'new',counterparty:'Свежий расход',date:'2026-11-13',bkExpenseNo:'102',amount:200},
 {id:'personal',counterparty:'Личный расход',date:'2026-08-01',bkExpenseNo:'личная карта',amount:300},
 {id:'empty',counterparty:'Без номера',date:'2026-08-01',bkExpenseNo:'',amount:400}
];
const state={generalExpenseNumberFilter:[],tablePages:{},modal:null}, configs={generalExpenses:{collection:'generalExpenses'}};
const getRowsForConfig=()=>rows, todayIso=()=> '2026-11-13',canAccessView=()=>true,isSettingsDraftSessionActive=()=>false;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),escapeAttr=escapeHtml;
const money=value=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value);
const withCardLoadingIndicator=async(c,id,op)=>op(), acquireRecordLockForCard=async(c,id)=>{window.openedCard={config:c,id};return {ok:true};},getRecordLockModalState=()=>({readOnly:false});
${functions}
const record={studentLayoutRemarks:{comment:'Исправьте фамилию.\\n<img src=x onerror="window.injected=true">',name:'Макет документа.pdf',createdAt:'2026-11-13T09:00:00Z'}};
function render(){
 if(state.modal){document.getElementById('app').innerHTML='<p data-open-card>Карточка расхода открыта</p>';return;}
 document.getElementById('app').innerHTML=renderGeneralExpenseNumberFilter()+'<ul data-rows>'+rows.filter(row=>matchesGeneralExpenseNumberFilter(row,state.generalExpenseNumberFilter)).map(row=>'<li data-row="'+row.id+'">'+escapeHtml(row.counterparty)+'</li>').join('')+'</ul><div class="dashboard-document-tasks with-enrollment-review">'+renderGeneralExpenseAccountingDashboardTile()+'</div>'+renderStudentLayoutRemarks(record);
 ${source.slice(bindingStart, bindingEnd)}
 document.querySelector('[data-action="open-general-expense-accounting"]').onclick=openGeneralExpenseAccountingDialog;
}
render();`;
const server = http.createServer((req,res)=>{if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(root,'styles.css')));return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main id="app" style="padding:20px"></main><script>'+script+'</script>');});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 try {const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.locator('[data-row]').count(),4);assert.equal(await page.evaluate(()=>window.injected),undefined);
  await page.locator('[data-general-expense-number-filter] summary').click();
  await page.locator('[data-general-expense-number-filter-option][value="personal"]').check();assert.equal(await page.locator('[data-row]').count(),1);assert.ok(await page.locator('[data-row="personal"]').isVisible());
  await page.locator('[data-action="clear-general-expense-number-filter"]').click();
  await page.locator('[data-general-expense-number-filter] summary').click();await page.locator('[data-general-expense-number-filter-option][value="business"]').check();
  assert.equal(await page.locator('[data-row]').count(),2);await page.locator('[data-general-expense-number-filter] summary').click();
  await page.locator('[data-action="open-general-expense-accounting"]').click();
  assert.equal(await page.locator('dialog tbody tr').count(),2);assert.equal(await page.locator('dialog tbody tr.is-overdue').count(),1);
  const dir=path.join(root,'.runtime/student-portal-test');fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,'expense-accounting-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(dir,'expense-accounting-mobile.png'),fullPage:true});
  await page.locator('[data-expense-accounting-card="old"]').click();await page.locator('[data-open-card]').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.openedCard),{config:'generalExpenses',id:'old'});assert.equal(await page.locator('dialog[open]').count(),0);assert.deepEqual(errors,[]);
  console.log('PASS: personal/business filter controls and reset, overdue accounting dialog, mobile table scroll, ordinary locked-card opening and escaped remarks in staff card');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
