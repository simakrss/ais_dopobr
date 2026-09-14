"use strict";
// Pure browser-state fixtures: no real accounts, records or local storage touched.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const block = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
};
const store = new Map();
let reads = 0, writes = 0, unavailable = false;
const storage = {
  getItem(key) {reads++; if (unavailable) throw Error("Storage disabled"); return store.get(key) || null;},
  setItem(key, value) {writes++; if (unavailable) throw Error("Quota exceeded"); store.set(key, value);}
};
function setup(userId = "user-a") {
  const context = {
    PROGRAM_REGISTRY_FILTERS_KEY: "ais-dopobr-program-registry-filters-v1", programRegistryFilterPreferences: new Map(),
    user: {id: userId}, demo: false, localStorage: storage,
    configs: {programs: {table: ["name", "status", "type", "price"], fields: [{key: "hours"}]}},
    state: {view: "programs", search: "", statusFilter: "Все", programRegistryTypeFilter: [], tableValueFilters: {students: {status: {value: "учится", label: "Учится"}}}, tablePages: {}, data: {unchanged: true}},
    getCurrentAuthUser: () => context.user, isDatabaseDemoMode: () => context.demo,
    getFilterOptions: () => ["Активна", "Архив", "Не задано"]
  };
  vm.createContext(context);
  vm.runInContext(block("  function getProgramRegistryFiltersStorageKey(", "  function getDefaultStatusFilter("), context);
  return context;
}
const test = setup();
test.restoreProgramRegistryFilters();
assert.equal(test.state.statusFilter, "Все");
Object.assign(test.state, {search: "Цифровая грамотность", statusFilter: "Активна", programRegistryTypeFilter: ["КПК", "ДОП"]});
test.state.tableValueFilters.programs = {hours: {value: "72", label: "72"}};
test.saveProgramRegistryFilters();
const saved = store.get(test.getProgramRegistryFiltersStorageKey());
const savedWrites = writes;
test.saveProgramRegistryFilters();
assert.equal(writes, savedWrites, "Unchanged renders do not rewrite storage");
test.state.view = "students"; test.state.search = "Другой поиск"; test.state.statusFilter = "Учится";
test.saveProgramRegistryFilters(); test.restoreProgramRegistryFilters();
assert.equal(test.state.search, "Другой поиск", "Other registry untouched");
assert.equal(store.get(test.getProgramRegistryFiltersStorageKey()), saved, "Other registry cannot overwrite program filters");
test.state.view = "programs"; test.state.search = ""; test.state.statusFilter = "Все"; test.state.programRegistryTypeFilter = [];
test.restoreProgramRegistryFilters();
assert.equal(test.state.search, "Цифровая грамотность"); assert.equal(test.state.statusFilter, "Активна");
assert.equal(JSON.stringify(test.state.programRegistryTypeFilter), '["КПК","ДОП"]');
assert.equal(test.state.tableValueFilters.programs.hours.value, "72");
assert.equal(test.state.tableValueFilters.students.status.value, "учится");
assert.equal(JSON.stringify(test.state.data), '{"unchanged":true}', "Preferences are never shared database changes");
const reloaded = setup(); reloaded.restoreProgramRegistryFilters();
assert.equal(reloaded.state.search, test.state.search); assert.equal(reloaded.state.tableValueFilters.programs.hours.label, "72");
reloaded.state.programRegistryTypeFilter.push("ППП");
assert.equal(reloaded.loadProgramRegistryFilters().types.length, 2, "Restored state is not a cache alias");
const other = setup("user-b"); other.restoreProgramRegistryFilters();
assert.equal(other.state.search, ""); assert.equal(other.state.statusFilter, "Все");
other.state.search = "Личный поиск Б"; other.saveProgramRegistryFilters();
assert.equal(store.get(test.getProgramRegistryFiltersStorageKey()), saved);
const readCount = reads, writeCount = writes;
other.demo = true; other.state.search = "Демонстрация"; other.saveProgramRegistryFilters(); other.restoreProgramRegistryFilters();
assert.equal(other.loadProgramRegistryFilters().search, "");
assert.equal(reads, readCount); assert.equal(writes, writeCount, "Demo does not read or overwrite personal preferences");
other.demo = false; other.user = {}; other.saveProgramRegistryFilters();
assert.equal(other.loadProgramRegistryFilters().search, ""); assert.equal(reads, readCount);
Object.assign(test.state, {search: "", statusFilter: "Все", programRegistryTypeFilter: []});
delete test.state.tableValueFilters.programs; test.saveProgramRegistryFilters();
const cleared = setup(); cleared.restoreProgramRegistryFilters();
assert.equal(cleared.state.search, ""); assert.equal(cleared.state.programRegistryTypeFilter.length, 0); assert.equal(Object.keys(cleared.state.tableValueFilters.programs).length, 0, "Cleared filters stay cleared after reload");
store.set(test.getProgramRegistryFiltersStorageKey(), "not-json");
const corrupt = setup(); assert.doesNotThrow(() => corrupt.restoreProgramRegistryFilters()); assert.equal(corrupt.state.statusFilter, "Все");
const sanitized = test.normalizeProgramRegistryFilters(JSON.parse('{"search":[],"status":false,"types":["КПК","КПК",null,123],"tableFilters":{"__proto__":{"value":"bad"},"unknown":{"value":"bad"},"hours":{"value":"72","label":"72"}}}'));
assert.equal(sanitized.search, ""); assert.equal(sanitized.status, "Все"); assert.equal(JSON.stringify(sanitized.types), '["КПК"]'); assert.equal(Object.keys(sanitized.tableFilters).join(), "hours");
unavailable = true;
const offline = setup(); offline.restoreProgramRegistryFilters(); offline.state.search = "Сохраняется в памяти"; offline.saveProgramRegistryFilters(); offline.state.search = ""; offline.restoreProgramRegistryFilters();
assert.equal(offline.state.search, "Сохраняется в памяти");
unavailable = false;
const obsolete = setup("old-status"); obsolete.state.statusFilter = "Удалённый статус"; obsolete.saveProgramRegistryFilters(); obsolete.restoreProgramRegistryFilters();
assert.equal(obsolete.state.statusFilter, "Все", "Removed status cannot create an invisible active filter");
// Search must survive leaving before its 180 ms render debounce fires.
test.MAIN_REGISTRY_SEARCH_DEBOUNCE_MS = 180; test.mainRegistrySearchTimer = 0;
test.window = {setTimeout: () => 1, clearTimeout: () => {}}; test.render = () => assert.fail("Search should be debounced"); test.restoreMainRegistrySearchFocus = () => {};
vm.runInContext(block("  function applyMainRegistrySearchInput(", "  function applyDatabaseDemoModePresentation("), test);
test.applyMainRegistrySearchInput({value: "Быстрый поиск", selectionStart: 13, selectionEnd: 13});
assert.equal(JSON.parse(store.get(test.getProgramRegistryFiltersStorageKey())).search, "Быстрый поиск");
for (const marker of ['document.querySelectorAll("[data-view]")', 'document.querySelectorAll("[data-view-shortcut]")']) {
  const handler = source.slice(source.indexOf(marker), source.indexOf(marker) + 2200);
  assert.ok(handler.indexOf("restoreProgramRegistryFilters();") > handler.indexOf("state.programRegistryTypeFilter = [];"), "Navigation restores after generic reset");
}
assert.match(block("  async function initializeApplication(", "  initializeApplication().catch("), /restoreProgramRegistryFilters\(\);\s*bindStudentStatusHistoryNavigation\(\)/);
assert.match(block("  function synchronizeAisBrowserHistory(", "  function restoreCancelledAisHistoryNavigation("), /saveProgramRegistryFilters\(\)/);
assert.match(block("  function sanitizeAisNavigationSnapshotForDemo(", "  function createAisHistoryState("), /programTableValueFilters: \{\}/);
assert.match(block("  async function restoreAisNavigationSnapshot(", "  async function handleAisHistoryNavigation("), /programTableValueFilters/);
console.log("PASS: program search/status/types/value filters across navigation/reload, immediate search persistence, reset, user isolation, demo privacy, unavailable/corrupt storage, unchanged database and browser history integration");
