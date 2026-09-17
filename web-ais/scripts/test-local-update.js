"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const up=require("../local-update");
const keys=crypto.generateKeyPairSync("ed25519"),publicKey=keys.publicKey.export({format:"der",type:"spki"}).toString("base64");
const roots=[];
const sign=release=>{const payload=Buffer.from(JSON.stringify(release));return{payload:payload.toString("base64"),signature:crypto.sign(null,payload,keys.privateKey).toString("base64")};};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(next="1.0.1"){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"ais-update-test-"));roots.push(root);
  const contents=new Map(),old=new Map();
  const release={protocol:1,version:next,build:"test-release-new",commit:"a".repeat(40),files:[]};
  for(const name of up.FILES){
    const a=name==="app.js"?'const APPLICATION_RELEASE = Object.freeze({version: "1.0.0"});':name==="index.html"?'const build = "test-release-old";':"// OLD "+name;
    const b=Buffer.from(name==="app.js"?`const APPLICATION_RELEASE = Object.freeze({version: "${next}"});`:name==="index.html"?'const build = "test-release-new";':"// NEW "+name);
    const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,a);old.set(name,a);
    const sha256=up.hash(b);contents.set(sha256,b);release.files.push({path:name,sha256,size:b.length});
  }
  fs.mkdirSync(path.join(root,"storage"));fs.writeFileSync(path.join(root,"storage","settings.json"),"KEEP PRIVATE SETTINGS");
  const envelope=sign(release),requests=[];
  const fetcher=async url=>{requests.push(url);if(url.includes("latest.json"))return new Response(JSON.stringify(envelope));const sha=url.match(/([a-f0-9]{64})\.bin$/)?.[1];return new Response(contents.get(sha)||"missing");};
  return{root,release,contents,old,envelope,fetcher,requests};
}
async function main(){
  const one=fixture();assert.equal(up.validateEnvelope(one.envelope,publicKey).version,"1.0.1");
  assert.throws(()=>up.validateEnvelope({...one.envelope,payload:Buffer.from("{}").toString("base64")},publicKey),/Подпись/);
  for(const bad of ["../app.js","storage/settings.json",".runtime/key.pem","C:/app.js"]){const data=structuredClone(one.release);data.files[0].path=bad;assert.throws(()=>up.validateEnvelope(sign(data),publicKey),/состав/);assert.throws(()=>up.safeTarget(one.root,bad));}
  const dup=structuredClone(one.release);dup.files[1]=dup.files[0];assert.throws(()=>up.validateEnvelope(sign(dup),publicKey));
  let restarts=0;
  const updater=up.createUpdater(one.root,{idle:async()=>true,restart:async()=>{restarts++;assert.equal(up.version(one.root),"1.0.1");assert.equal(up.readStatus(one.root).phase,"restarting");}},{publicKey,fetcher:one.fetcher,pollMs:5,warningMs:5,drainMs:5});
  await updater.checkNow();updater.dispose();assert.equal(restarts,1);assert.equal(up.readStatus(one.root).phase,"complete");
  for(const file of one.release.files)assert.equal(up.hash(fs.readFileSync(path.join(one.root,file.path))),file.sha256);
  assert.equal(fs.readFileSync(path.join(one.root,"storage/settings.json"),"utf8"),"KEEP PRIVATE SETTINGS");
  assert.ok(fs.readdirSync(path.join(up.runtimeDir(one.root),"backups")).length>0);
  const rollback=fixture();let attempts=0;
  const failed=up.createUpdater(rollback.root,{idle:async()=>true,restart:async()=>{if(++attempts===1)throw Error("test failed health");}},{publicKey,fetcher:rollback.fetcher,pollMs:1,warningMs:1,drainMs:1});
  await failed.checkNow();failed.dispose();assert.equal(attempts,2);assert.equal(up.readStatus(rollback.root).phase,"error");
  for(const [name,bytes]of rollback.old)assert.equal(fs.readFileSync(path.join(rollback.root,name),"utf8"),bytes);
  const blocked=fixture();const client=crypto.randomUUID();up.writeLease(blocked.root,client,false);
  let calls=0;const waiting=up.createUpdater(blocked.root,{idle:async()=>true,restart:async()=>{calls++;}},{publicKey,fetcher:blocked.fetcher,pollMs:5,warningMs:5,drainMs:5});
  const running=waiting.checkNow();
  for(let i=0;i<100&&up.readStatus(blocked.root).phase!=="waiting";i++)await pause(5);
  assert.equal(up.readStatus(blocked.root).phase,"waiting");assert.equal(calls,0);assert.equal(up.version(blocked.root),"1.0.0");
  up.writeLease(blocked.root,client,true);await running;waiting.dispose();assert.equal(calls,1);
  const immediate=fixture();let immediateRestarts=0,serverIdle=true;
  const now=up.createUpdater(immediate.root,{idle:async()=>serverIdle,restart:async()=>{immediateRestarts++;}},{publicKey,fetcher:immediate.fetcher,pollMs:5,warningMs:60000,drainMs:5});
  const nowRunning=now.checkNow();
  async function phase(root,name){for(let i=0;i<400;i++){const value=up.readStatus(root);if(value.phase===name)return value;await pause(5);}throw Error("Expected phase "+name);}
  try {
    const warning=await phase(immediate.root,"warning");assert.equal(warning.canUpdateNow,true);
    assert.throws(()=>up.requestImmediateUpdate(immediate.root,{...warning,ready:false}),/Сначала/);
    assert.throws(()=>up.requestImmediateUpdate(immediate.root,{...warning,ready:true,warningId:"stale"}),/отсчёт/);
    assert.throws(()=>up.requestImmediateUpdate(immediate.root,{...warning,ready:true,targetVersion:"8.0.0"}),/отсчёт/);
    const busyClient=crypto.randomUUID();up.writeLease(immediate.root,busyClient,false);
    assert.throws(()=>up.requestImmediateUpdate(immediate.root,{...warning,ready:true}),/Сначала/);
    up.writeLease(immediate.root,busyClient,true);
    up.requestImmediateUpdate(immediate.root,{...warning,ready:true});
    // New activity invalidates the accepted shortcut, not the safety checks.
    serverIdle=false;await phase(immediate.root,"waiting");serverIdle=true;
    const renewed=await phase(immediate.root,"warning");assert.notEqual(renewed.warningId,warning.warningId);
    await pause(25);assert.equal(immediateRestarts,0);assert.equal(up.version(immediate.root),"1.0.0");
    assert.throws(()=>up.requestImmediateUpdate(immediate.root,{...warning,ready:true}),/отсчёт/);
    up.requestImmediateUpdate(immediate.root,{...renewed,ready:true});
    up.requestImmediateUpdate(immediate.root,{...renewed,ready:true});
    await Promise.race([nowRunning,pause(2000).then(()=>{throw Error("Immediate update kept the 60-second countdown");})]);
    assert.equal(immediateRestarts,1);assert.equal(up.version(immediate.root),"1.0.1");
    assert.equal(up.readStatus(immediate.root).canUpdateNow,false);
    assert.throws(()=>up.requestImmediateUpdate(immediate.root,{...renewed,ready:true}),/отсчёт/);
  } finally {now.dispose();await nowRunning;}
  const old=fixture("0.9.0"),older=up.createUpdater(old.root,{idle:async()=>true,restart:async()=>assert.fail("downgrade")},{publicKey,fetcher:old.fetcher});await older.checkNow();older.dispose();assert.equal(old.requests.length,1);
  const corrupt=fixture();corrupt.contents.set(corrupt.release.files[0].sha256,Buffer.from("WRONG"));
  const bad=up.createUpdater(corrupt.root,{idle:async()=>true,restart:async()=>assert.fail("corrupt")},{publicKey,fetcher:corrupt.fetcher});await bad.checkNow();bad.dispose();assert.equal(up.version(corrupt.root),"1.0.0");assert.match(up.readStatus(corrupt.root).label,/сумма/);
  const crashed=fixture(),dir=up.runtimeDir(crashed.root),file=crashed.release.files[0],before=Buffer.from(crashed.old.get(file.path));
  fs.mkdirSync(path.join(dir,"backups"),{recursive:true});fs.writeFileSync(path.join(dir,"backups",up.hash(before)),before);
  up.atomicJson(path.join(dir,"journal.json"),{files:[{path:file.path,before:up.hash(before),after:file.sha256}]});fs.writeFileSync(path.join(crashed.root,file.path),crashed.contents.get(file.sha256));
  assert.equal(up.readStatus(crashed.root).phase,"recovery-error");assert.equal(up.restore(crashed.root),true);assert.equal(up.version(crashed.root),"1.0.0");
  assert.throws(()=>up.writeLease(crashed.root,"../../escape",true));
  const syntax=fixture(),syntaxFile=syntax.release.files.find(file=>file.path==="app-server.js"),invalid=Buffer.from("let = ;");
  syntaxFile.sha256=up.hash(invalid);syntaxFile.size=invalid.length;syntax.contents.set(syntaxFile.sha256,invalid);Object.assign(syntax.envelope,sign(syntax.release));
  const badCode=up.createUpdater(syntax.root,{idle:async()=>true,restart:async()=>assert.fail("Bad syntax must not restart working server")},{publicKey,fetcher:syntax.fetcher,pollMs:1,warningMs:1,drainMs:1});
  await badCode.checkNow();badCode.dispose();assert.equal(up.readStatus(syntax.root).phase,"error");assert.equal(up.version(syntax.root),"1.0.0");
  const shared=fixture();let sharedRestarts=0;
  const sharedUpdater=up.createUpdater(shared.root,{idle:async()=>true,restart:async()=>{sharedRestarts++;}},{publicKey,fetcher:shared.fetcher,pollMs:1,warningMs:1,drainMs:1});
  // Files changed by an external folder sync; the old process still needs restarting.
  for(const file of shared.release.files)fs.writeFileSync(path.join(shared.root,file.path),shared.contents.get(file.sha256));
  await sharedUpdater.checkNow();sharedUpdater.dispose();assert.equal(sharedRestarts,1);
  console.log("PASS: signed manifests, exact allowlist, downgrade prevention, download hashes, immediate update/countdown scope, waiting for drafts and operations, install/restart, backup/rollback, crash journal, settings untouched");
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  for(const root of roots){if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith("ais-update-test-"))fs.rmSync(root,{recursive:true,force:true});}
});
