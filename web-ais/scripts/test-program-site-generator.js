"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pg = require("../program-site-generator.js");
const fixture = {id: "test-pro-webinar", type: "ПРО", name: "Тестовый онлайн-семинар", nameEnglish: "Test webinar", hours: 2, price: 390, oldPrice: 1000,
  landingCode: "test_webinar", webinarDate: "2026-09-30", webinarTime: "09:30", webinarJoinUrl: "https://jazz.sber.ru/test?psw=example#join",
  siteDescription: "<p>Программа семинара</p>", siteSpeaker: "<p>Тестовый спикер</p>"};
const template = {id: 42, title: "Прототип", modified: "2026-09-14 09:00:00", fields: {
  podacha_zayavki_nazvanie_kursa: "Прототип", data_starta: "Старая дата", opisanie_dokumenta: "Старое описание",
  tekst_etap_obucheniya_1: "Старый спикер", stoimost_kursa: "200", kolichestvo_chasov: "1",
  blok_ceny: [{stoimost_kursa: "200", staraya_cena: "300", skidka: "33", ssylka_na_registraciyu: "https://zifra-plus.ru/checkout/?add-to-cart=12"}],
  photo: 72, text: '<a href="https://zifra-plus.ru/checkout/?add-to-cart=12">Прототип</a>', opaque: {unrelated: "Сохранить"}
}};
Object.assign(template.fields, {izobrazhenie_vydavaemogo_dokumenta: 11, prevyu_vydavaemogo_dokumenta_1: 11,
  izobrazhenie_vydavaemogo_dokumenta_2: 12, prevyu_vydavaemogo_dokumenta_2: 12});
const certificate = {hash: "d".repeat(64), generate: async () => [{language: "ru", base64: "test"}, {language: "en", base64: "test"}]};
const images = [{id: 81, language: "ru", url: "https://edu-plus.ru/wp-content/uploads/sample-ru.jpg"},
  {id: 82, language: "en", url: "https://edu-plus.ru/wp-content/uploads/sample-en.jpg"}];
const prepare = (program, id, call) => pg.prepare(program, id, call, certificate);
const publish = (program, id, hash, call) => pg.publish(program, id, hash, call, certificate);
async function main() {
  const model = pg.normalizeProgram(fixture);
  assert.equal(model.joinUrl, fixture.webinarJoinUrl);
  assert.equal(model.dateLabel, "30.09.2026 в 09:30 (МСК)");
  assert.equal(model.landingUrl, "https://edu-plus.ru/other_course/test_webinar/");
  assert.equal(pg.normalizeProgram({...fixture, price: 0}).price, 0);
  for (const bad of [{type: "UNKNOWN"}, {type: ""}, {id: ""}, {name: ""}, {name: "а".repeat(129)}, {webinarDate: "2026-02-30"},
    {webinarTime: "24:00"}, {price: -1}, {price: "не число"}, {hours: 0}, {landingCode: "../other"}, {landingCode: "имя"},
    {webinarJoinUrl: "javascript:alert(1)"}, {webinarJoinUrl: "https://user:password@jazz.sber.ru/"}, {webinarJoinUrl: "http://jazz.sber.ru"},
    {webinarJoinUrl: "https://127.0.0.1/"}]) {
    assert.throws(() => pg.normalizeProgram({...fixture, ...bad}), JSON.stringify(bad));
  }
  assert.equal(pg.normalizeProgram({...fixture, name: "а".repeat(200), siteProductName: "Короткое название"}).productName, "Короткое название");
  const fields = pg.buildLandingFields(template, model, 99);
  assert.equal(fields.podacha_zayavki_nazvanie_kursa, fixture.name);
  assert.equal(fields.blok_ceny[0].stoimost_kursa, "390");
  assert.equal(fields.blok_ceny[0].skidka, "61");
  assert.equal(fields.blok_ceny[0].ssylka_na_registraciyu, "https://zifra-plus.ru/checkout/?add-to-cart=99");
  assert.equal(fields.photo, 72);
  assert.equal(fields.opisanie_dokumenta, template.fields.opisanie_dokumenta, "Description comes from prototype, not legacy AIS values");
  assert.equal(fields.tekst_etap_obucheniya_1, template.fields.tekst_etap_obucheniya_1, "Author comes from prototype");
  assert.doesNotThrow(() => pg.normalizeProgram({...fixture, siteSpeaker: "", siteDescription: ""}));
  assert.deepEqual(fields.opaque, template.fields.opaque);
  assert.ok(!JSON.stringify(fields).includes("add-to-cart=12"));
  assert.ok(!JSON.stringify(fields).includes("psw="), "Meeting link must not enter public landing");
  assert.equal(template.fields.stoimost_kursa, "200", "Source template is immutable");
  const reviewed = {...template, fields: {...template.fields, blok_opisaniya_kursa: [{soderzhimoe_bloka: 'Отзыв: Прототип <img src="/photo.jpg"> https://zifra-plus.ru/checkout/?add-to-cart=12'}]}};
  assert.deepEqual(pg.buildLandingFields(reviewed, model, 99).blok_opisaniya_kursa, reviewed.fields.blok_opisaniya_kursa, "Reviews with original program name, photos and links are copied verbatim");
  for (const type of ["ДОП", "КПК", "ППП"]) {
    const course = {...fixture, type, webinarDate: "", webinarTime: "", webinarJoinUrl: "", siteSpeaker: "", duration: "2 месяца", studyForm: "Заочная"};
    const normalized = pg.normalizeProgram(course);
    assert.equal(normalized.joinUrl, ""); assert.equal(normalized.dateLabel, "Ежедневно");
    assert.match(normalized.landingUrl, new RegExp(pg.PROGRAM_TYPES[type].base));
    const plan = pg.withTrainingPlan(course, {collections:{trainingPlans:[{programId: course.id, discipline:"Модуль", totalHours:2},{programId:"another", programName:course.name, discipline:"Чужой план"}]}});
    assert.equal(plan.siteTrainingPlan.length, 1);
    const courseTemplate = {...reviewed, postType: normalized.postType, fields: {...reviewed.fields, slajder:[], programmy_obucheniya:[{moduli_programmy:[{nazvanie_modulya:"Старый"}]}], blok_ceny:[...template.fields.blok_ceny,...template.fields.blok_ceny]}};
    const languages = type === "ДОП" ? ["ru","en"] : ["ru","page-2","page-3"];
    const generatedImages = languages.map((language,i)=>({language, id:i+81, base64:"mock", label:"Образец " + i}));
    const courseFields = pg.buildLandingFields(courseTemplate, pg.normalizeProgram(plan), 99, generatedImages);
    assert.equal(courseFields.blok_ceny.length,1); assert.equal(courseFields.slajder.length,languages.length);
    assert.equal(courseFields.programmy_obucheniya[0].moduli_programmy[0].nazvanie_modulya,"Модуль");
    assert.deepEqual(courseFields.blok_opisaniya_kursa, reviewed.fields.blok_opisaniya_kursa);
    const result = await pg.prepare(plan,42,async (site,endpoint,body)=>{
      if (endpoint.startsWith("/template/")) return courseTemplate;
      if (endpoint === "/certificate-assets") { assert.equal(body.type,type);return {images:generatedImages}; }
      if (endpoint === "/prepare-product") {assert.equal(body.joinUrl,"");assert.equal(body.type,type);}
      if (endpoint === "/prepare-landing") {assert.equal(body.type,type);assert.equal(body.certificatePages.length,languages.length);}
      return {id:99,status:"draft"};
    },{hash:"a".repeat(64),generate:async()=>generatedImages});
    assert.equal(result.type,type);assert.equal(result.certificates.length,languages.length);
    if (type !== "ДОП") await assert.rejects(pg.prepare(plan,42,async()=>({...courseTemplate,postType:"other-course"}),certificate),/соответствующего/);
  }
  assert.throws(() => pg.buildLandingFields({fields: {}}, model, 2), /регистрации/);
  assert.throws(() => pg.buildLandingFields(template, model, 0), /ID/);
  const calls = [];
  const fake = async (site, endpoint, payload) => {
    calls.push({site, endpoint, payload});
    if (endpoint.startsWith("/template/")) return template;
    if (endpoint === "/certificate-assets") return {images};
    return {id: site === "edu" ? 101 : 99, status: ["/publish", "/enable-redirect"].includes(endpoint) ? "publish" : "draft", redirectEnabled: endpoint === "/enable-redirect"};
  };
  const draft = await prepare(fixture, 42, fake);
  assert.equal(draft.stage, "prepared");
  assert.deepEqual(calls.map(c => `${c.site}${c.endpoint}`), ["edu/template/42", "edu/certificate-assets", "shop/prepare-product", "edu/prepare-landing"]);
  assert.equal(calls[3].payload.fields.blok_ceny[0].ssylka_na_registraciyu, "https://zifra-plus.ru/checkout/?add-to-cart=99");
  assert.equal(calls[3].payload.fields.izobrazhenie_vydavaemogo_dokumenta, 81);
  assert.equal(calls[3].payload.fields.prevyu_vydavaemogo_dokumenta_2, 82);
  assert.deepEqual(draft.certificates, images);
  assert.equal(calls.find(item => item.endpoint === "/prepare-product").payload.descriptionHtml, template.fields.opisanie_dokumenta);
  await assert.rejects(prepare(fixture, 0, fake), /обязательное/);
  calls.length = 0;
  await assert.rejects(publish({...fixture, price: 400}, 42, draft.hash, fake), /изменились/);
  await assert.rejects(publish({...fixture, nameEnglish: "Changed"}, 42, draft.hash, fake), /изменились/);
  await assert.rejects(pg.publish(fixture, 42, draft.hash, fake, {...certificate, hash: "e".repeat(64)}), /изменились/);
  assert.ok(calls.every(item => item.endpoint.startsWith("/template/")), "Stale publication permits only read-only prototype checks");
  calls.length = 0;
  await publish(fixture, 42, draft.hash, fake);
  assert.deepEqual(calls.map(c => `${c.site}${c.endpoint}`), ["edu/template/42", "edu/validate-publication", "shop/publish", "edu/publish", "shop/enable-redirect"]);
  await assert.rejects(publish(fixture, 42, draft.hash, async (site, endpoint) => {
    assert.ok(endpoint.startsWith("/template/"), "Changed prototype must block all writes");
    return {...template, fields: {...template.fields, opisanie_dokumenta: "Changed on website"}};
  }), /изменились/);
  calls.length = 0;
  await assert.rejects(prepare(fixture, 42, async (site, endpoint, body) => {
    calls.push({site, endpoint, body});
    if (endpoint.startsWith("/template")) return template;
    throw new Error("network interrupted");
  }), /network interrupted/);
  assert.equal(calls.length, 2, "Do not create landing when product creation failed");
  calls.length = 0;
  await assert.rejects(prepare(fixture, 42, async () => ({fields: {}})), /регистрации/);
  const first = await prepare(fixture, 42, fake);
  const second = await prepare(fixture, 42, fake);
  assert.equal(first.hash, second.hash, "Retries use identical content hash");
  assert.equal(calls[1].payload.key, calls[5].payload.key, "Retries identify the same program");
  const partial = await prepare(fixture, 42, async (site, endpoint) => endpoint.startsWith("/template/") ? template : endpoint === "/certificate-assets" ? {images} : {id: site === "edu" ? 101 : 99, status: "publish", redirectEnabled: false});
  assert.equal(partial.stage, "prepared", "Failed redirect step must remain resumable, never reported as completed");
  await assert.rejects(publish(fixture, 42, first.hash, async (site, endpoint) => endpoint.startsWith("/template/") ? template : {id: 99, status: "publish", redirectEnabled: false}), /не подтвердили/);
  calls.length = 0;
  await assert.rejects(pg.prepare(fixture, 42, fake, {...certificate, generate: async () => {throw new Error("render failed");}}), /render failed/);
  assert.equal(calls.length, 1, "Rendering failure must not mutate either site");
  await assert.rejects(pg.prepare(fixture, 42, fake), /не подключено/);
  const secret = "a".repeat(64);
  const client = pg.createClient({edu: secret, shop: secret}, async (url, options) => {
    assert.equal(new URL(url).origin, pg.SITES.edu);
    const h = options.headers;
    assert.equal(h["X-AIS-Signature"], pg.signature(secret, options.method, new URL(url).pathname, h["X-AIS-Timestamp"], h["X-AIS-Nonce"], options.body || ""));
    assert.equal(options.redirect, "manual");
    assert.ok(!JSON.stringify(options).includes(secret));
    return {ok: true, status: 200, text: async () => '{"ok":true}'};
  });
  assert.deepEqual(await client("edu", "/health"), {ok: true});
  await assert.rejects(client("unknown", "/health"), /Недопустимый/);
  await assert.rejects(client("edu", "/../wp-users"), /Недопустимый/);
  const broken = pg.createClient({edu: secret}, async () => ({ok: false, status: 500, text: async () => '{"message":"internal secret","code":"internal_error"}'}));
  await assert.rejects(broken("edu", "/health"), e => !e.message.includes("internal secret"));
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const start = app.indexOf("  function renderProgramSiteLink(");
  const end = app.indexOf("\n  async function ", start);
  const context = {URL, escapeAttr: value => String(value).replaceAll('"', '&quot;'), escapeHtml: value => String(value)};
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  assert.equal(context.renderProgramSiteLink("javascript:alert(1)", "bad"), "");
  assert.equal(context.renderProgramSiteLink("https://evil.example", "bad"), "");
  assert.match(context.renderProgramSiteLink("https://edu-plus.ru/other_course/test/", "open"), /noopener noreferrer/);
  assert.match(app, /data-action="create-program-on-site"/);
  assert.match(app, /field\("webinarJoinUrl", "Ссылка подключения SberJazz"/);
  assert.match(app, /if \(publishButton\) publishButton.disabled = !result\?\.certificateHash/);
  const server = fs.readFileSync(path.join(__dirname, "..", "app-server.js"), "utf8");
  const routeStart = server.indexOf('if (requestUrl.pathname.startsWith("/api/program-sites/"))');
  const route = server.slice(routeStart, server.indexOf('\n  if (', routeStart + 5));
  assert.match(route, /authUser\?\.role !== "admin"/);
  assert.match(route, /isTrustedBrowserOrigin/);
  assert.match(route, /allowCache: false/);
  assert.match(route, /shared\.pendingCount/);
  assert.ok(/isDatabaseDemoModeEnabled\(\)\s+&& protectedRequest/.exec(server)?.index < routeStart);
  console.log("PASS: program validation, nested ACF replacement, manual Jazz URL, immutable template, publication freshness, call ordering, retries, signed transport, UI links, admin/CSRF/offline guards");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

// Synthetic UI fixture, no real shared database or WordPress calls.
if (process.argv.includes("--serve")) {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const start = app.indexOf("  function renderProgramSiteLink(");
  const end = app.indexOf("  function renderProgramModal(", start);
  const source = app.slice(start, end);
  const uiType = process.env.AIS_QA_PROGRAM_TYPE || "ПРО";
  const uiFixture = {...fixture, type: uiType};
  const uiImages = ["ПРО", "ДОП"].includes(uiType) ? images : ["ru", "page-2", "page-3"].map((language,i)=>({id:i+81,language,label:i ? "Приложение — страница " + i : "Основной документ",url:"https://edu-plus.ru/wp-content/uploads/sample-"+i+".jpg"}));
  const server = require("node:http").createServer((req, res) => {
    if (req.url === "/styles.css") { res.writeHead(200, {"Content-Type":"text/css"}); return res.end(fs.readFileSync(path.join(__dirname, "..", "styles.css"))); }
    if (req.url !== "/") { res.writeHead(404); return res.end(); }
    res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
    res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Проверка генератора ${uiType}</title><link rel="stylesheet" href="/styles.css"><body><form id="recordForm" data-config="programs"><input name="type" value="${uiType}"><button type="button" id="open">Создать на сайте</button></form><p id="saved" role="status"></p><script>
      const state={data:{collections:{programs:[${JSON.stringify(uiFixture)}]}},modal:{config:'programs',id:'test-pro-webinar'}};
      const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const escapeAttr=escapeHtml,isAdminUser=()=>true,isDatabaseDemoMode=()=>false,isSettingsDraftSessionActive=()=>false;
      const saveRecordFormBeforeContinuation=async()=>state.modal.id, ensureRecordLockForSave=async()=>true;
      const getEffectiveLocalDocumentsMode=()=>true;
      const persist=()=>document.getElementById('saved').textContent='Результат сохранён в тестовой карточке';
      const flushSharedApplicationState=async()=>true, photoApiUrl=value=>value, render=()=>{};
const fetch=async(url,opts)=>({ok:true,json:async()=>url.endsWith('/templates')?{templates:[{id:42,title:'Готовим статью с помощью нейросетей — тестовый прототип',postType:'other-course',url:'https://edu-plus.ru/other_course/test/'},{id:43,title:'Повышение квалификации — тестовый прототип',postType:'courses-pk',url:'https://edu-plus.ru/courses-pk/test2/'},{id:44,title:'Переподготовка — тестовый прототип',postType:'courses-pp',url:'https://edu-plus.ru/courses-pp/test3/'}]}:{ok:true,type:${JSON.stringify(uiType)},certificates:${JSON.stringify(uiImages)},certificateHash:'fixture-cert',stage:url.endsWith('/publish')?'published':'prepared',templateId:JSON.parse(opts.body).templateId,hash:'fixture',product:{id:99,editUrl:'https://zifra-plus.ru/wp-admin/post.php?post=99&action=edit',url:'https://zifra-plus.ru/product/test/'},landing:{id:101,previewUrl:'https://edu-plus.ru/?p=101&preview=true',editUrl:'https://edu-plus.ru/wp-admin/post.php?post=101&action=edit',url:'https://edu-plus.ru/other_course/test/'},promoMessage:'Тестовая программа'}});
      ${source}
      document.getElementById('open').addEventListener('click',openProgramSiteGenerator);
    </script></body></html>`);
  });
  server.listen(0, "127.0.0.1", () => console.log(`UI fixture: http://127.0.0.1:${server.address().port}/`));
}
