const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`  function ${name}(`);
  assert(start >= 0, `Function ${name} was not found`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  const bodyStart = appSource.indexOf(") {", start) + 2;
  assert(bodyStart > start, `Function ${name} body was not found`);
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
      if (depth === 0) return appSource.slice(start, index + 1);
    }
  }
  throw new Error(`Function ${name} is incomplete`);
}

const context = {};
vm.runInNewContext(
  `${extractFunction("applyStudentExpenseEditorValues")}; this.applyValues = applyStudentExpenseEditorValues;`,
  context
);
const applyValues = context.applyValues;

const manualRecord = {
  name: "Тестовый слушатель",
  expense1Type: "Печать",
  expense1Amount: 100,
  expense2Date: "2026-08-01",
  expense2Type: "Почта",
  expense2Amount: 200,
  expense2IsPaid: "+",
  expense2Note: "Старое примечание",
  directExpenses: [{ id: "direct-existing", type: "Другое", amount: 50 }]
};
const manualUpdated = applyValues(manualRecord, { kind: "manual", slot: 2 }, {
  date: "2026-08-20",
  type: "Курьер",
  amount: "345.5",
  note: "Новое примечание",
  inventoryId: "inventory-1",
  inventoryLink: "Конверт"
});
assert.strictEqual(manualUpdated.expense2Date, "2026-08-20");
assert.strictEqual(manualUpdated.expense2Type, "Курьер");
assert.strictEqual(manualUpdated.expense2Amount, 345.5);
assert.strictEqual(manualUpdated.expense2Note, "Новое примечание");
assert.strictEqual(manualUpdated.expense2InventoryId, "inventory-1");
assert.strictEqual(manualUpdated.expense2InventoryLink, "Конверт");
assert.strictEqual(manualUpdated.expense2IsPaid, "+");
assert.strictEqual(manualUpdated.expense1Type, manualRecord.expense1Type);
assert.strictEqual(manualUpdated.directExpenses, manualRecord.directExpenses);

const directRecord = {
  directExpenses: [
    { id: "same-a", uid: "42", type: "Одинаковый", amount: 100, note: "A" },
    {
      id: "same-b",
      uid: "42",
      type: "Одинаковый",
      amount: 100,
      note: "B",
      isPaid: "+",
      act: "+",
      recommendation: "+",
      automaticPaymentKey: "automatic-expense-1:author-test",
      automaticPaymentFormula: "[Ставка]"
    }
  ]
};
const directUpdated = applyValues(directRecord, {
  kind: "direct",
  id: "same-b",
  fallbackIndex: 0
}, {
  date: "2026-08-20",
  type: "Обновлённый вид",
  amount: "290",
  note: "Обновлено",
  inventoryId: "",
  inventoryLink: ""
});
assert.strictEqual(JSON.stringify(directUpdated.directExpenses[0]), JSON.stringify(directRecord.directExpenses[0]));
assert.strictEqual(directUpdated.directExpenses[1].id, "same-b");
assert.strictEqual(directUpdated.directExpenses[1].uid, "42");
assert.strictEqual(directUpdated.directExpenses[1].amount, 290);
assert.strictEqual(directUpdated.directExpenses[1].note, "Обновлено");
assert.strictEqual(directUpdated.directExpenses[1].isPaid, "+");
assert.strictEqual(directUpdated.directExpenses[1].act, "+");
assert.strictEqual(directUpdated.directExpenses[1].recommendation, "+");
assert.strictEqual(directUpdated.directExpenses[1].automaticPaymentKey, "automatic-expense-1:author-test");
assert.strictEqual(directUpdated.directExpenses[1].automaticPaymentFormula, "[Ставка]");
assert.strictEqual(
  applyValues(directRecord, { kind: "direct", id: "missing", fallbackIndex: 0 }, {}).directExpenses,
  directRecord.directExpenses,
  "A missing stable id must not update a different row by fallback index"
);

const renderStart = appSource.indexOf("  function renderExpenseRows(");
const renderEnd = appSource.indexOf("\n\n  function findStudentExpenseEditorDirectIndex", renderStart);
assert(renderStart >= 0 && renderEnd > renderStart, "Expense row renderer must exist");
const renderSource = appSource.slice(renderStart, renderEnd);
assert.strictEqual((renderSource.match(/data-action="edit-student-expense"/gu) || []).length, 2);
const editButtons = [];
let editActionIndex = renderSource.indexOf('data-action="edit-student-expense"');
while (editActionIndex >= 0) {
  const buttonStart = renderSource.lastIndexOf("<button", editActionIndex);
  const buttonEnd = renderSource.indexOf("</button>", editActionIndex);
  assert(buttonStart >= 0 && buttonEnd > editActionIndex, "Edit action must belong to a button");
  editButtons.push(renderSource.slice(buttonStart, buttonEnd + "</button>".length));
  editActionIndex = renderSource.indexOf('data-action="edit-student-expense"', buttonEnd);
}
assert.strictEqual(editButtons.length, 2);
assert.match(editButtons[0], /data-expense-index="\$\{n\}"/u);
assert.doesNotMatch(editButtons[0], /data-direct-expense-index=/u);
assert.match(editButtons[1], /data-direct-expense-index="\$\{index\}"/u);
assert.match(editButtons[1], /data-direct-expense-id="\$\{escapeAttr\(expense\.id \|\| ""\)\}"/u);
assert.match(renderSource, /student-expense-edit-button[\s\S]*?payment-row-duplicate[\s\S]*?payment-row-delete/u);

const editorRenderSource = extractFunction("renderStudentExpenseEditor");
assert.match(editorRenderSource, /role="dialog" aria-modal="true" aria-labelledby="student-expense-editor-title"/u);
assert.match(editorRenderSource, /id="studentExpenseEditorForm"/u);
assert.match(editorRenderSource, /name="studentExpenseEditorDate"/u);
assert.match(editorRenderSource, /prefix: "studentExpenseEditor"/u);
assert.match(editorRenderSource, /editor: true/u);
assert.match(editorRenderSource, /name: "studentExpenseEditorNote"/u);

assert.match(appSource, /\$\{state\.studentExpenseEditor \? renderStudentExpenseEditor\(\) : ""\}/u);
assert.match(appSource, /if \(state\.studentExpenseEditor\) \{\s*closeStudentExpenseEditor\(\);\s*return true;/u);
assert.match(appSource, /function bindStudentStatusHistoryNavigation\(\)[\s\S]*?state\.studentExpenseEditor = null;\s*state\.modal = null;/u);
assert.match(appSource, /Есть несохранённые изменения расхода\. Закрыть без сохранения\?/u);
assert.match(appSource, /setStudentExpenseEditorBackgroundInert\(true\)/u);
assert.match(appSource, /closest\("\.student-modal-backdrop"\)/u);
assert.match(appSource, /document\.activeElement\?\.blur\?\.\(\);[\s\S]*?focusTarget\?\.focus\(\{ preventScroll: true \}\);[\s\S]*?setStudentExpenseEditorBackgroundInert\(true\)/u);
assert.match(appSource, /backdrop\.addEventListener\("click", \(event\) => \{\s*if \(event\.target === backdrop\) closeStudentExpenseEditor\(\);/u);
assert.match(appSource, /event\.key !== "Tab"/u);
assert.match(appSource, /applyStudentExpenseInventoryChoice\(inventoryChoice, \{ syncFinance: false \}\)/u);
assert.match(appSource, /\[data-student-expense-inventory-choice\]:not\(\[data-student-expense-editor-type\]\)/u);

const saveSource = extractFunction("saveStudentExpenseEditor");
assert.match(saveSource, /calculateStudentFinance/u);
assert.match(saveSource, /nextDraft\.expenseTotal = Math\.round\(sumStudentExpenses/u);
assert.match(saveSource, /state\.modal\.hasDraftChanges = true/u);
assert.doesNotMatch(saveSource, /\bpersist\s*\(/u);
assert.doesNotMatch(saveSource, /applyStudentInventoryAllocationChanges/u);

assert.match(stylesSource, /\.expense-grid\s*\{[^}]*78px;/u);
assert.match(stylesSource, /\.student-expense-edit-button\s*\{[^}]*color:\s*var\(--teal\)/u);
assert.match(stylesSource, /\.student-expense-editor-backdrop\s*\{[^}]*z-index:\s*65/u);
assert.match(stylesSource, /\.student-expense-editor\s*\{[^}]*width:\s*min\(680px, 100%\);[^}]*max-height:\s*min\(720px, 92dvh\);/u);
assert.match(stylesSource, /\.student-expense-editor-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/u);
assert.match(stylesSource, /\.expense-grid \.expense-row-actions\s*\{[^}]*auto auto auto/u);
assert.match(stylesSource, /\.student-expense-editor\s*\{[^}]*width:\s*100vw/u);

console.log("student expense editor tests: OK");
