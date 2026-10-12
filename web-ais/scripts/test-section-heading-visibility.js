const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const configsStart = appSource.indexOf("  const configs = {");
assert.ok(configsStart >= 0, "Не найден объект configs");

function functionBlock(name, nextName) {
  const start = appSource.indexOf(`  function ${name}(`);
  const end = appSource.indexOf(`  function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `Не найден блок ${name}`);
  return appSource.slice(start, end);
}

function configBlock(name, nextName) {
  const start = appSource.indexOf(`    ${name}: {`, configsStart);
  const end = appSource.indexOf(`    ${nextName}: {`, start + 1);
  assert.ok(start >= 0 && end > start, `Не найден конфиг ${name}`);
  return appSource.slice(start, end);
}

for (const [configId, nextConfigId] of [
  ["students", "contracts"],
  ["contracts", "programs"],
  ["programs", "trainingPlans"],
  ["generalExpenses", "inventory"],
  ["inventory", "users"]
]) {
  assert.match(
    configBlock(configId, nextConfigId),
    /hideSectionHeading: true,/u,
    `Для ${configId} должна быть скрыта шапка реестра`
  );
}

const collectionSource = functionBlock("renderCollection", "getStudentApplicationsDefaultDates");
assert.match(collectionSource, /config\.hideSectionHeading \? "section-head--headingless"/u);
assert.match(collectionSource, /config\.hideSectionHeading \? "" : `/u);

const recycleBinSource = functionBlock("renderRecycleBin", "renderCollection");
assert.doesNotMatch(recycleBinSource, /Защита от случайного удаления/u);
assert.doesNotMatch(recycleBinSource, /<h2>Корзина<\/h2>/u);
assert.match(recycleBinSource, /recycle-bin-description/u);

const constructorSource = functionBlock("renderDocumentConstructor", "renderDocumentTemplateSummary");
assert.doesNotMatch(constructorSource, /Шаблоны и формулы/u);
assert.doesNotMatch(constructorSource, /document-constructor-title/u);
assert.doesNotMatch(constructorSource, /contract-template-summary/u);
assert.doesNotMatch(constructorSource, /section-head/u);

const documentSummarySource = functionBlock("renderDocumentTemplateSummary", "renderSimpleDictionaryEditor");
assert.match(documentSummarySource, /data-document-template-summary/u);
assert.match(documentSummarySource, /documents\.length/u);
assert.match(documentSummarySource, /fields\.length/u);
assert.match(documentSummarySource, /customCount/u);

const documentTableSource = functionBlock("renderDocumentTemplatesTable", "renderDocumentTemplateActionIcon");
assert.match(documentTableSource, /renderDocumentTemplateSummary\(documents, activeDocumentId\)/u);
assert.match(documentTableSource, /renderBulkToolbar\(configs\.documentTemplates, visibleDocuments, "documentTemplates", inlineSummaryHtml\)/u);

const bulkToolbarSource = functionBlock("renderBulkToolbar", "getRowsForConfig");
assert.match(bulkToolbarSource, /bulk-toolbar-selection-count/u);
assert.match(bulkToolbarSource, /\$\{inlineSummaryHtml\}/u);

const settingsSource = functionBlock("renderSettings", "renderAdminExternalServicesPanel");
assert.doesNotMatch(settingsSource, /<p class="eyebrow">Настройки<\/p>/u);
assert.doesNotMatch(settingsSource, /<h2>Настройки системы<\/h2>/u);
assert.match(settingsSource, /settings-page-actions/u);

assert.match(stylesSource, /\.section-head--headingless\s*\{[\s\S]*?justify-content:\s*flex-end/u);
assert.match(stylesSource, /\.section-head--headingless\s*>\s*\.toolbar\s*\{[\s\S]*?width:\s*100%/u);
assert.doesNotMatch(stylesSource, /\.bulk-toolbar\s+span\s*\{/u);
assert.match(stylesSource, /\.bulk-toolbar\s*>\s*\.bulk-toolbar-selection-count\s*\{[\s\S]*?margin-right:\s*auto/u);
assert.match(stylesSource, /\.bulk-toolbar\.has-inline-summary\s*>\s*\.bulk-toolbar-selection-count\s*\{[\s\S]*?margin-right:\s*0/u);
assert.match(stylesSource, /\.document-template-registry\s+\.bulk-toolbar\s*>\s*\.contract-template-summary\s*\{[\s\S]*?margin-right:\s*auto/u);

console.log("Section heading visibility tests passed.");
