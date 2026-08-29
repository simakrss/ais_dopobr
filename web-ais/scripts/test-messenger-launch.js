"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appPath = path.resolve(__dirname, "..", "app.js");
const stylesPath = path.resolve(__dirname, "..", "styles.css");
const maxIconPath = path.resolve(__dirname, "..", "data", "max-messenger-icon.png");
const appSource = fs.readFileSync(appPath, "utf8");
const stylesSource = fs.readFileSync(stylesPath, "utf8");

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

const context = {
  URL,
  URLSearchParams,
  Set,
  String,
  encodeURIComponent
};
vm.createContext(context);
vm.runInContext(
  `${extractBetween("  function normalizeMessengerPhone", "  function preferredMessengerDisplayName")}
   ${extractBetween("  function getMessengerLaunchUrl", "  async function openStudentMessenger")}
   ${extractBetween("  function getMessengerCustomUrl", "  function normalizeExternalUrl")}
   ${extractBetween("  function getMessengerPhoneUrl", "  function openExternalUrl")}
   this.getMessengerLaunchUrl = getMessengerLaunchUrl;
   this.getMessengerCustomUrl = getMessengerCustomUrl;
   this.getTelegramAppUrl = getTelegramAppUrl;
   this.getMessengerPhoneUrl = getMessengerPhoneUrl;`,
  context
);

// Telegram must always launch through the registered desktop/mobile app protocol.
assert.equal(context.getTelegramAppUrl("@qsunny7"), "tg://resolve?domain=qsunny7");
assert.equal(
  context.getTelegramAppUrl("https://t.me/Elena_Valkova1603"),
  "tg://resolve?domain=Elena_Valkova1603"
);
assert.equal(
  context.getTelegramAppUrl("t.me/Elena_Valkova1603"),
  "tg://resolve?domain=Elena_Valkova1603"
);
assert.equal(
  context.getTelegramAppUrl("https://telegram.me/antonteamlid"),
  "tg://resolve?domain=antonteamlid"
);
assert.equal(
  context.getTelegramAppUrl("https://telegram.dog/example_bot?start=course-72"),
  "tg://resolve?domain=example_bot&start=course-72"
);
assert.equal(
  context.getTelegramAppUrl("https://t.me/+79033839647"),
  "tg://resolve?phone=79033839647"
);
assert.equal(
  context.getTelegramAppUrl("https://t.me/+AbCdEf012_-"),
  "tg://join?invite=AbCdEf012_-"
);
assert.equal(
  context.getTelegramAppUrl("https://t.me/primary_account?domain=wrong_account&post=999&start=course-72"),
  "tg://resolve?domain=primary_account&start=course-72"
);
assert.equal(
  context.getTelegramAppUrl("https://t.me/joinchat/AbCdEf012_-"),
  "tg://join?invite=AbCdEf012_-"
);
assert.equal(
  context.getTelegramAppUrl("tg://resolve?domain=AlreadyThere"),
  "tg://resolve?domain=AlreadyThere"
);
assert.equal(context.getTelegramAppUrl("https://vk.com/id27403541"), "");
assert.equal(context.getTelegramAppUrl("https://example.org/person"), "");

// A dedicated Telegram account is more precise than the generic messenger URL,
// and the normalized phone remains a safe fallback for old records.
assert.equal(
  context.getMessengerLaunchUrl("telegram", {
    telegramAccount: "@primary_account",
    messengerUrl: "https://t.me/fallback_account",
    phone: "+7 (903) 383-96-47"
  }),
  "tg://resolve?domain=primary_account"
);
assert.equal(
  context.getMessengerLaunchUrl("telegram", {
    telegramAccount: "https://vk.com/id27403541",
    messengerUrl: "https://t.me/Maria_Math",
    phone: "+7 (903) 383-96-47"
  }),
  "tg://resolve?domain=Maria_Math"
);
assert.equal(
  context.getMessengerLaunchUrl("telegram", {
    telegramAccount: "https://vk.com/id27403541",
    messengerUrl: "https://example.org/person",
    phone: "+7 (903) 383-96-47"
  }),
  "tg://resolve?phone=79033839647"
);
[
  context.getMessengerLaunchUrl("telegram", { telegramAccount: "@qsunny7" }),
  context.getMessengerLaunchUrl("telegram", { messengerUrl: "https://t.me/Maria_Math" }),
  context.getMessengerLaunchUrl("telegram", { phone: "+7 (903) 383-96-47" })
].forEach((url) => {
  assert.match(url, /^tg:\/\//u);
  assert.doesNotMatch(url, /^https?:/u);
});

// MAX and WhatsApp keep their existing custom-link and phone fallbacks.
assert.equal(
  context.getMessengerLaunchUrl("max", {
    telegramAccount: "@ignored",
    messengerUrl: "https://max.ru/u/profile-token",
    phone: "+7 (903) 383-96-47"
  }),
  "https://max.ru/u/profile-token"
);
assert.equal(
  context.getMessengerLaunchUrl("max", {
    messengerUrl: "https://t.me/not-max",
    phone: "+7 (903) 383-96-47"
  }),
  "max://search?phone=%2B79033839647"
);
assert.equal(
  context.getMessengerLaunchUrl("whatsapp", {
    telegramAccount: "@ignored",
    messengerUrl: "https://wa.me/79131511666",
    phone: "+7 (903) 383-96-47"
  }),
  "whatsapp://send?phone=79131511666"
);
assert.equal(
  context.getMessengerLaunchUrl("whatsapp", { phone: "+7 (903) 383-96-47" }),
  "whatsapp://send?phone=79033839647"
);
assert.equal(context.getMessengerLaunchUrl("viber", { phone: "+7 (903) 383-96-47" }), "");

// The MAX button must use the official local brand asset, not the former letter-M SVG.
assert.ok(fs.existsSync(maxIconPath), "Не найдена официальная иконка MAX");
const maxIcon = fs.readFileSync(maxIconPath);
assert.equal(maxIcon.length, 68426);
assert.equal(
  crypto.createHash("sha256").update(maxIcon).digest("hex"),
  "cb6baba7bc9fa5b51e91f83d45465f02101c9f0c479c27c65816a0329b401ba9"
);
assert.equal(maxIcon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

const maxIconRenderer = extractBetween("  function renderMaxIcon", "  function renderTelegramIcon");
assert.match(appSource, /MAX_MESSENGER_ICON_URL\s*=\s*new URL\("data\/max-messenger-icon\.png"/u);
assert.match(maxIconRenderer, /<img[^>]+max-messenger-brand-icon[^>]+MAX_MESSENGER_ICON_URL/u);
assert.doesNotMatch(maxIconRenderer, /<svg/u);
assert.doesNotMatch(appSource, /M4\.5 17\.5V6\.5h3\.1l4\.4 6\.4/u);
assert.match(
  stylesSource,
  /\.student-messenger-button svg,\s*\.student-messenger-button img,[\s\S]{0,180}width:\s*17px;[\s\S]{0,80}height:\s*17px;/u
);
const externalUrlOpener = extractBetween("  function openExternalUrl", "  function unique");
assert.match(externalUrlOpener, /!\/\^\(\?:tg\|max\|whatsapp\):\/i\.test/u);

console.log("messenger launch tests: OK");
