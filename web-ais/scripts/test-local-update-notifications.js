"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../local-update-client.js"), "utf8");
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.events = {}; this.attrs = {}; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  appendChild(child) { this.append(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, callback) { this.events[name] = callback; }
  querySelector() { return this.all().find(element => Object.hasOwn(element.dataset, "closeLocalUpdate")); }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() { if (!this.disabled) return this.events.click?.(); }
}
async function main() {
  const body = new Element("body"), events = {}, requests = [];
  let state = { protocol: 1, phase: "error", errorId: "failure-1", canRetry: true,
    label: "EPERM: operation not permitted, rename Y:/private/status.tmp -> Y:/private/status.json", retryAt: Date.now() + 60000 };
  let poll, busy = false, reloads = 0;
  const context = vm.createContext({
    URL, crypto: require("node:crypto"), AbortSignal, Blob, Date,
    CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options.detail; } },
    location: { hostname: "127.0.0.1", reload: () => reloads++ },
    document: { baseURI: "http://127.0.0.1:18881/", currentScript: { src: "http://127.0.0.1:18881/local-update-client.js?v=fixture-old" },
      body, createElement: tag => new Element(tag), querySelector: () => busy ? {} : null,
      addEventListener: (name, handler) => { events[name] = handler; } },
    window: { dispatchEvent(event) { event.detail.busy = busy; }, addEventListener() {} },
    navigator: { sendBeacon() {} },
    setInterval: handler => { poll = handler; },
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body); requests.push(request);
      return { ok: true, status: 200, json: async () => ({ ...state,
        ...(request.retryUpdate ? { retryAccepted: true } : {}), ...(request.updateNow ? { updateNowAccepted: true } : {}) }) };
    }
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  const find = predicate => body.all().find(predicate);
  const button = text => find(element => element.tag === "button" && element.textContent === text);
  const panel = () => find(element => Object.hasOwn(element.dataset, "localUpdate"));
  assert.ok(button("!")); assert.equal(panel(), undefined, "An error must initially show only a warning icon");
  button("!").click();
  assert.equal(panel().tag, "aside");
  assert.ok(find(element => element.attrs.role === "status").textContent.includes("временно занят"));
  assert.ok(!find(element => element.attrs.role === "status").textContent.includes("Y:/private"));
  assert.equal(find(element => element.tag === "details").hidden, false);
  const closeButton=button("×");
  assert.equal(closeButton.attrs["aria-label"], "Закрыть сообщение об обновлении");
  assert.equal(panel().children[0], closeButton.parent, "Close belongs in the top header");
  assert.equal(closeButton.parent.children.at(-1), closeButton, "Close follows title on the right");
  assert.match(closeButton.parent.style.cssText, /justify-content:space-between/);
  assert.equal(button("Закрыть"), undefined);
  closeButton.click(); await poll();
  assert.equal(panel(), undefined, "Polling must not reopen a dismissed error");
  button("!").click();
  let prevented = false, stopped = false;
  events.keydown({ key: "Escape", preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  assert.ok(prevented && stopped); assert.equal(panel(), undefined);
  button("!").click(); busy = true;
  await button("Применить").click();
  assert.equal(requests.some(request => request.retryUpdate), false, "Do not retry from an unsaved card");
  assert.match(find(element => element.attrs.role === "alert").textContent, /Сначала сохраните/);
  busy = false; await button("Применить").click();
  assert.equal(requests.filter(request => request.retryUpdate).length, 1);
  assert.equal(requests.find(request => request.retryUpdate).errorId, "failure-1");
  await button("Запрос принят…").click();
  assert.equal(requests.filter(request => request.retryUpdate).length, 1);
  await new Promise(resolve => setImmediate(resolve));
  state = { ...state, phase: "warning", canUpdateNow: true, targetVersion: "1.0.1", warningId: "countdown-1", seconds: 30, label: "Предупреждение" };
  await poll(); assert.ok(button("Обновить сейчас"));
  button("×").click(); await poll(); assert.equal(panel(), undefined, "The same countdown must stay dismissed");
  state.phase = "waiting"; await poll(); assert.equal(panel(), undefined);
  state.phase = "warning"; state.warningId = "countdown-2"; await poll();
  assert.equal(panel(), undefined, "A restarted countdown for the same version stays dismissed");
  button("!").click(); assert.ok(button("Обновить сейчас"));
  button("×").click(); state.targetVersion = "1.0.2"; state.warningId = "countdown-3"; await poll(); assert.ok(button("Обновить сейчас"));
  await button("Обновить сейчас").click();
  assert.equal(requests.filter(request => request.updateNow).length, 1);
  await new Promise(resolve => setImmediate(resolve));
  for (const phase of ["draining", "installing", "restarting", "rollback", "recovery-error"]) {
    state = { ...state, phase, label: "Выполняется обновление", canRetry: false };
    await poll();
    assert.equal(panel().tag, "dialog"); assert.equal(panel().open, true);
    assert.equal(button("!"), undefined); assert.equal(button("×"), undefined);
    prevented = false; panel().events.cancel({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
    assert.ok(!find(element => element.tag === "button" && !element.hidden), "Do not offer retry/close during installation or recovery");
  }
  state = { protocol: 1, phase: "error", label: "EPERM: old service status" }; await poll();
  assert.equal(panel(), undefined); button("!").click();
  await button("Применить").click();
  assert.match(find(element => element.attrs.role === "alert").textContent, /перезапустите/);
  assert.equal(requests.filter(request => request.retryUpdate).length, 1, "Do not pretend an old backend accepted retry");
  state = { protocol: 1, phase: "idle", build: "fixture-old" }; await poll();
  assert.equal(panel(), undefined); assert.equal(button("!"), undefined);
  busy = true; state.build = "fixture-new"; await poll(); assert.equal(reloads, 0); assert.ok(button("!"));
  busy = false; await poll(); assert.equal(reloads, 1);
  console.log("Update notifications: badge, friendly details, dismissal, retry/readiness, countdown, blocking recovery and reload safety: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
