"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const api=require("../vitu-email-source");
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"ais-vitu-source-")),shop="a".repeat(64);
 try{
  fs.writeFileSync(path.join(root,"program-site-keys.json"),JSON.stringify({shop}));
  const key=api.deriveKey(shop);assert.notEqual(key,shop);assert.match(key,/^[a-f0-9]{64}$/);
  assert.notEqual(key,crypto.createHmac("sha256",shop).update("ais-document-relay-v1:authentication").digest("hex"));
  assert.throws(()=>api.deriveKey("invalid"));
  let status=200,body={ok:true,version:1,count:1,records:[{email:"test@example.org",sourceReceivedAt:"2026-10-01"}],sourceSyncedAt:new Date().toISOString()},headers={"X-AIS-Vitu-Protocol":"1"};
  const options={fetch:async(url,request)=>{
   assert.equal(url,api.ENDPOINT);assert.equal(new URL(url).hostname,"xn--b1am4ae.xn--p1ai");
   assert.equal(request.method,"POST");assert.equal(request.redirect,"error");assert.equal(request.headers["X-AIS-Vitu-Key"],key);assert.ok(request.signal);
   assert.deepEqual(JSON.parse(request.body),{version:1});assert.ok(!url.includes(key));
   return new Response(typeof body==="string"?body:JSON.stringify(body),{status,headers});
  }};
  assert.equal((await api.read(root,options)).records.length,1);
  for(status of [401,403,404,413,500,503])await assert.rejects(api.read(root,options));
  status=200;
  for(body of ["<html>Login</html>",{}, {ok:true,version:1,count:2,records:[]},{ok:true,version:1,count:100001,records:new Array(100001)}])await assert.rejects(api.read(root,options));
  body={ok:true,version:1,count:0,records:[],sourceSyncedAt:new Date().toISOString()};headers={};await assert.rejects(api.read(root,options));
  headers={"X-AIS-Vitu-Protocol":"1"};assert.equal((await api.read(root,options)).count,0);
  await assert.rejects(api.read(root,{fetch:async()=>{throw Error("PRIVATE transport context");}}),e=>!e.message.includes("PRIVATE"));
  await assert.rejects(api.read(path.join(root,"missing"),options),/Не настроен/);
  const updater=require("../local-update");assert.ok(updater.FILES.includes("vitu-email-source.js"));
  const deployment=fs.readFileSync(path.join(__dirname,'deploy-lms.ps1'),'utf8');assert.equal((deployment.match(/"vitu-email-source\.js"/g)||[]).length,2,'New dependency must be allowlisted and mirrored to the private runtime');
  console.log("PASS VITU client: fixed HTTPS endpoint, scoped key, no redirects, bounded response, protocol/count validation, errors and update manifest");
 }finally{assert.ok(path.basename(root).startsWith("ais-vitu-source-"));fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
