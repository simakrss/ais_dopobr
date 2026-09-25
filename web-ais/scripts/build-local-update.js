"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),cp=require("node:child_process");
const root=path.resolve(__dirname,".."), repo=path.dirname(root), update=require("../local-update");
const keyFile=path.join(process.env.LOCALAPPDATA||require("node:os").homedir(),"AisDopobrPublisher","local-update-signing-private.pem");
if(process.argv.includes("--init-signing-key")) {
  if(!fs.existsSync(keyFile)){
    fs.mkdirSync(path.dirname(keyFile),{recursive:true});
    const keys=crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(keyFile,keys.privateKey.export({type:"pkcs8",format:"pem"}),{flag:"wx",mode:0o600});
  }
  console.log(crypto.createPublicKey(fs.readFileSync(keyFile)).export({format:"der",type:"spki"}).toString("base64"));
  process.exit(0);
}
if(!fs.existsSync(keyFile)){console.log("SKIP: на этом компьютере нет ключа публикации обновлений.");process.exit(0);}
const git=(...args)=>cp.execFileSync("git",["-C",repo,...args],{encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"]}).trim();
const allPaths=[...update.FILES,...update.COMPONENTS];
const files=allPaths.map(name=>"web-ais/"+name);
if(git("diff","HEAD","--name-only","--",...files))throw Error("Пакет не опубликован: в файлах программы есть незакоммиченные изменения.");
for(const name of files)if(!git("ls-files","--",name))throw Error("Непроверенный файл пакета: "+name);
const key=crypto.createPrivateKey(fs.readFileSync(keyFile));
if(crypto.createPublicKey(key).export({format:"der",type:"spki"}).toString("base64")!==update.PUBLIC_KEY)throw Error("Ключ подписи не соответствует доверенному ключу программы.");
const out=path.join(root,"updates");fs.mkdirSync(path.join(out,"files"),{recursive:true});
const build=fs.readFileSync(path.join(root,"index.html"),"utf8").match(/const build = "([a-z0-9-]+)"/)[1];
const release={protocol:1,version:update.version(root),build,commit:git("rev-parse","HEAD"),createdAt:new Date().toISOString(),files:[],components:[]};
for(const name of allPaths){
  const bytes=fs.readFileSync(update.safeTarget(root,name)),sha256=update.hash(bytes);
  (update.FILES.includes(name)?release.files:release.components).push({path:name,sha256,size:bytes.length});
  const target=path.join(out,"files",sha256+".bin");
  if(!fs.existsSync(target))fs.writeFileSync(target,bytes,{flag:"wx"});
  else if(update.hash(fs.readFileSync(target))!==sha256)throw Error("Повреждён пакет публикации.");
}
const previous=update.readJson(path.join(out,"latest.json"));
if(previous){
  const old=update.validateEnvelope(previous);
  if(update.compareVersions(release.version,old.version)<0)throw Error("Публикация более старой версии запрещена.");
  if(release.version===old.version){
    if(JSON.stringify(update.releaseFiles(release))!==JSON.stringify(update.releaseFiles(old))||release.build!==old.build)throw Error("Изменённые файлы требуют повышения версии приложения.");
    console.log("READY: "+old.version);process.exit(0);
  }
}
const payload=Buffer.from(JSON.stringify(release));
const envelope={payload:payload.toString("base64"),signature:crypto.sign(null,payload,key).toString("base64")};
update.validateEnvelope(envelope);
update.atomicJson(path.join(out,"latest.json"),envelope);
console.log("READY: "+release.version+", файлов: "+update.releaseFiles(release).length);
