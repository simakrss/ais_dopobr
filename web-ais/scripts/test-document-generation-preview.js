const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8");
const {
  registerGeneratedDocumentPreview,
  beginGeneratedDocumentPreviewEditor,
  storeGeneratedDocumentPreviewEditedDocx,
  takeGeneratedDocumentPreview,
  cancelGeneratedDocumentPreview,
  completeGeneratedDocumentPreview,
  pruneGeneratedDocumentPreviews,
  signOnlyOfficeJwt,
  verifyOnlyOfficeJwt
} = require(path.join(root, "app-server.js"));

const owner = { id: "preview-test-owner", login: "owner", authSessionKey: "session-owner" };
const ownerOtherSession = { ...owner, authSessionKey: "session-owner-other" };
const stranger = { id: "preview-test-stranger", login: "stranger", authSessionKey: "session-stranger" };
const testGatewaySecret = "preview-test-gateway-secret".repeat(3);
const generated = {
  bytes: Buffer.from("previewed document"),
  outputFormat: "docx",
  fileName: "Документ.docx",
  extraHeaders: { "X-Generated-Document-Format": "docx" }
};

const jwtSecret = "document-preview-editor-test-secret";
const jwtPayload = { key: "preview-editor-key", status: 6 };
const signedJwt = signOnlyOfficeJwt(jwtPayload, jwtSecret);
assert.deepEqual(verifyOnlyOfficeJwt(signedJwt, jwtSecret), jwtPayload);
const tamperedJwt = `${signedJwt.slice(0, -1)}${signedJwt.endsWith("A") ? "B" : "A"}`;
assert.throws(
  () => verifyOnlyOfficeJwt(tamperedJwt, jwtSecret),
  /недействительный JWT-токен/u
);

async function main() {
const waitFor = async (predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  return false;
};
const token = await registerGeneratedDocumentPreview(generated, owner);
assert.match(token, /^[A-Za-z0-9_-]{32}$/u);
assert.equal(await takeGeneratedDocumentPreview(token, stranger), null, "Другой пользователь не должен получить документ");
assert.equal(await takeGeneratedDocumentPreview(token, ownerOtherSession), null, "Другая сессия того же пользователя не должна получить документ");
const stored = await takeGeneratedDocumentPreview(token, owner);
assert.equal(stored.bytes.toString("utf8"), generated.bytes.toString("utf8"));
assert.equal(stored.outputFormat, "docx");
assert.equal(await takeGeneratedDocumentPreview(token, owner), null, "Токен должен быть одноразовым");
await completeGeneratedDocumentPreview(stored);

const cancelToken = await registerGeneratedDocumentPreview(generated, owner);
assert.equal(await cancelGeneratedDocumentPreview(cancelToken, stranger), false);
assert.equal(await cancelGeneratedDocumentPreview(cancelToken, owner), true);
assert.equal(await takeGeneratedDocumentPreview(cancelToken, owner), null);
assert.equal(await takeGeneratedDocumentPreview("x".repeat(1000), owner), null, "Некорректный токен должен сразу отклоняться");

const editorSourceBytes = fs.readFileSync(path.join(
  root,
  "storage",
  "document-templates",
  "employee-contract-general-no-stamp.docx"
));
const editorChangedBytes = fs.readFileSync(path.join(
  root,
  "storage",
  "document-templates",
  "employee-contract-education-no-stamp.docx"
));
const editorPreviewToken = await registerGeneratedDocumentPreview({
  bytes: editorSourceBytes,
  editableBytes: editorSourceBytes,
  outputFormat: "docx",
  fileName: "Редактирование.docx",
  extraHeaders: {}
}, owner);
await assert.rejects(
  beginGeneratedDocumentPreviewEditor(editorPreviewToken, stranger),
  (error) => error?.statusCode === 403,
  "Другой пользователь не должен открыть редактор"
);
const editorSession = await beginGeneratedDocumentPreviewEditor(editorPreviewToken, owner);
await assert.rejects(
  storeGeneratedDocumentPreviewEditedDocx(editorPreviewToken, "wrong-token", editorChangedBytes),
  (error) => error?.statusCode === 403,
  "Изменённый файл должен приниматься только из активной сессии редактора"
);
assert.equal(
  await storeGeneratedDocumentPreviewEditedDocx(
    editorPreviewToken,
    editorSession.editorToken,
    editorChangedBytes
  ),
  1
);
const editedPreview = await takeGeneratedDocumentPreview(editorPreviewToken, owner);
assert.deepEqual(editedPreview.bytes, editorChangedBytes);
await completeGeneratedDocumentPreview(editedPreview);

const expiryToken = await registerGeneratedDocumentPreview(generated, owner);
pruneGeneratedDocumentPreviews(Date.now() + 11 * 60 * 1000);
assert.equal(await takeGeneratedDocumentPreview(expiryToken, owner), null, "Просроченный предпросмотр должен удаляться");

const ownerLimitTokens = [];
for (let index = 0; index < 4; index += 1) {
  ownerLimitTokens.push(await registerGeneratedDocumentPreview(generated, owner));
}
await assert.rejects(
  registerGeneratedDocumentPreview(generated, owner),
  (error) => error?.statusCode === 429,
  "Лимит одной сессии не должен вытеснять ее открытые документы"
);
await Promise.all(ownerLimitTokens.map((item) => cancelGeneratedDocumentPreview(item, owner)));

const capacityTokens = [];
for (let ownerIndex = 0; ownerIndex < 6; ownerIndex += 1) {
  const capacityOwner = {
    id: `capacity-owner-${ownerIndex}`,
    authSessionKey: `capacity-session-${ownerIndex}`
  };
  for (let tokenIndex = 0; tokenIndex < 4; tokenIndex += 1) {
    capacityTokens.push({
      owner: capacityOwner,
      token: await registerGeneratedDocumentPreview(generated, capacityOwner)
    });
  }
}
await assert.rejects(
  registerGeneratedDocumentPreview(generated, { id: "capacity-overflow", authSessionKey: "capacity-overflow-session" }),
  (error) => error?.statusCode === 503,
  "Глобальный лимит не должен вытеснять чужой активный предпросмотр"
);
const capacityTaken = await takeGeneratedDocumentPreview(capacityTokens[0].token, capacityTokens[0].owner);
assert.ok(capacityTaken);
await completeGeneratedDocumentPreview(capacityTaken);
await Promise.all(capacityTokens.slice(1).map((item) => cancelGeneratedDocumentPreview(item.token, item.owner)));

const crossProcessStorageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-preview-store-"));
const childScript = `
process.env.AIS_TRUST_GATEWAY = "1";
process.env.AIS_DISABLE_PREVIEW_CLEANUP_WORKER = "1";
const api = require(${JSON.stringify(path.join(root, "app-server.js"))});
const action = process.argv[1];
const token = process.argv[2] || "";
const owner = { id: "cross-process-owner", authSessionKey: "gateway:cross-process-session" };
const generated = {
  bytes: Buffer.from("cross-process-preview"),
  outputFormat: "pdf",
  fileName: "preview.pdf",
  extraHeaders: {}
};
(async () => {
  if (action === "register") {
    process.stdout.write(await api.registerGeneratedDocumentPreview(generated, owner));
    return;
  }
  if (action === "prune") {
    await api.pruneGeneratedDocumentPreviewFileStore(Date.now() + 11 * 60 * 1000);
    process.stdout.write("pruned");
    return;
  }
  if (action === "register-conversion") {
    process.stdout.write(await api.registerDocumentConversionSource(Buffer.from("cross-process-conversion")));
    return;
  }
  if (action === "remove-conversion") {
    await api.removeDocumentConversionSource(token);
    process.stdout.write("removed");
    return;
  }
  const preview = await api.takeGeneratedDocumentPreview(token, owner);
  if (!preview) {
    process.stdout.write("missing");
    return;
  }
  process.stdout.write(preview.bytes.toString("utf8"));
  await api.completeGeneratedDocumentPreview(preview);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
const runPreviewChild = (action, token = "") => {
  const result = spawnSync(process.execPath, ["-e", childScript, action, token], {
    cwd: root,
    env: {
      ...process.env,
      AIS_TRUST_GATEWAY: "1",
      AIS_DISABLE_PREVIEW_CLEANUP_WORKER: "1",
      AIS_APP_ROOT: root,
      AIS_GENERATED_DOCUMENT_PREVIEW_STORAGE_ROOT: crossProcessStorageRoot
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || `Cross-process ${action} failed`);
  return String(result.stdout || "").trim();
};
const crossProcessToken = runPreviewChild("register");
assert.match(crossProcessToken, /^[A-Za-z0-9_-]{32}$/u);
const runFinalizeWorker = (previewToken) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-preview-route-"));
  const requestPath = path.join(temporaryRoot, "request.json");
  const requestBodyPath = path.join(temporaryRoot, "request-body.json");
  const responsePath = path.join(temporaryRoot, "response.json");
  const responseBodyPath = path.join(temporaryRoot, "response-body.bin");
  fs.writeFileSync(requestPath, JSON.stringify({
    method: "POST",
    url: "/api/contracts/student-document-preview/finalize",
    headers: {
      host: "localhost",
      "content-type": "application/json",
      "x-ais-user-id": "cross-process-owner",
      "x-ais-user-login": "cross-process-owner",
      "x-ais-user-role": "admin",
      "x-ais-session-id": "cross-process-session",
      "x-ais-gateway-token": testGatewaySecret
    }
  }));
  fs.writeFileSync(requestBodyPath, JSON.stringify({ previewToken }));
  const result = spawnSync(process.execPath, [
    path.join(root, "server-cli.js"),
    requestPath,
    requestBodyPath,
    responsePath,
    responseBodyPath
  ], {
    cwd: root,
    env: {
      ...process.env,
      AIS_TRUST_GATEWAY: "1",
      AIS_GATEWAY_SHARED_SECRET: testGatewaySecret,
      AIS_DISABLE_PREVIEW_CLEANUP_WORKER: "1",
      AIS_APP_ROOT: root,
      AIS_GENERATED_DOCUMENT_PREVIEW_STORAGE_ROOT: crossProcessStorageRoot
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || "Finalize worker failed");
  const response = JSON.parse(fs.readFileSync(responsePath, "utf8"));
  const responseBody = fs.readFileSync(responseBodyPath);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  return { response, responseBody };
};
const runConversionSourceWorker = (sourceToken) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-conversion-source-route-"));
  const requestPath = path.join(temporaryRoot, "request.json");
  const requestBodyPath = path.join(temporaryRoot, "request-body.bin");
  const responsePath = path.join(temporaryRoot, "response.json");
  const responseBodyPath = path.join(temporaryRoot, "response-body.bin");
  fs.writeFileSync(requestPath, JSON.stringify({
    method: "GET",
    url: `/api/document-conversion/source/${sourceToken}`,
    headers: { host: "localhost" }
  }));
  fs.writeFileSync(requestBodyPath, Buffer.alloc(0));
  const result = spawnSync(process.execPath, [
    path.join(root, "server-cli.js"),
    requestPath,
    requestBodyPath,
    responsePath,
    responseBodyPath
  ], {
    cwd: root,
    env: {
      ...process.env,
      AIS_TRUST_GATEWAY: "1",
      AIS_DISABLE_PREVIEW_CLEANUP_WORKER: "1",
      AIS_APP_ROOT: root,
      AIS_GENERATED_DOCUMENT_PREVIEW_STORAGE_ROOT: crossProcessStorageRoot
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || "Conversion source worker failed");
  const response = JSON.parse(fs.readFileSync(responsePath, "utf8"));
  const responseBody = fs.readFileSync(responseBodyPath);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  return { response, responseBody };
};
const finalized = runFinalizeWorker(crossProcessToken);
assert.equal(finalized.response.status, 200);
assert.equal(finalized.responseBody.toString("utf8"), "cross-process-preview");
const replayed = runFinalizeWorker(crossProcessToken);
assert.equal(replayed.response.status, 404, "Межпроцессный токен должен быть одноразовым");
const expiringCrossProcessToken = runPreviewChild("register");
assert.equal(runPreviewChild("prune"), "pruned");
assert.equal(runPreviewChild("take", expiringCrossProcessToken), "missing", "Файловый предпросмотр должен удаляться по TTL");
const conversionSourceToken = runPreviewChild("register-conversion");
assert.match(conversionSourceToken, /^[A-Za-z0-9_-]{32}$/u);
const conversionSource = runConversionSourceWorker(conversionSourceToken);
assert.equal(conversionSource.response.status, 200);
assert.equal(conversionSource.responseBody.toString("utf8"), "cross-process-conversion");
assert.equal(runPreviewChild("remove-conversion", conversionSourceToken), "removed");
assert.equal(runConversionSourceWorker(conversionSourceToken).response.status, 404);
fs.rmSync(crossProcessStorageRoot, { recursive: true, force: true });

const cleanupWorkerStorageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-preview-cleaner-"));
const expiredPreviewToken = "P".repeat(32);
const expiredConversionToken = "C".repeat(32);
fs.writeFileSync(path.join(cleanupWorkerStorageRoot, `${expiredPreviewToken}.bin`), "expired-preview");
fs.writeFileSync(path.join(cleanupWorkerStorageRoot, `${expiredPreviewToken}.json`), JSON.stringify({
  owner: "test",
  createdAt: Date.now() - 10000,
  expiresAt: Date.now() - 1,
  outputFormat: "pdf",
  fileName: "expired.pdf",
  size: 15,
  state: "pending",
  finalizingAt: 0
}));
fs.writeFileSync(path.join(cleanupWorkerStorageRoot, `.conversion-${expiredConversionToken}.bin`), "expired-conversion");
fs.writeFileSync(path.join(cleanupWorkerStorageRoot, `.conversion-${expiredConversionToken}.json`), JSON.stringify({
  createdAt: Date.now() - 10000,
  expiresAt: Date.now() - 1,
  readCount: 0,
  size: 18
}));
const orphanAtomicPath = path.join(cleanupWorkerStorageRoot, `${"T".repeat(32)}.json.tmp-abcdef`);
fs.writeFileSync(orphanAtomicPath, "orphan");
const cleanupWorker = spawn(process.execPath, [path.join(root, "app-server.js")], {
  cwd: root,
  env: {
    ...process.env,
    AIS_TRUST_GATEWAY: "1",
    AIS_GENERATED_DOCUMENT_PREVIEW_CLEANUP_WORKER: "1",
    AIS_APP_ROOT: root,
    AIS_GENERATED_DOCUMENT_PREVIEW_STORAGE_ROOT: cleanupWorkerStorageRoot
  },
  stdio: "ignore",
  windowsHide: true
});
try {
  assert.equal(await waitFor(() => fs.existsSync(path.join(cleanupWorkerStorageRoot, ".cleanup-worker.lock"))), true);
  assert.equal(await waitFor(() => (
    !fs.existsSync(path.join(cleanupWorkerStorageRoot, `${expiredPreviewToken}.bin`))
    && !fs.existsSync(path.join(cleanupWorkerStorageRoot, `.conversion-${expiredConversionToken}.bin`))
    && !fs.existsSync(orphanAtomicPath)
  )), true, "Фоновый cleaner должен удалить просроченные и временные файлы");
} finally {
  const exited = new Promise((resolve) => cleanupWorker.once("exit", resolve));
  cleanupWorker.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (cleanupWorker.exitCode === null && cleanupWorker.signalCode === null) {
    const forcedExit = new Promise((resolve) => cleanupWorker.once("exit", resolve));
    cleanupWorker.kill("SIGKILL");
    await Promise.race([forcedExit, new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  fs.rmSync(cleanupWorkerStorageRoot, { recursive: true, force: true });
}

assert.match(appSource, /const documentPreviewDefaultVersion = "all-documents-preview-v1"/u);
assert.match(appSource, /previewBeforeGeneration:\s*true,[\s\S]+previewBeforeGenerationVersion:\s*documentPreviewDefaultVersion/u);
assert.match(appSource, /hasCurrentPreviewDefault[\s\S]+\? isChecked\(item\?\.previewBeforeGeneration \?\? fallback\.previewBeforeGeneration \?\? true\)[\s\S]+:\s*true/u);
assert.match(appSource, /previewBeforeGenerationVersion:\s*documentPreviewDefaultVersion/u);
assert.match(appSource, /data-document-preview-toggle/u);
assert.match(appSource, />Предварительный просмотр</u);
assert.match(appSource, /skipPreview:\s*true/u, "Групповые операции не должны открывать окно для каждого слушателя");
assert.match(appSource, /student-document-preview\/finalize/u);
assert.match(appSource, /student-document-preview\/cancel/u);
assert.match(appSource, /student-document-preview\/editor-start/u);
assert.match(appSource, /student-document-preview\/editor-save/u);
assert.match(appSource, /data-action="edit-generated-document-preview"/u);
assert.match(appSource, /data-action="save-generated-document-editor"/u);
assert.match(appSource, /ais-generated-document-editor/u);
assert.match(appSource, /closeGeneratedDocumentPreview/u);
assert.match(appSource, /Отправка по email:/u);
assert.match(appSource, /button\?\.isConnected\s*&&\s*!button\.disabled/u);

const pipelineStart = appSource.indexOf("async function downloadStudentDocumentFromTemplate");
const pipelineEnd = appSource.indexOf("async function openStudentEducationDocument", pipelineStart);
const pipeline = appSource.slice(pipelineStart, pipelineEnd);
assert.ok(pipeline.indexOf("showGeneratedDocumentPreview") < pipeline.indexOf("prepareStudentDocumentStorageRequest"));
assert.ok(pipeline.indexOf("student-document-preview/finalize") < pipeline.indexOf("finishStudentDocumentGeneration"));
assert.ok(pipeline.indexOf("finishStudentDocumentGeneration") < pipeline.indexOf("addAudit"));

assert.match(serverSource, /if \(body\.previewOnly\)[\s\S]+registerGeneratedDocumentPreview/u);
assert.match(serverSource, /handleGeneratedDocumentPreviewFinalize/u);
assert.match(serverSource, /X-Document-Preview-Token/u);
assert.match(serverSource, /GENERATED_DOCUMENT_PREVIEW_TOKEN_PATTERN/u);
assert.match(serverSource, /generatedDocumentPreviewCleanupTimer\?\.unref/u);
assert.match(serverSource, /assertGeneratedDocumentPreviewRequestAllowed/u);
assert.match(serverSource, /GENERATED_DOCUMENT_PREVIEW_CONTROL_MAX_JSON_BYTES/u);
assert.match(serverSource, /generated-document-previews/u);
assert.match(serverSource, /metadata\.state\s*=\s*"finalizing"/u);
assert.match(serverSource, /GENERATED_DOCUMENT_PREVIEW_FILE_LOCK_HEARTBEAT_MS/u);
assert.match(serverSource, /Generated document preview cleanup worker failed to start/u);
assert.match(serverSource, /AIS_GENERATED_DOCUMENT_PREVIEW_CLEANUP_WORKER/u);
assert.match(serverSource, /Generated document preview cleanup failed after finalize/u);
assert.match(serverSource, /documentConversionSourceMetadataPath/u);
assert.match(serverSource, /await registerDocumentConversionSource\(docxBytes\)/u);
assert.match(serverSource, /await readDocumentConversionSource\(token\)/u);
assert.match(serverSource, /editableBytes:\s*docxResult/u);
assert.match(serverSource, /handleGeneratedDocumentPreviewEditorStart/u);
assert.match(serverSource, /handleGeneratedDocumentPreviewEditorCallback/u);
assert.match(serverSource, /handleGeneratedDocumentPreviewEditorSave/u);
assert.match(serverSource, /requestOnlyOfficeForceSave/u);
assert.match(serverSource, /verifyOnlyOfficeJwt/u);
assert.match(serverSource, /proxyOnlyOfficeHttpRequest/u);
assert.match(serverSource, /proxyOnlyOfficeWebSocket/u);
assert.match(serverSource, /server\.on\("upgrade"/u);
assert.match(gatewaySource, /x-ais-session-id/u);
assert.match(gatewaySource, /\$requestBodyLimit\s*=\s*\$isPreviewControlRequest\s*\?\s*4096/u);
assert.match(gatewaySource, /stream_get_contents\(\$inputStream,\s*\$requestBodyLimit\s*\+\s*1\)/u);
assert.match(stylesSource, /\.generated-document-preview-dialog/u);
assert.match(stylesSource, /\.generated-document-preview-frame/u);
assert.match(stylesSource, /\.generated-document-preview-frame\.is-editor/u);
assert.match(stylesSource, /\.generated-document-preview-actions\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u);
assert.doesNotMatch(stylesSource, /generated-document-preview-actions \[data-action="edit-generated-document-preview"\][\s\S]*?grid-column:\s*1\s*\/\s*-1/u);

console.log("Document generation preview tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
