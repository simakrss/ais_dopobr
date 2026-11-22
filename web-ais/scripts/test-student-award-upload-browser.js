"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const extract = name => { const match = app.match(new RegExp(`^  async function ${name}\\([\\s\\S]*?^  }`, "m")); assert.ok(match, name); return match[0]; };
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
  try {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("http://127.0.0.1:39201/**", route => route.fulfill({ contentType: "text/html", body: "<main></main>" }));
    await page.goto("http://127.0.0.1:39201/");
    await page.addScriptTag({ content: `
      let mode = 'local', requests = [], probes = 0;
      const state = { modal: { id: 'student', draft: {} }, data: { collections: { students: [{ id: 'student', educationType: 'КПК' }] } } };
      const recordLockClientId = 'own-card';
      const studentCabinetProgramAllowed = () => true;
      const getOpenDocumentsLocally = () => mode !== 'yandex';
      const photoServerOrigin = () => location.origin;
      const documentProcessingApiUrl = (url, origin) => origin + url;
      const probeLocalDocumentServices = async () => { probes++; return { localDocumentsAvailable: mode !== 'unavailable',
        studentAwardLocalUploadAvailable: mode !== 'older-local',
        apiOrigin: ['remote-local','older-local'].includes(mode) ? 'http://127.0.0.1:39202' : location.origin }; };
      const success = storage => ({ ok: true, storage, files: [{ id: 'saved', name: 'Скан.pdf', kind: 'scan', storage }] });
      window.AIS_AUTH_API = { request: async (url, options) => {
        const body = JSON.parse(options.body); requests.push({ channel: 'authenticated', url, body });
        if (body.operation === 'local-ticket') return { ticket: 'single-use-fixture' };
        if (mode === 'fail-local') throw new Error('Локальная папка документов недоступна.');
        return success(body.storage);
      } };
      window.fetch = async (url, options) => {
        requests.push({ channel: 'local', url, body: JSON.parse(options.body), credentials: options.credentials });
        return new Response(JSON.stringify(success('local')), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      const draw = () => {
        document.querySelector('main').innerHTML = '<form id="recordForm"><div class="education-document-actions">'
          + '<button type="button" data-action="upload-student-award-scan">Загрузить скан</button>'
          + '<input type="file" data-student-award-upload><p data-award-upload-status role="status"></p></div></form>';
        document.querySelector('[data-student-award-upload]').addEventListener('change', uploadStudentAwardScan);
      };
      const saveRecordFormBeforeContinuation = async () => { draw(); return 'student'; };
      ${extract("saveStudentAwardFile")}
      ${extract("uploadStudentAwardScan")}
      draw();
    ` });
    const content = Buffer.from("%PDF-1.4\nfixture-scan"), sha256 = crypto.createHash("sha256").update(content).digest("hex");
    for (const scenario of ["local", "yandex", "remote-local", "unavailable", "older-local", "fail-local"]) {
      await page.evaluate(scenario => { mode = scenario; requests = []; probes = 0; state.modal.draft = {}; draw(); }, scenario);
      await page.locator('[data-student-award-upload]').setInputFiles({ name: 'Скан.pdf', mimeType: 'application/pdf', buffer: content });
      await page.waitForFunction(() => Boolean(document.querySelector('[data-award-upload-status]').textContent)
        && !document.querySelector('[data-student-award-upload]').disabled);
      const result = await page.evaluate(() => ({ requests, probes, status: document.querySelector('[data-award-upload-status]').textContent,
        files: state.modal.draft.educationDocumentFiles, busy: document.querySelector('button').hasAttribute('aria-busy') }));
      assert.equal(result.busy, false);
      if (scenario === 'older-local') {
        assert.match(result.status, /обновления локальной АИС/); assert.equal(result.requests.length, 0); continue;
      }
      if (scenario === 'unavailable') {
        assert.match(result.status, /Локальная папка.*недоступна/); assert.equal(result.requests.length, 0); continue;
      }
      if (scenario === 'fail-local') {
        assert.match(result.status, /папка.*недоступна/); assert.equal(result.files, undefined); assert.equal(result.requests.length, 1); continue;
      }
      const local = ['local', 'remote-local'].includes(scenario);
      assert.match(result.status, local ? /локальной корневой папке/ : /на Яндекс Диске/);
      assert.equal(result.files[0].storage, local ? 'local' : 'yandex');
      if (scenario === 'remote-local') {
        assert.equal(result.requests.length, 2); assert.equal(result.requests[0].body.operation, 'local-ticket');
        assert.equal(result.requests[0].body.clientId, 'own-card'); assert.equal(result.requests[0].body.sha256, sha256);
        assert.equal(result.requests[0].body.base64, undefined, 'Cloud authorization carries only the hash, not the scan bytes');
        assert.equal(result.requests[1].body.base64, content.toString('base64'));
        assert.equal(result.requests[1].body.ticket, 'single-use-fixture'); assert.equal(result.requests[1].credentials, 'omit');
      } else {
        assert.equal(result.requests.length, 1); assert.equal(result.requests[0].body.storage, local ? 'local' : 'yandex');
        assert.equal(result.requests[0].body.clientId, 'own-card');
      }
      if (scenario === 'yandex') assert.equal(result.probes, 0, 'Cloud mode never waits for a local service probe');
    }
    assert.deepEqual(errors, []);
    console.log('Student award browser upload: PASS (local/cloud routing, authorized cloud-to-local upload, older service, unavailable path, current status after card redraw)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
