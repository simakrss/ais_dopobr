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
  "getStudentContextProgram", "getStudentProgramPromoMessage", "getStudentProgramMenuActions", "performStudentProgramMenuAction",
  "getWebinarTeacherOptions", "getSelectedWebinarRecipients",
  "getWebinarAuthorTeachers", "parseProgramAuthorPayments", "normalizeProgramAuthorPayments", "normalizePaymentPercent",
  "bindWebinarMessageActions", "showWebinarMessageMenu", "openWebinarMessageComposer",
  "hideFieldCopyPopup", "handleFieldCopyPopupOutside", "getStudentCommunicationAddressee",
  "getCardFieldFormulaBinding", "getCardFieldFormula", "setCardFieldFormula", "validateCardFieldFormula", "openCardFieldFormulaSettings",
  "showFieldCopyPopup", "renderCommunicationActionIcon", "chooseUnsavedChangesAction"
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
        { id: "pro", type: "ПРО", name: "Он-лайн семинар: Тестовый вебинар", shortName: "Тест ПРО", webinarDate: "2026-08-04", webinarTime: "18:00", webinarJoinUrl: "https://example.test/join?token=test", authorSource: "Иванова Елена Владимировна", teachers: "", promoMessage1: "Приглашаем на вебинар!\nhttps://example.test/webinar", promoMessage2: "Второе ПРО" },
        { id: "other", type: "ПРО", name: "Другой вебинар" },
        { id: "kpk", type: "КПК", name: "Курс повышения квалификации", promoMessage1: " ", promoMessage2: "Второе промосообщение КПК" },
        { id: "ppp", type: "ППП", name: "Переподготовка", promoMessage1: "Промосообщение ППП" },
        { id: "dop", type: "ДОП", name: "Дополнительная программа" },
        { id: "future", type: "ИНОЙ", name: "Другой тип программы" }
      ],
      students: [
        { id: "s1", program: "Он-лайн семинар: Тестовый вебинар", status: "На зачисление", name: "Анна Тестовая", email: "first@example.test" },
        { id: "s2", program: "Тест ПРО", status: "На зачисление", name: "Борис Тестовый", email: "second@example.test" },
        { id: "s3", program: "Тест ПРО", status: "На зачисление", name: "Вера Тестовая", email: "FIRST@EXAMPLE.TEST" },
        { id: "s4", program: "Тест ПРО", status: "На зачисление", name: "Глеб Тестовый", email: "broken" },
        { id: "s5", program: "Тест ПРО", status: "Учится", name: "Не получатель", email: "excluded@example.test" },
        { id: "s6", program: "Другой вебинар", status: "На зачисление", name: "Другая программа", email: "other@example.test" },
        { id: "s7", program: "Курс повышения квалификации", status: "На зачисление", name: "КПК", email: "kpk@example.test" },
        { id: "s8", program: "Тест ПРО", status: "Отчислен", name: "Архив", email: "archive@example.test" },
        { id: "s9", programId: "ppp", status: "На зачисление", name: "Слушатель ППП" },
        { id: "s10", programId: "dop", status: "На зачисление", name: "Слушатель ДОП" },
        { id: "s11", programId: "future", status: "На зачисление", name: "Слушатель другого типа" }
      ],
      contracts: [
        { id: "t1", name: "Иванова Елена Владимировна", email: "teacher@example.test" },
        { id: "t1-copy", name: "Иванова Елена Владимировна", email: "teacher@example.test" },
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
    canAccessView: () => true,
    copied: [], openedPrograms: [], promoDialogs: [],
    openStudentProgramPromoDialog: program => context.promoDialogs.push(program.id),
    copyTextToClipboard: async text => context.copied.push(text),
    openProgramCardById: async id => context.openedPrograms.push(id),
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
  for (const type of ["ПРО", "ППП", "КПК", "ДОП"]) {
    const program = {id:type,type,name:type,promoMessage1:"Первое\nhttps://example.test/",promoMessage2:"Второе"};
    assert.equal(c.getStudentContextProgram({programId:type},[program]),program);
    assert.equal(c.getStudentProgramPromoMessage(program),program.promoMessage1);
    const actions=c.getStudentProgramMenuActions(program);
    assert.equal(actions[0].action,"copy-promo"); assert.equal(actions[0].disabled,false);
    assert.equal(actions[1].action,"open-program");
    assert.equal(actions.filter(item=>["students","teacher"].includes(item.action)).length,type==="ПРО"?2:0);
    assert.equal(c.getStudentProgramPromoMessage({...program,promoMessage1:" \n"}),"Второе");
    assert.equal(c.getStudentProgramMenuActions({...program,promoMessage1:"",promoMessage2:""})[0].disabled,true);
  }
  assert.equal(c.getStudentProgramMenuActions({id:"x",type:"ИНОЙ"}).length,1);
  assert.equal(c.getStudentProgramMenuActions({id:"x",type:"ИНОЙ"})[0].action,"open-program");
  assert.equal(c.getStudentContextProgram({program:"Повтор"},[{id:"1",name:"Повтор"},{id:"2",name:"Повтор"}]),null);
  assert.equal(c.getStudentContextProgram({programId:"missing",program:"Курс повышения квалификации"}),null);
  assert.equal(c.getStudentContextProgram({program:"Курс повышения квалификации"}).id,"kpk");
  await c.performStudentProgramMenuAction("pro","copy-promo");
  await c.performStudentProgramMenuAction("kpk","copy-promo");
  assert.deepEqual(c.promoDialogs,["pro","kpk"]);
  assert.equal(c.copied.length,0,"Opening the promo action must not copy automatically");
  await c.performStudentProgramMenuAction("dop","copy-promo"); assert.equal(c.promoDialogs.length,2);
  assert.match(h.alerts.at(-1),/не заполнено/u);
  await c.performStudentProgramMenuAction("kpk","open-program");
  await c.performStudentProgramMenuAction("future","open-program");
  assert.deepEqual(c.openedPrograms,["kpk","future"]);
  c.canAccessView=()=>false;
  assert.equal(c.getStudentProgramMenuActions({id:"x",type:"ИНОЙ"})[0].disabled,true);
  await c.performStudentProgramMenuAction("ppp","open-program"); assert.equal(c.openedPrograms.length,2);
  assert.match(h.alerts.at(-1),/Нет доступа/u); c.canAccessView=()=>true;
  await c.performStudentProgramMenuAction("missing","open-program"); assert.match(h.alerts.at(-1),/не найдена/u);
  assert.equal(c.getStudentProgramMenuActions(null).length,0);
  const teacherOptions = c.getWebinarTeacherOptions();
  assert.equal(teacherOptions.length, 2, "Duplicate contracts must produce one teacher option");
  assert.equal(c.state.data.collections.contracts.length, 3, "Deduplication must not alter employee records");
  const people = c.getWebinarTeacherOptions([
    {id:"old",name:"Семёнова Елена Сергеевна",email:"Person@example.test",contractDate:"2025-01-01"},
    {id:"new",name:" Семенова  Елена Сергеевна ",email:"person@example.test ",contractDate:"2026-01-01"},
    {id:"other-email",name:"Семёнова Елена Сергеевна",email:"other@example.test"},
    {id:"other-person",name:"Иванова Елена Сергеевна",email:"person@example.test"}
  ]);
  assert.equal(people.length, 3);
  assert.ok(people.some(item=>item.id==="new")); assert.ok(!people.some(item=>item.id==="old"));
  const authorProgram = c.state.data.collections.programs[0];
  const authorSnapshot = JSON.stringify(authorProgram);
  let authorTeachers = c.getWebinarAuthorTeachers(authorProgram, teacherOptions);
  assert.equal(authorTeachers.length, 1, "Author selects a single deduplicated teacher even when teachers is empty");
  assert.equal(authorTeachers[0].id, "t1");
  assert.equal(JSON.stringify(authorProgram), authorSnapshot);
  for (const program of [
    {author:"Иванова Елена Владимировна"},
    {"Автор":"Иванова Елена Владимировна (25,5%)"},
    {authorSource:"Иванова Елена Владимировна ([АвторскаяСтавка] руб.)",authorPayments:[]},
    {authorPayments:[{recipient:" Иванова  Елена Владимировна ",amountFormula:"50%"}]},
    {authorPayments:[{name:"Иванова Елена Владимировна",formula:"1000"}],teachers:"Петров Иван Сергеевич"},
    {authorSource:"Иванова Елена Владимировна",teachers:"Петров Иван Сергеевич"}
  ]) {
    assert.equal(c.getWebinarAuthorTeachers(program,teacherOptions)[0]?.id,"t1");
  }
  for(const separator of [", ","; ","\n"]){
    const matched=c.getWebinarAuthorTeachers({authorSource:"Иванова Елена Владимировна (50%)"+separator+"Петров Иван Сергеевич (1000 руб.)"},teacherOptions);
    assert.equal(matched.length,2,"Multiple authors require manual selection, not the first name: "+JSON.stringify(separator));
  }
  assert.equal(c.getWebinarAuthorTeachers({teachers:"Иванова Елена Владимировна"},teacherOptions).length,0,"Do not use the unrelated teachers field");
  assert.equal(c.getWebinarAuthorTeachers({author:"Неизвестный Автор"},teacherOptions).length,0);
  assert.equal(c.getWebinarAuthorTeachers({author:"Иванова Е. В."},teacherOptions).length,0,"Do not guess identity from initials");
  assert.equal(c.getWebinarAuthorTeachers({author:"СЕМЁНОВА ЕЛЕНА СЕРГЕЕВНА"},people).length,2,"Different emails remain ambiguous");
  authorTeachers=c.getWebinarAuthorTeachers({author:"Семёнова Елена Сергеевна"},people.filter(item=>item.id!=="other-email"));
  assert.equal(authorTeachers.length,1);assert.equal(authorTeachers[0].id,"new");
  const autoContext=c.getWebinarMessageContext("pro","teacher",c.getWebinarAuthorTeachers(authorProgram)[0].id);
  assert.equal(autoContext.recipients[0].email,"teacher@example.test");
  assert.equal(autoContext.fields.ИмяОтчество,"Елена Владимировна");
  assert.equal(autoContext.errors.length,0);
  assert.match(functions.get("openWebinarMessageComposer"),/const suggested = getWebinarAuthorTeachers\(context.program, teachers\)/u);
  assert.match(functions.get("openWebinarMessageComposer"),/suggested.length === 1 && suggested\[0\].id === teacher.id/u);
  assert.doesNotMatch(functions.get("openWebinarMessageComposer"),/program.teachers/u);
  const composer = {dataset:{webinarMessageAudience:"students"}};
  const control = {name:"message",disabled:false,closest:selector=>selector==="[data-webinar-message-composer]"?composer:null};
  const binding = c.getCardFieldFormulaBinding(control);
  assert.equal(binding.kind,"webinar"); assert.equal(binding.key,"students");
  const oldSubject = c.state.data.dictionaries.webinarMessageTemplates[0].subject;
  const oldTeacher = JSON.stringify(c.state.data.dictionaries.webinarMessageTemplates[1]);
  c.setCardFieldFormula(binding,"Приглашение {ДатаВебинара}: {СсылкаПодключения}");
  assert.equal(c.getCardFieldFormula(binding),"Приглашение {ДатаВебинара}: {СсылкаПодключения}");
  assert.equal(c.state.data.dictionaries.webinarMessageTemplates[0].subject,oldSubject);
  assert.equal(JSON.stringify(c.state.data.dictionaries.webinarMessageTemplates[1]),oldTeacher);
  assert.equal(c.validateCardFieldFormula(binding,c.getCardFieldFormula(binding)),"");
  assert.match(c.validateCardFieldFormula(binding,"{НеверноеПоле}"),/Неизвестные/u);
  control.disabled=true; assert.equal(c.getCardFieldFormulaBinding(control),null);
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
  const selectedHarness = harness(); const selectionContext=selectedHarness.c.getWebinarMessageContext("pro");
  const excluded=[" FIRST@EXAMPLE.TEST "];
  assert.equal(selectedHarness.c.getSelectedWebinarRecipients(selectionContext,excluded).length,1);
  assert.equal(selectionContext.fields.КоличествоРегистраций,"4");
  const selectedResult=await selectedHarness.c.deliverWebinarMessages(selectionContext,content,{excludedEmails:excluded});
  assert.equal(selectedResult.total,1); assert.equal(selectedResult.sent,1); assert.equal(selectedResult.remaining,0);
  assert.deepEqual(selectedHarness.calls.map(call=>call.email),["second@example.test"]);
  assert.equal(selectedHarness.delays.length,0);
  await assert.rejects(selectedHarness.c.deliverWebinarMessages(selectionContext,content,{excludedEmails:["first@example.test","second@example.test"]}),/Выберите/u);
  assert.equal(selectedHarness.calls.length,1,"No requests when all recipients are excluded");
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
  <table><tbody><tr data-webinar-student-id="s1"><td><button type="button">Анна Тестовая — ПРО</button></td><td>На зачисление</td></tr><tr data-webinar-student-id="s7"><td><button type="button">Слушатель КПК</button></td></tr><tr data-webinar-student-id="s9"><td><button type="button">Слушатель ППП</button></td></tr><tr data-webinar-student-id="s10"><td><button type="button">Слушатель ДОП</button></td></tr><tr data-webinar-student-id="s11"><td><button type="button">Слушатель другого типа</button></td></tr></tbody></table>
  <p id="testProgramActionLog" role="status"></p>
  <button type="button" id="settings">Настройки сообщений</button><div id="settingsRoot"></div><p id="testMailLog" role="status">Тестовых отправок: 0</p>
  </main><script>
  const state={data:${JSON.stringify(fixtureData())}};
  const normalizeProgramName=value=>String(value??'').trim().toLowerCase().replace(/\\s+/g,' ');
  const isChecked=value=>value===true||value==='+';
  const escapeHtml=${escapeHtml.toString()}; const escapeAttr=escapeHtml;
  const dictionaryTitle=String; const addAudit=()=>{}; const persist=()=>{}; const render=()=>{};
  const canAccessView=()=>true;const isDatabaseDemoMode=()=>false;const isSettingsDraftSessionActive=()=>false;
  const copyTextToClipboard=async text=>{document.getElementById('testProgramActionLog').textContent='Скопировано: '+text;};
  const openProgramCardById=async id=>{document.getElementById('testProgramActionLog').textContent='Открыта карточка программы: '+id;};
  let sharedStateChangeGeneration=0;const flushSharedApplicationStateThroughGeneration=async()=>true;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const initializeFieldControlHistory=()=>{};const isFieldEditHistoryControl=control=>!control.disabled;
  const canUndoFieldControl=()=>false;const canRedoFieldControl=()=>false;const canPasteControlValue=()=>false;
  let lastKnownClipboardText='';const readFieldClipboardText=async()=>'';
  const hideStudentDocumentRecognitionFieldMenu=()=>{};
  let calls=0;
  const sendServerEmail=async args=>{calls++;document.getElementById('testMailLog').textContent='Тестовых отправок: '+calls+'; получатель: '+args.email;return true;};
  ${production}
  bindWebinarMessageActions();
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented){const popup=document.querySelector('[data-field-copy-popup]');const formula=document.querySelector('[data-card-field-formula-dialog]');if(popup)hideFieldCopyPopup();else if(formula)formula.closeCardFieldFormulaDialog();else document.querySelector('[data-webinar-message-composer]')?.closeWebinarMessageComposer();}});
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
