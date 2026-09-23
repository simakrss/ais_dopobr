"use strict";
// Local installation updater. No credentials, databases, templates or user documents
// belong in the code-path policy. Future signed releases may add code files,
// but never expand the writable scope into configuration/data directories.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const BASE = "https://edu-plus.ru/lms/updates/";
const PUBLIC_KEY = "MCowBQYDK2VwAyEARDRUcPC/vPdxq9MOFlSfwBJUJNEz58fA8Jxhiuz9sCE=";
const FILES = Object.freeze([
  "app.js", "app-server.js", "auth-bootstrap.js", "index.html", "styles.css", "favicon.ico",
  "field-html-links.js", "document-workflow.js", "demo-mode-privacy.js", "local-server.js",
  "local-document-save-dialog.js", "document-relay.js", "local-update.js", "local-update-client.js", "partner-app.js",
  "program-site-generator.js", "program-site-certificates.js", "program-site-progress.js",
  "server-cli.js", "student-import-worker.js", "scripts/start-lan-system.js",
  "scripts/sync-student-database.ps1", "scripts/query-student-applications.ps1",
  "scripts/generate-program-payment-registry.js"
]);
const BLOCKING = new Set(["draining", "installing", "restarting", "rollback", "recovery-error"]);
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hostKey = crypto.createHash("sha256").update(os.hostname().toLowerCase()).digest("hex").slice(0, 16);
const allowedPath = name => typeof name === "string" && (FILES.includes(name) || /^(?:[a-z][a-z0-9-]*\.(?:js|css|html)|scripts\/[a-z][a-z0-9-]*\.(?:js|ps1))$/.test(name));
const runtimeDir = root => path.join(root, ".runtime", "local-updates", hostKey);
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
const FILE_BUSY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const retryPause = new Int32Array(new SharedArrayBuffer(4));
function retryFileOperation(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return operation(); }
    catch (error) {
      if (!FILE_BUSY_CODES.has(error.code) || attempt >= 5) throw error;
      // Windows scanners/sync clients can briefly deny replacement of an open file.
      // Keep the destination intact; never unlink it to work around a sharing violation.
      Atomics.wait(retryPause, 0, 0, 25 * (2 ** attempt));
    }
  }
}
function cleanupTemp(file) {
  try { if (fs.existsSync(file)) retryFileOperation(() => fs.unlinkSync(file)); } catch { /* Never mask the original write error. */ }
}
function updateErrorInfo(error) {
  const details = String(error?.message || error || "Неизвестная ошибка обновления.").slice(0, 800);
  return {
    errorCode: String(error?.code || ""),
    errorDetails: details,
    label: FILE_BUSY_CODES.has(error?.code)
      ? "Файл обновления временно занят или недоступен. Система повторит попытку автоматически. Можно продолжать работу или нажать «Применить»."
      : details.slice(0, 300)
  };
}
function reportBestEffort(report, patch) {
  try { report(patch); }
  catch (error) { console.warn("Не удалось записать состояние обновления: " + updateErrorInfo(error).label); }
}
function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    retryFileOperation(() => fs.renameSync(temp, file));
  } finally { cleanupTemp(temp); }
}
function safeTarget(root, name) {
  if (!allowedPath(name)) throw Error("Недопустимый файл обновления.");
  const base = fs.realpathSync(root), target = path.resolve(base, name);
  if (!target.startsWith(base + path.sep)) throw Error("Файл вне папки программы.");
  let current = base;
  for (const part of name.split("/")) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error("Ссылка в пути обновления запрещена.");
  }
  return target;
}
function version(root) {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const value = source.match(/const APPLICATION_RELEASE = Object\.freeze\(\{\s*version: "(\d+\.\d+\.\d+)"/);
  if (!value) throw Error("Не удалось определить версию локальной системы.");
  return value[1];
}
function build(root) { return fs.readFileSync(path.join(root,"index.html"),"utf8").match(/const build = "([a-z0-9-]+)"/)?.[1] || "unknown"; }
function compareVersions(a, b) {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i=0;i<3;i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function validateEnvelope(envelope, publicKey = PUBLIC_KEY) {
  if (typeof envelope?.payload !== "string" || envelope.payload.length > 200000 || typeof envelope.signature !== "string") throw Error("Некорректное описание обновления.");
  const bytes = Buffer.from(envelope.payload, "base64");
  const key = crypto.createPublicKey({key:Buffer.from(publicKey,"base64"),format:"der",type:"spki"});
  if (!crypto.verify(null, bytes, key, Buffer.from(envelope.signature,"base64"))) throw Error("Подпись обновления не подтверждена.");
  const release = JSON.parse(bytes.toString("utf8"));
  if (release.protocol !== 1 || !/^\d+\.\d+\.\d+$/.test(release.version) || !/^[a-z0-9-]{5,100}$/.test(release.build) || !/^[a-f0-9]{40}$/.test(release.commit)) throw Error("Неподдерживаемое обновление.");
  // Verify historical manifests during publishing too; the relay first ships in 1.7.542.
  const requiredFiles = FILES.filter(name => name !== "document-relay.js" || compareVersions(release.version, "1.7.542") >= 0);
  if (!Array.isArray(release.files) || release.files.length < requiredFiles.length || release.files.length > 200) throw Error("Неполный комплект файлов обновления.");
  const seen = new Set(); let total = 0;
  for (const file of release.files) {
    if (!allowedPath(file.path) || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 32*1024*1024) throw Error("Некорректный состав обновления.");
    seen.add(file.path); total += file.size;
  }
  if (total > 100*1024*1024) throw Error("Слишком большой пакет обновления.");
  if(requiredFiles.some(name=>!seen.has(name)))throw Error("Неполный комплект файлов обновления.");
  return release;
}
async function download(url, maxBytes, fetcher = fetch) {
  const response = await fetcher(url, {redirect:"error",cache:"no-store",signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw Error(`Сайт обновлений вернул HTTP ${response.status}.`);
  if (Number(response.headers.get("content-length")) > maxBytes) throw Error("Превышен размер файла обновления.");
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw Error("Превышен размер файла обновления."); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function readStatus(root) {
  const status = readJson(path.join(runtimeDir(root), "status.json"), {phase:"idle"});
  // A durable journal is deliberately NOT expired: interrupted installs fail closed.
  if (fs.existsSync(path.join(runtimeDir(root), "journal.json")) && !BLOCKING.has(status.phase)) return {...status,phase:"recovery-error",label:"Восстановление прерванного обновления. Перезапустите систему."};
  if (status.phase !== "recovery-error" && BLOCKING.has(status.phase) && Date.now() - Number(status.updatedAt || 0) > 120000 && !fs.existsSync(path.join(runtimeDir(root), "journal.json"))) {
    return {...status, phase:"error", label:"Обновление прервано до установки. Работа продолжается на прежней версии."};
  }
  return status;
}
function writeLease(root, id, ready, release = false) {
  if (!/^[a-f0-9-]{36}$/.test(id || "")) throw Error("Некорректный идентификатор окна.");
  const dir = path.join(runtimeDir(root), "clients"); fs.mkdirSync(dir,{recursive:true});
  const file = path.join(dir, id + ".json");
  if (release) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
  for(const name of fs.readdirSync(dir))if(/^[a-f0-9-]{36}\.json$/.test(name)){
    const old=readJson(path.join(dir,name));if(old && Date.now()-old.seenAt>=120000)fs.unlinkSync(path.join(dir,name));
  }
  if (!fs.existsSync(file) && fs.readdirSync(dir).length >= 200) throw Error("Слишком много окон системы.");
  atomicJson(file, {ready:ready === true, seenAt:Date.now()});
}
function clientsReady(root, now = Date.now()) {
  const dir = path.join(runtimeDir(root), "clients");
  if (!fs.existsSync(dir)) return true;
  for (const name of fs.readdirSync(dir)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const client = readJson(path.join(dir,name));
    if (client && now-client.seenAt < 120000 && client.ready !== true) return false;
  }
  return true;
}
function requestImmediateUpdate(root, request) {
  const state = readStatus(root);
  if (request.ready !== true || !clientsReady(root)) throw Error("Сначала сохраните и закройте карточки во всех окнах системы.");
  if (state.phase !== "warning" || !state.warningId || request.warningId !== state.warningId
    || request.targetVersion !== state.targetVersion || Date.now() - Number(state.updatedAt || 0) > 15000) {
    throw Error("Обратный отсчёт уже изменился. Дождитесь актуального состояния обновления.");
  }
  // A request applies only to this countdown, never to a future ready period.
  atomicJson(path.join(runtimeDir(root), "immediate-request.json"), {
    warningId: state.warningId, targetVersion: state.targetVersion, requestedAt: Date.now()
  });
}
function requestUpdateRetry(root, request) {
  const state = readStatus(root);
  if (request.ready !== true || !clientsReady(root)) throw Error("Сначала сохраните и закройте карточки во всех окнах системы.");
  if (state.phase !== "error" || state.canRetry !== true || !state.errorId || request.errorId !== state.errorId) {
    throw Error("Состояние обновления изменилось. Дождитесь актуального сообщения.");
  }
  atomicJson(path.join(runtimeDir(root), "retry-request.json"), {
    errorId: state.errorId, requestedAt: Date.now()
  });
}
function replaceFile(target, bytes) {
  fs.mkdirSync(path.dirname(target), {recursive:true});
  const temp = target + `.ais-update-${crypto.randomUUID()}`;
  try {
    const fd = fs.openSync(temp,"wx",0o600);
    try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    retryFileOperation(() => fs.renameSync(temp,target));
  } finally { cleanupTemp(temp); }
}
function restore(root) {
  const dir=runtimeDir(root), journal=readJson(path.join(dir,"journal.json"));
  if (!journal) return false;
  if (!Array.isArray(journal.files)) throw Error("Повреждён журнал восстановления.");
  for (const item of [...journal.files].reverse()) {
    const target=safeTarget(root,item.path), current=fs.existsSync(target)?hash(fs.readFileSync(target)):null;
    if (current === item.before) continue;
    if (current !== item.after) throw Error("Файл изменён вне обновления. Автоматическая перезапись остановлена: " + item.path);
    if (item.before === null) fs.unlinkSync(target);
    else {
      if (!/^[a-f0-9]{64}$/.test(item.before)) throw Error("Некорректная резервная копия.");
      const backup=fs.readFileSync(path.join(dir,"backups",item.before));
      if(hash(backup)!==item.before)throw Error("Повреждена резервная копия.");
      replaceFile(target,backup);
    }
  }
  fs.unlinkSync(path.join(dir,"journal.json")); return true;
}
async function install(root, release, stage, hooks) {
  const dir=runtimeDir(root), journal={version:release.version,files:[]};
  const lock=path.join(root,".runtime","local-update-install.lock");
  fs.mkdirSync(path.dirname(lock),{recursive:true});
  try { fs.mkdirSync(lock); } catch { throw Error("Другой экземпляр обновляет эту папку. Повторная проверка будет позже."); }
  try {
    atomicJson(path.join(lock,"owner.json"),{host:hostKey,pid:process.pid});
    if(fs.existsSync(path.join(dir,"journal.json")))throw Error("Сначала восстановите прерванное обновление.");
    fs.mkdirSync(path.join(dir,"backups"),{recursive:true});
    for(const file of release.files) {
      const target=safeTarget(root,file.path), bytes=fs.readFileSync(path.join(stage,file.sha256));
      if(bytes.length!==file.size||hash(bytes)!==file.sha256)throw Error("Не совпала контрольная сумма: "+file.path);
      if(file.path.endsWith(".js"))new (require("node:vm").Script)(bytes.toString("utf8"),{filename:file.path});
      const old=fs.existsSync(target)?fs.readFileSync(target):null, before=old?hash(old):null;
      if(before===file.sha256)continue;
      if(old)replaceFile(path.join(dir,"backups",before),old);
      journal.files.push({path:file.path,before,after:file.sha256});
    }
    atomicJson(path.join(dir,"journal.json"),journal);
    let completed=0;
    for(const item of journal.files) {
      const target=safeTarget(root,item.path), before=fs.existsSync(target)?hash(fs.readFileSync(target)):null;
      if(before!==item.before)throw Error("Файл изменён во время обновления: "+item.path);
      replaceFile(target,fs.readFileSync(path.join(stage,item.after)));
      hooks.report({phase:"installing",label:"Установка файлов программы",completed:++completed,total:journal.files.length});
    }
    hooks.report({phase:"restarting",label:"Перезапуск и проверка локальной системы"});
    await hooks.restart();
    if(version(root)!==release.version)throw Error("Новая версия не подтверждена.");
    atomicJson(path.join(dir,"installed.json"),{version:release.version,commit:release.commit});
    fs.unlinkSync(path.join(dir,"journal.json"));
  } catch(error) {
    if(fs.existsSync(path.join(dir,"journal.json"))) {
      reportBestEffort(hooks.report,{phase:"rollback",label:"Восстановление предыдущей версии"});
      try { restore(root); await hooks.restart(); }
      catch { reportBestEffort(hooks.report,{phase:"recovery-error",label:"Не удалось восстановить запуск. Работа заблокирована; требуется перезапуск или восстановление из резервной копии."}); throw Error("Ошибка восстановления после обновления."); }
    }
    throw error;
  } finally {
    // Only our empty lock directory; never a recursive deletion or a caller-supplied path.
    if(fs.existsSync(path.join(lock,"owner.json")))retryFileOperation(()=>fs.unlinkSync(path.join(lock,"owner.json")));
    retryFileOperation(()=>fs.rmdirSync(lock));
  }
}
function createUpdater(root, hooks, options={}) {
  const dir=runtimeDir(root), fetcher=options.fetcher||fetch;
  const pollMs=options.pollMs??2000, warningMs=options.warningMs??30000, drainMs=options.drainMs??4000;
  const runningVersion=version(root);
  let running=false, disposed=false, maintenance=false, updated=false, nextCheck=Date.now()+15000, failures=0;
  let state={phase:"idle",version:version(root),build:build(root),label:"Обновления проверяются автоматически"};
  const report=patch=>{
    const phase=patch.phase||state.phase;
    state={...state,...(patch.phase && phase!=="error" ? {errorId:"",errorDetails:"",errorCode:"",retryAt:null} : {}),...patch,
      canUpdateNow:phase==="warning",canRetry:phase==="error"&&!fs.existsSync(path.join(dir,"journal.json")),updatedAt:Date.now()};
    atomicJson(path.join(dir,"status.json"),state);
  };
  const heartbeat=setInterval(()=>{if(running)reportBestEffort(report,{});},5000);heartbeat.unref?.();
  async function check() {
    if(running||disposed)return;
    // A durable recovery journal must never be bypassed by retry or background polling.
    if(state.phase==="recovery-error" || fs.existsSync(path.join(dir,"journal.json")))return;
    const retry=readJson(path.join(dir,"retry-request.json"));
    if(state.phase==="error" && state.errorId && retry?.errorId===state.errorId && retry.requestedAt>=state.updatedAt)nextCheck=0;
    if(Date.now()<nextCheck)return;
    running=true; nextCheck=Date.now()+300000+Math.floor(Math.random()*30000);
    try {
      const bytes=await download(BASE+"latest.json?check="+Date.now(),250000,fetcher);
      const release=validateEnvelope(JSON.parse(bytes.toString("utf8")),options.publicKey||PUBLIC_KEY);
      const local=version(root), installed=readJson(path.join(dir,"installed.json"));
      // A shared/Yandex-synced folder may already contain new files while Node is
      // still executing the previous release. It still needs a coordinated restart.
      if(compareVersions(release.version,runningVersion)<=0 || compareVersions(release.version,local)<0
        || (installed && compareVersions(release.version,installed.version)<0)) {failures=0;report({phase:"idle",version:local,label:"Установлена актуальная версия",checkedAt:Date.now()});return;}
      const stage=path.join(dir,"staging",release.version); fs.mkdirSync(stage,{recursive:true});
      report({phase:"downloading",targetVersion:release.version,label:"Загрузка обновления в фоновом режиме",completed:0,total:release.files.length});
      let completed=0;
      for(const file of release.files) {
        const target=safeTarget(root,file.path), cache=path.join(stage,file.sha256);
        let content=fs.existsSync(cache)?fs.readFileSync(cache):null;
        if(!content||hash(content)!==file.sha256) {
          content=fs.existsSync(target)?fs.readFileSync(target):null;
          if(!content||hash(content)!==file.sha256)content=await download(BASE+"files/"+file.sha256+".bin",file.size,fetcher);
          if(content.length!==file.size||hash(content)!==file.sha256)throw Error("Контрольная сумма обновления не совпала.");
          fs.writeFileSync(cache,content,{mode:0o600});
        }
        report({completed:++completed});
      }
      report({phase:"waiting",label:"Доступно обновление. Закройте карточки и завершите операции; затем установка начнётся автоматически."});
      let readySince=0, warningId="";
      while(!disposed) {
        // Once warned, ordinary background requests must not continually restart
        // the countdown. New unsaved UI work still cancels it; all server work is
        // drained under the maintenance gate before any file can be installed.
        if(clientsReady(root) && (readySince || await hooks.idle())) {
          if(!readySince){readySince=Date.now();warningId=crypto.randomUUID();}
          report({phase:"warning",warningId,label:"Система будет временно заблокирована для обновления",seconds:Math.max(0,Math.ceil((warningMs-(Date.now()-readySince))/1000))});
          const immediate=readJson(path.join(dir,"immediate-request.json"));
          if(Date.now()-readySince>=warningMs || (immediate?.warningId===warningId
            && immediate.targetVersion===release.version && immediate.requestedAt>=readySince))break;
        } else {readySince=0;report({phase:"waiting",label:"Обновление ожидает закрытия карточек и завершения операций."});}
        await wait(pollMs);
      }
      if(disposed)return;
      maintenance=true;
      report({phase:"draining",label:"Подготовка к обновлению. Завершение текущих запросов"});
      await wait(drainMs);
      const deadline=Date.now()+120000;
      while(!(await hooks.idle())) {if(Date.now()>deadline)throw Error("Операции ещё выполняются. Установка отложена.");await wait(2000);}
      // A window may have opened a card during the last countdown tick.
      if(!clientsReady(root))throw Error("Есть незавершённая работа. Установка отложена.");
      report({phase:"installing",label:"Установка обновления",completed:0,total:release.files.length});
      await install(root,release,stage,{...hooks,report});
      updated=true;failures=0;
      report({phase:"complete",version:release.version,build:release.build,label:"Обновление установлено. Перезагрузка интерфейса",completed:release.files.length,total:release.files.length});
    } catch(error) {
      failures++;
      if(FILE_BUSY_CODES.has(error.code) && failures<=3)nextCheck=Date.now()+(options.retryMs??60000);
      if(state.phase!=="recovery-error")reportBestEffort(report,{
        phase:"error",...updateErrorInfo(error),errorId:crypto.randomUUID(),retryAt:nextCheck
      });
    } finally {maintenance=state.phase==="recovery-error";running=false;}
  }
  async function recover() {
    const lock=path.join(root,".runtime","local-update-install.lock"),owner=readJson(path.join(lock,"owner.json"));
    if(owner?.host===hostKey){
      let alive=false;try{process.kill(owner.pid,0);alive=true;}catch{}
      if(!alive||owner.pid===process.pid){fs.unlinkSync(path.join(lock,"owner.json"));fs.rmdirSync(lock);}
    }
    if(!fs.existsSync(path.join(dir,"journal.json"))) {reportBestEffort(report,{phase:"idle"});return;}
    maintenance=true;reportBestEffort(report,{phase:"rollback",label:"Восстановление прерванного обновления"});
    try {restore(root);maintenance=false;reportBestEffort(report,{phase:"error",errorId:crypto.randomUUID(),label:"Предыдущая версия восстановлена после прерванного обновления. Можно повторить обновление.",retryAt:nextCheck});}
    catch(error){reportBestEffort(report,{phase:"recovery-error",label:error.message});throw error;}
  }
  return {check,recover,maintenance:()=>maintenance,didUpdate:()=>updated,dispose(){disposed=true;clearInterval(heartbeat);},checkNow(){nextCheck=0;return check();}};
}
module.exports={BASE,PUBLIC_KEY,FILES,BLOCKING,hash,runtimeDir,readStatus,atomicJson,readJson,safeTarget,version,compareVersions,validateEnvelope,download,writeLease,clientsReady,requestImmediateUpdate,requestUpdateRetry,retryFileOperation,updateErrorInfo,restore,install,createUpdater};
