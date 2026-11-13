const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const serverPath = path.resolve(__dirname, "..", "app-server.js");
const source = fs.readFileSync(serverPath, "utf8");
const gatewaySource = fs.readFileSync(path.resolve(__dirname, "..", "gateway.php"), "utf8");

function sourceRange(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `Не найден проверяемый блок: ${startMarker}`);
  return source.slice(start, end);
}

const context = vm.createContext({
  Buffer,
  console,
  structuredClone,
  normalizeSharedApplicationData(value) {
    return JSON.parse(JSON.stringify(value));
  }
});

vm.runInContext(`
${sourceRange(
    "function applySharedApplicationStatePatch(currentData, patch)",
    "function getSharedApplicationStatePatchRecordKeys(patch)"
  )}
${sourceRange(
    "function recycleBinHttpError(message, statusCode = 400, code = \"\")",
    "async function mutateRecycleBinLegacy(request, authUser, mutator)"
  )}
this.recycleBinApi = {
  assertSharedApplicationStateOperationKeepsRecycleBin,
  buildRecycleBinRestoreMutation,
  buildRecycleBinPermanentDeleteMutation,
  normalizeRecycleBinRequest
};
`, context);

const api = context.recycleBinApi;

function baseData() {
  return {
    collections: {
      students: [],
      directExpenses: [],
      recycleBin: [{
        id: "trash-1",
        collection: "students",
        recordId: "student-1",
        originalIndex: 0,
        label: "Тестовая заявка",
        record: { id: "student-1", name: "Тестовая заявка", documentNo: "42" },
        related: {
          globalDirectExpenses: [{ id: "expense-1", uid: "42", amount: 100 }]
        }
      }]
    },
    dictionaries: {},
    meta: {}
  };
}

function expectProtected(operation) {
  assert.throws(
    () => api.assertSharedApplicationStateOperationKeepsRecycleBin(baseData(), operation),
    (error) => error?.statusCode === 403 && error?.code === "RECYCLE_BIN_PROTECTED"
  );
}

expectProtected({
  patch: { collections: { recycleBin: { upserts: [], deletes: ["trash-1"], order: [] } } }
});
expectProtected({
  patch: { collections: { recycleBin: { replace: [] } } }
});
expectProtected({
  data: { ...baseData(), collections: { ...baseData().collections, recycleBin: [] } }
});
expectProtected({
  patch: {
    collections: {
      recycleBin: {
        upserts: [{
          ...baseData().collections.recycleBin[0],
          record: { id: "student-1" }
        }],
        deletes: [],
        order: []
      }
    }
  }
});

assert.doesNotThrow(() => api.assertSharedApplicationStateOperationKeepsRecycleBin(baseData(), {
  patch: {
    collections: {
      recycleBin: {
        upserts: [{ id: "trash-2", collection: "students", record: { id: "student-2" } }],
        deletes: [],
        order: []
      }
    }
  }
}));

const restored = api.buildRecycleBinRestoreMutation(baseData(), "trash-1");
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(restored.data.collections.students)),
  [{ id: "student-1", name: "Тестовая заявка", documentNo: "42" }]
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(restored.data.collections.directExpenses)),
  [{ id: "expense-1", uid: "42", amount: 100 }]
);
assert.deepStrictEqual(JSON.parse(JSON.stringify(restored.data.collections.recycleBin)), []);
assert.strictEqual(restored.summary.restoredExpenses, 1);

const recordCollision = baseData();
recordCollision.collections.students.push({ id: "student-1", name: "Активная" });
assert.throws(
  () => api.buildRecycleBinRestoreMutation(recordCollision, "trash-1"),
  (error) => error?.statusCode === 409 && error?.publicCode === "TRASH_RECORD_COLLISION"
);

const expenseCollision = baseData();
expenseCollision.collections.directExpenses.push({ id: "expense-1", amount: 999 });
assert.throws(
  () => api.buildRecycleBinRestoreMutation(expenseCollision, "trash-1"),
  (error) => error?.statusCode === 409 && error?.publicCode === "TRASH_EXPENSE_COLLISION"
);

const identicalExpenseAlreadyRestored = baseData();
identicalExpenseAlreadyRestored.collections.directExpenses.push({ id: "expense-1", uid: "42", amount: 100 });
const restoredWithExistingExpense = api.buildRecycleBinRestoreMutation(
  identicalExpenseAlreadyRestored,
  "trash-1"
);
assert.strictEqual(restoredWithExistingExpense.data.collections.directExpenses.length, 1);
assert.strictEqual(restoredWithExistingExpense.summary.restoredExpenses, 0);

const permanentlyDeleted = api.buildRecycleBinPermanentDeleteMutation(baseData(), "trash-1");
assert.deepStrictEqual(JSON.parse(JSON.stringify(permanentlyDeleted.data.collections.recycleBin)), []);
assert.deepStrictEqual(JSON.parse(JSON.stringify(permanentlyDeleted.data.collections.students)), []);
assert.strictEqual(Object.hasOwn(permanentlyDeleted.summary, "photoPath"), false);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(api.normalizeRecycleBinRequest({
    id: "trash-1",
    baseRevision: 7,
    confirmed: true,
    confirmationPhrase: "Удалить"
  }, true))),
  { id: "trash-1", baseRevision: 7 }
);
assert.throws(
  () => api.normalizeRecycleBinRequest({
    id: "trash-1",
    baseRevision: 7,
    confirmed: true,
    confirmationPhrase: "удалить"
  }, true),
  (error) => error?.statusCode === 400 && error?.publicCode === "TRASH_CONFIRMATION_REQUIRED"
);

assert(source.includes('authUser?.role !== "admin"'));
assert(source.includes('requestUrl.pathname === "/api/admin/trash/permanent-delete"'));
assert.match(
  sourceRange("async function mutateRecycleBinLegacy", "async function mutateRecycleBinMySql"),
  /enqueueSharedApplicationStateWrite[\s\S]*getActiveStudentDatabaseSyncReservation\(\)/u
);
assert.match(
  sourceRange("async function mutateRecycleBinMySql", "async function mutateRecycleBin\("),
  /FOR UPDATE[\s\S]*getActiveStudentDatabaseSyncReservation\(\)/u
);
assert.match(gatewaySource, /\$canChangeRecycleBin[\s\S]*\['upserts'\]/u);
assert.match(gatewaySource, /gateway_shared_state_protected_recycle_bin_ids/u);
assert.match(gatewaySource, /json_encode\(\$nextById\[\$id\]\) !== json_encode\(\$row\)/u);
assert.doesNotMatch(gatewaySource, /array_is_list\(/u);
assert.doesNotMatch(
  sourceRange("async function handleRecycleBinRequest", "async function handleSharedApplicationState"),
  /deleteManagedStudentPhoto|deletePhoto/u
);
assert.doesNotMatch(
  gatewaySource.slice(
    gatewaySource.indexOf("function gateway_handle_trash_route"),
    gatewaySource.indexOf("function gateway_handle_record_lock_route")
  ),
  /\/api\/photos|photoPath/u
);

console.log("Серверная защита корзины прошла проверку.");
