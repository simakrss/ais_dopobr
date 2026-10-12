"use strict";
const assert = require("node:assert/strict");
const pg = require("../program-site-generator");
const source = {id: 77, imageId: 91, imageUrl: "https://edu-plus.ru/wp-content/uploads/cover.jpg", version: "a".repeat(64), title: "Другой лендинг"};
const template = {id: 42, modified: "v1", fields: {blok_ceny: [{ssylka_na_registraciyu: "https://zifra-plus.ru/checkout/?add-to-cart=12"}]}};
Object.assign(template.fields, {izobrazhenie_vydavaemogo_dokumenta: 1, prevyu_vydavaemogo_dokumenta_1: 1, izobrazhenie_vydavaemogo_dokumenta_2: 2, prevyu_vydavaemogo_dokumenta_2: 2, slajder: []});
const landing = {id: 13, version: "l1", offers: [{productId: 12, hours: 72}], fields: {}};
const product = {id: 12, version: "p1", status: "draft"};
const program = {id: "test", type: "КПК", name: "Тестовая программа", hours: 72, price: 390, landingCode: "example", siteImageSourceId: "77", webinarDate: "2026-09-18", webinarTime: "18:00", webinarJoinUrl: "https://salutejazz.ru/example"};
let calls = [], currentSource = source;
const call = async (site, endpoint, body) => {
  calls.push({site, endpoint, body});
  if (endpoint.startsWith("/image-source/")) return structuredClone(currentSource);
  if (endpoint.startsWith("/template/")) return structuredClone(template);
  if (endpoint === "/certificate-assets") return {images: body.images};
  if (endpoint === "/resolve-site") return structuredClone(landing);
  if (endpoint.startsWith("/sync-product/")) return structuredClone(product);
  if (endpoint === "/check-sync") return {ok: true};
  if (endpoint === "/prepare-product") return {id: 12, status: "draft"};
  if (endpoint === "/prepare-landing") return {id: 13, status: "draft"};
  if (endpoint === "/sync-existing") return {id: site === "edu" ? 13 : 12};
  assert.fail(endpoint);
};
async function main() {
  for (const empty of ["", null, undefined, 0, "0"]) assert.equal(pg.validateImageSourceId(empty), 0);
  for (const bad of [-1, "abc", 1.2, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => pg.validateImageSourceId(bad));
  for (const type of ["ПРО", "ДОП", "КПК", "ППП"]) {
    calls = [];
    const languages = ["ПРО", "ДОП"].includes(type) ? ["ru", "en"] : ["ru", "page-2", "page-3"];
    const cert = {hash: "b".repeat(64), generate: async () => languages.map((language, index) => ({id: index + 1, language, base64: "fixture"}))};
    const result = await pg.prepare({...program, type}, 42, call, cert);
    assert.equal(result.imageSourceId, 77);
    assert.equal(result.gradeReportUrl, type === "ПРО" ? program.webinarJoinUrl : undefined, "Only PRO replaces the grade report URL");
    assert.equal(calls.find(c => c.endpoint === "/prepare-product").body.imageUrl, source.imageUrl);
    assert.equal(calls.find(c => c.endpoint === "/prepare-product").body.productTemplateId, 12, "Shop category source is the landing's product, not the separately selected image source");
    assert.deepEqual(calls.find(c => c.endpoint === "/prepare-landing").body.imageSource, source);
    assert.equal(calls.some(c => c.endpoint === "/publish"), false, "Selecting an image cannot publish a draft");
    currentSource = {...source, version: "c".repeat(64)};
    await assert.rejects(pg.publish({...program, type}, 42, result.hash, call, cert), /изменились/);
    assert.equal(calls.some(c => c.endpoint === "/publish"), false, "Changed image blocks publication of reviewed drafts");
    currentSource = source;
  }
  calls = [];
  const unchanged = await pg.previewSync(program, call, 12);
  assert.equal(unchanged.model.imageSource, undefined, "Sync defaults to preserving images, not saved generator preference");
  assert.equal(calls.some(c => c.endpoint.startsWith("/image-source/")), false);
  const selected = await pg.previewSync(program, call, 12, 77);
  assert.notEqual(selected.hash, unchanged.hash);
  calls = [];
  await pg.synchronize(program, call, 12, selected.hash, 77);
  for (const request of calls.filter(c => ["/check-sync", "/sync-existing"].includes(c.endpoint))) assert.deepEqual(request.body.model.imageSource, source);
  currentSource = {...source, version: "c".repeat(64)};
  calls = [];
  await assert.rejects(pg.synchronize(program, call, 12, selected.hash, 77), /изменились/);
  assert.equal(calls.some(c => c.endpoint === "/sync-existing"), false);
  for (const patch of [{imageUrl: "https://evil.example/cover.jpg"}, {imageUrl: source.imageUrl.replace(".jpg", ".svg")}, {imageId: 0}, {id: 999}, {version: "bad"}]) {
    currentSource = {...source, ...patch}; calls = [];
    await assert.rejects(pg.previewSync(program, call, 12, 77), /изображения/);
    assert.equal(calls.some(c => c.endpoint === "/sync-existing"), false);
  }
  console.log("PASS: all program types, one selected image for both sites, preserve-by-default sync, source validation, stale preview protection, no implicit publication");
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
