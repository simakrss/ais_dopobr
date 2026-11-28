"use strict";
// Isolated save ordering and browser UI; no shared data or real site writes.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const extract = name => source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"))[0];
async function saveOrdering() {
  for (const scenario of ["success", "save-failed", "closed", "locked", "non-admin"]) {
    const calls = [], modal = {duplicateLandingMode: "new"}, form = {isConnected: true, dataset: {}};
    const context = {state: {modal}, isAdminUser: () => scenario !== "non-admin", isDatabaseDemoMode: () => false,
      saveRecordFormBeforeContinuation: async (value, options) => {
        assert.equal(value, form); assert.equal(options.flush, true); calls.push("save-and-flush");
        if (scenario === "closed") context.state.modal = null;
        return scenario === "save-failed" ? "" : "copy-id";
      },
      openProgramCardById: async id => {calls.push("open-saved-card"); context.state.modal = {id, readOnly: scenario === "locked"};},
      openProgramSiteGenerator: async () => {calls.push("open-generator"); assert.equal(await context.saveProgramDuplicateForSite(form), false, "Repeated submit while opening generator must be ignored");}
    };
    vm.createContext(context); vm.runInContext(extract("saveProgramDuplicateForSite"), context);
    assert.equal(await context.saveProgramDuplicateForSite(form), !["save-failed", "non-admin"].includes(scenario));
    const expected = scenario === "non-admin" ? [] : scenario === "success" ? ["save-and-flush", "open-saved-card", "open-generator"]
      : scenario === "locked" ? ["save-and-flush", "open-saved-card"] : ["save-and-flush"];
    assert.deepEqual(calls, expected, scenario);
    assert.equal(form.dataset.duplicateSiteSaving, undefined, "Failed saves must permit retry");
  }
}
async function browserCheck() {
  const browser = await chromium.launch({headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge"});
  try {
    const page = await browser.newPage({viewport: {width: 1100, height: 850}});
    await page.route("**/*", route => route.fulfill({contentType: "text/html", body: `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fs.readFileSync(path.join(root,"styles.css"),"utf8")}</style><button id="open" class="ghost-button">Дублировать</button></html>`}));
    await page.goto("http://127.0.0.1/isolated-duplicate-landing");
    await page.addScriptTag({content: `${extract("escapeHtml")}\n${extract("confirmRecordDuplication")}
      let result=null, admin=true;
      document.querySelector('#open').onclick=async()=>{result=null;result=await confirmRecordDuplication({title:'Дублировать образовательную программу?',message:'Создать копию программы «Новый вебинар» вместе с учебным планом?',programLandingChoice:true,canCreateLanding:admin});};`});
    await page.click("#open");
    assert.equal(await page.locator("[data-duplicate-landing-mode]").inputValue(), "shared");
    assert.match(await page.locator("#recordDuplicateHelp").textContent(), /нового вебинара/);
    await page.click('[data-action="confirm-record-duplication"]');
    assert.equal(await page.evaluate(()=>result), "shared");
    for (const width of [1100, 390, 320]) {
      await page.setViewportSize({width, height: 720});
      await page.click("#open");
      await page.selectOption("[data-duplicate-landing-mode]", "new");
      const layout = await page.locator('[data-record-duplicate-confirmation] .modal').evaluate(el=>({fits:el.getBoundingClientRect().width<=innerWidth, overflow:el.scrollWidth>el.clientWidth}));
      assert.equal(layout.fits, true); assert.equal(layout.overflow, false);
      if (process.env.AIS_TEST_SCREENSHOT && width === 390) await page.screenshot({path:process.env.AIS_TEST_SCREENSHOT});
      await page.click('[data-action="confirm-record-duplication"]');
      assert.equal(await page.evaluate(()=>result), "new");
    }
    await page.click("#open"); await page.selectOption("[data-duplicate-landing-mode]", "new");
    await page.press('[data-action="cancel-record-duplication"]', "Escape");
    assert.equal(await page.evaluate(()=>result), false);
    await page.evaluate(()=>{admin=false;}); await page.click("#open");
    assert.equal(await page.locator('option[value="new"]').evaluate(el=>el.disabled), true, await page.locator('option[value="new"]').evaluate(el=>el.outerHTML));
    await page.click('[data-action="cancel-record-duplication"]');
  } finally {await browser.close();}
}
(async()=>{await saveOrdering();await browserCheck();console.log("PASS: separate/shared selection, cancellation, admin permission, save/flush before generator, stale/locked card protection and desktop/390/320px layout");})().catch(error=>{console.error(error);process.exitCode=1;});
