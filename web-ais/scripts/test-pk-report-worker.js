'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../pk-reporting.js'),'utf8');
const templates=require('../pk-report-templates'),X=require('../vendor/sheetjs/xlsx.full.min.js');
function worker(allowTemplates){
  const messages=[],imports=[];
  class WorkerGlobalScope {static [Symbol.hasInstance](){return true;}}
  const context=vm.createContext({WorkerGlobalScope,URL,Date,Intl,DOMException,setTimeout,TextDecoder,TextEncoder,structuredClone,ArrayBuffer,Uint8Array,
    location:{href:'https://example.invalid/lms/pk-reporting.js?v=test',search:'?v=test'},
    postMessage:message=>messages.push(structuredClone(message)),
    importScripts:url=>{imports.push(url);if(!allowTemplates)throw Error('Excel template unavailable');if(url.includes('pk-report-templates'))context.AIS_PK_TEMPLATES=templates;else context.XLSX=X;}
  });
  vm.runInContext(source,context);return {context,messages,imports};
}
(async()=>{
  const q=worker(false);
  const options={kind:'quarterly',year:2026,quarter:2,now:new Date('2026-10-08T09:00:00Z'),students:[{id:'1',name:'Тест',educationType:'КПК',gender:'Ж',birthDate:'1990-01-01',diplomaBlankNo:'1',expulsionDate:'2026-04-10'}],programs:[]};
  await q.context.onmessage({data:{action:'calculate',options}});
  assert.equal(q.imports.length,0);const result=q.messages.at(-1);assert.equal(result.type,'result');
  assert.equal(result.result.values['1-ПК квартальный'].C8,1);assert.equal(result.result.values['1-ПК квартальный'].D8,1);
  assert.equal(result.result.formSections.length,0);
  const e=worker(true);await e.context.onmessage({data:{action:'export',report:result.result}});
  assert.equal(e.imports.length,2);const download=e.messages.at(-1);assert.equal(download.type,'result');assert.ok(download.result.byteLength>1000);
  const book=X.read(download.result,{type:'array'});assert.equal(book.Sheets['1-ПК квартальный'].C8.v,1);assert.match(book.Sheets['1-ПК квартальный'].A2.v,/30.06.2026/);
  const failed=worker(false);await failed.context.onmessage({data:{action:'export',report:result.result}});assert.equal(failed.messages.at(-1).type,'error');
  const annual=worker(true);await annual.context.onmessage({data:{action:'calculate',options:{...options,kind:'annual',year:2025,students:[]}}});
  assert.equal(annual.imports.length,1);assert.equal(annual.messages.at(-1).type,'result');assert.equal(annual.messages.at(-1).result.formSections.length,templates.sections.length);
  console.log('PASS: real worker bootstrap calculates quarter with unavailable Excel templates; separate Excel download; annual metadata; import error response.');
})().catch(error=>{console.error(error);process.exitCode=1;});
