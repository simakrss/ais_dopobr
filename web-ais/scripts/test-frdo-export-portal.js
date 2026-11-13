"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("  function prepareFrdoPortalAfterExport() {");
const end = source.indexOf("  function issuedDocumentFiltersAreActive(", start);
assert.ok(start >= 0 && end > start, "FRDO export handlers not found");
const portalUrl = "https://open-dpo.obrnadzor.gov.ru/";

function harness(options = {}) {
  const events = [], alerts = [], notices = [], classes = new Set();
  const state = { issuedDocumentExportRunning: Boolean(options.busy) };
  const button = {
    textContent: "Экспорт в ФРДО", disabled: false, isConnected: true,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    setAttribute() {}, removeAttribute() {}
  };
  const popup = {
    opener: {}, closed: false, document: { title: "", body: { textContent: "" } },
    close() { this.closed = true; events.push("close"); },
    location: { replace(url) {
      if (options.navigationError) throw new Error("navigation blocked");
      assert.equal(popup.opener, null, "The external portal must have no opener access");
      events.push(["navigate", url]);
    } }
  };
  const headers = { "X-Frdo-Saved": "true", ...options.headers };
  const context = vm.createContext({
    state, alert: message => alerts.push(message),
    window: { open(url, target) {
      assert.equal(url, "about:blank");
      assert.equal(target, "_blank");
      events.push("reserve");
      if (options.openError) throw new Error("popups disabled");
      return options.blocked ? null : popup;
    } },
    document: {
      querySelector: () => notices.find(notice => !notice.removed) || null,
      createElement: () => ({
        dataset: {}, innerHTML: "", setAttribute() {},
        querySelector() { return { addEventListener: (event, callback) => { this.close = callback; } }; },
        remove() { this.removed = true; }
      }),
      body: { appendChild: notice => notices.push(notice) }
    },
    buildIssuedDocumentFrdoExportRecords: () => options.empty ? [] : [{ studentId: "test-1" }],
    photoApiUrl: value => value,
    getFrdoExportFolder: () => "ФРДО",
    todayIso: () => "2026-10-12",
    getDownloadFileNameFromResponse: (_, fallback) => fallback,
    downloadBlob: (name, blob) => {
      if (options.downloadError) throw new Error("download failed");
      events.push(["download", name, blob]);
    },
    openStudentWebDavDocumentsManager: async (...args) => {
      events.push(["folder", ...args]);
      if (options.folderError) throw new Error("folder unavailable");
    },
    fetch: async (url, config) => {
      events.push("fetch");
      assert.equal(url, "/api/issued-documents/frdo-export");
      assert.equal(config.method, "POST");
      assert.deepEqual(JSON.parse(config.body), { records: [{ studentId: "test-1" }], frdoExportFolder: "ФРДО" });
      if (options.wait) await options.wait;
      if (options.fetchError) throw new Error("offline");
      if (options.closed) popup.closed = true;
      return {
        ok: !options.serverError,
        headers: { get: key => headers[key] || null },
        json: async () => ({ error: "export failed" }),
        blob: async () => {
          if (options.blobError) throw new Error("incomplete response");
          events.push("export ready");
          return "export bytes";
        }
      };
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return { run: () => context.exportIssuedDocumentsToFrdo(button), state, button, events, alerts, notices, popup, classes };
}

function checkIdle(test) {
  assert.equal(test.state.issuedDocumentExportRunning, false);
  assert.equal(test.button.disabled, false);
  assert.equal(test.button.textContent, "Экспорт в ФРДО");
  assert.equal(test.classes.size, 0);
}

(async () => {
  for (const options of [
    {},
    { headers: { "X-Frdo-Saved": "false" } },
    { headers: { "X-Frdo-Storage": "webdav", "X-Frdo-Relative-Folder": encodeURIComponent("ФРДО/2026") } },
    { headers: { "X-Frdo-Warning": encodeURIComponent("Папка не открыта") } },
    { headers: { "X-Frdo-Storage": "webdav" }, folderError: true }
  ]) {
    const test = harness(options);
    await test.run();
    assert.deepEqual(test.events.slice(0, 3), ["reserve", "fetch", "export ready"]);
    const navigations = test.events.filter(event => Array.isArray(event) && event[0] === "navigate");
    assert.deepEqual(navigations, [["navigate", portalUrl]]);
    assert.equal(test.popup.closed, false);
    assert.equal(test.notices.length, 0);
    if (options.headers?.["X-Frdo-Saved"] === "false") {
      assert.deepEqual(test.events[3], ["download", "ВыгрузкаДПО_2026.10.12.xls", "export bytes"]);
    }
    if (options.folderError) assert.match(test.alerts[0], /Файл выгрузки ФРДО сохранён/);
    checkIdle(test);
  }

  for (const options of [{ serverError: true }, { fetchError: true }, { blobError: true },
    { downloadError: true, headers: { "X-Frdo-Saved": "false" } }]) {
    const test = harness(options);
    await test.run();
    assert.equal(test.popup.closed, true, "A failed export must close its placeholder tab");
    assert.equal(test.events.some(event => Array.isArray(event) && event[0] === "navigate"), false);
    assert.equal(test.notices.length, 0);
    assert.equal(test.alerts.length, 1);
    checkIdle(test);
  }

  for (const options of [{ blocked: true }, { closed: true }, { openError: true }, { navigationError: true }]) {
    const test = harness(options);
    await test.run();
    assert.equal(test.alerts.length, 0, "Popup failure is not export failure");
    assert.equal(test.notices.length, 1);
    assert.ok(test.notices[0].innerHTML.includes(`href="${portalUrl}"`));
    assert.match(test.notices[0].innerHTML, /target="_blank" rel="noopener noreferrer"/);
    test.notices[0].close();
    assert.equal(test.notices[0].removed, true);
    checkIdle(test);
  }

  for (const options of [{ empty: true }, { busy: true }]) {
    const test = harness(options);
    await test.run();
    assert.deepEqual(test.events, [], "No tab or request without exportable records, or during another export");
  }

  let release;
  const test = harness({ wait: new Promise(resolve => { release = resolve; }) });
  const pending = test.run();
  await test.run();
  assert.deepEqual(test.events, ["reserve", "fetch"], "Double click must not open a second tab");
  assert.equal(test.button.disabled, true);
  release();
  await pending;
  checkIdle(test);
  console.log("FRDO export portal tests: OK (local/cloud/download, errors, popups, empty/busy/double click)");
})().catch(error => { console.error(error); process.exitCode = 1; });
