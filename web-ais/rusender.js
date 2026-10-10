"use strict";
// Server-only integration. Credentials never enter shared application state or API responses.
const crypto = require("node:crypto");
const BASE = "https://api.rusender.ru/api";
const RESOURCES = Object.freeze({ campaigns: "/v1/public/campaigns", templates: "/v2/public/templates", lists: "/v1/public/lists", senders: "/v1/public/senders" });
// Documented v2 list currently returns 404 on some Rusender deployments.
const LEGACY_TEMPLATES = "/v1/public/templates";
const RESOURCE_ACCESS = Object.freeze({ campaigns: ["рассылки", "campaigns.read"], templates: ["шаблоны", "templates.read"], lists: ["списки получателей", "contacts.read"], senders: ["отправители", "senders.read"] });
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

// Matching is local to AIS: letter text is never sent to an external AI service.
// HTML is converted to plain search text, not executed or rendered.
function templateText(row) {
  const source = text(row.html, 2000000).replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  const entities = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", laquo: "«", raquo: "»", ndash: "—", mdash: "—" };
  return `${text(row.text, 100000)} ${source}`.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
    if (!entity.startsWith("#")) return entities[entity.toLowerCase()] || " ";
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " ";
  }).replace(/\s+/g, " ").trim().slice(0, 60000);
}
function hasTemplateContent(row) { return typeof row.html === "string" || typeof row.text === "string"; }
function wordRoot(word) {
  if (/^стат(?:ья|ьи|ье|ью|ей|ьям|ьями|ьях)$/.test(word)) return "статья";
  if (/^нейросет/.test(word)) return "нейросеть";
  if (/^нейронн/.test(word)) return "нейронн";
  return word.length > 5 ? word.replace(/(?:иями|ями|ами|ого|его|ому|ему|ыми|ими|иях|ах|ях|иям|ий|ый|ой|ая|яя|ое|ее|ые|ие|ую|юю|ов|ев|ам|ям|ом|ем|ей|ия|ию|ии|а|я|ы|и|у|ю|е|о|ь)$/u, "") : word;
}
const CONTEXT_STOP = new Set("в на и или по с со из для о об от до к ко у за при через без под над это как что чтобы вы ваш мы наш все этот тот добрый день здравствуйте уважаемый приглашаем приглашение запись зарегистрироваться регистрация участие участник обучение образовательный образование программа курс семинар вебинар онлайн он лайн мастер класс повышение квалификация профессиональный переподготовка дополнительный общеобразовательный дистанционный очный центр учебный цифровизация плюс письмо рассылка шаблон копия скидка цена стоимость акция бесплатно руб рублей час часов ч подробнее сайт ссылка нажмите отписаться рассмотреть предложение предложение добрый будет состоится начало дата время мск январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь год 2026".split(" ").map(wordRoot));
function contextWords(value) {
  return (text(value, 60000).normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/https?:\/\/\S+|\S+@\S+/g, " ").match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => word.length > 1 && !/^\d+$/.test(word)).map(wordRoot).filter(word => !CONTEXT_STOP.has(word));
}
function contextDocument(value, label) {
  const words = contextWords(value), positions = new Map();
  words.forEach((word, index) => { const items = positions.get(word) || []; items.push(index); positions.set(word, items); });
  return { words, positions, label };
}
function recommendTemplates(programs, templates, campaigns) {
  const titles = new Map();
  for (const campaign of campaigns) {
    const items = titles.get(id(campaign.templateId)) || [];
    items.push(campaign.subject, campaign.name); titles.set(id(campaign.templateId), items);
  }
  const documents = templates.map(template => ({ template,
    fields: [contextDocument(template.name, "Название шаблона"), ...[...new Set(titles.get(id(template.id)) || [])].filter(Boolean).map(value => contextDocument(value, "Тема / название рассылки")), contextDocument(template.contextText || "", "Текст письма")],
    hours: new Set([...`${template.name} ${template.contextText || ""}`.matchAll(/\b(\d{1,4})\s*(?:час[а-я]*|ч(?![а-я]))/giu)].map(match => Number(match[1])))
  }));
  const queries = programs.map(program => ({ program, words: [...new Set(contextWords(program.name))] }));
  const frequency = new Map(), index = new Map();
  for (const { words } of queries) for (const word of words) frequency.set(word, (frequency.get(word) || 0) + 1);
  documents.forEach((doc, i) => {
    for (const word of new Set(doc.fields.flatMap(field => [...field.positions.keys()]))) { const hits = index.get(word) || []; hits.push(i); index.set(word, hits); }
  });
  const result = [];
  for (const { program, words } of queries) {
    if (!words.length) continue;
    const weight = word => 1 + Math.log(1 + programs.length / (frequency.get(word) || 1)) + Math.log(1 + documents.length / (index.get(word)?.length || 1));
    const total = words.reduce((sum, word) => sum + weight(word), 0);
    const possible = new Set(words.flatMap(word => index.get(word) || []));
    const candidates = [];
    for (const i of possible) {
      const doc = documents[i], evidence = [];
      for (const field of doc.fields) {
        const hits = words.flatMap(word => (field.positions.get(word) || []).map(position => ({ word, position }))).sort((a, b) => a.position - b.position);
        let best = null;
        for (let start = 0, end = 0; start < hits.length; start++) {
          while (end < hits.length && hits[end].position - hits[start].position <= 55) end++;
          const matched = [...new Set(hits.slice(start, end).map(hit => hit.word))];
          if (matched.length < Math.min(words.length, 2)) continue;
          const coverage = matched.reduce((sum, word) => sum + weight(word), 0) / total;
          const precision = matched.length / Math.max(matched.length, Math.min(field.words.length, 55));
          const score = Math.round(100 * coverage * (0.84 + 0.16 * precision));
          if (!best || score > best.score) best = { score, label: field.label, matched };
        }
        if (best && best.score >= 65) evidence.push(best);
      }
      if (!evidence.length) continue;
      evidence.sort((a, b) => b.score - a.score);
      let score = Math.min(100, evidence[0].score + (new Set(evidence.map(item => item.label)).size > 1 ? 3 : 0));
      const hours = Number(program.hours), hoursMatch = hours > 0 && doc.hours.has(hours);
      if (hours > 0 && doc.hours.size && !hoursMatch) score -= 30;
      if (score < 65) continue;
      candidates.push({ templateId: id(doc.template.id), score, reasons: [...new Set(evidence.map(item => item.label))], hoursMatch });
    }
    candidates.sort((a, b) => b.score - a.score || a.templateId - b.templateId);
    if (!candidates.length) continue;
    const best = candidates[0];
    const similarPrograms = queries.filter(other => String(other.program.id) !== String(program.id) && other.words.length === words.length && other.words.every(word => words.includes(word)));
    const variantAmbiguous = similarPrograms.some(other => !best.hoursMatch || Number(other.program.hours) === Number(program.hours));
    const ambiguous = variantAmbiguous || Boolean(candidates[1] && best.score - candidates[1].score < 8);
    result.push({ programId: String(program.id), templateId: best.templateId, score: best.score, reasons: best.reasons, ambiguous, variantAmbiguous, candidates: candidates.slice(0, 3) });
  }
  return result;
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
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok !== true || !body.data) {
        const code = /^[A-Z0-9_]{1,80}$/.test(body?.error?.code || "") ? ` (${body.error.code})` : "";
        const route = path.split("?")[0];
        const resource = route.match(/^\/v[12]\/public\/(campaigns|templates|lists|senders)(?:\/|$)/)?.[1];
        const [label, readScope] = RESOURCE_ACCESS[resource] || ["данные", ""];
        const scope = method === "GET" ? readScope : resource === "campaigns" ? "campaigns.write" : "";
        let detail = "Проверьте данные в кабинете сервиса.";
        if (body?.error?.code === "INVALID_API_TOKEN" || response.status === 401) detail = "Rusender не принял API-ключ. Проверьте, что он активен и скопирован полностью.";
        else if (body?.error?.code === "SCOPE_REQUIRED") detail = `У ключа нет нужного разрешения${scope ? ` ${scope}` : ""}. Добавьте его в настройках ключа Rusender.`;
        else if (body?.error?.code === "PUBLIC_API_DISABLED") detail = "Публичный API отключён для аккаунта Rusender. Проверьте доступ к API в кабинете сервиса.";
        else if (response.status === 403) detail = `Rusender запретил доступ. Проверьте разрешение${scope ? ` ${scope}` : ""} и доступ аккаунта к API.`;
        else if (response.status === 404) detail = "Метод API или запрошенная запись не найдены. Это не означает, что API-ключ неверен.";
        // Only our fixed route and a bounded code, never provider messages or credentials.
        throw Object.assign(new Error(`Rusender — ${label}: HTTP ${response.status}${code}, ${method} ${route}. ${detail}`), { statusCode: [401, 403].includes(response.status) ? 403 : 502, providerStatus: response.status });
      }
      return body;
    } catch (error) {
      if (error.statusCode) throw error;
      // No provider body/URL/token in logs or user-facing exception.
      fail("Нет ответа Rusender за 20 секунд или соединение прервано. Обновите состояние; повтор операции защищён от дублирования.", 504);
    } finally { clearTimeout(timer); }
  }
  async function listApi(resource, query, { token, endpoint } = {}) {
    const selected = endpoint || RESOURCES[resource];
    if (selected !== RESOURCES[resource] && !(resource === "templates" && selected === LEGACY_TEMPLATES)) fail("Неизвестный метод загрузки Rusender.", 409);
    try {
      return { response: await api(`${selected}?${query}`, { token }), endpoint: selected };
    } catch (error) {
      // Read-only compatibility fallback, never retry denied access or a write.
      // Pin the selected endpoint for every later page of this generation.
      if (resource !== "templates" || endpoint || error.providerStatus !== 404) throw error;
      return { response: await api(`${LEGACY_TEMPLATES}?${query}`, { token }), endpoint: LEGACY_TEMPLATES };
    }
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
    const pendingTemplateIds = data.templates.complete ? data.templates.items.filter(item => item.contextVersion !== 1).map(item => item.id) : [];
    return { ok: true, connected: Boolean((await read("secret"))?.token), ...data,
      // Full letter text stays in the server cache; only scores/reasons go to the UI.
      templates: { ...data.templates, items: data.templates.items.map(item => publicItem("templates", item)) },
      templateContext: { pendingTemplateIds, total: data.templates.items.length, checked: data.templates.items.filter(item => item.contextVersion === 1).length },
      recommendations: recommendTemplates(programs, data.templates.items, data.campaigns.items),
      programs, bindings: await all("binding"), plans: (await all("plan")).map(publicPlan), suggestions: suggestBindings(programs, data.templates.items, data.campaigns.items) };
  }
  async function templateContext({ templateIds }) {
    if (!Array.isArray(templateIds) || !templateIds.length || templateIds.length > 3 || templateIds.some(value => !id(value))) fail("Выберите до трёх шаблонов для одного этапа анализа.");
    return locked("sync:templates", async connection => {
      const dataset = await read("dataset:templates", connection);
      if (!dataset?.complete) fail("Сначала полностью загрузите список шаблонов.", 409);
      const selected = [...new Set(templateIds.map(id))].map(value => dataset.items.find(item => item.id === value));
      if (selected.some(item => !item)) fail("Список шаблонов изменился. Обновите данные и повторите подбор.", 409);
      const updates = await Promise.all(selected.filter(item => item.contextVersion !== 1).map(async item => {
        const detail = (await api(`/v1/public/templates/${item.id}`)).data;
        if (id(detail.id) !== item.id || !hasTemplateContent(detail)) fail("Rusender не вернул содержимое выбранного шаблона. Повторите загрузку позже.", 502);
        return { ...item, contextText: templateText(detail), contextVersion: 1 };
      }));
      dataset.items = dataset.items.map(item => updates.find(update => update.id === item.id) || item);
      if (updates.length) await write("dataset:templates", dataset, connection);
      return { ok: true, checked: selected.length };
    });
  }
  async function configure(token) {
    token = String(token || "").trim();
    if (!/^rs_ck_v1_[A-Za-z0-9_-]{16,500}$/.test(token)) fail("Укажите публичный API-ключ Rusender вида rs_ck_v1_… (не пароль аккаунта).");
    await Promise.all(Object.keys(RESOURCES).map(resource => listApi(resource, "page=1&limit=1", { token })));
    await write("secret", { token, configuredAt: new Date(now()).toISOString() });
    return { ok: true, connected: true };
  }
  async function syncPage({ resource, page, generation }) {
    if (!Object.hasOwn(RESOURCES, resource) || !uuid(generation) || !Number.isInteger(page) || page < 1 || page > 1000) fail("Некорректный этап синхронизации.");
    return locked(`sync:${resource}`, async connection => {
      const previous = page === 1 ? { items: [], generation, page: 0 } : await read(`stage:${resource}`, connection);
      if (!previous || previous.generation !== generation || previous.page !== page - 1) fail("Синхронизация изменена в другой копии АИС. Начните обновление заново.", 409);
      const { response, endpoint } = await listApi(resource, `page=${page}&limit=100${resource === "campaigns" ? "&withStats=true" : ""}`, { endpoint: page > 1 ? previous.endpoint || RESOURCES[resource] : undefined });
      if (!Array.isArray(response.data.items)) fail("Rusender вернул неизвестный формат списка. Сохранённые данные не изменены.", 502);
      const cached = resource === "templates" ? (await read("dataset:templates", connection))?.items || [] : [];
      const items = response.data.items.map(item => {
        const clean = publicItem(resource, item);
        if (resource === "templates") {
          if (hasTemplateContent(item)) Object.assign(clean, { contextText: templateText(item), contextVersion: 1 });
          else {
            const old = cached.find(value => value.id === clean.id);
            if (clean.updatedAt && old?.updatedAt === clean.updatedAt && old.contextVersion === 1) Object.assign(clean, { contextText: old.contextText, contextVersion: 1 });
          }
        }
        return clean;
      });
      if (items.some(item => !item.id)) fail("В ответе Rusender нет идентификаторов. Сохранённые данные не изменены.", 502);
      const pagination = response.meta?.pagination;
      const totalPages = pagination ? Number(pagination.totalPages) : 1;
      if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > 1000 || (pagination && Number(pagination.page) !== page)) fail("Некорректная пагинация Rusender. Полнота истории не подтверждена.", 502);
      const map = new Map(previous.items.map(item => [item.id, item]));
      if (page > 1 && items.length && items.every(item => map.has(item.id))) fail("Rusender повторил страницу. Полнота истории не подтверждена.", 502);
      items.forEach(item => map.set(item.id, item));
      const stage = { items: [...map.values()], generation, page, totalPages, endpoint };
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
  return { snapshot, configure, syncPage, templateContext, bind, autoBind, savePlan, action };
}
module.exports = { createService, publicItem, suggestBindings, recommendTemplates, templateText, validateSchedule, normalizedName };
