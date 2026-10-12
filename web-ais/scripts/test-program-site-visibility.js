"use strict";
const assert = require("node:assert/strict");
const pg = require("../program-site-generator");
const program = {id:"p1",landingCode:"course",hours:144,productId:"99"};
const landing = {id:42,status:"publish",title:"Лендинг",version:"v1",variantVisibility:true,
  offers:[{productId:12,hours:72,hidden:false},{productId:99,hours:144,hidden:true}]};
const calls = [];
async function call(site, endpoint, body) {
  calls.push({site,endpoint,body});
  if (endpoint === "/resolve-site") return structuredClone(landing);
  if (endpoint.startsWith("/sync-product/")) return {id:Number(endpoint.split("/").at(-1)),title:"Курс"};
  if (endpoint === "/set-variant-visibility") return {ok:true,...body};
  assert.fail(endpoint);
}
(async()=>{
  const plan=await pg.inspectSite(program,call);
  assert.equal(plan.products[1].hidden,true); assert.equal(plan.products[0].hidden,false);
  assert.equal(plan.landing.version,"v1"); assert.equal(plan.landing.variantVisibility,true);
  assert.equal(plan.product.id,99,"Hidden product stays selectable for synchronization");
  calls.length=0;
  assert.equal((await pg.setVariantVisibility(program,call,99,false,"v1",42)).hidden,false);
  assert.ok(calls.every(item=>item.site==="edu"),"No shop reads or writes needed for hiding");
  assert.deepEqual(calls.map(item=>item.endpoint),["/resolve-site","/set-variant-visibility"]);
  for (const args of [[99,"true","v1",42],[0,true,"v1",42],[99,true,"old",42],[99,true,"v1",77],[800,true,"v1",42]]) {
    calls.length=0;
    await assert.rejects(pg.setVariantVisibility(program,call,...args));
    assert.ok(calls.every(item=>item.endpoint==="/resolve-site"),"Invalid or stale actions never write");
  }
  landing.variantVisibility=false;
  await assert.rejects(pg.setVariantVisibility(program,call,99,true,"v1",42),/Обновите служебный модуль/);
  landing.variantVisibility=true;
  await assert.rejects(pg.setVariantVisibility(program,async(site,route,body)=>route==="/set-variant-visibility"?{ok:true,...body,hidden:false}:call(site,route,body),99,true,"v1",42),/не подтвердил/);
  console.log("PASS: variant visibility protocol, capability/stale/scope guards, hidden product mapping and no shop calls");
})().catch(error=>{console.error(error);process.exitCode=1;});
