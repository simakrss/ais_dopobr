const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readSource = (name) => fs.readFileSync(path.join(root, name), "utf8")
  .replace(/\r\n?/gu, "\n");
const appSource = readSource("app.js");
const stylesSource = readSource("styles.css");
const authSource = readSource("auth-bootstrap.js");
const indexSource = readSource("index.html");

function functionBlocks(source) {
  return [...source.matchAll(
    /^  (?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]*?^  \}/gmu
  )].map((match) => ({ name: match[1], source: match[0] }));
}

function namedFunction(blocks, name) {
  const block = blocks.find((item) => item.name === name);
  assert.ok(block, `Не найдена функция ${name}().`);
  return block.source;
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}.`);
  return source.slice(start, end);
}

const blocks = functionBlocks(appSource);
const advertisingState = sourceSlice(
  appSource,
  "    advertising: {",
  "    financeDetails: {"
);
assert.match(advertisingState, /resultLoading:\s*false/u);
assert.match(advertisingState, /resultLoaded:\s*false/u);
assert.match(
  advertisingState,
  /sourcePickerExpanded:\s*false/u,
  "Список источников должен быть свёрнут при первом открытии сборщика."
);
assert.match(
  advertisingState,
  /history:\s*\{[\s\S]*?rows:\s*\[\][\s\S]*?loaded:\s*false[\s\S]*?loading:\s*false[\s\S]*?error:\s*["']["'][\s\S]*?copyingRunId:\s*["']["'][\s\S]*?\}/u,
  "Для таблицы рекламных запросов требуется отдельное состояние загрузки и копирования."
);

const advertisingViewEntry = sourceSlice(
  appSource,
  '    if (state.view === "advertising") {',
  "  function fitMainRegistryTablesToViewport"
);
assert.match(
  advertisingViewEntry,
  /!state\.advertising\.resultLoaded\s*&&\s*!state\.advertising\.resultLoading/u
);
assert.match(
  advertisingViewEntry,
  /queueMicrotask\(\(\)\s*=>\s*loadAdvertising[A-Za-z0-9_$]*Result\(\)\)/u
);
assert.match(
  advertisingViewEntry,
  /!state\.advertising\.history\.loaded\s*&&\s*!state\.advertising\.history\.loading[\s\S]*?queueMicrotask\(\(\)\s*=>\s*loadAdvertisingEmailHistory\(\)\)/u,
  "История рекламных запросов должна загружаться отдельно при открытии раздела."
);
assert.doesNotMatch(
  advertisingViewEntry,
  /queueMicrotask\(\(\)\s*=>\s*collectAdvertisingEmails\(\)\)/u,
  "Открытие раздела не должно автоматически запускать новый POST-поиск."
);

const collectorPath = "/api/advertising/email-collector/collect";
const savedResultLoader = blocks.find((block) => (
  block.source.includes(collectorPath)
  && /method:\s*["']GET["']/u.test(block.source)
));
assert.ok(savedResultLoader, "Не найден GET-загрузчик сохранённого результата сборщика.");
assert.match(savedResultLoader.source, /advertising\.resultLoading\s*=\s*true/u);
assert.match(savedResultLoader.source, /advertising\.result\s*=\s*payload/u);
assert.match(savedResultLoader.source, /advertising\.resultLoaded\s*=\s*true/u);
assert.match(savedResultLoader.source, /advertising\.resultLoading\s*=\s*false/u);
assert.doesNotMatch(savedResultLoader.source, /method:\s*["']POST["']/u);

const collectFunction = namedFunction(blocks, "collectAdvertisingEmails");
assert.match(collectFunction, /method:\s*["']POST["']/u);
assert.match(collectFunction, /advertising\.result\s*=\s*payload/u);
assert.match(collectFunction, /advertising\.resultLoaded\s*=\s*true/u);
assert.match(
  collectFunction,
  /(?:await\s+|queueMicrotask\(\(\)\s*=>\s*)loadAdvertisingEmailHistory\(\{\s*force:\s*true\s*\}\)\)?/u,
  "После успешного POST-поиска таблица запросов должна принудительно обновляться."
);
assert.doesNotMatch(
  collectFunction,
  /localStorage|saveState\s*\(|requestSharedApplicationState|\/api\/shared-state/u,
  "POST /collect уже сохраняет результат на сервере; клиент не должен дублировать запись."
);

const filterFunction = namedFunction(blocks, "getAdvertisingFilteredRows");
assert.match(
  filterFunction,
  /requestedStatus\s*===\s*["']new["'][^\n]*!row\.isNew[^\n]*row\.excluded/u
);
assert.match(filterFunction, /const query\s*=\s*String\(filters\.query/u);
assert.match(filterFunction, /const sourceId\s*=\s*String\(filters\.source/u);
assert.match(filterFunction, /Array\.isArray\(options\.rows\)/u);
assert.match(filterFunction, /if \(options\.sort === false\) return filtered/u);

const clipboardFunction = namedFunction(blocks, "getAdvertisingClipboardEmails");
assert.match(clipboardFunction, /new Set/u, "Email для буфера должны дедублироваться.");
assert.match(clipboardFunction, /toLocaleLowerCase\(["']en-US["']\)/u);
assert.match(clipboardFunction, /\.filter\(Boolean\)/u);

const renderFunction = namedFunction(blocks, "renderAdvertising");
assert.match(renderFunction, /summary\.newUnique/u);
assert.match(renderFunction, /summary\.newReady/u);
assert.match(renderFunction, /<span>Новые<\/span>/u);
assert.match(renderFunction, /<option value="new"[^>]*>Новые готовые<\/option>/u);
assert.match(
  renderFunction,
  /getAdvertisingFilteredRows\(\{\s*status:\s*"all",\s*sort:\s*false\s*\}\)/u,
  "Большой сохранённый снимок не должен сортироваться отдельно для каждого счётчика."
);

const sourcePickerToggle = /<button\b[^>]*data-action="toggle-advertising-source-picker"[^>]*>[\s\S]*?<\/button>/u
  .exec(renderFunction)?.[0] || "";
assert.ok(sourcePickerToggle, "Не найдена кнопка раскрытия источников.");
assert.match(
  sourcePickerToggle,
  /aria-expanded="\$\{(?:advertising\.)?sourcePickerExpanded\s*\?\s*"true"\s*:\s*"false"\}"/u,
  "aria-expanded должна отражать фактическое состояние блока источников."
);
const sourcePickerControlsId = /aria-controls="([^"]+)"/u.exec(sourcePickerToggle)?.[1] || "";
assert.ok(sourcePickerControlsId, "Кнопка источников должна содержать aria-controls.");
const escapedSourcePickerControlsId = sourcePickerControlsId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const sourcePickerRegion = new RegExp(
  `<(?:div|section)\\b[^>]*id="${escapedSourcePickerControlsId}"[^>]*>`,
  "u"
).exec(renderFunction)?.[0] || "";
assert.ok(sourcePickerRegion, "aria-controls должен ссылаться на существующий контейнер источников.");
assert.match(sourcePickerRegion, /role="region"/u);
assert.match(
  sourcePickerRegion,
  /\$\{(?:advertising\.)?sourcePickerExpanded\s*\?\s*""\s*:\s*"hidden"\}/u,
  "Свёрнутый контейнер источников должен получать hidden и выпадать из tab-порядка."
);

const renderHistoryFunction = namedFunction(blocks, "renderAdvertisingHistory");
assert.match(
  renderHistoryFunction,
  /<table\b[^>]*class="[^"]*advertising-history-table/u,
  "Нужна отдельная таблица сохранённых рекламных запросов."
);
assert.match(
  renderHistoryFunction,
  /history\.rows[\s\S]*?rows\.map\(\((?:run|row)\)\s*=>/u,
  "Строки таблицы должны строиться из state.advertising.history.rows."
);
const perRunCopyButton = /<button\b[^>]*data-action="copy-advertising-history-(?:new|run)"[^>]*>[\s\S]*?<\/button>/u
  .exec(renderHistoryFunction)?.[0] || "";
assert.ok(perRunCopyButton, "У каждого рекламного запроса нужна кнопка копирования новых адресов.");
assert.match(perRunCopyButton, /data-run-id="\$\{escapeAttr\((?:run|row)\.runId(?:\s*\|\|\s*"")?\)\}"/u);
assert.match(renderHistoryFunction, /summary\.newReady/u);
assert.match(renderHistoryFunction, /history\.copyingRunId/u);
assert.match(perRunCopyButton, /disabled/u);

const copyButton = /<button\b[^>]*data-action="copy-new-advertising-emails"[\s\S]*?<\/button>/u
  .exec(renderFunction)?.[0] || "";
assert.ok(copyButton, "Не найдена кнопка копирования новых контактов.");
assert.match(copyButton, /disabled/u);
assert.match(copyButton, /advertising\.(?:loading|resultLoading)/u);
assert.match(copyButton, /(?:newReady|newRows|summary\.newReady)/u);
assert.match(copyButton, /Копировать новые/u);
assert.match(
  copyButton.replace(/^<button\b[^>]*>/u, ""),
  /\$\{[^}]*?(?:newReady|newRows|summary\.newReady)/u,
  "Текст кнопки должен показывать количество новых готовых контактов."
);

assert.match(renderFunction, /<tr class="\$\{[^}]*row\.isNew[^}]*is-new/u);
assert.match(
  renderFunction,
  /row\.isNew[\s\S]{0,1200}>Новый<\/span>/u,
  "У новой строки должен быть видимый бейдж «Новый»."
);
assert.match(
  stylesSource,
  /(?:\.advertising-email-table[^\n{]*\.is-new|\.advertising-new-badge)/u,
  "Новые строки или их бейдж должны иметь отдельное оформление."
);

const bindFunction = namedFunction(blocks, "bindAdvertisingEvents");
const sourcePickerHandlerStart = bindFunction.indexOf("[data-action='toggle-advertising-source-picker']");
assert.ok(sourcePickerHandlerStart >= 0, "Не найден обработчик раскрытия источников.");
const sourcePickerHandlerEnd = bindFunction.indexOf(
  "[data-action='collect-advertising-emails']",
  sourcePickerHandlerStart + 1
);
assert.ok(sourcePickerHandlerEnd > sourcePickerHandlerStart, "Не найден конец обработчика раскрытия источников.");
const sourcePickerHandler = bindFunction.slice(sourcePickerHandlerStart, sourcePickerHandlerEnd);
assert.match(
  sourcePickerHandler,
  /sourcePickerExpanded\s*=\s*!state\.advertising\.sourcePickerExpanded/u
);
assert.match(
  sourcePickerHandler,
  /(?:render\(\)|setAttribute\("aria-expanded"[\s\S]*?\.hidden\s*=\s*!expanded)/u,
  "Раскрытие должно одновременно обновлять aria-expanded и видимость управляемого блока."
);
assert.doesNotMatch(
  sourcePickerHandler,
  /selectedSourceIds\s*=/u,
  "Сворачивание источников не должно сбрасывать выбранные источники."
);

const copyHandlerStart = bindFunction.indexOf("[data-action='copy-new-advertising-emails']");
assert.ok(copyHandlerStart >= 0, "Не найден обработчик копирования новых контактов.");
const copyHandler = bindFunction.slice(copyHandlerStart, copyHandlerStart + 1800);
assert.match(
  copyHandler,
  /getAdvertisingFilteredRows\(\{\s*status:\s*["']new["']\s*\}\)/u,
  "Копирование новых контактов должно сохранять текущие query/source-фильтры."
);
assert.match(copyHandler, /getAdvertisingClipboardEmails/u);
assert.match(copyHandler, /\.join\(["']\\r\\n["']\)/u);
assert.doesNotMatch(copyHandler, /status:\s*["']ready["']/u);

const historyCopyHandlerAction = bindFunction.includes("[data-action='copy-advertising-history-run']")
  ? "[data-action='copy-advertising-history-run']"
  : "[data-action='copy-advertising-history-new']";
const historyCopyHandlerStart = bindFunction.indexOf(historyCopyHandlerAction);
assert.ok(historyCopyHandlerStart >= 0, "Не найден обработчик копирования набора отдельного запроса.");
const historyCopyBinding = bindFunction.slice(historyCopyHandlerStart, historyCopyHandlerStart + 500);
assert.match(historyCopyBinding, /copyAdvertisingEmailHistoryRun\(button\.dataset\.runId\)/u);
const historyCopyHandler = namedFunction(blocks, "copyAdvertisingEmailHistoryRun");
assert.match(historyCopyHandler, /String\(runId/u);
assert.match(
  historyCopyHandler,
  /\/api\/advertising\/email-collector\/history\?runId=\$\{encodeURIComponent\((?:normalizedRunId|runId)\)\}/u,
  "Набор нужно загружать по идентификатору выбранного запуска."
);
assert.match(historyCopyHandler, /copyTextToClipboard/u);
assert.match(historyCopyHandler, /\.join\(["']\\r\\n["']\)/u);
assert.doesNotMatch(
  historyCopyHandler,
  /getAdvertisingFilteredRows|state\.advertising\.filters/u,
  "Копирование исторического набора не должно зависеть от фильтров текущей таблицы."
);

const historyLoader = namedFunction(blocks, "loadAdvertisingEmailHistory");
assert.match(historyLoader, /\/api\/advertising\/email-collector\/history/u);
assert.match(historyLoader, /method:\s*["']GET["']/u);
assert.match(historyLoader, /(?:advertising\.history|history)\.rows\s*=\s*Array\.isArray\(payload\.rows\)/u);
assert.match(historyLoader, /(?:advertising\.history|history)\.loaded\s*=\s*true/u);
assert.match(historyLoader, /(?:advertising\.history|history)\.loading\s*=\s*false/u);

const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authSource)?.[1] || "";
const indexBuild = /const build = "([^"]+)"/u.exec(indexSource)?.[1] || "";
const styleBuild = /styles\.css\?v=([^"']+)/u.exec(indexSource)?.[1] || "";
assert.ok(authBuild, "Не найден динамический идентификатор сборки загрузчика.");
assert.equal(indexBuild, authBuild, "index.html и auth-bootstrap.js используют разные сборки.");
assert.equal(styleBuild, authBuild, "CSS не использует текущий cache-bust сборки.");

const releaseVersion = /const APPLICATION_RELEASE = Object\.freeze\(\{\s*version:\s*"([^"]+)"/u
  .exec(appSource)?.[1] || "";
const historyVersion = /const APPLICATION_RELEASE_HISTORY = Object\.freeze\(\[\s*\{\s*version:\s*"([^"]+)"/u
  .exec(appSource)?.[1] || "";
assert.ok(releaseVersion, "Не найдена версия приложения.");
assert.equal(historyVersion, releaseVersion, "История изменений не начинается с текущей версии.");

console.log("Advertising email history UI tests passed.");
