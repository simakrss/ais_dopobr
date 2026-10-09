"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createService, suggestBindings, validateSchedule, publicItem } = require("../rusender");
const NOW = Date.parse("2026-10-09T08:00:00Z");
let clock = NOW;
const programs = [{ id: "p1", name: "Он-лайн семинар: Подготовка статей ВАК", type: "ПРО" }, { id: "p2", name: "Одинаковая" }, { id: "p3", name: "Одинаковая" }];
const templates = [{ id: 100, name: "Копия Подготовка статей ВАК", html: "<p>Письмо</p>" }, { id: 101, name: "Одинаковая" }];
const lists = [{ id: 2, name: "Подписчики", contactsCount: 12 }];
const senders = [{ id: 3, email: "sender@example.invalid", verified: "enabled" }];
const token = "rs_ck_v1_UNIT_TEST_NOT_A_REAL_SECRET";
const store = new Map(), locks = new Set(), calls = [], remote = new Map(), dedup = new Map();
let remoteNext = 500, failPath = "", changedHtml = false, badPagination = false, loseCreateResponse = false, loseScheduleResponse = false;
const pool = {
  async query(sql, args = []) {
    if (sql.startsWith("CREATE TABLE")) return [[]];
    if (sql.includes("GET_LOCK")) { if (locks.has(args[0])) return [[{ acquired: 0 }]]; locks.add(args[0]); return [[{ acquired: 1 }]]; }
    if (sql.includes("RELEASE_LOCK")) { locks.delete(args[0]); return [[]]; }
    if (sql.startsWith("INSERT INTO")) { store.set(args[0], args[1]); return [[]]; }
    if (sql.includes("LIKE")) return [[...store].filter(([key]) => key.startsWith(args[0].slice(0, -1))).map(([, data_json]) => ({ data_json }))];
    if (sql.includes("WHERE item_key =")) return [store.has(args[0]) ? [{ data_json: store.get(args[0]) }] : []];
    throw Error("Unexpected SQL: " + sql);
  },
  async getConnection() { return { query: this.query.bind(this), release() {} }; }
};
const result = (data, meta) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, data: structuredClone(data), meta }) });
async function fakeFetch(url, opts) {
  const parsed = new URL(url); const route = parsed.pathname.replace(/^\/api/, "");
  calls.push({ route, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, key: opts.headers["Idempotency-Key"] });
  assert.equal(parsed.origin, "https://api.rusender.ru"); assert.equal(opts.redirect, "error"); assert.equal(opts.headers.Authorization, `Bearer ${token}`);
  if (route === failPath) throw Error(`private network details ${token}`);
  if (opts.method === "POST") {
    const key = opts.headers["Idempotency-Key"];
    if (dedup.has(key)) return result(dedup.get(key));
    const data = JSON.parse(opts.body).data;
    if (route.endsWith("/schedule")) {
      const campaign = remote.get(Number(route.split("/").at(-2)));
      campaign.status = "moderation"; campaign.scheduledAt = data.scheduledStartDate;
      dedup.set(key, structuredClone(campaign));
      if (loseScheduleResponse) { loseScheduleResponse = false; throw Error("connection reset after schedule"); }
      return result(campaign);
    }
    const campaign = { ...data, id: remoteNext++, status: "draft", lists: data.listIds.map(id => lists.find(item => item.id === id)), senderEmail: senders[0].email, dashboardUrl: "https://app.rusender.ru/mail-distributions" };
    remote.set(campaign.id, campaign); dedup.set(key, structuredClone(campaign));
    if (loseCreateResponse) { loseCreateResponse = false; throw Error("connection reset after create"); }
    return result(campaign);
  }
  if (/\/campaigns\/\d+$/.test(route)) return result(remote.get(Number(route.split("/").at(-1))));
  if (/\/templates\/\d+$/.test(route)) return result({ ...templates[0], html: changedHtml ? "Changed" : templates[0].html });
  const resource = route.split("/").at(-1), page = Number(parsed.searchParams.get("page"));
  const values = { templates, lists, senders, campaigns: [{ id: 11, name: "Подготовка статей ВАК", templateId: 100, status: "completed", stats: { total: 20, open: { count: 5 } } }] }[resource];
  const selected = resource === "templates" ? values.slice(page - 1, page) : values;
  return result({ items: selected }, { pagination: { page: badPagination ? 1 : page, totalPages: resource === "templates" ? 2 : 1, totalItems: values.length } });
}
const service = createService({ getPool: async () => pool, getPrograms: async () => programs, fetchImpl: fakeFetch, now: () => clock });
async function sync(resource) {
  const generation = crypto.randomUUID(); let page = 1;
  do { page = (await service.syncPage({ resource, page, generation })).nextPage; } while (page);
}
async function plan() {
  return (await service.savePlan({ id: crypto.randomUUID(), programId: "p1", templateId: 100, senderId: 3, listIds: [2], name: "Тест без отправки", subject: "Тема", scheduledAt: "2026-10-10T08:00:00.000Z" }, "test")).plan;
}
(async () => {
  assert.equal(validateSchedule("2026-10-09T08:06:00Z", NOW), "2026-10-09T08:06:00.000Z");
  assert.throws(() => validateSchedule("2026-10-09T08:00:00Z", NOW), /5 минут/);
  assert.throws(() => validateSchedule("2026-10-10T11:00", NOW), /дату/);
  assert.deepEqual(suggestBindings(programs, templates, []), [{ programId: "p1", templateIds: [100], source: "exact-name" }]);
  assert.equal(publicItem("campaigns", { id: 1, dashboardUrl: "javascript:alert(1)" }).dashboardUrl, "https://app.rusender.ru/mail-distributions");
  assert.equal((await service.snapshot()).connected, false);
  await assert.rejects(service.configure("account password"), /API-ключ/);
  await service.configure(token);
  for (const resource of ["templates", "campaigns", "senders", "lists"]) await sync(resource);
  const snapshot = await service.snapshot();
  assert.equal(snapshot.templates.items.length, 2); assert.equal(snapshot.connected, true);
  assert.ok(!JSON.stringify(snapshot).includes(token)); assert.ok(!JSON.stringify(snapshot).includes("Письмо"));
  const original = store.get("dataset:templates");
  badPagination = true; await assert.rejects(sync("templates"), /пагинация/); badPagination = false;
  assert.equal(store.get("dataset:templates"), original);
  failPath = "/v1/public/campaigns";
  await assert.rejects(sync("campaigns"), error => !error.message.includes(token) && error.statusCode === 504); failPath = "";
  assert.equal((await service.autoBind()).count, 1);
  await service.bind({ programId: "p1", templateIds: [] });
  assert.equal((await service.autoBind()).count, 0); // Explicit manual unlink is retained.
  await service.bind({ programId: "p1", templateIds: [100] });
  await assert.rejects(service.bind({ programId: "none", templateIds: [100] }), /Программа/);
  const first = await plan();
  assert.equal(calls.filter(call => call.method === "POST").length, 0); // Saving/binding never sends anything.
  assert.equal((await service.savePlan({ ...first, subject: "DIFFERENT" })).plan.subject, "Тема");
  await assert.rejects(service.action(first.id, "schedule", {}), /черновик/);
  loseCreateResponse = true;
  await assert.rejects(service.action(first.id, "draft"), /Нет ответа/);
  const created = await service.action(first.id, "draft");
  assert.equal(created.plan.campaignId, 500); assert.equal(remote.size, 1);
  await service.action(first.id, "draft"); assert.equal(remote.size, 1);
  const preview = await service.action(first.id, "preview");
  assert.ok(preview.html.includes("Письмо"));
  assert.ok(!(await service.snapshot()).plans[0].approval);
  await assert.rejects(service.action(first.id, "schedule", { confirmation: "wrong" }), /устарел/);
  changedHtml = true; await assert.rejects(service.action(first.id, "schedule", { confirmation: preview.confirmation }), /устарел/); changedHtml = false;
  clock += 11 * 60000;
  await assert.rejects(service.action(first.id, "schedule", { confirmation: preview.confirmation }), /устарел/);
  clock = NOW;
  const confirmed = await service.action(first.id, "preview");
  loseScheduleResponse = true;
  await assert.rejects(service.action(first.id, "schedule", { confirmation: confirmed.confirmation }), /Нет ответа/);
  const scheduled = await service.action(first.id, "schedule", { confirmation: confirmed.confirmation });
  assert.equal(scheduled.plan.state, "scheduled");
  assert.equal(calls.filter(call => call.route.endsWith("/schedule")).length, 1);
  const scheduledBody = calls.find(call => call.route.endsWith("/schedule")).body;
  assert.deepEqual(scheduledBody.data, { scheduledStartDate: "2026-10-10T08:00:00.000Z" });
  const second = await plan(); await service.action(second.id, "cancel");
  await assert.rejects(service.action(second.id, "draft"), /отменён/);
  const third = await plan(); loseCreateResponse = true;
  await assert.rejects(service.action(third.id, "draft")); clock += 16 * 60000;
  await assert.rejects(service.action(third.id, "draft"), /15 минут/);
  assert.equal(locks.size, 0);
  const offline = createService({ getPool: async () => null, getPrograms: async () => [] });
  await assert.rejects(offline.snapshot(), /Офлайн/);
  console.log("PASS Rusender: exact/ambiguous binding, manual preservation, pagination and partial failures, no secret exposure, no send on save, immutable/idempotent plans, lost responses, preview/content/expiry confirmation, cancellation and offline fail-closed.");
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
