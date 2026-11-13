"use strict";
// Browser-only synthetic fixtures; no login, storage, production data or API.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/g, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const start = source.indexOf("  function parseSystemHelpTooltip(");
const end = source.indexOf("  function isTableValueFilterHoverSupported(", start);
const declarations = source.match(/^  (?:let (?:systemHelp|pendingSystemHelp|lastSystemHelp)\w*|const (?:SYSTEM_HELP|DRAG_TOOLTIP)\w*) = .*;$/gm);
const sqlStart = source.indexOf("  function hideSqlMiniIdeKeywordTooltip(");
const sqlEnd = source.indexOf("  function createSqlMiniIdeTextRange(", sqlStart);
assert.ok(start >= 0 && end > start && sqlStart >= 0 && sqlEnd > sqlStart);

async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const fallback of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent(`<!doctype html><html><body>
        <section id="card" style="position:fixed;left:20px;top:60px;width:480px;height:120px;overflow:hidden;transform:translateZ(0);z-index:13200;background:white">
          <div style="position:sticky;top:0;z-index:3">Вкладки окна</div>
          <button id="title" title="Подсказка кнопки&#10;Полное примечание к действию">Действие</button>
          <label id="field" data-tooltip="Примечание к полю"><input id="input" aria-label="Поле"></label>
          <table><tbody><tr><td><span id="cell" data-table-cell-full-text="Полный текст ячейки таблицы" style="display:block;width:35px;overflow:hidden;white-space:nowrap">Полный текст ячейки таблицы</span></td></tr></tbody></table>
        </section>
        <div id="cover" style="position:fixed;left:0;top:180px;right:0;bottom:0;background:#dbeae4;z-index:100000">Высокий слой другого окна</div>
        <dialog id="dialog" style="width:280px;height:120px;overflow:hidden"><div style="height:30px">Вкладки диалога</div><button id="modal" title="Подсказка в модальном диалоге">Поле диалога</button>
        <div id="editor" contenteditable="true"><span id="sql" data-sql-keyword-help="Описание SELECT">SELECT</span></div></dialog>
        </body></html>`);
      await page.addStyleTag({ content: styles });
      if (fallback) await page.evaluate(() => { Object.defineProperty(HTMLElement.prototype, "showPopover", { value: undefined, configurable: true }); });
      await page.addScriptTag({ content: declarations.join("\n") + "\n" + source.slice(start, end)
        + '\nconst ADMIN_SQL_KEYWORD_HELP = {SELECT:"Выбирает поля таблицы"};\n' + source.slice(sqlStart, sqlEnd)
        + '\nbindSystemHelpTooltips();document.querySelector("#sql").addEventListener("mouseover", e => showSqlMiniIdeKeywordTooltip(document.querySelector("#editor"), e.target));' });
      const tip = page.locator("[data-system-help-tooltip]");
      const visible = async () => {
        await tip.waitFor({ state: "visible" });
        await page.waitForFunction(() => {
          const tip = document.querySelector("[data-system-help-tooltip]");
          return tip && !tip.getAnimations().some(animation => animation.playState === "running");
        });
        const info = await tip.evaluate(node => {
          const rect = node.getBoundingClientRect();
          const oldPointerEvents = node.style.pointerEvents;
          node.style.pointerEvents = "auto";
          const onTop = node.contains(document.elementFromPoint(rect.left + 5, rect.bottom - 5));
          node.style.pointerEvents = oldPointerEvents;
          return { onTop, fits: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
            topLayer: node.hasAttribute("popover") && node.matches(":popover-open"), parent: node.parentElement.tagName };
        });
        assert.equal(info.fits, true, "Tooltip fits the screen");
        assert.equal(info.onTop, true, "Tooltip paints above even a higher-z window or modal dialog");
        assert.equal(info.topLayer, !fallback);
        assert.equal(await page.locator('[role="tooltip"]:visible').count(), 1);
        return info;
      };
      await page.locator("#title").hover();
      await visible();
      assert.equal(await page.locator("#title").getAttribute("title"), null, "No duplicate native title");
      await page.mouse.move(900, 10);
      await tip.waitFor({ state: "hidden" });
      await page.locator("#input").focus();
      await visible();
      await page.keyboard.press("Escape");
      await tip.waitFor({ state: "hidden" });
      await page.locator("#cell").hover();
      await visible();
      assert.match(await tip.textContent(), /Полный текст ячейки таблицы/u);

      await page.evaluate(() => { hideSystemHelpTooltip(); document.querySelector("#dialog").showModal(); });
      await page.locator("#modal").hover();
      assert.equal((await visible()).parent, "DIALOG", "Keep modal note out of the inert body subtree");
      await page.locator("#sql").hover();
      await visible();
      assert.match(await tip.textContent(), /Выбирает поля таблицы/u);
      await page.evaluate(() => document.querySelector("#dialog").close());
      await tip.waitFor({ state: "hidden" });
      await page.evaluate(() => {
        const dialog = document.querySelector("#dialog");
        dialog.showModal();
        scheduleSystemHelpTooltip(document.querySelector("#modal"));
        dialog.close();
      });
      await page.waitForFunction(() => pendingSystemHelpTooltipTarget === null);
      await page.evaluate(() => showSystemHelpTooltip(document.querySelector("#modal")));
      assert.equal(await tip.isVisible(), false, "Closed/hidden sources must not leave an orphan note");

      // All four screen edges, unbroken strings and a viewport smaller than the card.
      await page.setViewportSize({ width: 320, height: 400 });
      await page.evaluate(() => { document.querySelector("#cover").remove(); document.querySelector("#card").style.cssText = "position:fixed;inset:0;z-index:13200;overflow:hidden;transform:translateZ(0)"; });
      for (const corner of ["top:0;left:0", "top:0;right:0", "bottom:0;left:0", "bottom:0;right:0"]) {
        await page.evaluate(corner => {
          hideSystemHelpTooltip(); const button = document.querySelector("#title");
          button.style.cssText = "position:fixed;" + corner;
          button.dataset.systemHelpSource = "Примечание\n" + "ОченьДлиннаяСтрока".repeat(15);
        }, corner);
        await page.locator("#title").focus();
        await page.evaluate(() => showSystemHelpTooltip(document.querySelector("#title")));
        await visible();
      }
      await page.evaluate(() => {
        const button = document.querySelector("#title");
        button.dataset.systemHelpSource = "Большое примечание\n" + "Строка с подробным пояснением.\n".repeat(80) + "КОНЕЦ";
        showSystemHelpTooltip(button);
      });
      await visible();
      assert.equal(await tip.evaluate(node => node.scrollHeight > node.clientHeight), true);
      await tip.hover();
      await page.mouse.wheel(0, 20000);
      await page.waitForFunction(() => { const t = document.querySelector('[data-system-help-tooltip]'); return t.scrollTop + t.clientHeight >= t.scrollHeight - 2; });
      assert.equal(await tip.isVisible(), true, "Scrolling the note must not close it");
      if (!fallback && process.env.AIS_HELP_SCREENSHOT) await page.screenshot({ path: process.env.AIS_HELP_SCREENSHOT });
      await page.evaluate(() => document.querySelector("#title").remove());
      await tip.waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("PASS: all help sources, table cells, SQL, high-z windows, modal dialogs, old-browser fallback, screen edges, long text scrolling, Escape and detached-source cleanup");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
