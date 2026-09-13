const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");

async function runBrowserChecks() {
  const results = document.getElementById("results");
  const lines = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const tick = () => new Promise(requestAnimationFrame);
  const fire = (field, type) => field.dispatchEvent(new Event(type, { bubbles: true }));
  const transparent = value => value === "transparent" || /rgba\(.+, 0\)$/u.test(value);
  try {
    for (const field of document.querySelectorAll("[data-test-native]")) {
      const name = field.getAttribute("aria-label");
      const host = field.closest(".field-case");
      const originalColor = getComputedStyle(field).color;
      const originalFont = getComputedStyle(field).font;
      field.focus();
      for (const value of ["h", "https:", "https://", "https://v", "https://vk.ru", "https://vk.ru/profile", "До https://one.test/ и https://two.test/"]) {
        field.value = value;
        if (field.selectionStart !== null) field.setSelectionRange(value.length, value.length);
        fire(field, "input");
        const overlay = host.querySelector("[data-native-html-link-highlight]");
        const expected = window.AISFieldHtmlLinks.getMatches(value).length;
        check(Boolean(overlay) === Boolean(expected), name + ": live link detection");
        check(field.value === value, name + ": value changed");
        check(getComputedStyle(field).color === originalColor && getComputedStyle(field).font === originalFont, name + ": native text changed");
        if (field.selectionStart !== null) check(field.selectionStart === value.length && field.selectionEnd === value.length, name + ": caret moved");
        if (overlay) {
          const content = overlay.querySelector(".native-html-link-highlight-content");
          const links = overlay.querySelectorAll("[data-template-external-url]");
          check(!overlay.hidden && getComputedStyle(content).opacity !== "0", name + ": highlight hidden during typing");
          check(links.length === expected, name + ": stale links");
          check(transparent(getComputedStyle(content).webkitTextFillColor), name + ": duplicate glyphs");
          check(!transparent(getComputedStyle(links[0]).backgroundColor), name + ": missing decoration");
          if (field.selectionStart !== null) {
            field.setSelectionRange(0, value.length);
            fire(field, "select");
            check(getComputedStyle(content).opacity !== "0" && !overlay.hidden, name + ": selection hides links");
            check(field.selectionStart === 0 && field.selectionEnd === value.length, name + ": selection changed");
          }
        }
      }
      field.value = "Без ссылок";
      fire(field, "input");
      check(!host.querySelector("[data-native-html-link-highlight]"), name + ": stale overlay after deletion");
      field.value = field.tagName === "TEXTAREA"
        ? "Здравствуйте, Мария Александровна!\n\nПортал: https://portal.edu-plus.ru\nКурс: https://portal.edu-plus.ru/my/courses.php\nИнструкция: https://edu-plus.ru/portal_intro\n\nОбычный текст остаётся нативным."
        : "https://vk.ru/profile";
      fire(field, "input");
      field.blur();
      lines.push(name + ": OK (набор, выделение, удаление)");
    }
    const scrolled = document.getElementById("portal-message");
    scrolled.scrollTop = scrolled.scrollHeight;
    fire(scrolled, "scroll");
    const mirror = scrolled.closest(".field-case").querySelector(".native-html-link-highlight-content");
    check(mirror.style.transform.includes(-scrolled.scrollTop + "px"), "textarea scroll alignment");
    scrolled.scrollTop = 0;
    fire(scrolled, "scroll");
    check(!document.getElementById("password-field").hasAttribute("data-native-html-link-field"), "password must not be mirrored");
    check(CSS.highlights && window.Highlight, "CSS Highlight API is unavailable");
    const rich = document.getElementById("rich-editor");
    const ranges = () => Array.from(CSS.highlights.get("ais-editable-html-links") || []).filter(range => rich.contains(range.startContainer));
    rich.focus();
    for (const text of ["https://", "https://v", "https://vk.ru/profile", "https://two.test/new"]) {
      rich.textContent = text;
      const selection = getSelection();
      const caret = document.createRange();
      caret.selectNodeContents(rich); caret.collapse(false);
      selection.removeAllRanges(); selection.addRange(caret);
      const firstNode = rich.firstChild;
      fire(rich, "input");
      check(ranges().length === window.AISFieldHtmlLinks.getMatches(text).length, "rich live detection");
      check(rich.firstChild === firstNode && rich.textContent === text, "rich DOM was rewritten");
      check(selection.anchorNode === caret.startContainer && selection.anchorOffset === caret.startOffset, "rich caret moved");
    }
    rich.innerHTML = 'Ссылка: <span>https://example.</span><em>test/path</em> и <span contenteditable="false" data-template-token>#https://ignored.test#</span>';
    const markup = rich.innerHTML;
    fire(rich, "input");
    check(ranges().length === 1 && ranges()[0].toString() === "https://example.test/path", "split inline URL or protected token");
    check(rich.innerHTML === markup, "rich markup changed");
    const rect = ranges()[0].getBoundingClientRect();
    const point = { bubbles: true, clientX: rect.left + 2, clientY: rect.top + 2 };
    rich.dispatchEvent(new PointerEvent("pointermove", point));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }));
    check(getComputedStyle(rich).cursor === "pointer", "rich Ctrl pointer");
    const opened = [];
    const captureOpen = event => {
      if (event.target.tagName === "A") { opened.push(event.target.href); event.preventDefault(); }
    };
    document.addEventListener("click", captureOpen);
    rich.dispatchEvent(new MouseEvent("click", { ...point, ctrlKey: true, cancelable: true }));
    document.removeEventListener("click", captureOpen);
    check(opened[0] === "https://example.test/path", "fresh rich link Ctrl click");
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));
    check(getComputedStyle(rich).cursor !== "pointer", "rich Ctrl pointer reset");
    rich.innerHTML = "<div>https://</div><div>example.test</div>";
    fire(rich, "input");
    check(ranges().length === 0, "link crosses block boundary");
    rich.textContent = "Редактор шаблона: https://example.test/program";
    await tick();
    check(ranges().length === 1, "mutation-only rich update");
    rich.firstChild.nodeValue = "Редактор шаблона: https://example.test/updated";
    await tick();
    check(ranges()[0].toString() === "https://example.test/updated", "character-data rich update");
    rich.blur();
    lines.push("HTML-редактор: OK (живые диапазоны, курсор, Ctrl+щелчок)");
    results.textContent = lines.join("\n") + "\nВсе проверки пройдены.";
    results.dataset.status = "passed";
  } catch (error) {
    results.textContent = lines.join("\n") + "\nОШИБКА: " + error.message;
    results.dataset.status = "failed";
  }
}

function fixture() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Живая подсветка ссылок</title>
    <link rel="stylesheet" href="/styles.css"><style>
    body{display:block;margin:16px;font:14px 'Segoe UI',sans-serif}main{max-width:1000px}#results{white-space:pre-wrap;padding:12px;background:#eef8f6}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.field-case{min-width:0;position:relative;display:block}
    .field-case input{width:100%;height:34px;padding:4px 8px;font:14px 'Segoe UI',sans-serif}.field-case textarea{width:100%;height:125px;padding:7px;font:13px/1.35 'Segoe UI',sans-serif}
    fieldset{min-width:0}#rich-editor{min-height:85px;padding:8px;border:1px solid #aaa;white-space:pre-wrap;background:white}
    </style></head><body><main><h1>Живая подсветка ссылок</h1><pre id="results">Проверяется…</pre><div class="grid">
    ${["text", "search", "email", "url", "tel"].map(type => `<label class="field-case">Поле ${type}<input type="${type}" data-test-native aria-label="${type}" autocomplete="off" spellcheck="false"></label>`).join("")}
    <label class="field-case">Пароль — без подсветки<input id="password-field" type="password" value="https://secret.test"></label>
    <div class="field-case"><fieldset><legend>Сообщение о доступе к порталу</legend><textarea id="portal-message" data-test-native aria-label="Сообщение о доступе" spellcheck="false"></textarea></fieldset></div>
    <div class="field-case"><label style="display:contents">Примечания<textarea data-test-native aria-label="Примечания" spellcheck="false"></textarea></label></div>
    </div><h2>Редактор шаблона / формулы</h2><div id="rich-editor" contenteditable="true" role="textbox" aria-label="Редактор шаблона" spellcheck="false"></div>
    <button id="run-checks" type="button">Повторить проверки</button></main><script src="/field-html-links.js"></script>
    <script>const run = ${runBrowserChecks.toString()}; document.getElementById('run-checks').addEventListener('click', run); window.addEventListener('load', run);</script></body></html>`;
}

if (process.argv.includes("--serve")) {
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const file = request.url.split("?")[0].slice(1);
    if (["field-html-links.js", "styles.css"].includes(file)) {
      response.setHeader("Content-Type", file.endsWith("css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
      response.end(fs.readFileSync(path.join(root, file)));
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(fixture());
  });
  server.listen(0, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${server.address().port}/`));
} else {
  new (require("node:vm").Script)(`const run = ${runBrowserChecks.toString()};`);
  console.log("Live link browser fixture syntax: OK (use --serve for browser checks)");
}
