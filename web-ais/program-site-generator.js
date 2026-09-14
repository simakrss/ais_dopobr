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

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
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
  const slug = text(program.landingCode, 100).replace(/^\/+|\/+$/g, "");
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
    dateLabel: webinar ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)} в ${time} (МСК)` : text(program.siteStartLabel || "Ежедневно", 200)
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

async function loadPrototypeModel(program, templateId, call) {
  const model = normalizeProgram(program);
  const template = await call("edu", `/template/${validateTemplateId(templateId)}`);
  if (template.postType && template.postType !== model.postType && model.type !== "ДОП") fail("Выберите прототип соответствующего вида программы.");
  const fields = template.fields || {};
  const description = model.type === "ПРО" ? fields.opisanie_dokumenta : fields.opisanie_o_programme || fields.opisanie_dokumenta;
  return {template, model: {...model, descriptionHtml: typeof description === "string" ? description : "",
    speakerHtml: typeof fields.tekst_etap_obucheniya_1 === "string" ? fields.tekst_etap_obucheniya_1 : "",
    prototypeHash: crypto.createHash("sha256").update(JSON.stringify(template)).digest("hex")}};
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
    data_starta: model.dateLabel, forma_obucheniya: model.studyForm,
    srok: model.type === "ПРО" ? "Однократное участие" : model.duration,
    ssylka_smotret_vse_kursy: "/" + PROGRAM_TYPES[model.type].base
  };
  const walk = (value, name = "") => {
    // This ACF repeater holds the actual reviews, including authors' quotations and photos.
    // Never substitute program names or checkout links inside someone else's testimony.
    if (["blok_opisaniya_kursa", "opisanie_dokumenta", "opisanie_o_programme", "tekst_etap_obucheniya_1"].includes(name)
      || /otzyv|review/i.test(name)) return structuredClone(value);
    if (name === "ssylka_na_registraciyu") { registrationLinks++; return checkoutUrl; }
    if (Object.hasOwn(replacements, name)) return replacements[name];
    if (Array.isArray(value)) return value.map(item => walk(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, key)]));
    if (typeof value !== "string") return value;
    let updated = template.title ? value.split(template.title).join(model.name) : value;
    updated = updated.replace(/https?:\/\/zifra-plus\.ru\/checkout\/?\?(?:[^\s"'<>]*?&(?:amp;)?)?add-to-cart=\d+/g, () => { registrationLinks++; return checkoutUrl; });
    return updated;
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

function payloadHash(model, templateId, certificateHash) {
  return crypto.createHash("sha256").update(JSON.stringify({model, templateId: Number(templateId), certificateHash})).digest("hex");
}

async function prepare(program, templateId, call, certificate) {
  validateTemplateId(templateId);
  const {model, template} = await loadPrototypeModel(program, templateId, call);
  // Validate the prototype before creating anything in either website.
  if (!certificate?.hash || typeof certificate.generate !== "function") fail("Автосоздание сертификатов не подключено. Обновите систему.", 503);
  buildLandingFields(template, model, 1, [{language: "ru", id: 1}, {language: PROGRAM_TYPES[model.type].bilingual ? "en" : "page-2", id: 2}]);
  const hash = payloadHash(model, templateId, certificate.hash);
  const images = await certificate.generate();
  const assets = await call("edu", "/certificate-assets", {key: model.key, hash, type: model.type, certificateHash: certificate.hash, images});
  if (!Array.isArray(assets.images) || assets.images.length !== images.length || images.some((image, index) => assets.images[index]?.language !== image.language)) fail("Сайт не подтвердил загрузку всех страниц образцов документов.", 502);
  buildLandingFields(template, model, 1, assets.images);
  const product = await call("shop", "/prepare-product", {...model, hash});
  const fields = buildLandingFields(template, model, product.id, assets.images);
  const landing = await call("edu", "/prepare-landing", {
    key: model.key, hash, templateId: Number(templateId), templateModified: template.modified,
    title: model.name, type: model.type, slug: model.slug, fields, productId: product.id, certificateHash: certificate.hash,
    certificatePages: assets.images.map(image => ({id: image.id, language: image.language}))
  });
  return {
    ok: true, stage: product.status === "publish" && landing.status === "publish" && product.redirectEnabled === true ? "published" : "prepared",
    product, landing, type: model.type, templateId: Number(templateId), hash, certificates: assets.images.map((image, index) => ({...image, ...(images[index].label ? {label: images[index].label} : {})})), certificateHash: certificate.hash,
    promoMessage: `${model.name}\n${model.dateLabel}\nПродолжительность: ${model.hours} ч. Стоимость: ${model.price} ₽.\nРегистрация: ${model.landingUrl}`,
    checklist: ["Проверьте все блоки лендинга, изображения и сохранённые отзывы из прототипа.", "Проверьте все страницы автоматически созданных образцов документов.", "После публикации проверьте оплату тестовым заказом вручную.", "Согласуйте лендинг, затем запускайте рекламу и обновляйте приказ о наборе."]
  };
}

async function publish(program, templateId, expectedHash, call, certificate) {
  validateTemplateId(templateId);
  const {model} = await loadPrototypeModel(program, templateId, call);
  if (!certificate?.hash) fail("Подготовьте черновики с автоматически созданными образцами сертификатов заново.", 409);
  const hash = payloadHash(model, templateId, certificate.hash);
  if (hash !== expectedHash) fail("Параметры программы или прототип изменились после подготовки. Подготовьте и проверьте черновики заново.", 409);
  // Check sample ownership/files before either the product or landing becomes public.
  await call("edu", "/validate-publication", {key: model.key, hash});
  const product = await call("shop", "/publish", {key: model.key, hash});
  const landing = await call("edu", "/publish", {key: model.key, hash});
  const redirectedProduct = await call("shop", "/enable-redirect", {key: model.key, hash});
  if (product.status !== "publish" || landing.status !== "publish" || redirectedProduct.redirectEnabled !== true) fail("Сайты не подтвердили публикацию и включение перехода. Повторите публикацию с теми же параметрами.", 502);
  return {ok: true, stage: "published", product: {...product, ...redirectedProduct}, landing, hash, templateId: Number(templateId)};
}

// Synchronization is deliberately independent of generation: legacy courses need neither
// a webinar meeting nor new sample documents just to change their price/name.
function syncTarget(program) {
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
  const price = Number(program.price), oldPrice = Number(program.oldPrice || 0), hours = Number(program.hours);
  if (![price, oldPrice].every(value => Number.isFinite(value) && value >= 0 && value <= 10000000)) fail("Проверьте стоимость и старую цену.");
  if (!Number.isFinite(hours) || hours <= 0 || hours > 10000) fail("Проверьте количество часов.");
  return {id, type, name, productName: text(program.siteProductName || name, 500), price, oldPrice, hours,
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
  const remembered = Number(program.siteSync?.product?.id || program.sitePublication?.product?.id || 0);
  const matches = offers.filter(offer => Number(offer.hours) === Number(program.hours));
  const matchIds = [...new Set(matches.map(offer => Number(offer.productId)))];
  const selected = explicit || (ids.includes(remembered) ? remembered : ids.length === 1 ? ids[0] : matchIds.length === 1 ? matchIds[0] : 0);
  const product = products.find(item => Number(item.id) === selected) || null;
  return {ok: true, target, landing, products, product};
}

async function resolveSite(program, call, requestedProductId = 0) {
  const target = syncTarget(program);
  return resolveSiteProducts(program, call, await call("edu", "/resolve-site", target), target, requestedProductId);
}

async function inspectSite(program, call) {
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
    title: landing.title, previewImageUrl: landing.previewImageUrl || ""}, products: resolved.products.map(({id, title, url, editUrl}) => ({id, title, url, editUrl})),
    product: resolved.product && {id: resolved.product.id, url: resolved.product.url, editUrl: resolved.product.editUrl}, warning: resolved.warning || ""};
}

async function previewSync(program, call, productId = 0) {
  const model = normalizeSyncProgram(program);
  const resolved = await resolveSite(program, call, productId);
  const publicLanding = {...resolved.landing};
  delete publicLanding.fields;
  const hash = resolved.product ? crypto.createHash("sha256").update(JSON.stringify({model, target: resolved.target,
    landing: resolved.landing.version, product: resolved.product.version, productId: resolved.product.id})).digest("hex") : "";
  return {...resolved, landing: publicLanding, model, hash};
}

async function synchronize(program, call, productId, expectedHash) {
  const plan = await previewSync(program, call, productId);
  if (!plan.product || !expectedHash || plan.hash !== expectedHash) fail("Данные программы или сайтов изменились. Обновите проверку перед синхронизацией.", 409);
  // Preflight both sites before the first write. Each write also rechecks its snapshot
  // under a lock on the actual post ID (several AIS variants can share one landing).
  const payload = {model: plan.model, landingId: plan.landing.id, productId: plan.product.id};
  await call("edu", "/check-sync", {...payload, version: plan.landing.version});
  await call("shop", "/check-sync", {...payload, version: plan.product.version});
  let product;
  try { product = await call("shop", "/sync-existing", {...payload, version: plan.product.version}); }
  catch (error) { fail(`Не подтверждено обновление магазина. Лендинг не изменялся. Обновите проверку и повторите синхронизацию. ${error.message}`, 409); }
  let landing;
  try { landing = await call("edu", "/sync-existing", {...payload, version: plan.landing.version}); }
  catch (error) { fail(`Магазин обновлён, но обновление лендинга не подтверждено. Обновите проверку и повторите синхронизацию для завершения. ${error.message}`, 409); }
  return {ok: true, landing, product, syncedAt: new Date().toISOString()};
}

module.exports = {SITES, API_PATH, KEY_FILE, PROGRAM_TYPES, programType, withTrainingPlan, normalizeJoinUrl, normalizeProgram, validateTemplateId, signature, readKeys, createClient, buildLandingFields, payloadHash, prepare, publish, syncTarget, normalizeSyncProgram, resolveSite, inspectSite, previewSync, synchronize};
