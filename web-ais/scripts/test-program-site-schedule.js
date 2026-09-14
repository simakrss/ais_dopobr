"use strict";
const assert = require("node:assert/strict");
const pg = require("../program-site-generator");
const fixtures = require("./fixtures/program-site-schedule.json");
const program = {id: "schedule-fixture", type: "ПРО", name: "Новый вебинар", hours: 1, price: 390, landingCode: "old-auto-slug", promoSite: "https://edu-plus.ru/web_nazv", webinarDate: "2027-09-18", webinarTime: "09:35", webinarJoinUrl: "https://salutejazz.ru/test"};
const model = pg.normalizeProgram(program);
for (const fixture of fixtures) {
  assert.deepEqual(pg.updateWebinarSchedule(fixture.source, model, fixture.name), fixture.expected, fixture.name + ": " + JSON.stringify(fixture.source));
  assert.deepEqual(pg.updateWebinarSchedule(fixture.expected, model, fixture.name), fixture.expected, "Idempotent replacement");
  for (const type of ["ДОП", "ППП", "КПК"]) assert.deepEqual(pg.updateWebinarSchedule(fixture.source, {...model, type}, fixture.name), fixture.source);
}
async function main() {
  const template = {id: 42, title: "Прототип", modified: "version", postType: "other-course", fields: {
    opisanie_dokumenta: fixtures[1].source, opisanie_o_programme: fixtures[2].source,
    tekst_etap_obucheniya_1: fixtures[6].source, blok_opisaniya_kursa: fixtures[7].source,
    ssylka_na_registraciyu: "old", izobrazhenie_vydavaemogo_dokumenta: 1, prevyu_vydavaemogo_dokumenta_1: 1,
    izobrazhenie_vydavaemogo_dokumenta_2: 2, prevyu_vydavaemogo_dokumenta_2: 2
  }};
  const images = [{id: 11, language: "ru"}, {id: 12, language: "en"}], writes = [];
  const call = async (site, endpoint, data) => {
    if (endpoint === "/template/42") return template;
    if (endpoint === "/certificate-assets") return {images};
    writes.push({site, endpoint, data});
    return {id: endpoint === "/prepare-product" ? 5112 : 4700, status: "draft"};
  };
  const result = await pg.prepare(program, 42, call, {hash: "certificate-hash", generate: async () => images});
  const product = writes.find(item => item.site === "shop").data;
  const landing = writes.find(item => item.site === "edu").data;
  assert.equal(product.slug, "web_nazv"); assert.equal(landing.slug, product.slug);
  assert.equal(product.descriptionHtml, fixtures[1].expected);
  assert.equal(landing.fields.opisanie_dokumenta, product.descriptionHtml);
  assert.equal(landing.fields.opisanie_o_programme, fixtures[2].expected);
  assert.deepEqual(landing.fields.blok_opisaniya_kursa, fixtures[7].source);
  assert.equal(landing.date, program.webinarDate); assert.equal(landing.time, program.webinarTime);
  assert.match(result.promoMessage, /18.09.2027 в 09:35/);
  assert.equal(template.fields.opisanie_dokumenta, fixtures[1].source, "Prototype never mutated");
  console.log("PASS: promo URL slug on both sites, schedule across HTML/numeric/text dates and repeated descriptions, authoritative parameters, preserved markup/reviews/biography, unchanged non-webinars");
}
main().catch(error => {console.error(error); process.exitCode = 1;});
