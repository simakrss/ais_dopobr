"use strict";
// Isolated preview UI, synthetic PDFs and a fake editor; no app, storage or SMTP access.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
async function main() {
  const { PDFDocument, StandardFonts } = require("../vendor/pdf-lib.min.js");
  const pdfs = [];
  for (const text of ["ORIGINAL DOCUMENT", "EDITED DOCUMENT - KEEP THIS VERSION"]) {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595, 842]).drawText(text, { x: 35, y: 720, size: 18, font });
    pdfs.push(Buffer.from(await pdf.save()).toString("base64"));
  }
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><body>
    <button id="open">Открыть</button><p id="result"></p><script>
    const APP_BASE_URL = new URL("/", location.href);
    const escapeHtml = x => String(x).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    const escapeAttr = escapeHtml, normalizeDocumentGenerationFormat = x => x, normalizeServerEmailSubject = x => x.trim();
    const chooseUnsavedChangesAction = async () => "discard";
    const pdfs = ${JSON.stringify(pdfs)}.map(s => new Blob([Uint8Array.from(atob(s), x => x.charCodeAt(0))], {type:"application/pdf"}));
    const requestGeneratedDocumentEditor = async () => ({editorToken:"fixture", editorOrigin:location.origin, editorUrl:location.origin+"/editor"});
    const saveGeneratedDocumentEditor = async () => ({blob:pdfs[1], editRevision:1});
    const discardGeneratedDocumentEditor = async () => {};
    ${["showGeneratedDocumentPreview", "documentEmailMessageContainsHtml", "buildGeneratedDocumentEmailPreviewHtml", "showGeneratedDocumentEmailPreview"].map(extract).join("\n")}
    document.querySelector("#open").onclick = async () => {
      let blob = pdfs[0], email = {subject:"Тестовая тема", message:"Тестовое письмо", recipientDescription:"Получатель — recipient@example.test"}, editing = false;
      const options = {title:"Тестовый документ", fileName:"Тест.pdf", outputFormat:"pdf", previewToken:"fixture", processingOrigin:location.origin, onPreviewUpdated:next => {blob=next;}};
      while (await showGeneratedDocumentPreview(blob, options)) {
        const result = await showGeneratedDocumentEmailPreview(email, {...options, canReturnToDocument:true, editing});
        if (result?.backToDocument) {email=result.emailRequest; editing=result.editing; continue;}
        document.querySelector("#result").textContent = result?.skipEmail ? "Пропущено" : result ? "Подтверждено" : "Отменено";
        return;
      }
      document.querySelector("#result").textContent = "Отменено";
    };
    </script></body></html>`;
  const assets = ["styles.css", "pdf-preview.js", "pdfjs-core.js", "pdfjs-worker.js"];
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname.slice(1);
    if (!name || name === "editor") {
      res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
      return res.end(name ? '<script>parent.postMessage({source:"ais-generated-document-editor", editorSession:"fixture", type:"ready"},location.origin)</script>Тестовый редактор' : html);
    }
    if (!assets.includes(name)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {"Content-Type":name.endsWith("css") ? "text/css" : "text/javascript"});
    fs.createReadStream(path.join(root, name)).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  let browser;
  try {
    browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const action = name => page.locator(`[data-action="${name}"]`);
    const assertLayout = async () => {
      const boxes = await page.locator(".generated-document-email-actions button:visible").evaluateAll(buttons => buttons.map(button => {
        const {x, y, right, bottom, width, height} = button.getBoundingClientRect();
        return {x, y, right, bottom, width, height, fits:button.scrollWidth <= button.clientWidth + 1};
      }));
      const viewport = page.viewportSize();
      for (const box of boxes) {
        assert.ok(box.x >= 0 && box.right <= viewport.width + 1 && box.y >= 0 && box.bottom <= viewport.height + 1, JSON.stringify(box));
        assert.ok(box.fits, "Button label is clipped");
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        assert.ok(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, "Buttons overlap");
      }
    };
    for (const viewport of [{width:1366,height:900}, {width:768,height:768}, {width:390,height:844}, {width:320,height:568}]) {
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.click("#open");
      await page.waitForSelector('[data-generated-pdf-viewer][data-pdf-state="ready"]');
      await action("edit-generated-document-preview").click();
      await page.waitForSelector('[data-action="save-generated-document-editor"]:not([disabled])');
      await action("save-generated-document-editor").click();
      await page.waitForSelector('[data-generated-pdf-viewer][data-pdf-state="ready"]');
      const editedCanvas = await page.locator("[data-pdf-canvas]").evaluate(c => c.toDataURL());
      await action("confirm-generated-document-preview").click();
      await assertLayout();
      await action("edit-generated-document-email").click();
      await page.locator("[data-generated-document-email-subject-input]").fill("");
      await page.locator("[data-generated-document-email-message-input]").fill("  Правки письма\n");
      await assertLayout();
      await action("back-generated-document-email-preview").click();
      assert.equal(await page.locator("[data-generated-document-email-preview]").count(), 0);
      await page.waitForSelector('[data-generated-pdf-viewer][data-pdf-state="ready"]');
      assert.equal(await page.locator("[data-pdf-canvas]").evaluate(c => c.toDataURL()), editedCanvas);
      await action("confirm-generated-document-preview").click();
      assert.equal(await page.locator("[data-generated-document-email-subject-input]").inputValue(), "");
      assert.equal(await page.locator("[data-generated-document-email-message-input]").inputValue(), "  Правки письма\n");
      assert.ok(await page.locator("[data-generated-document-email-editor]").isVisible());
      await page.locator("[data-generated-document-email-subject-input]").fill("Исправленная тема");
      await action("apply-generated-document-email").click();
      await assertLayout();
      if (process.env.AIS_PREVIEW_SCREENSHOT && viewport.width === 390) await page.screenshot({path:process.env.AIS_PREVIEW_SCREENSHOT});
      await action("back-generated-document-email-preview").click();
      await action("confirm-generated-document-preview").click();
      assert.equal(await page.locator("[data-generated-document-email-subject]").textContent(), "Исправленная тема");
      await action("skip-generated-document-email-preview").click();
      assert.equal(await page.locator("#result").textContent(), "Пропущено");
      assert.equal(await page.locator(".modal-backdrop").count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log("PASS: desktop/mobile email back button, unclipped controls, actual edited PDF canvas retained, draft preserved and cleanup");
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
