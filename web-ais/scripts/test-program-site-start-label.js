"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pg = require("../program-site-generator");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const php = fs.readFileSync(path.join(__dirname, "..", "services/wordpress/ais-program-generator.php"), "utf8");
const context = {Event};
vm.createContext(context);
vm.runInContext(app.match(/  function applyProgramSitePrototypeStartLabel\([\s\S]*?\n  }/)[0], context);
const apply = context.applyProgramSitePrototypeStartLabel;
const events = [];
const control = {value: "", dispatchEvent: event => events.push(event)};
assert.equal(apply(control, {startLabel: "По мере набора группы"}), true);
assert.equal(control.value, "По мере набора группы");
assert.equal(events[0].type, "input"); assert.equal(events[0].bubbles, true);
assert.equal(apply(control, {startLabel: "Ежедневно"}), false, "Loading/reloading catalog preserves saved/manual value");
assert.equal(apply(control, {startLabel: "01.10.2026"}, true), true, "Changing prototype replaces previous wording");
assert.equal(control.value, "01.10.2026");
assert.equal(apply(control, {startLabel: ""}, true), true);
assert.equal(control.value, "", "Empty prototype does not inject Daily or webinar date");
assert.equal(apply(control, {startLabel: ["bad"]}, true), false);
assert.equal(apply(control, null, true), false);
assert.equal(apply(null, {startLabel: "test"}), false);
control.value = "Мой срок";
assert.equal(apply(control, {startLabel: "Из прототипа"}), false);
assert.equal(control.value, "Мой срок");
assert.match(app, /const onTemplateChange = \(\) => \{[\s\S]*?updatePrototypeLink\(true\)/u);
assert.match(php, /'startLabel' => ais_pg_start_label\(\$post->ID\)/u);
assert.doesNotMatch(app, /Начало обучения на сайте \(по умолчанию — ежедневно\)/u);

for (const type of ["ПРО", "ДОП", "КПК", "ППП"]) {
  const program = {id: "test", type, name: "Программа", price: 100, hours: 2, landingCode: "test-course", webinarDate: "2026-10-05", webinarTime: "18:00", webinarJoinUrl: "https://salutejazz.ru/test"};
  for (const startLabel of ["По мере набора группы", "01.10.2026", "Ежедневно", ""]) {
    const template = {fields: {data_starta: startLabel, ssylka_na_registraciyu: "https://zifra-plus.ru/checkout/?add-to-cart=1"}};
    const original = JSON.stringify(template);
    assert.equal(pg.buildLandingFields(template, pg.normalizeProgram(program), 2).data_starta, startLabel);
    assert.equal(pg.buildLandingFields(template, pg.normalizeProgram({...program, siteStartLabel: "Мой срок"}), 2).data_starta, "Мой срок");
    assert.equal(JSON.stringify(template), original, "Prototype unchanged");
  }
  assert.equal(pg.normalizeSyncProgram({...program, siteStartLabel: "Мой срок"}).startLabel, "Мой срок");
  assert.equal(pg.normalizeSyncProgram(program).startLabel, "", "Blank sync input does not replace live site wording");
}
console.log("PASS: prototype start labels for all 4 types, explicit override, empty field, selection/reload, sync preservation");
