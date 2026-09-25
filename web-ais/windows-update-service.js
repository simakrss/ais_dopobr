"use strict";
// Also installed in protected ProgramData and run by a SYSTEM scheduled task.
// Built-ins ONLY: never require or execute unverified code from the writable app.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),os=require("node:os"),cp=require("node:child_process");
const KEY="MCowBQYDK2VwAyEARDRUcPC/vPdxq9MOFlSfwBJUJNEz58fA8Jxhiuz9sCE=";
const BASE="https://edu-plus.ru/lms/updates/files/", TASK="AisDopobrComponentUpdate";
const PROTECTED=Object.freeze({
  "scripts/stop-lan-system.ps1":"stop-lan-system.ps1",
  "scripts/control-ais-service.ps1":"control-ais-service.ps1",
  "scripts/ais-service-tray.ps1":"ais-service-tray.ps1",
  "scripts/show-ais-service-log.ps1":"show-ais-service-log.ps1",
  "scripts/setup-ais-windows-service.ps1":"setup-ais-windows-service.ps1",
  "scripts/ais-windows-service.cs":"ais-windows-service.cs",
  "scripts/ais-hidden-process.vbs":"ais-hidden-process.vbs",
  "windows-update-service.js":"windows-update-service.js"
});
const protectedRoot=()=>path.join(process.env.ProgramData||"C:\\ProgramData","AisDopobrWeb");
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));}catch{return fallback;}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function compare(a,b){for(let i=0;i<3;i++){const d=Number(a.split(".")[i])-Number(b.split(".")[i]);if(d)return Math.sign(d);}return 0;}
function verify(envelope,key=KEY){
  if(typeof envelope?.payload!=="string"||envelope.payload.length>200000||typeof envelope.signature!=="string")throw Error("Invalid signed release");
  const payload=Buffer.from(envelope.payload,"base64");
  if(!crypto.verify(null,payload,crypto.createPublicKey({key:Buffer.from(key,"base64"),format:"der",type:"spki"}),Buffer.from(envelope.signature,"base64")))throw Error("Invalid release signature");
  const r=JSON.parse(payload);
  if(r.protocol!==1||!/^\d+\.\d+\.\d+$/.test(r.version)||!(/^[a-f0-9]{40}$/).test(r.commit)||!Array.isArray(r.files)||!Array.isArray(r.components))throw Error("Invalid component release");
  const files=[...r.files,...r.components],seen=new Set();
  if(files.length>200)throw Error("Too many files");
  for(const f of files){if(seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.size)||f.size<1||f.size>32*1024*1024)throw Error("Invalid file descriptor");seen.add(f.path);}
  if(Object.keys(PROTECTED).some(p=>!seen.has(p)))throw Error("Missing protected component");
  return {...r,protectedFiles:files.filter(f=>Object.hasOwn(PROTECTED,f.path))};
}
function state(){return read(path.join(protectedRoot(),"component-update-status.json"));}
function configured(root){
  if(process.platform!=="win32")return false;
  const config=read(path.join(protectedRoot(),"service-config.json"));if(!config?.serviceAppRoot)return false;
  if(!root)return true;
  try{
    const actual=fs.realpathSync.native(root).toLowerCase();
    return [config.serviceAppRoot,config.sourceAppRoot].filter(Boolean).some(candidate=>{
      try{return actual===fs.realpathSync.native(candidate).toLowerCase();}catch{return false;}
    });
  }catch{return false;}
}
function needsActivation(release,root){
  if(!configured(root)||!release.components)return false;
  const current=state();
  return current?.phase!=="complete"||current.version!==release.version||current.commit!==release.commit;
}
async function activate(release,report,root){
  if(!needsActivation(release,root))return;
  try{cp.execFileSync("schtasks.exe",["/Query","/TN",TASK],{windowsHide:true,stdio:"ignore",timeout:10000});}
  catch{throw Error("Для автоматического обновления службы и трея один раз включите обновление компонентов: запустите scripts/enable-component-updates.ps1 и подтвердите запрос Windows. Программные файлы обновлены; данные сохранены.");}
  report({phase:"restarting",label:"Обновление службы Windows, значка и меню трея"});
  const host=hash(os.hostname().toLowerCase()).slice(0,16);
  atomic(path.join(root,".runtime","local-updates",host,"activation-request.json"),JSON.stringify({version:release.version,commit:release.commit,requestedAt:Date.now()}));
  cp.execFileSync("schtasks.exe",["/Run","/TN",TASK],{windowsHide:true,stdio:"ignore",timeout:10000});
  // Usually this supervisor is stopped by the service task. If it survives,
  // never declare completion until the protected task confirms the new runtime.
  for(let i=0;i<180;i++){
    await delay(2000);const s=state();
    if(s?.version!==release.version||s.commit!==release.commit)continue;
    if(s.phase==="complete")return;
    if(s.phase==="error")throw Error(s.label||"Не удалось обновить компоненты Windows.");
  }
  throw Error("Не получено подтверждение обновления компонентов Windows. Проверьте журнал службы.");
}
function noLinks(root){
  let p=path.resolve(root);for(;;){if(fs.lstatSync(p).isSymbolicLink())throw Error("Reparse point in protected path");const parent=path.dirname(p);if(p===parent)break;p=parent;}
}
function atomic(file,bytes){
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error("Link in protected destination");
  const temp=file+"."+crypto.randomUUID()+".tmp";fs.writeFileSync(temp,bytes,{flag:"wx"});
  try{fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
async function payload(file){
  const r=await fetch(BASE+file.sha256+".bin",{redirect:"error",signal:AbortSignal.timeout(60000)});
  if(!r.ok||Number(r.headers.get("content-length"))>file.size)throw Error("Component download failed");
  const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>file.size)throw Error("Component too large");chunks.push(c);}
  const bytes=Buffer.concat(chunks);if(size!==file.size||hash(bytes)!==file.sha256)throw Error("Component checksum mismatch");return bytes;
}
const ps=code=>cp.execFileSync(path.join(process.env.SystemRoot||"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe"),
  ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-EncodedCommand",Buffer.from("$ErrorActionPreference='Stop';"+code,"utf16le").toString("base64")],
  {windowsHide:true,timeout:240000,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
async function runProtected(){
  const root=protectedRoot();noLinks(root);
  if(path.resolve(__dirname).toLowerCase()!==path.resolve(root).toLowerCase())throw Error("Updater must run from protected ProgramData");
  const config=read(path.join(root,"service-config.json"));if(!config?.serviceAppRoot)throw Error("Service configuration is missing");
  const journalPath=path.join(root,"component-update-journal.json"),interrupted=read(journalPath);
  if(interrupted){
    const backupDir=path.resolve(root,interrupted.stage);
    if(path.dirname(backupDir)!==path.resolve(root)||!/^update-[a-zA-Z0-9]+$/.test(interrupted.stage)||!Array.isArray(interrupted.files))throw Error("Invalid recovery journal");
    noLinks(backupDir);
    for(const f of interrupted.files){
      if(![...Object.values(PROTECTED),"AisDopobrService.exe"].includes(f.name))throw Error("Invalid recovery file");
      const bytes=fs.readFileSync(path.join(backupDir,f.name+".previous"));if(hash(bytes)!==f.before)throw Error("Invalid recovery checksum");
    }
    ps("$s=Get-Service AisDopobrWeb;if($s.Status -ne 'Stopped'){Stop-Service AisDopobrWeb;$s.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(180))}");
    for(const f of interrupted.files)atomic(path.join(root,f.name),fs.readFileSync(path.join(backupDir,f.name+".previous")));
    fs.unlinkSync(journalPath);
    if(interrupted.wasRunning)ps("Start-Service AisDopobrWeb");
    ps("Start-ScheduledTask -TaskName AisDopobrServiceTray");
    atomic(path.join(root,"component-update-status.json"),JSON.stringify({phase:"error",version:interrupted.version,updatedAt:Date.now(),label:"Предыдущие компоненты восстановлены после прерванного обновления. Повторите проверку обновлений."}));
    return;
  }
  const app=path.resolve(config.serviceAppRoot),host=hash(os.hostname().toLowerCase()).slice(0,16);
  const request=read(path.join(app,".runtime","local-updates",host,"activation-request.json"));
  if(!request||Date.now()-request.requestedAt>120000||request.requestedAt>Date.now()+10000)return;
  const envelope=read(path.join(app,".runtime","local-updates",host,"release.json"));
  const release=verify(envelope),previous=state();
  if(request.version!==release.version||request.commit!==release.commit)throw Error("Activation request does not match signed release");
  const installed=read(path.join(root,"component-update-installed.json"));
  if(installed&&compare(release.version,installed.version)<0)throw Error("Component downgrade refused");
  if(previous?.phase==="complete"&&previous.version===release.version&&previous.commit===release.commit)return;
  const report=(phase,label)=>atomic(path.join(root,"component-update-status.json"),JSON.stringify({phase,label,version:release.version,commit:release.commit,updatedAt:Date.now()}));
  const stage=fs.mkdtempSync(path.join(root,"update-")),backups=new Map();let stopped=false,wasRunning=false;
  try{
    report("downloading","Подготовка защищённых компонентов Windows");
    for(const f of release.protectedFiles)fs.writeFileSync(path.join(stage,PROTECTED[f.path]),await payload(f));
    const csc=path.join(process.env.SystemRoot||"C:\\Windows","Microsoft.NET","Framework64","v4.0.30319","csc.exe");
    cp.execFileSync(csc,["/nologo","/optimize+","/target:winexe","/platform:anycpu","/reference:System.dll","/reference:System.Core.dll","/reference:System.ServiceProcess.dll","/out:"+path.join(stage,"AisDopobrService.exe"),path.join(stage,"ais-windows-service.cs")],{windowsHide:true,timeout:60000,stdio:"pipe"});
    // Store backups durably before stopping or replacing any protected file.
    const names=[...Object.values(PROTECTED),"AisDopobrService.exe"];
    for(const name of names){const target=path.join(root,name);if(fs.existsSync(target)){noLinks(target);const bytes=fs.readFileSync(target);backups.set(name,bytes);fs.writeFileSync(path.join(stage,name+".previous"),bytes);}}
    report("restarting","Перезапуск службы Windows и трея");
    wasRunning=ps("[string](Get-Service AisDopobrWeb).Status").trim()!=="Stopped";
    atomic(journalPath,JSON.stringify({version:release.version,stage:path.basename(stage),wasRunning,files:[...backups].map(([name,bytes])=>({name,before:hash(bytes)}))}));
    ps("$s=Get-Service AisDopobrWeb; if($s.Status -ne 'Stopped'){Stop-Service AisDopobrWeb; $s.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(180))}; Stop-ScheduledTask -TaskName AisDopobrServiceTray -ErrorAction SilentlyContinue");stopped=true;
    // Only known tray scripts, never kill every PowerShell process.
    ps("$c=Get-Content -LiteralPath (Join-Path $env:ProgramData 'AisDopobrWeb/service-config.json') -Raw|ConvertFrom-Json; $paths=@((Join-Path $env:ProgramData 'AisDopobrWeb/ais-service-tray.ps1'),(Join-Path $c.serviceAppRoot 'scripts/ais-service-tray.ps1')); Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\"|ForEach-Object {$p=$_;foreach($x in $paths){if($p.CommandLine -and $p.CommandLine.IndexOf($x,[StringComparison]::OrdinalIgnoreCase)-ge 0){Stop-Process -Id $p.ProcessId -ErrorAction SilentlyContinue;break}}}");
    for(const name of names)atomic(path.join(root,name),fs.readFileSync(path.join(stage,name)));
    if(wasRunning)ps("Start-Service AisDopobrWeb");
    ps("Start-ScheduledTask -TaskName AisDopobrServiceTray");
    if(wasRunning){
      let healthy=false;
      const supervisorFile=release.files.find(f=>f.path==="scripts/start-lan-system.js");
      for(let i=0;i<150;i++){
        await delay(2000);
        try{
          const runtime=read(path.join(app,"tmp","lan-system","status.json"));
          const r=await fetch("http://127.0.0.1:8081/api/health",{signal:AbortSignal.timeout(3000)});
          if(r.ok&&(await r.json()).ok&&runtime?.version===release.version&&runtime.supervisorHash===supervisorFile?.sha256){healthy=true;break;}
        }catch{}
      }
      if(!healthy)throw Error("Служба после обновления не прошла проверку готовности");
    }
    // Ready marker proves that both the new menu code and icon were loaded.
    const trayFile=release.protectedFiles.find(f=>f.path==="scripts/ais-service-tray.ps1"),iconFile=release.files.find(f=>f.path==="favicon.ico");let trayReady=false;
    for(let i=0;i<30;i++){const marker=read(path.join(app,"tmp","lan-system","tray-ready.json"));if(marker?.scriptHash===trayFile.sha256&&marker.iconHash===iconFile?.sha256){trayReady=true;break;}await delay(1000);}
    if(!trayReady)throw Error("Не подтверждён запуск нового значка и меню трея");
    atomic(path.join(root,"component-update-installed.json"),JSON.stringify({version:release.version,commit:release.commit}));
    fs.unlinkSync(journalPath);
    report("complete","Система, службы и меню трея обновлены");
  }catch(error){
    if(stopped){
      try{ps("$s=Get-Service AisDopobrWeb;if($s.Status -ne 'Stopped'){Stop-Service AisDopobrWeb;$s.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(180))}");for(const [name,bytes]of backups)atomic(path.join(root,name),bytes);if(wasRunning)ps("Start-Service AisDopobrWeb");ps("Start-ScheduledTask -TaskName AisDopobrServiceTray");if(fs.existsSync(journalPath))fs.unlinkSync(journalPath);}catch(rollback){error.message+="; восстановление: "+rollback.message;}
    }
    report("error","Обновление компонентов не завершено: "+String(error.message).slice(0,500));throw error;
  }
  // Keep this bounded update directory as a recoverable backup, never remove data.
}
module.exports={PROTECTED,verify,needsActivation,activate,state,configured,runProtected};
if(require.main===module)runProtected().catch(error=>{console.error(error.message);process.exitCode=1;});
