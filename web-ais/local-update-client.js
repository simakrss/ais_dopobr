(() => {
  "use strict";
  if (["edu-plus.ru","www.edu-plus.ru"].includes(location.hostname)) return;
  const endpoint = new URL("api/local-update/status", document.baseURI).href;
  const id = crypto.randomUUID();
  const build = new URL(document.currentScript.src).searchParams.get("v");
  let panel, label, bar, clock, updateButton, updateNotice, latestState, details, detailsText, indicator;
  let panelOpen = false, lastWarning = "", lastError = "", updatePending = false, requestedAction = "", requestedAt = 0, updateError = "";
  let inFlight = false, supported = true, blocked = false, started = 0, completed = "";
  function ready() {
    const detail = {busy:false};
    window.dispatchEvent(new CustomEvent("ais-local-update-readiness", {detail}));
    return !detail.busy && !document.querySelector("#recordForm, dialog[open]:not([data-local-update]), [data-document-editor-dialog]");
  }
  function closePanel() { if(panel?.open)panel.close(); panel?.remove(); panel=null; blocked=false; }
  function clearNotification() { closePanel(); indicator?.remove(); indicator=null; panelOpen=false; started=0; }
  function hideMessage() {
    if(blocked)return;
    panelOpen=false;closePanel();indicator?.setAttribute("aria-expanded","false");indicator?.focus({preventScroll:true});
  }
  function friendlyMessage(value) {
    const text=String(value||"");
    return /\b(?:EPERM|EACCES|EBUSY)\b/.test(text)
      ? "Файл обновления временно занят или недоступен. Система повторит попытку автоматически. Можно продолжать работу или нажать «Применить»."
      : text;
  }
  function ensureIndicator(state) {
    if(!indicator) {
      indicator=document.createElement("button");indicator.type="button";indicator.dataset.localUpdateWarning="";indicator.textContent="!";
      indicator.style.cssText="position:fixed;bottom:14px;right:14px;z-index:2147483646;width:40px;height:40px;border:2px solid #b77b13;border-radius:50%;background:#fff4d5;color:#805000;box-shadow:0 3px 14px #0003;font:700 24px Segoe UI,Arial;cursor:pointer";
      indicator.addEventListener("click",()=>{
        panelOpen=!panelOpen;render(latestState);
        if(panelOpen)panel?.querySelector("[data-close-local-update]")?.focus({preventScroll:true});
      });
      document.body.appendChild(indicator);
    }
    const title=state.phase==="error"?"Предупреждение об обновлении — открыть сообщение":"Обновление системы — открыть сообщение";
    indicator.title=title;indicator.setAttribute("aria-label",title);indicator.setAttribute("aria-expanded",String(panelOpen));
  }
  function render(state) {
    if(build === "maintenance" && state.phase === "error") {location.reload();return;}
    const active = ["downloading","waiting","warning","draining","installing","restarting","rollback","recovery-error","error"].includes(state.phase);
    const nextBlocked = ["draining","installing","restarting","rollback","recovery-error"].includes(state.phase);
    if(["idle","complete"].includes(state.phase) && state.build && state.build !== build && completed !== state.build) {
      if(ready()) {completed=state.build;location.reload();return;}
      state={...state,phase:"waiting",label:"Обновление установлено. Завершите работу с открытой карточкой — затем интерфейс перезагрузится."};
    } else if(!active) {latestState=state;clearNotification();return;}
    // Errors and background progress stay behind the badge. Warn before installation once.
    const errorKey=state.errorId||state.label;
    if(state.phase==="error" && errorKey!==lastError){lastError=errorKey;panelOpen=false;updateError="";}
    const warningKey=state.targetVersion||state.warningId;
    if(state.phase==="warning" && warningKey!==lastWarning){lastWarning=warningKey;panelOpen=true;updateError="";}
    latestState=state;
    if(nextBlocked){indicator?.remove();indicator=null;}else ensureIndicator(state);
    if(!nextBlocked && !panelOpen){closePanel();return;}
    if(!panel || blocked !== nextBlocked) {
      closePanel(); blocked=nextBlocked;
      panel=document.createElement(blocked?"dialog":"aside");panel.dataset.localUpdate="";
      panel.setAttribute("aria-label","Обновление системы");
      panel.style.cssText=blocked
        ? "border:1px solid #c8d9d5;border-top:5px solid #0b7e78;border-radius:14px;padding:28px;max-width:520px;width:calc(100% - 48px);font:15px Segoe UI,Arial;background:#fff;color:#243430;box-shadow:0 20px 90px #0006"
        : "position:fixed;bottom:64px;right:14px;z-index:2147483646;box-sizing:border-box;width:440px;max-width:calc(100vw - 28px);max-height:calc(100vh - 90px);overflow:auto;padding:14px 18px;border:1px solid #b8d4ce;border-left:5px solid #0b7e78;border-radius:10px;background:#f4fbf9;color:#243430;box-shadow:0 6px 25px #0002;font:14px Segoe UI,Arial";
      const header=document.createElement("div");header.style.cssText="display:flex;align-items:center;justify-content:space-between;gap:12px";
      const title=document.createElement("strong");title.textContent=blocked?"Выполняется обновление системы":"Обновление системы";
      header.append(title);
      label=document.createElement("p");label.setAttribute("role","status");label.setAttribute("aria-live","polite");label.style.margin="8px 0";
      bar=document.createElement("progress");bar.setAttribute("aria-label","Ход обновления");bar.style.cssText="display:block;width:100%;accent-color:#0b7e78";
      clock=document.createElement("small");clock.style.display="block";
      details=document.createElement("details");details.style.cssText="margin-top:8px;font-size:12px;overflow-wrap:anywhere";
      const summary=document.createElement("summary");summary.textContent="Технические сведения";summary.style.cursor="pointer";
      detailsText=document.createElement("p");details.append(summary,detailsText);
      const actions=document.createElement("div");actions.style.cssText="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap";
      if(!blocked){
        const closeButton=document.createElement("button");closeButton.type="button";closeButton.textContent="×";closeButton.dataset.closeLocalUpdate="";
        closeButton.setAttribute("aria-label","Закрыть сообщение об обновлении");
        closeButton.title="Скрыть сообщение; автоматические повторы продолжатся";
        closeButton.style.cssText="flex:0 0 30px;width:30px;height:30px;padding:0;border:1px solid #b8d4ce;border-radius:7px;background:#fff;color:#243430;font:22px/1 Segoe UI,Arial;cursor:pointer";
        closeButton.addEventListener("click",hideMessage);header.append(closeButton);
      }
      updateButton=document.createElement("button");updateButton.type="button";updateButton.textContent="Обновить сейчас";
      updateButton.style.cssText="display:block;padding:8px 14px;border:0;border-radius:7px;background:#0b7e78;color:#fff;font:600 14px Segoe UI,Arial;cursor:pointer";
      updateButton.addEventListener("click",updateNow);
      actions.append(updateButton);
      updateNotice=document.createElement("small");updateNotice.setAttribute("role","alert");updateNotice.style.cssText="display:block;margin-top:8px;color:#a22b25";
      panel.append(header,label,bar,clock,details,actions,updateNotice);document.body.appendChild(panel);
      if(blocked){panel.addEventListener("cancel",event=>event.preventDefault());panel.showModal();}
      if(!started)started=Date.now();
    }
    label.textContent=friendlyMessage(state.label)+(state.phase==="warning"?` · через ${state.seconds} сек.`:"");
    const technical=state.errorDetails||(friendlyMessage(state.label)!==state.label?state.label:"");
    details.hidden=!technical;detailsText.textContent=technical;
    bar.hidden=["waiting","warning","error","recovery-error"].includes(state.phase);
    bar.style.display=bar.hidden?"none":"block";
    if(["downloading","installing"].includes(state.phase)&&state.total>0){bar.max=state.total;bar.value=state.completed||0;}else bar.removeAttribute("value");
    const seconds=Math.floor((Date.now()-started)/1000);
    clock.textContent=(state.targetVersion?`Версия ${state.targetVersion} · `:"")
      +(state.phase==="error"&&state.retryAt?`Повторная проверка автоматически через ${Math.max(0,Math.ceil((state.retryAt-Date.now())/1000))} сек.`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`)+(blocked?" · Не закрывайте систему":"");
    const retry=state.phase==="error",actionKey=retry?`retry:${state.errorId}`:`warning:${state.warningId}`;
    updateButton.hidden=!((retry&&state.canRetry!==false)||(state.phase==="warning"&&state.canUpdateNow===true));
    updateButton.style.display=updateButton.hidden?"none":"block";
    updateButton.disabled=updatePending || (requestedAction===actionKey && Date.now()-requestedAt<15000);
    updateButton.style.opacity=updateButton.disabled?"0.65":"1";
    updateButton.style.cursor=updateButton.disabled?"wait":"pointer";
    updateButton.textContent=updateButton.disabled?"Запрос принят…":retry?"Применить":"Обновить сейчас";
    updateButton.title=retry?"Повторно проверить и безопасно применить обновление":"Начать обновление без ожидания таймера";
    updateNotice.textContent=blocked?"":friendlyMessage(updateError);
    updateNotice.style.display=updateNotice.textContent?"block":"none";
  }
  async function updateNow() {
    const retry=latestState?.phase==="error",actionKey=retry?`retry:${latestState.errorId}`:`warning:${latestState?.warningId}`;
    if(updatePending || (requestedAction===actionKey&&Date.now()-requestedAt<15000)
      || !(retry?latestState.canRetry!==false:latestState?.phase==="warning"&&latestState.canUpdateNow))return;
    if(!ready()){updateError="Сначала сохраните и закройте открытую карточку, завершите текущие операции.";render(latestState);void poll();return;}
    if(retry&&!latestState.errorId){
      updateError="Служба обновлений ещё использует прежнюю версию. Сохраните работу и перезапустите систему штатным способом. Автоматические проверки также продолжатся.";
      render(latestState);return;
    }
    const requested={...latestState};updatePending=true;updateError="";render(latestState);
    try {
      const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id,ready:true,...(retry?{retryUpdate:true,errorId:requested.errorId}:{updateNow:true,warningId:requested.warningId,targetVersion:requested.targetVersion})}),signal:AbortSignal.timeout(5000)});
      const state=await response.json().catch(()=>({}));
      if(!response.ok || state.protocol!==1 || !(retry?state.retryAccepted===true:state.updateNowAccepted===true))throw Error(state.error || "Не удалось применить запрос. Автоматические проверки продолжатся.");
      requestedAction=actionKey;requestedAt=Date.now();latestState=state;
    } catch(error){updateError=error.name==="TimeoutError"?"Ответ не получен. Проверяем состояние обновления…"
      : error.name==="TypeError"?"Нет соединения со службой обновления. Проверяем состояние…":error.message;}
    finally{updatePending=false;render(latestState);void poll();}
  }
  async function poll() {
    if(inFlight||updatePending||!supported)return;inFlight=true;
    try {
      const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,ready:ready()}),signal:AbortSignal.timeout(5000)});
      if(response.status===404||response.status===405){supported=false;clearNotification();return;}
      if(!response.ok)return;
      const state=await response.json();if(state.protocol!==1){supported=false;clearNotification();return;}
      if(!updatePending)render(state);
    } catch {if(blocked&&label)label.textContent="Система перезапускается. Ожидаем восстановления соединения…";}
    finally{inFlight=false;}
  }
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&panelOpen&&!blocked){event.preventDefault();event.stopImmediatePropagation();hideMessage();}
  },true);
  window.addEventListener("pagehide",()=>{
    if(supported)navigator.sendBeacon(endpoint,new Blob([JSON.stringify({id,release:true})],{type:"application/json"}));
  });
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void poll();});
  setInterval(poll,2000);void poll();
})();
