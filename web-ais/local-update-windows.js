"use strict";
// Unprivileged handshake only. No execution, elevation or writes to ProgramData.
const fs=require("node:fs"),path=require("node:path");
function state(root,options={}) {
  if((options.platform||process.platform)!=="win32")return null;
  const base=options.programData||process.env.ProgramData;
  if(!base)return null;
  try {
    const config=JSON.parse(fs.readFileSync(path.join(base,"AisDopobrWeb","service-config.json"),"utf8").replace(/^\uFEFF/,""));
    const normalize=p=>{try{return fs.realpathSync.native(p).toLowerCase();}catch{return path.resolve(p||".").toLowerCase();}};
    if(![config.sourceAppRoot,config.serviceAppRoot].some(p=>p&&normalize(p)===normalize(root)))return null;
    const item=JSON.parse(fs.readFileSync(path.join(base,"AisDopobrWeb","signed-msi-status.json"),"utf8"));
    if(item.protocol!==2||!/^\d+\.\d+\.\d+$/.test(item.version)||!Number.isFinite(item.updatedAt))return null;
    return item;
  } catch{return null;}
}
function ready(item,release,now=Date.now()) {
  const compare=(a,b)=>{const x=a.split(".").map(Number),y=b.split(".").map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
  return !!(item?.phase==="ready"&&/^\d+\.\d+\.\d+$/.test(item.version||"")&&/^\d+\.\d+\.\d+$/.test(item.targetVersion||"")&&/^\d+\.\d+\.\d+$/.test(release.version||"")
    &&compare(item.targetVersion,item.version)>0&&compare(item.targetVersion,release.version)<=0&&/^[a-f0-9-]{36}$/.test(item.token)
    &&now>=item.updatedAt&&now-item.updatedAt<60000);
}
function createHooks(root,update,options={}) {
  const get=()=>state(root,options);
  return {
    needsActivation:release=>ready(get(),release),
    async activate(release,report) {
      const pending=get();if(!ready(pending,release))return;
      report({phase:"restarting",label:"Установка подписанного обновления службы и трея через Windows Installer"});
      const request=path.join(update.runtimeDir(root),"windows-msi-request.json");
      update.atomicJson(request,{token:pending.token,version:pending.targetVersion,requestedAt:Date.now()});
      const deadline=Date.now()+(options.timeoutMs??120000);
      try {
        while(Date.now()<deadline) {
          await new Promise(resolve=>setTimeout(resolve,options.pollMs??1000));
          const next=get();
          if(next?.version===pending.targetVersion&&next.phase==="idle")return;
          if(next?.phase==="error")throw Error(next.label);
        }
        throw Error("Windows Installer не подтвердил обновление. Проверьте журнал установки службы; повторная установка автоматически не запускается.");
      } finally {
        // Expired consent cannot trigger a late installation after maintenance ends.
        try {fs.unlinkSync(request);}catch{}
      }
    }
  };
}
module.exports={state,ready,createHooks};
