"use strict";
const crypto = require("node:crypto");
const ACTION = "https://edu-plus.ru/lms/shop-sso.php";
const fail = () => { throw Object.assign(new Error("Переход устарел или уже использован. Откройте кабинет слушателя кнопкой в интернет-магазине ещё раз."), { statusCode: 403 }); };
function createService({ key, context, consumeNonce, now = Date.now }) {
  async function signature(encoded) {
    const derived = crypto.createHmac("sha256", await key()).update("ais-shop-student-sso-v1").digest("hex");
    return crypto.createHmac("sha256", derived).update(encoded).digest("hex");
  }
  async function issue(user, shopUserId) {
    if (user?.role !== "student" || !user.studentId || !/^[1-9]\d{0,15}$/u.test(shopUserId)) fail();
    const payload = { iss: "zifra-plus.ru", aud: ACTION, sub: user.studentId, shopUserId, login: user.login,
      version: user.studentCredentialVersion, exp: Math.floor(now() / 1000) + 120, nonce: crypto.randomBytes(24).toString("hex") };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return { action: ACTION, token: `${encoded}.${await signature(encoded)}` };
  }
  async function inspect(token) {
    if (typeof token !== "string" || token.length > 4096) fail();
    const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/u.exec(token); if (!match) fail();
    if (!crypto.timingSafeEqual(Buffer.from(await signature(match[1])), Buffer.from(match[2]))) fail();
    let data; try { data = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { fail(); }
    const seconds = Math.floor(now() / 1000);
    if (data?.iss !== "zifra-plus.ru" || data.aud !== ACTION || !Number.isInteger(data.exp) || data.exp <= seconds || data.exp > seconds + 120
      || !/^[a-f0-9]{48}$/u.test(data.nonce) || !/^[1-9]\d{0,15}$/u.test(data.shopUserId)
      || !/^[a-f0-9]{64}$/u.test(data.version) || typeof data.sub !== "string" || typeof data.login !== "string") fail();
    // The account, password version and access are checked again when consuming the ticket.
    const { owner } = await context({ role: "student", studentId: data.sub, login: data.login, studentCredentialVersion: data.version });
    return { data, user: require("./student-enrollment.js").publicUser(owner) };
  }
  async function consume(token) {
    const { data, user } = await inspect(token);
    if (!await consumeNonce(data.nonce, data.exp * 1000)) fail();
    return { user };
  }
  return { issue, inspect: async token => ({ user: (await inspect(token)).user }), consume };
}
function createNonceStore(pool, namespace) {
  return async (nonce, expiresAt) => {
    const db = await pool();
    await db.query("CREATE TABLE IF NOT EXISTS ais_student_sso_nonces (nonce_key CHAR(64) PRIMARY KEY, expires_at BIGINT NOT NULL)");
    await db.query("DELETE FROM ais_student_sso_nonces WHERE expires_at < ? LIMIT 100", [Date.now()]);
    const hash = crypto.createHash("sha256").update(`${namespace}:shop-sso:${nonce}`).digest("hex");
    try { await db.query("INSERT INTO ais_student_sso_nonces (nonce_key, expires_at) VALUES (?, ?)", [hash, expiresAt]); return true; }
    catch (error) { if (error.code === "ER_DUP_ENTRY") return false; throw error; }
  };
}
module.exports = { createService, createNonceStore, ACTION };
