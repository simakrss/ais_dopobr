"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const pg = require("../program-site-generator");
const program = {id:"copied-program", name:"Программа — новый вариант (144 ч)", type:"КПК", hours:144, price:6500,
  oldPrice:8000, landingCode:"shared-course", siteProductPending:true, productId:"",
  siteTrainingPlan:[{discipline:"Новый модуль",totalHours:"144"}]};
let landing = {id:42,postType:"courses-pk",status:"publish",slug:"shared-course",title:"Общий лендинг",version:"v1",
  url:"https://edu-plus.ru/courses-pk/shared-course/",offers:[{productId:12,hours:144}],variants:{},
  fields:{blok_ceny:[{ssylka_na_registraciyu:"https://zifra-plus.ru/checkout/?add-to-cart=12"}],opisanie_o_programme:"Существующее описание"}};
const calls = [];
let generated=0, productCount=0, product=null, failAttach=false, failRedirect=false;
const pages = ["ru","page-2","page-3"].map((language,i)=>({id:101+i,language,url:`https://edu-plus.ru/wp-content/uploads/sample-${i}.jpg`}));
const prepareCertificate = async sample => {
  assert.equal(sample.siteSampleLandingUrl,landing.url,"Sample QR must point to the shared landing, not the new product slug");
  return {hash:"c".repeat(64),generate:async()=>{generated++;return pages.map(page=>({...page,base64:"synthetic-only"}));}};
};
async function call(site,endpoint,body) {
  calls.push({site,endpoint,body});
  if(endpoint==="/resolve-site") return structuredClone(landing);
  if(endpoint==="/health") return {programVariants:true};
  if(endpoint.startsWith("/sync-product/")) return {id:Number(endpoint.split("/").at(-1)),version:"p1"};
  if(endpoint==="/check-variant") return {ok:true};
  if(endpoint==="/variant-assets") return {images:pages};
  if(endpoint==="/prepare-product") {
    assert.notEqual(body.slug,landing.slug,"Shop product must have its own stable slug");
    assert.equal(body.landingSlug,landing.slug);
    assert.equal(body.productTemplateId,12);
    if(!product) {product={id:99,status:"draft",key:body.key,hash:body.hash};productCount++;}
    assert.equal(body.hash,product.hash,"Retry must reuse the same product payload after landing metadata changes");
    return structuredClone(product);
  }
  if(endpoint==="/publish") {product.status="publish";return product;}
  if(endpoint==="/attach-variant") {
    if(failAttach) throw new Error("temporary landing failure");
    landing.variants[body.key]={productId:99,hash:body.hash,complete:true};landing.version="v2";
    if(!landing.offers.some(offer=>offer.productId===99))landing.offers.push({productId:99,hours:144});
    return {id:42,url:landing.url,status:"publish"};
  }
  if(endpoint==="/enable-redirect") {if(failRedirect)throw new Error("temporary redirect failure");return {...product,redirectEnabled:true};}
  assert.fail(endpoint);
}
(async()=>{
  const gateway=fs.readFileSync(path.join(__dirname,"../gateway.php"),"utf8");
  const routes=gateway.match(/function gateway_tunnel_handles[\s\S]*?\n}/)[0];
  assert.match(routes,/\$method === 'POST' && in_array\(\$path, \[[^\]]*'\/api\/program-sites\/preview-variant'[^\]]*'\/api\/program-sites\/add-variant'/,"Hosted sample preview and generation must use the local rendering worker");
  let resolved=await pg.resolveSite(program,call);
  assert.equal(resolved.product,null,"A copied program cannot target the original product even with equal hours");
  assert.equal(resolved.needsNewProduct,true);
  await assert.rejects(pg.resolveSite(program,call,12),/отдельный товар/);
  const preview=await pg.previewVariant(program,call,prepareCertificate);
  assert.equal(generated,0);assert.equal(productCount,0);
  assert.ok(calls.every(item=>["/resolve-site","/health","/check-variant"].includes(item.endpoint)||item.endpoint.startsWith("/sync-product/")));
  landing.version="changed";
  await assert.rejects(pg.addVariant(program,call,preview.hash,prepareCertificate),/изменились/);
  assert.equal(generated,0);assert.equal(productCount,0);
  landing.version="v1";failAttach=true;
  await assert.rejects(pg.addVariant(program,call,preview.hash,prepareCertificate),/тот же товар/);
  assert.equal(productCount,1);assert.equal(landing.offers.length,1);
  failAttach=false;failRedirect=true;
  await assert.rejects(pg.addVariant(program,call,preview.hash,prepareCertificate),/redirect failure/);
  assert.equal(landing.offers.length,2);
  failRedirect=false;
  const retry=await pg.previewVariant(program,call,prepareCertificate);
  assert.equal(retry.alreadyAdded,true);
  const result=await pg.addVariant(program,call,retry.hash,prepareCertificate);
  assert.equal(result.product.id,99);assert.equal(result.certificates.length,3);assert.equal(result.isVariant,true);
  assert.equal(productCount,1);assert.equal(landing.offers.length,2);
  const unconfirmed = async(site,endpoint,body) => endpoint === "/publish" ? {id:99,status:"draft"} : call(site,endpoint,body);
  await assert.rejects(pg.addVariant(program,unconfirmed,retry.hash,prepareCertificate),/не подтвердил публикацию/);
  const wrongProduct = async(site,endpoint,body) => endpoint === "/enable-redirect" ? {id:12,status:"publish",redirectEnabled:true} : call(site,endpoint,body);
  await assert.rejects(pg.addVariant(program,wrongProduct,retry.hash,prepareCertificate),/не подтвердили добавление/);
  resolved=await pg.resolveSite(program,call);
  assert.equal(resolved.product.id,99,"A lost local response is recovered using the program's own remote variant");
  assert.equal(resolved.needsNewProduct,false);
  await assert.rejects(pg.previewVariant({...program,productId:"99"},call,prepareCertificate),/уже связана/);
  await assert.rejects(pg.previewVariant({...program,type:"ППП"},call,prepareCertificate),/того же вида/);
  console.log("PASS: duplicate isolation, read-only preview, stale validation, distinct product and shared URL, all samples, partial failure and idempotent retries");
})().catch(error=>{console.error(error);process.exitCode=1;});
