"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const SITES = Object.freeze({edu: "https://edu-plus.ru", shop: "https://zifra-plus.ru"});
const API_PATH = "/wp-json/ais-program-sites/v1";
const KEY_FILE = "program-site-keys.json";

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
  if (text(program.type).toUpperCase() !== "ПРО") fail("Создание на сайте пока доступно только для программ ПРО (онлайн-семинаров).");
  const id = text(program.id, 200);
  if (!id) fail("Сначала сохраните образовательную программу.");
  const name = text(program.name, 500);
  const productName = text(program.siteProductName || name, 500);
  if (!name || !productName) fail("Заполните название программы.");
  if (Array.from(productName).length > 128) fail("Название товара превышает 128 символов. Укажите более короткое название на вкладке «Сайт и вебинар».");
  const slug = text(program.landingCode, 100).replace(/^\/+|\/+$/g, "");
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(slug)) fail("Код лендинга: от 2 до 80 символов — строчные латинские буквы, цифры, дефис и подчёркивание.");
  const date = text(program.webinarDate, 10);
  const parsedDate = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) fail("Укажите корректную дату вебинара.");
  const time = text(program.webinarTime, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) fail("Укажите время вебинара в формате ЧЧ:ММ (Москва).");
  const price = Number(program.price);
  const oldPrice = Number(program.oldPrice || 0);
  const hours = Number(program.hours);
  if (!Number.isFinite(price) || price < 0 || price > 10000000) fail("Укажите корректную стоимость вебинара.");
  if (!Number.isFinite(oldPrice) || oldPrice < 0 || oldPrice > 10000000) fail("Проверьте старую цену.");
  if (!Number.isFinite(hours) || hours <= 0 || hours > 10000) fail("Укажите положительное количество часов.");
  const descriptionHtml = text(program.siteDescription);
  const speakerHtml = text(program.siteSpeaker);
  if (!descriptionHtml || !speakerHtml) fail("Заполните описание вебинара и сведения о спикере на вкладке «Сайт и вебинар».");
  return {
    key: crypto.createHash("sha256").update(`ais-program:${id}`).digest("hex"),
    id, name, productName, slug, date, time, price, oldPrice, hours,
    joinUrl: normalizeJoinUrl(program.webinarJoinUrl), descriptionHtml, speakerHtml,
    landingUrl: `${SITES.edu}/other_course/${slug}/`,
    dateLabel: `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)} в ${time} (МСК)`
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

function buildLandingFields(template, model, productId) {
  if (!Number.isSafeInteger(Number(productId)) || Number(productId) < 1) fail("Магазин не вернул корректный ID товара.");
  const checkoutUrl = `${SITES.shop}/checkout/?add-to-cart=${Number(productId)}`;
  let registrationLinks = 0;
  const replacements = {
    podacha_zayavki_nazvanie_kursa: model.name,
    naimenovanie_kursa: "Онлайн семинар", zagolovok_dokument: "Онлайн семинар",
    stoimost_kursa: String(model.price), kolichestvo_chasov: String(model.hours),
    staraya_cena: model.oldPrice > model.price ? String(model.oldPrice) : "",
    skidka: model.oldPrice > model.price ? String(Math.round(100 * (1 - model.price / model.oldPrice))) : "0",
    data_starta: model.dateLabel, forma_obucheniya: "Дистанционная",
    opisanie_dokumenta: model.descriptionHtml, tekst_etap_obucheniya_1: model.speakerHtml
  };
  const walk = (value, name = "") => {
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
  return fields;
}

function payloadHash(model, templateId) {
  return crypto.createHash("sha256").update(JSON.stringify({model, templateId: Number(templateId)})).digest("hex");
}

async function prepare(program, templateId, call) {
  const model = normalizeProgram(program);
  if (!Number.isSafeInteger(Number(templateId)) || Number(templateId) < 1) fail("Выберите прототип лендинга.");
  const template = await call("edu", `/template/${Number(templateId)}`);
  // Validate the prototype before creating anything in either website.
  buildLandingFields(template, model, 1);
  const hash = payloadHash(model, templateId);
  const product = await call("shop", "/prepare-product", {...model, hash});
  const fields = buildLandingFields(template, model, product.id);
  const landing = await call("edu", "/prepare-landing", {
    key: model.key, hash, templateId: Number(templateId), templateModified: template.modified,
    title: model.name, slug: model.slug, fields, productId: product.id
  });
  return {
    ok: true, stage: product.status === "publish" && landing.status === "publish" && product.redirectEnabled === true ? "published" : "prepared",
    product, landing, templateId: Number(templateId), hash,
    promoMessage: `${model.name}\n${model.dateLabel}\nПродолжительность: ${model.hours} ч. Стоимость: ${model.price} ₽.\nРегистрация: ${model.landingUrl}`,
    checklist: ["Проверьте все блоки лендинга, изображения и отзывы из прототипа.", "Подготовьте и проверьте образцы сертификатов на русском и английском языках.", "После публикации проверьте оплату тестовым заказом вручную.", "Согласуйте лендинг со спикером, затем запускайте рекламу и обновляйте приказ о наборе."]
  };
}

async function publish(program, templateId, expectedHash, call) {
  const model = normalizeProgram(program);
  if (!Number.isSafeInteger(Number(templateId)) || Number(templateId) < 1) fail("Выберите прототип лендинга.");
  const hash = payloadHash(model, templateId);
  if (hash !== expectedHash) fail("Параметры программы изменились после подготовки. Подготовьте и проверьте черновики заново.", 409);
  const product = await call("shop", "/publish", {key: model.key, hash});
  const landing = await call("edu", "/publish", {key: model.key, hash});
  const redirectedProduct = await call("shop", "/enable-redirect", {key: model.key, hash});
  if (product.status !== "publish" || landing.status !== "publish" || redirectedProduct.redirectEnabled !== true) fail("Сайты не подтвердили публикацию и включение перехода. Повторите публикацию с теми же параметрами.", 502);
  return {ok: true, stage: "published", product: {...product, ...redirectedProduct}, landing, hash, templateId: Number(templateId)};
}

module.exports = {SITES, API_PATH, KEY_FILE, normalizeJoinUrl, normalizeProgram, signature, readKeys, createClient, buildLandingFields, payloadHash, prepare, publish};
