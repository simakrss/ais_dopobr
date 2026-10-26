"use strict";
// Isolated real-browser fixture: production CSS/help handlers, no database or API.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/g, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const start = source.indexOf("  function parseSystemHelpTooltip(");
const end = source.indexOf("  function isTableValueFilterHoverSupported(", start);
assert.ok(start >= 0 && end > start);
assert.match(source, /data-tooltip="\$\{escapeAttr\(getFinalAttestationGradeTooltip\(\)\)\}"/u);
assert.doesNotMatch(styles, /\.student-final-grade-field[^{}]*::after/u,
  "A second, card-local tooltip must not be clipped below the tabs");
const declarations = source.match(/^  (?:let (?:systemHelp|pendingSystemHelp|lastSystemHelp)\w*|const (?:SYSTEM_HELP|DRAG_TOOLTIP)\w*) = .*;$/gm);
assert.ok(declarations.length >= 12);

async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const viewport of [{ width: 1100, height: 600 }, { width: 390, height: 600 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8">
        <body><section class="student-modal" style="position:fixed;bottom:16px;left:16px;width:calc(100% - 32px);height:170px;overflow:hidden;z-index:70;background:white;border:1px solid #b9d4cc">
        <form style="display:block;height:100%;overflow:hidden">
          <header style="height:45px;padding:12px">Карточка слушателя — Итоги</header>
          <div class="student-tabs" data-student-tabs style="position:relative;height:40px">
            <button type="button">Документы</button><button type="button">Финансы</button>
            <button type="button">Коммуникации</button><button type="button">Приказы, СДО</button>
          </div>
          <div class="student-tab-body" style="height:75px;overflow:auto">
            <label class="student-final-grade-field" data-tooltip="Шкала итоговой аттестации:&#10;КПК — зачтено.&#10;ППП удовлетворительно — от 50% до 69%; хорошо — от 70% до 89%; отлично — от 90% до 100%.">
              <span>Итоговая оценка</span><select id="grade"><option>Зачтено</option></select>
            </label><div style="height:200px"></div>
          </div>
        </form></section></body></html>`);
      await page.addStyleTag({ content: styles });
      await page.addScriptTag({ content: declarations.join("\n") + "\n" + source.slice(start, end) + "\nbindSystemHelpTooltips();" });
      const tooltip = page.locator("[data-system-help-tooltip]");
      const checkOverlay = async () => {
        await tooltip.waitFor({ state: "visible" });
        const result = await page.evaluate(() => {
          const tip = document.querySelector("[data-system-help-tooltip]");
          const rect = tip.getBoundingClientRect();
          const tabs = document.querySelector("[data-student-tabs]").getBoundingClientRect();
          const top = Math.max(rect.top, tabs.top), bottom = Math.min(rect.bottom, tabs.bottom);
          const left = Math.max(rect.left, tabs.left), right = Math.min(rect.right, tabs.right);
          tip.style.pointerEvents = "auto"; // Hit-test the painted order, not click-through behavior.
          const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          const onTop = tip.contains(hit);
          tip.style.removeProperty("pointer-events");
          return { bodyChild: tip.parentElement === document.body, onTop,
            overlapsTabs: bottom > top && right > left,
            fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
            pseudo: getComputedStyle(document.querySelector(".student-final-grade-field"), "::after").content,
            clickThrough: getComputedStyle(tip).pointerEvents === "none" };
        });
        assert.equal(result.bodyChild, true);
        assert.equal(result.overlapsTabs, true, "Fixture must reproduce overlap with the tab strip");
        assert.equal(result.onTop, true, "Note must paint above tabs, outside the clipped card body");
        assert.equal(result.fits, true, "Note stays inside the viewport");
        assert.equal(result.clickThrough, true);
        assert.ok(["none", "normal"].includes(result.pseudo), "Only one note is displayed");
        assert.match(await tooltip.textContent(), /ППП удовлетворительно/u);
      };
      await page.locator("#grade").hover();
      await checkOverlay();
      if (process.env.AIS_NOTE_SCREENSHOT) await page.screenshot({ path: process.env.AIS_NOTE_SCREENSHOT.replace(/\.png$/i, `-${viewport.width}.png`) });
      await page.mouse.move(1, 1);
      await tooltip.waitFor({ state: "hidden" });
      await page.locator("#grade").focus();
      await checkOverlay();
      assert.match(await page.locator(".student-final-grade-field").getAttribute("aria-describedby"), /system-help-tooltip/u);
      await page.locator(".student-tab-body").evaluate(node => { node.scrollTop = 20; });
      await tooltip.waitFor({ state: "hidden" });
      assert.equal(await page.locator(".student-final-grade-field").getAttribute("aria-describedby"), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("PASS: field note above tabs, unclipped desktop/mobile layout, single tooltip, hover/focus, accessibility and scroll cleanup");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
