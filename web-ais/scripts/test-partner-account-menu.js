"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "partner-app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  \\}$`, "m"));
  assert.ok(match, name);
  return match[0];
}

async function testMenu() {
  const document = { activeElement: null, querySelector: () => ({ remove: () => removed++ }) };
  let removed = 0, expanded, logoutRequest, redirected = false;
  const trigger = {
    setAttribute: (name, value) => { assert.equal(name, "aria-expanded"); expanded = value; },
    focus: () => { document.activeElement = trigger; },
    closest: selector => selector === "#partner-account-trigger" ? trigger : null
  };
  const items = [0, 1].map(() => {
    const item = { getClientRects: () => [{}], closest: () => null, focus: () => { document.activeElement = item; } };
    return item;
  });
  const installedButton = { getClientRects: () => [], focus: () => assert.fail("Hidden install button must be skipped") };
  const menu = { hidden: true, querySelectorAll: () => [items[0], installedButton, items[1]], contains: target => items.includes(target) };
  const context = {
    app: { querySelector: selector => selector === "#partner-account-menu" ? menu : trigger },
    document,
    state: { view: "dashboard", portal: { profile: { name: 'Тестовый <партнёр> "Имя"' } } },
    authUser: {}, NAV_ITEMS: [{ id: "dashboard", label: "Рабочий стол" }],
    authApi: {
      request: async (url, options) => { logoutRequest = { url, options }; },
      redirectToLogin: () => { redirected = true; }
    }
  };
  vm.createContext(context);
  vm.runInContext(["escapeHtml", "escapeAttr", "icon", "renderHeader", "setPartnerAccountMenu", "handlePartnerAccountMenuKeydown", "logout"].map(extract).join("\n"), context);
  const html = context.renderHeader();
  assert.match(html, /aria-haspopup="menu" aria-expanded="false"/);
  assert.match(html, /role="menu" aria-labelledby="partner-account-trigger" hidden/);
  assert.match(html, /data-view="profile" type="button" role="menuitem"/);
  assert.match(html, /data-action="logout" type="button" role="menuitem"/);
  assert.match(html, /Тестовый &lt;партнёр&gt; &quot;Имя&quot;/);
  assert.match(html, /data-pwa-install type="button" role="menuitem"/);
  assert.equal((html.match(/role="menuitem"/g) || []).length, 3);
  context.setPartnerAccountMenu(true, { focusIndex: 0 });
  assert.equal(menu.hidden, false); assert.equal(expanded, "true");
  assert.equal(document.activeElement, items[0]); assert.equal(removed, 1);
  const key = (target, value) => {
    let prevented = false;
    const handled = context.handlePartnerAccountMenuKeydown({ target, key: value, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, handled);
    return handled;
  };
  assert.equal(key(items[0], "ArrowDown"), true); assert.equal(document.activeElement, items[1]);
  key(items[1], "ArrowDown"); assert.equal(document.activeElement, items[0]);
  key(items[0], "ArrowUp"); assert.equal(document.activeElement, items[1]);
  key(items[1], "Home"); assert.equal(document.activeElement, items[0]);
  key(items[0], "End"); assert.equal(document.activeElement, items[1]);
  assert.equal(key(items[1], "Tab"), false);
  key(items[1], "Escape"); assert.equal(menu.hidden, true); assert.equal(expanded, "false");
  assert.equal(document.activeElement, trigger);
  assert.equal(key(trigger, "Escape"), false);
  key(trigger, "ArrowUp"); assert.equal(document.activeElement, items[1]);
  context.setPartnerAccountMenu(false);
  key(trigger, "ArrowDown"); assert.equal(document.activeElement, items[0]);
  await context.logout();
  assert.equal(logoutRequest.url, "api/auth/logout"); assert.equal(logoutRequest.options.method, "POST");
  assert.equal(redirected, true);
  context.authApi.request = async () => { throw Error("offline"); }; redirected = false;
  await context.logout(); assert.equal(redirected, true);
  context.app.querySelector = () => null;
  context.setPartnerAccountMenu(true);
  assert.equal(key(trigger, "Escape"), false, "Loading/error screens may have no header");
  assert.match(source, /action === "toggle-account-menu"/);
  assert.match(source, /addEventListener\("contextmenu",[\s\S]*?closest\("#partner-account-trigger"\)/);
  assert.match(source, /!event.target.closest\(".partner-account"\)\) setPartnerAccountMenu\(false\)/);
  assert.match(source, /!account.contains\(event.relatedTarget\)\) setPartnerAccountMenu\(false\)/);
  assert.match(source, /addEventListener\("popstate", \(\) => setPartnerAccountMenu\(false\)\)/);
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.partner-account-menu\[hidden\]\s*\{\s*display: none;/);
  assert.match(css, /\.partner-account-menu\s*\{[^}]*right: 0;/);
  console.log("Partner account menu: safe header, install action, hidden-item skipping, focus/keyboard/wrapping, dismissal wiring, existing POST logout, responsive anchor: OK");
}

function serveFixture() {
  const portal = {
    profile: { name: "Тестовый Партнёр Александрович", tabs: { main: [], contract: [], documents: [] } },
    payments: { rows: [], summary: {} }, materials: {}
  };
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="app"></div><script>
    window.AIS_AUTH_USER = { name: 'Тестовый Партнёр Александрович', login: 'test.partner', role: 'partner' };
    window.AIS_AUTH_API = {
      appUrl: path => path,
      redirectToLogin: () => location.replace('/login'),
      request: async (path, options) => {
        if (path === 'api/partner/portal') return ${JSON.stringify(portal)};
        if (path === 'api/auth/logout') return fetch('/api/auth/logout', options).then(response => response.json());
        return { path: '/', items: [] };
      }
    };
  </script><script src="/partner-app.js"></script></html>`;
  let logoutMethod = "";
  require("node:http").createServer((req, res) => {
    if (req.url === "/api/auth/logout") {
      logoutMethod = req.method; res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
    } else if (req.url === "/" || req.url === "/login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(req.url === "/" ? html : `<h1>Сеанс завершён</h1><p>Выход: ${logoutMethod}</p>`);
    } else if (["/styles.css", "/partner-app.js"].includes(req.url)) {
      res.writeHead(200, { "Content-Type": req.url.endsWith(".css") ? "text/css" : "text/javascript" });
      res.end(fs.readFileSync(path.join(root, req.url.slice(1))));
    } else { res.writeHead(404); res.end(); }
  }).listen(0, "127.0.0.1", function () { console.log(`Partner account fixture: http://127.0.0.1:${this.address().port}/`); });
}

testMenu().then(() => { if (process.argv.includes("--serve")) serveFixture(); }).catch(error => { console.error(error); process.exitCode = 1; });
