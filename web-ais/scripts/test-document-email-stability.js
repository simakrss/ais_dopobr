const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");

function extractFunction(name, nextName) {
  const start = appSource.indexOf(`  ${name}`);
  const end = appSource.indexOf(`\n  ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `Не найдена функция ${name}`);
  return appSource.slice(start, end).replace(/^  /gmu, "");
}

async function main() {
  const timeoutContext = {
    AbortController,
    Error,
    Math,
    Number,
    fetch: (_url, options = {}) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
    }),
    window: { setTimeout, clearTimeout }
  };
  vm.createContext(timeoutContext);
  vm.runInContext(
    `${extractFunction("async function fetchWithTimeout", "async function finishStudentDocumentGeneration")}; this.fetchWithTimeout = fetchWithTimeout;`,
    timeoutContext
  );
  const startedAt = Date.now();
  await assert.rejects(
    timeoutContext.fetchWithTimeout("/never", {}, 1000, "Операция остановлена по таймауту."),
    /Операция остановлена по таймауту/u
  );
  assert.ok(Date.now() - startedAt < 2500, "Зависший fetch должен быть прерван ограниченным ожиданием");

  timeoutContext.fetch = (_url, options = {}) => Promise.resolve({
    text: () => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
    })
  });
  const bodyStartedAt = Date.now();
  await assert.rejects(
    timeoutContext.fetchWithTimeout(
      "/headers-only",
      {},
      1000,
      "Тело ответа не было получено вовремя.",
      (response) => response.text()
    ),
    /Тело ответа не было получено вовремя/u
  );
  assert.ok(
    Date.now() - bodyStartedAt < 2500,
    "Таймаут должен охватывать не только заголовки, но и чтение тела ответа"
  );

  const storageContext = {};
  vm.createContext(storageContext);
  vm.runInContext(
    `${extractFunction("function prepareDocumentStorageRequestForEmail", "async function downloadStudentDocumentFromTemplate")}; this.prepareDocumentStorageRequestForEmail = prepareDocumentStorageRequestForEmail;`,
    storageContext
  );
  const localPrompt = {
    promptLocalSave: true,
    autoSaveLocal: false,
    studentFolder: "Слушатели/Тест/Документы"
  };
  assert.deepEqual(
    { ...storageContext.prepareDocumentStorageRequestForEmail(localPrompt, { recipientMode: "student" }) },
    {
      promptLocalSave: false,
      autoSaveLocal: true,
      studentFolder: "Слушатели/Тест/Документы"
    },
    "При отправке письма локальная копия должна сохраняться без блокирующего системного окна"
  );
  assert.deepEqual(
    { ...storageContext.prepareDocumentStorageRequestForEmail(localPrompt, null) },
    localPrompt,
    "При обычном формировании документа выбор места сохранения должен сохраниться"
  );

  const finishEvents = { downloads: 0, alerts: 0, notices: [] };
  const finishContext = {
    readLocalDocumentSaveResult: () => ({ saved: false, cancelled: false, error: "диск недоступен" }),
    readYandexDocumentSaveResult: () => null,
    downloadBlob: () => { finishEvents.downloads += 1; },
    alert: () => { finishEvents.alerts += 1; },
    showYandexDocumentSaveWarning: () => {},
    showDocumentGenerationNotice: (message, kind) => finishEvents.notices.push({ message, kind })
  };
  vm.createContext(finishContext);
  vm.runInContext(
    `${extractFunction("async function finishStudentDocumentGeneration", "async function revealStudentBulkDocument")}; this.finishStudentDocumentGeneration = finishStudentDocumentGeneration;`,
    finishContext
  );
  const generatedBlob = new Blob(["document"], { type: "application/pdf" });
  const finishResult = await finishContext.finishStudentDocumentGeneration(
    {},
    "document.pdf",
    { promptLocalSave: false, autoSaveLocal: true, saveToYandexDisk: false },
    generatedBlob,
    { suppressDownloadFallback: true }
  );
  assert.equal(finishEvents.downloads, 0, "При email не должно открываться браузерное окно сохранения");
  assert.equal(finishEvents.alerts, 0, "Ошибка фонового сохранения не должна блокировать отправку alert-окном");
  assert.equal(finishEvents.notices.length, 1, "Ошибка фонового сохранения должна показываться неблокирующим уведомлением");
  assert.equal(finishResult.downloaded, false);

  finishEvents.downloads = 0;
  finishEvents.alerts = 0;
  finishEvents.notices = [];
  const ordinaryFinishResult = await finishContext.finishStudentDocumentGeneration(
    {},
    "document.pdf",
    { promptLocalSave: false, autoSaveLocal: true, saveToYandexDisk: false },
    generatedBlob
  );
  assert.equal(finishEvents.downloads, 1, "Обычное формирование должно сохранить резервное скачивание");
  assert.equal(finishEvents.alerts, 1, "В обычном сценарии должна сохраниться явная ошибка локального сохранения");
  assert.equal(ordinaryFinishResult.downloaded, true);

  assert.match(appSource, /fetchWithTimeout\("send-mail\.php"[\s\S]+150000/u);
  assert.match(appSource, /результат отправки неизвестен[\s\S]+error\.deliveryUnknown = true/u);
  assert.match(appSource, /return error\.deliveryUnknown \? null : false/u);
  assert.match(appSource, /const generationTimeoutMs = storageRequest\.promptLocalSave \? 15 \* 60 \* 1000 : 5 \* 60 \* 1000/u);
  assert.match(appSource, /fetchWithTimeout\(photoApiUrl\(finalizingPreview[\s\S]+generationTimeoutMs/u);
  assert.match(appSource, /fetchWithTimeout\(photoApiUrl\("\/api\/contracts\/student-document-preview\/cancel"\)[\s\S]+5000/u);
  assert.match(appSource, /emailRequest && \(storageRequest\.autoSaveLocal \|\| storageRequest\.saveToYandexDisk\)/u);
  assert.match(appSource, /Ожидается подтверждение: \$\{documentTemplate\.title\}/u);
  assert.match(appSource, /Отправка письма: \$\{emailRequest\.recipientDescription\}/u);
  assert.match(serverSource, /fs\.writeFile\(targetPath, bytes, \{ flag: "wx" \}\)/u);
  assert.match(serverSource, /existingBytes\.equals\(bytes\)/u);

  console.log("Document email stability tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
