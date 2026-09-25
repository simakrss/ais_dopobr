"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto"),cp=require("node:child_process");
const up=require("../local-update"),win=require("../windows-update-service"),root=path.resolve(__dirname,"..");
const keys=crypto.generateKeyPairSync("ed25519"),key=keys.publicKey.export({type:"spki",format:"der"}).toString("base64");
const sign=r=>{const b=Buffer.from(JSON.stringify(r));return{payload:b.toString("base64"),signature:crypto.sign(null,b,keys.privateKey).toString("base64")};};
const release={protocol:1,version:"1.7.551",build:"test-components",commit:"b".repeat(40),files:[],components:[]};
for(const [names,list]of [[up.FILES,release.files],[up.COMPONENTS,release.components]])for(const name of names){
  const bytes=fs.readFileSync(up.safeTarget(root,name));list.push({path:name,sha256:up.hash(bytes),size:bytes.length});
  if(name.endsWith(".js")||name.endsWith(".cjs"))new vm.Script(bytes.toString("utf8"),{filename:name});
}
assert.equal(new Set(up.releaseFiles(release).map(f=>f.path)).size,up.releaseFiles(release).length);
assert.equal(up.validateEnvelope(sign(release),key).components.length,up.COMPONENTS.length);
assert.equal(win.configured(root),false);assert.equal(win.needsActivation(release,root),false);
const tampered=sign(release);tampered.signature="AAAA";assert.throws(()=>up.validateEnvelope(tampered,key),/Подпись/);
const missing=structuredClone(release);missing.components=missing.components.filter(f=>f.path!=="scripts/ais-windows-service.cs");
assert.throws(()=>up.validateEnvelope(sign(missing),key),/Неполный/);
for(const bad of ["../evil.ps1","storage/settings.json",".runtime/key","services/ocr/../../settings.json"]){
  const r=structuredClone(release);r.components.push({path:bad,size:1,sha256:"a".repeat(64)});assert.throws(()=>up.validateEnvelope(sign(r),key));
}
// Published manifests stay readable by deployed 1.7.550 updaters. They install
// the new engine first; its next check installs components at the SAME version.
const oldSource=cp.execFileSync("git",["show","b89ceaac:web-ais/local-update.js"],{cwd:path.dirname(root),encoding:"utf8"});
const context={require,module:{exports:{}},Buffer,SharedArrayBuffer,Int32Array,Atomics,process,console};vm.runInNewContext(oldSource,context);
assert.equal(context.module.exports.validateEnvelope(sign(release),key).version,release.version);
for(const f of release.files)if(f.path.endsWith(".js"))new vm.Script(fs.readFileSync(path.join(root,f.path),"utf8"));
const setup=fs.readFileSync(path.join(root,"scripts/enable-component-updates.ps1"),"utf8");
assert.doesNotMatch(setup,/Register-ScheduledTask|Start-Process|Copy-Item/);
const tray=fs.readFileSync(path.join(root,"scripts/ais-service-tray.ps1"),"utf8");assert.match(tray,/scriptHash = \$loadedTrayHash/);assert.match(tray,/iconHash = \$loadedIconHash/);
assert.doesNotMatch(fs.readFileSync(path.join(root,'windows-update-service.js'),'utf8'),/child_process|execFile|schtasks|runProtected/);
console.log(`PASS: ${up.releaseFiles(release).length} signed components, legacy bootstrap, syntax, scope/signature checks; elevated updater withdrawn`);
