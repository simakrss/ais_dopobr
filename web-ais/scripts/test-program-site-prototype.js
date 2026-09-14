"use strict";
// Read-only/memory-only regression checks; never creates real site content.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pg = require("../program-site-generator");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const extract = (start, end) => {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return app.slice(a, b);
};
async function main() {
  const landing = {id: 42, title: "Прототип", status: "publish", url: "https://edu-plus.ru/courses-pk/source/", fields: {private: "not sent"}, offers: [{productId: 12, hours: 72}]};
  const program = {id: "copy", landingCode: "42", hours: 72};
  const call = async (_site, endpoint) => endpoint === "/resolve-site" ? landing : {id: 12, title: "Товар", url: "https://zifra-plus.ru/product/course/"};
  const existing = await pg.inspectSite(program, call);
  assert.equal(existing.exists, true);
  assert.equal(existing.landing.fields, undefined);
  assert.equal(existing.product.id, 12);
  const missing = await pg.inspectSite({...program, landingCode: "new-course"}, async (_site, endpoint, data) => {
    assert.equal(endpoint, "/resolve-site");
    assert.equal(data.allowMissing, true);
    return {found: false};
  });
  assert.equal(missing.exists, false);
  assert.equal((await pg.inspectSite({}, () => assert.fail("Empty address requires no site lookup"))).exists, false);
  await assert.rejects(pg.inspectSite(program, async () => {throw new Error("Network failed");}), /Network failed/);
  await assert.rejects(pg.inspectSite(program, async () => ({})), /не подтвердил/);
  assert.equal((await pg.inspectSite({landingCode: "../bad"}, () => assert.fail("Invalid new code is generated automatically"))).exists, false);
  assert.equal((await pg.inspectSite({landingCode: "Имя", sitePublication: {landing: {id: 42}}}, call)).exists, true, "Invalid code must not hide an existing publication");
  const unavailableShop = await pg.inspectSite(program, async (site, endpoint) => {
    if (site === "shop") throw new Error("Shop unavailable");
    return landing;
  });
  assert.equal(unavailableShop.exists, true, "Shop failures must not enable creation of an existing landing");
  assert.match(unavailableShop.warning, /Shop unavailable/);
  const noProducts = await pg.inspectSite(program, async () => ({...landing, offers: []}));
  assert.equal(noProducts.exists, true);
  assert.match(noProducts.warning, /ссылки регистрации/);

  let admin = true, demo = false;
  const state = {data: {collections: {programs: [{id: "copy"}]}}};
  const context = {URL, state, isAdminUser: () => admin, isDatabaseDemoMode: () => demo};
  vm.createContext(context);
  vm.runInContext(extract("  function getDefaultProgramSiteTemplateId(", "  async function openProgramSiteGenerator("), context);
  vm.runInContext(extract("  function updateProgramSiteActions(", "  async function refreshProgramSiteLinks("), context);
  const catalog = [{id: 42, title: "Источник", url: "https://edu-plus.ru/courses-pk/source/"}, {id: 43, title: "Другой", url: "https://edu-plus.ru/courses-pk/another/"}];
  const duplicate = {landingCode: "new-course", sitePrototype: {landingCode: "42", name: "Источник"}};
  assert.equal(context.getDefaultProgramSiteTemplateId(duplicate, catalog), "42", "Source prototype remains selected after changing duplicate landing code");
  assert.equal(context.getDefaultProgramSiteTemplateId({...duplicate, siteTemplateId: "43"}, catalog), "43", "Explicit choice overrides default");
  assert.equal(context.getDefaultProgramSiteTemplateId({sitePrototype: {landingCode: "source"}}, catalog), "42");
  assert.equal(context.getDefaultProgramSiteTemplateId({sitePrototype: {landingId: 42}}, catalog), "42");
  assert.equal(context.getDefaultProgramSiteTemplateId({sitePrototype: {url: catalog[0].url}}, catalog), "42");
  assert.equal(context.getDefaultProgramSiteTemplateId({sitePrototype: {landingCode: "deleted"}}, catalog), "", "No guessing if the source is not available");
  assert.equal(context.getDefaultProgramSiteTemplateId({}, catalog), "");
  const buttons = Object.fromEntries(["create-program-on-site", "sync-program-with-sites", "resume-program-site"].map(key => [key, {}]));
  const form = {dataset: {id: "copy"}, querySelector: selector => buttons[selector.match(/data-action="([^"]+)"/)[1]]};
  const checkButtons = (result, create, sync, resume = false) => {
    context.updateProgramSiteActions(form, result);
    assert.equal(buttons["create-program-on-site"].disabled, !create);
    assert.equal(buttons["sync-program-with-sites"].disabled, !sync);
    assert.equal(buttons["resume-program-site"].hidden, !resume);
  };
  checkButtons(null, false, false);
  checkButtons(missing, true, false);
  checkButtons(existing, false, true);
  checkButtons(unavailableShop, false, true);
  state.data.collections.programs[0].sitePublication = {stage: "prepared", landing: {id: 42}};
  checkButtons(existing, false, true, true);
  checkButtons({...existing, landing: {id: 99}}, false, true);
  admin = false; checkButtons(missing, false, false); checkButtons(existing, false, false, true);
  admin = true; demo = true; checkButtons(missing, false, false);
  assert.equal(buttons["resume-program-site"].disabled, true);

  assert.match(app, /data-site-template[^>]+required/);
  assert.match(app, /if \(!select\.value \|\| !select\.reportValidity\(\)\)/);
  assert.match(extract("  function renderProgramGeneratorFields(", "  function getDefaultProgramSiteTemplateId("), /"siteDescription", "siteSpeaker"\]\.includes/);
  assert.match(app, /values\.sitePrototype = copyDuplicateFieldValue\(sourcePrototype\)/);
  assert.match(app, /values\.siteTemplateId = String\(formData\.get\("siteTemplateId"\)/);
  for (const id of [undefined, "", 0, -1, "foo", 1.5]) assert.throws(() => pg.validateTemplateId(id), /обязательное/);
  assert.equal(pg.validateTemplateId("42"), 42);
  context.escapeAttr = value => String(value).replaceAll('"', '&quot;');
  context.configs = {programs: {fields: ["webinarDate", "webinarTime", "webinarJoinUrl", "siteDescription", "siteSpeaker"].map(key => ({key, options: {programTab: "site"}}))}};
  context.renderField = (field, record) => `<label><input name="${field.key}" value="${context.escapeAttr(record[field.key] || '')}"></label>`;
  vm.runInContext(extract("  function renderProgramGeneratorFields(", "  function getDefaultProgramSiteTemplateId("), context);
  const jazzUrl = "https://jazz.sber.ru/meeting?psw=example";
  const webinarFields = context.renderProgramGeneratorFields({type: "ПРО", webinarJoinUrl: jazzUrl});
  assert.match(webinarFields, /class="program-site-jazz-link-row"><label><input name="webinarJoinUrl"/);
  assert.match(webinarFields, /href="https:\/\/salutejazz\.ru\/calls" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"/);
  assert.ok(webinarFields.includes(jazzUrl), "The existing meeting link remains unchanged");
  assert.doesNotMatch(webinarFields, /name="siteDescription"|name="siteSpeaker"/);
  assert.match(context.renderProgramGeneratorFields({type: "КПК"}), /data-site-webinar-only hidden/);
  const css = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");
  assert.match(css, /\.program-site-jazz-link-row\s*\{[^}]*flex-wrap: wrap/);
  console.log("PASS: required/source prototype, saved selection, exact presence, offline fail-closed, invalid new code generation, shop independence, mutually exclusive actions, draft continuation");
}
main().catch(error => {console.error(error); process.exitCode = 1;});
