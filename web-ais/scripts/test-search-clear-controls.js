"use strict";

// Run normally for source checks, or with --serve for isolated real-DOM browser checks.
// The fixture uses production code/CSS and never connects to the application database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const start = source.indexOf("  function initializeSearchClearControls() {");
const end = source.indexOf("  function enhanceCopyableFields() {", start);
assert.ok(start >= 0 && end > start);
const implementation = source.slice(start, end);
assert.match(source, /async function initializeApplication\(\) \{\s*initializeSearchClearControls\(\);/u);
for (const host of ["search-box", "student-list-program-search", "document-template-email-marker-search"]) {
  assert.ok(implementation.includes(`.${host} > input`));
}
assert.match(implementation, /dictionary-search-clear/u);
assert.match(implementation, /new Event\("input", \{ bubbles: true \}\)/u);
console.log("Search clear source checks: OK");

function fixture() {
  return `<!doctype html><html lang="ru"><meta charset="utf-8">
<title>Проверка очистки поиска</title><link rel="stylesheet" href="/styles.css">
<style>body{padding:24px;background:#f5f8f7;overflow:auto}main{max-width:660px}section{margin:12px 0}h1{font-size:21px}.fixture-fields{display:grid;gap:12px}.fixture-fields>label,.fixture-fields>div{width:320px;max-width:100%}#results{white-space:pre-wrap}#temporary{margin-top:12px}</style>
<main><h1>Проверка очистки поиска</h1><p>Изолированная проверка без рабочей базы.</p>
<form id="fixture-form"><div class="fixture-fields">
<label class="search-box"><span>⌕</span><input placeholder="Поиск" value="Длинный поисковый запрос для проверки компоновки"></label>
<div class="student-list-advanced-filters"><label class="student-list-program-search"><span>⌕</span><input type="search" placeholder="Поиск программы" value="Математика"></label></div>
<div class="student-applications-program-filter-panel"><label class="student-list-program-search"><span>⌕</span><input type="search" placeholder="Поиск программы в импорте" value="КПК"></label></div>
<label class="document-template-email-marker-search"><span>⌕</span><input type="search" placeholder="Найти поле" value="Фамилия"></label>
<div class="direct-expense-note-filter"><div class="search-box combo-input-wrap"><span>⌕</span><input placeholder="Примечание" value="Оплата"><button class="direct-expense-note-filter-toggle" type="button" aria-label="Показать список примечаний">⌄</button></div></div>
<div class="search-box dictionary-search"><span>⌕</span><input type="search" placeholder="Поиск по настройкам" value="Почта"><button class="dictionary-search-clear" type="button" aria-label="Сбросить поиск по настройкам">×</button></div>
<label class="search-box"><span>⌕</span><input placeholder="Пустой поиск"></label>
<label class="search-box"><span>⌕</span><input placeholder="Недоступный поиск" value="Нельзя менять" disabled></label>
<label class="search-box"><span>⌕</span><input placeholder="Только чтение" value="Нельзя менять" readonly></label>
<label>Обычное поле без лупы <input placeholder="Обычное поле" value="Не поиск"></label>
</div></form><section><button id="run" type="button">Запустить проверки</button></section>
<div id="results" role="status">Проверки ещё не запущены.</div><div id="temporary"></div></main>
<script>${implementation}
initializeSearchClearControls();
document.querySelector('#fixture-form').addEventListener('submit', event => {event.preventDefault(); document.querySelector('#results').textContent='ОШИБКА: отправлена форма';});
document.querySelector('.dictionary-search-clear').onclick = () => {const input=document.querySelector('.dictionary-search input'); input.value=''; input.focus();};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
document.querySelector('#run').onclick = async () => {
  let passed=0; const output=document.querySelector('#results');
  const check=(condition,label)=>{if(!condition)throw new Error(label);passed++;};
  try {
    check(document.querySelectorAll('.search-clear-button').length===8,'Ровно один крестик на каждый подходящий поиск');
    check(!document.querySelector('.dictionary-search .search-clear-button'),'Нет второго крестика в настройках');
    check(!document.querySelector('[placeholder="Обычное поле"]').parentElement.querySelector('button'),'Обычное поле не меняется');
    for(const placeholder of ['Пустой поиск','Недоступный поиск','Только чтение']) {
      check(document.querySelector('[placeholder="'+placeholder+'"]').nextElementSibling.hidden,'Скрыт крестик: '+placeholder);
    }
    const disabled=document.querySelector('[placeholder="Недоступный поиск"]');
    disabled.disabled=false; await tick();
    check(!disabled.nextElementSibling.hidden,'Крестик появляется после включения поля');
    disabled.disabled=true; await tick();
    check(disabled.nextElementSibling.hidden,'Крестик скрывается после отключения поля');
    const empty=document.querySelector('[placeholder="Пустой поиск"]');
    empty.value='  ';empty.dispatchEvent(new Event('input',{bubbles:true}));
    check(!empty.nextElementSibling.hidden,'Пробелы можно очистить');
    empty.nextElementSibling.click();
    check(empty.value===''&&empty.nextElementSibling.hidden,'Очистка пробелов');
    for(const input of document.querySelectorAll('.fixture-fields input')) {
      const button=input.parentElement.querySelector('.search-clear-button');
      if(!button||button.hidden)continue;
      const r=input.getBoundingClientRect(), b=button.getBoundingClientRect();
      check(b.left>=r.right-0.5&&Math.abs((b.top+b.height/2)-(r.top+r.height/2))<3,'Крестик справа, не перекрывает текст: '+input.placeholder);
      const toggle=input.parentElement.querySelector('.direct-expense-note-filter-toggle');
      if(toggle)check(toggle.getBoundingClientRect().left>=b.right-0.5,'Крестик не перекрывает стрелку списка');
      let updates=0;input.addEventListener('input',()=>updates++);
      button.click();
      check(input.value===''&&updates===1&&button.hidden,'Очистка и одно обновление: '+input.placeholder);
      check(document.activeElement===input,'Фокус возвращён: '+input.placeholder);
      input.value='Повторный запрос';input.dispatchEvent(new Event('input',{bubbles:true}));
      check(!button.hidden,'Крестик появляется при повторном вводе');
    }
    const temp=document.querySelector('#temporary');
    temp.innerHTML='<label class="search-box"><span>⌕</span><input value="Динамический поиск" placeholder="В новом окне"></label>';
    await tick();
    let dynamic=temp.querySelector('input');
    check(!!dynamic.nextElementSibling,'Новое окно получает крестик');
    dynamic.replaceWith(Object.assign(document.createElement('input'),{value:'Замена поля'}));
    await tick();dynamic=temp.querySelector('input');
    check(temp.querySelectorAll('button').length===1,'Замена поля не дублирует крестик');
    dynamic.nextElementSibling.click();
    check(dynamic.value==='','Кнопка работает с заменённым полем');
    const rerender=()=>{temp.innerHTML='<label class="search-box"><span>⌕</span><input value="" placeholder="После перерисовки"></label>';temp.querySelector('input').focus();};
    dynamic.value='Рендер';dynamic.dispatchEvent(new Event('input',{bubbles:true}));
    dynamic.addEventListener('input',rerender,{once:true});dynamic.nextElementSibling.click();await tick();
    check(temp.querySelector('button').hidden&&document.activeElement===temp.querySelector('input'),'Перерисовка сохраняет фокус и скрывает крестик');
    temp.replaceChildren();
    output.textContent='УСПЕШНО: '+passed+' проверок. Очистка, обновление, фокус, динамические окна и компоновка.';
  } catch(error) {output.textContent='ОШИБКА после '+passed+' проверок: '+error.message;}
};
</script></html>`;
}

if (process.argv.includes("--serve")) {
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/styles.css") {
      response.setHeader("Content-Type", "text/css; charset=utf-8");
      return response.end(fs.readFileSync(path.join(root, "styles.css")));
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(fixture());
  });
  server.listen(0, "127.0.0.1", () => console.log(`Search clear fixture: http://127.0.0.1:${server.address().port}/`));
}
