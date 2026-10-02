"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
const server = require("../app-server");
const c = vm.createContext({
  getContractTemplateRawSourceValue: (key, record) => key === "ФИО" ? record.name : record.workflowSourceValues?.[key] || "",
  getContractTemplateSourceValue: (key, record) => key === "ФИО" ? record.name : record.workflowSourceValues?.[key] || ""
});
const extract = name => {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name); return match[0];
};
vm.runInContext(["resolveContractTemplateFioFormulaValue", "inflectContractNamePartDative", "evaluateContractFormulaFallback", "splitFullName", "inferStudentGender", "normalizeFioGender", "isChecked", "inflectRussianNamePart", "inflectRussianSimpleNamePart", "matchNameLetterCase"].map(extract).join("\n"), c);
const female = {name: "Пащенко Мария Александровна", gender: "Женский"};
const cases = [
  ['=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"ИОФ")', female, "Мария Александровна Пащенко"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"ИО")', female, "Мария Александровна"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"И О")', female, "Мария Александровна"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"ФИ.О.")', female, "Пащенко М.А."],
  ['=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"И.О.Ф")', female, "М.А. Пащенко"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"И.О.")', female, "М.А."],
  ['=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"Ф")', female, "Пащенко"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"И")', female, "Мария"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО]; "И";"О")', female, "Александровна"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО];;"Д";;"ИОФ")', female, "Марии Александровне Пащенко"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО];;"Р";;"ФИО")', female, "Пащенко Марии Александровны"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО])', female, "Пащенко Марии Александровны"],
  ['=склонение_фио([ФИО];"и";"иоф")', female, "Мария Александровна Пащенко"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО];"Д")', {name:"Иванов Пётр Павлович",gender:"Мужской"}, "Иванову Петру Павловичу"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО];"Р")', {name:"Иванов Пётр Павлович",gender:"Мужской",noDeclension:true}, "Иванов Петра Павловича"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО];"Д")', {name:"Иванова Любовь Павловна",gender:"Женский"}, "Ивановой Любови Павловне"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО];"Д")', {name:"Ковалевская Мария Павловна",gender:"Женский"}, "Ковалевской Марии Павловне"],
  ['=СКЛОНЕНИЕ_ФИО("Петров Пётр Петрович";"И";"ИО")', female, "Пётр Петрович"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО];"И";"ИОФ")', {name:"Иванов Иван"}, "Иван Иванов"],
  ['=СКЛОНЕНИЕ_ФИО([ФИО];"И";"ИОФ")', {name:""}, ""]
];
for (const [formula, record, expected] of cases) {
  assert.equal(c.evaluateContractFormulaFallback(formula, record, {}), expected, `Client ${formula}`);
  assert.equal(server.evaluateDocumentFormula(formula, {fieldValues:{},sourceValues:{"ФИО":record.name,"Пол":record.gender || "","ФИО_несклон":record.noDeclension ? "+" : ""}}), expected, `Server ${formula}`);
}
assert.equal(c.evaluateContractFormulaFallback('=СКЛОНЕНИЕ_ФИО(#Полное имя#;"И";"ИОФ")', female, {}, name => name === "Полное имя" ? female.name : ""), "Мария Александровна Пащенко");
assert.equal(c.evaluateContractFormulaFallback('=СКЛОНЕНИЕ_ФИО("#Полное имя#";"И";"ИОФ")', female, {"Полное имя":female.name}), "Мария Александровна Пащенко");
assert.equal(c.evaluateContractFormulaFallback('=СКЛОНЕНИЕ_ФИО("[ФИО]";"И";"ИОФ")', female, {}), "Мария Александровна Пащенко");
assert.equal(c.evaluateContractFormulaFallback('=СКЛОНЕНИЕ_ФИО([Председатель];"И";"ИО")', {...female,workflowSourceValues:{"Председатель":"Петров Пётр Петрович"}}, {}), "Пётр Петрович");
assert.equal(c.evaluateContractFormulaFallback('=СКЛОНЕНИЕ_ФИО("Фамилия;тест Имя Отчество";"И";"ИОФ")', female, {}), "Имя Отчество Фамилия;тест");
assert.equal(c.evaluateContractFormulaFallback('=СКЛОНЕНИЕ_ФИО("Фамилия""тест Имя Отчество";"И";"ИОФ")', female, {}), 'Имя Отчество Фамилия"тест');
for (const formula of ['=СКЛОНЕНИЕ_ФИО([ФИО];"И";"ИОФ") + alert(1)', '=СКЛОНЕНИЕ_ФИО(fetch("/secret");"И";"ИОФ")', '=СКЛОНЕНИЕ_ФИО([ФИО];"И";"ИОФ";"";"";"")']) {
  assert.equal(c.resolveContractTemplateFioFormulaValue(formula, female, {}), null, "Never execute arbitrary expressions");
}
assert.equal(c.evaluateContractFormulaFallback('=[ФИО]', female, {}), female.name, "Other source-field formulas are unchanged");
console.log("PASS: frontend/backend FIO modes, nominal/genitive/dative, Assistant signatures, missing patronymic, references, preserved surname and safe literal parsing");
