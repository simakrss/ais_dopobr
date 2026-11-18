"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const pg=require("../program-site-generator");
const settings={changePrices:true,percent:10,step:500,direction:"up"};
assert.equal(pg.calculateBulkPrice(4200,settings),5000);
assert.equal(pg.calculateBulkPrice(5000,{...settings,percent:0}),5000,"Exact multiple must not move up another step");
assert.equal(pg.calculateBulkPrice(4200,{...settings,direction:"down"}),4500);
assert.equal(pg.calculateBulkPrice(4200,{...settings,direction:"nearest"}),4500);
assert.equal(pg.calculateBulkPrice(4750,{...settings,percent:0,direction:"nearest"}),5000);
assert.equal(pg.calculateBulkPrice(4200,{...settings,percent:-10}),4000);
assert.equal(pg.calculateBulkPrice(4200,{...settings,percent:-100}),0);
assert.equal(pg.calculateBulkPrice(0,settings),0);
assert.equal(pg.calculateBulkPrice("19.99",{...settings,direction:"none"}),21.99);
assert.equal(pg.calculateBulkPrice("0.10",{...settings,percent:10,step:"0.01"}),0.11,"No float-induced extra rounding step");
assert.equal(pg.calculateBulkPrice(4200,{...settings,manualPrice:"4876,54"}),4876.54,"Manual price overrides percent and rounding");
assert.equal(pg.calculateBulkPrice(4200,{...settings,manualPrice:0}),0);
assert.equal(pg.calculateBulkPrice(4200,{changePrices:false,percent:"bad",step:0}),4200);
for(const change of [{percent:-100.01},{percent:1000.01},{percent:NaN},{step:0},{step:-500},{step:""},{direction:"bad"},{manualPrice:-1},{manualPrice:1.001},{manualPrice:10000001}]) assert.throws(()=>pg.calculateBulkPrice(4200,{...settings,...change}));
for(const amount of ["",null,-1,Infinity,10000001]) assert.throws(()=>pg.calculateBulkPrice(amount,settings));
assert.throws(()=>pg.calculateBulkPrice(10000000,settings));
assert.equal(pg.bulkStableHash({b:2,a:1}),pg.bulkStableHash({a:1,b:2}));
const program={id:"p1",type:"КПК",name:"Основная программа",hours:72,price:4200,oldPrice:4500,productId:"12",landingCode:"42"};
const sibling={...program,id:"p2",name:"Вариант программы",productId:"13",hours:144};
let landing={id:42,title:"Общий лендинг",status:"publish",slug:"course",url:"https://edu-plus.ru/courses-pk/course/",version:"l1",variants:{x:{productId:13}},offers:[{index:0,productId:12,hours:72,price:4200,hidden:false},{index:1,productId:13,hours:144,price:4200,hidden:true}]};
let products={12:{id:12,title:"Основная программа",price:4200,version:"p12"},13:{id:13,title:"Вариант программы",price:4200,version:"p13"}};
const calls=[];let failLanding=false;
async function call(site,endpoint,body) {
  calls.push({site,endpoint,body});
  if(endpoint==="/resolve-site")return structuredClone(landing);
  if(endpoint.startsWith("/sync-product/"))return structuredClone(products[endpoint.split("/").at(-1)]);
  if(endpoint==="/check-sync")return {ok:true};
  if(endpoint==="/sync-existing") {
    if(site==="shop") {products[body.productId].price=body.model.price;products[body.productId].version+="x";return {id:body.productId};}
    if(failLanding)throw Error("network failure");
    landing.offers.find(item=>item.productId===body.productId).price=body.model.price;landing.version+="x";
    return {id:42,url:landing.url};
  }
  assert.fail(endpoint);
}
(async()=>{
  const before=structuredClone(program);
  const a=await pg.previewBulkSync(program,call,settings),b=await pg.previewBulkSync(sibling,call,settings);
  assert.equal(a.bulk.price,5000);assert.equal(a.bulk.oldPrice,6250);assert.equal(a.bulk.basePrice,4200);
  assert.ok(calls.every(item=>item.endpoint==="/resolve-site"||item.endpoint.startsWith("/sync-product/")),"Preview never writes either site");
  for(const changed of [{...program,price:4300},{...program,name:"Edited"}]) {
    calls.length=0;await assert.rejects(pg.synchronizeBulkItem(changed,call,settings,a.bulk.quote),/изменились/);
    assert.ok(!calls.some(item=>item.endpoint==="/sync-existing"));
  }
  await assert.rejects(pg.synchronizeBulkItem(program,call,{...settings,manualPrice:4999},a.bulk.quote),/изменились/);
  const result=await pg.synchronizeBulkItem(program,call,settings,a.bulk.quote);
  assert.equal(result.price,5000);assert.equal(result.oldPrice,6250);assert.deepEqual(program,before,"Server never mutates the source record");
  await assert.rejects(pg.synchronizeBulkItem(program,call,settings,a.bulk.quote),/изменились/,"Old quote cannot replay after site writes");
  const next=await pg.synchronizeBulkItem(sibling,call,settings,b.bulk.quote);
  assert.equal(next.price,5000,"Sibling landing version change must not block an unchanged offer");
  assert.equal(landing.offers[1].hidden,true,"Bulk update preserves hidden variants");
  const manual=await pg.previewBulkSync(program,call,{...settings,manualPrice:4801});
  const done=await pg.synchronizeBulkItem(program,call,manual.bulk.settings,manual.bulk.quote);
  assert.equal(done.price,4801);
  const failed=await pg.previewBulkSync(program,call,settings);failLanding=true;
  await assert.rejects(pg.synchronizeBulkItem(program,call,settings,failed.bulk.quote),/Магазин обновлён/);
  failLanding=false;
  const retry=await pg.previewBulkSync(program,call,settings);
  assert.equal(retry.bulk.price,5000,"Retry still calculates from unchanged AIS base, not partially updated shop price");
  const ambiguous={...program,productId:"",hours:999};
  await assert.rejects(pg.previewBulkSync(ambiguous,call,settings),/Неоднозначная/);
  const app=fs.readFileSync(path.join(__dirname,"../app-server.js"),"utf8");
  assert.match(app,/lock\.clientId !== body\.clientId/);assert.match(app,/lock\.ownerLogin/);
  assert.match(app,/authUser\?\.role !== "admin" && action !== "resolve"/);
  console.log("PASS: exact percentage/rounding, manual overrides, free prices, validation, read-only preview, stale/replay guards, sibling variants and partial retry");
})().catch(error=>{console.error(error);process.exitCode=1;});
