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
assert.match(serverSource, /needsCitizenshipMigration[\s\S]*updatedBy:\s*"citizenship-migration"/u);

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

console.log("document recognition citizenship tests: OK");
