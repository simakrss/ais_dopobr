"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const helpers = source.slice(source.indexOf("  function updateProgramPromoText("), source.indexOf("  async function openProgramSiteSync("));
const context = {}; vm.createContext(context); vm.runInContext(helpers, context);
const update = context.updateProgramPromoText;
const program = {type:"ПРО",price:890,webinarDate:"2026-09-25",webinarTime:"19:30"};
const original = "Приглашаем Вас на вебинар!\n📅 Дата 22 сентября 2026 года в 18.00 мск\n💰 Цена участия: 390 руб.! По окончании выдается сертификат\n✍ Запись https://edu-plus.ru/web_vak\nАвтор окончил вуз 04.08.2020. Стаж 20 лет. Телефон +79991234567";
const expected = original.replace("22 сентября", "25 сентября").replace("18.00", "19.30").replace("390 руб.", "890 руб.");
assert.equal(update(original,program),expected);
assert.equal(update(expected,program),expected,"Repeated sync must be idempotent");
for(const type of ["ДОП","ППП","КПК"]) assert.equal(update(original,{...program,type}),original.replace("390 руб.","890 руб."));
assert.equal(update("Дата и время: 28 апреля 2025 года (понедельник) в 17.00 мск\nЦена участия: бесплатно",program),"Дата и время: 25 сентября 2026 года (пятница) в 19.30 мск\nЦена участия: 890 руб.");
assert.equal(update("Расписание трансляции — 04.08.2026 в 18:00\nВремя начала: 18.00",program),"Расписание трансляции — 25.09.2026 в 19:30\nВремя начала: 19.30");
assert.equal(update("Начало вебинара: 2026-08-04 в 18:00. Дата: 4/8/2026",program),"Начало вебинара: 2026-09-25 в 19:30. Дата: 25/9/2026");
assert.equal(update("Старая цена: 1000 руб. Цена участия: 390 ₽. Обычная стоимость: 1500 руб.",program),"Старая цена: 1000 руб. Цена участия: 890 ₽. Обычная стоимость: 1500 руб.");
assert.equal(update("Стоимость обучения: 3 900,50 руб.",{...program,price:8000.75}),"Стоимость обучения: 8 000,75 руб.");
assert.equal(update("Цена: 390 руб.",{...program,price:0}),"Цена: 0 руб.");
assert.equal(update("Стоимость: 15 % от проекта",program),"Стоимость: 15 % от проекта");
assert.equal(update("Стоимость участия: бесплатно",{...program,price:0}),"Стоимость участия: бесплатно");
const rich = '<p>Дата: <b>22</b>&nbsp;сентября <i>2026</i> года в <strong>18</strong>.00</p><p>Цена: <b>3&nbsp;900</b> руб.</p><a href="https://example.test/2026-08-04?q=390" title="Цена: 390">ссылка</a><!-- Дата: 22.09.2026 --><script>Цена: 390</script>';
assert.equal(update(rich,{...program,price:8000}),rich.replace('<b>22</b>','<b>25</b>').replace('<strong>18</strong>.00','<strong>19</strong>.30').replace('<b>3&nbsp;900</b>','<b>8&nbsp;000</b>'));
assert.equal(update("Цена: <b>3</b> <em>900</em> руб.",{...program,price:10000}),"Цена: <b>10</b> <em>000</em> руб.");
assert.equal(update("Стаж с 01.02.2020. Скидка 15%. Курс 300 ч. https://example.test/2026-08-04. Дата рождения: 01.02.2020",program),"Стаж с 01.02.2020. Скидка 15%. Курс 300 ч. https://example.test/2026-08-04. Дата рождения: 01.02.2020");
assert.equal(update("Дата: 31.02.2026; Цена: 390 руб.",{...program,webinarDate:"2026-02-31",webinarTime:"invalid",price:""}),"Дата: 31.02.2026; Цена: 390 руб.");
assert.equal(update("Дата: 22.09.2026",{...program,webinarDate:"25.09.2026"}),"Дата: 25.09.2026");
assert.equal(update("",program),"");assert.equal(update(undefined,program),undefined);
assert.deepEqual(JSON.parse(JSON.stringify(context.getProgramPromoSyncFields({promoMessage1:original,promoMessage2:"Стоимость: 390 руб."},program))),{promoMessage1:expected,promoMessage2:"Стоимость: 890 руб."});

const start=source.indexOf("    apply.addEventListener(\"click\", async () => {",source.indexOf("  async function openProgramSiteSync("));
const end=source.indexOf('    dialog.querySelector("[data-sync-refresh]")',start);
assert.ok(start>0&&end>start);
async function integration(options={}) {
  const current={...program,id:"p",promoMessage1:original,promoMessage2:"Цена: 390 руб.",name:"Название",...(options.staleDate?{webinarDate:"2026-09-26"}:{})};
  const baseline=[{name:"promoMessage1",value:original},{name:"promoMessage2",value:current.promoMessage2},{name:"name",value:"Название"}];
  const card={elements:{},dataset:{initialSnapshot:JSON.stringify(baseline)},querySelector:()=>null};
  for(const item of baseline)card.elements[item.name]={value:item.value,dispatchEvent(){}};
  card.elements.name.value="Несохранённое название";
  let click; const saved=[]; const status={textContent:""};
  const ctx={Event,current,card,status,programId:"p",busy:false,plan:{hash:"h",product:{id:1}},promoParameters:program,
    state:{data:{collections:{programs:[current]}}},apply:{addEventListener:(name,fn)=>{click=fn;}},setBusy:()=>{},
    imagePicker:{value:()=>0},ensureRecordLockForSave:async()=>true,
    programSiteRequest:async()=>{if(options.siteFailure)throw Error("Сбой синхронизации");return {ok:true,type:"ПРО",landing:{url:"https://example.test/"}};},
    persist:()=>saved.push(structuredClone(current)),flushSharedApplicationState:async()=>!options.flushFailure,
    refreshProgramSiteLinks:()=>{}
  };
  vm.createContext(ctx);vm.runInContext(helpers+source.slice(start,end),ctx);await click();
  if(options.siteFailure||options.staleDate){assert.equal(saved.length,0);assert.equal(current.promoMessage1,original);if(options.staleDate)assert.match(status.textContent,/изменились/);return;}
  assert.equal(current.promoMessage1,expected);assert.equal(current.promoMessage2,"Цена: 890 руб.");
  assert.equal(saved[0].promoMessage1Touched,true);assert.equal(saved[0].promoMessage2Touched,true);
  assert.equal(card.elements.promoMessage1.value,expected);assert.equal(card.elements.name.value,"Несохранённое название");
  const snapshot=JSON.parse(card.dataset.initialSnapshot);
  assert.equal(snapshot[0].value,options.flushFailure?original:expected);assert.equal(snapshot[2].value,"Название");
  assert.match(status.textContent,options.flushFailure?/пока не сохранены/:/Промосообщения актуализированы/);
}
(async()=>{await integration();await integration({siteFailure:true});await integration({flushFailure:true});await integration({staleDate:true});console.log("PASS: both promo messages, price/date/time, free/zero prices, weekdays, rich text/URLs, non-webinars, retries, successful-only sync, shared save and card drafts");})().catch(error=>{console.error(error);process.exitCode=1;});
