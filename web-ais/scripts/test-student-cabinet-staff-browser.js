"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."), app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const buttonCode = app.slice(app.indexOf("  function renderStudentPortalOpenButton("), app.indexOf("  function renderStudentModal("));
const user = { id: "staff", login: "staff", name: "Сотрудник", role: "manager", status: "active" };
let logout = 0, login = 0, personalApi = 0, fileReads = 0, feedbackSent = 0;
const requests = [], records = [
  { id: "one", name: "Первый слушатель", program: "Программа один", status: "Учится", phone: "+79990000001" },
  { id: "two", name: "Первый слушатель", program: "Программа два", status: "На зачисление", phone: "+79990000002" }
];
const view = id => ({ user: { name: records[0].name, email: "fixture@example.test" }, record: records.find(row => row.id === id) || records[0],
  applications: records, fields: [{ key: "phone", label: "Телефон", type: "tel", required: true }], missing: [],
  requirements: [{ key: "passport", label: "Паспорт", required: true }], documents: [{ id: "file", kind: "passport", name: "fixture.png", uploadedAt: "2026-11-11T10:00:00Z" }],
  finances: { total: 10000, paid: 5000, debt: 5000, payments: [] }, sdoAvailable: true, feedbackRecipient: "center@example.test" });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://test"), name = url.pathname;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (name === "/api/auth/me") return res.end(JSON.stringify({ user, sessionExpiresAt: Date.now() + 3600000, demoModeEnabled: false }));
  if (name === "/api/auth/logout") { logout++; return res.end('{}'); }
  if (name === "/api/auth/login") { login++; res.statusCode = 401; return res.end('{}'); }
  if (name.startsWith("/api/student-portal")) { personalApi++; res.statusCode = 403; return res.end('{}'); }
  if (name.startsWith("/api/students/portal-preview")) {
    requests.push({ name, anchor: url.searchParams.get("studentId"), id: url.searchParams.get("id") });
    if (name.endsWith("/feedback")) { feedbackSent++; return res.end(JSON.stringify({ ok: true, message: "Сообщение отправлено в учебный центр." })); }
    if (name.endsWith("/file")) {
      fileReads++; res.setHeader("Content-Type", "image/png");
      return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    }
    if (name.endsWith("/profile")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      Object.assign(records.find(row => row.id === url.searchParams.get("id")), JSON.parse(Buffer.concat(chunks)));
    }
    return res.end(JSON.stringify(view(url.searchParams.get("id") || url.searchParams.get("studentId"))));
  }
  if (["/styles.css", "/auth-bootstrap.js", "/student-portal.js", "/field-html-links.js"].includes(name)) {
    res.setHeader("Content-Type", name.endsWith("css") ? "text/css" : "application/javascript");
    return res.end(fs.readFileSync(path.join(root, name.slice(1))));
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const head = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">';
  if (name === "/card") return res.end(head + `<input id="cardDraft" value="Несохранённое изменение"><div id="cardActions"></div><script>
    window.AIS_AUTH_USER=${JSON.stringify(user)}; window.AIS_AUTH_API={appUrl:p=>new URL(p,location.origin+'/').href};
    function isDatabaseDemoMode(){return false;} function getCurrentAuthUser(){return window.AIS_AUTH_USER;}
    function escapeAttr(v){return String(v).replaceAll('&','&amp;').replaceAll('"','&quot;');}
    ${buttonCode}
    document.querySelector('#cardActions').innerHTML=renderStudentPortalOpenButton({id:'two',studentPortalEnabled:true});
    </script>`);
  res.end(head + '<div id="app" class="app-shell"></div><script src="/auth-bootstrap.js"></script>');
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    const context = await browser.newContext(), parent = await context.newPage(), errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    await parent.goto(`http://127.0.0.1:${server.address().port}/card`);
    const popupPromise = context.waitForEvent("page"); await parent.getByText("Открыть личный кабинет", { exact: false }).click(); const popup = await popupPromise;
    await popup.locator('[data-application]').waitFor();
    assert.equal(await popup.locator('[data-application]').inputValue(), "two", "Open the card's application, not the first account record");
    assert.equal(await popup.evaluate(() => window.AIS_AUTH_USER.role), "manager");
    assert.ok(await popup.locator('.student-portal-staff-notice').isVisible());
    await popup.locator('[data-tab="main"]').click();
    await popup.locator('[name="phone"]').fill('+79998887766'); await popup.getByText('Сохранить данные', { exact: true }).click();
    await popup.getByText('Данные сохранены.', { exact: true }).waitFor(); assert.equal(records[1].phone, '+79998887766');
    await popup.locator('[data-tab="documents"]').click(); await popup.locator('[data-view]').click();
    await popup.locator('dialog[open] img').waitFor(); assert.equal(fileReads, 1); await popup.getByRole('button', { name: 'Закрыть просмотр' }).click();
    await popup.locator('[data-tab="feedback"]').click();
    await popup.locator('[name="subject"]').fill('Вопрос по второй программе');
    await popup.locator('[name="message"]').fill('Сообщение, относящееся ко второй программе обучения.');
    await popup.locator('[data-application]').selectOption('one');
    await popup.waitForFunction(() => document.querySelector('[name="subject"]').value === '');
    await popup.locator('[data-application]').selectOption('two');
    await popup.waitForFunction(() => document.querySelector('[name="subject"]').value === 'Вопрос по второй программе');
    await popup.locator('[data-feedback-form] button[type="submit"]').click();
    await popup.getByText('Сообщение отправлено в учебный центр.', { exact: true }).waitFor();
    assert.equal(feedbackSent, 1); assert.equal(requests.find(item => item.name.endsWith('/feedback')).id, 'two');
    await popup.locator('[data-application]').selectOption('one'); await popup.locator('[name="phone"]').waitFor({ state: 'attached' });
    await popup.locator('[data-tab="finances"]').click(); assert.ok(await popup.getByText('Остаток долга', { exact: true }).isVisible());
    await popup.setViewportSize({ width: 390, height: 844 }); assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= 392));
    assert.match(await popup.locator('[data-sdo]').getAttribute('href'), /portal-preview\/sdo-open\?studentId=two&id=one/);
    await popup.locator('[data-account-toggle]').click();
    const closed = popup.waitForEvent('close'); await popup.getByRole('menuitem', { name: 'Закрыть кабинет', exact: true }).click(); await closed;
    assert.equal(await parent.locator('#cardDraft').inputValue(), 'Несохранённое изменение');
    assert.equal(await parent.evaluate(() => window.AIS_AUTH_USER.role), 'manager');
    assert.equal(logout, 0); assert.equal(login, 0); assert.equal(personalApi, 0); assert.ok(requests.every(item => item.anchor === 'two'));
    assert.deepEqual(errors, []); console.log('PASS: real bootstrap, new window, correct application, profile/files/finances, mobile layout, retained staff session and unchanged original card');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
