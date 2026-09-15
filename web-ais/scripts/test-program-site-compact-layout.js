"use strict";
// --serve renders the real template/functions with synthetic data on loopback only.
// No authentication, shared records, WordPress calls or real generation actions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const extract = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
};
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function saveBinding(source) {
  return extract(source, "    const saveParameters = async () => {", "    const storeResult = async (value) => {");
}
function preview(type = "ПРО", result = false) {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const generator = extract(source, "  async function openProgramSiteGenerator(", "  function renderProgramModal(");
  const className = generator.match(/dialog.className = "([^"]+)"/)[1];
  const markup = generator.match(/dialog.innerHTML = (`[\s\S]*?`);\s*document.body.appendChild\(dialog\)/)[1];
  const fieldsSource = extract(source, 'field("webinarDate",', 'field("qualification",');
  const fields = new Function("field", `return [${fieldsSource}];`)((key, label, fieldType, required, dict, options) => ({key, label, type: fieldType, required, dict, options}));
  const renderField = new Function("state", "escapeAttr", "escapeHtml", `${extract(source, "  function renderField(", "  function renderStudentModal(")} return renderField;`)({modal: {config: "programs"}}, escape, escape);
  const renderGenerator = new Function("configs", "renderField", "escapeAttr", `${extract(source, "  function renderProgramGeneratorFields(", "  function createProgramSiteProgress(")} return renderProgramGeneratorFields;`)({programs: {fields}}, renderField, escape);
  const program = {type, name: "Тестовая образовательная программа: актуальное название статьи как основной критерий конкурентоспособности автора", webinarDate: "2026-09-18", webinarTime: "18:00", webinarJoinUrl: "https://salutejazz.ru/example", siteSampleDate: "2026-09-15"};
  const pickerRenderers = new Function(`${extract(source, "  function renderProgramSiteCatalogCombo(", "  function bindProgramSiteImagePicker(")} return {renderProgramSiteImagePicker, renderProgramSiteCatalogCombo};`)();
  const renderLink = new Function("escapeAttr", "escapeHtml", `${source.match(/  function renderProgramSiteLink\([\s\S]*?\n  }/)[0]} return renderProgramSiteLink;`)(escape, escape);
  let html = new Function("escapeHtml", "type", "program", "bilingual", "renderProgramSiteImagePicker", "renderProgramSiteCatalogCombo", `return ${markup};`)(escape, type, program, ["ПРО", "ДОП"].includes(type), pickerRenderers.renderProgramSiteImagePicker, pickerRenderers.renderProgramSiteCatalogCombo);
  html = html.replace("<details data-site-parameters>", "<details data-site-parameters open>")
    .replace('<div data-site-prototype-link></div>', `<div data-site-prototype-link>${renderLink('https://edu-plus.ru/other_course/test-prototype/', 'Открыть прототип')}</div>`)
    .replace('<div data-site-parameters-host></div>', `<div data-site-parameters-host>${renderGenerator(program).replace('data-site-generator-fields hidden', 'data-site-generator-fields')}</div>`);
  if (result) html = html.replace('<section data-site-result hidden></section>', '<section data-site-result><h3>Черновики подготовлены</h3><p>ID товара: 123; ID лендинга: 456</p><div class="program-site-actions"><a class="ghost-button compact-button" href="#">Просмотреть лендинг</a><a class="ghost-button compact-button" href="#">Редактировать товар</a></div><p class="muted">Образцы созданы для этой программы.</p><label class="program-site-review"><input type="checkbox"> Проверены все блоки лендинга и образцы документов</label><button class="primary-button" data-site-publish>Опубликовать</button></section>');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка компактной формы ${escape(type)}</title><link rel="stylesheet" href="/styles.css"></head><body><form id="recordForm"></form><dialog class="${className}" aria-label="Тестовая форма генератора">${html}</dialog><script>
    const dialog = document.querySelector('dialog'), card = document.querySelector('#recordForm'), select = dialog.querySelector('[data-site-template]'), status = dialog.querySelector('[data-site-status]');
    const templateInput = dialog.querySelector('[name="siteTemplateId"]'); let busy = false;
    dialog.querySelector('[data-site-save-host]').appendChild(dialog.querySelector('.program-site-parameters-actions'));
    dialog.querySelectorAll('[data-site-generator-fields] input, [data-site-generator-fields] select, [data-site-generator-fields] textarea').forEach(control => control.setAttribute('form', 'recordForm'));
    const setBusy = value => { busy = value; dialog.querySelector('[data-site-save-parameters]').disabled = value; };
    const saveRecordFormBeforeContinuation = async (form, options) => {
      if (!options.flush || !form.checkValidity()) return '';
      const values = Object.fromEntries(new FormData(form));
      if (new URLSearchParams(location.search).has('save-error')) throw new Error('Тест: общая база недоступна. Параметры не сохранены.');
      status.dataset.savedProductName = values.siteProductName || '';
      return 'fixture-program';
    };
    ${saveBinding(source)}
    const escapeHtml = ${escape.toString()}, escapeAttr = escapeHtml;
    const validatePreviewImage = ${source.match(/  function getProgramLandingPreviewImage\([\s\S]*?\n  }/)[0]};
    const getProgramLandingPreviewImage = value => validatePreviewImage(value) ? '/fixture-cover.svg?image=' + encodeURIComponent(new URL(value).pathname) : '';
    ${extract(source, "  function renderProgramSiteCatalogCombo(", "  async function openProgramSiteSync(")}
    const fixtureCatalog = [
      {id: 9, title: 'Язык и культура общения'},
      {id: 2, title: 'Инструменты оптимизации профиля автора в Российском индексе научного цитирования (РИНЦ): электронные образовательные технологии'},
      {id: 8, title: 'Базовый курс — 10'},
      {id: 1, title: 'Актуальное название статьи'},
      {id: 7, title: 'Базовый курс — 2'},
      {id: 3, title: 'Ёмкие тексты и работа с информацией'},
      {id: 4, title: 'Без изображения'}
    ].map(item => ({...item, imageUrl: item.id === 4 ? '' : 'https://edu-plus.ru/wp-content/uploads/fixture-' + item.id + '.jpg'}));
    const imagePicker = bindProgramSiteImagePicker(dialog, {value: new URLSearchParams(location.search).has('images') ? '2' : '', defaultLabel: 'Изображение прототипа лендинга', onChange: value => {dialog.querySelector('[name="siteImageSourceId"]').value = value; status.textContent = 'Тест: источник изображения в форме — ' + new FormData(card).get('siteImageSourceId');}});
    imagePicker.setItems(fixtureCatalog);
    let templates = fixtureCatalog.map(item=>({...item,url:'https://edu-plus.ru/other_course/test-prototype/'})), result = null, program = {};
    const getDefaultProgramSiteTemplateId = () => '2';
    const prepareButton = dialog.querySelector('[data-site-prepare]');
    const renderProgramSiteLink = ${source.match(/  function renderProgramSiteLink\([\s\S]*?\n  }/)[0]};
    const drawResult = () => {};
    ${extract(source, "    const updatePrototypeLink = () => {", "    const load = async () => {")}
    ${extract(source, "    const onTemplateChange = () => {", '    dialog.querySelector("[data-site-reload]")')}
    const prototypePicker = bindProgramSiteCatalogPicker(dialog, {kind:'prototype',defaultLabel:'Выберите прототип',onChange:()=>onTemplateChange()});
    updateTemplates();
    dialog.showModal(); document.querySelector('[data-site-close]').onclick=()=>dialog.close();
  </script></body></html>`;
}
async function checks() {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.program-site-generator-dialog \.program-site-fields\s*\{[^}]*padding:\s*0;[^}]*gap:\s*7px 10px;/);
  assert.match(css, /\.program-site-generator-dialog \.program-site-body\s*\{[^}]*gap:\s*8px;[^}]*padding:\s*10px 12px;/);
  assert.match(css, /\.program-site-generator-dialog \.program-site-prototype-fields\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.program-site-generator-dialog \[data-site-prototype-link\]\s*\{[^}]*display: flex;[^}]*justify-content: flex-end;/);
  assert.match(css, /\.program-site-generator-dialog \.program-site-schedule-fields \{[^}]*grid-template-columns: minmax\(135px, 1.1fr\) minmax\(105px, .8fr\) minmax\(0, 1.4fr\) minmax\(135px, 1.1fr\)/);
  assert.match(css, /@media \(max-width: 600px\)\s*\{[^}]*\.program-site-generator-dialog \.program-site-schedule-fields/);
  assert.match(css, /\.program-site-product-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.program-site-generator-dialog \[data-site-status\]:empty/);
  assert.match(css, /\.program-site-generator-dialog \.program-site-parameters-actions\s*\{[^}]*display: flex;[^}]*justify-content: flex-end;/);
  for (const type of ["ПРО", "ДОП", "КПК", "ППП"]) {
    const html = preview(type, true);
    assert.match(html, /class="modal program-site-dialog program-site-generator-dialog"/);
    assert.match(html, /name="siteProductName"/); assert.match(html, /data-site-template[^>]*required/);
    assert.match(html, /data-site-prepare/); assert.match(html, /data-site-progress/); assert.match(html, /data-site-publish/);
    assert.match(html, /program-site-prototype-fields/);
    assert.match(html, /data-site-prototype-link><a[^>]+target="_blank"[^>]+>Открыть прототип<\/a>/);
    assert.match(html, /class="primary-button" type="button" data-site-save-parameters/);
    assert.match(html, /program-site-product-row[\s\S]*?name="siteProductName"[\s\S]*?data-site-save-host/);
    assert.match(html, /data-image-popup hidden>\s*<input type="search" data-image-search/);
    assert.doesNotMatch(html, /Поиск прототипа по названию|Поиск источника по названию|data-site-search/);
    if (type !== "ПРО") assert.match(html, /data-site-webinar-only hidden/);
  }
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const generator = extract(source, '  async function openProgramSiteGenerator(', '  function renderProgramModal(');
  assert.doesNotMatch(generator, /result\.promoMessage|<span>Промосообщение<\/span>/);
  assert.match(generator, /querySelector\("\.program-site-parameters-actions"\)\?\.remove\(\)/, 'Old dialog save handler is removed before returning fields to the card');
  const binding = saveBinding(source);
  assert.ok(binding.indexOf('await saveParameters();') < binding.indexOf('.open = false'), 'Collapse only after confirmed save');
  for (const outcome of ['success', 'false', 'error', 'invalid']) {
    let handler, calls = 0, complete;
    const button = {disabled: false, addEventListener: (_event, callback) => {handler = callback;}};
    const details = {open: true}, summary = {focused: false, focus() {this.focused = true;}};
    const status = {textContent: ''}, templateInput = {value: ''}, card = {};
    const select = {value: outcome === 'invalid' ? '' : '42', focus() {this.focused = true;}};
    const dialog = {querySelector: selector => ({'[data-site-save-parameters]':button, '[data-site-parameters]':details, '[data-site-parameters] > summary':summary})[selector]};
    const save = async (form, options) => {
      calls++; assert.equal(form, card); assert.equal(options.flush, true);
      return new Promise((resolve, reject) => { complete = () => outcome === 'error' ? reject(new Error('Save failed')) : resolve(outcome === 'false' ? '' : 'program-id'); });
    };
    new Function('dialog', 'status', 'select', 'templateInput', 'card', 'saveRecordFormBeforeContinuation', `let busy = false; const setBusy = value => { busy = value; dialog.querySelector('[data-site-save-parameters]').disabled = value; }; ${binding}`)(dialog, status, select, templateInput, card, save);
    const pending = handler();
    if (outcome !== 'invalid') {
      assert.equal(button.disabled, true); assert.equal(details.open, true, 'Do not collapse while saving');
      await handler(); assert.equal(calls, 1, 'Double click does not submit twice'); complete();
    }
    await pending;
    assert.equal(button.disabled, false, 'Retry button enabled');
    assert.equal(details.open, outcome !== 'success', 'Keep parameters open on failure');
    assert.equal(summary.focused, outcome === 'success', 'Focus moves to visible summary only on success');
    assert.ok(status.textContent); assert.equal(calls, outcome === 'invalid' ? 0 : 1);
    if (outcome !== 'invalid') assert.equal(templateInput.value, '42');
  }
  console.log("PASS: compact scoped grids/spacing, responsive prototype controls, all program types, retained required fields and generation/review controls");
  console.log("PASS: right-aligned primary save button, awaited save/collapse, failure/validation recovery, double-click guard and visible focus");
}
if (process.argv.includes("--serve")) {
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/shutdown" && req.method === "POST") {res.end("Stopped"); server.close(); clearTimeout(expiry); return;}
    if (url.pathname === "/styles.css") {res.setHeader("Content-Type", "text/css; charset=utf-8"); res.end(fs.readFileSync(path.join(root, "styles.css"))); return;}
    if (url.pathname === "/fixture-cover.svg") {res.setHeader("Content-Type", "image/svg+xml"); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" fill="#edf6f5"/><rect x="25" y="20" width="110" height="65" rx="8" fill="#0e817a"/><circle cx="55" cy="45" r="12" fill="#ffe27b"/><path d="M35 75L70 50 85 63 115 35 127 75Z" fill="#fff"/><text x="80" y="109" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#24453e">'+escape(url.searchParams.get('image')?.match(/fixture-(\d+)/)?.[1] || '1')+'</text></svg>'); return;}
    if (url.pathname !== "/") {res.writeHead(404); res.end(); return;}
    const type = ["ПРО", "ДОП", "КПК", "ППП"].includes(url.searchParams.get("type")) ? url.searchParams.get("type") : "ПРО";
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(preview(type, url.searchParams.has("result")));
  });
  const expiry = setTimeout(() => server.close(), 20 * 60 * 1000);
  server.listen(0, "127.0.0.1", () => console.log(`Layout fixture: http://127.0.0.1:${server.address().port}/`));
} else checks().catch(error => { console.error(error); process.exitCode = 1; });
