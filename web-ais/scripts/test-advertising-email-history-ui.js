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
assert.match(advertisingState, /resultCachePartial:\s*false/u);
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
assert.match(advertisingState, /deletingRunId:\s*["']["']/u);
assert.match(advertisingState, /updatingTransferRunId:\s*["']["']/u);
assert.match(
  advertisingState,
  /olderExpanded:\s*false/u,
  "Старые рекламные запросы должны быть свёрнуты при первом открытии."
);
assert.match(appSource, /ADVERTISING_EMAIL_VIEW_CACHE_KEY\s*=\s*["']advertising-email-view-v1["']/u);
assert.match(appSource, /readBrowserOfflineValue\(ADVERTISING_EMAIL_VIEW_CACHE_KEY\)/u);
assert.match(appSource, /hydrateAdvertisingEmailViewCache\(advertisingSnapshot\)/u);
assert.match(appSource, /writeBrowserOfflineValue\(ADVERTISING_EMAIL_VIEW_CACHE_KEY, snapshot\)/u);
assert.match(appSource, /viewerKey:\s*getAdvertisingEmailViewCacheViewerKey\(\)/u);
assert.match(appSource, /String\(snapshot\.viewerKey\s*\|\|\s*["']["']\)\s*!==\s*viewerKey/u);

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
  /if\s*\(\s*newUnique\s*>\s*0\s*\)[\s\S]*?advertising\.filters\s*=\s*\{\s*query:\s*["']["']\s*,\s*source:\s*["']["']\s*,\s*status:\s*["']new["']\s*\}/u,
  "После успешного поиска новых адресов поиск и источник должны очищаться, а таблица — переключаться на статус «Новые»."
);
assert.match(
  collectFunction,
  /state\.tablePages\.advertisingEmails\s*=\s*1/u,
  "После сбора таблица адресов должна открываться с первой страницы."
);
assert.match(
  collectFunction,
  /document\.querySelector\(["']\[data-advertising-results\]["']\)[\s\S]{0,500}?\.scrollIntoView\s*\(/u,
  "После нахождения новых адресов интерфейс должен прокрутиться к таблице адресов."
);
assert.match(
  collectFunction,
  /matchMedia\?\.\(["']\(prefers-reduced-motion:\s*reduce\)["']\)[\s\S]{0,300}?behavior:\s*reduceMotion\s*\?\s*["']auto["']\s*:\s*["']smooth["']/u,
  "Автопрокрутка должна учитывать системное ограничение анимации."
);
assert.match(
  collectFunction,
  /resultsPanel\.focus\(\{\s*preventScroll:\s*true\s*\}\)[\s\S]{0,160}?resultsPanel\.scrollIntoView/u,
  "После перерисовки клавиатурный фокус должен переходить к показанной таблице адресов."
);
assert.match(
  collectFunction,
  /(?:let|var)\s+revealNewAddresses\s*=\s*false[\s\S]*?if\s*\(\s*newUnique\s*>\s*0\s*\)[\s\S]*?revealNewAddresses\s*=\s*true[\s\S]*?if\s*\(\s*revealNewAddresses\s*\)[\s\S]*?\[data-advertising-results\][\s\S]*?scrollIntoView/u,
  "Прокрутка к адресам должна выполняться только когда текущий запуск действительно нашёл новые контакты."
);
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
  /requestedStatus\s*===\s*["']new["']\s*&&\s*!row\.isNew/u,
  "Статус «Новые» должен включать все новые адреса, в том числе исключённые."
);
assert.doesNotMatch(
  filterFunction,
  /requestedStatus\s*===\s*["']new["'][^\n]*row\.excluded/u,
  "Исключённые новые адреса не должны исчезать из режима «Новые»."
);
assert.match(filterFunction, /const query\s*=\s*String\(filters\.query/u);
assert.match(filterFunction, /const sourceId\s*=\s*String\(filters\.source/u);
assert.match(filterFunction, /Array\.isArray\(options\.rows\)/u);
assert.match(filterFunction, /if \(options\.sort === false\) return filtered/u);
assert.match(filterFunction, /row\.sourceReceivedAt/u, "Поиск должен учитывать дату получения из источника.");
assert.match(
  filterFunction,
  /formatAdvertisingEmailReceivedDate\(row\.sourceReceivedAt\)/u,
  "Поиск должен учитывать отображаемую дату получения."
);
const receivedAtFunction = namedFunction(blocks, "getAdvertisingEmailReceivedAt");
const receivedDateFormatter = namedFunction(blocks, "formatAdvertisingEmailReceivedDate");
assert.match(
  receivedDateFormatter,
  /toLocaleDateString\("ru-RU",\s*\{\s*timeZone:\s*"UTC"\s*\}\)/u,
  "Дата из источника не должна сдвигаться при смене часового пояса браузера."
);
assert.match(
  receivedAtFunction,
  /row\?\.sourceReceivedAt\s*\|\|\s*row\?\.firstSeenAt/u,
  "Дата из источника должна иметь приоритет, а старые снимки — использовать дату первого обнаружения."
);
assert.match(
  filterFunction,
  /sort\.key === "sourceReceivedAt"[\s\S]{0,120}?getAdvertisingEmailReceivedAt\(row\)/u,
  "Сортировка даты должна совпадать с отображаемым значением."
);

const clipboardFunction = namedFunction(blocks, "getAdvertisingClipboardEmails");
assert.match(clipboardFunction, /new Set/u, "Email для буфера должны дедублироваться.");
assert.match(clipboardFunction, /toLocaleLowerCase\(["']en-US["']\)/u);
assert.match(clipboardFunction, /\.filter\(Boolean\)/u);

const renderFunction = namedFunction(blocks, "renderAdvertising");
assert.match(renderFunction, /summary\.newUnique/u);
assert.match(renderFunction, /summary\.newReady/u);
assert.match(renderFunction, /<span>Новые<\/span>/u);
assert.match(renderFunction, /<option value="new"[^>]*>Новые<\/option>/u);
assert.match(
  renderFunction,
  /getAdvertisingFilteredRows\(\{\s*status:\s*"all",\s*sort:\s*false\s*\}\)/u,
  "Большой сохранённый снимок не должен сортироваться отдельно для каждого счётчика."
);
const advertisingKpiIndex = renderFunction.indexOf('class="advertising-kpi-grid"');
const advertisingControlsIndex = renderFunction.indexOf('class="panel advertising-controls-panel"');
const advertisingResultsIndex = renderFunction.indexOf("data-advertising-results");
const advertisingHistoryIndex = renderFunction.indexOf("renderAdvertisingHistory()");
assert.ok(advertisingKpiIndex >= 0, "Не найден блок плиток статистики рекламы.");
assert.ok(advertisingControlsIndex > advertisingKpiIndex, "Плитки статистики должны располагаться выше панели сборщика.");
assert.ok(advertisingResultsIndex >= 0, "Таблица адресов должна иметь якорь data-advertising-results.");
assert.ok(
  advertisingHistoryIndex > advertisingControlsIndex && advertisingHistoryIndex < advertisingResultsIndex,
  "История рекламных запросов должна располагаться после сборщика и выше списка email."
);
assert.match(
  renderFunction,
  /<section\b[^>]*data-advertising-results[^>]*tabindex=["']-1["']/u,
  "Панель результатов должна принимать программный фокус после сбора."
);
assert.match(
  renderFunction,
  /data-action="export-advertising-emails"\s+data-advertising-export-scope="filtered"/u,
  "У таблицы email должна быть отдельная кнопка экспорта текущей отфильтрованной выборки."
);
assert.match(stylesSource, /\.advertising-results-panel\s*\{[\s\S]*?scroll-margin-top:\s*\d+px/u);
const advertisingEmailTableStyles = sourceSlice(
  stylesSource,
  ".advertising-email-table {",
  ".advertising-email-table th:nth-child(1)"
);
assert.match(
  advertisingEmailTableStyles,
  /min-width:\s*0/u,
  "Таблица email не должна принудительно создавать горизонтальную прокрутку на обычном экране."
);
assert.doesNotMatch(advertisingEmailTableStyles, /min-width:\s*940px/u);

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
  /rows\.slice\(\s*0\s*,\s*2\s*\)/u,
  "Без раскрытия должны показываться только два последних рекламных запроса."
);
assert.match(
  renderHistoryFunction,
  /rows\.slice\(\s*2\s*\)/u,
  "Запросы старше двух последних должны формировать отдельный сворачиваемый список."
);
const perRunCopyButton = /<button\b[^>]*data-action="copy-advertising-history-(?:new|run)"[^>]*>[\s\S]*?<\/button>/u
  .exec(renderHistoryFunction)?.[0] || "";
assert.ok(perRunCopyButton, "У каждого рекламного запроса нужна кнопка копирования новых адресов.");
assert.match(perRunCopyButton, /data-run-id="\$\{escapeAttr\((?:run|row)\.runId(?:\s*\|\|\s*"")?\)\}"/u);
assert.match(renderHistoryFunction, /summary\.newReady/u);
assert.match(renderHistoryFunction, /history\.copyingRunId/u);
assert.match(perRunCopyButton, /disabled/u);
const perRunDeleteButton = /<button\b[^>]*data-action="delete-advertising-history-run"[^>]*>[\s\S]*?<\/button>/u
  .exec(renderHistoryFunction)?.[0] || "";
assert.ok(perRunDeleteButton, "У каждого доступного администратору запроса нужна кнопка удаления.");
assert.match(perRunDeleteButton, /data-run-id="\$\{escapeAttr\((?:run|row)\.runId(?:\s*\|\|\s*"")?\)\}"/u);
assert.match(renderHistoryFunction, /isAdminUser\(\)[\s\S]{0,120}?row\.canDelete\s*!==\s*false/u);
assert.match(renderHistoryFunction, /history\.deletingRunId/u);
const transferCheckbox = /<input\b[^>]*data-action="toggle-advertising-history-transfer"[^>]*>/u
  .exec(renderHistoryFunction)?.[0] || "";
assert.ok(transferCheckbox, "У каждого запроса нужна ручная отметка передачи email в рекламу.");
assert.match(transferCheckbox, /data-run-id="\$\{escapeAttr\(row\.runId\s*\|\|\s*""\)\}"/u);
assert.match(transferCheckbox, /type="checkbox"/u);
assert.match(transferCheckbox, /transferredToAdvertising\s*\?\s*"checked"/u);
assert.match(renderHistoryFunction, /Email переданы в рекламу/u);
assert.match(renderHistoryFunction, /history\.updatingTransferRunId/u);
assert.match(renderHistoryFunction, /data-label="(?:Запуск|Источники|Результат|Передано|Действия)"/u);
assert.match(
  stylesSource,
  /\.advertising-history-table\s*\{[\s\S]*?min-width:\s*0[\s\S]*?table-layout:\s*fixed/u,
  "Таблица запросов не должна принудительно создавать горизонтальную прокрутку."
);
assert.match(stylesSource, /\.advertising-history-table td::before\s*\{[\s\S]*?content:\s*attr\(data-label\)/u);
const historySourceDetails = /<details\b[^>]*class="advertising-history-source-details[^>]*>[\s\S]*?<\/details>/u
  .exec(renderHistoryFunction)?.[0] || "";
assert.ok(historySourceDetails, "Источники каждого рекламного запроса должны быть сворачиваемыми.");
assert.doesNotMatch(
  historySourceDetails.match(/^<details\b[^>]*>/u)?.[0] || "",
  /\bopen(?:\s|=|>)/u,
  "Источники запроса должны быть свёрнуты по умолчанию."
);
assert.match(historySourceDetails, /<summary>Источники · \$\{formatStatisticsInteger\(sources\.length\)\}/u);
assert.match(historySourceDetails, /advertising-history-sources/u);
assert.match(historySourceDetails, /source\?\.status === "error"/u);
assert.match(renderHistoryFunction, /\$\{sources\.length \? `[\s\S]*?` : "—"\}/u);
assert.match(stylesSource, /\.advertising-history-source-details\s*>\s*summary/u);
assert.match(
  stylesSource,
  /\.advertising-history-older-details\s*>\s*summary:focus-visible\s*\{[\s\S]*?outline:\s*2px\s+solid\s+var\(--teal\)/u,
  "Кнопка раскрытия старых запросов должна иметь контрастный индикатор фокуса."
);
const olderHistoryDetails = /<details\b[^>]*data-advertising-history-older[^>]*>[\s\S]*?<\/details>/u
  .exec(renderHistoryFunction)?.[0] || "";
assert.ok(olderHistoryDetails, "Старые рекламные запросы должны находиться в отдельном details-блоке.");
const olderHistoryOpeningTag = olderHistoryDetails.match(/^<details\b[^>]*>/u)?.[0] || "";
assert.match(
  olderHistoryOpeningTag,
  /\$\{\s*history\.olderExpanded\s*\?\s*["']open["']\s*:\s*["']["']\s*\}/u,
  "Открытое состояние старых запросов должно управляться history.olderExpanded."
);
const olderHistoryOpeningWithoutControlledState = olderHistoryOpeningTag.replace(
  /\$\{\s*history\.olderExpanded\s*\?\s*["']open["']\s*:\s*["']["']\s*\}/u,
  ""
);
assert.doesNotMatch(
  olderHistoryOpeningWithoutControlledState,
  /\bopen(?:\s|=|>)/u,
  "Список старых запросов не должен быть безусловно раскрыт."
);

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
assert.match(
  appSource,
  /\{\s*key:\s*"sourceReceivedAt",\s*label:\s*"Дата получения"\s*\}/u,
  "В таблице Email нужна отдельная колонка даты получения."
);
assert.match(
  renderFunction,
  /class="advertising-email-received"[\s\S]{0,700}?formatAdvertisingEmailReceivedDate\(getAdvertisingEmailReceivedAt\(row\)\)/u,
  "В каждой строке Email должна выводиться дата первого получения."
);
const exportFunction = namedFunction(blocks, "exportAdvertisingEmails");
assert.match(exportFunction, /"Дата получения"/u, "CSV должен содержать колонку даты получения.");
assert.match(exportFunction, /formatAdvertisingEmailReceivedDate\(getAdvertisingEmailReceivedAt\(row\)\)/u);
assert.match(
  exportFunction,
  /exportScope\s*===\s*"filtered"[\s\S]{0,160}?getAdvertisingFilteredRows\(\)/u,
  "Экспорт из заголовка таблицы должен учитывать все активные фильтры."
);
assert.match(exportFunction, /"Статус"[\s\S]{0,80}?"Причина исключения"/u);

const bindFunction = namedFunction(blocks, "bindAdvertisingEvents");
assert.match(
  bindFunction,
  /querySelectorAll\("\[data-action='export-advertising-emails'\]"\)[\s\S]{0,180}?addEventListener\("click",\s*exportAdvertisingEmails\)/u,
  "Обе кнопки экспорта рекламы должны получать обработчик."
);
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
assert.match(
  copyHandler,
  /\.filter\(\s*\(?row\)?\s*=>\s*!row\.excluded\s*\)/u,
  "Копировать можно только новые адреса, не попавшие в исключения."
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
const transferBindingStart = bindFunction.indexOf("[data-action='toggle-advertising-history-transfer']");
assert.ok(transferBindingStart >= 0, "Не найден обработчик ручной отметки передачи email.");
assert.match(
  bindFunction.slice(transferBindingStart, transferBindingStart + 500),
  /updateAdvertisingEmailHistoryTransfer\([\s\S]*?checkbox\.dataset\.runId[\s\S]*?checkbox\.checked/u
);
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

const transferHandler = namedFunction(blocks, "updateAdvertisingEmailHistoryTransfer");
assert.match(transferHandler, /method:\s*"POST"/u);
assert.match(transferHandler, /transferredToAdvertising:\s*nextState/u);
assert.match(transferHandler, /history\.updatingTransferRunId/u);
assert.match(transferHandler, /persistAdvertisingEmailViewCache/u);
assert.match(transferHandler, /previousRow/u, "При ошибке ручная отметка должна восстанавливаться.");

const historyLoader = namedFunction(blocks, "loadAdvertisingEmailHistory");
assert.match(historyLoader, /\/api\/advertising\/email-collector\/history/u);
assert.match(historyLoader, /method:\s*["']GET["']/u);
assert.match(
  historyLoader,
  /if \(history\.loading\)[\s\S]*?options\.force[\s\S]*?history\.pendingRefresh\s*=\s*true/u,
  "Принудительное обновление не должно теряться, пока выполняется предыдущий GET истории."
);
assert.match(
  historyLoader,
  /const shouldRefresh\s*=\s*history\.pendingRefresh[\s\S]*?history\.pendingRefresh\s*=\s*false[\s\S]*?loadAdvertisingEmailHistory\(\{\s*force:\s*true\s*\}\)/u,
  "После завершения текущего GET должен выполняться отложенный принудительный запрос."
);
assert.match(historyLoader, /(?:advertising\.history|history)\.rows\s*=\s*Array\.isArray\(payload\.rows\)/u);
assert.match(historyLoader, /(?:advertising\.history|history)\.loaded\s*=\s*true/u);
assert.match(historyLoader, /(?:advertising\.history|history)\.loading\s*=\s*false/u);
assert.match(historyLoader, /persistAdvertisingEmailViewCache/u);
assert.match(
  historyLoader,
  /document\.activeElement\?\.matches\?\.\(["']\[data-advertising-results\]["']\)[\s\S]{0,420}?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/u,
  "Фоновое обновление истории не должно терять фокус панели новых адресов."
);

const olderHistoryToggleStart = bindFunction.indexOf("[data-advertising-history-older]");
assert.ok(olderHistoryToggleStart >= 0, "Не найден обработчик раскрытия старых рекламных запросов.");
const olderHistoryToggleHandler = bindFunction.slice(olderHistoryToggleStart, olderHistoryToggleStart + 600);
assert.match(olderHistoryToggleHandler, /addEventListener\(["']toggle["']/u);
assert.match(
  olderHistoryToggleHandler,
  /state\.advertising\.history\.olderExpanded\s*=\s*Boolean\([^)]*\.open\)/u,
  "Обработчик details должен сохранять фактическое состояние раскрытия."
);

const resultLoader = namedFunction(blocks, "loadAdvertisingEmailResult");
assert.match(resultLoader, /knownRunId=\$\{encodeURIComponent\(knownRunId\)\}/u);
assert.match(resultLoader, /!payload\.notModified/u);
assert.match(resultLoader, /persistAdvertisingEmailViewCache/u);
assert.match(
  resultLoader,
  /state\.view\s*===\s*"advertising"\s*&&\s*!hadCachedResult/u,
  "Фоновое обновление не должно заменять сохранённые данные повторным экраном загрузки."
);

const deleteHistoryFunction = namedFunction(blocks, "deleteAdvertisingEmailHistoryRun");
assert.match(deleteHistoryFunction, /isAdminUser\(\)/u);
assert.match(deleteHistoryFunction, /window\.confirm/u);
assert.match(deleteHistoryFunction, /method:\s*"DELETE"/u);
assert.match(
  deleteHistoryFunction,
  /\/api\/advertising\/email-collector\/history\?runId=\$\{encodeURIComponent\(normalizedRunId\)\}/u
);
assert.match(deleteHistoryFunction, /history\.rows\s*=\s*Array\.isArray\(payload\.rows\)/u);
assert.match(deleteHistoryFunction, /persistAdvertisingEmailViewCache/u);
const deleteBindingStart = bindFunction.indexOf("[data-action='delete-advertising-history-run']");
assert.ok(deleteBindingStart >= 0, "Не найден обработчик удаления рекламного запроса.");
assert.match(
  bindFunction.slice(deleteBindingStart, deleteBindingStart + 500),
  /deleteAdvertisingEmailHistoryRun\(button\.dataset\.runId\)/u
);

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
