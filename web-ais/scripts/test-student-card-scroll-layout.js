"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const requestedSource = String(process.env.AIS_TEST_STYLES_SOURCE || "").trim();
const stylesPath = requestedSource
  ? path.resolve(process.cwd(), requestedSource)
  : path.resolve(__dirname, "..", "styles.css");
const stylesSource = fs.readFileSync(stylesPath, "utf8");

const DESKTOP_START_MARKER = "/* Student card desktop scroll containment */";
const DESKTOP_END_MARKER = "/* End student card desktop scroll containment */";

function findMatchingBrace(source, openingBraceIndex) {
  assert.equal(source[openingBraceIndex], "{", "Не найдена открывающая фигурная скобка CSS-блока.");
  let depth = 0;
  let quote = "";
  let escaped = false;
  let inComment = false;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || "";
    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("CSS-блок не завершён.");
}

function extractMediaBlocks(source, mediaPattern) {
  const blocks = [];
  const flags = mediaPattern.flags.includes("g") ? mediaPattern.flags : `${mediaPattern.flags}g`;
  const pattern = new RegExp(mediaPattern.source, flags);
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const openingBraceIndex = source.indexOf("{", match.index + match[0].length);
    assert.ok(openingBraceIndex >= 0, `Не найдено тело медиавыражения ${match[0]}.`);
    const closingBraceIndex = findMatchingBrace(source, openingBraceIndex);
    blocks.push({
      header: source.slice(match.index, openingBraceIndex).trim(),
      body: source.slice(openingBraceIndex + 1, closingBraceIndex),
      start: match.index,
      end: closingBraceIndex + 1
    });
    pattern.lastIndex = closingBraceIndex + 1;
  }
  return blocks;
}

function parseFlatRules(source) {
  const rules = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/gu;
  for (const match of source.matchAll(rulePattern)) {
    const selectorText = match[1].replace(/\/\*[\s\S]*?\*\//gu, "").trim();
    if (!selectorText || selectorText.startsWith("@")) continue;
    rules.push({
      selectors: selectorText.split(",").map((selector) => selector.trim()).filter(Boolean),
      body: match[2]
    });
  }
  return rules;
}

function declarationsFor(rules, predicate, label) {
  const declarations = rules
    .filter((rule) => rule.selectors.some(predicate))
    .map((rule) => rule.body)
    .join("\n");
  assert.ok(declarations, `Не найдено CSS-правило для ${label}.`);
  return declarations;
}

function classSelector(className) {
  return (selector) => selector === className
    || selector.endsWith(` ${className}`)
    || selector.startsWith(`${className}:`);
}

function assertDeclaration(declarations, pattern, message) {
  assert.match(declarations, pattern, message);
}

const desktopStart = stylesSource.indexOf(DESKTOP_START_MARKER);
const desktopEnd = stylesSource.indexOf(
  DESKTOP_END_MARKER,
  desktopStart + DESKTOP_START_MARKER.length
);
assert.ok(desktopStart >= 0, "Не найден начальный маркер desktop-блока карточки слушателя.");
assert.ok(desktopEnd > desktopStart, "Конечный маркер desktop-блока расположен неверно.");
const baseStickyTabsRuleIndex = stylesSource.indexOf(
  ".student-modal .student-tabs[data-student-tabs],"
);
assert.ok(baseStickyTabsRuleIndex >= 0, "Не найдено базовое sticky-правило вкладок карточки.");
assert.ok(
  desktopStart > baseStickyTabsRuleIndex,
  "Desktop-отмена sticky-смещения должна находиться после базового правила, чтобы иметь приоритет в каскаде."
);
const markedDesktopSource = stylesSource.slice(
  desktopStart + DESKTOP_START_MARKER.length,
  desktopEnd
);
const desktopMediaBlocks = extractMediaBlocks(
  markedDesktopSource,
  /@media\s*\(\s*min-width\s*:\s*721px\s*\)/u
);
assert.equal(
  desktopMediaBlocks.length,
  1,
  "Между контрольными комментариями должен находиться один @media (min-width: 721px)."
);
const desktopMedia = desktopMediaBlocks[0];
const outsideDesktopMedia = `${markedDesktopSource.slice(0, desktopMedia.start)}${markedDesktopSource.slice(desktopMedia.end)}`;
assert.equal(
  outsideDesktopMedia.trim(),
  "",
  "Все desktop-правила между контрольными комментариями должны находиться внутри медиавыражения."
);
const desktopSource = desktopMedia.body;
const desktopRules = parseFlatRules(desktopSource);

const modalDeclarations = declarationsFor(
  desktopRules,
  (selector) => /^\.student-modal(?::not\([^)]*\))*$/u.test(selector),
  "внешней карточки слушателя"
);
assertDeclaration(
  modalDeclarations,
  /(?:^|;)\s*height\s*:\s*(?!auto\b|initial\b|inherit\b|unset\b)[^;]+/u,
  "Desktop-карточка должна иметь ограниченную высоту."
);
assertDeclaration(
  modalDeclarations,
  /(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/u,
  "Внешняя desktop-карточка не должна создавать второй scrollbar."
);

const formDeclarations = declarationsFor(
  desktopRules,
  (selector) => /^\.student-modal(?::not\([^)]*\))*\s*>\s*form$/u.test(selector),
  "формы карточки слушателя"
);
assertDeclaration(formDeclarations, /(?:^|;)\s*display\s*:\s*grid\s*(?:;|$)/u);
assertDeclaration(
  formDeclarations,
  /(?:^|;)\s*grid-template-rows\s*:\s*auto\s+minmax\(\s*0\s*,\s*1fr\s*\)\s*(?:;|$)/u,
  "Форма должна отдавать оставшуюся высоту содержимому карточки."
);
assertDeclaration(formDeclarations, /(?:^|;)\s*min-height\s*:\s*0\s*(?:;|$)/u);
assertDeclaration(formDeclarations, /(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/u);
assert.match(
  desktopSource,
  /\.student-modal\s*>\s*form\[data-record-lock-lost="true"\]\s*\{[\s\S]*?grid-template-rows\s*:\s*auto\s+auto\s+minmax\(\s*0\s*,\s*1fr\s*\)/u,
  "При потере блокировки предупреждение должно получать отдельную строку и не сжимать содержимое карточки."
);
assert.match(
  stylesSource,
  /\.record-lock-warning\s*\{[\s\S]*?min-height\s*:\s*48px[\s\S]*?flex-wrap\s*:\s*wrap/u,
  "Предупреждение о блокировке должно вмещать кнопку по высоте и переносить элементы."
);

const layoutDeclarations = declarationsFor(desktopRules, classSelector(".student-card-layout"), "student-card-layout");
assertDeclaration(layoutDeclarations, /(?:^|;)\s*min-height\s*:\s*0\s*(?:;|$)/u);
assertDeclaration(layoutDeclarations, /(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/u);

const mainDeclarations = declarationsFor(desktopRules, classSelector(".student-card-main"), "student-card-main");
assertDeclaration(mainDeclarations, /(?:^|;)\s*min-height\s*:\s*0\s*(?:;|$)/u);
assertDeclaration(mainDeclarations, /(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/u);

const tabsDeclarations = declarationsFor(
  desktopRules,
  (selector) => selector === ".student-modal .student-tabs[data-student-tabs]",
  "строки вкладок карточки слушателя"
);
assertDeclaration(
  tabsDeclarations,
  /(?:^|;)\s*position\s*:\s*static\s*(?:;|$)/u,
  "При отдельной прокрутке содержимого вкладки сама строка не должна получать sticky-смещение повторно."
);
assertDeclaration(
  tabsDeclarations,
  /(?:^|;)\s*top\s*:\s*auto\s*(?:;|$)/u,
  "Строка вкладок уже расположена ниже заголовка и не должна дополнительно сдвигаться на его высоту."
);

const sideDeclarations = declarationsFor(desktopRules, classSelector(".student-side-panel"), "student-side-panel");
assertDeclaration(sideDeclarations, /(?:^|;)\s*min-height\s*:\s*0\s*(?:;|$)/u);
assertDeclaration(sideDeclarations, /(?:^|;)\s*display\s*:\s*grid\s*(?:;|$)/u);
assertDeclaration(
  sideDeclarations,
  /(?:^|;)\s*grid-template-rows\s*:\s*auto\s+minmax\(\s*0\s*,\s*1fr\s*\)\s*(?:;|$)/u
);
assertDeclaration(sideDeclarations, /(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/u);

const contentDeclarations = declarationsFor(
  desktopRules,
  classSelector(".student-side-panel-content"),
  "student-side-panel-content"
);
assertDeclaration(contentDeclarations, /(?:^|;)\s*min-height\s*:\s*0\s*(?:;|$)/u);
assertDeclaration(
  contentDeclarations,
  /(?:^|;)\s*grid-template-rows\s*:\s*auto\s+minmax\(\s*0\s*,\s*1fr\s*\)\s*(?:;|$)/u
);
assertDeclaration(contentDeclarations, /(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/u);

const eventsDeclarations = declarationsFor(desktopRules, classSelector(".student-events-block"), "student-events-block");
assertDeclaration(eventsDeclarations, /(?:^|;)\s*min-height\s*:\s*0\s*(?:;|$)/u);
assertDeclaration(
  eventsDeclarations,
  /(?:^|;)\s*grid-template-rows\s*:\s*auto\s+auto\s+minmax\(\s*0\s*,\s*1fr\s*\)(?:\s+auto)?\s*(?:;|$)/u
);
assertDeclaration(eventsDeclarations, /(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/u);

const tabBodyDeclarations = declarationsFor(desktopRules, classSelector(".student-tab-body"), "student-tab-body");
assertDeclaration(tabBodyDeclarations, /(?:^|;)\s*min-height\s*:\s*0\s*(?:;|$)/u);
assertDeclaration(tabBodyDeclarations, /(?:^|;)\s*overflow-y\s*:\s*auto\s*(?:;|$)/u);

const eventListDeclarations = declarationsFor(desktopRules, classSelector(".student-events-list"), "student-events-list");
assertDeclaration(eventListDeclarations, /(?:^|;)\s*height\s*:\s*auto\s*(?:;|$)/u);
assertDeclaration(eventListDeclarations, /(?:^|;)\s*min-height\s*:\s*0\s*(?:;|$)/u);
assertDeclaration(eventListDeclarations, /(?:^|;)\s*max-height\s*:\s*none\s*(?:;|$)/u);
assertDeclaration(eventListDeclarations, /(?:^|;)\s*overflow-y\s*:\s*auto\s*(?:;|$)/u);

assert.doesNotMatch(
  desktopSource,
  /overflow-y\s*:\s*scroll\b/u,
  "Desktop-блок не должен принудительно показывать вертикальный scrollbar."
);
assert.doesNotMatch(
  desktopSource,
  /scrollbar-gutter\s*:\s*stable\b/u,
  "Desktop-блок не должен резервировать место под отсутствующий scrollbar."
);

const mobileMediaBlocks = extractMediaBlocks(
  stylesSource,
  /@media\s*\(\s*max-width\s*:\s*720px\s*\)/u
);
const mobileMedia = mobileMediaBlocks.find((block) => (
  block.body.includes(".student-modal") && block.body.includes(".student-events-list")
));
assert.ok(mobileMedia, "Не найден мобильный блок прокрутки карточки слушателя.");
const mobileRules = parseFlatRules(mobileMedia.body);

const mobileModalDeclarations = declarationsFor(
  mobileRules,
  (selector) => selector === ".student-modal",
  "мобильной student-modal"
);
assertDeclaration(
  mobileModalDeclarations,
  /(?:^|;)\s*overflow-y\s*:\s*auto\s*(?:;|$)/u,
  "На мобильном экране внешняя карточка должна оставаться прокручиваемой."
);

const mobileEventListDeclarations = declarationsFor(
  mobileRules,
  (selector) => selector === ".student-events-list",
  "мобильного списка событий"
);
assertDeclaration(
  mobileEventListDeclarations,
  /(?:^|;)\s*height\s*:\s*(?!auto\b)[^;]+/u,
  "Мобильный список событий должен сохранять ограниченную высоту."
);
assertDeclaration(
  mobileEventListDeclarations,
  /(?:^|;)\s*max-height\s*:\s*(?!none\b)[^;]+/u,
  "Мобильный список событий должен иметь конечную максимальную высоту."
);
assertDeclaration(mobileEventListDeclarations, /(?:^|;)\s*overflow-y\s*:\s*auto\s*(?:;|$)/u);
assert.match(
  mobileMedia.body,
  /\.record-lock-warning\s+\.ghost-button\s*\{[\s\S]*?width\s*:\s*100%/u,
  "На мобильном экране кнопка перехвата блокировки должна занимать отдельную строку."
);

console.log("Student card scroll layout tests passed.");
