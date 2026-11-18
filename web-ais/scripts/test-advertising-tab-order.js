"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
const rendererStart = source.indexOf("  function renderAdvertising()");
const tabsStart = source.indexOf("    const advertisingTabs =", rendererStart);
const tabsEnd = source.indexOf("    const transferredToAdvertising =", tabsStart);
const navStart = source.indexOf('<nav class="program-tabs advertising-tabs"', tabsEnd);
const navEnd = source.indexOf("</nav>", navStart) + 6;
assert.ok(rendererStart >= 0 && tabsEnd > tabsStart && navEnd > navStart);
const renderTabs = 'function renderTabs(){const advertising=state.advertising;\n'
  + source.slice(tabsStart, tabsEnd) + '\nreturn `' + source.slice(navStart, navEnd) + '`;}';
assert.doesNotMatch(source.slice(tabsStart, tabsEnd), /\.sort\(/, "Saved order must not be pinned/re-sorted");
const helpers = ["getOrderedTabs", "mergeVisibleInterfaceOrder", "syncOrderableTabOrderFromDom", "getOrderableTabDragAfterElement", "resetOrderableTabOrder", "bindOrderableTabs", "escapeAttr", "escapeHtml"].map(extract).join("\n");

async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<main id="fixture"></main>');
    await page.addStyleTag({ path: path.join(root, "styles.css") });
    await page.addScriptTag({ content: `
      const state={advertising:{tab:"collector"},tabOrders:{}};
      let admin=true, saved=null, saves=0;
      function isAdminUser(){return admin;}
      function persistTabOrders(){saved=structuredClone(state.tabOrders);saves++;}
      function closeOrderableTabMenu(){}
      function showOrderableTabMenu(){}
      ${helpers}\n${renderTabs}
      function render(){document.querySelector('#fixture').innerHTML=renderTabs();document.body.classList.add('shift-drag-ready');bindOrderableTabs();}
      render();
    ` });
    const order = () => page.locator("[data-orderable-tab]").evaluateAll(nodes => nodes.map(node => node.dataset.orderableTab));
    const defaults = ["collector", "mailings", "sources", "sites", "exclusions"];
    assert.deepEqual(await order(), defaults);
    assert.equal(await page.locator('[aria-selected="true"]').getAttribute("data-orderable-tab"), "collector");
    // Native HTML drag handlers, rerender and restored state: mailings can stay last.
    const mailings = page.locator('[data-orderable-tab="mailings"]');
    await mailings.dragTo(page.locator('[data-orderable-tab="exclusions"]'), { targetPosition: { x: 90, y: 15 } });
    const reordered = await order();
    assert.equal(reordered.at(-1), "mailings");
    assert.ok(await page.evaluate(() => saves > 0));
    await page.evaluate(() => { state.tabOrders=structuredClone(saved); render(); });
    assert.deepEqual(await order(), reordered, "Rerender must not force mailings back to first");
    assert.equal(await page.locator('[aria-selected="true"]').getAttribute("data-orderable-tab"), "collector", "Dragging does not switch active tab");
    // Every tab can be last, without losing role-restricted tabs from common settings.
    for (const id of defaults) {
      await page.evaluate(id => {
        const container=document.querySelector('[data-orderable-tabs]');
        container.appendChild(container.querySelector('[data-orderable-tab="'+id+'"]'));
        container.dispatchEvent(new Event('drop',{bubbles:true,cancelable:true})); render();
      }, id);
      assert.equal((await order()).at(-1), id);
    }
    await page.evaluate(() => { admin=false; render(); });
    assert.deepEqual(new Set(await order()), new Set(["collector", "mailings", "exclusions"]));
    await page.evaluate(() => {
      const container=document.querySelector('[data-orderable-tabs]');
      container.appendChild(container.querySelector('[data-orderable-tab="mailings"]'));
      syncOrderableTabOrderFromDom(container); admin=true; render();
    });
    assert.ok((await order()).includes("sources") && (await order()).includes("sites"));
    await page.evaluate(() => { resetOrderableTabOrder(document.querySelector('[data-orderable-tabs]')); render(); });
    assert.deepEqual(await order(), defaults, "Reset returns collector to first, without pinning it");
    assert.deepEqual(errors, []);
    console.log("PASS: collector first, all advertising tabs movable, actual mailings drag, saved order/rerender, active tab, role filtering and reset");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
