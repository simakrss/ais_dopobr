const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function functionBlock(name, nextName) {
  const start = appSource.indexOf(`  async function ${name}(`) >= 0
    ? appSource.indexOf(`  async function ${name}(`)
    : appSource.indexOf(`  function ${name}(`);
  const endCandidates = [
    appSource.indexOf(`  async function ${nextName}(`, start + 1),
    appSource.indexOf(`  function ${nextName}(`, start + 1)
  ].filter((value) => value > start);
  assert.ok(start >= 0 && endCandidates.length, `Не найден блок ${name}`);
  return appSource.slice(start, Math.min(...endCandidates));
}

assert.match(appSource, /id: "recycleBin", label: "Корзина"/u);
assert.match(appSource, /data\.collections\.recycleBin = \(Array\.isArray/u);
assert.match(appSource, /if \(state\.view === "recycleBin"\) return renderRecycleBin\(\)/u);
assert.match(appSource, /function createRecycleBinItem/u);
assert.match(appSource, /record: clone\(record\)/u);
assert.match(appSource, /globalDirectExpenses: clone\(relatedGlobalDirectExpenses\)/u);

const deleteRecordSource = functionBlock("deleteRecord", "bulkDelete");
assert.match(deleteRecordSource, /createRecycleBinItem/u);
assert.match(deleteRecordSource, /Перемещена в корзину/u);
assert.doesNotMatch(deleteRecordSource, /deleteStoredPhoto/u);

const bulkDeleteSource = functionBlock("bulkDelete", "bulkSetStatus");
assert.match(bulkDeleteSource, /trashItems = selectedRecords\.map/u);
assert.match(bulkDeleteSource, /Массовое перемещение в корзину/u);
assert.doesNotMatch(bulkDeleteSource, /deleteStoredPhoto/u);

const restoreSource = functionBlock("restoreRecycleBinItem", "permanentlyDeleteRecycleBinItem");
assert.match(restoreSource, /\/api\/trash\/restore/u);
assert.match(restoreSource, /baseRevision: sharedStateRevision/u);
assert.match(restoreSource, /setRecycleBinMutationRunning\(true/u);
assert.match(restoreSource, /flushChangesCreatedDuringRecycleBinMutation/u);

const purgeSource = functionBlock("permanentlyDeleteRecycleBinItem", "deleteRecord");
assert.match(purgeSource, /if \(!isAdminUser\(\)\)/u);
assert.match(purgeSource, /if \(!confirm\(/u);
assert.match(purgeSource, /prompt\("Для второго подтверждения/u);
assert.match(purgeSource, /phrase !== "Удалить"/u);
assert.match(purgeSource, /confirmed: true/u);
assert.match(purgeSource, /\/api\/admin\/trash\/permanent-delete/u);
assert.match(purgeSource, /setRecycleBinMutationRunning\(true/u);
assert.match(purgeSource, /flushChangesCreatedDuringRecycleBinMutation/u);
assert.match(appSource, /recycle-bin-operation-blocker/u);

assert.match(appSource, /isAdminUser\(\) \? `[\s\S]*permanently-delete-recycle-bin-item/u);
assert.match(stylesSource, /\.recycle-bin-panel/u);
assert.match(stylesSource, /\.recycle-bin-actions/u);

console.log("Recycle bin UI tests passed.");
