'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const block=source.slice(source.indexOf('  const pkReportCurrentYear'),source.indexOf('  function statisticsDateParts'));
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-08T09:00:00Z']));}static now(){return new Date('2026-10-08T09:00:00Z').getTime();}}
const workers=[];class WorkerStub{constructor(url){this.url=url;workers.push(this);}postMessage(data){this.request=data;}terminate(){this.terminated=true;}}
const host={innerHTML:''},context=vm.createContext({Date:FixedDate,Intl,URL,Worker:WorkerStub,AbortController,DOMException,setInterval,clearInterval,document:{querySelector:()=>host},window:{},state:{view:'reporting'},render(){},escapeHtml:v=>String(v??''),escapeAttr:v=>String(v??''),formatDate:v=>v,APP_BASE_URL:new URL('https://example.invalid/lms/'),APPLICATION_RELEASE:{version:'test'}});
vm.runInContext(block+'\nglobalThis.api={pkReportUi,pkReportAutomaticQuarter,pkReportManualKey,renderPkReporting,startPkReportOperation,finishPkReportOperation,runPkReportWorker,pkReportProgressMarkup};',context);
(async()=>{
  const a=context.api,u=a.pkReportUi;u.kind='quarterly';u.year=2026;
  assert.equal(a.pkReportAutomaticQuarter(2026),3);assert.equal(a.pkReportAutomaticQuarter(2025),4);
  assert.equal(a.pkReportAutomaticQuarter(2026,new Date('2026-03-31T20:59:59Z')),0);
  assert.equal(a.pkReportAutomaticQuarter(2026,new Date('2026-03-31T21:00:00Z')),1);
  assert.match(a.renderPkReporting(),/Автоматически — III квартал/);
  assert.match(a.renderPkReporting(),/<option value="4"\s+disabled>/);
  assert.equal(a.pkReportManualKey(),'quarterly:2026:3');u.quarter='2';assert.equal(a.pkReportManualKey(),'quarterly:2026:2');
  a.startPkReportOperation('Подготовка Excel');
  assert.match(a.pkReportProgressMarkup(),/pk-report-spinner/);assert.match(a.renderPkReporting(),/aria-busy="true"/);
  const work=a.runPkReportWorker({action:'export',report:{period:{quarters:2}}}),w=workers.at(-1);
  assert.equal(w.request.report.period.quarters,2);
  w.onmessage({data:{type:'progress',progress:{stage:'Заполнение листов Excel',completed:2,total:45}}});
  assert.match(host.innerHTML,/2 из 45/);
  w.onmessage({data:{type:'result',result:'test'}});assert.equal(await work,'test');assert.equal(w.terminated,true);
  a.finishPkReportOperation();assert.equal(u.loading,false);assert.equal(u.timer,null);
  a.startPkReportOperation('Расчёт');const cancelled=a.runPkReportWorker({action:'calculate'}),cw=workers.at(-1);u.controller.abort();
  await assert.rejects(cancelled,{name:'AbortError'});assert.equal(cw.terminated,true);a.finishPkReportOperation();
  a.startPkReportOperation('Excel');const failed=a.runPkReportWorker({action:'export'}),fw=workers.at(-1);fw.onmessage({data:{type:'error',message:'Test error'}});
  await assert.rejects(failed,/Test error/);assert.equal(fw.terminated,true);a.finishPkReportOperation();
  assert.match(block,/form\.elements\.quarter\?\.addEventListener\("change",.*ui\.result = null/);
  assert.match(source,/event\.detail\.busy \|\|= Boolean\([^;]*pkReportUi\.loading/);
  console.log('PASS: automatic/manual quarter, period-isolated drafts, visible progress, worker completion/error/cancel and timer cleanup.');
})().catch(e=>{context.api.finishPkReportOperation();console.error(e.stack);process.exitCode=1;});
