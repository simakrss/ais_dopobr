const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "app-server.js"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден проверяемый блок: ${startMarker}`);
  return source.slice(start, end);
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => payload,
    blob: async () => new Blob([])
  };
}

async function testClientRecovery() {
  const calls = [];
  const updates = [];
  let startCount = 0;
  const context = {
    Blob,
    encodeURIComponent,
    fetch: async (url) => {
      calls.push(url);
      if (url.endsWith("/start")) {
        startCount += 1;
        return response(202, { id: startCount === 1 ? "lost-job" : "restarted-job" });
      }
      if (url.includes("status?id=lost-job")) {
        return response(404, {
          error: "Задача синхронизации или экспорта не найдена либо срок её хранения истёк."
        });
      }
      if (url.includes("status?id=restarted-job")) {
        return response(200, { status: "completed", progress: 100, message: "Готово" });
      }
      if (url.includes("result?id=restarted-job")) {
        return response(200, { syncDirection: "unchanged" });
      }
      throw new Error(`Неожиданный запрос: ${url}`);
    },
    photoApiUrl: (value) => value,
    readStudentImportResponse: async (value) => {
      const payload = await value.json();
      if (!value.ok) {
        const error = new Error(payload.error || `Ошибка сервера: ${value.status}`);
        error.status = value.status;
        throw error;
      }
      return payload;
    },
    updateDatabaseExportIndicator: (value) => updates.push(value),
    waitForStudentImportPoll: async () => {},
    getDownloadFileNameFromResponse: () => "АИС Допобразование.xlsb"
  };
  vm.createContext(context);
  const clientBlock = sourceBetween(
    appSource,
    "  function isMissingStudentDatabaseExportJobError(error)",
    "  function isRetryableStudentDatabaseCommitError(error)"
  );
  vm.runInContext(
    `${clientBlock}\nthis.runExport = runStudentDatabaseExport;\nthis.isMissingJob = isMissingStudentDatabaseExportJobError;`,
    context
  );

  const result = await context.runExport({ directionalSync: true });
  assert.equal(result.jobId, "restarted-job");
  assert.equal(result.syncDirection, "unchanged");
  assert.equal(startCount, 2);
  assert.equal(calls.length, 5);
  assert.ok(updates.some((item) => /запускается повторно/u.test(item.status)));
  assert.equal(context.isMissingJob(Object.assign(new Error("Страница не найдена"), { status: 404 })), false);
}

function testServerCleanup() {
  const jobs = new Map([
    ["running", { status: "running", updatedAt: 0 }],
    ["expired", { status: "completed", updatedAt: 3000 }],
    ["recent", { status: "completed", updatedAt: 4500 }]
  ]);
  const context = {
    Date: { now: () => 5000 },
    STUDENT_EXPORT_JOB_TTL_MS: 1000,
    studentExportJobs: jobs
  };
  vm.createContext(context);
  const cleanupBlock = sourceBetween(
    serverSource,
    "function cleanupStudentExportJobs()",
    "function updateStudentExportJob(job, patch)"
  );
  vm.runInContext(`${cleanupBlock}\nthis.cleanup = cleanupStudentExportJobs;`, context);
  context.cleanup();

  assert.equal(jobs.has("running"), true);
  assert.equal(jobs.has("expired"), false);
  assert.equal(jobs.has("recent"), true);
}

testServerCleanup();
testClientRecovery()
  .then(() => console.log("Student database export job recovery checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
