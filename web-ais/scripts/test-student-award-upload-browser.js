"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const extract = name => { const match = app.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m")); assert.ok(match, name); return match[0]; };
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
  try {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("http://127.0.0.1:39201/**", route => route.fulfill({ contentType: "text/html", body: "<main></main>" }));
    await page.goto("http://127.0.0.1:39201/");
    await page.addScriptTag({ content: `
      let mode = 'local', requests = [], probes = 0, downloads = [], downloadError = false;
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
      const escapeAttr = value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
      const escapeHtml = escapeAttr, escapeMultilineAttr = escapeAttr;
      const getEducationDocumentButtonTitle = () => 'Сформировать документ', buildStudentDocumentGenerationTooltip = () => 'Конверт';
      const studentAttestationDocumentTemplateDefinitions = [{title:'Ведомость экзаменов',documentKind:'statement'},{title:'Протокол',documentKind:'protocol'}];
      const getStudentAttestationDocumentUnavailableReason = () => '', renderStudentLayoutRemarks = () => '';
      const downloadBlob = (name,blob) => downloads.push({name,size:blob.size});
      window.AIS_AUTH_API = { appUrl: url => location.origin+'/'+url, request: async (url, options) => {
        const body = JSON.parse(options.body); requests.push({ channel: 'authenticated', url, body });
        if (body.operation === 'local-ticket') return { ticket: 'single-use-fixture' };
        if (mode === 'fail-local') throw new Error('Локальная папка документов недоступна.');
        return success(body.storage);
      } };
      window.fetch = async (url, options) => {
        if (!options.body) {
          requests.push({channel:'download',url});
          return downloadError ? new Response(JSON.stringify({error:'Файл временно недоступен.'}),{status:503})
            : new Response('%PDF-scan',{headers:{'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('ДипломПП-ИЛП3-СамыловаМВ.pdf')}});
        }
        requests.push({ channel: 'local', url, body: JSON.parse(options.body), credentials: options.credentials });
        return new Response(JSON.stringify(success('local')), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      const draw = () => {
        document.querySelector('main').innerHTML = '<form id="recordForm">'+renderEducationDocumentActions(state.data.collections.students[0])+'</form>';
        document.querySelector('[data-student-award-upload]').addEventListener('change', uploadStudentAwardScan);
        document.querySelector('[data-action="download-student-award-scan"]').addEventListener('click',downloadStudentAwardScan);
      };
      const saveRecordFormBeforeContinuation = async () => { draw(); return 'student'; };
      ${extract("saveStudentAwardFile")}
      ${extract("uploadStudentAwardScan")}
      ${extract("downloadStudentAwardScan")}
      ${extract("getDownloadFileNameFromResponse")}
      ${extract("renderEducationDocumentActions")}
      ${extract("renderOrdersSdoIcon")}
      draw();
    ` });
    const content = Buffer.from("%PDF-1.4\nfixture-scan"), sha256 = crypto.createHash("sha256").update(content).digest("hex");
    for (const scenario of ["local", "yandex", "remote-local", "unavailable", "older-local", "fail-local"]) {
      await page.evaluate(scenario => { mode = scenario; requests = []; probes = 0; state.modal.draft = {}; state.data.collections.students[0].educationDocumentFiles=[]; draw(); }, scenario);
      assert.equal(await page.locator('[data-action="download-student-award-scan"]').isDisabled(),true);
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
      assert.equal(await page.locator('[data-action="download-student-award-scan"]').isEnabled(),true);
      assert.equal(await page.locator('.student-award-file-link').count(),0);
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
    await page.evaluate(()=>{state.data.collections.students[0].educationDocumentFiles=[{id:'old',kind:'scan',name:'Документ об образовании — Очень длинное название — 0000.pdf'}];draw();requests=[];});
    await page.locator('[data-action="download-student-award-scan"]').click();
    await page.waitForFunction(()=>downloads.length===1);
    assert.equal(await page.evaluate(()=>downloads[0].name),'ДипломПП-ИЛП3-СамыловаМВ.pdf');
    assert.ok((await page.evaluate(()=>requests[0].url)).endsWith('id=student&file=old'));
    await page.evaluate(()=>{state.data.collections.students[0].educationDocumentFiles.push({id:'second',kind:'scan',name:'Скан.png'});draw();});
    await page.locator('[data-action="download-student-award-scan"]').click();
    await page.locator('dialog select').selectOption('second');
    await page.locator('dialog .primary-button').click();
    await page.waitForFunction(()=>downloads.length===2);
    assert.ok((await page.evaluate(()=>requests.at(-1).url)).endsWith('file=second'));
    await page.evaluate(()=>{state.data.collections.students[0].educationDocumentFiles.pop();downloadError=true;draw();});
    await page.locator('[data-action="download-student-award-scan"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-award-upload-status]').textContent.includes('временно недоступен'));
    assert.equal(await page.evaluate(()=>downloads.length),2);
    assert.equal(await page.locator('[data-action="download-student-award-scan"]').isEnabled(),true);
    await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8')});
    await page.evaluate(()=>{document.querySelector('main').style.cssText='width:265px;padding:8px;background:white';});
    await page.setViewportSize({width:340,height:460});
    const boxes=await page.evaluate(()=>{const row=document.querySelector('.student-award-upload-actions'),upload=row.firstElementChild,download=row.lastElementChild;return {row:row.getBoundingClientRect().toJSON(),upload:upload.getBoundingClientRect().toJSON(),download:download.getBoundingClientRect().toJSON(),overflow:row.scrollWidth>row.clientWidth};});
    assert.equal(boxes.overflow,false); assert.ok(boxes.download.width<=32); assert.equal(boxes.upload.y,boxes.download.y);
    const output=path.join(__dirname,'..','.runtime','award-storage-verification');fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'compact-download.png')});
    assert.deepEqual(errors, []);
    console.log('Student award browser upload/download: PASS (routing, button activation, legacy filename, scan selection, failure recovery, compact narrow layout)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
