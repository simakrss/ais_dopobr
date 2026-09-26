"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const SITES = Object.freeze({edu: "https://edu-plus.ru", shop: "https://zifra-plus.ru"});
const API_PATH = "/wp-json/ais-program-sites/v1";
const KEY_FILE = "program-site-keys.json";
const PROGRAM_TYPES = Object.freeze({
  "ПРО": {postType: "other-course", base: "other_course", label: "Онлайн семинар", template: "Сертификат ПРО.docx", templateId: "education-document-certificate-dop-pro", bilingual: true},
  "ДОП": {postType: "other-course", base: "other_course", label: "Дополнительная общеобразовательная программа", template: "Сертификат ДОП.docx", templateId: "education-document-certificate-dop", bilingual: true},
  "КПК": {postType: "courses-pk", base: "courses-pk", label: "Курс повышения квалификации", template: "Удостоверение о повышении квалификации_v1.docx", templateId: "education-document-certificate-kpk", bilingual: false},
  "ППП": {postType: "courses-pp", base: "courses-pp", label: "Курс профессиональной переподготовки", template: "Диплом о переподготовке_v1.docx", templateId: "education-document-diploma-ppp", bilingual: false}
});
function programType(program) {
  const type = text(program?.type).toUpperCase();
  if (!Object.hasOwn(PROGRAM_TYPES, type)) fail("Генератор поддерживает ПРО, ДОП, КПК и ППП.");
  return type;
}
function withTrainingPlan(program, data) {
  const rows = Array.isArray(data?.collections?.trainingPlans) ? data.collections.trainingPlans : [];
  const linked = rows.filter(row => String(row.programId || "") === String(program.id));
  const named = rows.filter(row => !row.programId && text(row.programName) === text(program.name));
  return {...program, siteTrainingPlan: (linked.length ? linked : named).map(row => ({
    discipline: text(row.discipline || row.code), content: text(row.content), totalHours: text(row.totalHours),
    theoryHours: text(row.theoryHours), practiceHours: text(row.practiceHours), attestation: text(row.attestation)
  }))};
}

function fail(message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  throw error;
}

function text(value, max = 30000) {
  const result = String(value ?? "").trim();
  if (result.length > max) fail(`Текст превышает допустимую длину (${max}).`);
  return result;
}

function normalizeJoinUrl(value) {
  let url;
  try { url = new URL(text(value, 2000)); } catch { fail("Вставьте полную HTTPS-ссылку подключения к SberJazz."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal|test)$/i.test(url.hostname)) {
    fail("Ссылка подключения должна вести на внешний HTTPS-сайт, без логина и пароля в адресе.");
  }
  return url.href;
}

function landingCodeFromName(name) {
  const latin = ['a', 'b', 'v', 'g', 'd', 'e', 'yo', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'h', 'ts', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya'];
  const letters = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
  const slug = text(name, 500).toLowerCase().replace(/[а-яё]/g, char => latin[letters.indexOf(char)])
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80).replace(/^-+|-+$/g, '');
  return slug.length >= 2 ? slug : `programma${slug ? '-' + slug : ''}`;
}

function landingCodeFromPromoSite(value) {
  const source = text(value, 2000);
  if (!source) return "";
  let slug = source.replace(/^\/+|\/+$/g, "");
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(slug)) {
    try {
      if (!/^(?:https?:\/\/|\/(?!\/)|(?:www\.)?edu-plus\.ru\/)/i.test(source)) throw new Error();
      const url = new URL(source.startsWith("/") ? source : /^(?:www\.)?edu-plus\.ru\//i.test(source) ? `https://${source}` : source, SITES.edu);
      if (!/^https?:$/.test(url.protocol) || !/^(?:www\.)?edu-plus\.ru$/i.test(url.hostname) || url.username || url.password || url.port
        || url.searchParams.has("p") || url.searchParams.has("page_id")) throw new Error();
      slug = decodeURIComponent(url.pathname).split("/").filter(Boolean).at(-1) || "";
    } catch { slug = ""; }
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(slug)) fail("В поле «На промо сайте» укажите постоянную ссылку edu-plus.ru или код страницы (например, web_nazv).");
  return slug;
}

// Read-only allocation. The caller must save the result in the shared program
// before prepare writes any certificate, product or landing (including retries).
async function suggestLandingCode(program, call) {
  const promoCode = landingCodeFromPromoSite(program.promoSite);
  const current = String(program.landingCode || '').trim().replace(/^\/+|\/+$/g, '');
  const candidate = promoCode || (/^[a-z0-9][a-z0-9_-]{1,79}$/.test(current) ? current : landingCodeFromName(program.name));
  const model = normalizeProgram({...program, landingCode: candidate});
  const result = await call('edu', '/landing-code', {key: model.key, slug: model.slug, postType: model.postType, exact: Boolean(promoCode)});
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(result?.slug || '')) fail('Сайт не подтвердил свободный код лендинга. Повторите подготовку.', 502);
  if (promoCode && result.slug !== promoCode) fail('Сайт не подтвердил адрес из поля «На промо сайте». Обновите служебный модуль и повторите подготовку.', 409);
  return {ok: true, landingCode: result.slug};
}

function normalizeProgram(program = {}) {
  const type = programType(program);
  const spec = PROGRAM_TYPES[type];
  const webinar = type === "ПРО";
  const id = text(program.id, 200);
  if (!id) fail("Сначала сохраните образовательную программу.");
  const name = text(program.name, 500);
  const productName = text(program.siteProductName || name, 500);
  if (!name || !productName) fail("Заполните название программы.");
  if (Array.from(productName).length > 128) fail("Название товара превышает 128 символов. Укажите более короткое название в параметрах генератора «Создать на сайте».");
  const slug = landingCodeFromPromoSite(program.promoSite) || text(program.landingCode, 100).replace(/^\/+|\/+$/g, "");
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(slug)) fail("Код лендинга: от 2 до 80 символов — строчные латинские буквы, цифры, дефис и подчёркивание.");
  const date = webinar ? text(program.webinarDate, 10) : "";
  const parsedDate = new Date(`${date}T12:00:00Z`);
  if (webinar && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date)) fail("Укажите корректную дату вебинара.");
  const time = webinar ? text(program.webinarTime, 5) : "";
  if (webinar && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) fail("Укажите время вебинара в формате ЧЧ:ММ (Москва).");
  const price = Number(program.price);
  const oldPrice = Number(program.oldPrice || 0);
  const hours = Number(program.hours);
  if (!Number.isFinite(price) || price < 0 || price > 10000000) fail("Укажите корректную стоимость программы.");
  if (!Number.isFinite(oldPrice) || oldPrice < 0 || oldPrice > 10000000) fail("Проверьте старую цену.");
  if (!Number.isFinite(hours) || hours <= 0 || hours > 10000) fail("Укажите положительное количество часов.");
  return {
    key: crypto.createHash("sha256").update(`ais-program:${id}`).digest("hex"),
    id, type, postType: spec.postType, name, nameEnglish: text(program.nameEnglish || program["Название программы на английском"], 1000), productName, slug, date, time, price, oldPrice, hours,
    joinUrl: webinar ? normalizeJoinUrl(program.webinarJoinUrl) : "",
    duration: text(program.duration, 200), studyForm: text(program.studyForm || "Дистанционная", 300), trainingPlan: program.siteTrainingPlan || [],
    landingUrl: `${SITES.edu}/${spec.base}/${slug}/`,
    startLabel: text(program.siteStartLabel, 200),
    dateLabel: webinar ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)} в ${time} (МСК)` : text(program.siteStartLabel, 200)
  };
}

function signature(secret, method, resource, timestamp, nonce, body) {
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  return crypto.createHmac("sha256", secret).update([method, resource, timestamp, nonce, digest].join("\n")).digest("hex");
}

async function readKeys(storageRoot) {
  let keys;
  try { keys = JSON.parse(await fs.readFile(path.join(storageRoot, KEY_FILE), "utf8")); }
  catch { fail("Служебные модули сайтов ещё не подключены. Требуется установка модуля генератора администратором.", 503); }
  if (![keys?.edu, keys?.shop].every(key => typeof key === "string" && /^[a-f0-9]{64}$/.test(key))) fail("Ключи связи с сайтами повреждены. Обратитесь к администратору.", 503);
  return keys;
}

function createClient(keys, fetchImpl = fetch) {
  return async (site, endpoint, payload) => {
    if (!Object.hasOwn(SITES, site) || !/^\/[a-z0-9/?=&_-]+$/i.test(endpoint)) fail("Недопустимый адрес операции.");
    const method = payload === undefined ? "GET" : "POST";
    const resource = `${API_PATH}${endpoint}`;
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString("hex");
    let response;
    try {
      response = await fetchImpl(`${SITES[site]}${resource}`, {
        method, redirect: "manual", signal: AbortSignal.timeout(35000),
        headers: {"Content-Type": "application/json", "X-AIS-Timestamp": timestamp, "X-AIS-Nonce": nonce,
          "X-AIS-Signature": signature(keys[site], method, resource, timestamp, nonce, body)},
        ...(body ? {body} : {})
      });
    } catch { fail(`Не удалось связаться с ${new URL(SITES[site]).hostname}. Повторный запуск продолжит операцию без создания копий.`, 502); }
    const raw = await response.text();
    if (raw.length > 4 * 1024 * 1024) fail("Сайт вернул слишком большой ответ.", 502);
    let result;
    try { result = JSON.parse(raw); } catch { fail(`${new URL(SITES[site]).hostname}: служебный модуль недоступен (HTTP ${response.status}).`, 502); }
    if (!response.ok) {
      const message = result?.code?.startsWith("ais_pg_") ? text(result.message, 1000) : `Сайт отклонил запрос (HTTP ${response.status}). Проверьте установку модуля генератора.`;
      fail(`${new URL(SITES[site]).hostname}: ${message}`, response.status >= 500 ? 502 : 409);
    }
    return result;
  };
}

function validateTemplateId(value) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) fail("Выберите прототип лендинга: это обязательное поле.");
  return Number(value);
}

function validateImageSourceId(value) {
  if (value === undefined || value === null || value === "" || value === 0 || value === "0") return 0;
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) fail("Выберите лендинг — источник изображения.");
  return Number(value);
}

async function loadImageSource(value, call) {
  const id = validateImageSourceId(value);
  if (!id) return null;
  const source = await call("edu", `/image-source/${id}`);
  if (Number(source?.id) !== id || !Number.isSafeInteger(source.imageId) || source.imageId < 1
    || !/^https:\/\/edu-plus\.ru\/wp-content\/uploads\/[^?#\r\n]+\.(?:jpe?g|png|webp)$/i.test(source.imageUrl || "")
    || !/^[a-f0-9]{64}$/.test(source.version || "")) fail("Источник не содержит доступного изображения записи. Выберите другой лендинг.");
  return {id, imageId: source.imageId, imageUrl: source.imageUrl, version: source.version, title: source.title};
}

// Match visible text, but edit only the date/time tokens at their original offsets.
// Tags, attributes, entities, links and the prototype's formatting stay untouched.
function updateWebinarSchedule(value, model, name = "") {
  if (model.type !== "ПРО" || name === "blok_opisaniya_kursa" || /otzyv|review/i.test(name)) return structuredClone(value);
  if (Array.isArray(value)) return value.map(item => updateWebinarSchedule(item, model, name));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, updateWebinarSchedule(item, model, key)]));
  if (typeof value !== "string") return value;
  const months = "января февраля марта апреля мая июня июля августа сентября октября ноября декабря".split(" ");
  const [year, month, day] = model.date.split("-");
  const [hour, minute] = model.time.split(":");
  const shadow = value.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]*>|&(?:nbsp|#160|#x0*a0|#32|#x20);/gi, match => " ".repeat(match.length));
  const pattern = new RegExp(`(?<![\\p{L}\\d])(?:(?<isoYear>20\\d{2})\\s*-\\s*(?<isoMonth>0?[1-9]|1[0-2])\\s*-\\s*(?<isoDay>0?[1-9]|[12]\\d|3[01])|(?<day>0?[1-9]|[12]\\d|3[01])\\s*(?:[./-]|\\s+)\\s*(?<month>${months.join("|")}|0?[1-9]|1[0-2])\\s*(?:[./-]|\\s+)\\s*(?<year>20\\d{2}))(?!\\d)`, "gidu");
  const timePattern = /^\s*(?:года|год|г\.)?\s*(?:[,—–-]\s*)?(?:в\s*)?(?<hour>[01]?\d|2[0-3])\s*[:.]\s*(?<minute>[0-5]\d)(?!\d)/idu;
  const edits = [];
  const add = (match, token, replacement, offset = 0) => {
    const range = match.indices.groups[token];
    if (range) edits.push({start: offset + range[0], end: offset + range[1], replacement});
  };
  for (const match of shadow.matchAll(pattern)) {
    const g = match.groups, end = match.index + match[0].length;
    const oldMonth = g.isoMonth || (/^\d+$/.test(g.month) ? g.month : months.indexOf(g.month.toLowerCase()) + 1);
    const oldDate = `${g.isoYear || g.year}-${String(oldMonth).padStart(2, "0")}-${(g.isoDay || g.day).padStart(2, "0")}`;
    const parsed = new Date(`${oldDate}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== oldDate) continue;
    const timeMatch = shadow.slice(end).match(timePattern);
    const context = shadow.slice(Math.max(0, match.index - 160), match.index);
    if (!["opisanie_dokumenta", "opisanie_o_programme", "descriptionHtml", "post_content", "post_excerpt"].includes(name)
      && !timeMatch && !/расписани|трансляци|начало|состоится|дата\s+(?:вебинара|семинара|проведения)/iu.test(context)) continue;
    add(match, "isoYear", year); add(match, "isoMonth", month); add(match, "isoDay", day);
    add(match, "year", year); add(match, "day", g.day?.length === 2 ? day : String(Number(day)));
    let monthLabel = months[Number(month) - 1];
    if (g.month && !/^\d+$/.test(g.month)) {
      if (g.month === g.month.toUpperCase()) monthLabel = monthLabel.toUpperCase();
      else if (g.month[0] === g.month[0].toUpperCase()) monthLabel = monthLabel[0].toUpperCase() + monthLabel.slice(1);
    } else monthLabel = g.month?.length === 2 ? month : String(Number(month));
    add(match, "month", monthLabel);
    if (timeMatch) { add(timeMatch, "hour", hour, end); add(timeMatch, "minute", minute, end); }
  }
  // A separate time line is common when the date and time are in different blocks.
  const separateTime = /(?:время\s*(?:начала|трансляции|вебинара)?|начало\s*(?:трансляции|вебинара)?)\s*[:—–-]?\s*(?:в\s*)?(?<hour>[01]?\d|2[0-3])\s*[:.]\s*(?<minute>[0-5]\d)(?!\d)/gidu;
  for (const match of shadow.matchAll(separateTime)) { add(match, "hour", hour); add(match, "minute", minute); }
  let updated = value, boundary = value.length;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    if (edit.end > boundary) continue;
    updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
    boundary = edit.start;
  }
  return updated;
}

async function loadPrototypeModel(program, templateId, call) {
  const model = normalizeProgram(program);
  const template = await call("edu", `/template/${validateTemplateId(templateId)}`);
  const imageSource = await loadImageSource(program.siteImageSourceId, call);
  if (imageSource) model.imageSource = imageSource;
  if (template.postType && template.postType !== model.postType && model.type !== "ДОП") fail("Выберите прототип соответствующего вида программы.");
  const fields = template.fields || {};
  // Keep the prototype's start wording for every program type, including webinars.
  // Webinar date/time still update the broadcast schedule independently.
  if (!model.startLabel && typeof fields.data_starta === "string") model.startLabel = text(fields.data_starta, 200);
  if (model.type !== "ПРО") model.dateLabel = model.startLabel;
  // Image delivery is independent of the reviewed document/price payload, so adding
  // it must not invalidate already prepared drafts on either website.
  const prototypeForHash = {...template};
  delete prototypeForHash.imageUrl;
  // Re-prepare older webinar drafts even when only post_content/excerpt had dates.
  if (model.type === "ПРО") prototypeForHash.scheduleRevision = 1;
  const description = model.type === "ПРО" ? fields.opisanie_dokumenta : fields.opisanie_o_programme || fields.opisanie_dokumenta;
  return {template, model: {...model, descriptionHtml: updateWebinarSchedule(typeof description === "string" ? description : "", model, "descriptionHtml"),
    speakerHtml: updateWebinarSchedule(typeof fields.tekst_etap_obucheniya_1 === "string" ? fields.tekst_etap_obucheniya_1 : "", model, "tekst_etap_obucheniya_1"),
    prototypeHash: crypto.createHash("sha256").update(JSON.stringify(prototypeForHash)).digest("hex")}};
}

function buildLandingFields(template, model, productId, certificates) {
  if (!Number.isSafeInteger(Number(productId)) || Number(productId) < 1) fail("Магазин не вернул корректный ID товара.");
  const checkoutUrl = `${SITES.shop}/checkout/?add-to-cart=${Number(productId)}`;
  let registrationLinks = 0;
  const replacements = {
    podacha_zayavki_nazvanie_kursa: model.name,
    naimenovanie_kursa: PROGRAM_TYPES[model.type].label, zagolovok_dokument: model.type === "ПРО" ? "Онлайн семинар" : "Описание курса",
    stoimost_kursa: String(model.price), kolichestvo_chasov: String(model.hours),
    staraya_cena: model.oldPrice > model.price ? String(model.oldPrice) : "",
    skidka: model.oldPrice > model.price ? String(Math.round(100 * (1 - model.price / model.oldPrice))) : "0",
    data_starta: model.startLabel || (typeof template.fields?.data_starta === "string" ? text(template.fields.data_starta, 200) : ""), forma_obucheniya: model.studyForm,
    srok: model.type === "ПРО" ? "Однократное участие" : model.duration,
    ssylka_smotret_vse_kursy: "/" + PROGRAM_TYPES[model.type].base
  };
  const walk = (value, name = "") => {
    // This ACF repeater holds the actual reviews, including authors' quotations and photos.
    // Never substitute program names or checkout links inside someone else's testimony.
    if (["blok_opisaniya_kursa"].includes(name)
      || /otzyv|review/i.test(name)) return structuredClone(value);
    if (["opisanie_dokumenta", "opisanie_o_programme", "tekst_etap_obucheniya_1"].includes(name)) return updateWebinarSchedule(value, model, name);
    if (name === "ssylka_na_registraciyu") { registrationLinks++; return checkoutUrl; }
    if (Object.hasOwn(replacements, name)) return replacements[name];
    if (Array.isArray(value)) return value.map(item => walk(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, key)]));
    if (typeof value !== "string") return value;
    let updated = template.title ? value.split(template.title).join(model.name) : value;
    updated = updated.replace(/https?:\/\/zifra-plus\.ru\/checkout\/?\?(?:[^\s"'<>]*?&(?:amp;)?)?add-to-cart=\d+/g, () => { registrationLinks++; return checkoutUrl; });
    return updateWebinarSchedule(updated, model, name);
  };
  const fields = walk(template.fields || {});
  if (!registrationLinks) fail("В прототипе не найден блок регистрации интернет-магазина. Выберите другой прототип.");
  if (certificates) {
    if (!PROGRAM_TYPES[model.type].bilingual && !Object.hasOwn(fields, "slajder")) fail("В прототипе отсутствует галерея для всех страниц приложения.");
    const second = PROGRAM_TYPES[model.type].bilingual ? "en" : "page-2";
    const slots = {izobrazhenie_vydavaemogo_dokumenta: "ru", prevyu_vydavaemogo_dokumenta_1: "ru",
      izobrazhenie_vydavaemogo_dokumenta_2: second, prevyu_vydavaemogo_dokumenta_2: second};
    for (const [slot, language] of Object.entries(slots)) {
      if (!Object.hasOwn(fields, slot)) fail("В прототипе не найдены оба блока образцов документов. Выберите другой прототип.");
      const id = Number(certificates.find(image => image.language === language)?.id);
      if (!Number.isSafeInteger(id) || id < 1) fail("Сайт не подтвердил загрузку образцов сертификатов.");
      fields[slot] = id;
    }
    if (Object.hasOwn(fields, "slajder")) fields.slajder = certificates.map(image => ({izobrazhenie_slajda: Number(image.id)}));
  }
  // One saved AIS program creates one offer; do not leave prototype variants/prices behind.
  if (Array.isArray(fields.blok_ceny)) fields.blok_ceny = fields.blok_ceny.slice(0, 1);
  if (model.trainingPlan.length && Object.hasOwn(fields, "programmy_obucheniya")) {
    const base = fields.programmy_obucheniya?.[0] || {};
    fields.programmy_obucheniya = [{...base, zagolovok_programmy_obucheniya: `Программа обучения — ${model.hours} ч.`,
      ssylka_na_programmu_kursa: "", nazvanie_knopki_skachat: "",
      moduli_programmy: model.trainingPlan.map(row => ({nazvanie_modulya: row.discipline, opisanie_modulya: row.content,
        chasy_vsego: row.totalHours, chasy_1: row.theoryHours, chasy_2: row.practiceHours, kontrol: row.attestation}))}];
  }
  return fields;
}

function prototypeProductId(template) {
  const fields = template.fields || {};
  const links = [];
  const collect = (value, name = "") => {
    if (name === "blok_opisaniya_kursa" || /otzyv|review/i.test(name)) return;
    if (name === "ssylka_na_registraciyu" && typeof value === "string") links.push(value);
    else if (Array.isArray(value)) value.forEach(item => collect(item));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => collect(item, key));
  };
  // The generator keeps the first price offer, so its shop product is the prototype.
  collect(fields.blok_ceny);
  collect(fields);
  for (const link of links) {
    let url;
    try { url = new URL(link.replace(/&(?:amp|#0*38|#x0*26);/gi, "&").trim()); } catch { continue; }
    if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "zifra-plus.ru" || url.username || url.password || url.port) continue;
    const ids = url.searchParams.getAll("add-to-cart");
    if (ids.length === 1 && /^[1-9]\d*$/.test(ids[0]) && Number.isSafeInteger(Number(ids[0]))) return Number(ids[0]);
  }
  fail("В прототипе не найдена ссылка регистрации на товар zifra-plus.ru для копирования категорий. Проверьте прототип.");
}

function payloadHash(model, templateId, certificateHash) {
  return crypto.createHash("sha256").update(JSON.stringify({model, templateId: Number(templateId), certificateHash})).digest("hex");
}

async function prepare(program, templateId, call, certificate, report = () => {}) {
  validateTemplateId(templateId);
  report("Загрузка и проверка лендинга-прототипа");
  const {model, template} = await loadPrototypeModel(program, templateId, call);
  // Validate the prototype before creating anything in either website.
  if (!certificate?.hash || typeof certificate.generate !== "function") fail("Автосоздание сертификатов не подключено. Обновите систему.", 503);
  buildLandingFields(template, model, 1, [{language: "ru", id: 1}, {language: PROGRAM_TYPES[model.type].bilingual ? "en" : "page-2", id: 2}]);
  const productTemplateId = prototypeProductId(template);
  const hash = payloadHash(model, templateId, certificate.hash);
  report("Формирование образцов документов об образовании");
  const images = await certificate.generate(report);
  report("Загрузка образцов документов на edu-plus.ru");
  const assets = await call("edu", "/certificate-assets", {key: model.key, hash, type: model.type, certificateHash: certificate.hash, images});
  if (!Array.isArray(assets.images) || assets.images.length !== images.length || images.some((image, index) => assets.images[index]?.language !== image.language)) fail("Сайт не подтвердил загрузку всех страниц образцов документов.", 502);
  buildLandingFields(template, model, 1, assets.images);
  report("Создание черновика товара на zifra-plus.ru");
  const product = await call("shop", "/prepare-product", {...model, hash, productTemplateId, imageUrl: model.imageSource?.imageUrl || template.imageUrl || ""});
  const fields = buildLandingFields(template, model, product.id, assets.images);
  report("Создание лендинга с отзывами и образцами документов");
  const landing = await call("edu", "/prepare-landing", {
    key: model.key, hash, templateId: Number(templateId), templateModified: template.modified,
    title: model.name, type: model.type, slug: model.slug, date: model.date, time: model.time, fields, productId: product.id, certificateHash: certificate.hash,
    certificatePages: assets.images.map(image => ({id: image.id, language: image.language})),
    ...(model.imageSource ? {imageSource: model.imageSource} : {})
  });
  return {
    ok: true, stage: product.status === "publish" && landing.status === "publish" && product.redirectEnabled === true ? "published" : "prepared",
    product, landing, type: model.type, templateId: Number(templateId), imageSourceId: model.imageSource?.id || 0, hash, certificates: assets.images.map((image, index) => ({...image, ...(images[index].label ? {label: images[index].label} : {})})), certificateHash: certificate.hash,
    ...(model.type === "ПРО" ? {gradeReportUrl: model.joinUrl} : {}),
    promoMessage: `${model.name}\n${model.dateLabel}\nПродолжительность: ${model.hours} ч. Стоимость: ${model.price} ₽.\nРегистрация: ${model.landingUrl}`,
    checklist: ["Проверьте все блоки лендинга, изображения и сохранённые отзывы из прототипа.", "Проверьте все страницы автоматически созданных образцов документов.", "После публикации проверьте оплату тестовым заказом вручную.", "Согласуйте лендинг, затем запускайте рекламу и обновляйте приказ о наборе."]
  };
}

async function publish(program, templateId, expectedHash, call, certificate, report = () => {}) {
  validateTemplateId(templateId);
  report("Проверка параметров перед публикацией");
  const {model} = await loadPrototypeModel(program, templateId, call);
  if (!certificate?.hash) fail("Подготовьте черновики с автоматически созданными образцами сертификатов заново.", 409);
  const hash = payloadHash(model, templateId, certificate.hash);
  if (hash !== expectedHash) fail("Параметры программы или прототип изменились после подготовки. Подготовьте и проверьте черновики заново.", 409);
  // Check sample ownership/files before either the product or landing becomes public.
  report("Проверка всех образцов документов");
  await call("edu", "/validate-publication", {key: model.key, hash});
  report("Публикация товара на zifra-plus.ru");
  const product = await call("shop", "/publish", {key: model.key, hash});
  report("Публикация лендинга на edu-plus.ru");
  const landing = await call("edu", "/publish", {key: model.key, hash});
  report("Включение перехода из магазина на лендинг");
  const redirectedProduct = await call("shop", "/enable-redirect", {key: model.key, hash});
  if (product.status !== "publish" || landing.status !== "publish" || redirectedProduct.redirectEnabled !== true) fail("Сайты не подтвердили публикацию и включение перехода. Повторите публикацию с теми же параметрами.", 502);
  return {ok: true, stage: "published", type: model.type, product: {...product, ...redirectedProduct}, landing, hash, templateId: Number(templateId),
    ...(model.type === "ПРО" ? {gradeReportUrl: model.joinUrl} : {})};
}

// Synchronization is deliberately independent of generation: legacy courses need neither
// a webinar meeting nor new sample documents just to change their price/name.
function syncTarget(program) {
  const remembered = Number(program.siteSync?.landing?.id || program.sitePublication?.landing?.id || 0);
  if (Number.isSafeInteger(remembered) && remembered > 0) return {landingId: remembered};
  const code = text(program.landingCode, 200).replace(/^\/+|\/+$/g, "");
  if (/^[1-9]\d*$/.test(code)) return {landingId: Number(code)};
  if (/^[a-z0-9][a-z0-9_-]{1,79}$/.test(code)) return {slug: code};
  if (code) fail("Проверьте код лендинга: нужен ID страницы или её код в адресе.");
  if (Number(program.sitePublication?.landing?.id) > 0) return {landingId: Number(program.sitePublication.landing.id)};
  try {
    const url = new URL(program.promoSite || program.landingUrl);
    if (url.origin !== SITES.edu || url.username || url.password) throw new Error();
    if (/^[1-9]\d*$/.test(url.searchParams.get("p") || "")) return {landingId: Number(url.searchParams.get("p"))};
    const slug = url.pathname.split("/").filter(Boolean).at(-1);
    if (/^[a-z0-9][a-z0-9_-]{1,79}$/.test(slug)) return {slug};
  } catch { /* Report a useful field error below. */ }
  fail("Укажите код лендинга или ссылку edu-plus.ru на вкладке «Основное».");
}

function normalizeSyncProgram(program) {
  const id = text(program.id, 200), name = text(program.name, 500);
  const type = programType(program);
  if (!id || !name) fail("Сохраните программу с заполненным названием.");
  if (program.price === "" || program.price == null) fail("Заполните стоимость программы (для бесплатной — 0).");
  const price = Number(program.price), sourceOldPrice = Number(program.oldPrice || 0), hours = Number(program.hours);
  if (![price, sourceOldPrice].every(value => Number.isFinite(value) && value >= 0 && value <= 10000000)) fail("Проверьте стоимость и старую цену.");
  // A 25% uplift over the current price corresponds to a 20% discount from the old price.
  const oldPrice = sourceOldPrice < price ? Math.round((price * 1.25 + Number.EPSILON) * 100) / 100 : sourceOldPrice;
  if (oldPrice > 10000000) fail("Рассчитанная старая цена превышает допустимые 10 000 000 ₽. Проверьте стоимость программы.");
  if (!Number.isFinite(hours) || hours <= 0 || hours > 10000) fail("Проверьте количество часов.");
  const schedule = {};
  if (type === "ПРО" && (program.webinarDate || program.webinarTime)) {
    const date = String(program.webinarDate || "").trim(), time = String(program.webinarTime || "").trim();
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) fail("Укажите корректные дату и время вебинара (Москва).");
    Object.assign(schedule, {date, time});
  }
  let promo = text(program.promoSite, 2000), slug = "";
  // Older cards contain an ID-based URL: it identifies a page, not a new slug.
  if (promo) {
    let url;
    try { url = new URL(promo); } catch { /* A bare landing code is also supported. */ }
    const idUrl = url?.origin === SITES.edu && !url.username && !url.password
      && /^[1-9]\d*$/.test(url.searchParams.get("p") || url.searchParams.get("page_id") || "");
    if (!idUrl) slug = landingCodeFromPromoSite(promo);
  }
  return {id, type, name, productName: text(program.siteProductName || name, 500), price, oldPrice, hours,
    ...(sourceOldPrice < price ? {oldPriceAdjusted: true} : {}),
    ...schedule,
    ...(slug ? {slug} : {}),
    ...(type === "ПРО" && text(program.webinarJoinUrl, 2000) ? {joinUrl: normalizeJoinUrl(program.webinarJoinUrl)} : {}),
    duration: text(program.duration, 200), studyForm: text(program.studyForm, 300),
    descriptionHtml: "", speakerHtml: "",
    startLabel: text(program.siteStartLabel, 200)};
}

async function resolveSiteProducts(program, call, landing, target, requestedProductId = 0) {
  const offers = Array.isArray(landing.offers) ? landing.offers : [];
  const ids = [...new Set(offers.map(offer => Number(offer.productId)).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length || ids.length > 30) fail("На лендинге не найдены однозначные ссылки регистрации в интернет-магазине.");
  const products = await Promise.all(ids.map(id => call("shop", `/sync-product/${id}`)));
  const explicit = Number(requestedProductId || 0);
  if (explicit && !ids.includes(explicit)) fail("Выбранный товар не связан с этим лендингом.", 409);
  const key = crypto.createHash("sha256").update(`ais-program:${program.id}`).digest("hex");
  const ownVariant = landing.variants?.[key];
  const needsNewProduct = program.siteProductPending === true && !ownVariant?.productId
    && !String(program.productId || "").trim() && !program.siteSync?.product?.id && !program.sitePublication?.product?.id;
  if (needsNewProduct && explicit) fail("У копии программы должен быть отдельный товар. Используйте «Добавить вариант».", 409);
  const remembered = Number(program.productId || ownVariant?.productId || program.siteSync?.product?.id || program.sitePublication?.product?.id || 0);
  const matches = offers.filter(offer => Number(offer.hours) === Number(program.hours));
  const matchIds = [...new Set(matches.map(offer => Number(offer.productId)))];
  const selected = needsNewProduct ? 0 : explicit || (ids.includes(remembered) ? remembered : ids.length === 1 ? ids[0] : matchIds.length === 1 ? matchIds[0] : 0);
  const product = products.find(item => Number(item.id) === selected) || null;
  return {ok: true, target, landing, products, product, needsNewProduct};
}

async function resolveSite(program, call, requestedProductId = 0) {
  const target = syncTarget(program);
  return resolveSiteProducts(program, call, await call("edu", "/resolve-site", target), target, requestedProductId);
}

async function inspectSite(program, call) {
  // An empty/invalid new code is generated by the wizard. Still inspect any
  // existing publication/address; never interpret a lookup failure as absence.
  const code = String(program.landingCode || '').trim().replace(/^\/+|\/+$/g, '');
  if (code && !/^(?:[1-9]\d*|[a-z0-9][a-z0-9_-]{1,79})$/.test(code)) program = {...program, landingCode: ''};
  const absent = {ok: true, exists: false, landing: null, products: [], product: null};
  if (![program.landingCode, program.promoSite, program.landingUrl, program.sitePublication?.landing?.id].some(value => String(value || "").trim())) return absent;
  const target = syncTarget(program);
  const landing = await call("edu", "/resolve-site", {...target, allowMissing: true});
  if (landing.found === false) return absent;
  if (!Number.isSafeInteger(Number(landing.id)) || Number(landing.id) < 1) fail("Сайт не подтвердил наличие лендинга. Повторите проверку.", 502);
  let resolved;
  try { resolved = await resolveSiteProducts(program, call, landing, target); }
  catch (error) { resolved = {products: [], product: null, warning: error.message}; }
  return {ok: true, exists: true, landing: {id: landing.id, status: landing.status, url: landing.url, editUrl: landing.editUrl,
    title: landing.title, previewImageUrl: landing.previewImageUrl || "", version: landing.version, variantVisibility: landing.variantVisibility === true},
    products: resolved.products.map(({id, title, url, editUrl}) => ({id, title, url, editUrl, hidden: landing.offers.some(offer => Number(offer.productId) === Number(id) && offer.hidden === true)})),
    product: resolved.product && {id: resolved.product.id, url: resolved.product.url, editUrl: resolved.product.editUrl},
    needsNewProduct: resolved.needsNewProduct === true, warning: resolved.warning || ""};
}

async function setVariantVisibility(program, call, productId, hidden, version, landingId) {
  if (!Number.isSafeInteger(productId) || productId < 1 || typeof hidden !== "boolean" || typeof version !== "string" || !version) fail("Проверьте вариант и его видимость.");
  const landing = await call("edu", "/resolve-site", syncTarget(program));
  if (landing.variantVisibility !== true) fail("Обновите служебный модуль edu-plus.ru для управления видимостью вариантов.", 409);
  if (landing.id !== landingId || landing.version !== version) fail("Лендинг изменился. Обновите список вариантов.", 409);
  if (!landing.offers.some(offer => Number(offer.productId) === productId)) fail("Товар не связан с этим лендингом.", 409);
  // This operation intentionally never calls the shop, updates prices or creates products.
  const result = await call("edu", "/set-variant-visibility", {landingId: landing.id, productId, hidden, version});
  if (result.ok !== true || result.landingId !== landing.id || result.productId !== productId || result.hidden !== hidden) fail("Сайт не подтвердил видимость варианта. Обновите список.", 502);
  return result;
}

async function buildVariantPlan(program, call, prepareCertificate) {
  if (String(program.productId || "").trim() || program.siteSync?.product?.id || program.sitePublication?.product?.id) {
    fail("Программа уже связана с товаром. Для нового варианта сначала создайте копию программы.", 409);
  }
  const target = syncTarget(program);
  const landing = await call("edu", "/resolve-site", target);
  const type = programType(program);
  if (landing.status !== "publish" || landing.postType !== PROGRAM_TYPES[type].postType) fail("Выберите опубликованный лендинг того же вида образовательной программы.");
  const capabilities = await Promise.all([call("edu", "/health"), call("shop", "/health")]);
  if (capabilities.some(site => !site.programVariants)) fail("Обновите служебные модули сайтов для добавления вариантов.", 409);
  const key = crypto.createHash("sha256").update(`ais-program:${program.id}`).digest("hex");
  const landingSlug = landing.slug;
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(landingSlug || "")) fail("Не удалось определить адрес существующего лендинга.");
  const productSlug = `${landingSlug.slice(0, 56).replace(/[-_]+$/, "")}-${Number(program.hours)}-${key.slice(0, 8)}`;
  const template = {title: landing.title, fields: landing.fields};
  const model = normalizeProgram({...program, promoSite: "", landingCode: productSlug});
  model.landingUrl = landing.url;
  model.landingSlug = landingSlug;
  model.descriptionHtml = String(landing.fields?.opisanie_o_programme || landing.fields?.opisanie_dokumenta || "");
  const certificate = await prepareCertificate({...program, siteSampleLandingUrl: landing.url});
  if (!/^[a-f0-9]{64}$/.test(certificate?.hash || "") || typeof certificate.generate !== "function") fail("Не удалось подготовить образцы документов.");
  const operationHash = payloadHash(model, landing.id, certificate.hash);
  const payload = {key, hash: operationHash, model, landingId: landing.id, version: landing.version, certificateHash: certificate.hash};
  await call("edu", "/check-variant", payload);
  const productTemplateId = prototypeProductId(template);
  const hash = crypto.createHash("sha256").update(JSON.stringify({...payload, productTemplateId})).digest("hex");
  return {plan: {ok: true, hash, model, landing: {id: landing.id, title: landing.title, url: landing.url},
    priceNote: "Скидка до [skidki-pp-pk]\nРассрочка без переплат",
    existingOffers: landing.offers.length, alreadyAdded: Boolean(landing.variants?.[key]?.complete)}, payload, certificate, productTemplateId,
    imageUrl: landing.previewImageUrl || ""};
}

async function previewVariant(program, call, prepareCertificate) {
  return (await buildVariantPlan(program, call, prepareCertificate)).plan;
}

async function addVariant(program, call, expectedHash, prepareCertificate, report = () => {}) {
  report("Проверка нового варианта и существующего лендинга");
  const {plan, payload, certificate, productTemplateId, imageUrl} = await buildVariantPlan(program, call, prepareCertificate);
  if (!expectedHash || expectedHash !== plan.hash) fail("Данные программы или лендинга изменились. Обновите проверку перед добавлением варианта.", 409);
  const images = await certificate.generate(report);
  report("Загрузка новых образцов документов без удаления прежних");
  const assets = await call("edu", "/variant-assets", {...payload, images});
  if (!Array.isArray(assets.images) || assets.images.length !== images.length || assets.images.some((image, index) =>
    image.language !== images[index].language || !Number.isSafeInteger(Number(image.id)) || Number(image.id) < 1)) fail("Сайт не подтвердил все страницы новых образцов.", 502);
  payload.certificatePages = assets.images.map(({id, language}) => ({id, language}));
  await call("edu", "/check-variant", payload);
  report("Создание отдельного товара в магазине");
  const product = await call("shop", "/prepare-product", {...plan.model, hash: payload.hash, productTemplateId, imageUrl});
  if (!Number.isSafeInteger(Number(product.id)) || Number(product.id) < 1) fail("Магазин не подтвердил код нового товара.", 502);
  payload.productId = Number(product.id);
  await call("edu", "/check-variant", payload);
  report("Публикация нового товара и добавление варианта на лендинг");
  const published = await call("shop", "/publish", {key: payload.key, hash: payload.hash});
  if (Number(published.id) !== Number(product.id) || published.status !== "publish") fail("Магазин не подтвердил публикацию нового товара. Обновите проверку и повторите с теми же параметрами.", 502);
  let landing;
  try { landing = await call("edu", "/attach-variant", payload); }
  catch (error) { fail(`Новый товар №${product.id} создан, но добавление на лендинг не подтверждено. Обновите проверку и повторите: будет использован тот же товар. ${error.message}`, 409); }
  const publishedProduct = await call("shop", "/enable-redirect", {key: payload.key, hash: payload.hash});
  if (Number(landing.id) !== Number(payload.landingId) || landing.status !== "publish" || Number(publishedProduct.id) !== Number(product.id)
    || publishedProduct.status !== "publish" || publishedProduct.redirectEnabled !== true) fail("Сайты не подтвердили добавление варианта и переход на лендинг. Обновите проверку и повторите с теми же параметрами.", 502);
  return {ok: true, isVariant: true, type: plan.model.type, landing, product: publishedProduct, syncedAt: new Date().toISOString(),
    certificates: assets.images.map((image, index) => ({...image, label: images[index].label}))};
}

async function buildSyncPlan(program, call, productId, imageSourceId, prepareCertificate) {
  const model = normalizeSyncProgram(program);
  const imageSource = await loadImageSource(imageSourceId, call);
  if (imageSource) model.imageSource = imageSource;
  const resolved = await resolveSite(program, call, productId);
  model.isVariant = Object.values(resolved.landing.variants || {}).some(variant => Number(variant.productId) === Number(resolved.product?.id));
  let currentSlug = resolved.landing.slug;
  if (!currentSlug) { try { currentSlug = new URL(resolved.landing.url).pathname.split("/").filter(Boolean).at(-1); } catch {} }
  // An unchanged promo address must not force a rename of a legacy shop product.
  if (model.slug === currentSlug) delete model.slug;
  if (model.slug || model.joinUrl) {
    const postType = resolved.landing.postType || PROGRAM_TYPES[model.type].postType;
    const base = postType === "other-course" ? "other_course" : postType;
    if (!["other_course", "courses-pk", "courses-pp"].includes(base)) fail("Сайт не подтвердил раздел лендинга.", 502);
    model.landingUrl = model.slug ? `${SITES.edu}/${base}/${model.slug}/` : resolved.landing.url;
  }
  let certificate = null;
  if (prepareCertificate) {
    if (!(await call("edu", "/health")).sampleSync) fail("Обновите служебный модуль edu-plus.ru для обновления образцов документов.", 409);
    certificate = await prepareCertificate({...program, siteSampleLandingUrl: model.landingUrl || resolved.landing.url});
    if (!/^[a-f0-9]{64}$/.test(certificate?.hash || "")) fail("Не удалось проверить версию образцов документов.");
    model.updateSamples = true;
    model.certificateHash = certificate.hash;
    if (resolved.product) await call("edu", "/check-sync", {model, landingId: resolved.landing.id, landingStatus: resolved.landing.status,
      productId: resolved.product.id, version: resolved.landing.version});
  }
  const publicLanding = {...resolved.landing};
  delete publicLanding.fields;
  const hash = resolved.product ? crypto.createHash("sha256").update(JSON.stringify({model, target: resolved.target,
    landing: resolved.landing.version, product: resolved.product.version, productId: resolved.product.id})).digest("hex") : "";
  return {plan: {...resolved, landing: publicLanding, model, hash}, certificate};
}

async function previewSync(program, call, productId = 0, imageSourceId = 0, prepareCertificate = null) {
  return (await buildSyncPlan(program, call, productId, imageSourceId, prepareCertificate)).plan;
}

function bulkStableHash(value) {
  const stable = item => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, stable(item[key])])) : item;
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function bulkDecimal(value, label) {
  const source = String(value ?? "").trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(source) || source.length > 16) fail(`${label}: укажите число, не более двух знаков после запятой.`);
  const negative = source.startsWith("-");
  const [whole, fraction = ""] = source.replace(/^-/, "").split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (negative ? -1n : 1n);
}
function normalizeBulkPricing(options = {}) {
  if (!options || typeof options !== "object" || typeof options.changePrices !== "boolean") fail("Укажите режим изменения цен.");
  if (!options.changePrices) return {changePrices: false};
  const percent = bulkDecimal(options.percent, "Процент");
  if (percent < -10000n || percent > 100000n) fail("Процент должен быть от −100 до 1000.");
  const direction = options.direction;
  if (!["up", "down", "nearest", "none"].includes(direction)) fail("Выберите направление округления.");
  const step = direction === "none" ? 1n : bulkDecimal(options.step, "Шаг округления");
  if (step <= 0n || step > 1000000000n) fail("Шаг округления должен быть от 0,01 до 10 000 000 ₽.");
  const normalized = {changePrices:true,percent:Number(percent)/100,step:Number(step)/100,direction};
  if (options.manualPrice !== undefined) {
    const manual = bulkDecimal(options.manualPrice, "Ручная цена");
    if (manual < 0n || manual > 1000000000n) fail("Ручная цена должна быть от 0 до 10 000 000 ₽.");
    normalized.manualPrice = Number(manual)/100;
  }
  return normalized;
}
function calculateBulkPrice(price, options) {
  const settings = normalizeBulkPricing(options);
  const cents = bulkDecimal(price, "Цена");
  if (cents < 0n || cents > 1000000000n) fail("Цена должна быть от 0 до 10 000 000 ₽.");
  if (!settings.changePrices) return Number(cents)/100;
  if (settings.manualPrice !== undefined) return settings.manualPrice;
  const step = bulkDecimal(settings.step, "Шаг округления");
  const numerator = cents * (10000n + bulkDecimal(settings.percent, "Процент"));
  const denominator = 10000n * step;
  let units = numerator / denominator;
  const remainder = numerator % denominator;
  if ((settings.direction === "up" && remainder > 0n) || (["nearest", "none"].includes(settings.direction) && remainder * 2n >= denominator)) units++;
  const result = units * step;
  if (result > 1000000000n) fail("Расчётная цена превышает 10 000 000 ₽.");
  return Number(result)/100;
}
async function previewBulkSync(program, call, options) {
  const settings = normalizeBulkPricing(options);
  const price = calculateBulkPrice(program.price, settings);
  const effective = {...program, price};
  const plan = await previewSync(effective, call);
  if (!plan.product || !plan.hash) fail("Неоднозначная связь с товаром. Укажите код товара в карточке программы.", 409);
  // A sibling variant may change the common page's version during this batch.
  // Its changes must not invalidate this unchanged offer; its own product/offer,
  // landing identity, desired model and authoritative AIS record remain guarded.
  const ownOffers = plan.landing.offers.filter(offer => Number(offer.productId) === Number(plan.product.id));
  const quote = bulkStableHash({source:bulkStableHash(program),settings,model:plan.model,productId:plan.product.id,
    productVersion:plan.product.version,landingId:plan.landing.id,landingStatus:plan.landing.status,landingSlug:plan.landing.slug,ownOffers});
  return {...plan, bulk:{settings,quote,sourceHash:bulkStableHash(program),basePrice:Number(program.price),baseOldPrice:Number(program.oldPrice || 0),price,oldPrice:plan.model.oldPrice}};
}
async function synchronizeBulkItem(program, call, options, quote, report = () => {}) {
  if (typeof quote !== "string" || !/^[a-f0-9]{64}$/.test(quote)) fail("Сначала выполните предварительный расчёт.");
  report("Проверка программы и подтверждённого расчёта цен");
  const plan = await previewBulkSync(program, call, options);
  if (quote !== plan.bulk.quote) fail("Программа, цена или связь с сайтом изменились. Повторите предварительную проверку этой строки.", 409);
  const result = await synchronize({...program,price:plan.bulk.price}, call, plan.product.id, plan.hash, 0, report);
  return {...result,price:plan.bulk.price,oldPrice:plan.bulk.oldPrice,bulkSourceHash:plan.bulk.sourceHash};
}

async function synchronize(program, call, productId, expectedHash, imageSourceId = 0, report = () => {}, prepareCertificate = null) {
  report("Повторная проверка данных программы и двух сайтов");
  const {plan, certificate} = await buildSyncPlan(program, call, productId, imageSourceId, prepareCertificate);
  if (!plan.product || !expectedHash || plan.hash !== expectedHash) fail("Данные программы или сайтов изменились. Обновите проверку перед синхронизацией.", 409);
  // Preflight both sites before the first write. Each write also rechecks its snapshot
  // under a lock on the actual post ID (several AIS variants can share one landing).
  const payload = {model: plan.model, landingId: plan.landing.id, landingStatus: plan.landing.status, productId: plan.product.id};
  report("Проверка возможности обновления лендинга");
  await call("edu", "/check-sync", {...payload, version: plan.landing.version});
  report("Проверка возможности обновления магазина");
  await call("shop", "/check-sync", {...payload, version: plan.product.version});
  let certificates;
  if (certificate) {
    const images = await certificate.generate(report);
    report("Загрузка актуальных образцов документов на edu-plus.ru");
    const assets = await call("edu", "/sync-certificate-assets", {...payload, version: plan.landing.version, images});
    if (!Array.isArray(assets.images) || assets.images.length !== images.length || assets.images.some((image, index) =>
      image.language !== images[index].language || !Number.isSafeInteger(Number(image.id)) || Number(image.id) < 1)) fail("Сайт не подтвердил загрузку всех страниц образцов документов.", 502);
    certificates = assets.images.map((image, index) => ({...image, label: images[index].label}));
    payload.certificatePages = certificates.map(({id, language}) => ({id, language}));
    // Check uploaded ownership and unchanged landing before touching the shop.
    await call("edu", "/check-sync", {...payload, version: plan.landing.version});
  }
  let product;
  report("Обновление товара, изображения и файлов подключения на zifra-plus.ru");
  try { product = await call("shop", "/sync-existing", {...payload, version: plan.product.version}); }
  catch (error) { fail(`Не подтверждено обновление магазина. Лендинг не изменялся. Обновите проверку и повторите синхронизацию. ${error.message}`, 409); }
  let landing;
  report("Обновление лендинга на edu-plus.ru");
  try { landing = await call("edu", "/sync-existing", {...payload, version: plan.landing.version}); }
  catch (error) { fail(`Магазин обновлён, но обновление лендинга не подтверждено. Обновите проверку и повторите синхронизацию для завершения. ${error.message}`, 409, {siteChanged:true}); }
  return {ok: true, landing, product, type: plan.model.type, syncedAt: new Date().toISOString(),
    ...(certificates ? {certificates} : {}),
    ...(plan.model.oldPriceAdjusted ? {oldPrice: plan.model.oldPrice} : {}),
    ...(plan.model.slug ? {landingCode: plan.model.slug} : {}),
    ...(plan.model.joinUrl ? {gradeReportUrl: plan.model.joinUrl} : {})};
}

module.exports = {SITES, API_PATH, KEY_FILE, PROGRAM_TYPES, programType, withTrainingPlan, normalizeJoinUrl, landingCodeFromName, landingCodeFromPromoSite, suggestLandingCode, normalizeProgram, validateTemplateId, validateImageSourceId, loadImageSource, updateWebinarSchedule, signature, readKeys, createClient, buildLandingFields, prototypeProductId, payloadHash, prepare, publish, syncTarget, normalizeSyncProgram, resolveSite, inspectSite, setVariantVisibility, previewVariant, addVariant, previewSync, synchronize, normalizeBulkPricing, calculateBulkPrice, bulkStableHash, previewBulkSync, synchronizeBulkItem};
