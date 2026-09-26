"use strict";

// Exercise the real registry markup and stylesheet without accessing personal data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const extract = name => {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
};
const config = source.match(/^  const issuedDocumentTableConfig = Object.freeze\(\{[\s\S]*?^  }\);/m)[0];
const render = new Function("options", `
  const ISSUED_DOCUMENT_TABLE_CONFIG_ID = "issuedDocuments";
  const STUDENT_APPLICATIONS_IMPORT_TABLE_CONFIG_ID = "studentApplicationsImport";
  const FRDO_UPLOAD_RESERVE_DAYS = 5;
  const TABLE_PAGE_SIZE_OPTIONS = [25, 50, 100, 200], DEFAULT_TABLE_PAGE_SIZE = 50;
  const REGISTRY_COLUMN_WEIGHT_OVERRIDES = {}, configs = {};
  ${config}
  const state = {
    issuedDocumentViewInitialized: true,
    issuedDocumentFilters: { frdo: options.pending ? "pending" : "" },
    issuedDocumentSort: { key: "issueDate", dir: "desc" },
    mobileRegistryFiltersOpen: { issuedDocuments: options.filtersOpen },
    tablePages: {}, tableSettings: { issuedDocuments: options.customColumns ? {
      widths: { student: 640, program: 640, programType: 400 },
      order: ["programType", "documentNumber", "issueDate", "elapsedDays", "frdo", "program", "student"]
    } : {} }
  };
  const rows = Array.from({ length: 60 }, (_, i) => ({
    studentId: "test-" + i, studentName: "Тестовый Слушатель " + i, studentUid: 1000 + i,
    documentNumber: "ДОК-" + i, registrationNumber: String(i), issueDate: "2026-09-24",
    elapsedDays: 1, deadlineDays: 60, remainingDays: 59,
    frdoKey: "pending", frdoLabel: "Не выгружено",
    program: "Тестовая образовательная программа с длинным названием", programType: "ПК"
  }));
  const getIssuedDocumentRows = () => rows, getVisibleIssuedDocumentRows = rows => rows;
  const unique = list => [...new Set(list)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escapeAttr = escapeHtml, dateRu = () => "24.09.2026";
  const getTableValueFilterEntries = () => [], renderTableValueFilterChips = () => "";
  const tableValueFilterDataAttrs = () => "";
  ${[
    "renderIssuedDocumentsRegistry", "renderIssuedDocumentSortHeader", "renderIssuedDocumentTableCell",
    "issuedDocumentFiltersAreActive", "getIssuedDocumentActiveFilterCount", "getIssuedDocumentTableFilterDisplayValue",
    "issuedDocumentColumnStyleAttr", "getRegistryColumnPercentages", "getColumnWidth", "columnDataAttrs",
    "getTableKeys", "getTableFields", "getTablePageSize", "getTablePagination", "renderTablePagination", "renderTableOptions"
  ].map(extract).join("\n")}
  return renderIssuedDocumentsRegistry();
`);

async function geometry(page) {
  return page.locator(".issued-documents-table-wrap").evaluate(wrap => {
    const bounds = wrap.getBoundingClientRect();
    const last = wrap.querySelector("tbody tr:first-child td:last-child").getBoundingClientRect();
    const head = wrap.querySelector("thead th:last-child").getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth, body: document.documentElement.scrollWidth,
      left: bounds.left, right: bounds.right, width: wrap.clientWidth,
      scroll: wrap.scrollLeft, max: wrap.scrollWidth - wrap.clientWidth,
      lastLeft: last.left, lastRight: last.right, headRight: head.right,
      visibleRight: bounds.left + wrap.clientLeft + wrap.clientWidth
    };
  });
}

async function swipeToEnd(page, session) {
  await page.locator(".issued-documents-table-wrap").scrollIntoViewIfNeeded();
  const point = await page.locator(".issued-documents-table-wrap").evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { x: Math.min(innerWidth - 45, rect.right - 30), y: Math.max(60, rect.top + 100) };
  });
  // Touch the table body, not a resize handle. No programmatic scrollLeft fallback.
  for (let attempt = 0; attempt < 12; attempt++) {
    const before = await geometry(page);
    if (before.max - before.scroll <= 1) return;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove", touchPoints: [{ x: point.x - (point.x - 45) * step / 8, y: point.y }]
      });
      await page.waitForTimeout(16);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(150);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const mobile of [true, false]) {
      const context = await browser.newContext({ isMobile: mobile, hasTouch: mobile, viewport: { width: mobile ? 390 : 1366, height: 844 } });
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      const sizes = mobile ? [[320, 568], [390, 844], [720, 960], [844, 390]] : [[1366, 900]];
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        for (const filtersOpen of [false, true]) {
          for (const customColumns of [false, true]) {
            const label = `${width}x${height}, filters=${filtersOpen}, customColumns=${customColumns}`;
            await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style>
              <div class="app-shell"><aside class="sidebar"></aside><main class="main"><div class="content">${render({ filtersOpen, customColumns, pending: !customColumns })}</div></main></div>`);
            const start = await geometry(page);
            assert.ok(start.body <= start.viewport + 1, "Page must not overflow: " + label + " " + JSON.stringify(start));
            assert.ok(start.right <= start.viewport + 1, "Entire scrolling viewport must be on screen: " + label + " " + JSON.stringify(start));
            if (width <= 720) assert.ok(start.max > 0, "Mobile table should scroll horizontally: " + label);
            if (mobile && width <= 720) await swipeToEnd(page, session);
            else await page.locator(".issued-documents-table-wrap").evaluate(el => { el.scrollLeft = el.scrollWidth; });
            const end = await geometry(page);
            assert.ok(end.max - end.scroll <= 1, "Swipe reaches the end: " + label + " " + JSON.stringify(end));
            assert.ok(end.lastRight <= end.visibleRight + 1 && end.headRight <= end.visibleRight + 1,
              "Last column and heading are reachable: " + label + " " + JSON.stringify(end));
            assert.ok(end.lastLeft >= end.left - 1, "Last column fits: " + label);
            if (!mobile) assert.equal(end.max, 0, "Desktop table retains full-width layout");
            if (width === 390 && !filtersOpen && !customColumns && process.env.UI_SCREENSHOT) {
              await page.screenshot({ path: process.env.UI_SCREENSHOT });
            }
          }
        }
        console.log(`issued documents scrolling: ${width}x${height} OK`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
