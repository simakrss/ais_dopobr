"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const links = fs.readFileSync(path.join(root, "field-html-links.js"), "utf8").replace(/\r\n/g, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
function extract(source, name) {
  const start = new RegExp(`^  function ${name}\\(`, "m").exec(source);
  assert.ok(start, name);
  const rest = source.slice(start.index + start[0].length);
  const end = /^  }/m.exec(rest);
  assert.ok(end, name);
  return source.slice(start.index, start.index + start[0].length + end.index + 3);
}
const context = {URL, window: {}};
vm.createContext(context);
for (const name of ["trimHtmlLinkCandidate", "normalizeHttpUrl", "getMatches"]) {
  vm.runInContext(extract(links, name), context);
}
context.window.AISFieldHtmlLinks = {getMatches: context.getMatches};
for (const name of ["escapeHtml", "escapeAttr", "renderStudentMailboxMessageText"]) {
  vm.runInContext(extract(app, name), context);
}
const render = context.renderStudentMailboxMessageText;
function plainText(html) {
  return html.replace(/<\/?a\b[^>]*>/g, "")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&#039;", "'").replaceAll("&amp;", "&");
}
const cloud = "https://cloud.mail.ru/stock/test-file?download=1&source=mail";
const source = `Здравствуйте!\nСсылка для скачивания файлов: ${cloud}\nЕщё: (https://example.test/файл_(1)).\n  Подпись`;
let html = render(source);
assert.equal((html.match(/<a /g) || []).length, 2);
assert.ok(html.includes('href="' + context.escapeAttr(cloud) + '"'));
assert.match(html, /target="_blank" rel="noopener noreferrer"/);
assert.equal(plainText(html), source, "Text, whitespace, punctuation and selection contents must not change");
assert.match(html, /https:\/\/example.test\/файл_\(1\)<\/a>\)\./);
assert.doesNotMatch(html, /data-template-external-url|contenteditable|Ctrl/);
assert.match(render("http://example.test/plain"), /href="http:\/\/example.test\/plain"/);
const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script> javascript:alert(3) data:text/html,x file:///C:/test';
html = render(hostile);
assert.doesNotMatch(html, /<(?:img|script|a)\b/i);
assert.equal(plainText(html), hostile);
assert.equal(render(null), "");
assert.equal(render("Письмо без ссылки"), "Письмо без ссылки");
html = render('https://example.test/?x=" onclick="alert(1)');
assert.equal((html.match(/<a /g) || []).length, 1);
assert.doesNotMatch(html, /<a [^>]*onclick=/);
context.window.AISFieldHtmlLinks = undefined;
assert.equal(render("<b>" + cloud), context.escapeHtml("<b>" + cloud), "Missing link module must fail safely to plain text");
context.window.AISFieldHtmlLinks = {getMatches: context.getMatches};
assert.match(app, /<pre>\$\{renderStudentMailboxMessageText\(message.excerpt\)\}<\/pre>/);
assert.match(styles, /\.student-mailbox-text-link\s*\{[^}]*cursor: pointer/s);
assert.match(styles, /\.student-mailbox-text-link:focus-visible\s*\{[^}]*outline:/s);
console.log("Mailbox links: native single-click anchors, new-tab safety, HTTP/HTTPS, punctuation, escaping, unchanged text and safe fallback: OK");

// Optional isolated browser fixture. It never queries mailboxes or opens real attachments.
if (process.argv.includes("--serve")) {
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    if (req.url === "/styles.css" || req.url === "/field-html-links.js") {
      res.setHeader("Content-Type", req.url.endsWith("css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
      res.end(fs.readFileSync(path.join(root, req.url.slice(1))));
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.url.startsWith("/destination")) {
      res.end('<!doctype html><meta charset="utf-8"><title>Ссылка открыта</title><h1>Ссылка открыта</h1>');
      return;
    }
    const url = `http://127.0.0.1:${server.address().port}/destination?file=1&from=mail`;
    const text = `К этому письму приложены ссылки на следующие файлы:\n\nСсылка для скачивания файлов: ${url}\n\nФайлы будут храниться до 12.03.2027`;
    res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка ссылок в письмах</title>
      <link rel="stylesheet" href="/styles.css"><main style="padding:24px;max-width:800px">
      <h2>Письма: тестовый просмотр</h2><article class="student-mailbox-message">
      <label class="student-mailbox-message-select"><input type="checkbox" aria-label="Выбрать письмо"><span></span></label>
      <div class="student-mailbox-message-content"><strong>Документы.</strong>
      <details open><summary>Текст письма</summary><pre>${render(text)}</pre></details>
      <div class="student-mailbox-import-items"><label class="student-mailbox-import-item"><input type="checkbox" checked aria-label="Выбрать вложение"><span>Документ.pdf</span></label></div></div>
      </article></main><script src="/field-html-links.js"></script></html>`);
  });
  server.listen(0, "127.0.0.1", () => console.log(`Fixture: http://127.0.0.1:${server.address().port}/`));
}
