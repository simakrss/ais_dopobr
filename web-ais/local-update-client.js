(() => {
  "use strict";
  if (["edu-plus.ru","www.edu-plus.ru"].includes(location.hostname)) return;
  const endpoint = new URL("api/local-update/status", document.baseURI).href;
  const id = crypto.randomUUID();
  const build = new URL(document.currentScript.src).searchParams.get("v");
  let panel, label, bar, clock, updateButton, updateNotice, latestState, updatePending = false, requestedWarning = "", updateError = "";
  let inFlight = false, supported = true, blocked = false, started = 0, completed = "";
  function ready() {
    const detail = {busy:false};
    window.dispatchEvent(new CustomEvent("ais-local-update-readiness", {detail}));
    return !detail.busy && !document.querySelector("#recordForm, dialog[open]:not([data-local-update]), [data-document-editor-dialog]");
  }
  function closePanel() { if(panel?.open)panel.close(); panel?.remove(); panel=null; blocked=false; }
  function render(state) {
    if(build === "maintenance" && state.phase === "error") {location.reload();return;}
    const active = ["downloading","waiting","warning","draining","installing","restarting","rollback","recovery-error","error"].includes(state.phase);
    const nextBlocked = ["draining","installing","restarting","rollback","recovery-error"].includes(state.phase);
    if(["idle","complete"].includes(state.phase) && state.build && state.build !== build && completed !== state.build) {
      if(ready()) {completed=state.build;location.reload();return;}
      state={...state,phase:"waiting",label:"Обновление установлено. Завершите работу с открытой карточкой — затем интерфейс перезагрузится."};
    } else if(!active) {closePanel();return;}
    if(state.phase==="warning" && state.warningId!==latestState?.warningId)updateError="";
    latestState=state;
    if(!panel || blocked !== nextBlocked) {
      closePanel(); blocked=nextBlocked;
      panel=document.createElement(blocked?"dialog":"aside");panel.dataset.localUpdate="";
      panel.setAttribute("aria-label","Обновление системы");
      panel.style.cssText=blocked
        ? "border:1px solid #c8d9d5;border-top:5px solid #0b7e78;border-radius:14px;padding:28px;max-width:520px;width:calc(100% - 48px);font:15px Segoe UI,Arial;background:#fff;color:#243430;box-shadow:0 20px 90px #0006"
        : "position:fixed;bottom:14px;right:14px;z-index:2147483646;max-width:440px;padding:14px 18px;border:1px solid #b8d4ce;border-left:5px solid #0b7e78;border-radius:10px;background:#f4fbf9;color:#243430;box-shadow:0 6px 25px #0002;font:14px Segoe UI,Arial";
      const title=document.createElement("strong");title.textContent=blocked?"Выполняется обновление системы":"Обновление системы";
      label=document.createElement("p");label.setAttribute("role","status");label.setAttribute("aria-live","polite");label.style.margin="8px 0";
      bar=document.createElement("progress");bar.setAttribute("aria-label","Ход обновления");bar.style.cssText="display:block;width:100%;accent-color:#0b7e78";
      clock=document.createElement("small");clock.style.display="block";
      updateButton=document.createElement("button");updateButton.type="button";updateButton.textContent="Обновить сейчас";
      updateButton.style.cssText="display:block;margin:10px 0 0 auto;padding:8px 14px;border:0;border-radius:7px;background:#0b7e78;color:#fff;font:600 14px Segoe UI,Arial;cursor:pointer";
      updateButton.addEventListener("click",updateNow);
      updateNotice=document.createElement("small");updateNotice.setAttribute("role","alert");updateNotice.style.cssText="display:block;margin-top:8px;color:#a22b25";
      panel.append(title,label,bar,clock,updateButton,updateNotice);document.body.appendChild(panel);
      if(blocked){panel.addEventListener("cancel",event=>event.preventDefault());panel.showModal();}
      if(!started)started=Date.now();
    }
    label.textContent=state.label+(state.phase==="warning"?` · через ${state.seconds} сек.`:"");
    bar.hidden=["waiting","warning","error","recovery-error"].includes(state.phase);
    bar.style.display=bar.hidden?"none":"block";
    if(["downloading","installing"].includes(state.phase)&&state.total>0){bar.max=state.total;bar.value=state.completed||0;}else bar.removeAttribute("value");
    const seconds=Math.floor((Date.now()-started)/1000);
    clock.textContent=(state.targetVersion?`Версия ${state.targetVersion} · `:"")+`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`+(blocked?" · Не закрывайте систему":"");
    updateButton.hidden=state.phase!=="warning" || state.canUpdateNow!==true;
    updateButton.style.display=updateButton.hidden?"none":"block";
    updateButton.disabled=updatePending || requestedWarning===state.warningId;
    updateButton.style.opacity=updateButton.disabled?"0.65":"1";
    updateButton.style.cursor=updateButton.disabled?"wait":"pointer";
    updateButton.textContent=updateButton.disabled?"Запуск обновления…":"Обновить сейчас";
    updateNotice.textContent=blocked?"":updateError;
    updateNotice.style.display=updateNotice.textContent?"block":"none";
  }
  async function updateNow() {
    if(updatePending || latestState?.phase!=="warning" || !latestState.canUpdateNow || requestedWarning===latestState.warningId)return;
    if(!ready()){updateError="Сначала сохраните и закройте открытую карточку, завершите текущие операции.";render(latestState);void poll();return;}
    const requested={...latestState};updatePending=true;updateError="";render(latestState);
    try {
      const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id,ready:true,updateNow:true,warningId:requested.warningId,targetVersion:requested.targetVersion}),signal:AbortSignal.timeout(5000)});
      const state=await response.json().catch(()=>({}));
      if(!response.ok || state.protocol!==1 || state.updateNowAccepted!==true)throw Error(state.error || "Не удалось запустить обновление сразу. Автоматическое обновление продолжится по таймеру.");
      requestedWarning=requested.warningId;latestState=state;
    } catch(error){updateError=error.name==="TimeoutError"?"Ответ не получен. Проверяем состояние обновления…"
      : error.name==="TypeError"?"Нет соединения со службой обновления. Проверяем состояние…":error.message;}
    finally{updatePending=false;render(latestState);void poll();}
  }
  async function poll() {
    if(inFlight||updatePending||!supported)return;inFlight=true;
    try {
      const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,ready:ready()}),signal:AbortSignal.timeout(5000)});
      if(response.status===404||response.status===405){supported=false;closePanel();return;}
      if(!response.ok)return;
      const state=await response.json();if(state.protocol!==1){supported=false;return;}
      if(!updatePending)render(state);
    } catch {if(blocked&&label)label.textContent="Система перезапускается. Ожидаем восстановления соединения…";}
    finally{inFlight=false;}
  }
  window.addEventListener("pagehide",()=>{
    if(supported)navigator.sendBeacon(endpoint,new Blob([JSON.stringify({id,release:true})],{type:"application/json"}));
  });
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void poll();});
  setInterval(poll,2000);void poll();
})();
