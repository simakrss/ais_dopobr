"use strict";
// Isolated browser fixture: never installs files or calls production services.
const fs=require("node:fs"),path=require("node:path"),http=require("node:http");
let state={protocol:1,phase:"idle",version:"1.0.0",build:"fixture-old"},lastReady=null;
const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith("/local-update-client.js")){res.setHeader("Content-Type","text/javascript");return res.end(fs.readFileSync(path.join(__dirname,"../local-update-client.js")));}
  if(req.url==="/api/local-update/status"){
    let body="";for await(const chunk of req)body+=chunk;
    if(body){const data=JSON.parse(body);lastReady=data.ready;
      if(data.updateNow){
        if(!lastReady||data.warningId!==state.warningId){res.statusCode=409;res.setHeader("Content-Type","application/json");return res.end(JSON.stringify({error:"Окно не готово к обновлению."}));}
        state={...state,phase:"installing",label:"Тест: обновление запущено кнопкой",completed:1,total:23,updateNowAccepted:true};
      }
    }
    res.setHeader("Content-Type","application/json");return res.end(JSON.stringify(state));
  }
  if(req.url.startsWith("/fixture/")){
    const mode=req.url.slice(9);
    const phases={warning:{phase:"warning",label:"Система будет временно заблокирована для обновления",seconds:30},waiting:{phase:"waiting",label:"Обновление ожидает закрытия карточек и завершения операций."},install:{phase:"installing",label:"Установка файлов программы",completed:3,total:23},restart:{phase:"restarting",label:"Перезапуск и проверка локальной системы"},error:{phase:"error",label:"Подпись обновления не подтверждена. Работа продолжается."},complete:{phase:"complete",label:"Обновление установлено",build:"fixture-new"}};
    if(phases[mode])state={...state,...phases[mode],targetVersion:"1.0.1",canUpdateNow:mode==="warning",warningId:require("node:crypto").randomUUID(),updateNowAccepted:false};
    res.setHeader("Content-Type","application/json");return res.end(JSON.stringify({ok:true,lastReady}));
  }
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.end(`<!doctype html><html lang="ru"><title>Тест обновления системы</title><body style="font:16px Segoe UI;padding:30px;background:#edf4ef"><h1>Тестовая система</h1><p>Данные изолированы от рабочей базы.</p><button id="card">Открыть карточку</button><button id="save">Сохранить и закрыть карточку</button><div id="host"></div><p id="ready"></p><div>${["warning","waiting","install","restart","error","complete"].map(mode=>`<button data-phase="${mode}">${mode}</button>`).join(" ")}</div><script>document.querySelector('#card').onclick=()=>document.querySelector('#host').innerHTML='<form id="recordForm"><label>Примечание <textarea>Несохранённый текст</textarea></label></form>';document.querySelector('#save').onclick=()=>document.querySelector('#host').replaceChildren();document.querySelectorAll('[data-phase]').forEach(button=>button.onclick=async()=>{const data=await(await fetch('/fixture/'+button.dataset.phase)).json();document.querySelector('#ready').textContent='Готовность окна: '+data.lastReady;});</script><script src="local-update-client.js?v=${state.phase==="complete"?"fixture-new":"fixture-old"}" defer></script></body></html>`);
});
server.listen(0,"127.0.0.1",()=>console.log(`Update UI fixture: http://127.0.0.1:${server.address().port}/`));
