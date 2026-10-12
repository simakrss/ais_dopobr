"use strict";
// Synthetic documents, isolated temp storage and browser fixtures only; no live data or mail.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/g, "\n");
const extract = name => {
  const match = app.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
};

async function serverChecks() {
  process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";
  process.env.AIS_DISABLE_PREVIEW_CLEANUP_WORKER = "1";
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "ais-countdown-test-"));
  process.env.AIS_GENERATED_DOCUMENT_PREVIEW_STORAGE_ROOT = storage;
  const api = require("../app-server");
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const owner = { id: "countdown-test", authSessionKey: "gateway:countdown-test" };
  const docx = fs.readFileSync(path.join(root, "storage/document-templates/employee-contract-general-no-stamp.docx"));
  const generated = () => ({ bytes: Buffer.from(docx), editableBytes: Buffer.from(docx), outputFormat: "docx", fileName: "test.docx", extraHeaders: {} });
  try {
    for (const mode of ["0", "1"]) {
      process.env.AIS_TRUST_GATEWAY = mode;
      const token = await api.registerGeneratedDocumentPreview(generated(), owner);
      const timing = await api.getGeneratedDocumentPreviewTiming(token);
      assert.equal(timing.previewServerTime, now);
      assert.equal(timing.previewExpiresAt, now + 600000);
      now += 123000;
      assert.equal((await api.getGeneratedDocumentPreviewTiming(token)).previewExpiresAt, timing.previewExpiresAt, "Reading timing never extends storage");
      const headers = await api.getGeneratedDocumentPreviewTimingHeaders(token);
      assert.equal(Number(headers["X-Document-Preview-Expires-At"]), timing.previewExpiresAt);
      assert.equal(Number(headers["X-Document-Preview-Server-Time"]), now);
      const session = await api.beginGeneratedDocumentPreviewEditor(token, owner);
      assert.ok((await api.getGeneratedDocumentPreviewTiming(token)).previewExpiresAt > timing.previewExpiresAt);
      now += 600000;
      const refreshed = await api.refreshGeneratedDocumentPreviewEditor(token, session.editorToken, owner);
      assert.equal((await api.getGeneratedDocumentPreviewTiming(token)).previewExpiresAt, refreshed.recoveryExpiresAt);
      await api.discardGeneratedDocumentPreviewEditor(token, session.editorToken, owner);
      assert.equal((await api.getGeneratedDocumentPreviewTiming(token)).previewExpiresAt, now + 600000, "Discard renews normal preview TTL");
      const second = await api.beginGeneratedDocumentPreviewEditor(token, owner);
      now += 60000;
      await api.completeGeneratedDocumentPreviewEditor(token, second.editorToken, second.editRevision);
      const saved = await api.getGeneratedDocumentPreviewTiming(token);
      assert.equal(saved.previewExpiresAt, now + 600000, "Save renews normal preview TTL");
      now = saved.previewExpiresAt;
      assert.equal(await api.takeGeneratedDocumentPreview(token, owner), null, "UI deadline equals actual server expiry");
      await assert.rejects(api.getGeneratedDocumentPreviewTiming(token), error => error.statusCode === 404, "No storage paths in missing-preview errors");
    }
    await assert.rejects(api.getGeneratedDocumentPreviewTiming("invalid"), error => error.statusCode === 404);
  } finally {
    Date.now = realNow;
    assert.equal(path.dirname(storage), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(storage).startsWith("ais-countdown-test-"));
    fs.rmSync(storage, { recursive: true, force: true });
  }
  console.log("PASS: real server expiry, memory/file stores, timing headers, editor refresh/save/discard and expiry rejection");
}

async function requestChecks() {
  let now = 1000000;
  const source = ["readGeneratedDocumentPreviewLifetime", "requestGeneratedDocumentPreview", "applyGeneratedDocumentEditorSessionDetails"].map(extract).join("\n");
  const c = vm.createContext({
    Date: { now: () => now }, URL,
    getDocumentGenerationRequestOptions: () => ({}),
    documentProcessingApiUrl: value => value,
    getGeneratedDocumentResponseDetails: () => ({}),
    fetchWithTimeout: async (_url, _request, _timeout, _message, parse) => parse({
      ok: true,
      headers: new Map([["Content-Type", "application/pdf"], ["X-Document-Preview-Token", "fixture"],
        ["X-Document-Preview-Expires-At", "9600000"], ["X-Document-Preview-Server-Time", "9000000"]]),
      blob: async () => { now += 5000; return "PDF"; }
    })
  });
  vm.runInContext(source, c);
  const preview = await c.requestGeneratedDocumentPreview({}, "local");
  assert.equal(preview.previewLifetime.deadlineAt, 1600000, "Clock offset is removed and body download consumes time");
  const lifetime = preview.previewLifetime;
  assert.equal(c.readGeneratedDocumentPreviewLifetime({}, lifetime), lifetime, "Missing headers do not reset timer");
  const session = { editorToken: "fixture", editorUrl: "https://example.test/editor", editorOrigin: "https://example.test", previewLifetime: lifetime };
  c.applyGeneratedDocumentEditorSessionDetails(session, { previewExpiresAt: 10200000, previewServerTime: 9000000 });
  assert.equal(session.previewLifetime, lifetime, "Refresh preserves shared state used by both windows");
  assert.equal(lifetime.deadlineAt, now + 1200000);
  console.log("PASS: client clock skew, elapsed download time, legacy responses and shared editor deadline");
}

async function browserChecks() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const script = ["readGeneratedDocumentPreviewLifetime", "bindGeneratedDocumentPreviewCountdown", "showGeneratedDocumentPreview", "documentEmailMessageContainsHtml", "buildGeneratedDocumentEmailPreviewHtml", "showGeneratedDocumentEmailPreview"].map(extract).join("\n");
    await page.setContent('<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body></body></html>');
    await page.addStyleTag({ path: path.join(root, "styles.css") });
    await page.addScriptTag({ content: `
      const escapeHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
      const escapeAttr = escapeHtml, normalizeDocumentGenerationFormat = value => value, normalizeServerEmailSubject = value => value.trim();
      const chooseUnsavedChangesAction = async () => "discard";
      window.alerts = []; window.alert = text => alerts.push(text);
      window.clockNow = 1000000; Date.now = () => clockNow;
      window.advance = milliseconds => { clockNow += milliseconds; document.dispatchEvent(new Event("visibilitychange")); };
      window.intervals = new Set();
      const realSetInterval = window.setInterval, realClearInterval = window.clearInterval;
      window.setInterval = (...args) => { const id = realSetInterval(...args); intervals.add(id); return id; };
      window.clearInterval = id => { intervals.delete(id); realClearInterval(id); };
      ${script}
      window.openDocument = (unknown = false, readOnly = false) => {
        window.lifetime = unknown ? {} : readGeneratedDocumentPreviewLifetime({previewExpiresAt:9600000,previewServerTime:9000000});
        window.abort = new AbortController();
        window.result = undefined;
        const options = { title:"Договор", fileName:"Договор.docx", previewAvailable:false, outputFormat:"docx", editorAvailable:false, previewLifetime:lifetime, signal:abort.signal, readOnly };
        (async () => {
          while (await showGeneratedDocumentPreview(new Blob(["synthetic document"]), options)) {
            const result = await showGeneratedDocumentEmailPreview({subject:"Документ для проверки",message:"Тестовое письмо",recipientDescription:"recipient@example.test"}, {...options, canReturnToDocument:true});
            if (result?.backToDocument) continue;
            window.result = result?.skipEmail ? "skip" : result ? "sent" : "cancelled";
            return;
          }
          window.result = "cancelled";
        })();
      };
    ` });
    const action = name => page.locator(`[data-action="${name}"]`).last();
    const label = page.locator("[data-preview-countdown-label]");
    const host = page.locator("[data-preview-countdown]");
    const assertLabel = async text => assert.match(await label.textContent(), text);
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => openDocument());
      await assertLabel(/10:00/);
      await page.evaluate(() => advance(60000));
      await assertLabel(/09:00/);
      await action("confirm-generated-document-preview").click();
      await assertLabel(/09:00/);
      await page.evaluate(() => advance(60000));
      await action("back-generated-document-email-preview").click();
      await assertLabel(/08:00/);
      await page.evaluate(() => advance(360000));
      await assertLabel(/02:00/);
      assert.ok(await host.evaluate(el => el.classList.contains("is-warning")));
      const box = await host.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height < viewport.height);
      assert.ok(await host.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "Timer fits mobile header");
      await action("confirm-generated-document-preview").click();
      await page.evaluate(() => advance(120000));
      await assertLabel(/истекло/);
      assert.equal(await page.locator("[data-preview-countdown-progress]").evaluate(el => el.value), 0);
      for (const button of ["confirm-generated-document-email-preview", "skip-generated-document-email-preview"]) {
        await action(button).click();
        assert.equal(await page.evaluate(() => result), undefined, "Expired preview cannot be finalized");
      }
      await action("back-generated-document-email-preview").click();
      await assertLabel(/истекло/);
      await action("confirm-generated-document-preview").click();
      assert.equal(await page.evaluate(() => result), undefined);
      await action("cancel-generated-document-preview").click();
      assert.equal(await page.evaluate(() => result), "cancelled");
      assert.equal(await page.evaluate(() => intervals.size), 0, "Closing must dispose all timer intervals");
    }
    for (const options of [[true, false], [false, true]]) {
      await page.evaluate(args => openDocument(...args), options);
      assert.equal(await host.isVisible(), false, "No invented deadline for old server or read-only preview");
      await page.evaluate(() => abort.abort());
      assert.equal(await page.evaluate(() => intervals.size), 0);
    }
    await page.evaluate(() => openDocument());
    await action("confirm-generated-document-preview").click();
    await action("skip-generated-document-email-preview").click();
    assert.equal(await page.evaluate(() => result), "skip");
    assert.equal(await page.evaluate(() => intervals.size), 0);
    // An editor response updates the same object, no re-binding or client-made TTL.
    await page.evaluate(() => openDocument());
    await page.evaluate(() => {
      advance(600000);
      readGeneratedDocumentPreviewLifetime({previewExpiresAt:16200000,previewServerTime:9000000}, lifetime);
      window.dispatchEvent(new Event("focus"));
    });
    await assertLabel(/2:00:00/);
    await page.evaluate(() => {
      readGeneratedDocumentPreviewLifetime({previewExpiresAt:9600000,previewServerTime:9000000}, lifetime);
      window.dispatchEvent(new Event("focus"));
    });
    await assertLabel(/10:00/);
    assert.equal(await host.evaluate(el => el.classList.contains("is-expired")), false);
    await page.evaluate(() => abort.abort());
    assert.equal(await page.evaluate(() => intervals.size), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: real dialogs, countdown/warning/expiry, mobile layout, document-mail-back, confirmation guards, editor updates, legacy/read-only, cancel/abort cleanup");
  } finally { await browser.close(); }
}

(async () => { await serverChecks(); await requestChecks(); await browserChecks(); })().catch(error => { console.error(error); process.exitCode = 1; });
