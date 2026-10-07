"use strict";
// Synthetic per-tab browser storage only; no real users or application data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
}
const views = ["dashboard", "students", "contracts", "programs", "generalExpenses", "inventory", "documentConstructor", "documentWorkflow", "issuedDocuments", "recycleBin", "statistics", "advertising", "settings", "admin"];
function fixture(store = new Map(), user = { id: "a", role: "admin" }, pathname = "/lms/") {
  let writes = 0, denied = false;
  const c = vm.createContext({
    user, LAST_SECTION_SESSION_KEY: "last-section", APP_BASE_URL: { pathname },
    START_VIEW_KEY: "start-view", localStorage: { getItem: () => "programs" },
    navItems: views.map((id) => ({ id })),
    getCurrentAuthUser: () => c.user,
    isAdminUser: () => c.user.role === "admin",
    canAccessView: (id) => c.user.role === "admin" || !["admin", "settings"].includes(id),
    getAvailableStatisticsTabs: () => ["income", "expenses", "assistant", ...(c.user.role === "admin" ? ["sources"] : [])].map((id) => ({ id })),
    dictionaryDefaults: { paymentSettings: [], sdoSettings: [] },
    state: { view: "dashboard", adminTab: "database", adminDatabaseTab: "ais", statistics: { tab: "income" }, advertising: { tab: "collector" }, selectedDictionary: "", paymentSettingsTab: "rates", eventSettingsTab: "students", modal: { draft: { secret: "not-to-store" } }, search: "private search", data: { unchanged: true } },
    sessionStorage: {
      getItem(key) { if (denied) throw Error("Storage disabled"); return store.get(key) || null; },
      setItem(key, value) { if (denied) throw Error("Quota exceeded"); writes++; store.set(key, value); }
    },
    aisHistoryNavigationBound: true, aisHistoryNavigationRestoring: true,
    saveProgramRegistryFilters: () => {},
    captureAisNavigationSnapshot: () => assert.fail("History restoration must not push entries")
  });
  vm.runInContext(["loadStartView", "getLastAisSectionStorageKey", "normalizeLastAisSection", "loadLastAisSection", "restoreLastAisSection", "saveLastAisSection", "synchronizeAisBrowserHistory"].map(extract).join("\n"), c);
  return { c, store, get writes() { return writes; }, deny() { denied = true; } };
}
const first = fixture();
assert.equal(first.c.loadLastAisSection(), null);
assert.equal(first.c.loadStartView(), "programs", "New tabs retain configured start view");
for (const view of views) {
  first.c.state.view = view;
  first.c.synchronizeAisBrowserHistory();
  assert.equal(fixture(first.store).c.loadLastAisSection().view, view, view + " survives reload");
}
for (const [view, fields] of [
  ["admin", { adminTab: "external-services", adminDatabaseTab: "cloud" }],
  ["settings", { selectedDictionary: "paymentSettings", paymentSettingsTab: "agents", eventSettingsTab: "employees" }],
  ["statistics", { statistics: { tab: "sources" } }],
  ["advertising", { advertising: { tab: "sites" } }]
]) {
  Object.assign(first.c.state, { view }, fields); first.c.saveLastAisSection();
  const reload = fixture(first.store).c;
  const section = reload.loadLastAisSection();
  reload.state.view = section.view; reload.restoreLastAisSection(section);
  for (const key of Object.keys(fields)) assert.equal(JSON.stringify(reload.state[key]), JSON.stringify(fields[key]));
}
const text = first.store.get(first.c.getLastAisSectionStorageKey());
assert.ok(!text.includes("secret") && !text.includes("private search") && !text.includes("modal"));
assert.equal(JSON.stringify(first.c.state.data), '{"unchanged":true}');
const writes = first.writes; first.c.saveLastAisSection(); assert.equal(first.writes, writes);
assert.equal(fixture(first.store, { id: "b", role: "admin" }).c.loadLastAisSection(), null, "Account isolation");
assert.equal(fixture(new Map()).c.loadLastAisSection(), null, "New browser tab isolation");
assert.equal(fixture(first.store, { id: "a", role: "admin" }, "/other/").c.loadLastAisSection(), null, "Application path isolation");
assert.equal(fixture(first.store, {}).c.loadLastAisSection(), null, "No anonymous preferences");
const manager = fixture(first.store, { id: "a", role: "manager" }).c;
assert.equal(manager.loadLastAisSection().advertisingTab, "collector", "Restricted subtab cannot be restored");
for (const invalid of [null, [], {}, { version: 1, view: "unknown" }, { version: 2, view: "students" }, { version: 1, view: ["students"] }, { version: 1, view: "admin" }, { version: 1, view: "settings" }]) {
  assert.equal(manager.normalizeLastAisSection(invalid), null);
}
assert.equal(manager.normalizeLastAisSection({ version: 1, view: "statistics", statisticsTab: "sources" }).statisticsTab, "income");
first.store.set(first.c.getLastAisSectionStorageKey(), "broken-json");
assert.equal(first.c.loadLastAisSection(), null);
first.deny(); assert.doesNotThrow(() => first.c.saveLastAisSection()); assert.equal(first.c.loadLastAisSection(), null);
const boot = fixture(); boot.c.aisHistoryNavigationBound = false; boot.c.synchronizeAisBrowserHistory();
assert.equal(boot.writes, 0, "Startup renders must not overwrite the saved section");
assert.match(source, /const initialView = loadLastAisSection\(\)\?\.view \|\| loadStartView\(\)/u);
assert.match(extract("initializeApplication"), /await synchronizeInterfaceLayout\([\s\S]*?const rememberedSection = loadLastAisSection\(\);\s*state.view = rememberedSection\?\.view \|\| loadStartView\(\);\s*restoreLastAisSection\(rememberedSection\)/u);
console.log("Last section reload: all sections/subtabs, access checks, tab/user/path isolation, startup fallback, privacy, corrupt/unavailable storage: OK");
