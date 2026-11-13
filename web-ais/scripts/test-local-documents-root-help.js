"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const server = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const start = app.indexOf('<div class="admin-local-documents-root-row">');
const end = app.indexOf('<label class="admin-open-documents-mode', start);
assert.ok(start >= 0 && end > start);
const markup = app.slice(start, end);
assert.doesNotMatch(markup, /Корневая папка документов системы/);
assert.match(markup, /Базовая папка на локальном диске/);
assert.match(markup, /База содержит папку системы/);
assert.match(markup, /С включённой галочкой.*только последнее имя/);
assert.match(markup, /С выключенной — весь указанный там путь/);
assert.match(styles, /\.admin-local-documents-path-help\s*\{[^}]*overflow-wrap: anywhere/s);

// Exercise the real form markup: only visible wording changes, never field keys or values.
for (const checked of [true, false]) {
  const html = vm.runInNewContext('`' + markup + '`', {
    localDocumentsRoot: "Y:\\", localDocumentsRootIsSystemParent: checked,
    openDocumentsLocally: true, escapeAttr: value => value
  });
  const input = html.match(/<input name="localDocumentsRootIsSystemParent"[^>]*>/)[0];
  assert.equal(/\schecked(?:\s|>)/.test(input), checked);
  assert.match(html, /name="localDocumentsRoot"[^>]*value="Y:\\"/);
  assert.match(html, /placeholder="Y:\\"/);
  assert.equal((html.match(/aria-describedby="local-documents-root-help"/g) || []).length, 2);
  assert.ok(html.includes("Y:\\АИС Допобразование"));
  assert.ok(html.includes("Y:\\Реклама\\Коммерческие\\…"));
}

// Verify the documented examples against the unchanged production path resolvers.
function extract(name) {
  const match = new RegExp(`^function ${name}\\(`, "m").exec(server);
  assert.ok(match, name);
  const rest = server.slice(match.index + match[0].length);
  const next = /^}/m.exec(rest);
  return server.slice(match.index, match.index + match[0].length + next.index + 1);
}
const settings = {
  localDocumentsRoot: "Y:\\", localDocumentsRootIsSystemParent: true,
  yandexDiskBasePath: "ООО Цифровизация Плюс/АИС Допобразование"
};
const context = {path, URL, process: {platform: "win32"}, serverSettings: settings};
vm.createContext(context);
for (const name of ["normalizeWebDavPath", "parseHttpResourceUrl", "isYandexWebDavHost", "extractYandexWebDavPath", "resolveConfiguredYandexWebDavPath", "getAbsoluteFileSystemPathApi", "getRuntimeFileSystemPathApi", "resolveLocalTemplatePathFromWebDavSource"]) {
  vm.runInContext(extract(name), context);
}
const before = JSON.stringify(settings);
assert.equal(context.resolveLocalTemplatePathFromWebDavSource("Документы/Приказ.docx"), "Y:\\АИС Допобразование\\Документы\\Приказ.docx");
assert.equal(context.resolveLocalTemplatePathFromWebDavSource("[-1]/Реклама/Коммерческие/Пример.docx"), "Y:\\Реклама\\Коммерческие\\Пример.docx");
assert.equal(JSON.stringify(settings), before, "Path resolution must not mutate settings");
settings.localDocumentsRootIsSystemParent = false;
assert.equal(context.resolveLocalTemplatePathFromWebDavSource("Документы/Приказ.docx"), "Y:\\ООО Цифровизация Плюс\\АИС Допобразование\\Документы\\Приказ.docx");
console.log("Local root help: clear labels, preserved form fields/values, accessible explanations and matching on/off/parent path examples: OK");
