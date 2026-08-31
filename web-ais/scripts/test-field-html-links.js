const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const linkSource = fs.readFileSync(path.join(root, "field-html-links.js"), "utf8").replace(/\r\n?/gu, "\n");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8").replace(/\r\n?/gu, "\n");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/\r\n?/gu, "\n");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8").replace(/\r\n?/gu, "\n");
const partnerSource = fs.readFileSync(path.join(root, "partner-app.js"), "utf8").replace(/\r\n?/gu, "\n");
const deploySource = fs.readFileSync(path.join(root, "scripts", "deploy-lms.ps1"), "utf8").replace(/\r\n?/gu, "\n");

class MockClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.add(name);
    else this.remove(name);
    return enabled;
  }
}

class MockHost {
  constructor() {
    this.children = [];
    this.classList = new MockClassList();
    this.display = "block";
    this.parentElement = null;
    this.clientLeft = 0;
    this.clientTop = 0;
    this.scrollLeft = 0;
    this.scrollTop = 0;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 320, height: 80 };
  }

  querySelector(selector) {
    if (selector !== "[data-native-html-link-highlight]") return null;
    return this.children.find((child) => Object.hasOwn(child.dataset || {}, "nativeHtmlLinkHighlight")) || null;
  }
}

const mockFields = [];

class MockField {
  constructor(value = "", type = "text") {
    mockFields.push(this);
    this.value = value;
    this.type = type;
    this.selectionStart = 0;
    this.tagName = "INPUT";
    this.nodeType = 1;
    this.parentElement = null;
    this.isConnected = true;
    this.classList = new MockClassList();
    this.dataset = {};
    this.clientWidth = 300;
    this.top = 10;
    this.scrollLeft = 0;
    this.scrollTop = 0;
  }

  getBoundingClientRect() {
    return { left: 10, top: this.top, width: 300, height: 38 };
  }

  querySelectorAll() {
    return [];
  }

  removeAttribute(name) {
    if (name === "data-native-html-link-field") delete this.dataset.nativeHtmlLinkField;
  }

  matches(selector) {
    return selector === "[data-native-html-link-field]"
      && Object.hasOwn(this.dataset, "nativeHtmlLinkField");
  }
}

class MockInput extends MockField {}

class MockTextarea extends MockField {
  constructor(value = "") {
    super(value, "textarea");
    this.tagName = "TEXTAREA";
  }
}

class MockOverlay {
  constructor() {
    this.dataset = {};
    this.style = {};
    this.classList = new MockClassList();
    this.parentElement = null;
    this.hidden = false;
    this.content = { style: {} };
  }

  setAttribute() {}

  set innerHTML(value) {
    this.html = value;
    this.content = { style: {} };
  }

  get innerHTML() {
    return this.html || "";
  }

  querySelector(selector) {
    return selector === ".native-html-link-highlight-content" ? this.content : null;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}

const documentListeners = new Map();
const opened = [];
const resizeObservers = [];
const mutationObservers = [];
const animationFrames = [];
const document = {
  body: {
    appendChild(element) {
      element.parentElement = this;
    }
  },
  querySelectorAll(selector) {
    if (selector === "[data-native-html-link-field]") {
      return mockFields.filter((field) => Object.hasOwn(field.dataset, "nativeHtmlLinkField"));
    }
    return [];
  },
  addEventListener(name, listener, capture) {
    documentListeners.set(name, { listener, capture });
  },
  createElement(tagName) {
    if (tagName === "div") return new MockOverlay();
    assert.equal(tagName, "a");
    return {
      href: "",
      target: "",
      rel: "",
      click() {
        opened.push({ href: this.href, target: this.target, rel: this.rel });
      },
      remove() {}
    };
  }
};

const defaultFieldStyle = {
  boxSizing: "border-box",
  paddingTop: "7px",
  paddingRight: "9px",
  paddingBottom: "7px",
  paddingLeft: "9px",
  borderTopWidth: "1px",
  borderRightWidth: "1px",
  borderBottomWidth: "1px",
  borderLeftWidth: "1px",
  borderTopStyle: "solid",
  borderRightStyle: "solid",
  borderBottomStyle: "solid",
  borderLeftStyle: "solid",
  borderRadius: "4px",
  fontFamily: "Arial",
  fontSize: "14px",
  fontStyle: "normal",
  fontWeight: "400",
  lineHeight: "20px",
  letterSpacing: "normal",
  color: "rgb(1, 2, 3)",
  webkitTextFillColor: "rgb(1, 2, 3)",
  opacity: "1",
  textAlign: "left",
  textIndent: "0px",
  textShadow: "none",
  textTransform: "none",
  direction: "ltr",
  tabSize: "8"
};

const window = {
  HTMLInputElement: MockInput,
  HTMLTextAreaElement: MockTextarea,
  AISFieldHtmlLinks: null,
  getComputedStyle(element) {
    if (element instanceof MockHost) {
      return { position: "static", display: element.display, color: defaultFieldStyle.color };
    }
    return {
      ...defaultFieldStyle,
      get color() {
        return element.forceTransparentColor || element.classList.contains("has-native-html-links")
          ? "rgba(0, 0, 0, 0)"
          : defaultFieldStyle.color;
      }
    };
  },
  addEventListener() {},
  requestAnimationFrame(callback) {
    animationFrames.push(callback);
    return animationFrames.length;
  },
  ResizeObserver: class {
    constructor(callback) {
      this.callback = callback;
      this.observed = new Set();
      resizeObservers.push(this);
    }

    observe(element) {
      this.observed.add(element);
    }

    unobserve(element) {
      this.observed.delete(element);
    }
  },
  MutationObserver: class {
    constructor(callback) {
      this.callback = callback;
      mutationObservers.push(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
    }
  }
};

function flushAnimationFrames() {
  while (animationFrames.length) animationFrames.shift()();
}

const context = { URL, document, window };
vm.createContext(context);
vm.runInContext(linkSource, context);

const api = window.AISFieldHtmlLinks;
assert.ok(Object.isFrozen(api));
assert.equal(typeof api.bind, "function");
assert.equal(documentListeners.get("click").capture, true);
assert.equal(documentListeners.get("input").capture, true);
assert.equal(documentListeners.get("scroll").capture, true);
assert.equal(mutationObservers.length, 1);
assert.deepEqual(
  JSON.parse(JSON.stringify(mutationObservers[0].options)),
  { childList: true, subtree: true }
);

const firstUrl = "https://example.test/a?x=1&y=2";
const secondUrl = "https://two.test/b";
const source = "См. (" + firstUrl + "), затем " + secondUrl + "!";
const matches = JSON.parse(JSON.stringify(api.getMatches(source)));
assert.equal(matches.length, 2);
assert.equal(matches[0].url, firstUrl);
assert.equal(matches[0].start, source.indexOf(firstUrl));
assert.equal(matches[0].end, source.indexOf(firstUrl) + firstUrl.length);
assert.equal(matches[1].url, secondUrl);
assert.equal(api.getAtPosition(source, matches[0].start).url, firstUrl);
assert.equal(api.getAtPosition(source, matches[0].end).url, firstUrl);
assert.equal(api.getAtPosition(source, matches[0].end + 1), null);
assert.equal(api.getAtPosition(source, source.indexOf("затем")), null);

const balancedUrl = "https://example.test/wiki/Foo_(bar)";
assert.equal(api.getMatches("(" + balancedUrl + ").")[0].url, balancedUrl);
assert.equal(api.getMatches("https://example.test/x]")[0].url, "https://example.test/x");
assert.equal(api.getMatches("«https://example.test/path»")[0].url, "https://example.test/path");
assert.equal(api.getMatches("„https://example.test/path“")[0].url, "https://example.test/path");
assert.equal(api.getMatches("xhttps://ignored.test").length, 0);
assert.equal(api.getMatches("Некорректный адрес https://").length, 0);
assert.equal(api.getMatches("javascript:alert(1) data:text/html,x mailto:x@y.test").length, 0);

const rendered = api.renderLinks("<b>" + firstUrl + "), & " + secondUrl + "!</b>");
assert.match(rendered, /&lt;b&gt;/u);
assert.match(rendered, /data-template-external-url="https:\/\/example\.test\/a\?x=1&amp;y=2"/u);
assert.match(rendered, />https:\/\/example\.test\/a\?x=1&amp;y=2<\/span>\),/u);
assert.match(rendered, />https:\/\/two\.test\/b<\/span>!&lt;\/b&gt;/u);

function createClickEvent(target, options = {}) {
  const calls = { preventDefault: 0, stopImmediatePropagation: 0, stopPropagation: 0 };
  return {
    calls,
    event: {
      target,
      ctrlKey: options.ctrlKey === true,
      metaKey: options.metaKey === true,
      button: options.button ?? 0,
      defaultPrevented: options.defaultPrevented === true,
      preventDefault() { calls.preventDefault += 1; },
      stopImmediatePropagation() { calls.stopImmediatePropagation += 1; },
      stopPropagation() { calls.stopPropagation += 1; }
    }
  };
}

const click = documentListeners.get("click").listener;
const ordinaryField = new MockInput(source);
ordinaryField.selectionStart = matches[0].start + 3;
const ordinary = createClickEvent(ordinaryField);
click(ordinary.event);
assert.equal(opened.length, 0);
assert.equal(ordinary.calls.preventDefault, 0);

const betweenField = new MockInput(source);
betweenField.selectionStart = source.indexOf("затем");
const between = createClickEvent(betweenField, { ctrlKey: true });
click(between.event);
assert.equal(opened.length, 0);

const linkedHost = new MockHost();
const linkedField = new MockInput(source);
linkedField.parentElement = linkedHost;
linkedField.selectionStart = matches[1].start + 4;
const onSecond = createClickEvent(linkedField, { ctrlKey: true });
click(onSecond.event);
assert.equal(opened.length, 1);
assert.equal(opened[0].href, secondUrl);
assert.equal(opened[0].target, "_blank");
assert.match(opened[0].rel, /noopener/u);
assert.equal(onSecond.calls.preventDefault, 1);
assert.equal(onSecond.calls.stopImmediatePropagation, 1);
assert.equal(onSecond.calls.stopPropagation, 1);
assert.equal(linkedField.classList.contains("has-native-html-links"), true);
assert.equal(linkedHost.classList.contains("native-html-link-field-host"), true);
assert.match(linkedHost.children[0].innerHTML, /native-html-link-highlight-content/u);
assert.match(linkedHost.children[0].innerHTML, /communication-template-html-link/u);
assert.equal(linkedHost.children[0].style.color, defaultFieldStyle.color);
assert.equal(linkedHost.children[0].style.webkitTextFillColor, defaultFieldStyle.color);
assert.equal(resizeObservers[0].observed.has(linkedField), true);

const transparentFallbackHost = new MockHost();
const transparentFallbackField = new MockTextarea("Текст " + firstUrl + " хвост");
transparentFallbackField.forceTransparentColor = true;
transparentFallbackField.parentElement = transparentFallbackHost;
documentListeners.get("input").listener({ target: transparentFallbackField });
assert.equal(transparentFallbackHost.children[0].style.color, defaultFieldStyle.color);
assert.equal(transparentFallbackHost.children[0].style.webkitTextFillColor, defaultFieldStyle.color);
assert.match(transparentFallbackHost.children[0].innerHTML, /^<span[^>]*>Текст /u);
assert.match(transparentFallbackHost.children[0].innerHTML, / хвост<\/span>$/u);

linkedField.value = "Ссылка удалена";
documentListeners.get("input").listener({ target: linkedField });
assert.equal(linkedField.classList.contains("has-native-html-links"), false);
assert.equal(linkedHost.children.length, 0);
assert.equal(resizeObservers[0].observed.has(linkedField), false);

const dynamicHost = new MockHost();
const dynamicField = new MockTextarea("Текст " + firstUrl);
dynamicField.parentElement = dynamicHost;
mutationObservers[0].callback([{
  removedNodes: [],
  addedNodes: [dynamicField]
}]);
assert.equal(dynamicField.classList.contains("has-native-html-links"), true);
assert.equal(dynamicHost.children[0].classList.contains("is-textarea"), true);
mutationObservers[0].callback([{
  removedNodes: [dynamicField],
  addedNodes: []
}]);
assert.equal(dynamicHost.children.length, 0);

const outerHost = new MockHost();
const contentsHost = new MockHost();
contentsHost.display = "contents";
contentsHost.parentElement = outerHost;
const contentsField = new MockInput(firstUrl);
contentsField.parentElement = contentsHost;
documentListeners.get("input").listener({ target: contentsField });
assert.equal(contentsHost.children.length, 0);
assert.equal(outerHost.children.length, 1);
assert.equal(outerHost.classList.contains("native-html-link-field-host"), true);
contentsField.top = 64;
mutationObservers[0].callback([{
  removedNodes: [new MockHost()],
  addedNodes: []
}]);
flushAnimationFrames();
assert.equal(outerHost.children[0].style.top, "64px");

const middleField = new MockInput(firstUrl);
middleField.selectionStart = 5;
click(createClickEvent(middleField, { ctrlKey: true, button: 1 }).event);
assert.equal(opened.length, 1);

const unsafeField = new MockInput("javascript:alert(1)");
unsafeField.selectionStart = 5;
click(createClickEvent(unsafeField, { ctrlKey: true }).event);
assert.equal(opened.length, 1);

const numberField = new MockInput(firstUrl, "number");
numberField.selectionStart = 5;
click(createClickEvent(numberField, { ctrlKey: true }).event);
assert.equal(opened.length, 1);

const renderedLinkClick = createClickEvent({
  textContent: secondUrl,
  closest(selector) {
    assert.equal(selector, "[data-template-external-url]");
    return { dataset: { templateExternalUrl: firstUrl }, textContent: this.textContent };
  }
}, { metaKey: true });
click(renderedLinkClick.event);
assert.equal(opened.length, 2);
assert.equal(opened[1].href, secondUrl);
assert.equal(renderedLinkClick.calls.preventDefault, 1);

const invalidEditedLinkClick = createClickEvent({
  textContent: "ссылка редактируется",
  closest() {
    return { dataset: { templateExternalUrl: firstUrl }, textContent: this.textContent };
  }
}, { ctrlKey: true });
click(invalidEditedLinkClick.event);
assert.equal(opened.length, 2);
assert.equal(invalidEditedLinkClick.calls.preventDefault, 1);
assert.equal(invalidEditedLinkClick.calls.stopImmediatePropagation, 1);

assert.match(linkSource, /querySelectorAll\?\.\("input, textarea"\)/u);
assert.match(linkSource, /\["text", "search", "email", "url", "tel"\]/u);
assert.match(linkSource, /entry\.removedNodes\.forEach\(cleanupFields\)/u);
assert.match(linkSource, /entry\.addedNodes\.forEach/u);
assert.match(linkSource, /scheduleFieldLayoutSync\(\)/u);
assert.match(linkSource, /getComputedStyle\(host\)\.display === "contents"/u);
assert.match(linkSource, /event\.stopImmediatePropagation/u);
assert.match(linkSource, /rel = "noopener noreferrer"/u);
assert.match(appSource, /return window\.AISFieldHtmlLinks\?\.renderLinks\(value\) \|\| escapeHtml\(value\);/u);
assert.doesNotMatch(appSource, /bindNativeHtmlLinkFields|nativeHtmlLinkFieldOverlays/u);
assert.match(appSource, /function renderProtectedPathEditorContent[\s\S]*?AISFieldHtmlLinks\?\.renderLinks\(part\)/u);
assert.match(appSource, /function renderDataFormulaEditorContent[\s\S]*?AISFieldHtmlLinks\?\.renderLinks\(part\)[\s\S]*?renderedPart\.replace/u);
assert.match(appSource, /function renderCommunicationTemplateFormulaEditorContent[\s\S]*?AISFieldHtmlLinks\?\.renderLinks\(part\)/u);
assert.match(appSource, /function renderAutomaticExpenseRuleFormula[\s\S]*?if \(!match\) return globalThis\.window\?\.AISFieldHtmlLinks\?\.renderLinks\(part\)/u);
assert.match(appSource, /const renderedToken = \["comment", "string"\]\.includes\(tone\)[\s\S]*?AISFieldHtmlLinks\?\.renderLinks\(token\)/u);
assert.match(appSource, /function renderPaymentFormulaEditorContent[\s\S]*?AISFieldHtmlLinks\?\.getMatches\(source\)[\s\S]*?AISFieldHtmlLinks\?\.renderLinks\(link\.url\)/u);
assert.match(partnerSource, /window\.AISFieldHtmlLinks\?\.renderLinks\(content\)/u);

assert.match(stylesSource, /\.native-html-link-field-host\s*\{[\s\S]*?position:\s*relative/u);
assert.match(stylesSource, /\.native-html-link-highlight\s*\{[\s\S]*?position:\s*absolute/u);
assert.match(stylesSource, /\.native-html-link-highlight\s*\{[\s\S]*?pointer-events:\s*none/u);
assert.match(stylesSource, /\.has-native-html-links\s*\{[\s\S]*?color:\s*transparent\s*!important/u);
assert.match(stylesSource, /\.has-native-html-links\s*\{[\s\S]*?caret-color:/u);
assert.match(stylesSource, /\.has-native-html-links\s*\{[\s\S]*?text-shadow:\s*none\s*!important/u);
assert.match(stylesSource, /\.native-html-link-highlight \.communication-template-html-link/u);
assert.match(stylesSource, /\.native-html-link-highlight[\s\S]*?-webkit-text-fill-color:\s*currentColor/u);
assert.match(stylesSource, /\.native-html-link-highlight \.communication-template-html-link[\s\S]*?-webkit-text-fill-color:\s*currentColor/u);

const buildToken = "20260831-html-links-visible-text-v2";
assert.ok(indexSource.includes("styles.css?v=" + buildToken));
assert.ok(indexSource.includes('const build = "' + buildToken + '"'));
assert.ok(authSource.includes('const AUTH_BUILD = "' + buildToken + '"'));
assert.match(authSource, /async function initialize\(\) \{\s+renderLoading\("Проверка доступа\.\.\."\);\s+await loadScript\("field-html-links\.js"\);/u);
assert.match(authSource, /if \(user\?\.role === "partner"\) \{\s+await loadScript\("partner-app\.js"\);/u);
assert.equal((deploySource.match(/"field-html-links\.js"/gu) || []).length, 2);
assert.match(
  appSource,
  /version: "1\.7\.374"[\s\S]*?обычный текст больше не становится невидимым/u
);

console.log("field HTML link highlighting checks: OK");
