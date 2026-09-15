"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const server = require("../app-server");

const genitiveFormula = '=СКЛОНЕНИЕ_ФИО([ФИО];;"Р";;"ФИО")';
const conditionalFormula = '=ЕСЛИ([ФИО_несклон]="+";СКЛОНЕНИЕ_ФИО([ФИО];;"И";;"Ф") & " " & СКЛОНЕНИЕ_ФИО([ФИО];;"Р";;"ИО");СКЛОНЕНИЕ_ФИО([ФИО];;"Р";;"ФИО"))';

function evaluate(formula, name, options = {}) {
  return server.evaluateDocumentFormula(formula, {
    fieldValues: {},
    sourceValues: {
      "ФИО": name,
      "ФИО_несклон": options.preserveSurname ? "+" : "",
      "Пол": options.gender || ""
    }
  });
}

const cases = [
  ["Добрышкина Екатерина Сергеевна", "Добрышкиной Екатерины Сергеевны"],
  ["Таргонская Ирина Сергеевна", "Таргонской Ирины Сергеевны"],
  ["Симак Варвара Романовна", "Симак Варвары Романовны"],
  ["Волкова Любовь Игоревна", "Волковой Любови Игоревны"],
  ["Иванов Павел Ильич", "Иванова Павла Ильича"],
  ["Ильин Никита Ильич", "Ильина Никиты Ильича"],
  ["Петров Илья Сергеевич", "Петрова Ильи Сергеевича"],
  ["Орлова Анна-Мария Олеговна", "Орловой Анны-Марии Олеговны"]
];

cases.forEach(([source, expected]) => {
  assert.equal(evaluate(genitiveFormula, source), expected, source);
});

assert.equal(
  evaluate(conditionalFormula, "Симак Варвара Романовна", { preserveSurname: true, gender: "Ж" }),
  "Симак Варвары Романовны",
  "Флажок «Не склоняется фамилия» должен сохранять фамилию и склонять имя с отчеством"
);
assert.equal(
  evaluate(genitiveFormula, "Ким Никита", { gender: "М" }),
  "Кима Никиты",
  "Явно указанный пол должен использоваться при отсутствии отчества"
);
assert.equal(
  evaluate('=СКЛОНЕНИЕ_ФИО([ФИО];;"Д";;"ФИО")', "Иванов Павел Ильич", { gender: "М" }),
  "Иванову Павлу Ильичу",
  "Исправление родительного падежа не должно ломать дательный"
);

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
assert.match(
  appSource,
  /case "ФИО_обуч_род":[\s\S]*?record\.gender \|\| ""/u,
  "Клиентский предварительный расчёт должен учитывать пол из карточки"
);
assert.match(
  appSource,
  /role === "surname" && \/\(ова\|ева\|ёва\|ина\|ына\)\$\/i/u,
  "Фамильное окончание -ина не должно применяться к имени"
);

console.log(`FIO declension tests passed: ${cases.length + 3}`);
