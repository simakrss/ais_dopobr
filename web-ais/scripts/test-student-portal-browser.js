"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../student-enrollment.js");
const root = path.resolve(__dirname, "..");
const record = { id: "fixture", name: "Тестовая Светлана Александровна", email: "fixture@example.test", program: "Организация образовательного процесса вуза на основе современных информационных технологий (72 ч)", status: "На зачисление",
  contractAmount: 10000, payment1Amount: 5000, payment1Date: "2026-11-11" };
let saved = false, logout = 0;
const payload = () => ({ user: { name: record.name, email: record.email }, record, applications: [{ id: record.id, program: record.program, status: record.status }],
  fields: [{ key: "name", label: "ФИО", type: "text", required: true }, { key: "phone", label: "Телефон", type: "tel", required: true }],
  missing: saved ? [] : ["Телефон"], documents: [], requirements: model.documentRequirements({ citizenship: "РФ" }), finances: model.finances(record), sdoAvailable: model.sdoAvailable(record) });
const server = http.createServer(async (req, res) => {
  if (req.url === "/api/auth/logout") { logout++; res.setHeader("Content-Type", "application/json"); res.end('{}'); return; }
  if (req.url.startsWith("/api/student-portal")) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url.startsWith("/api/student-portal/profile")) { Object.assign(record, JSON.parse(Buffer.concat(chunks))); saved = true; }
    if (req.url.startsWith("/api/student-portal/submit")) { record.enrollmentSubmittedAt = new Date().toISOString(); record.enrollmentReviewStatus = "На проверке"; }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(payload())); return;
  }
  if (req.url === "/student-portal.js" || req.url === "/styles.css") { res.setHeader("Content-Type", req.url.endsWith("css") ? "text/css" : "application/javascript"); res.end(fs.readFileSync(path.join(root, req.url.slice(1)))); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="app" class="app-shell"></div><script>window.AIS_AUTH_API={appUrl:p=>"/"+p, request:async(p,o)=>{const r=await fetch("/"+p,o);return r.json();},redirectToLogin:()=>{window.loginRedirect=true;}};</script><script src="/student-portal.js"></script>');
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 } }); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator("[data-submit]").waitFor(); assert.ok(await page.locator("[data-submit]").isDisabled());
    assert.equal(await page.locator("[data-sdo]").count(), 0);
    const screenshots = path.join(root, ".runtime", "student-portal-test"); fs.mkdirSync(screenshots, { recursive: true });
    assert.equal(await page.locator('#student-sidebar [data-tab]').count(), 4);
    assert.equal(await page.locator('[data-section-title]').textContent(), 'Рабочий стол');
    assert.ok(await page.locator('[data-panel="dashboard"]').isVisible());
    assert.ok(await page.locator('#student-sidebar').evaluate(element => element.getBoundingClientRect().right < 300 && !element.inert));
    assert.ok(await page.locator('.student-program-name').evaluate(element => element.scrollWidth <= element.clientWidth));
    await page.screenshot({ path: path.join(screenshots, "desktop-dashboard.png"), fullPage: true });
    await page.locator('[data-account-toggle]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Профиль' }).click();
    assert.equal(await page.locator('[data-section-title]').textContent(), 'Основное');
    await page.locator('[name="phone"]').fill("+79990000000");
    await page.locator('[data-tab="documents"]').click(); await page.locator('[data-tab="dashboard"]').click();
    await page.locator('[data-account-toggle]').click(); await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Выйти');
    await page.keyboard.press('Escape'); assert.ok(await page.locator('#student-account-menu').isHidden());
    await page.locator('[data-tab="main"]').click();
    assert.equal(await page.locator('[name="phone"]').inputValue(), "+79990000000");
    await page.getByRole("button", { name: "Сохранить данные" }).click();
    await page.getByText("Данные сохранены.", { exact: true }).waitFor(); assert.ok(await page.locator("[data-submit]").isEnabled());
    await page.locator('[data-tab="finances"]').click();
    assert.ok(await page.getByText("Остаток долга", { exact: true }).isVisible());
    assert.equal(await page.locator('[data-panel="finances"] input').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 392), "Mobile layout must fit viewport");
    assert.ok(await page.locator('#student-sidebar').evaluate(element => element.inert));
    await page.locator('[data-sidebar-open]').click();
    assert.ok(await page.locator('.partner-workspace').evaluate(element => element.inert));
    await page.locator('#student-sidebar [data-logout]').focus(); await page.keyboard.press('Tab');
    assert.ok(await page.locator('#student-sidebar [data-sidebar-close]').evaluate(element => document.activeElement === element));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-sidebar-open]').getAttribute('aria-expanded'), 'false');
    await page.locator('[data-sidebar-open]').click();
    await page.locator('[data-tab="documents"]').click();
    assert.equal(await page.locator('[data-sidebar-open]').getAttribute('aria-expanded'), 'false');
    await page.locator("[data-submit]").click(); await page.getByText("Комплект отправлен на проверку в учебный центр.", { exact: true }).waitFor();
    assert.ok(await page.locator("[data-submit]").isDisabled());
    Object.assign(record, { enrollmentReviewStatus: "На доработке", enrollmentSubmittedAt: "", enrollmentReviewComment: 'Замените скан\n<script>window.bad=true</script>', enrollmentReviewedAt: new Date().toISOString() });
    await page.locator('[data-review-refresh]').click();
    await page.locator('[data-review-status="На доработке"]').waitFor();
    assert.equal(await page.locator('.student-portal-review-comment').textContent(),record.enrollmentReviewComment);
    assert.equal(await page.locator('.student-portal-review script').count(),0);
    assert.ok(await page.locator('[data-submit]').isEnabled());
    await page.locator('[data-submit]').click(); await page.locator('[data-review-status="На проверке"]').waitFor();
    Object.assign(record, { enrollmentReviewStatus: "Приняты", enrollmentReviewComment: "Документы в порядке" });
    await page.locator('[data-review-refresh]').click(); await page.locator('[data-review-status="Приняты"]').waitFor();
    assert.ok(await page.locator('[data-submit]').isDisabled());
    assert.match(await page.locator('[data-submit-hint]').textContent(),/приняты/);
    record.login = "fixture-sdo"; record.event_portalCredentialsSent_state = "checked";
    await page.reload(); await page.locator("[data-sdo]").waitFor();
    assert.equal(await page.locator("[data-sdo]").getAttribute("target"), "_blank");
    assert.match(await page.locator("[data-sdo]").getAttribute("href"), /api\/student-portal\/sdo-open\?id=fixture$/);
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(root, ".runtime", "student-portal-test"), { recursive: true });
    await page.screenshot({ path: path.join(root, ".runtime", "student-portal-test", "mobile.png"), fullPage: true });
    await page.locator('[data-sidebar-open]').click();
    await page.screenshot({ path: path.join(screenshots, 'mobile-menu.png'), animations: 'disabled' });
    assert.ok(await page.locator('#student-sidebar').evaluate(element => Math.abs(element.getBoundingClientRect().left) < 1));
    await page.locator('.partner-sidebar-backdrop').click({ position: { x: 370, y: 250 } });
    assert.ok(await page.locator('#student-sidebar').evaluate(element => element.inert));
    await page.locator('[data-sidebar-open]').click(); await page.locator('[data-tab="main"]').click();
    await page.locator('[name="phone"]').fill('+79991234567');
    await page.locator('[data-sidebar-open]').click(); await page.locator('[data-tab="documents"]').click();
    await page.locator('[data-account-toggle]').click(); await page.getByRole('menuitem', {name:'Профиль'}).click();
    assert.equal(await page.locator('[name="phone"]').inputValue(), '+79991234567', 'Mobile menu must preserve drafts');
    await page.locator('[data-account-toggle]').click(); await page.getByRole('menuitem', { name:'Выйти', exact:true }).click();
    await page.waitForFunction(() => window.loginRedirect === true);
    assert.equal(logout, 1); assert.equal(record.phone, '+79991234567', 'Logout saves the active draft');
    assert.deepEqual(errors, []);
    console.log("PASS: partner-style student shell, dashboard, account menu, mobile drawer/keyboard, preserved drafts, profile, review decisions, finances and SDO");
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
