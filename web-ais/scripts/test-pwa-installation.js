"use strict";
// Real browser + actual public static handler, isolated from databases and user sessions.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const http = require("node:http"), vm = require("node:vm"), crypto = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."), read = name => fs.readFileSync(path.join(root, name), "utf8");
const assets = require("../pwa-assets.js"), update = require("../local-update.js");
const serverSource = read("app-server.js");
const staticSource = serverSource.slice(serverSource.indexOf("const PUBLIC_STATIC_PATHS ="), serverSource.indexOf("async function route(req, res)"));
const context = vm.createContext({ URL, Buffer, Object, path, ROOT: root, pwaAssets: assets, CORS_HEADERS: {},
  fs: require("node:fs/promises"), isInsideRoot: file => file.startsWith(root + path.sep),
  sendError: (res, code, error) => { res.writeHead(code, {"Content-Type":"application/json"}); res.end(JSON.stringify({error})); }
});
vm.runInContext(staticSource, context);
vm.runInContext(serverSource.match(/const MIME_TYPES = \{[\s\S]*?\n\};/)[0], context);
const statics = vm.runInContext("serveStatic", context);
const manifest = JSON.parse(read("manifest.webmanifest"));
assert.equal(manifest.display, "standalone");
assert.equal(manifest.id, "./"); assert.equal(manifest.start_url, "./"); assert.equal(manifest.scope, "./");
for (const [url, asset] of Object.entries(assets)) {
  const bytes = Buffer.from(asset.base64, "base64");
  assert.deepEqual(bytes, fs.readFileSync(path.join(root, url.slice(1))), "Hosted/local asset mismatch: " + url);
  if (asset.type === "image/png") {
    const size = url.includes("192") ? 192 : url.includes("apple") ? 180 : 512;
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  }
}
for (const file of ["app.js", "auth-bootstrap.js", "partner-app.js"]) assert.match(read(file), /data-pwa-install/);
assert.match(read(".htaccess"), /AddType application\/manifest\+json \.webmanifest/);
assert.doesNotMatch(read("pwa-client.js"), /serviceWorker\.register|caches\.open|localStorage|indexedDB/);
assert.ok(update.FILES.includes("pwa-assets.js") && update.FILES.includes("pwa-client.js"));
// Previous updater's JS-only extension policy must accept the entire next release.
for (const name of update.FILES) assert.ok(name === "favicon.ico" || /^(?:[a-z][a-z0-9-]*\.(?:js|css|html)|scripts\/[a-z][a-z0-9-]*\.(?:js|ps1))$/.test(name), name);
const keys = crypto.generateKeyPairSync("ed25519");
const sign = version => {
  const files = update.FILES.filter(name => version !== "1.7.547" || !name.startsWith("pwa-"));
  const payload = Buffer.from(JSON.stringify({ protocol:1, version, build:"pwa-test-release", commit:"a".repeat(40),
    files: files.map(name => ({path:name, size:1, sha256:"a".repeat(64)})) }));
  return {payload:payload.toString("base64"),signature:crypto.sign(null,payload,keys.privateKey).toString("base64")};
};
for (const version of ["1.7.547", "1.7.548"]) update.validateEnvelope(sign(version), keys.publicKey.export({format:"der",type:"spki"}).toString("base64"));

(async () => {
  const requests = [], errors = [];
  const server = http.createServer((req,res) => {
    requests.push(req.url);
    if (req.url.startsWith("/lms/")) req.url = req.url.slice(4);
    if (req.url.startsWith("/api/")) {
      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify(req.url.startsWith("/api/auth/me") ? {ok:true,user:null} : {phase:"idle",ok:true}));
    } else statics(req,res).catch(error => {errors.push(error.message); res.end();});
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Empty userDataDir gives an auto-cleaned, isolated non-incognito profile.
  const browserContext = await chromium.launchPersistentContext("", {headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const browser = browserContext.browser();
  try {
    const page = await browserContext.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*",route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
    for (const prefix of ["/", "/lms/"]) {
      await page.goto(base + prefix + "?signed-out=1&token=must-not-be-in-app-start-url");
      await page.waitForSelector("[data-pwa-install]");
      const cdp = await page.context().newCDPSession(page);
      const result = await cdp.send("Page.getAppManifest");
      assert.deepEqual(result.errors, []);
      assert.ok(result.url.endsWith(prefix + "manifest.webmanifest"));
      assert.deepEqual(JSON.parse(result.data), manifest);
      const installation = await cdp.send("Page.getInstallabilityErrors");
      assert.deepEqual(installation.installabilityErrors, [], "Browser installation criteria at " + prefix);
      await cdp.detach();
      for (const [url, asset] of Object.entries(assets)) {
        const response = await fetch(base + prefix + url.slice(1));
        assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), asset.type);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(asset.base64,"base64"));
        const head = await fetch(base + prefix + url.slice(1), {method:"HEAD"});
        assert.equal(head.status,200); assert.equal((await head.arrayBuffer()).byteLength,0);
      }
      for (const url of ["pwa-assets.js", "scripts/build-pwa-assets.js", "storage/settings.json", "not-public.png"]) {
        assert.equal((await fetch(base + prefix + url)).status,404,url);
      }
    }
    // Fresh script creates its closure with no pending native prompt in a synthetic page.
    await page.goto(base + "/missing-test-page");
    await page.setContent('<link rel="stylesheet" href="/styles.css"><button data-pwa-install>Установить приложение</button>');
    await page.addScriptTag({url:base + "/pwa-client.js"});
    for (const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1366,height:900}]) {
      await page.setViewportSize(viewport); await page.click("[data-pwa-install]");
      const box = await page.locator(".pwa-install-dialog").boundingBox();
      assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=viewport.width+1 && box.y+box.height<=viewport.height+1);
      assert.equal(await page.locator("[data-pwa-confirm]").isVisible(),false);
      assert.match(await page.locator(".pwa-install-dialog").textContent(),/доступ к серверу/);
      if (process.env.UI_SCREENSHOT && viewport.width===390) await page.screenshot({path:process.env.UI_SCREENSHOT});
      await page.keyboard.press("Escape"); assert.equal(await page.locator(".pwa-install-dialog").isVisible(),false);
    }
    await page.evaluate(() => {
      window.installCalls = 0;
      const event = new Event("beforeinstallprompt",{cancelable:true});
      event.prompt = async () => { window.installCalls++; };
      event.userChoice = Promise.resolve({outcome:"dismissed"});
      window.dispatchEvent(event);
      window.installDefaultPrevented = event.defaultPrevented;
    });
    assert.equal(await page.evaluate(() => window.installCalls),0,"No unsolicited installation prompt");
    await page.click("[data-pwa-install]");
    assert.equal(await page.evaluate(() => window.installCalls),1);
    assert.equal(await page.evaluate(() => window.installDefaultPrevented),true);
    await page.click("[data-pwa-install]");
    assert.equal(await page.evaluate(() => window.installCalls),1,"One-shot prompt consumed");
    assert.equal(await page.locator(".pwa-install-dialog").isVisible(),true);
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    assert.equal(await page.locator("[data-pwa-install]").isVisible(),false);
    assert.equal(await page.locator(".pwa-install-dialog").isVisible(),false);
    // Re-rendered buttons must stay hidden after installation.
    await page.evaluate(() => document.body.insertAdjacentHTML("beforeend",'<button data-pwa-install>Новая кнопка</button>'));
    assert.equal(await page.locator("[data-pwa-install]").last().isVisible(),false);

    const ios = await browser.newContext({viewport:{width:390,height:844},userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"});
    const iphone = await ios.newPage();
    await iphone.goto(base+"/missing-test-page");
    await iphone.setContent('<link rel="stylesheet" href="/styles.css"><button data-pwa-install>Установить</button>');
    await iphone.addScriptTag({url:base+"/pwa-client.js"});
    await iphone.click("[data-pwa-install]");
    assert.match(await iphone.locator("[data-pwa-steps]").textContent(),/Поделиться[\s\S]*На экран Домой/);
    await iphone.keyboard.press("Escape");
    await iphone.evaluate(() => Object.defineProperty(navigator,"standalone",{value:true}));
    await iphone.addScriptTag({url:base+"/pwa-client.js"});
    assert.equal(await iphone.locator("[data-pwa-install]").isVisible(),false);
    await ios.close();
    assert.deepEqual(errors,[]);
    console.log("PASS: real browser installability at / and /lms/, manifest MIME/scope/icons, HEAD, private-file denial, desktop/mobile dialog, iOS instructions, one-shot user-initiated prompt, installed state, no PWA cache, signed-update compatibility");
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode=1; });
