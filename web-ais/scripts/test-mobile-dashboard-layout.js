"use strict";
// Real dashboard, toolbar and pagination markup; synthetic records, no production API.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\r\n/g,'\n');
const extract=name=>{const m=source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`,'m'));assert.ok(m,name);return m[0]};
const escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const students=[{id:'one',name:'Тестовая Марина Александровна',program:'Инструктор по лепке (300 ч)',status:'Учится',endDate:'2026-11-26',balance:'9 500 ₽'},
{id:'two',name:'Тестовая Юлия Николаевна',program:'Длинноенеразрывноеназваниеобразовательнойпрограммы (600 ч)',status:'Учится',endDate:'2026-12-07',balance:'123 456,78 ₽'}];
const config={collection:'generalExpenses',fields:[]};
const c=vm.createContext({state:{data:{collections:{students,generalExpenses:[]},dictionaries:{}},tableSettings:{},tablePages:{},dashboardFinanceExpanded:{}},
configs:{generalExpenses:config},STUDENT_APPLICATIONS_IMPORT_TABLE_CONFIG_ID:'studentApplicationsImport',TABLE_PAGE_SIZE_OPTIONS:[50,100,250],DEFAULT_TABLE_PAGE_SIZE:50,
getAllDirectExpenses:()=>[],sumBy:()=>9500,calculateDashboardStudentProfitSummary:()=>({profit:8265,averageProfitability:87}),buildFinanceSeries:()=>[],
calculateDashboardStudentReceivable:()=>0,countBy:()=>({'На зачисление':1,'Учится':2,'Отчислен':801,'Без выдачи документа':12345}),
getOrderedDashboardStudentStatuses:()=>['На зачисление','Учится','Отчислен','Без выдачи документа'],calculateDaysUntilDate:()=>3,
renderAttestationDashboardTile:()=>'',renderDeferredStartDashboardTile:()=>'',renderEnrollmentReviewDashboardTile:()=>'',renderGeneralExpenseAccountingDashboardTile:()=>'',
getIssuedDocumentRows:()=>[],isIssuedDocumentFrdoExportEligible:()=>false,getIssuedDocumentDeadlineDays:()=>30,todayIso:()=>'',getMoscowCalendarDateKey:()=>'',
renderFinanceChart:()=>'',money:v=>v+' ₽',percent:v=>v+'%',escapeHtml,escapeAttr:escapeHtml,valueForDisplay:(_k,v)=>String(v),
getSelected:()=>['one'],getRowsByIds:()=>[{id:'one'}],renderRegistryGroupControls:()=>''});
vm.runInContext(['renderDashboard','miniTable','renderBulkToolbar','renderTableOptions','getTablePageSize','getTablePagination','renderTablePagination'].map(extract).join('\n'),c);
const topbar=title=>`<header class="topbar"><button class="sidebar-toggle">☰</button><div><h1>${title}</h1></div><div class="top-actions"><span class="source-pill shared-state-pill"><span class="shared-state-dot"></span><span class="shared-state-label">Общая MySQL-база подключена</span></span><button class="icon-button">А</button></div></header>`;
const table=`<div class="table-wrap"><table class="data-table" style="min-width:780px"><thead><tr>${['Выбор','Контрагент','Раздел','Дата','Вид работ','Номер','Сумма','Оплачено','Закрыто'].map(t=>'<th>'+t+'</th>').join('')}</tr></thead><tbody><tr>${['□','Тестовый контрагент','Организации','25.11.2026','Интернет-сервисы','БК 42','9500 ₽','25.11.2026','Нет'].map(t=>'<td>'+t+'</td>').join('')}</tr></tbody></table></div>`;
const expenseMarkup='<section class="panel collection-register">'+c.renderBulkToolbar(config,[{id:'one'}],'generalExpenses')+table+c.renderTablePagination('generalExpenses',145,c.getTablePagination('generalExpenses',145))+'</section>';
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});try{
const page=await browser.newPage();const failures=[];page.on('pageerror',e=>failures.push(e.message));
for(const width of [320,360,390,430,720,1280])for(const enlarged of [false,true])for(const screen of ['dashboard','expenses']){
await page.setViewportSize({width,height:1000});await page.setContent('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><body><main class="main">'+topbar(screen==='dashboard'?'Рабочий стол':'Общие затраты')+'<div class="content">'+(screen==='dashboard'?c.renderDashboard():expenseMarkup)+'</div></main></body></html>');
await page.addStyleTag({path:path.join(root,'styles.css')});if(enlarged)await page.addStyleTag({content:'body {font-size:20px}'});
const result=await page.evaluate(({screen,width})=>{
const errors=[];const check=(e,label)=>{const r=e.getBoundingClientRect();if(r.width&&e.scrollWidth>e.clientWidth+1)errors.push(label+' overflow '+e.scrollWidth+'/'+e.clientWidth);};
if(document.documentElement.scrollWidth>innerWidth+1)errors.push('Page overflow');
for(const el of document.querySelectorAll('.bulk-toolbar,.table-pagination,.table-pagination-navigation,.dashboard-status-list,.bar-row'))check(el,el.className);
for(const row of document.querySelectorAll('.bar-row'))for(const el of row.children){const a=el.getBoundingClientRect(),b=row.getBoundingClientRect();if(a.right>b.right+1||a.left<b.left-1)errors.push('Status child outside');}
if(width<=720){for(const el of document.querySelectorAll('.mobile-card-table,.mobile-card-table td'))check(el,el.className||'Deadline field');
for(const el of document.querySelectorAll('.bulk-toolbar > *,.table-pagination-navigation > *')){const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();if(a.right>b.right+1||a.left<b.left-1)errors.push('Control outside');}}
return errors;},{screen,width});assert.deepEqual(result,[],`${screen} ${width}px enlarged=${enlarged}`);
if(screen==='dashboard'&&width<=720){assert.equal(await page.locator('.mobile-card-table tbody td').count(),10);assert.equal(await page.locator('.mini-table-link-row[tabindex="0"]').count(),2);}
if(screen==='expenses'&&width<=720){const reach=await page.locator('.table-wrap').evaluate(el=>{const max=el.scrollWidth-el.clientWidth;el.scrollLeft=max;return {max,end:el.scrollLeft,last:el.querySelector("td:last-child").getBoundingClientRect().right,right:el.getBoundingClientRect().right};});assert.ok(reach.max>0,'Wide data table retains horizontal access');assert.ok(reach.end>0&&reach.last<=reach.right+1, JSON.stringify({width,enlarged,reach}));}
if(width===360&&!enlarged){const out=path.join(root,'.runtime/mobile-groups-tax');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,screen+'-360.png'),fullPage:true});}
}
assert.deepEqual(failures,[]);console.log('Mobile dashboard/toolbar/pagination: 24 layouts passed (320–1280px, normal/enlarged text); all deadline fields visible, wide table accessible.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
