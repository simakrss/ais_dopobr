const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");
const functions = new Map([...source.matchAll(
  /^  (?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]*?^  \}/gmu
)].map((match) => [match[1], match[0]]));
const constants = source.slice(source.indexOf("  const WEBINAR_MESSAGE_FIELDS"), source.indexOf("  const PRO_STUDENT_ARCHIVE_ADDITIONAL_STATUS"));
const names = [
  "normalizeWebinarMessageTemplates", "renderWebinarMessageSettings", "getWebinarTemplateError", "saveWebinarMessageSettings",
  "getWebinarProgramForStudent", "getWebinarMessageContext", "renderWebinarMessage", "deliverWebinarMessages",
  "bindWebinarMessageActions", "showWebinarMessageMenu", "openWebinarMessageComposer",
  "hideFieldCopyPopup", "handleFieldCopyPopupOutside", "getStudentCommunicationAddressee"
];
const production = constants + names.map((name) => {
  assert.ok(functions.has(name), name); return functions.get(name);
}).join("\n");
const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function fixtureData() {
  return {
    dictionaries: {},
    collections: {
      programs: [
        { id: "pro", type: "ПРО", name: "Он-лайн семинар: Тестовый вебинар", shortName: "Тест ПРО", webinarDate: "2026-08-04", webinarTime: "18:00", webinarJoinUrl: "https://example.test/join?token=test", teachers: "Иванова Елена Владимировна" },
        { id: "other", type: "ПРО", name: "Другой вебинар" },
        { id: "kpk", type: "КПК", name: "Курс повышения квалификации" }
      ],
      students: [
        { id: "s1", program: "Он-лайн семинар: Тестовый вебинар", status: "На зачисление", name: "Анна Тестовая", email: "first@example.test" },
        { id: "s2", program: "Тест ПРО", status: "На зачисление", name: "Борис Тестовый", email: "second@example.test" },
        { id: "s3", program: "Тест ПРО", status: "На зачисление", name: "Вера Тестовая", email: "FIRST@EXAMPLE.TEST" },
        { id: "s4", program: "Тест ПРО", status: "На зачисление", name: "Глеб Тестовый", email: "broken" },
        { id: "s5", program: "Тест ПРО", status: "Учится", name: "Не получатель", email: "excluded@example.test" },
        { id: "s6", program: "Другой вебинар", status: "На зачисление", name: "Другая программа", email: "other@example.test" },
        { id: "s7", program: "Курс повышения квалификации", status: "На зачисление", name: "КПК", email: "kpk@example.test" },
        { id: "s8", program: "Тест ПРО", status: "Отчислен", name: "Архив", email: "archive@example.test" }
      ],
      contracts: [
        { id: "t1", name: "Иванова Елена Владимировна", email: "teacher@example.test" },
        { id: "t2", name: "Петров Иван Сергеевич", email: "" }
      ]
    }
  };
}

function harness() {
  const calls = [];
  const delays = [];
  const alerts = [];
  const context = {
    URL, Date, TextEncoder,
    state: { data: fixtureData(), studentSearch: "Нет совпадений", selectedRows: [] },
    normalizeProgramName: value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    isChecked: value => value === true || value === "+",
    escapeHtml, escapeAttr: escapeHtml,
    alert: message => alerts.push(message),
    persistCalls: 0, renderCalls: 0, auditCalls: 0,
    persist: () => context.persistCalls++, render: () => context.renderCalls++, addAudit: () => context.auditCalls++, dictionaryTitle: key => key,
    setTimeout: (fn, delay) => { delays.push(delay); fn(); },
    sendServerEmail: async args => { calls.push(args); return true; }
  };
  vm.createContext(context);
  vm.runInContext(production, context);
  return { c: context, calls, delays, alerts };
}

async function test() {
  const h = harness(); const c = h.c;
  const defaults = c.normalizeWebinarMessageTemplates();
  assert.equal(defaults.length, 2);
  assert.match(defaults[0].message, /https:\/\/bizvmax\.ru\/zifra_plus/u);
  assert.match(defaults[0].message, /сертификат и запись/u);
  assert.equal(c.normalizeWebinarMessageTemplates([{id:"students",subject:"Моя тема",message:"Мой текст"}])[0].message, "Мой текст");
  assert.equal(c.normalizeWebinarMessageTemplates([{id:"teacher",message:""}])[1].message, "");
  assert.match(c.getWebinarTemplateError("Тема", "{НесуществующееПоле}"), /Неизвестные/u);
  assert.equal(c.getWebinarTemplateError(defaults[0].subject, defaults[0].message), "");
  const settings = c.renderWebinarMessageSettings([{id:"students",message:"<script>bad()</script>"}]);
  assert.ok(settings.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  const form = {elements: { studentsSubject:{value:"{НазваниеПрограммы}"}, studentsMessage:{value:"Дата {ДатаВебинара}"}, teacherSubject:{value:"Вебинар"},teacherMessage:{value:"Всего {КоличествоРегистраций}"}}};
  c.saveWebinarMessageSettings({preventDefault(){},currentTarget:form});
  assert.equal(c.persistCalls, 1); assert.equal(c.auditCalls, 1); assert.equal(c.renderCalls, 1);
  assert.equal(c.state.data.dictionaries.webinarMessageTemplates[0].message, "Дата {ДатаВебинара}");
  form.elements.teacherMessage.value = "{Ошибка}";
  c.saveWebinarMessageSettings({preventDefault(){},currentTarget:form});
  assert.equal(c.persistCalls, 1); assert.equal(h.alerts.length, 1);

  const context = c.getWebinarMessageContext("pro");
  assert.equal(context.registrations.length, 4, "Count all enrolled-pending registrations, not the filtered/selected table rows");
  assert.equal(context.recipients.length, 2);
  assert.equal(context.skipped.length, 2);
  assert.equal(context.errors.length, 0);
  assert.equal(context.fields.ДатаВебинара, "04.08.2026");
  assert.equal(context.fields.ВремяВебинара, "18.00");
  assert.equal(context.fields.СсылкаПодключения, "https://example.test/join?token=test");
  const rendered = c.renderWebinarMessage(defaults[0].message, context.fields);
  assert.match(rendered, /04\.08\.2026 в 18\.00 мск/u);
  assert.doesNotMatch(rendered, /\{[^}]+\}/u);
  const teacher = c.getWebinarMessageContext("pro", "teacher", "t1");
  assert.equal(teacher.recipients.length, 1);
  assert.equal(teacher.recipients[0].id, "t1");
  assert.equal(teacher.fields.ИмяОтчество, "Елена Владимировна");
  assert.match(c.renderWebinarMessage(defaults[1].message, teacher.fields), /Всего зарегистрировалось - 4 чел\./u);
  assert.ok(c.getWebinarMessageContext("pro", "teacher", "t2").errors.length);
  assert.ok(c.getWebinarMessageContext("pro", "teacher").errors.length);
  assert.throws(() => c.getWebinarMessageContext("kpk"), /только для вебинаров/u);
  assert.throws(() => c.getWebinarMessageContext("missing"), /только для вебинаров/u);
  assert.equal(c.getWebinarProgramForStudent({program:"Тест ПРО",programId:"missing"}), null);
  assert.equal(c.getWebinarProgramForStudent({program:"Тест ПРО",programId:"kpk"}), null);
  const ambiguous = [...c.state.data.collections.programs, {id:"copy",type:"ПРО",name:context.program.name}];
  assert.equal(c.getWebinarProgramForStudent({program:context.program.name}, ambiguous), null, "Ambiguous names must not mix webinar cohorts");
  assert.equal(c.getWebinarProgramForStudent({program:context.program.name, programId:"pro"}, ambiguous).id, "pro");

  for (const [key, value] of [["webinarDate","2026-02-30"],["webinarDate",""],["webinarTime","25:70"],["webinarTime",""],["webinarJoinUrl","javascript:alert(1)"],["webinarJoinUrl","https://user:pass@example.test"],["webinarJoinUrl",""]]) {
    const b = harness(); b.c.state.data.collections.programs[0][key] = value;
    const invalid = b.c.getWebinarMessageContext("pro");
    assert.ok(invalid.errors.length, `${key}: ${value}`);
    await assert.rejects(b.c.deliverWebinarMessages(invalid, {subject:"Тема",message:"Текст"}));
    assert.equal(b.calls.length, 0);
  }
  const ru = harness(); ru.c.state.data.collections.programs[0].webinarDate = "4.08.2026";
  assert.equal(ru.c.getWebinarMessageContext("pro").fields.ДатаВебинара, "04.08.2026");
  const content = {subject:"Вебинар",message:rendered};
  const success = await c.deliverWebinarMessages(context, content);
  assert.equal(success.sent, 2); assert.equal(success.remaining, 0);
  assert.deepEqual(h.delays, [3500]);
  assert.deepEqual(h.calls.map(call => call.email), ["first@example.test","second@example.test"]);
  assert.ok(h.calls.every(call => call.skipConfirmation && call.quiet && call.recipientMode === "student" && call.entityType === "students" && call.entityId));
  await c.deliverWebinarMessages(teacher, content);
  assert.equal(h.calls[2].entityType, "contracts"); assert.equal(h.calls[2].email, "teacher@example.test");
  await assert.rejects(c.deliverWebinarMessages(context, {subject:"",message:"text"}));
  await assert.rejects(c.deliverWebinarMessages(context, {subject:"x".repeat(201),message:"text"}));
  await assert.rejects(c.deliverWebinarMessages(context, {subject:"title",message:"ю".repeat(50001)}));

  for (const change of ["email", "status", "webinarJoinUrl", "webinarTime", "type"]) {
    const b = harness(); const preview = b.c.getWebinarMessageContext("pro");
    if (["email", "status"].includes(change)) b.c.state.data.collections.students[0][change] = "changed";
    else b.c.state.data.collections.programs[0][change] = "changed";
    try { const result = await b.c.deliverWebinarMessages(preview, content); assert.equal(result.sent, 0); assert.ok(result.stopped); }
    catch (error) { assert.match(error.message, /только для вебинаров/u); }
    assert.equal(b.calls.length, 0, `Changed ${change} must invalidate preview`);
  }
  for (const sent of [false, null]) {
    const b = harness(); let count = 0;
    b.c.sendServerEmail = async () => {count++; return sent;};
    const result = await b.c.deliverWebinarMessages(b.c.getWebinarMessageContext("pro"), content);
    assert.equal(count, 1); assert.equal(result.remaining, 1); assert.ok(result.stopped);
    assert.equal(result.results[0].status, sent === null ? "unknown" : "failed");
  }
  const cancel = harness(); let cancelRequested = false;
  cancel.c.sendServerEmail = async () => {cancelRequested = true; return true;};
  const cancelled = await cancel.c.deliverWebinarMessages(cancel.c.getWebinarMessageContext("pro"), content, {shouldStop:()=>cancelRequested});
  assert.equal(cancelled.sent, 1); assert.equal(cancelled.remaining, 1); assert.equal(cancel.delays.length, 0);
  const changed = harness(); let count = 0;
  changed.c.sendServerEmail = async () => {count++; changed.c.state.data.collections.students[1].status = "Учится"; return true;};
  const midrun = await changed.c.deliverWebinarMessages(changed.c.getWebinarMessageContext("pro"), content);
  assert.equal(count, 1); assert.equal(midrun.remaining, 1); assert.match(midrun.stopped, /изменились/u);
  const removed = harness();
  removed.c.sendServerEmail = async () => { removed.c.state.data.collections.programs = []; return true; };
  const interrupted = await removed.c.deliverWebinarMessages(removed.c.getWebinarMessageContext("pro"), content);
  assert.equal(interrupted.sent, 1); assert.equal(interrupted.remaining, 1); assert.ok(interrupted.stopped);

  assert.match(source, /data-webinar-student-id/u);
  assert.match(functions.get("renderSettings"), /renderWebinarMessageSettings\(selectedValues\)/u);
  assert.match(functions.get("handleAisHistoryNavigation"), /closeWebinarMessageComposer/u);
  assert.match(functions.get("closeTopmostWindowByEscape"), /closeWebinarMessageComposer/u);
  assert.match(functions.get("openWebinarMessageComposer"), /if \(sending \|\| attempted \|\| sendButton.disabled/u);
  console.log("Webinar reminders: defaults/settings, recipients, deduplication, dates/URLs, teacher, safe preview, throttling, send/stop/error/unknown and menu integration passed.");
}

function serveFixture() {
  const http = require("node:http");
  const styles = fs.readFileSync(path.join(root, "styles.css"));
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка сообщений вебинара</title><link rel="stylesheet" href="/styles.css"><body>
  <main style="max-width:1000px;margin:24px auto;padding:12px"><h1>Слушатели — изолированный тест</h1><p>Правый щелчок по слушателю. Настоящие письма не отправляются.</p>
  <table><tbody><tr data-webinar-student-id="s1"><td><button type="button">Анна Тестовая — ПРО</button></td><td>На зачисление</td></tr><tr data-webinar-student-id="s7"><td><button type="button">Слушатель КПК</button></td></tr></tbody></table>
  <button type="button" id="settings">Настройки сообщений</button><div id="settingsRoot"></div><p id="testMailLog" role="status">Тестовых отправок: 0</p>
  </main><script>
  const state={data:${JSON.stringify(fixtureData())}};
  const normalizeProgramName=value=>String(value??'').trim().toLowerCase().replace(/\\s+/g,' ');
  const isChecked=value=>value===true||value==='+';
  const escapeHtml=${escapeHtml.toString()}; const escapeAttr=escapeHtml;
  const dictionaryTitle=String; const addAudit=()=>{}; const persist=()=>{}; const render=()=>{};
  let calls=0;
  const sendServerEmail=async args=>{calls++;document.getElementById('testMailLog').textContent='Тестовых отправок: '+calls+'; получатель: '+args.email;return true;};
  ${production}
  bindWebinarMessageActions();
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){const popup=document.querySelector('[data-field-copy-popup]');if(popup)hideFieldCopyPopup();else document.querySelector('[data-webinar-message-composer]')?.closeWebinarMessageComposer();}});
  document.getElementById('settings').addEventListener('click',()=>{const root=document.getElementById('settingsRoot');root.innerHTML=renderWebinarMessageSettings(state.data.dictionaries.webinarMessageTemplates);root.querySelector('form').addEventListener('submit',saveWebinarMessageSettings);});
  </script></body></html>`;
  http.createServer((req,res)=>{
    if(req.url==='/styles.css'){res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'});res.end(styles);}
    else if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}
    else {res.writeHead(404);res.end();}
  }).listen(0,'127.0.0.1',function(){console.log(`Webinar fixture: http://127.0.0.1:${this.address().port}/`);});
}

if(process.argv.includes("--serve"))serveFixture();
else test().catch(error=>{console.error(error);process.exitCode=1;});
