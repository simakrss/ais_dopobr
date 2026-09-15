"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const fn = name => source.match(new RegExp(`  function ${name}\\([\\s\\S]*?\\n  }`))[0];
const sort = new Function(`${fn("sortProgramSiteTemplates")} return sortProgramSiteTemplates;`)();
const catalog = [
  {id: 1, title: "Язык"}, {id: 2, title: "базовый курс 10"},
  {id: 3, title: "Актуальное название"}, {id: 4, title: "Базовый курс 2"},
  {id: 5, title: "Экология"}, {id: 6, title: "Ёмкий текст"},
  {id: 7, title: " Единая среда"}
];
const original = structuredClone(catalog);
assert.deepEqual(sort(catalog).map(item => item.id), [3, 4, 2, 7, 6, 5, 1]);
assert.deepEqual(catalog, original, "Shared catalog is never mutated");
assert.deepEqual(sort([{id: 10, title: "курс"}, {id: 2, title: "Курс"}]).map(item => item.id), [2, 10]);
assert.match(source, /sortProgramSiteTemplates\(templates\)\.filter/, "Main prototype search uses same ordering");
const render = new Function(`${fn("renderProgramSiteImagePicker")} return renderProgramSiteImagePicker;`)();
assert.match(render(), /data-image-source role="combobox"[^>]*aria-expanded="false" disabled/);
assert.match(render(), /data-image-options role="listbox"[^>]*hidden/);
assert.match(render(), /<\/div><\/div><div data-image-preview><\/div><p[^>]*data-image-caption/);
assert.match(css, /\.program-site-image-layout \{[^}]*align-items: center;/);
assert.match(css, /\.program-site-image-layout \[data-image-caption\] \{[^}]*grid-column: 1 \/ -1/);
assert.match(css, /\.program-site-image-option > img,[^}]*width: 56px; height: 56px;/);
assert.match(css, /\.program-site-image-trigger:focus-visible \{[^}]*var\(--teal\)/);
assert.doesNotMatch(fn('bindProgramSiteImagePicker'), /\.scrollIntoView\(/, 'Opening options must not scroll the entire form');
assert.doesNotMatch(css, /\.program-site-image-layout img\s*\{/, "Selected preview sizing must not stretch option thumbnails");

// Run the real binder against a minimal DOM to cover state and event behavior.
class Element {
  constructor() { this.listeners = {}; this.attrs = {}; this.dataset = {}; this.style = {}; this.value = ""; this.hidden = false; this.disabled = false; this.classList = {toggle() {}}; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  emit(type, props = {}) { const event = {target: this, preventDefault() {}, stopPropagation() {}, ...props}; (this.listeners[type] || []).forEach(callback => callback(event)); }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  focus() { this.focused = true; }
  scrollIntoView() {}
  getBoundingClientRect() { return {top: 100, bottom: 650}; }
  contains(target) { return target === this; }
}
const select = new Element(), search = new Element(), list = new Element(), combo = new Element(), preview = new Element(), caption = new Element();
list.hidden = true; select.disabled = true;
Object.defineProperty(list, "innerHTML", {set(html) {
  this.html = html;
  this.options = [...html.matchAll(/id="([^"]+)" data-image-option="([^"]*)" aria-selected="([^"]+)"/g)].map(match => {
    const option = new Element(); option.id = match[1]; option.dataset.imageOption = match[2]; option.attrs['aria-selected'] = match[3]; option.closest = () => option; return option;
  });
}});
list.querySelectorAll = () => list.options || [];
const picker = new Element(), container = new Element();
picker.querySelector = selector => ({'[data-image-source]': select, '[data-image-search]': search, '[data-image-options]': list, '.program-site-image-combo': combo, '[data-image-preview]': preview, '[data-image-caption]': caption})[selector];
container.querySelector = () => picker;
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const changes = [];
const bind = new Function('escapeHtml', 'escapeAttr', 'window', `${fn('sortProgramSiteTemplates')} ${fn('getProgramLandingPreviewImage')} ${fn('bindProgramSiteImagePicker')} return bindProgramSiteImagePicker;`)(escape, escape, {innerHeight: 720});
const api = bind(container, {value: '1', defaultLabel: 'Не менять изображения', onChange: value => changes.push(value)});
select.emit('click'); assert.equal(list.hidden, true, 'Unavailable catalog cannot open');
api.setItems([...catalog.map(item => ({...item, imageUrl: `https://edu-plus.ru/wp-content/uploads/${item.id}.jpg`})), {id: 99, title: 'No photo'}, {id: 100, title: 'Untrusted', imageUrl: 'https://other.example/image.jpg'}]);
assert.deepEqual(list.options.map(item => item.dataset.imageOption), ['', '3', '4', '2', '7', '6', '5', '1']);
assert.match(list.html, /width="56" height="56" loading="lazy"/);
select.emit('click'); assert.equal(list.hidden, false); assert.equal(select.attrs['aria-expanded'], 'true');
select.emit('keydown', {key: 'Home'}); select.emit('keydown', {key: 'ArrowDown'}); select.emit('keydown', {key: 'Enter'});
assert.equal(api.value(), '3'); assert.deepEqual(changes, ['3']); assert.equal(list.hidden, true); assert.equal(select.focused, true);
select.emit('click'); select.emit('keydown', {key: 'End'}); select.emit('keydown', {key: 'Escape'});
assert.equal(api.value(), '3', 'Escape cancels active option'); assert.equal(select.attrs['aria-activedescendant'], undefined);
search.value = 'БАЗОВЫЙ'; search.emit('input');
assert.deepEqual(list.options.map(item => item.dataset.imageOption), ['', '3', '4', '2'], 'Search keeps current selection in alphabetic order');
select.disabled = true; list.emit('click', {target: list.options.at(-1)}); assert.equal(api.value(), '3', 'Busy dialog prevents selection');
select.disabled = false; list.emit('click', {target: list.options.at(-1)}); assert.equal(api.value(), '2');
select.emit('click'); select.emit('keydown', {key: 'Tab'}); assert.equal(list.hidden, true);
search.value = '<missing>'; search.emit('input'); assert.match(list.html, /не найдены/);
container.emit('click'); assert.equal(list.hidden, true);
api.setItems([]); assert.match(select.title, /недоступен/); assert.equal(api.value(), '2', 'Missing saved source is not silently reset');
api.setItems([{id: 2, title: '<script>alert("unsafe")</script>', imageUrl: 'https://edu-plus.ru/wp-content/uploads/cover.jpg', previewImageUrl: 'https://other.example/cover.jpg'}]);
assert.doesNotMatch(list.html, /<script>|other\.example/);
assert.match(list.html, /&lt;script>/);
assert.match(list.html, /https:\/\/edu-plus.ru\/wp-content\/uploads\/cover.jpg/, 'Unsafe preview falls back to validated image');
console.log('PASS: Russian alphabetic/numeric ordering, immutable catalog, 56px thumbnails, preview centering, search, keyboard, clicks, busy guard, unavailable sources and safe URLs');
