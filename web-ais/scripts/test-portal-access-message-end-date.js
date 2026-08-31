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

const context = { Intl, Date };
vm.createContext(context);
vm.runInContext([
  extractFunction("parseOrdersSdoDate"),
  extractFunction("getStudentCommunicationEndDate"),
  extractFunction("formatStudentCommunicationPortalEndDate"),
  extractFunction("syncStudentPortalEndDateLine")
].join("\n"), context);

const sync = context.syncStudentPortalEndDateLine;
assert.strictEqual(
  sync("Программа: Курс\nСрок обучения по: 01.01.2025 (среда)\nРучная строка", {
    endDate: "2026-08-30",
    extendedEndDate: "2026-08-31"
  }),
  "Программа: Курс\nСрок обучения по: 31.08.2026 (понедельник)\nРучная строка"
);
assert.strictEqual(
  sync("Ручной префикс\rСрок окончания обучения: 02.02.2025 (воскресенье)\rРучной хвост", {
    endDate: "2026-08-30"
  }),
  "Ручной префикс\rСрок окончания обучения: 30.08.2026 (воскресенье)\rРучной хвост"
);
assert.strictEqual(
  sync("Дата окончания обучения: 01.01.2025 (среда)\nРучной хвост", { endDate: "2026-08-31" }),
  "Дата окончания обучения: 31.08.2026 (понедельник)\nРучной хвост"
);
assert.strictEqual(
  sync("Логин: user\r\nПрограмма: Курс\r\nПароль: 123", { endDate: "2026-08-31" }),
  "Логин: user\r\nПрограмма: Курс\r\nСрок обучения по: 31.08.2026 (понедельник)\r\nПароль: 123"
);
assert.strictEqual(sync("Только ручной текст", {}), "Только ручной текст\nСрок обучения по: неограничен");
assert.strictEqual(sync("", { endDate: "2026-08-31" }), "");
const once = sync("Программа: Курс", { endDate: "2026-08-31" });
assert.strictEqual(sync(once, { endDate: "2026-08-31" }), once);

assert.match(source, /record\.portalAccessMessage \|\| generatedMessages\.portalAccessMessage[\s\S]{0,160}record\s*\)/u);
assert.match(source, /\["endDate", "extendedEndDate"\][\s\S]{0,360}updatePortalAccessEndDate/u);
assert.match(source, /messageKey === "portalAccessMessage"[\s\S]{0,160}syncStudentPortalEndDateLine/u);

console.log("Portal access end-date message tests passed.");
