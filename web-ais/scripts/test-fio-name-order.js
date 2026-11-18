"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const server = require("../app-server");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
const client = vm.createContext({
  getContractTemplateRawSourceValue: (key, record) => key === "ФИО" ? record.name : "",
  getContractTemplateSourceValue: (key, record) => key === "ФИО" ? record.name : ""
});
const functions = ["resolveContractTemplateFioFormulaValue", "inflectContractNamePartDative",
  "evaluateContractFormulaFallback", "splitFullName", "inferStudentGender", "normalizeFioGender",
  "isChecked", "inflectFioGenitive", "inflectRussianNamePart", "inflectRussianSimpleNamePart", "matchNameLetterCase"];
vm.runInContext(functions.map(name => {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}).join("\n"), client);

// Fixtures only: no student records, documents or database are changed.
const cases = [
  ["Почкалова", "Мария Александровна", "Почкаловой", "Марии Александровны", "Марии Александровне"],
  ["Покачалова", "Мария Александровна", "Покачаловой", "Марии Александровны", "Марии Александровне"],
  ["Иванова", "Анна Сергеевна", "Ивановой", "Анны Сергеевны", "Анне Сергеевне"],
  ["Никитина", "Екатерина Ильинична", "Никитиной", "Екатерины Ильиничны", "Екатерине Ильиничне"],
  ["Ковалевская", "Любовь Павловна", "Ковалевской", "Любови Павловны", "Любови Павловне"],
  ["Синяя", "Мария Олеговна", "Синей", "Марии Олеговны", "Марии Олеговне"],
  ["Иванова-Петрова", "Анна-Мария Олеговна", "Ивановой-Петровой", "Анны-Марии Олеговны", "Анне-Марии Олеговне"],
  ["Пащенко", "Мария Александровна", "Пащенко", "Марии Александровны", "Марии Александровне"],
  ["Симак", "Варвара Романовна", "Симак", "Варвары Романовны", "Варваре Романовне"],
  ["Иванов", "Пётр Павлович", "Иванова", "Петра Павловича", "Петру Павловичу", "Иванову"],
  ["Петров", "Никита Ильич", "Петрова", "Никиты Ильича", "Никите Ильичу", "Петрову"]
];
let assertions = 0;
function check(formula, record, expected) {
  assert.equal(client.evaluateContractFormulaFallback(formula, record, {}), expected, `Client: ${record.name}; ${formula}`);
  assert.equal(server.evaluateDocumentFormula(formula, { fieldValues: {}, sourceValues: {
    "ФИО": record.name, "Пол": record.gender || "", "ФИО_несклон": record.noDeclension ? "+" : ""
  } }), expected, `Server: ${record.name}; ${formula}`);
  assertions += 2;
}
for (const [surname, names, genSurname, genNames, datNames, datSurname = genSurname] of cases) {
  for (const name of [`${names} ${surname}`, `${surname} ${names}`]) {
    const record = Object.freeze({ name });
    check('=СКЛОНЕНИЕ_ФИО([ФИО];"Р";"ИОФ")', record, `${genNames} ${genSurname}`);
    check('=СКЛОНЕНИЕ_ФИО([ФИО];;"Р";;"ФИО")', record, `${genSurname} ${genNames}`);
    check('=СКЛОНЕНИЕ_ФИО([ФИО];"Д";"ИОФ")', record, `${datNames} ${datSurname}`);
    check('=СКЛОНЕНИЕ_ФИО([ФИО];"И";"ИОФ")', record, `${names} ${surname}`);
    check('=СКЛОНЕНИЕ_ФИО([ФИО];"Р";"ИОФ")', { ...record, noDeclension: true }, `${genNames} ${surname}`);
    assert.equal(client.inflectFioGenitive(name), `${genSurname} ${genNames}`, "Built-in document field uses the same roles");
    assert.equal(record.name, name, "Never rewrite the source record");
  }
}
check('=СКЛОНЕНИЕ_ФИО([ФИО];"И";"ФИ.О.")', { name: "Мария Александровна Почкалова" }, "Почкалова М.А.");
check('=СКЛОНЕНИЕ_ФИО([ФИО];"Р";"Ф")', { name: "  Мария\u00a0Александровна\tПочкалова  ", gender: "Ж" }, "Почкаловой");
check('=СКЛОНЕНИЕ_ФИО([ФИО];"Р";"ИОФ")', { name: "Почкалова Мария", gender: "Ж" }, "Марии Почкаловой");
check('=СКЛОНЕНИЕ_ФИО([ФИО];"Р";"ИОФ")', { name: "Ким Никита", gender: "М" }, "Никиты Кима");
// Do not guess the order from arbitrary words or initials.
assert.equal(JSON.stringify(client.splitFullName("Фамилия Имя Отчество")), JSON.stringify({ surname: "Фамилия", firstName: "Имя", patronymic: "Отчество" }));
assert.equal(JSON.stringify(client.splitFullName("Иванова А. С.")), JSON.stringify({ surname: "Иванова", firstName: "А.", patronymic: "С." }));
console.log(`PASS: ${assertions} frontend/server name-order checks, built-in fields and source preservation`);
