"use strict";
const assert = require("node:assert/strict");
const pg = require("../program-site-generator");
const samples = require("../program-site-certificates");
const program = {id: "sample-sync", type: "КПК", name: "Текущая программа (72 ч)", nameEnglish: "Current programme", hours: 72, price: 6000, oldPrice: 8000,
  landingCode: "42", webinarDate: "2026-09-20", webinarTime: "18:00", siteSampleDate: "2026-09-20"};
const landing = {id: 42, title: "Прежняя программа", version: "landing-v1", url: "https://edu-plus.ru/courses-pk/legacy-name/", offers: [{index: 0, productId: 13}]};
const product = {id: 13, version: "product-v1", title: "Товар", url: "https://zifra-plus.ru/product/existing/"};
let data, template, calls, generated, preparationUrls, failAt;
const reset = () => {data = {collections: {trainingPlans: [{programId: program.id, discipline: "Новая дисциплина", totalHours: "72"}]}}; template = Buffer.from("current-template"); calls = []; generated = 0; preparationUrls = []; failAt = "";};
const factory = async source => {
  preparationUrls.push(source.siteSampleLandingUrl);
  const prepared = await samples.prepare(source, data, true, {loadTemplate: async request => {assert.equal(request.preferLocalTemplate, true); return template;}});
  return {hash: prepared.hash, generate: async report => {
    generated++; report("Подготовка образцов");
    if (failAt === "render") throw new Error("Ошибка преобразования образцов");
    return (pg.PROGRAM_TYPES[source.type].bilingual ? ["ru", "en"] : ["ru", "page-2", "page-3", "page-4"])
      .map(language => ({language, label: language, base64: "synthetic-test"}));
  }};
};
const call = async (site, endpoint, body) => {
  calls.push({site, endpoint, body: structuredClone(body)});
  if (failAt === `${site}${endpoint}`) throw new Error("test failure");
  if (endpoint === "/health") return {sampleSync: failAt !== "old-module"};
  if (endpoint === "/resolve-site") return structuredClone(landing);
  if (endpoint === "/sync-product/13") return structuredClone(product);
  if (endpoint === "/check-sync") return {ok: true};
  if (endpoint === "/sync-certificate-assets") return {images: body.images.slice(0, failAt === "missing-page" ? -1 : undefined)
    .map((image, i) => ({id: i + 100, language: image.language, url: `https://edu-plus.ru/wp-content/uploads/sample-${i}.jpg`}))};
  if (endpoint === "/sync-existing") return site === "edu" ? {...landing} : {...product};
  assert.fail(endpoint);
};
const noWrites = () => assert.ok(!calls.some(c => ["/sync-certificate-assets", "/sync-existing"].includes(c.endpoint)));
async function main() {
  reset();
  const plain = await pg.previewSync(program, call, 13);
  const plainResult = await pg.synchronize(program, call, 13, plain.hash);
  assert.equal(plainResult.certificates, undefined); assert.equal(generated, 0);
  assert.ok(!calls.some(c => ["/health", "/sync-certificate-assets"].includes(c.endpoint)), "Unchecked option preserves old workflow");
  for (const type of ["ПРО", "ДОП", "КПК", "ППП"]) {
    reset(); const source = {...program, type};
    const plan = await pg.previewSync(source, call, 13, 0, factory);
    assert.equal(generated, 0); noWrites(); assert.equal(plan.model.updateSamples, true);
    assert.notEqual(plan.hash, plain.hash); assert.equal(plan.certificate, undefined);
    assert.equal(preparationUrls[0], landing.url, "Legacy ID must not become the sample QR slug");
    const steps = [];
    const result = await pg.synchronize(source, call, 13, plan.hash, 0, step => steps.push(step), factory);
    assert.equal(generated, 1); assert.equal(result.certificates.length, pg.PROGRAM_TYPES[type].bilingual ? 2 : 4);
    assert.ok(steps.includes("Подготовка образцов"));
    const upload = calls.findIndex(c => c.endpoint === "/sync-certificate-assets");
    const write = calls.findIndex(c => c.endpoint === "/sync-existing");
    assert.ok(upload < write && calls.slice(upload + 1, write).some(c => c.endpoint === "/check-sync" && c.body.certificatePages));
    const applied = calls.find(c => c.endpoint === "/sync-existing" && c.site === "edu").body;
    assert.equal(applied.certificatePages.length, result.certificates.length);
    assert.equal(applied.model.certificateHash, plan.model.certificateHash);
    assert.equal(applied.fields, undefined, "Never send prototype fields/reviews/other offers");
    assert.ok(!JSON.stringify(result).includes("base64"));
  }
  for (const change of [() => {data.collections.trainingPlans[0].discipline = "Изменённый учебный план";}, () => {template = Buffer.from("updated-template");}]) {
    reset(); const plan = await pg.previewSync(program, call, 13, 0, factory); change(); calls = [];
    await assert.rejects(pg.synchronize(program, call, 13, plan.hash, 0, () => {}, factory), /изменились/);
    noWrites(); assert.equal(generated, 0, "Stale sample hash blocks generation and both site writes");
  }
  reset(); const plan = await pg.previewSync(program, call, 13, 0, factory); calls = [];
  await assert.rejects(pg.synchronize(program, call, 13, plan.hash), /изменились/); noWrites();
  for (const error of ["old-module", "render", "edu/check-sync", "shop/check-sync", "missing-page"]) {
    reset(); const plan = await pg.previewSync(program, call, 13, 0, factory); calls = []; failAt = error;
    await assert.rejects(pg.synchronize(program, call, 13, plan.hash, 0, () => {}, factory));
    assert.ok(!calls.some(c => c.endpoint === "/sync-existing"), `${error}: do not alter sites after failure`);
    if (error !== "missing-page") noWrites();
  }
  reset();
  const renamed = await pg.previewSync({...program, promoSite: "https://edu-plus.ru/new-address"}, call, 13, 0, factory);
  assert.equal(preparationUrls[0], renamed.model.landingUrl); assert.match(preparationUrls[0], /new-address/);
  assert.throws(() => samples.sampleSource({...program, siteTrainingPlan: [{}], siteSampleLandingUrl: "https://untrusted.example/page"}), /адрес/);
  console.log("PASS: optional sample sync, all programme types/pages, current plan/template hash, read-only preview, legacy/new QR URLs, preflight/partial failure and no collateral site fields");
}
main().catch(error => {console.error(error); process.exitCode = 1;});
