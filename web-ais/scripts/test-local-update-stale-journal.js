"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto"),cp=require("node:child_process");
const up=require("../local-update");
const keys=crypto.generateKeyPairSync("ed25519"),publicKey=keys.publicKey.export({format:"der",type:"spki"}).toString("base64");
const host=crypto.createHash("sha256").update(os.hostname().toLowerCase()).digest("hex").slice(0,16);
const roots=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sign=release=>{const bytes=Buffer.from(JSON.stringify(release));return {payload:bytes.toString("base64"),signature:crypto.sign(null,bytes,keys.privateKey).toString("base64")};};
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"ais-stale-journal-"));roots.push(root);
  const contents=new Map();
  const describe=name=>{
    const bytes=Buffer.from(name==="app.js"?'const APPLICATION_RELEASE = Object.freeze({version: "1.7.622"});':name==="index.html"?'const build = "test-current-release";':"// current "+name);
    const file=up.safeTarget(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
    const sha256=up.hash(bytes);contents.set(sha256,bytes);return {path:name,size:bytes.length,sha256};
  };
  const release={protocol:1,version:"1.7.622",build:"test-current-release",commit:"a".repeat(40),files:up.FILES.map(describe),components:up.COMPONENTS.map(describe)};
  const dir=up.runtimeDir(root),journalFile=path.join(dir,"journal.json"),archiveRoot=path.join(root,"audit");
  const journal={version:"1.7.619",files:release.files.slice(0,2).map(item=>({path:item.path,before:"b".repeat(64),after:"c".repeat(64)}))};
  const installed={version:release.version,commit:release.commit,componentsComplete:true};
  up.atomicJson(path.join(dir,"release.json"),sign(release));up.atomicJson(path.join(dir,"installed.json"),installed);up.atomicJson(journalFile,journal);
  fs.mkdirSync(path.join(root,"storage"));fs.writeFileSync(path.join(root,"storage","private.json"),"KEEP DATABASE AND SETTINGS");
  return {root,dir,release,contents,journal,journalFile,archiveRoot,installed,options:{publicKey,recoveryArchiveRoot:archiveRoot,windowsComponents:false}};
}
function unchanged(f){
  for(const item of up.releaseFiles(f.release))assert.equal(up.hash(fs.readFileSync(path.join(f.root,item.path))),item.sha256,item.path);
  assert.equal(fs.readFileSync(path.join(f.root,"storage/private.json"),"utf8"),"KEEP DATABASE AND SETTINGS");
}
function lock(f,owner){const dir=path.join(f.root,".runtime/local-update-install.lock");up.atomicJson(path.join(dir,"owner.json"),owner);return dir;}
async function main(){
  const valid=fixture(),recovered=up.reconcileSupersededJournal(valid.root,valid.options);
  assert.equal(recovered.version,"1.7.622");assert.equal(recovered.journalVersion,"1.7.619");assert.equal(fs.existsSync(valid.journalFile),false);unchanged(valid);
  const archived=up.readJson(recovered.archive);assert.deepEqual(archived.journal,valid.journal);assert.deepEqual(archived.installed,valid.installed);
  assert.equal(up.validateEnvelope(archived.release,publicKey).version,"1.7.622");
  assert.equal(up.reconcileSupersededJournal(valid.root,valid.options),null);
  up.atomicJson(valid.journalFile,valid.journal);
  assert.ok(up.reconcileSupersededJournal(valid.root,valid.options),"A journal resurrected by folder sync can be reconciled again");
  up.atomicJson(valid.journalFile,{...valid.journal,files:[]});
  assert.ok(up.reconcileSupersededJournal(valid.root,valid.options),"A superseded restart-only transaction can have an empty file list");

  const mutations=[
    ["bad signature",f=>up.atomicJson(path.join(f.dir,"release.json"),{...sign(f.release),signature:"AAAA"})],
    ["missing signed manifest",f=>fs.unlinkSync(path.join(f.dir,"release.json"))],
    ["missing installation receipt",f=>fs.unlinkSync(path.join(f.dir,"installed.json"))],
    ["different commit",f=>up.atomicJson(path.join(f.dir,"installed.json"),{...f.installed,commit:"d".repeat(40)})],
    ["incomplete components",f=>up.atomicJson(path.join(f.dir,"installed.json"),{...f.installed,componentsComplete:false})],
    ["same version journal",f=>up.atomicJson(f.journalFile,{...f.journal,version:"1.7.622"})],
    ["newer real transaction",f=>up.atomicJson(f.journalFile,{...f.journal,version:"1.7.623"})],
    ["corrupt journal",f=>fs.writeFileSync(f.journalFile,"{")],
    ["unknown journal version",f=>up.atomicJson(f.journalFile,{...f.journal,version:"unknown"})],
    ["missing file list",f=>up.atomicJson(f.journalFile,{version:f.journal.version})],
    ["invalid journal hash",f=>up.atomicJson(f.journalFile,{...f.journal,files:[{...f.journal.files[0],after:"wrong"}]})],
    ["duplicate journal path",f=>up.atomicJson(f.journalFile,{...f.journal,files:[f.journal.files[0],f.journal.files[0]]})],
    ["private data path",f=>up.atomicJson(f.journalFile,{...f.journal,files:[{...f.journal.files[0],path:"storage/private.json"}]})],
    ["path traversal",f=>up.atomicJson(f.journalFile,{...f.journal,files:[{...f.journal.files[0],path:"../app.js"}]})],
    ["changed code outside journal",f=>fs.appendFileSync(path.join(f.root,"styles.css"),"modified")],
    ["missing component",f=>fs.unlinkSync(path.join(f.root,f.release.components[0].path))],
    ["incomplete signed file list",f=>up.atomicJson(path.join(f.dir,"release.json"),sign({...f.release,files:f.release.files.filter(item=>item.path!=="app-server.js")}))]
  ];
  for(const [name,mutate] of mutations){
    const f=fixture();mutate(f);const original=fs.readFileSync(f.journalFile);
    assert.equal(up.reconcileSupersededJournal(f.root,f.options),null,name);
    assert.ok(fs.readFileSync(f.journalFile).equals(original),name);
    assert.equal(fs.existsSync(f.archiveRoot),false,name);
    assert.equal(up.readStatus(f.root).phase,"recovery-error",name);
  }
  for(const owner of [{host,pid:process.pid},{host:"foreign-host",pid:999999},{host,pid:0},{host,pid:"invalid"}]){
    const f=fixture(),dir=lock(f,owner);
    assert.equal(up.reconcileSupersededJournal(f.root,f.options),null);
    assert.deepEqual(up.readJson(path.join(dir,"owner.json")),owner);assert.ok(fs.existsSync(f.journalFile));unchanged(f);
  }
  const deadPid=Number(cp.execFileSync(process.execPath,["-e","process.stdout.write(String(process.pid))"],{windowsHide:true,encoding:"utf8"}));
  const dead=fixture(),deadLock=lock(dead,{host,pid:deadPid});
  assert.ok(up.reconcileSupersededJournal(dead.root,dead.options));assert.equal(fs.existsSync(deadLock),false);unchanged(dead);
  const active=fixture();lock(active,{host,pid:process.pid});
  up.atomicJson(path.join(active.dir,"status.json"),{phase:"installing",updatedAt:Date.now(),label:"Other updater"});
  const otherUpdater=up.createUpdater(active.root,{idle:async()=>true,restart:async()=>assert.fail("Active installer")},active.options);
  try {await assert.rejects(()=>otherUpdater.recover(),/Другой экземпляр/);assert.equal(up.readStatus(active.root).phase,"installing");unchanged(active);}
  finally {otherUpdater.dispose();}
  const denied=fixture(),archiveFile=path.join(denied.root,"archive-is-a-file");fs.writeFileSync(archiveFile,"do not replace");
  assert.throws(()=>up.reconcileSupersededJournal(denied.root,{...denied.options,recoveryArchiveRoot:archiveFile}));
  assert.ok(fs.existsSync(denied.journalFile));unchanged(denied);
  assert.ok(up.reconcileSupersededJournal(denied.root,denied.options),"A failed archive must be retryable");

  for(const change of ["journal","code","receipt"]){
    const race=fixture(),rename=fs.renameSync;
    fs.renameSync=(from,to)=>{
      const result=rename(from,to);
      if(String(to).startsWith(race.archiveRoot+path.sep)){
        if(change==="journal")up.atomicJson(race.journalFile,{...race.journal,version:"1.7.623"});
        if(change==="code")fs.appendFileSync(path.join(race.root,"styles.css"),"external change");
        if(change==="receipt")up.atomicJson(path.join(race.dir,"installed.json"),{...race.installed,version:"1.7.623"});
      }
      return result;
    };
    try {assert.throws(()=>up.reconcileSupersededJournal(race.root,race.options),/изменились/);}
    finally {fs.renameSync=rename;}
    assert.ok(fs.existsSync(race.journalFile),"Concurrent sync must retain the journal: "+change);
  }

  const startup=fixture();let requests=0;
  const restored=up.createUpdater(startup.root,{idle:async()=>true,restart:async()=>assert.fail("No code changed")},
    {...startup.options,fetcher:async()=>{requests++;return new Response(JSON.stringify(sign(startup.release)));}});
  try {
    await restored.recover();assert.equal(up.readStatus(startup.root).phase,"idle");assert.equal(restored.maintenance(),false);unchanged(startup);
    await restored.checkNow();assert.equal(requests,1);
    // Simulate a journal returned by folder sync after startup, without restarting.
    up.atomicJson(startup.journalFile,startup.journal);
    await restored.checkNow();assert.equal(requests,2);assert.equal(fs.existsSync(startup.journalFile),false);unchanged(startup);
  } finally {restored.dispose();}

  const crash=fixture(),app=crash.release.files.find(item=>item.path==="app.js"),next=Buffer.from('const APPLICATION_RELEASE = Object.freeze({version: "1.7.623"});');
  const backup=path.join(crash.dir,"backups",app.sha256);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,crash.contents.get(app.sha256));
  up.atomicJson(crash.journalFile,{version:"1.7.623",files:[{path:"app.js",before:app.sha256,after:up.hash(next)}]});fs.writeFileSync(path.join(crash.root,"app.js"),next);
  const rollback=up.createUpdater(crash.root,{idle:async()=>true,restart:async()=>assert.fail("startup recovery")},crash.options);
  try {await rollback.recover();assert.equal(up.version(crash.root),"1.7.622");assert.equal(up.readStatus(crash.root).phase,"error");assert.equal(fs.existsSync(crash.archiveRoot),false);unchanged(crash);}
  finally {rollback.dispose();}
  const damaged=fixture();fs.writeFileSync(damaged.journalFile,"{");
  const damagedUpdater=up.createUpdater(damaged.root,{idle:async()=>true,restart:async()=>assert.fail("Damaged journal")},damaged.options);
  try {await assert.rejects(()=>damagedUpdater.recover(),/прочитать журнал/);assert.equal(up.readStatus(damaged.root).phase,"recovery-error");assert.equal(damagedUpdater.maintenance(),true);unchanged(damaged);}
  finally {damagedUpdater.dispose();}

  const waiting=fixture(),future=structuredClone(waiting.release);
  future.version="1.7.623";future.build="test-next-release";future.commit="e".repeat(40);
  for(const item of future.files){
    if(!["app.js","index.html"].includes(item.path))continue;
    const bytes=Buffer.from(item.path==="app.js"?'const APPLICATION_RELEASE = Object.freeze({version: "1.7.623"});':'const build = "test-next-release";');
    item.sha256=up.hash(bytes);item.size=bytes.length;waiting.contents.set(item.sha256,bytes);
  }
  const client=crypto.randomUUID();up.writeLease(waiting.root,client,false);
  let idle=false,restarts=0;
  const background=up.createUpdater(waiting.root,{idle:async()=>idle,restart:async()=>{assert.equal(idle,true);assert.equal(up.clientsReady(waiting.root),true);restarts++;}},
    {...waiting.options,pollMs:2,warningMs:2,drainMs:2,fetcher:async url=>url.includes("latest.json")?new Response(JSON.stringify(sign(future))):new Response(waiting.contents.get(url.match(/([a-f0-9]{64})\.bin$/)?.[1]))});
  const running=background.checkNow();
  try {
    for(let i=0;i<200&&up.readStatus(waiting.root).phase!=="waiting";i++)await pause(5);
    assert.equal(fs.existsSync(waiting.journalFile),false);assert.equal(up.readStatus(waiting.root).phase,"waiting");assert.equal(restarts,0);unchanged(waiting);
    up.writeLease(waiting.root,client,true);await pause(25);assert.equal(restarts,0,"Server operations still prevent installation");unchanged(waiting);
    idle=true;await running;assert.equal(restarts,1);assert.equal(up.version(waiting.root),"1.7.623");
  } finally {idle=true;up.writeLease(waiting.root,client,true);background.dispose();await running;}
  console.log("Superseded journals: signature/receipt/all-file verification, archive, locks, races, startup/background recovery, real rollback, drafts and jobs: OK");
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  for(const root of roots)if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith("ais-stale-journal-"))fs.rmSync(root,{recursive:true,force:true});
});
