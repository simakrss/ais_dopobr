const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appPath = path.join(__dirname, "..", "app.js");
const source = fs.readFileSync(appPath, "utf8");
const matcherStart = source.indexOf("  const DOCUMENT_RECOGNITION_CITIZENSHIP_ALIASES");
const matcherEnd = source.indexOf("\n\n  function normalizeRecognitionComparisonValue", matcherStart);
assert.ok(matcherStart >= 0 && matcherEnd > matcherStart, "citizenship matcher source must exist");

const options = [
  "Российская Федерация",
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
assert.strictEqual(match("Российская Федерация", options), "Российская Федерация");
assert.strictEqual(match("Россия", options), "Россия");
assert.strictEqual(match("РФ", options), "Российская Федерация");
assert.strictEqual(match("РОССИЙСКАЯ ФЕДЕРАЦИИЯ", options), "Российская Федерация");
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
