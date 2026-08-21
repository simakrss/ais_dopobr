const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appPath = process.env.AIS_TEST_APP_SOURCE
  ? path.resolve(process.env.AIS_TEST_APP_SOURCE)
  : path.join(__dirname, "..", "app.js");
const source = fs.readFileSync(appPath, "utf8");

function extractFunction(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Функция ${name} не найдена`);
  const bodyStart = source.indexOf(") {", start) + 2;
  assert.ok(bodyStart > 1, `Тело функции ${name} не найдено`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) return source.slice(start + 2, index + 1);
  }
  throw new Error(`Не найден конец функции ${name}`);
}

const defaultDocuments = "{{если:ДПО}}default dpo{{иначе}}default dop{{конец}}";
const context = {
  communicationTemplateNamedRangeBindings: {
    ПереченьДокументов: ["ПереченьДокументовДПП", "ПереченьДокументовДОП"],
    СсылкаАнкеты: ["АдресАнкеты"],
    СсылкаОплаты: ["СсылкаНаОплату"],
    СсылкаОплатыПродления: ["СсылкаНаОплатуПродления"],
    СсылкиСоцсети: ["СсылкиСоцсети"]
  },
  studentCommunicationTemplateFieldFormulaDefaults: { ПереченьДокументов: defaultDocuments },
  normalizeCommunicationTemplateFieldOverrides: (value) => ({ ...(value || {}) }),
  unique: (values) => Array.from(new Set(values)),
  Error
};
vm.createContext(context);
vm.runInContext([
  extractFunction("splitStudentCommunicationDocumentsFormula"),
  extractFunction("mergeImportedCommunicationTemplateNamedRanges")
].join("\n"), context);

const merge = context.mergeImportedCommunicationTemplateNamedRanges;
const both = merge({ ЧужоеПоле: "не менять" }, {
  ПереченьДокументовДПП: "DPP\rline",
  ПереченьДокументовДОП: "DOP",
  АдресАнкеты: "https://survey.example",
  СсылкаНаОплату: ""
});
assert.strictEqual(
  both.ПереченьДокументов,
  "{{если:ДПО}}DPP\nline{{иначе}}DOP{{конец}}"
);
assert.strictEqual(both.СсылкаАнкеты, "https://survey.example");
assert.strictEqual(both.СсылкаОплаты, "", "Пустое значение именованного диапазона должно импортироваться");
assert.strictEqual(both.ЧужоеПоле, "не менять");

const partial = merge({
  ПереченьДокументов: "{{если:ДПО}}old dpp{{иначе}}keep dop{{конец}}",
  СсылкиСоцсети: "old"
}, { ПереченьДокументовДПП: "new dpp" });
assert.strictEqual(
  partial.ПереченьДокументов,
  "{{если:ДПО}}new dpp{{иначе}}keep dop{{конец}}"
);
assert.strictEqual(partial.СсылкиСоцсети, "old");
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(merge({ ЧужоеПоле: "x" }, null))),
  { ЧужоеПоле: "x" }
);

const payloadMentions = source.match(/communicationTemplateFields,/gu) || [];
assert.ok(payloadMentions.length >= 2, "Поля должны передаваться при синхронизации и скачивании XLSB");
assert.match(source, /runStudentDatabaseImport[\s\S]{0,700}communicationTemplateFields:/u);
assert.match(source, /communicationTemplateFieldOverrides:\s*nextCommunicationTemplateFieldOverrides/u);

console.log("Student database communication-template client tests passed.");
