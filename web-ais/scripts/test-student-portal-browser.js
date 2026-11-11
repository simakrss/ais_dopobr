"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../student-enrollment.js");
const root = path.resolve(__dirname, "..");
const record = { id: "fixture", name: "Тестовый Слушатель", email: "fixture@example.test", program: "Курс для проверки кабинета", status: "На зачисление",
  contractAmount: 10000, payment1Amount: 5000, payment1Date: "2026-11-11" };
let saved = false;
const payload = () => ({ user: { name: record.name, email: record.email }, record, applications: [{ id: record.id, program: record.program, status: record.status }],
  fields: [{ key: "name", label: "ФИО", type: "text", required: true }, { key: "phone", label: "Телефон", type: "tel", required: true }],
  missing: saved ? [] : ["Телефон"], documents: [], requirements: model.documentRequirements({ citizenship: "РФ" }), finances: model.finances(record) });
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/student-portal")) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url.startsWith("/api/student-portal/profile")) { Object.assign(record, JSON.parse(Buffer.concat(chunks))); saved = true; }
    if (req.url.startsWith("/api/student-portal/submit")) record.enrollmentSubmittedAt = new Date().toISOString();
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(payload())); return;
  }
  if (req.url === "/student-portal.js" || req.url === "/styles.css") { res.setHeader("Content-Type", req.url.endsWith("css") ? "text/css" : "application/javascript"); res.end(fs.readFileSync(path.join(root, req.url.slice(1)))); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="app"></div><script>window.AIS_AUTH_API={appUrl:p=>"/"+p, request:async(p,o)=>{const r=await fetch("/"+p,o);return r.json();},redirectToLogin:()=>{}};</script><script src="/student-portal.js"></script>');
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 } }); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator("[data-submit]").waitFor(); assert.ok(await page.locator("[data-submit]").isDisabled());
    await page.locator('[name="phone"]').fill("+79990000000");
    await page.locator('[data-tab="documents"]').click(); await page.locator('[data-tab="main"]').click();
    assert.equal(await page.locator('[name="phone"]').inputValue(), "+79990000000");
    await page.getByRole("button", { name: "Сохранить данные" }).click();
    await page.getByText("Данные сохранены.", { exact: true }).waitFor(); assert.ok(await page.locator("[data-submit]").isEnabled());
    await page.locator('[data-tab="finances"]').click();
    assert.ok(await page.getByText("Остаток долга", { exact: true }).isVisible());
    assert.equal(await page.locator('[data-panel="finances"] input').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 392), "Mobile layout must fit viewport");
    await page.locator('[data-tab="documents"]').click();
    await page.locator("[data-submit]").click(); await page.getByText("Комплект отправлен на проверку в учебный центр.", { exact: true }).waitFor();
    assert.ok(await page.locator("[data-submit]").isDisabled());
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(root, ".runtime", "student-portal-test"), { recursive: true });
    await page.screenshot({ path: path.join(root, ".runtime", "student-portal-test", "mobile.png"), fullPage: true });
    console.log("PASS: desktop/mobile cabinet, tabs, unsaved fields, save and submission state, read-only finances");
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
