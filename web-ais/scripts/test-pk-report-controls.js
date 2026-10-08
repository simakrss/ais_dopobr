'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const block=source.slice(source.indexOf('  const pkReportCurrentYear'),source.indexOf('  function statisticsDateParts'));
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-08T09:00:00Z']));}static now(){return new Date('2026-10-08T09:00:00Z').getTime();}}
const workers=[];class WorkerStub{constructor(url){this.url=url;workers.push(this);}postMessage(data){this.request=data;}terminate(){this.terminated=true;}}
const timers=new Map();let timerId=0;
const handlers={},form={elements:Object.fromEntries(['kind','year','quarter'].map(k=>[k,{addEventListener(){}}])),reportValidity:()=>true,addEventListener:(type,fn)=>{handlers[type]=fn;}};
const download={addEventListener:(type,fn)=>{handlers.download=fn;}};
const host={innerHTML:''},context=vm.createContext({Date:FixedDate,Intl,URL,Worker:WorkerStub,AbortController,DOMException,setInterval,clearInterval,
  setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  document:{querySelector:s=>s==='[data-pk-report-form]'?form:s==='[data-pk-report-progress]'?host:s==='[data-pk-download]'?download:null,querySelectorAll:()=>[],createElement(){throw Error('No script loading should block displayed results');}},window:{},
  state:{view:'reporting',data:{meta:{organization:'Тестовый центр'},collections:{students:[],programs:[]}}},DEFAULT_REPRESENTATIVE_NAME:'Тестовый Руководитель',confirm:()=>true,
  render(){},escapeHtml:v=>String(v??''),escapeAttr:v=>String(v??''),formatDate:v=>v,APP_BASE_URL:new URL('https://example.invalid/lms/'),APPLICATION_RELEASE:{version:'test'}});
vm.runInContext(block+'\nglobalThis.api={pkReportUi,pkReportAutomaticQuarter,pkReportManualKey,renderPkReporting,bindPkReporting,pkReportDataSnapshot,startPkReportOperation,finishPkReportOperation,runPkReportWorker,pkReportProgressMarkup};',context);
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
  assert.equal(timers.size,0);
  a.startPkReportOperation('Excel');const silent=a.runPkReportWorker({action:'export'}),sw=workers.at(-1);
  [...timers.values()].find(t=>t.ms===60000).fn();await assert.rejects(silent,/Не удалось дождаться/);
  assert.equal(sw.terminated,true);assert.equal(timers.size,0);
  sw.onmessage({data:{type:'progress',progress:{stage:'Late reply'}}});assert.doesNotMatch(host.innerHTML,/Late reply/);a.finishPkReportOperation();
  a.startPkReportOperation('Excel');const malformed=a.runPkReportWorker({action:'export'});workers.at(-1).onmessageerror();
  await assert.rejects(malformed,/Не удалось получить/);a.finishPkReportOperation();

  // Reproduce the website symptom: the worker is finished, but no main-thread
  // template script ever loads. Results must appear without that script at all.
  context.state.data.collections.students=[{id:'test',educationType:'КПК',photo:'not a report input',documents:[{large:true}]}];
  const snapshot=a.pkReportDataSnapshot();assert.equal(snapshot.students[0].id,'test');assert.ok(!('photo' in snapshot.students[0]));assert.ok(!('documents' in snapshot.students[0]));
  a.bindPkReporting();const submitted=handlers.submit({preventDefault(){}}),qw=workers.at(-1);
  const report={period:{kind:'quarterly',quarters:2,year:2026,label:'1–2 кварталы 2026',start:'2026-01-01',end:'2026-06-30'},values:{'1-ПК квартальный':{C8:4,D8:3,E8:2,F8:1}},students:6,issues:[],generatedAt:'2026-10-08T09:00:00Z'};
  qw.onmessage({data:{type:'progress',progress:{stage:'Подготовка результатов',completed:1,total:1}}});
  qw.onmessage({data:{type:'result',result:report}});await submitted;
  assert.equal(u.loading,false);assert.equal(u.timer,null);assert.equal(timers.size,0);
  assert.match(a.renderPkReporting(),/Скачать Excel/);assert.match(a.renderPkReporting(),/<td>4<\/td><td>3<\/td><td>2<\/td><td>1<\/td>/);
  assert.match(a.renderPkReporting(),/aria-busy="false"/);assert.doesNotMatch(a.renderPkReporting(),/pk-report-spinner/);
  assert.match(report.values['1-ПК квартальный'].A1,/Тестовый центр/);
  a.bindPkReporting();const exporting=handlers.download({});workers.at(-1).onmessage({data:{type:'error',message:'Excel unavailable'}});await exporting;
  assert.equal(u.result,report);assert.equal(u.loading,false);assert.match(a.renderPkReporting(),/Excel unavailable/);assert.match(a.renderPkReporting(),/Скачать Excel/);
  const cancelling=handlers.download({});u.controller.abort();await cancelling;assert.equal(u.result,report);assert.equal(u.loading,false);
  // Annual UI receives its field descriptions with the calculation result.
  u.kind='annual';u.result={...report,values:{'Раздел':{A1:7}},formSections:[{name:'Раздел',cells:[{address:'A1',note:'Formula',label:'Показатель'}]}]};
  assert.match(a.renderPkReporting(),/Показатель/);assert.match(a.renderPkReporting(),/<td>7<\/td>/);
  assert.match(block,/form\.elements\.quarter\?\.addEventListener\("change",.*ui\.result = null/);
  assert.match(source,/event\.detail\.busy \|\|= Boolean\([^;]*pkReportUi\.loading/);
  console.log('PASS: quarter controls; screen results without template loading; Excel failure/cancel keeps results; worker timeout, decode error, stale replies and timer cleanup; annual field metadata.');
})().catch(e=>{context.api.finishPkReportOperation();console.error(e.stack);process.exitCode=1;});
