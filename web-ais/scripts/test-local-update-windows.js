"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const windows=require("../local-update-windows"),up=require("../local-update");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ais-msi-handshake-")),root=path.join(dir,"app"),programData=path.join(dir,"ProgramData");
const protectedRoot=path.join(programData,"AisDopobrWeb"),statusFile=path.join(protectedRoot,"signed-msi-status.json");
fs.mkdirSync(root);fs.mkdirSync(protectedRoot,{recursive:true});
const options={platform:"win32",programData,pollMs:1,timeoutMs:35};
const release={version:"1.7.554"};
let status={protocol:2,phase:"ready",version:"1.7.553",targetVersion:release.version,token:crypto.randomUUID(),updatedAt:Date.now()};
const write=()=>up.atomicJson(statusFile,status);
async function main(){
  assert.equal(windows.state(root,options),null);
  up.atomicJson(path.join(protectedRoot,"service-config.json"),{sourceAppRoot:root,serviceAppRoot:root});write();
  assert.ok(windows.ready(windows.state(root,options),release));
  assert.equal(windows.state(root,{...options,platform:"linux"}),null);
  assert.equal(windows.state(path.join(dir,"unrelated"),options),null);
  assert.equal(windows.ready(status,{version:"1.7.555"}),true,"A newer app can install the latest compatible component release");
  assert.equal(windows.ready(status,{version:"1.7.552"}),false);
  assert.equal(windows.ready(status,release,status.updatedAt+60000),false);
  assert.equal(windows.ready(status,release,status.updatedAt-1),false);
  const hooks=windows.createHooks(root,up,options),reports=[];
  assert.ok(hooks.needsActivation(release));
  const pending=hooks.activate(release,item=>reports.push(item));
  const requestPath=path.join(up.runtimeDir(root),"windows-msi-request.json");
  const request=up.readJson(requestPath);
  assert.equal(request.token,status.token);assert.equal(request.version,release.version);
  status={...status,version:release.version,phase:"idle"};write();await pending;
  assert.equal(fs.existsSync(requestPath),false);assert.equal(reports[0].phase,"restarting");
  status={...status,phase:"ready",version:"1.7.553",updatedAt:Date.now()};write();
  await assert.rejects(hooks.activate(release,()=>{}),/не подтвердил/);
  assert.equal(fs.existsSync(requestPath),false,"Expired request must be removed");
  status.updatedAt=Date.now();write();const failed=hooks.activate(release,()=>{});
  status={...status,phase:"error",label:"signature rejected"};write();await assert.rejects(failed,/signature rejected/);
  assert.equal(fs.existsSync(requestPath),false);
  const previousProgramData=process.env.ProgramData;process.env.ProgramData=programData;
  try {
    up.atomicJson(path.join(up.runtimeDir(root),"status.json"),{phase:"idle",updatedAt:Date.now()});
    status={...status,phase:"installing",updatedAt:Date.now()};write();
    assert.equal(up.readStatus(root).phase,"restarting");
    status.updatedAt=Date.now()-180001;write();assert.equal(up.readStatus(root).phase,"idle");
    status={...status,phase:"error",updatedAt:Date.now()};write();
    assert.equal(up.readStatus(root).phase,"error");assert.equal(up.readStatus(root).canRetry,false);
  } finally {if(previousProgramData===undefined)delete process.env.ProgramData;else process.env.ProgramData=previousProgramData;}
  const source=fs.readFileSync(path.join(__dirname,"../local-update-windows.js"),"utf8");
  assert.doesNotMatch(source,/child_process|execFile|spawn\(|Start-Process|schtasks|msiexec\.exe/);
  console.log("PASS: MSI handshake, scope, timeout, stale consent, error and completion; no privileged JavaScript operations");
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
