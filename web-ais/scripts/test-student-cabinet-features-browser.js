"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."), png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const record = { id: "first", name: "Тестовая Светлана Александровна", email: "fixture@example.test", program: "Повышение квалификации", status: "Учится", citizenship: "Россия", workPlace: "Школа", enrollmentNameChanged: false, educationDocumentSurname: "Тестовая" };
const messages = [{ id: "root", threadId: "thread", direction: "student", status: "sent", createdAt: 1, subject: "Вопрос о документах", message: "Где получить документ?" },
  { id: "answer", threadId: "thread", direction: "center", status: "sent", createdAt: 2, subject: "Ответ", message: "Документ будет готов завтра. <script>window.injection=true</script>" }];
let paid = false, photo = false, sent, photoUploads = 0, awardReads = [];
const view = () => ({ user: { name: record.name, email: record.email }, record, photoAvailable: photo, applications: [{ id: "first", program: record.program, status: "Учится" }], fields: [
  { key: "name", label: "ФИО", type: "text", required: true }, { key: "citizenship", label: "Гражданство", type: "combo", required: true, options: ["Беларусь", "Казахстан", "Россия", "Узбекистан"] },
  { key: "workPlace", label: "Место работы", type: "combo", required: true, options: ["Школа", "Не работаю"] }, { key: "enrollmentNameChanged", label: "ФИО в документе об образовании отличается от паспорта", type: "checkbox" }, { key: "educationDocumentSurname", label: "Фамилия в документе об образовании", type: "text", dependsOn: "enrollmentNameChanged" }],
  missing: [], documents: [], requirements: [], finances: { total: 10000, paid: paid ? 10000 : 5000, debt: paid ? 0 : 5000, payments: [] }, feedbackRecipient: "center@example.test" });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://test"), chunks = []; for await (const chunk of req) chunks.push(chunk);
  res.setHeader("Content-Type", "application/json");
  if (url.pathname.startsWith("/api/student-portal")) {
    const action = url.pathname.slice("/api/student-portal".length), body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    if (action === "/profile") Object.assign(record, body);
    if (action === "/photo" && req.method === "POST") { assert.ok(body.base64); photoUploads++; photo = true; }
    if (action === "/photo" && req.method === "GET") { res.setHeader("Content-Type", "image/png"); return res.end(png); }
    if (action === "/feedback-sync" || action === "/feedback" && req.method === "GET") return res.end(JSON.stringify({ messages }));
    if (action === "/feedback") { sent = body; messages.push({ ...body, id: "new", direction: "student", status: "sent", createdAt: 3 }); return res.end(JSON.stringify({ ok: true, message: "Сообщение отправлено в учебный центр." })); }
    if (action === "/payment") return res.end(JSON.stringify({ ok: true, url: "https://zifra-plus.ru/checkout/order-pay/701/?key=fixture", amount: 5000 }));
    if (action === "/payment-status") paid = true;
    if (action === "/awards") return res.end(JSON.stringify({ programs: [
      { id: "first", program: "Повышение квалификации", number: "001", debt: paid ? 0 : 5000, files: [{ id: "scan", name: "Удостоверение.pdf", kind: "scan" }] },
      { id: "second", program: "Переподготовка", number: "002", debt: 0, files: [{ id: "layout", name: "Макет диплома.pdf", kind: "layout" }] }] }));
    if (action === "/award-file") { awardReads.push({ application: url.searchParams.get("id"), file: url.searchParams.get("file") }); res.setHeader("Content-Type", "image/png"); return res.end(png); }
    return res.end(JSON.stringify(view()));
  }
  if (["/student-portal.js", "/styles.css"].includes(url.pathname)) { res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "application/javascript"); return res.end(fs.readFileSync(path.join(root, url.pathname.slice(1)))); }
  res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="app"></div><script>window.AIS_AUTH_API={appUrl:p=>"/"+p, request:async(p,o)=>{const r=await fetch("/"+p,o);const data=await r.json();if(!r.ok)throw Error(data.error);return data;}};</script><script src="/student-portal.js"></script>');
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    const context = await browser.newContext(), page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
    await context.route("https://zifra-plus.ru/**", route => route.fulfill({ contentType: "text/html", body: "Тестовая страница оплаты ЮKassa" }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('[data-tab="main"]').click();
    assert.equal(await page.locator('.student-program-name, .student-program-status').count(), 0);
    assert.equal(await page.locator('[name="citizenship"]').getAttribute("role"), "combobox");
    assert.ok(await page.locator('[name="educationDocumentSurname"]').isHidden());
    await page.locator('[name="enrollmentNameChanged"]').check();
    assert.ok(await page.locator('[name="educationDocumentSurname"]').isVisible());
    await page.locator('[name="educationDocumentSurname"]').fill('Прежняя');
    await page.locator('[name="citizenship"]').fill('Бел');
    await page.getByRole('option', { name: 'Беларусь', exact: true }).waitFor();
    assert.equal(await page.locator('#student-options-citizenship [role="option"]:visible').count(), 1);
    await page.locator('[name="citizenship"]').press('ArrowDown'); await page.locator('[name="citizenship"]').press('Enter');
    assert.equal(await page.locator('[name="citizenship"]').inputValue(), 'Беларусь');
    assert.equal(await page.locator('[name="citizenship"]').getAttribute('aria-expanded'), 'false');
    await page.locator('[name="workPlace"]').fill("Новая организация");
    await page.locator('[data-photo]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await page.getByText("Фотография сохранена.", { exact: true }).waitFor(); assert.equal(photoUploads, 1); assert.equal(record.workPlace, "Новая организация"); assert.equal(record.educationDocumentSurname, "Прежняя"); assert.equal(record.citizenship, "Беларусь");
    assert.ok(await page.locator('.student-profile-photo img').isVisible());
    await page.locator('[data-tab="feedback"]').click(); await page.getByText("Документ будет готов завтра.", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.injection), undefined);
    await page.locator('[data-thread-reply]').click(); await page.locator('[name="message"]').fill("Спасибо, ожидаю получения документа.");
    await page.locator('[data-feedback-form] button[type="submit"]').click(); await page.getByText("Сообщение отправлено в учебный центр.", { exact: true }).waitFor();
    await page.locator('.student-correspondence-message').nth(2).waitFor(); assert.equal(sent.threadId, "thread");
    await page.locator('[data-tab="finances"]').click(); assert.ok(await page.locator('[data-panel="finances"] .student-debt-note').isVisible());
    const opened = context.waitForEvent("page"); await page.locator('[data-pay]').click(); const paymentPage = await opened;
    await paymentPage.waitForURL('https://zifra-plus.ru/checkout/order-pay/701/**'); await paymentPage.close();
    await page.locator('[data-payment-refresh]').click(); await page.getByText("Сведения об оплатах обновлены.", { exact: true }).waitFor(); assert.equal(await page.locator('[data-pay]').count(), 0);
    await page.locator('[data-tab="awards"]').click(); await page.locator('.student-award-program').nth(1).waitFor();
    await page.locator('[data-award-view="layout"]').click(); await page.locator('dialog[open] img').waitFor();
    assert.deepEqual(awardReads[0], { application: "second", file: "layout" }); await page.getByRole('button', { name: 'Закрыть просмотр' }).click();
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-sidebar-open]').click(); await page.locator('[data-tab="feedback"]').click();
    await page.waitForTimeout(300); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const dir = path.join(root, '.runtime/student-portal-test'); fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'mobile-correspondence.png'), fullPage: true, animations: 'disabled' });
    await page.locator('[data-sidebar-open]').click(); await page.locator('[data-tab="awards"]').click(); await page.locator('.student-award-program').nth(1).waitFor();
    await page.screenshot({ path: path.join(dir, 'mobile-awards.png'), fullPage: true, animations: 'disabled' });
    await page.locator('[data-sidebar-open]').click(); await page.locator('[data-tab="main"]').click();
    await page.locator('[name="citizenship"]').click();
    const listBox = await page.locator('#student-options-citizenship').boundingBox();
    assert.ok(listBox && listBox.x >= 0 && listBox.x + listBox.width <= 391 && listBox.y >= 0 && listBox.y + listBox.height <= 845);
    await page.screenshot({ path: path.join(dir, 'mobile-profile-lookup.png'), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []); console.log('PASS: photo, dictionaries, persistent correspondence, escaped mail, thread reply, payment popup/refresh, multiple programs and mobile awards preview');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
