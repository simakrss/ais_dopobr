"use strict";
// No user documents, production requests, email or native windows in these tests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const server = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
const extract = (source, name, indent = "") => {
  const found = source.match(new RegExp(`^${indent}(?:async )?function ${name}\\([\\s\\S]*?^${indent}}`, "m"));
  assert.ok(found, name); return found[0];
};
const tick = () => new Promise(resolve => setImmediate(resolve));

async function routing() {
  let tunnelReads = 0;
  const ctx = vm.createContext({ URL, PORT: 19081,
    requestHasConfiguredGatewaySecret: req => req.trusted === true,
    readTunnelRuntimeAdminSummary: async () => { tunnelReads++; return { configured: true, baseUrl: "https://tunnel.example.test" }; }
  });
  vm.runInContext(["requestPublicOrigin", "isLoopbackEditorHostname", "resolveGeneratedDocumentEditorBrowserBaseUrl"]
    .map(name => extract(server, name)).join("\n"), ctx);
  const req = { trusted: true, headers: { host: "127.0.0.1:8081", origin: "https://edu-plus.ru",
    "x-forwarded-proto": "https", "x-ais-session-id": "local-browser-services" } };
  assert.equal(await ctx.resolveGeneratedDocumentEditorBrowserBaseUrl(req), "http://127.0.0.1:19081");
  assert.equal(tunnelReads, 0, "Direct loopback must not depend on a stale tunnel");
  assert.equal(await ctx.resolveGeneratedDocumentEditorBrowserBaseUrl({ ...req, trusted: false }), "https://tunnel.example.test");
  assert.equal(await ctx.resolveGeneratedDocumentEditorBrowserBaseUrl({ ...req, headers: { ...req.headers, "x-ais-session-id": "real-cloud-session" } }), "https://tunnel.example.test");
}

function element() {
  return { disabled: false, hidden: false, dataset: {}, style: {}, textContent: "", listeners: {}, attrs: new Set(),
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(name, fn) { this.listeners[name] = fn; }, removeEventListener() {},
    setAttribute(name) { this.attrs.add(name); }, removeAttribute(name) { this.attrs.delete(name); },
    hasAttribute(name) { return this.attrs.has(name); }, focus() {}, remove() {}, getClientRects: () => [1] };
}

function previewFixture({ blocked = false, protocol = "https:" } = {}) {
  const nodes = new Map(), events = {}, calls = [], popups = [];
  const node = selector => {
    if (selector === "[data-generated-pdf-viewer]") return null; // PDF rendering has separate tests.
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const backdrop = { ...element(), querySelector: node };
  const session = { editorUrl: "http://127.0.0.1:19081/api/contracts/student-document-preview/editor-page?editorToken=test",
    editorOrigin: "http://127.0.0.1:19081", editorToken: "test", editRevision: 0 };
  const window = { location: { protocol, origin: "https://edu-plus.ru" },
    addEventListener(name, fn) { events[name] = fn; }, removeEventListener(name) { delete events[name]; },
    open() {
      calls.push("open"); if (blocked) return null;
      const popup = { closed: false, location: { replace(url) { popup.url = url; } }, focus() {},
        close() { this.closed = true; }, postMessage(message, origin) { calls.push({ message, origin }); } };
      popups.push(popup); return popup;
    }
  };
  const ctx = vm.createContext({ window, URL, Blob, HTMLElement: class {},
    document: { activeElement: null, querySelector: () => null, createElement: () => backdrop, body: { appendChild() {} } },
    normalizeDocumentGenerationFormat: () => "pdf", escapeHtml: String, escapeAttr: String,
    bindGeneratedDocumentPreviewCountdown: () => ({ check: () => true, dispose() {} }),
    requestAnimationFrame: fn => fn(), alert: message => calls.push({ alert: message }),
    requestGeneratedDocumentEditor: async () => { calls.push("start"); return { ...session }; },
    discardGeneratedDocumentEditor: async () => { calls.push("discard"); return {}; },
    saveGeneratedDocumentEditor: async () => { calls.push("save"); return { blob: new Blob(["edited-pdf"]), editRevision: 1 }; },
    refreshGeneratedDocumentEditor: async () => { calls.push("refresh"); return {}; },
    readGeneratedDocumentPreviewLifetime() {}, chooseUnsavedChangesAction: async () => "discard"
  });
  vm.runInContext(extract(app, "showGeneratedDocumentPreview", "  "), ctx);
  const result = ctx.showGeneratedDocumentPreview(new Blob(["pdf"]), { previewToken: "preview-test", processingOrigin: "http://127.0.0.1:8081" });
  const button = action => node(`[data-action='${action}']`);
  const message = (type, overrides = {}) => events.message({ source: popups.at(-1), origin: session.editorOrigin,
    data: { source: "ais-generated-document-editor", editorSession: session.editorToken, type }, ...overrides });
  return { ctx, backdrop, result, button, node, calls, popups, message };
}

async function previewLifecycle() {
  const f = previewFixture();
  await f.button("edit-generated-document-preview").listeners.click();
  assert.deepEqual(f.calls.slice(0, 2), ["open", "start"], "Open in the click gesture before awaiting the server");
  assert.match(f.popups[0].url, /parentOrigin=https%3A%2F%2Fedu-plus\.ru/u);
  assert.equal(f.node("[data-generated-document-preview-frame]").src, "about:blank");
  f.message("ready", { source: {} });
  assert.equal(f.button("save-generated-document-editor").disabled, true, "Reject unrelated windows");
  f.message("ready", { origin: "https://untrusted.example.test" });
  assert.equal(f.button("save-generated-document-editor").disabled, true, "Reject unrelated origins");
  f.message("ready");
  assert.equal(f.button("save-generated-document-editor").disabled, false);
  f.message("save-request"); await tick();
  assert.ok(f.calls.includes("save"));
  assert.equal(f.popups[0].closed, true, "Close local editor after the replacement PDF is ready");
  assert.equal(f.button("confirm-generated-document-preview").disabled, false);
  f.button("confirm-generated-document-preview").listeners.click();
  assert.equal(await f.result, true);

  const denied = previewFixture({ blocked: true });
  await denied.button("edit-generated-document-preview").listeners.click();
  assert.ok(!denied.calls.includes("start"), "Blocked popup must not start an orphan editor session");
  assert.ok(denied.calls.some(call => call.alert));
  denied.backdrop.forceCloseGeneratedDocumentPreview(false); await denied.result;

  const local = previewFixture({ protocol: "http:" });
  await local.button("edit-generated-document-preview").listeners.click();
  assert.equal(local.popups.length, 0, "Local app retains the embedded editor");
  assert.match(local.node("[data-generated-document-preview-frame]").src, /editor-page/u);
  local.backdrop.forceCloseGeneratedDocumentPreview(false); await local.result;

  const cancelled = previewFixture();
  await cancelled.button("edit-generated-document-preview").listeners.click();
  cancelled.message("cancel-request"); await tick();
  assert.ok(cancelled.calls.includes("discard"));
  assert.equal(cancelled.popups[0].closed, true);
  cancelled.backdrop.forceCloseGeneratedDocumentPreview(false); await cancelled.result;
}

async function editorPage() {
  let html = "";
  const ctx = vm.createContext({ URL, Buffer, GENERATED_DOCUMENT_EDITOR_HEARTBEAT_MS: 30000,
    assertGeneratedDocumentEditorBackendAvailable() {}, refreshGeneratedDocumentPreviewEditor: async () => {},
    readGeneratedDocumentPreviewEditorContext: async () => ({ metadata: { editorSession: { expiresAt: 1 } } }),
    getOnlyOfficeConverterSettings: async () => ({}), generatedDocumentEditorConfig: () => ({}),
    signGeneratedDocumentEditorProxyCookie: () => "test-cookie", generatedDocumentEditorProxyCookieHeader: () => "test-cookie",
    sendError: (_, status, message) => { throw new Error(`${status}: ${message}`); }
  });
  vm.runInContext(extract(server, "handleGeneratedDocumentPreviewEditorPage"), ctx);
  await ctx.handleGeneratedDocumentPreviewEditorPage({ headers: {} }, { writeHead() {}, end(value) { html = value; } },
    new URL("http://127.0.0.1:19081/editor-page?previewToken=test&editorToken=test&parentOrigin=https://edu-plus.ru"));
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)][0][1];
  const nodes = new Map(["save", "cancel", "status"].map(id => [id, element()])), messages = [], events = {};
  const opener = { postMessage(message, origin) { messages.push({ message, origin }); }, focus() {} };
  let editorConfig;
  const DocsAPI = { DocEditor: function (_, config) { editorConfig = config; } };
  vm.runInNewContext(script, { window: { opener, DocsAPI, setInterval() {}, clearInterval() {},
    addEventListener(name, fn) { events[name] = fn; } }, parent: {}, DocsAPI,
    document: { getElementById: id => nodes.get(id), body: element(), addEventListener() {} } });
  editorConfig.events.onDocumentReady();
  assert.equal(nodes.get("save").disabled, false);
  nodes.get("save").onclick();
  assert.equal(messages.at(-1).message.type, "save-request");
  assert.equal(messages.at(-1).origin, "https://edu-plus.ru");
  const busy = { source: opener, origin: "https://edu-plus.ru", data: { source: "ais-generated-document-preview", editorSession: "test", busy: true } };
  events.message({ ...busy, source: {} }); assert.equal(nodes.get("save").disabled, false);
  events.message(busy); assert.equal(nodes.get("save").disabled, true);
  events.message({ ...busy, data: { ...busy.data, busy: false } }); assert.equal(nodes.get("save").disabled, false);
  editorConfig.events.onDocumentStateChange({ data: true }); assert.equal(nodes.get("save").disabled, true);
}

async function main() {
  await routing(); await previewLifecycle(); await editorPage();
  assert.equal((app.match(/storageRequest: \(\) => getEmployeeDocumentStorageRequest/g) || []).length, 2);
  assert.match(app, /typeof options\.storageRequest === "function"\s*\? await options\.storageRequest\(\)/u);
  assert.match(app, /storageRequest: \(\) => getStudentBulkDocumentStorageRequest/u);
  console.log("Cloud/local document editor: routing, popup lifecycle, origin/source isolation, save/discard, deferred storage OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
