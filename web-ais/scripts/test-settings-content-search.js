"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Не найдена функция ${name}`);
  const bodyStart = appSource.indexOf(") {", start) + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1).replace(/^  /gmu, "");
    }
  }
  throw new Error(`Функция ${name} не завершена`);
}

const context = { Set, WeakSet, Array, Object, String };
vm.createContext(context);
vm.runInContext(
  `${extractFunction("collectDictionarySearchValues")}
   ${extractFunction("normalizeDictionarySearchText")}
   ${extractFunction("getDictionarySearchTerms")}
   this.collectValues = collectDictionarySearchValues;
   this.normalizeText = normalizeDictionarySearchText;
   this.getTerms = getDictionarySearchTerms;`,
  context
);

const nested = {
  label: "Назначение агентов",
  tabs: [
    { title: "Ставки", values: [{ marker: "АвторскаяСтавка", value: 50 }] },
    { title: "Агенты", values: ["Вконтакте=Симак Варвара Романовна"] }
  ]
};
const flattened = context.normalizeText(context.collectValues(nested).join("\n"));
assert.match(flattened, /назначение агентов/u);
assert.match(flattened, /авторскаяставка/u);
assert.match(flattened, /симак варвара романовна/u);
assert.deepEqual(Array.from(context.getTerms("  Ставка   Варвара ставка  ")), ["ставка", "варвара"]);
assert.ok(["ставка", "варвара"].every((term) => flattened.includes(term)));

assert.match(appSource, /getDictionarySearchSupplementValues[\s\S]*employeeCommunicationTemplates/u);
assert.match(appSource, /visibleItems = dictionaryItems\.filter\(\(item\) => dictionaryMatchesSearch\(item, searchTerms\)\)/u);
assert.match(appSource, /revealDictionarySearchTabMatches[\s\S]*switchPaymentSettingsTab/u);
assert.match(appSource, /applyDictionarySearchHighlights\(\);/u);
assert.match(appSource, /placeholder="Поиск по настройкам"/u);
assert.match(stylesSource, /\.settings-search-highlight\s*\{[^}]*background:\s*#ffe66f/su);
assert.match(stylesSource, /\.dictionary-detail \.settings-search-control-match\s*\{[^}]*background-color:\s*#fff6b8/su);

console.log("Settings content search checks: OK");
