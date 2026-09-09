"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8");

const { sanitizePartnerProgramDescriptionHtml } = require("../app-server.js");

assert.equal(
  typeof sanitizePartnerProgramDescriptionHtml,
  "function",
  "Сервер должен экспортировать санитайзер HTML-описания партнёрской программы."
);

function sourceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Не найдено начало блока: ${label}.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Не найдено окончание блока: ${label}.`);
  return source.slice(start, end);
}

function visibleText(html) {
  return String(html || "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;|&#34;/giu, '"')
    .replace(/&#0*39;|&apos;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

const defaultSourceMatch = serverSource.match(
  /const DEFAULT_PARTNER_PROGRAM_DESCRIPTION_HTML\s*=\s*`([\s\S]*?)`\.trim\(\);/u
);
assert.ok(defaultSourceMatch, "Не найдено стандартное HTML-описание партнёрской программы.");
const defaultHtml = sanitizePartnerProgramDescriptionHtml(
  defaultSourceMatch[1].replace(
    /\$\{DEFAULT_PARTNER_MATERIALS_URL\}/gu,
    "https://disk.yandex.ru/d/9BBGBNBIum252w"
  )
);
const defaultText = visibleText(defaultHtml);
[
  /Партнерская программа учебного центра Цифровизация Плюс/iu,
  /партнерскую скидку в 15%/iu,
  /кэшбэка за свое обучение от 10 до 25%/iu,
  /Доход за рекомендацию нашего учебного центра от 10 до 25%/iu,
  /повышенной ставкой оплаты \(50% от суммы оплаты\)/iu,
  /создается специальный купон/iu,
  /по итогам каждого месяца будет выплата на Вашу банковскую карту/iu,
  /Не упустите шанс сэкономить и заработать/iu
].forEach((pattern) => assert.match(defaultText, pattern));
assert.match(defaultHtml, /href="https:\/\/edu-plus\.ru\/?"/iu);
assert.match(defaultText, /Материалами партнера/iu);

const unsafeHtml = `
  <p class="external" id="fixed" style="position:fixed" onclick="alert(1)">
    Разрешённый <strong data-test="x">текст</strong><br>после переноса
  </p>
  <ul><li title="x">Первый пункт</li><li><em>Второй пункт</em></li></ul>
  <a href="https://edu-plus.ru/course?a=1&amp;b=2" class="link" onclick="alert(2)">HTTPS</a>
  <a href="http://example.test/info" style="color:red">HTTP</a>
  <a href="javascript:alert(3)">Javascript</a>
  <a href="j&#x61;vascript:alert(4)">Encoded Javascript</a>
  <a href="data:text/html,&lt;script&gt;alert(5)&lt;/script&gt;">Data</a>
  <a href="//evil.test/path">Protocol relative</a>
  <a data-href="https://evil.test/from-data">Data href attribute</a>
  <a title="prefix href=https://evil.test/from-title">Href in title</a>
  <script>alert(6)</script>
  <style>body { display: none }</style>
  <template><img src=x onerror=alert(7)></template>
  <iframe srcdoc="&lt;script&gt;alert(8)&lt;/script&gt;">Frame</iframe>
  <object data="https://evil.test">Object</object>
  <embed src="https://evil.test">
  <svg><a xlink:href="javascript:alert(9)">SVG</a></svg>
  <math><mtext>Math</mtext></math>
  <form action="https://evil.test"><input name="password">Form</form>
`;
const sanitized = sanitizePartnerProgramDescriptionHtml(unsafeHtml);

assert.match(sanitized, /<p>\s*Разрешённый <strong>текст<\/strong><br\s*\/?>после переноса\s*<\/p>/iu);
assert.match(sanitized, /<ul><li>Первый пункт<\/li><li><em>Второй пункт<\/em><\/li><\/ul>/iu);
assert.doesNotMatch(sanitized, /<(?:script|style|template|iframe|object|embed|svg|math|form|input)\b/iu);
assert.doesNotMatch(sanitized, /alert\s*\(|display\s*:\s*none|\bFrame\b|\bObject\b|\bSVG\b|\bMath\b|\bForm\b/iu);
assert.doesNotMatch(sanitized, /\s(?:on[a-z]+|style|class|id|src|srcdoc|data-[\w-]+|xlink:href)\s*=/iu);
assert.doesNotMatch(sanitized, /href\s*=\s*["'][^"']*(?:javascript|data:|\/\/evil\.test|&#x?0*61;)/iu);

const anchors = [...sanitized.matchAll(/<a\b[^>]*>/giu)].map((match) => match[0]);
const linkedAnchors = anchors.filter((anchor) => /\shref=/iu.test(anchor));
assert.equal(linkedAnchors.length, 1, "В результате должна остаться только безопасная HTTPS-ссылка.");
linkedAnchors.forEach((anchor) => {
  assert.match(anchor, /href="https:\/\//iu);
  assert.match(anchor, /target="_blank"/iu);
  assert.match(anchor, /rel="[^"]*\bnoopener\b[^"]*"/iu);
  assert.match(anchor, /rel="[^"]*\bnoreferrer\b[^"]*"/iu);
});

assert.match(serverSource, /partnerProgramDescriptionHtml/u);
assert.match(
  serverSource,
  /function getPartnerProgramDescriptionHtml[\s\S]*?sanitizePartnerProgramDescriptionHtml\(DEFAULT_PARTNER_PROGRAM_DESCRIPTION_HTML\)/u,
  "Пустое или удалённое санитайзером описание должно заменяться стандартным."
);
const challengeHandlerSource = sourceBetween(
  serverSource,
  "async function handlePartnerRegistrationChallenge(",
  "async function findExistingPartnerByEmail(",
  "handlePartnerRegistrationChallenge"
);
assert.match(
  challengeHandlerSource,
  /descriptionHtml:\s*getPartnerProgramDescriptionHtml\(/u,
  "Публичный challenge должен возвращать очищенное HTML-описание."
);
assert.match(
  challengeHandlerSource,
  /readSharedApplicationStateCache\(\)/u,
  "Публичный challenge должен читать описание из локального кэша."
);
assert.doesNotMatch(
  challengeHandlerSource,
  /\b(?:readPartnerSharedData|readSharedApplicationStateDocument|flushSharedApplicationStateOfflineQueue)\s*\(/u,
  "Публичный challenge не должен запускать тяжёлое анонимное чтение или синхронизацию общей базы."
);
assert.match(serverSource, /module\.exports\s*=\s*\{[\s\S]*sanitizePartnerProgramDescriptionHtml/u);

assert.match(appSource, /key:\s*"partnerProgramSettings"/u);
assert.match(appSource, /partnerProgramSettings:\s*"Партн/u);
const settingsRenderSource = sourceBetween(
  appSource,
  "function renderPartnerProgramSettingsDictionary()",
  "function renderTrainingEndNotificationSettingsDictionary()",
  "renderPartnerProgramSettingsDictionary"
);
assert.match(settingsRenderSource, /name="partnerProgramDescriptionHtml"/u);
assert.match(
  settingsRenderSource,
  /\$\{escapeHtml\(partnerProgramDescriptionHtml\)\}/u,
  "HTML-код в textarea должен экранироваться и не должен разрывать форму настроек."
);
assert.match(appSource, /form\.elements\.partnerProgramDescriptionHtml/u);
assert.match(appSource, /state\.data\.meta\.partnerProgramDescriptionHtml\s*=/u);
assert.match(appSource, /data-action="save-partner-program-settings"/u);
assert.match(settingsRenderSource, /class="[^"]*settings-apply-button[^"]*"[^>]*type="submit"/u);

assert.match(authSource, /data-partner-program-description/u);
assert.match(authSource, /payload\.descriptionHtml/u);
assert.match(authSource, /sanitizePartnerProgramDescriptionHtml/u);
const authUpdateSource = sourceBetween(
  authSource,
  "function updatePartnerProgramDescription(value)",
  "async function startApplication(",
  "updatePartnerProgramDescription"
);
assert.match(
  authUpdateSource,
  /const sanitized\s*=\s*sanitizePartnerProgramDescriptionHtml\(value\)[\s\S]*container\.innerHTML\s*=\s*sanitized/u,
  "Публичная форма должна вставлять динамическое описание только после клиентской очистки."
);
assert.match(
  gatewaySource,
  /'\/api\/auth\/partner-registration\/challenge'/u,
  "Настройки описания должны загружаться через уже разрешённый публичный challenge."
);

assert.match(stylesSource, /\.partner-program-description\b/u);
assert.match(stylesSource, /\.partner-program-settings\b/u);

console.log("Partner program description tests: OK");
