"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const enrollment = require("../student-enrollment.js");
function fixture(options = {}) {
  const snapshot = { revision: 1, data: { collections: { students: [], contracts: [{ login: "test" }], programs: [
    { id: "p1", productId: "10", name: "Тестовый курс", type: "КПК", price: 10000 },
    { id: "p2", productId: "20", name: "Тестовый вебинар", type: "ПРО", price: 100 }
  ] } } };
  const rows = [{ id: "101-1", orderId: "101", productId: "10", paid: true, paymentAmount: 5000, coupon: "RASS50", email: "test@example.test", name: "Тестов Тест Тестович" }];
  const mails = [], files = new Map(), audit = [], saves = [];
  const deps = { readState: async () => structuredClone(snapshot), systemUser: { role: "system" },
    save: async (revision, records) => { if (revision !== snapshot.revision) return { conflict: true };
      saves.push(records); snapshot.revision++; records.forEach(record => { const index = snapshot.data.collections.students.findIndex(row => row.id === record.id);
        if (index < 0) snapshot.data.collections.students.push(record); else snapshot.data.collections.students[index] = record; }); return {}; },
    audit: async action => audit.push(action), queryOrder: async () => rows,
    reservedLogins: async data => new Set([...data.collections.students, ...data.collections.contracts].flatMap(row => [row.login, row.studentPortalLogin]).filter(Boolean)),
    lock: async (_name, operation) => operation(), loginLimit: async () => {}, loginSuccess: async () => {},
    ensureFolder: async () => {}, sendMail: async message => mails.push(message),
    upload: async (folder, name, body) => files.set(`${folder}/${name}`, body),
    download: async (folder, name) => ({ body: files.get(`${folder}/${name}`) }),
    fileExists: async (folder, name) => files.has(`${folder}/${name}`), ...options };
  return { service: enrollment.createService(deps), snapshot, rows, mails, files, audit, saves, deps };
}
const pdf = { kind: "passport", base64: Buffer.from("%PDF-1.4\nfixture").toString("base64") };
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
  Object.assign(profile, { name: record.name, citizenship: "РФ", phone: "+79990000000", snils: "12345678901", mailingAddress: "123456, Тестовая улица", educationDocumentSurname: "Тестов" });
  await f.service.update(user, record.id, profile);
  for (const kind of ["passport", "registration", "snils", "diploma", "supplement"]) await f.service.upload(user, record.id, { ...pdf, kind });
  assert.deepEqual((await f.service.portal(user, record.id)).missing, []);
  const uploaded = await f.service.portal(user, record.id);
  assert.ok((await f.service.file(user, record.id, uploaded.documents[0].id)).body.length);
  const view = await f.service.submit(user, record.id); assert.ok(view.record.enrollmentSubmittedAt);
  assert.equal(f.snapshot.data.collections.students[0].enrollmentReviewStatus, "На проверке");
  await f.service.upload(user, record.id, pdf); assert.equal((await f.service.portal(user, record.id)).record.enrollmentSubmittedAt, "");
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
