"use strict";
// Server-only integration. Credentials never enter shared application state or API responses.
const crypto = require("node:crypto");
const BASE = "https://api.rusender.ru/api";
const RESOURCES = Object.freeze({ campaigns: "/v1/public/campaigns", templates: "/v2/public/templates", lists: "/v1/public/lists", senders: "/v1/public/senders" });
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || ""));
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const text = (value, length = 1000) => String(value ?? "").slice(0, length);
const dashboardUrl = value => { try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "app.rusender.ru" && !url.username && !url.password ? url.href : "https://app.rusender.ru/mail-distributions"; } catch { return "https://app.rusender.ru/mail-distributions"; } };
const normalizedName = value => text(value).toLowerCase().replace(/ё/g, "е").replace(/^(копия\s+)+/i, "").replace(/^(он[ -]?лайн\s+)?(семинар|вебинар|курс|программа)\s*[:—-]\s*/i, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function publicItem(resource, row) {
  const result = { id: id(row.id), name: text(row.name), updatedAt: text(row.updatedAt, 80), createdAt: text(row.createdAt, 80), dashboardUrl: dashboardUrl(row.dashboardUrl) };
  // Only aggregate data: do not fetch/export individual recipients.
  if (resource === "senders") Object.assign(result, { email: text(row.email, 320), verified: text(row.verified, 30) });
  if (resource === "lists") Object.assign(result, { contactsCount: Number.isFinite(Number(row.contactsCount)) ? Number(row.contactsCount) : null });
  if (resource === "templates") result.type = text(row.type, 50);
  if (resource === "campaigns") {
    Object.assign(result, { subject: text(row.subject), status: text(row.status, 80), statusModerate: text(row.statusModerate, 80), templateId: id(row.templateId), senderId: id(row.senderId), scheduledAt: text(row.scheduledAt, 80), startedAt: text(row.startedAt, 80), finishedAt: text(row.finishedAt, 80), isArchived: Boolean(row.isArchived), lists: (row.lists || []).map(item => ({ id: id(item.id), name: text(item.name) })) });
    if (row.stats) {
      result.stats = { total: Math.max(0, Number(row.stats.total) || 0) };
      for (const key of ["sending", "delivered", "open", "click", "error", "unsubscribe", "complaint"]) {
        result.stats[key] = { count: Math.max(0, Number(row.stats[key]?.count) || 0), rate: Number(row.stats[key]?.rate) || 0 };
      }
    }
  }
  return result;
}

function suggestBindings(programs, templates, campaigns) {
  const names = new Map();
  for (const program of programs) {
    const name = normalizedName(program.name);
    if (name) names.set(name, [...(names.get(name) || []), String(program.id)]);
  }
  const templateIds = new Set(templates.map(item => id(item.id)));
  const result = new Map();
  for (const item of [...templates.map(item => ({ ...item, templateId: item.id })), ...campaigns]) {
    if (!templateIds.has(id(item.templateId))) continue;
    for (const name of new Set([normalizedName(item.name), normalizedName(item.subject)].filter(Boolean))) {
      const candidates = names.get(name) || [];
      // Never resolve ambiguous program variants by array order or fuzzy matching.
      if (candidates.length !== 1) continue;
      const ids = result.get(candidates[0]) || new Set();
      ids.add(id(item.templateId));
      result.set(candidates[0], ids);
    }
  }
  return [...result].map(([programId, ids]) => ({ programId, templateIds: [...ids], source: "exact-name" }));
}

function validateSchedule(value, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(value || ""))) fail("Укажите дату и время отправки (Москва).");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < now + 5 * 60000) fail("Отправка должна быть назначена минимум через 5 минут. Проверьте план.");
  return new Date(time).toISOString();
}

function createService({ getPool, getPrograms, fetchImpl = global.fetch, now = Date.now }) {
  let initializedPool = null;
  async function pool() {
    const db = await getPool();
    if (!db) fail("Для Rusender требуется доступ к общей базе АИС. Офлайн-запуск рассылок запрещён.", 503);
    if (initializedPool !== db) {
      await db.query("CREATE TABLE IF NOT EXISTS ais_rusender_store (item_key VARCHAR(191) NOT NULL PRIMARY KEY, data_json LONGTEXT NOT NULL, updated_at DATETIME(3) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
      initializedPool = db;
    }
    return db;
  }
  async function read(key, db = null) {
    const [rows] = await (db || await pool()).query("SELECT data_json FROM ais_rusender_store WHERE item_key = ?", [key]);
    return rows.length ? JSON.parse(rows[0].data_json) : null;
  }
  async function write(key, value, db = null) {
    await (db || await pool()).query("INSERT INTO ais_rusender_store (item_key, data_json, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), updated_at = VALUES(updated_at)", [key, JSON.stringify(value)]);
  }
  async function locked(key, action) {
    const connection = await (await pool()).getConnection();
    const lockName = `ais-rusender:${hash(key).slice(0, 40)}`;
    let acquired = false;
    try {
      const [rows] = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
      acquired = Number(rows[0]?.acquired) === 1;
      if (!acquired) fail("Операция уже выполняется в другой копии АИС. Обновите список через несколько секунд.", 409);
      return await action(connection);
    } finally {
      if (acquired) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
      connection.release();
    }
  }
  async function api(path, { method = "GET", data, key, token } = {}) {
    const secret = token || (await read("secret"))?.token;
    if (!secret) fail("Подключите API-ключ Rusender в настройках этой вкладки.", 409);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchImpl(BASE + path, { method, redirect: "error", signal: controller.signal, headers: { Authorization: `Bearer ${secret}`, Accept: "application/json", ...(data ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, ...(data ? { body: JSON.stringify({ data, meta: { requestId: key || crypto.randomUUID() } }) } : {}) });
      if (response.status === 429) fail(`Rusender ограничил частоту запросов. Повторите через ${Math.max(1, Math.min(600, Number(response.headers.get("retry-after")) || 60))} сек.`, 429);
      if ([401, 403].includes(response.status)) fail("Rusender отклонил API-ключ или его права. Проверьте подключение и тариф.", 403);
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok !== true || !body.data) {
        const code = /^[A-Z0-9_]{1,80}$/.test(body?.error?.code || "") ? ` (${body.error.code})` : "";
        fail(`Rusender: запрос не выполнен, HTTP ${response.status}${code}. Проверьте данные в кабинете сервиса.`, 502);
      }
      return body;
    } catch (error) {
      if (error.statusCode) throw error;
      // No provider body/URL/token in logs or user-facing exception.
      fail("Нет ответа Rusender за 20 секунд или соединение прервано. Обновите состояние; повтор операции защищён от дублирования.", 504);
    } finally { clearTimeout(timer); }
  }
  async function datasets() {
    return Object.fromEntries(await Promise.all(Object.keys(RESOURCES).map(async key => [key, await read(`dataset:${key}`) || { items: [], syncedAt: "", complete: false }])));
  }
  async function all(prefix) {
    const [rows] = await (await pool()).query("SELECT data_json FROM ais_rusender_store WHERE item_key LIKE ? ORDER BY updated_at DESC", [`${prefix}:%`]);
    return rows.map(row => JSON.parse(row.data_json));
  }
  function publicPlan(plan) {
    const { approval, ...result } = plan;
    return result;
  }
  async function snapshot() {
    const data = await datasets();
    const programs = await getPrograms();
    return { ok: true, connected: Boolean((await read("secret"))?.token), ...data, programs, bindings: await all("binding"), plans: (await all("plan")).map(publicPlan), suggestions: suggestBindings(programs, data.templates.items, data.campaigns.items) };
  }
  async function configure(token) {
    token = String(token || "").trim();
    if (!/^rs_ck_v1_[A-Za-z0-9_-]{16,500}$/.test(token)) fail("Укажите публичный API-ключ Rusender вида rs_ck_v1_… (не пароль аккаунта).");
    await Promise.all(Object.values(RESOURCES).map(path => api(`${path}?page=1&limit=1`, { token })));
    await write("secret", { token, configuredAt: new Date(now()).toISOString() });
    return { ok: true, connected: true };
  }
  async function syncPage({ resource, page, generation }) {
    if (!Object.hasOwn(RESOURCES, resource) || !uuid(generation) || !Number.isInteger(page) || page < 1 || page > 1000) fail("Некорректный этап синхронизации.");
    return locked(`sync:${resource}`, async connection => {
      const previous = page === 1 ? { items: [], generation, page: 0 } : await read(`stage:${resource}`, connection);
      if (!previous || previous.generation !== generation || previous.page !== page - 1) fail("Синхронизация изменена в другой копии АИС. Начните обновление заново.", 409);
      const response = await api(`${RESOURCES[resource]}?page=${page}&limit=100${resource === "campaigns" ? "&withStats=true" : ""}`);
      if (!Array.isArray(response.data.items)) fail("Rusender вернул неизвестный формат списка. Сохранённые данные не изменены.", 502);
      const items = response.data.items.map(item => publicItem(resource, item));
      if (items.some(item => !item.id)) fail("В ответе Rusender нет идентификаторов. Сохранённые данные не изменены.", 502);
      const pagination = response.meta?.pagination;
      const totalPages = pagination ? Number(pagination.totalPages) : 1;
      if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > 1000 || (pagination && Number(pagination.page) !== page)) fail("Некорректная пагинация Rusender. Полнота истории не подтверждена.", 502);
      const map = new Map(previous.items.map(item => [item.id, item]));
      if (page > 1 && items.length && items.every(item => map.has(item.id))) fail("Rusender повторил страницу. Полнота истории не подтверждена.", 502);
      items.forEach(item => map.set(item.id, item));
      const stage = { items: [...map.values()], generation, page, totalPages };
      const complete = page >= totalPages;
      if (complete && Number.isFinite(Number(pagination?.totalItems)) && stage.items.length !== Number(pagination.totalItems)) fail("Число записей изменилось во время загрузки. Повторите синхронизацию для полного аудита.", 409);
      await write(`stage:${resource}`, stage, connection);
      if (complete) await write(`dataset:${resource}`, { items: stage.items, complete: true, syncedAt: new Date(now()).toISOString() }, connection);
      return { ok: true, complete, nextPage: complete ? null : page + 1, totalPages, count: stage.items.length };
    });
  }
  async function bind({ programId, templateIds }) {
    const programs = await getPrograms();
    if (!programs.some(item => String(item.id) === String(programId))) fail("Программа не найдена в общей базе.");
    const templates = (await read("dataset:templates"))?.items || [];
    if (!Array.isArray(templateIds) || templateIds.length > 100) fail("Некорректный перечень шаблонов.");
    const ids = [...new Set(templateIds.map(id))];
    if (ids.some(value => !value || !templates.some(item => item.id === value))) fail("Шаблон отсутствует в загруженном списке.");
    await write(`binding:${hash(String(programId))}`, { programId: String(programId), templateIds: ids, source: "manual" });
    return { ok: true };
  }
  async function autoBind() {
    const data = await datasets();
    if (!data.templates.complete || !data.campaigns.complete) fail("Сначала полностью обновите шаблоны и историю.");
    const suggestions = suggestBindings(await getPrograms(), data.templates.items, data.campaigns.items);
    let count = 0;
    for (const binding of suggestions) {
      const key = `binding:${hash(binding.programId)}`;
      await locked(key, async connection => {
        if (await read(key, connection)) return; // Preserve manual choices, including explicitly unbound programs.
        await write(key, binding, connection); count++;
      });
    }
    return { ok: true, count };
  }
  async function savePlan(input, actor) {
    if (!uuid(input.id)) fail("Некорректный идентификатор плана.");
    return locked(`plan:${input.id}`, async connection => {
      const old = await read(`plan:${input.id}`, connection);
      if (old) return { ok: true, plan: publicPlan(old) }; // Stable client ID: repeated save never duplicates.
      const program = (await getPrograms()).find(item => String(item.id) === String(input.programId));
      if (!program) fail("Выберите программу.");
      const data = await datasets();
      if (!data.templates.complete || !data.senders.complete || !data.lists.complete) fail("Сначала обновите данные Rusender полностью.");
      const binding = await read(`binding:${hash(String(program.id))}`);
      const templateId = id(input.templateId), senderId = id(input.senderId);
      if (!binding?.templateIds.includes(templateId) || !data.templates.items.some(item => item.id === templateId)) fail("Привяжите выбранный шаблон к программе.");
      if (!data.senders.items.some(item => item.id === senderId && item.verified === "enabled")) fail("Выберите подтверждённого отправителя Rusender.");
      const listIds = [...new Set((Array.isArray(input.listIds) ? input.listIds : []).map(id))];
      if (!listIds.length || listIds.some(value => !data.lists.items.some(item => item.id === value))) fail("Выберите списки получателей Rusender.");
      const subject = text(input.subject, 250).trim();
      if (!subject || !text(input.name, 250).trim()) fail("Заполните название и тему письма.");
      const plan = { id: input.id, programId: String(program.id), programName: program.name, name: text(input.name, 250).trim(), subject, templateId, senderId, listIds, scheduledAt: validateSchedule(input.scheduledAt, now()), state: "draft", createdAt: new Date(now()).toISOString(), createdBy: text(actor, 160), campaignId: null };
      await write(`plan:${input.id}`, plan, connection);
      return { ok: true, plan: publicPlan(plan) };
    });
  }
  async function action(planId, actionName, body = {}) {
    if (!uuid(planId)) fail("План не найден.", 404);
    return locked(`plan:${planId}`, async connection => {
      const key = `plan:${planId}`;
      const plan = await read(key, connection);
      if (!plan) fail("План не найден.", 404);
      if (actionName === "cancel") {
        if (plan.campaignId || !["draft", "cancelled"].includes(plan.state)) fail("Рассылка уже передана в Rusender. Для отмены откройте её в сервисе и проверьте статус.");
        plan.state = "cancelled"; await write(key, plan, connection);
        return { ok: true };
      }
      if (plan.state === "cancelled") fail("План отменён.");
      if (actionName === "draft") {
        if (!plan.campaignId) {
          if (!["draft", "creating"].includes(plan.state)) fail("Недопустимое состояние плана.", 409);
          if (plan.createStartedAt && now() - plan.createStartedAt > 15 * 60000) fail("Результат прежнего создания не подтверждён. Проверьте черновики в Rusender; автоматический повтор спустя 15 минут заблокирован во избежание дубля.", 409);
          plan.createStartedAt ||= now();
          plan.state = "creating"; await write(key, plan, connection);
          const response = await api(RESOURCES.campaigns, { method: "POST", key: `create-${plan.id}`, data: { name: plan.name, subject: plan.subject, templateId: plan.templateId, senderId: plan.senderId, listIds: plan.listIds } });
          if (!id(response.data.id)) fail("Rusender не вернул ID. Повторите ту же операцию, не создавая новый план.", 502);
          plan.campaignId = id(response.data.id); plan.dashboardUrl = dashboardUrl(response.data.dashboardUrl); plan.state = "created";
          await write(key, plan, connection);
        }
        return { ok: true, plan: publicPlan(plan) };
      }
      if (!plan.campaignId) fail("Сначала создайте черновик в Rusender.");
      if (actionName === "schedule" && plan.state === "scheduled") return { ok: true, plan: publicPlan(plan) };
      const campaign = (await api(`${RESOURCES.campaigns}/${plan.campaignId}`)).data;
      if (actionName === "schedule" && plan.state === "scheduling" && String(campaign.status).toLowerCase() !== "draft") {
        // The previous schedule call may have succeeded before its response was lost.
        if (Date.parse(campaign.scheduledAt) !== Date.parse(plan.scheduledAt)) fail("Состояние рассылки изменилось в Rusender. Проверьте её расписание в сервисе; повторная отправка не выполнялась.", 409);
        plan.state = "scheduled"; plan.remoteStatus = text(campaign.status, 80);
        await write(key, plan, connection); return { ok: true, plan: publicPlan(plan) };
      }
      if (String(campaign.status).toLowerCase() !== "draft") fail("Рассылка уже не черновик. Проверьте состояние в Rusender; повторная отправка не выполнялась.", 409);
      const template = (await api(`/v1/public/templates/${id(campaign.templateId)}`)).data;
      const fingerprint = hash({ campaign: { id: campaign.id, templateId: campaign.templateId, subject: campaign.subject, senderId: campaign.senderId, senderEmail: campaign.senderEmail, lists: campaign.lists, attachments: campaign.attachments, updatedAt: campaign.updatedAt }, html: template.html, text: template.text, scheduledAt: plan.scheduledAt });
      if (actionName === "preview") {
        plan.approval = { token: crypto.randomUUID(), fingerprint, expires: now() + 10 * 60000 };
        await write(key, plan, connection);
        return { ok: true, plan: publicPlan(plan), campaign: publicItem("campaigns", campaign), senderEmail: text(campaign.senderEmail, 320), html: text(template.html, 2000000), plainText: text(template.text, 2000000), confirmation: plan.approval.token };
      }
      if (actionName !== "schedule") fail("Операция не поддерживается.", 404);
      if (!plan.approval || body.confirmation !== plan.approval.token || plan.approval.expires < now() || plan.approval.fingerprint !== fingerprint) fail("Предпросмотр устарел или письмо изменено в Rusender. Просмотрите его повторно.", 409);
      validateSchedule(plan.scheduledAt, now());
      if (id(campaign.templateId) !== plan.templateId || id(campaign.senderId) !== plan.senderId || text(campaign.subject) !== plan.subject || JSON.stringify((campaign.lists || []).map(item => id(item.id)).sort()) !== JSON.stringify([...plan.listIds].sort())) fail("Черновик изменён в Rusender. Создайте новый план с актуальными данными.", 409);
      plan.state = "scheduling"; await write(key, plan, connection);
      const response = await api(`${RESOURCES.campaigns}/${plan.campaignId}/schedule`, { method: "POST", key: `schedule-${plan.id}`, data: { scheduledStartDate: plan.scheduledAt } });
      plan.state = "scheduled"; plan.remoteStatus = text(response.data.status, 80); plan.activatedAt = new Date(now()).toISOString();
      delete plan.approval; await write(key, plan, connection);
      return { ok: true, plan: publicPlan(plan) };
    });
  }
  return { snapshot, configure, syncPage, bind, autoBind, savePlan, action };
}
module.exports = { createService, publicItem, suggestBindings, validateSchedule, normalizedName };
