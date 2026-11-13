"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const enrollment = require("../student-enrollment.js");
function fixture(options = {}) {
  const snapshot = { revision: 1, data: { collections: { students: [], contracts: [{ login: "test" }], programs: [
    { id: "p1", productId: "10", name: "Тестовый курс", type: "КПК", price: 10000 },
    { id: "p2", productId: "20", name: "Тестовый вебинар", type: "ПРО", price: 100 }
  ] } } };
  const rows = [{ id: "101-1", orderId: "101", productId: "10", paid: true, paymentAmount: 5000, coupon: "RASS50", email: "test@example.test", name: "Тестов Тест Тестович" }];
  const mails = [], files = new Map(), audit = [], saves = [], feedbackLedger = new Map(), locks = new Map();
  const deps = { readState: async () => structuredClone(snapshot), systemUser: { role: "system" },
    save: async (revision, records) => { if (revision !== snapshot.revision) return { conflict: true };
      saves.push(records); snapshot.revision++; records.forEach(record => { const index = snapshot.data.collections.students.findIndex(row => row.id === record.id);
        if (index < 0) snapshot.data.collections.students.push(record); else snapshot.data.collections.students[index] = record; }); return {}; },
    audit: async action => audit.push(action), queryOrder: async () => rows,
    reservedLogins: async data => new Set([...data.collections.students, ...data.collections.contracts].flatMap(row => [row.login, row.studentPortalLogin]).filter(Boolean)),
    lock: async (name, operation) => { const next = (locks.get(name) || Promise.resolve()).catch(() => {}).then(operation); locks.set(name, next); return next; }, loginLimit: async () => {}, loginSuccess: async () => {},
    feedbackRecipient: "center@example.test",
    readFeedbackState: async (id, requestId) => ({ request: feedbackLedger.get(`${id}:${requestId}`),
      lastAttemptAt: Math.max(0, ...[...feedbackLedger].filter(([key]) => key.startsWith(`${id}:`)).map(([, entry]) => entry.createdAt)) }),
    saveFeedbackState: async (id, entry) => feedbackLedger.set(`${id}:${entry.requestId}`, { ...entry }),
    ensureFolder: async () => {}, sendMail: async message => mails.push(message),
    upload: async (folder, name, body) => files.set(`${folder}/${name}`, body),
    download: async (folder, name) => ({ body: files.get(`${folder}/${name}`) }),
    fileExists: async (folder, name) => files.has(`${folder}/${name}`), ...options };
  return { service: enrollment.createService(deps), snapshot, rows, mails, files, audit, saves, deps, feedbackLedger };
}
const pdf = { kind: "passport", base64: Buffer.from("%PDF-1.4\nfixture").toString("base64") };
const feedbackBody = () => ({ subject: "Вопрос об обучении", message: "Подскажите, пожалуйста, дату начала обучения.", requestId: require("node:crypto").randomUUID() });
test("dictionary controls preserve current legacy values, reject forged selections and allow combo input", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record);
  f.snapshot.data.dictionaries = { citizenships: ["Российская Федерация", "Казахстан"], educationLevels: ["СПО", "Высшее"], workPlaces: ["Школа"] };
  record.passportType = "Архивный вид";
  const view = await f.service.portal(user, record.id);
  assert.equal(view.fields.find(item => item.key === "passportType").type, "combo");
  assert.ok(view.fields.find(item => item.key === "passportType").options.includes("Архивный вид"));
  assert.equal(view.fields.find(item => item.key === "workPlace").type, "combo");
  await f.service.update(user, record.id, { citizenship: "Казахстан", educationLevel: "Высшее", workPlace: "Новая организация" });
  await assert.rejects(f.service.update(user, record.id, { educationLevel: "Несуществующий уровень" }), { statusCode: 400 });
});
test("portal lookups match card dictionaries and saved values without duplicate Russian citizenship", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record);
  f.snapshot.data.dictionaries = { citizenships: ["Россия", "Российская Федерация", "Армения"] };
  f.snapshot.data.collections.students.push({ id: "other", name: "Чужие личные данные", citizenship: "Узбекистан", workPlace: "Школа", passportType: "Иной документ" });
  record.citizenship = "РФ";
  const view = await f.service.portal(user, record.id);
  assert.deepEqual(view.fields.find(item => item.key === "citizenship").options, ["Армения", "Россия", "Узбекистан"]);
  assert.equal(view.record.citizenship, "Россия");
  assert.ok(view.fields.find(item => item.key === "passportType").options.includes("Иной документ"));
  assert.ok(!JSON.stringify(view).includes("Чужие личные данные"));
  await f.service.update(user, record.id, { citizenship: "Франция" });
  assert.equal(f.snapshot.data.collections.students[0].citizenship, "Франция");
});
test("education surname follows the name-change checkbox and the shared card field", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record);
  let view = await f.service.update(user, record.id, { name: "Новая Анна Петровна", enrollmentNameChanged: false, educationDocumentSurname: "Старая" });
  assert.equal(view.record.educationDocumentSurname, "Новая");
  assert.equal(view.fields.find(item => item.key === "educationDocumentSurname").required, false);
  assert.ok(!view.missing.includes("Фамилия в документе об образовании"));
  view = await f.service.update(user, record.id, { enrollmentNameChanged: true, educationDocumentSurname: "" });
  assert.ok(view.missing.includes("Фамилия в документе об образовании"));
  view = await f.service.update(user, record.id, { educationDocumentSurname: "Прежняя" });
  assert.equal(f.snapshot.data.collections.students[0].educationDocumentSurname, "Прежняя");
  assert.equal(view.requirements.find(item => item.key === "nameChange").required, true);
  f.snapshot.data.collections.students[0].enrollmentNameChanged = false;
  assert.equal((await f.service.portal(user, record.id)).record.enrollmentNameChanged, true, "staff-entered different surname also selects the checkbox");
});
test("layout download and listing require the owning program's active approval or electronic-document event", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record), actor = { role: "manager" };
  const result = await f.service.awardUpload(actor, record.id, { ...pdf, kind: "layout" }), file = result.files[0];
  assert.equal((await f.service.awards(user, record.id)).programs[0].files.length, 0);
  await assert.rejects(f.service.awardFile(user, record.id, file.id), { statusCode: 403 });
  assert.equal((await f.service.staffAwards(actor, record.id)).programs[0].files.length, 1);
  assert.ok((await f.service.awardFile(actor, record.id, file.id, true)).body.length);
  const current = f.snapshot.data.collections.students[0];
  current.event_educationDocMaketApproved_state = "checked";
  assert.equal((await f.service.awards(user, record.id)).programs[0].files.length, 1);
  assert.ok((await f.service.awardFile(user, record.id, file.id)).body.length);
  current.event_educationDocMaketApproved_state = "unchecked"; current.event_educationDocMaketApproved_date = "2026-11-13";
  await assert.rejects(f.service.awardFile(user, record.id, file.id), { statusCode: 403 });
  current.event_macro_hb0dir_state = "dated";
  assert.equal((await f.service.awards(user, record.id)).programs[0].files.length, 1);
  current.eventDeleted = "macro_hb0dir";
  assert.equal((await f.service.awards(user, record.id)).programs[0].files.length, 0);
});
test("photo is scoped, stored in the student folder and does not move existing document attachments", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record), folder = enrollment.documentFolder(record);
  await assert.rejects(f.service.photo(user, "foreign", pdf), { statusCode: 404 });
  await assert.rejects(f.service.photo(user, record.id, pdf), /фотографию/);
  const photo = { base64: Buffer.from([137,80,78,71,13,10,26,10,1]).toString("base64") };
  const result = await f.service.photo(user, record.id, photo);
  assert.equal(result.photoAvailable, true);
  const latest = f.snapshot.data.collections.students[0]; assert.equal(enrollment.documentFolder(latest), folder);
  assert.ok(latest.photoPath.startsWith(folder + "/Фото-")); assert.ok(!JSON.stringify(result).includes(latest.photoPath));
});
test("award scans and layouts are staff-only, kept in one person root and scoped across owned programs", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record), actor = { role: "manager" };
  record.photoPath = "Слушатели/ТестовТТ/Документы/ТестовТТ.jpg";
  const second = { ...record, id: "second", program: "Вторая программа", studentPortalAccountId: record.id, photoPath: "Слушатели/second/Документы" };
  f.snapshot.data.collections.students.push(second, { ...second, id: "foreign", studentPortalAccountId: "foreign" });
  await assert.rejects(f.service.awardUpload(user, record.id, pdf), { statusCode: 403 });
  const one = await f.service.awardUpload(actor, record.id, pdf), two = await f.service.awardUpload(actor, second.id, pdf);
  assert.equal(one.files[0].folder, "Слушатели/ТестовТТ"); assert.equal(two.files[0].folder, one.files[0].folder); assert.notEqual(one.files[0].name, two.files[0].name);
  const awards = await f.service.awards(user, record.id); assert.equal(awards.programs.length, 2);
  assert.ok(!JSON.stringify(awards).includes('"folder"'));
  assert.ok((await f.service.awardFile(user, second.id, two.files[0].id)).body.length);
  await assert.rejects(f.service.awardFile(user, record.id, two.files[0].id), { statusCode: 404 });
  await assert.rejects(f.service.awardFile(user, "foreign", one.files[0].id), { statusCode: 404 });
  await f.service.awardUpload(actor, record.id, { ...pdf, kind: "layout" });
  await f.service.awardUpload(actor, record.id, { ...pdf, kind: "layout" });
  assert.equal(f.snapshot.data.collections.students[0].educationDocumentFiles.length, 2, "replace layout metadata, preserve scan");
});
test("debt payment uses authoritative debt, reuses orders and credits only confirmed payments once", async () => {
  const orders = new Map(); let sequence = 700;
  const f = fixture({ paymentShop: async (endpoint, data) => {
    if (endpoint.endsWith("-status")) return structuredClone([...orders.values()].find(item => item.orderId === data.orderId));
    if (!orders.has(data.intentKey)) orders.set(data.intentKey, { ...data, orderId: String(++sequence), paid: false, currency: "RUB", status: "pending", yookassa: true });
    const item = orders.get(data.intentKey); return { orderId: item.orderId, url: `https://zifra-plus.ru/checkout/order-pay/${item.orderId}/?key=fixture` };
  } });
  await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record);
  await assert.rejects(f.service.payment(user, "foreign"), { statusCode: 404 });
  const [one, two] = await Promise.all([f.service.payment(user, record.id), f.service.payment(user, record.id)]);
  assert.equal(one.amount, 5000); assert.equal(one.orderId, two.orderId); assert.equal(orders.size, 1);
  const pending = await f.service.settlePayment(one.orderId); assert.equal(pending.paid, false);
  assert.equal(f.snapshot.data.collections.students[0].payment2Amount, undefined);
  const payment = [...orders.values()][0]; Object.assign(payment, { paid: true, transactionId: "yoo-transaction", paidAt: "2026-11-12T12:00:00+03:00" });
  await Promise.all([f.service.settlePayment(one.orderId), f.service.settlePayment(one.orderId)]);
  const updated = f.snapshot.data.collections.students[0]; assert.equal(updated.payment2Amount, 5000); assert.equal(updated.portalPaymentReceipts.length, 1); assert.equal(updated.paidAmount, 10000); assert.equal(updated.balance, 0);
  assert.equal((await f.service.payment(user, record.id)).paid, true); assert.equal(orders.size, 1);
  assert.equal((await f.service.paymentStatus(user, record.id)).finances.debt, 0);
});
test("payment settlement rejects wrong amounts and unconfirmed providers; overflow retains all eight originals", async () => {
  let payment;
  const f = fixture({ paymentShop: async () => payment }); await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0];
  record.portalPaymentIntents = [{ key: "fixture", amount: 100, orderId: "701", status: "pending" }];
  for (let index = 1; index <= 8; index++) { record[`payment${index}Amount`] = index; record[`payment${index}Date`] = "2026-11-01"; }
  payment = { orderId: "701", studentId: record.id, intentKey: "fixture", amount: 99, currency: "RUB", paid: true, yookassa: true, transactionId: "yoo", paidAt: "2026-11-12" };
  await assert.rejects(f.service.settlePayment("701"), /не совпали/); payment.amount = 100; payment.yookassa = false;
  await assert.rejects(f.service.settlePayment("701"), /не подтвердила/); payment.yookassa = true;
  await f.service.settlePayment("701"); const updated = f.snapshot.data.collections.students[0];
  for (let index = 1; index <= 8; index++) assert.equal(updated[`payment${index}Amount`], index);
  assert.equal(updated.portalPaymentReceipts[0].slot, 0); assert.equal(enrollment.finances(updated).paid, 136);
});
test("feedback replies are tied to the owned thread and require a staff actor for center messages", async () => {
  const items = [];
  const f = fixture({ feedbackHistory: { all: async (_account, application) => items.filter(item => item.applicationId === application),
    history: async (_account, application) => ({ messages: items.filter(item => item.applicationId === application) }) } });
  const save = f.deps.saveFeedbackState; f.deps.saveFeedbackState = async (id, entry) => { await save(id, entry); const index = items.findIndex(item => item.requestId === entry.requestId); if (index >= 0) items[index] = entry; else items.push(entry); };
  await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record);
  const body = feedbackBody(); await f.service.feedback(user, record.id, body);
  assert.equal(items[0].message, body.message); assert.equal(items[0].status, "sent");
  await assert.rejects(f.service.feedback(user, record.id, { ...feedbackBody(), fromCenter: true }), { statusCode: 403 });
  await assert.rejects(f.service.feedback(user, record.id, { ...feedbackBody(), threadId: "foreign" }), { statusCode: 404 });
  for (const item of f.feedbackLedger.values()) item.createdAt -= 31000;
  const staff = { ...user, actingStaff: { role: "manager", name: "Сотрудник" } };
  await f.service.feedback(staff, record.id, { ...feedbackBody(), threadId: body.requestId, fromCenter: true });
  const reply = f.mails.at(-1); assert.equal(reply.to, record.email); assert.equal(reply.replyTo, "center@example.test"); assert.equal(reply.inReplyTo, items[0].messageId);
  assert.equal((await f.service.correspondence(user, record.id)).messages.length, 2);
  await assert.rejects(f.service.correspondence(user, "foreign"), { statusCode: 404 });
});
test("feedback is scoped, addressed to the center, escaped, audited and deduplicated across service instances", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); f.mails.length = 0;
  const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record), before = structuredClone(record);
  const body = { ...feedbackBody(), message: "Пожалуйста, проверьте\n<script>unsafe</script>", to: "attacker@example.test", replyTo: "forged@example.test", name: "Forged" };
  await assert.rejects(f.service.feedback({ role: "partner" }, record.id, body), { statusCode: 403 });
  await assert.rejects(f.service.feedback(user, "foreign", body), { statusCode: 404 });
  const secondInstance = enrollment.createService(f.deps);
  const results = await Promise.all([f.service.feedback(user, record.id, body), secondInstance.feedback(user, record.id, { ...body, requestId: body.requestId.toUpperCase() })]);
  assert.ok(results.every(result => result.ok)); assert.equal(f.mails.length, 1);
  const mail = f.mails[0]; assert.equal(mail.to, "center@example.test"); assert.equal(mail.replyTo, record.email);
  assert.match(mail.message, /Тестов Тест Тестович/); assert.match(mail.message, /Тестовый курс/);
  assert.match(mail.message, /&lt;script&gt;unsafe&lt;\/script&gt;/); assert.doesNotMatch(mail.message, /<script>/);
  assert.ok(!mail.message.includes(record.password)); assert.match(mail.idempotencyKey, /student-feedback:/);
  assert.equal(mail.requestDeliveryAndReadReceipts, false);
  assert.deepEqual(f.snapshot.data.collections.students[0], before);
  assert.ok(f.audit.includes("Отправлена обратная связь из кабинета слушателя"));
  assert.equal((await f.service.portal(user)).feedbackRecipient, "center@example.test");
  await assert.rejects(f.service.feedback(user, record.id, { ...body, message: "Изменённое сообщение" }), { statusCode: 409 });
  await assert.rejects(f.service.feedback(user, record.id, feedbackBody()), { statusCode: 429 });
  record.studentPortalBlocked = true;
  await assert.rejects(f.service.feedback(user, record.id, body), { statusCode: 401 });
  assert.equal(f.mails.length, 1);
});
test("feedback validates fields and preserves staff attribution without trusting client identity", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); f.mails.length = 0;
  const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record), body = feedbackBody();
  for (const invalid of [{ subject: " " }, { subject: "a".repeat(181) }, { message: "short" }, { message: "x".repeat(10001) }, { requestId: "invalid" }]) {
    await assert.rejects(f.service.feedback(user, record.id, { ...body, ...invalid }), { statusCode: 400 });
  }
  assert.equal(f.feedbackLedger.size, 0); assert.equal(f.mails.length, 0);
  const staff = { role: "manager", id: "staff", name: "Тестовый сотрудник" };
  const session = await f.service.staffSession(staff, record.id);
  await f.service.feedback(session.user, session.id, { ...body, subject: "Вопрос\r\nBcc: other" });
  assert.match(f.mails[0].message, /Отправил сотрудник: Тестовый сотрудник/);
  assert.ok(!/[\r\n]/u.test(f.mails[0].subject));
});
test("known SMTP errors may retry after throttling; unknown delivery and lost acknowledgement never resend", async () => {
  const f = fixture(); await f.service.provisionOrder("101");
  const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record);
  let calls = 0;
  const retryable = enrollment.createService({ ...f.deps, sendMail: async () => { if (++calls === 1) throw Error("connect failed"); } });
  const body = feedbackBody();
  await assert.rejects(retryable.feedback(user, record.id, body), { statusCode: 503 });
  await assert.rejects(retryable.feedback(user, record.id, body), { statusCode: 429 });
  for (const entry of f.feedbackLedger.values()) entry.createdAt -= 31000;
  assert.ok((await retryable.feedback(user, record.id, body)).ok); assert.equal(calls, 2);
  f.feedbackLedger.clear(); calls = 0;
  const uncertain = enrollment.createService({ ...f.deps, sendMail: async () => { calls++; throw Object.assign(Error("timeout"), { deliveryUnknown: true }); } });
  const unknownBody = feedbackBody();
  await assert.rejects(uncertain.feedback(user, record.id, unknownBody), { statusCode: 409 });
  for (const entry of f.feedbackLedger.values()) entry.createdAt -= 31000;
  await assert.rejects(uncertain.feedback(user, record.id, unknownBody), /не подтверждён/); assert.equal(calls, 1);
  f.feedbackLedger.clear(); calls = 0;
  const lostAck = enrollment.createService({ ...f.deps, sendMail: async () => { calls++; }, saveFeedbackState: async (id, entry) => {
    if (entry.status === "sent") throw Error("database lost"); return f.deps.saveFeedbackState(id, entry);
  } });
  const lostBody = feedbackBody();
  await assert.rejects(lostAck.feedback(user, record.id, lostBody), /сервер принял письмо/);
  await assert.rejects(lostAck.feedback(user, record.id, lostBody), /не подтверждён/); assert.equal(calls, 1);
});
test("review decisions require staff, a current submission and a return comment; preserve unrelated data", async () => {
  const f = fixture(); await f.service.provisionOrder("101");
  const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record), staff = { role: "manager", id: "reviewer", name: "Проверяющий" };
  Object.assign(record, { enrollmentReviewStatus: "На проверке", enrollmentSubmittedAt: "2026-11-11T10:00:00Z", enrollmentSubmissionId: "packet-1" });
  const body = { decision: "return", comment: "Перезагрузите паспорт\nСтраница не читается <script>", submissionId: "packet-1" };
  for (const role of ["student", "partner", "system", undefined]) await assert.rejects(f.service.review({ role }, record.id, body), { statusCode: 403 });
  await assert.rejects(f.service.review(staff, record.id, { ...body, comment: " " }), /исправить/);
  await assert.rejects(f.service.review(staff, record.id, { ...body, comment: "x".repeat(4001) }), /4000/);
  await assert.rejects(f.service.review(staff, record.id, { ...body, submissionId: "old" }), { statusCode: 409 });
  const returned = await f.service.review(staff, record.id, body);
  assert.equal(returned.enrollmentReviewStatus, "На доработке"); assert.equal(returned.enrollmentSubmittedAt, "");
  assert.equal(returned.enrollmentReviewedBy, staff.name); assert.equal(returned.enrollmentReviewedSubmissionAt, record.enrollmentSubmittedAt);
  assert.ok(!("password" in returned)); assert.ok(!("email" in returned));
  const view = await f.service.portal(user, record.id);
  assert.equal(view.record.enrollmentReviewComment, body.comment); assert.equal(view.record.enrollmentReviewStatus, "На доработке");
  await f.service.update(user, record.id, { phone: "+79990000000" });
  assert.equal(f.snapshot.data.collections.students[0].enrollmentReviewStatus, "На доработке");
  assert.equal(f.snapshot.data.collections.students[0].enrollmentReviewComment, body.comment);
  await assert.rejects(f.service.review(staff, record.id, body), { statusCode: 409 });
  const fresh = f.snapshot.data.collections.students[0];
  Object.assign(fresh, { enrollmentReviewStatus: "На проверке", enrollmentSubmittedAt: "2026-11-11T12:00:00Z", enrollmentSubmissionId: "packet-2" });
  await assert.rejects(f.service.review(staff, record.id, body), { statusCode: 409 });
  const accepted = await f.service.review(staff, record.id, { decision: "accept", comment: "Всё верно", submissionId: "packet-2" });
  assert.equal(accepted.enrollmentReviewStatus, "Приняты"); assert.equal(accepted.enrollmentReviewComment, "Всё верно");
  assert.ok(accepted.enrollmentSubmittedAt); assert.equal(f.snapshot.data.collections.students[0].payment1Amount, 5000);
  assert.equal(f.snapshot.data.collections.students[0].status, "На зачисление");
  await assert.rejects(f.service.submit(user, record.id), /уже приняты/);
  await assert.rejects(f.service.review(staff, record.id, { decision: "accept", submissionId: "packet-2" }), { statusCode: 409 });
  assert.ok(f.audit.includes("Приняты документы для зачисления"));
});

test("review honors card locks and rechecks submission after a CAS conflict, including legacy submissions", async () => {
  const f = fixture(); await f.service.provisionOrder("101");
  const record = f.snapshot.data.collections.students[0], actor = { role: "admin" };
  Object.assign(record, { enrollmentReviewStatus: "На проверке", enrollmentSubmittedAt: "2026-11-11T10:00:00Z" });
  const body = { decision: "accept", submissionId: record.enrollmentSubmittedAt };
  const locked = enrollment.createService({ ...f.deps, save: async () => ({ locked: true }) });
  await assert.rejects(locked.review(actor, record.id, body), { statusCode: 423 });
  assert.equal(record.enrollmentReviewStatus, "На проверке");
  const conflict = enrollment.createService({ ...f.deps, save: async () => { record.enrollmentSubmissionId = "new-packet"; return { conflict: true }; } });
  await assert.rejects(conflict.review(actor, record.id, body), { statusCode: 409 });
  delete record.enrollmentSubmissionId;
  assert.equal((await f.service.review(actor, record.id, body)).enrollmentReviewStatus, "Приняты");
});
test("paid import is idempotent, reserves existing logins and uses SDO numeric password", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); await f.service.provisionOrder("101");
  assert.equal(f.snapshot.data.collections.students.length, 1); assert.equal(f.mails.length, 1);
  const record = f.snapshot.data.collections.students[0];
  assert.equal(record.status, "На зачисление"); assert.equal(record.login, "test.2"); assert.match(record.password, /^\d{6}$/);
  assert.equal(record.contractAmount, 10000); assert.equal(record.payment1Amount, 5000);
  assert.match(f.mails[0].message, /Отправить на проверку/); assert.match(f.mails[0].message, /edu-plus.ru\/lms/);
});
test("only paid PPP/KPK exact unambiguous product matches are imported", async () => {
  const f = fixture(); f.rows.push({ ...f.rows[0], id: "101-2", productId: "20" }, { ...f.rows[0], id: "101-3", paid: false });
  const result = await f.service.provisionOrder("101"); assert.equal(result.imported, 1); assert.equal(result.skipped, 1);
  assert.equal(enrollment.matchProgram(f.rows[0], [f.snapshot.data.collections.programs[0], f.snapshot.data.collections.programs[0]]), null);
  const ppp = fixture(); ppp.snapshot.data.collections.programs[0].type = "ППП"; await ppp.service.provisionOrder("101"); assert.equal(ppp.mails.length, 1);
});
test("discounted payment and installments produce distinct contract amounts", async () => {
  const f = fixture(); f.rows[0].coupon = "SALE50"; await f.service.provisionOrder("101");
  assert.equal(f.snapshot.data.collections.students[0].contractAmount, 5000); assert.equal(f.snapshot.data.collections.students[0].discount, 50);
});
test("profile and files are scoped to the account; protected fields cannot be written or read", async () => {
  const f = fixture(); await f.service.provisionOrder("101");
  const record = f.snapshot.data.collections.students[0], user = await f.service.authenticate(record.login, record.password, "local");
  assert.equal(await f.service.authenticate(record.login, "wrong", "local"), null);
  await assert.rejects(f.service.portal(user, "foreign"), { statusCode: 404 });
  await assert.rejects(f.service.update(user, "foreign", { name: "attack" }), { statusCode: 404 });
  await assert.rejects(f.service.file(user, record.id, "../secret"), { statusCode: 404 });
  await f.service.update(user, record.id, { name: "Тестов Тест Тестович", status: "Отчисленные", login: "admin", password: "x", photoPath: "../", payment1Amount: 900000, studentPortalAccountId: "foreign" });
  const saved = f.snapshot.data.collections.students[0]; assert.equal(saved.status, "На зачисление"); assert.equal(saved.login, "test.2"); assert.equal(saved.payment1Amount, 5000);
  const view = await f.service.portal(user, record.id);
  for (const key of ["password", "studentPortalCredentialSalt", "photoPath", "directExpenses"]) assert.ok(!JSON.stringify(view).includes(`"${key}"`));
  saved.password = "new-sdo-pass"; assert.equal((await f.service.portal(user)).user.login, user.login);
  saved.studentPortalPassword = "newpass"; await assert.rejects(f.service.portal(user), { statusCode: 401 });
});
test("required documents respect citizenship, study certificate and changed surname", () => {
  const required = record => enrollment.documentRequirements(record).filter(item => item.required).map(item => item.key);
  assert.deepEqual(required({ citizenship: "РФ" }), ["passport", "registration", "snils", "diploma", "supplement"]);
  assert.deepEqual(required({ citizenship: "Казахстан", enrollmentEducationMode: "Справка с места учёбы", enrollmentNameChanged: true }), ["passport", "registration", "study", "nameChange"]);
});
test("submission requires all fields and actual stored files; edits require resubmission", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0], user = enrollment.publicUser(record);
  await assert.rejects(f.service.submit(user, record.id), /Заполните/);
  const profile = Object.fromEntries(enrollment.FIELDS.filter(row => row[2] !== "checkbox").map(([key, , type, options]) => [key, type === "date" ? "2000-01-01" : options?.[0] || "Заполнено"]));
  Object.assign(profile, { name: record.name, citizenship: "Российская Федерация", passportType: "Паспорт гражданина РФ", educationLevel: "СПО", phone: "+79990000000", snils: "12345678901", mailingAddress: "123456, Тестовая улица", educationDocumentSurname: "Тестов" });
  await f.service.update(user, record.id, profile);
  for (const kind of ["passport", "registration", "snils", "diploma", "supplement"]) await f.service.upload(user, record.id, { ...pdf, kind });
  assert.deepEqual((await f.service.portal(user, record.id)).missing, []);
  const uploaded = await f.service.portal(user, record.id);
  assert.ok((await f.service.file(user, record.id, uploaded.documents[0].id)).body.length);
  const view = await f.service.submit(user, record.id); assert.ok(view.record.enrollmentSubmittedAt);
  assert.equal(f.snapshot.data.collections.students[0].enrollmentReviewStatus, "На проверке");
  const firstSubmission = f.snapshot.data.collections.students[0].enrollmentSubmissionId;
  await f.service.review({ role: "manager" }, record.id, { decision: "return", submissionId: firstSubmission, comment: "Чётче скан" });
  await f.service.upload(user, record.id, pdf); assert.equal((await f.service.portal(user, record.id)).record.enrollmentSubmittedAt, "");
  assert.equal((await f.service.portal(user, record.id)).record.enrollmentReviewStatus, "На доработке");
  await f.service.submit(user, record.id);
  assert.notEqual(f.snapshot.data.collections.students[0].enrollmentSubmissionId, firstSubmission);
  assert.equal((await f.service.portal(user, record.id)).record.enrollmentReviewStatus, "На проверке");
  assert.equal((await f.service.portal(user, record.id)).documents.length, 5);
  f.files.clear(); await assert.rejects(f.service.submit(user, record.id), /недоступен/);
});
test("untrusted file content and quota overflow are rejected", () => {
  assert.throws(() => enrollment.validateUpload({ ...pdf, base64: Buffer.from("<script>bad</script>").toString("base64") }), /PDF/);
  assert.throws(() => enrollment.validateUpload({ ...pdf, kind: "../passport" }), /вид документа/);
  assert.throws(() => enrollment.validateUpload({ ...pdf, base64: "A".repeat(28 * 1024 * 1024 + 1) }), /20 МБ/);
});
test("failed SMTP can retry, ambiguous delivery never sends a second copy", async () => {
  let count = 0; const f = fixture({ sendMail: async () => { count++; throw Object.assign(Error("timeout"), { deliveryUnknown: true }); } });
  await assert.rejects(f.service.provisionOrder("101")); await f.service.provisionOrder("101"); assert.equal(count, 1);
  assert.equal(f.snapshot.data.collections.students[0].enrollmentMailStatus, "unknown");
  let retry = 0; const g = fixture({ sendMail: async () => { if (++retry === 1) throw Error("connect failed"); } });
  await assert.rejects(g.service.provisionOrder("101")); await g.service.provisionOrder("101"); assert.equal(retry, 2); assert.equal(g.snapshot.data.collections.students.length, 1);
});
test("same person can use one account across paid applications without exposing a namesake", async () => {
  const f = fixture(); await f.service.provisionOrder("101"); const first = f.snapshot.data.collections.students[0], user = enrollment.publicUser(first);
  f.rows[0] = { ...f.rows[0], id: "102-1", orderId: "102" }; await f.service.provisionOrder("102");
  assert.equal((await f.service.portal(user)).applications.length, 2);
  f.rows[0] = { ...f.rows[0], id: "103-1", orderId: "103", name: "Другой Слушатель" }; await f.service.provisionOrder("103");
  assert.equal((await f.service.portal(user)).applications.length, 2); assert.equal(f.snapshot.data.collections.students[2].login, "test.3");
});
test("finances include all eight payments, refunds and kopecks without staff expense data", () => {
  assert.deepEqual(enrollment.finances({ contractAmount: 10000, payment1Amount: 5000, payment2Amount: -500, payment8Amount: 100.25, directExpenses: [{ amount: 900 }] }), {
    total: 10000, paid: 4600.25, debt: 5399.75, overpaid: 0, payments: [{ date: "", amount: 5000 }, { date: "", amount: -500 }, { date: "", amount: 100.25 }] });
  assert.equal(enrollment.finances({ contractAmount: 100, payment1Amount: 200 }).overpaid, 100);
});
test("repeated state conflicts cause retryable failure instead of silently losing order", async () => {
  const f = fixture({ save: async () => ({ conflict: true }) }); await assert.rejects(f.service.provisionOrder("101"), { statusCode: 503 }); assert.equal(f.mails.length, 0);
});

test("existing accounts: all types and statuses, no mail, no SDO or financial edits, repeat is harmless", async () => {
  const f = fixture();
  const rows = [
    { id: "a", name: "Иванов Иван", email: "test@example.test", login: "old-sdo", password: "sdo-secret", educationType: "ПРО", status: "Отчисленные", payment1Amount: 321, photoPath: "old-folder" },
    { id: "b", name: "Иванов Иван", email: "test@example.test", educationType: "ДОП" },
    { id: "c", name: "Другой человек", email: "test@example.test", educationType: "КПК" },
    { id: "d", name: "Без почты", uid: "42", educationType: "ППП" }
  ];
  f.snapshot.data.collections.students = structuredClone(rows);
  assert.equal((await f.service.provisionExisting()).remaining, 4); assert.equal(f.saves.length, 0);
  const result = await f.service.provisionExisting({ apply: true }); assert.equal(result.created, 4); assert.equal(result.accounts, 3);
  for (const original of rows) {
    const saved = f.snapshot.data.collections.students.find(row => row.id === original.id);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(saved[key], value);
    assert.match(saved.studentPortalPassword, /^\d{6}$/);
  }
  assert.equal(f.mails.length, 0); assert.equal(f.snapshot.data.collections.students[0].studentPortalLogin, "test.2");
  const owner = f.snapshot.data.collections.students[0];
  const user = await f.service.authenticate(owner.studentPortalLogin, owner.studentPortalPassword, "local");
  assert.equal((await f.service.portal(user)).applications.length, 2);
  await assert.rejects(f.service.portal(user, "c"), { statusCode: 404 });
  assert.equal((await f.service.provisionExisting({ apply: true })).created, 0);
});

test("matching email and name with contradictory passports or dates never combines people", async () => {
  const f = fixture(); f.snapshot.data.collections.students = [
    { id: "a", name: "Иван Иванов", email: "a@example.test", birthDate: "1990-01-01" },
    { id: "b", name: "Иван Иванов", email: "a@example.test", birthDate: "1991-01-01" }
  ];
  assert.equal((await f.service.provisionExisting({ apply: true })).accounts, 2);
});

test("bulk provisioning preserves blocking and retries revisions; batches link the same owner", async () => {
  const f = fixture(); f.snapshot.data.collections.students = Array.from({ length: 75 }, (_, n) => ({ id: String(n), name: "Один человек", email: "same@example.test" }));
  f.snapshot.data.collections.students.push({ id: "blocked", studentPortalBlocked: true });
  const save = f.deps.save; let conflict = true; f.deps.save = async (...args) => { if (conflict) { conflict = false; return { conflict: true }; } return save(...args); };
  assert.equal((await f.service.provisionExisting({ apply: true })).created, 75);
  assert.equal(new Set(f.snapshot.data.collections.students.filter(row => row.studentPortalEnabled).map(row => row.studentPortalAccountId)).size, 1);
  assert.ok(!f.snapshot.data.collections.students.at(-1).studentPortalEnabled);
  const locked = fixture({ save: async () => ({ locked: true }) }); locked.snapshot.data.collections.students = [{ id: "x" }];
  await assert.rejects(locked.service.provisionExisting({ apply: true }), { statusCode: 503 });
});

test("DOP imports and requires only passport scans, with no diploma or SNILS fields", async () => {
  const f = fixture(); f.snapshot.data.collections.programs[0].type = "ДОП";
  await f.service.provisionOrder("101"); const record = f.snapshot.data.collections.students[0];
  const view = await f.service.portal(enrollment.publicUser(record));
  assert.deepEqual(view.requirements.map(row => row.key), ["passport", "registration"]);
  assert.ok(!view.fields.some(row => ["snils", "educationLevel", "workPlace"].includes(row.key)));
  assert.ok(!view.missing.includes("СНИЛС (для граждан РФ)"));
  assert.match(f.mails[0].message, /Для ДОП диплом и СНИЛС не требуются/);
});
test("existing photo filenames resolve to their folder without changing the photo field", () => {
  assert.equal(enrollment.documentFolder({ id: "s", photoPath: "Y:\\АИС Допобразование\\Слушатели\\ИвановИИ\\Фото.jpg" }), "Слушатели/ИвановИИ");
  assert.equal(enrollment.documentFolder({ id: "s", photoPath: "../file.jpg" }), "Слушатели/s/Документы");
  assert.equal(enrollment.documentFolder({ id: "s", photoPath: "[-1]/Слушатели/ИвановИИ/Документы" }), "[-1]/Слушатели/ИвановИИ/Документы");
});

test("SSO is gated on the saved access event, ownership and current session, not on browser claims", async () => {
  const calls = [], f = fixture({ sdoTicket: async record => { calls.push(record.id); return { token: "one-time" }; } });
  await f.service.provisionOrder("101"); const r = f.snapshot.data.collections.students[0], user = enrollment.publicUser(r);
  await assert.rejects(f.service.sdo(user, r.id), { statusCode: 403 });
  await f.service.update(user, r.id, { event_portalCredentialsSent_state: "checked" });
  assert.equal((await f.service.portal(user)).sdoAvailable, false);
  f.snapshot.data.collections.students[0].event_portalCredentialsSent_state = "checked";
  assert.equal((await f.service.sdo(user, r.id)).token, "one-time");
  await assert.rejects(f.service.sdo(user, "other"), { statusCode: 404 });
  const updated = f.snapshot.data.collections.students[0]; updated.event_portalCredentialsSent_state = "unchecked"; updated.event_portalCredentialsSent_date = "2026-01-01";
  await assert.rejects(f.service.sdo(user, r.id), { statusCode: 403 }); assert.equal(calls.length, 1);
});

test("staff can open a scoped student cabinet without modifying the staff identity or credentials", async () => {
  const f = fixture(); await f.service.provisionOrder("101");
  const first = f.snapshot.data.collections.students[0];
  f.rows[0] = { ...f.rows[0], id: "102-1", orderId: "102" }; await f.service.provisionOrder("102");
  const second = f.snapshot.data.collections.students[1];
  f.rows[0] = { ...f.rows[0], id: "103-1", orderId: "103", name: "Другой человек" }; await f.service.provisionOrder("103");
  const other = f.snapshot.data.collections.students[2];
  for (const role of ["admin", "manager"]) {
    const actor = Object.freeze({ id: "employee", login: "staff", name: "Сотрудник", role });
    const session = await f.service.staffSession(actor, second.id);
    assert.equal(session.id, second.id); assert.equal(session.user.studentId, first.id);
    assert.equal(session.user.actingStaff, actor); assert.equal(actor.role, role);
    assert.deepEqual(await f.service.portal(session.user, session.id), await f.service.portal(enrollment.publicUser(first), second.id));
    assert.equal((await f.service.staffSession(actor, second.id, first.id)).id, first.id);
    await assert.rejects(f.service.staffSession(actor, first.id, other.id), { statusCode: 403 });
  }
  for (const role of [undefined, "partner", "student", "system"]) await assert.rejects(f.service.staffSession({ role }, first.id), { statusCode: 403 });
  await assert.rejects(f.service.staffSession({ role: "admin" }, "absent"), { statusCode: 404 });
  first.studentPortalBlocked = true;
  await assert.rejects(f.service.staffSession({ role: "admin" }, second.id), { statusCode: 409 });
});
