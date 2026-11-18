const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appPath = path.join(__dirname, "..", "app.js");
const source = fs.readFileSync(appPath, "utf8").replace(/\r\n/g, "\n");
const matcherStart = source.indexOf("  const DOCUMENT_RECOGNITION_CITIZENSHIP_ALIASES");
const matcherEnd = source.indexOf("\n\n  const studentDocumentRecognitionDisplayDateKeys", matcherStart);
assert.ok(matcherStart >= 0 && matcherEnd > matcherStart, "citizenship matcher source must exist");

const options = [
  "Россия",
  "Беларусь",
  "Казахстан",
  "Узбекистан",
  "Молдова",
  "Кыргызстан"
];
const helpers = new Function(
  "unique",
  "getLookupOptions",
  `${source.slice(matcherStart, matcherEnd)}
  return {
    matchDocumentRecognitionCitizenship,
    normalizeDocumentRecognitionCitizenshipField,
    getDocumentRecognitionCitizenshipOptions
  };`
)(
  (values) => Array.from(new Set(values)),
  () => [...options]
);

const match = helpers.matchDocumentRecognitionCitizenship;
assert.strictEqual(match("Российская Федерация", options), "Россия");
assert.strictEqual(match("Россия", options), "Россия");
assert.strictEqual(match("РФ", options), "Россия");
assert.strictEqual(match("РОССИЙСКАЯ ФЕДЕРАЦИИЯ", options), "Россия");
assert.strictEqual(match("Гражданство: Республика Беларусь", options), "Беларусь");
assert.strictEqual(match("Республика Казахстан", options), "Казахстан");
assert.strictEqual(match("Молдавия", options), "Молдова");
assert.strictEqual(match("Республика Узбекистан", options), "Узбекистан");
assert.strictEqual(match("Кыргызская Республика", options), "Кыргызстан");
assert.ok(options.includes(match("Узбекестан", options)), "a recognized value must be replaced by a list item");
assert.strictEqual(match("", options), "");
assert.strictEqual(match("Армения", []), "Армения");

const normalizedField = helpers.normalizeDocumentRecognitionCitizenshipField({
  key: "citizenship",
  value: "Республика Беларусь",
  confidence: 0.93
});
assert.strictEqual(normalizedField.value, "Беларусь");
assert.strictEqual(normalizedField.recognitionOriginalValue, "Республика Беларусь");
assert.deepStrictEqual(
  helpers.normalizeDocumentRecognitionCitizenshipField({ key: "passportIssuer", value: "РФ" }),
  { key: "passportIssuer", value: "РФ" }
);
assert.deepStrictEqual(helpers.getDocumentRecognitionCitizenshipOptions(), options);

const citizenshipNormalizerStart = source.indexOf("  const DEFAULT_CITIZENSHIP");
const citizenshipNormalizerEnd = source.indexOf("\n  const dictionaryDefaults", citizenshipNormalizerStart);
assert.ok(citizenshipNormalizerStart >= 0 && citizenshipNormalizerEnd > citizenshipNormalizerStart);
const normalizeCitizenshipValue = new Function(
  `${source.slice(citizenshipNormalizerStart, citizenshipNormalizerEnd)}\nreturn normalizeCitizenshipValue;`
)();
assert.strictEqual(normalizeCitizenshipValue("Российская Федерация"), "Россия");
assert.strictEqual(normalizeCitizenshipValue("российской федерации"), "Россия");
assert.strictEqual(normalizeCitizenshipValue("РФ"), "Россия");
assert.strictEqual(normalizeCitizenshipValue("Беларусь"), "Беларусь");
assert.deepStrictEqual(
  Array.from(new Set(["Российская Федерация", "Россия"].map(normalizeCitizenshipValue))),
  ["Россия"]
);
assert.match(source, /citizenships:\s*\[DEFAULT_CITIZENSHIP\]/u);
assert.doesNotMatch(source, /citizenships:\s*\["Российская Федерация"\]/u);
assert.match(source, /citizenship:\s*normalizeCitizenshipValue\(student\.citizenship\)/u);
assert.match(source, /citizenship:\s*normalizeCitizenshipValue\(contract\.citizenship\)/u);
assert.match(source, /dict === "citizenships"[\s\S]*normalizeCitizenshipValue\(value\)/u);

const {
  normalizeSharedApplicationData,
  normalizeSharedApplicationStatePatch,
  sharedApplicationDataNeedsCitizenshipMigration,
  sharedApplicationDataNeedsContractExpiration,
  sanitizeFrdoExportPayload,
  sanitizeStudentDatabaseExportPayload
} = require(path.join(__dirname, "..", "app-server.js"));
const [frdoRecord] = sanitizeFrdoExportPayload({
  records: [{
    documentNumber: "123",
    programType: "КПК",
    citizenship: "Российская Федерация"
  }]
});
assert.strictEqual(frdoRecord.citizenship, "Россия");
const databasePayload = sanitizeStudentDatabaseExportPayload({
  students: [{ id: "student-1", citizenship: "Российская Федерация" }],
  contracts: [{ id: "contract-1", citizenship: "РФ" }],
  directExpenses: [],
  generalExpenses: []
});
assert.strictEqual(databasePayload.students[0].citizenship, "Россия");
assert.strictEqual(databasePayload.contracts[0].citizenship, "Россия");

const legacySharedData = {
  collections: {
    students: [{ id: "student-1", citizenship: "Российская Федерация" }],
    contracts: [{ id: "contract-1", citizenship: "РФ" }]
  },
  dictionaries: {
    citizenships: ["Российская Федерация", "Россия", "Беларусь"]
  }
};
assert.strictEqual(sharedApplicationDataNeedsCitizenshipMigration(legacySharedData), true);
const sharedData = normalizeSharedApplicationData(legacySharedData);
assert.strictEqual(sharedApplicationDataNeedsCitizenshipMigration(sharedData), false);
assert.deepStrictEqual(sharedData.dictionaries.citizenships, ["Россия", "Беларусь"]);
assert.strictEqual(sharedData.collections.students[0].citizenship, "Россия");
assert.strictEqual(sharedData.collections.contracts[0].citizenship, "Россия");

const sharedPatch = normalizeSharedApplicationStatePatch({
  collections: {
    students: {
      upserts: [{ id: "student-2", citizenship: "Российская Федерация" }]
    },
    contracts: {
      replace: [{ id: "contract-2", citizenship: "РФ" }]
    }
  },
  dictionaries: {
    citizenships: ["Российская Федерация", "Россия"]
  }
});
assert.strictEqual(sharedPatch.collections.students.upserts[0].citizenship, "Россия");
assert.strictEqual(sharedPatch.collections.contracts.replace[0].citizenship, "Россия");
assert.deepStrictEqual(sharedPatch.dictionaries.citizenships, ["Россия"]);

const serverSource = fs.readFileSync(path.join(__dirname, "..", "app-server.js"), "utf8");
const migrationStart = serverSource.indexOf("async function ensureSharedApplicationStateMySqlDocument(");
const migrationEnd = serverSource.indexOf("async function readSharedApplicationStatePendingDocument(", migrationStart);
assert.ok(migrationStart >= 0 && migrationEnd > migrationStart, "automatic shared-state migration handler must exist");

async function verifyAutomaticMigrations() {
  const withExpiredContract = (data) => ({
    ...structuredClone(data),
    collections: {
      ...structuredClone(data.collections),
      contracts: data.collections.contracts.map((record) => ({
        ...record, section: "Действующие договора", endDate: "2000-01-01"
      }))
    }
  });
  for (const { name, initial, updatedBy, failFirst = false } of [
    { name: "citizenship only", initial: legacySharedData, updatedBy: "citizenship-migration" },
    { name: "citizenship and expired contracts", initial: withExpiredContract(legacySharedData), updatedBy: "automatic-contract-expiration" },
    { name: "expired contracts only", initial: withExpiredContract(sharedData), updatedBy: "automatic-contract-expiration" },
    { name: "already normalized", initial: sharedData, updatedBy: null },
    { name: "retry after failed migration", initial: legacySharedData, updatedBy: "citizenship-migration", failFirst: true }
  ]) {
    // Exercise the production migration handler without connecting to a real database.
    const pool = {};
    const writes = [], warnings = [];
    let stored = structuredClone(initial), revision = 7, shouldFail = failFirst;
    const migrate = new Function(
      "readSharedApplicationStateMySqlDocument", "saveSharedApplicationStateMySqlOperation", "console",
      `${serverSource.slice(migrationStart, migrationEnd)}\nreturn ensureSharedApplicationStateMySqlDocument;`
    )(
      async (receivedPool) => {
        assert.strictEqual(receivedPool, pool, name);
        return {
          exists: true,
          needsCitizenshipMigration: sharedApplicationDataNeedsCitizenshipMigration(stored),
          needsContractExpiration: sharedApplicationDataNeedsContractExpiration(stored),
          document: { revision, data: normalizeSharedApplicationData(stored) }
        };
      },
      async (receivedPool, operation, user, options) => {
        assert.strictEqual(receivedPool, pool, name);
        assert.strictEqual(operation.baseRevision, revision, name);
        assert.strictEqual(user, null, name);
        assert.deepStrictEqual(options, { skipCache: true }, name);
        if (shouldFail) { shouldFail = false; throw new Error("fixture storage unavailable"); }
        writes.push(structuredClone(operation));
        stored = structuredClone(operation.data);
        revision++;
      },
      { warn: message => warnings.push(message) }
    );
    if (failFirst) {
      const failed = await migrate(pool);
      assert.strictEqual(failed.needsCitizenshipMigration, true, name);
      assert.deepStrictEqual(stored, initial, name);
      assert.strictEqual(writes.length, 0, name);
      assert.strictEqual(warnings.length, 1, name);
    }
    const result = await migrate(pool);
    assert.strictEqual(writes.length, updatedBy ? 1 : 0, name);
    if (updatedBy) assert.strictEqual(writes[0].updatedBy, updatedBy, name);
    assert.deepStrictEqual(stored, normalizeSharedApplicationData(initial), name);
    assert.strictEqual(result.needsCitizenshipMigration, false, name);
    assert.strictEqual(result.needsContractExpiration, false, name);
    assert.strictEqual(result.document.revision, revision, name);
    await migrate(pool);
    assert.strictEqual(writes.length, updatedBy ? 1 : 0, `${name}: migration must not repeat`);
  }
}

const listControlStart = source.indexOf("  function getDocumentRecognitionListControl");
const listControlEnd = source.indexOf("\n\n  function renderStudentDocumentRecognitionField", listControlStart);
const listControlSource = source.slice(listControlStart, listControlEnd);
assert.match(listControlSource, /key === "citizenship"[\s\S]*mode = "select"/u);
assert.match(listControlSource, /options = getDocumentRecognitionCitizenshipOptions\(\)/u);
assert.doesNotMatch(listControlSource, /key === "citizenship"[\s\S]{0,180}makeOptions/u);

const applyStart = source.indexOf("  async function applyStudentDocumentRecognition");
const applyEnd = source.indexOf("\n\n  function closeStudentDocumentRecognitionSelectionDialog", applyStart);
assert.match(
  source.slice(applyStart, applyEnd),
  /key === "citizenship"[\s\S]*matchDocumentRecognitionCitizenship\(value\)/u
);

verifyAutomaticMigrations().then(() => {
  console.log("document recognition citizenship tests: OK (normalization, migration persistence, combined updates, idempotence, retry)");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
