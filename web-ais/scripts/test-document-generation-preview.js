const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8");

function getCssRule(source, selector, fromIndex = 0) {
  const marker = `${selector} {`;
  const start = source.indexOf(marker, fromIndex);
  assert.notEqual(start, -1, `Не найден CSS-селектор: ${selector}`);
  const end = source.indexOf("}", start);
  assert.notEqual(end, -1, `Не найден конец CSS-правила: ${selector}`);
  return source.slice(start, end + 1);
}
const {
  registerGeneratedDocumentPreview,
  beginGeneratedDocumentPreviewEditor,
  refreshGeneratedDocumentPreviewEditor,
  storeGeneratedDocumentPreviewEditedDocx,
  discardGeneratedDocumentPreviewEditor,
  completeGeneratedDocumentPreviewEditor,
  takeGeneratedDocumentPreview,
  cancelGeneratedDocumentPreview,
  completeGeneratedDocumentPreview,
  pruneGeneratedDocumentPreviews,
  signOnlyOfficeJwt,
  verifyOnlyOfficeJwt,
  resolveOnlyOfficeEditedDocumentUrl,
  sanitizeOnlyOfficeEditorSaveError,
  generatedDocumentRequestBackend,
  assertGeneratedDocumentEditorBackendAvailable
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
assert.equal(
  generatedDocumentRequestBackend({ headers: { "x-ais-document-backend": " TUNNEL " } }),
  "tunnel"
);
assert.doesNotThrow(
  () => assertGeneratedDocumentEditorBackendAvailable({
    headers: { "x-ais-document-backend": "tunnel" }
  }),
  "Tunnel-primary editor lifecycle должен остаться доступным."
);
assert.throws(
  () => assertGeneratedDocumentEditorBackendAvailable({
    headers: { "x-ais-document-backend": "server" }
  }),
  (error) => error?.statusCode === 503 && /Онлайн/u.test(String(error.message)),
  "SERVER editor lifecycle должен fail-closed до выдачи iframe URL."
);

assert.equal(
  resolveOnlyOfficeEditedDocumentUrl(
    "https://edu-plus.ru/onlyoffice/cache/files/data/editor/output.docx?md5=abc",
    "http://127.0.0.1:8082"
  ).toString(),
  "http://127.0.0.1:8082/cache/files/data/editor/output.docx?md5=abc",
  "При прямом скачивании результата публичный префикс прокси ONLYOFFICE должен удаляться"
);
assert.equal(
  resolveOnlyOfficeEditedDocumentUrl(
    "http://documentserver/cache/files/data/editor/output.docx?md5=abc",
    "http://127.0.0.1:8082"
  ).toString(),
  "http://127.0.0.1:8082/cache/files/data/editor/output.docx?md5=abc",
  "Прямая ссылка ONLYOFFICE должна сохранять путь и параметры"
);
assert.equal(
  resolveOnlyOfficeEditedDocumentUrl(
    "https://edu-plus.ru/onlyofficeevil/cache/files/data/editor/output.docx",
    "http://127.0.0.1:8082"
  ).toString(),
  "http://127.0.0.1:8082/onlyofficeevil/cache/files/data/editor/output.docx",
  "Похожий, но посторонний сегмент пути не должен приниматься за префикс прокси"
);
assert.equal(
  resolveOnlyOfficeEditedDocumentUrl(
    "https://edu-plus.ru/onlyoffice/cache/files/data/editor/output.docx",
    "https://converter.example/documentserver/"
  ).toString(),
  "https://converter.example/documentserver/cache/files/data/editor/output.docx",
  "Настроенный базовый путь внутреннего ONLYOFFICE не должен теряться"
);
assert.equal(
  resolveOnlyOfficeEditedDocumentUrl(
    "https://documentserver/documentserver/cache/files/data/editor/output.docx",
    "https://converter.example/documentserver/"
  ).toString(),
  "https://converter.example/documentserver/cache/files/data/editor/output.docx",
  "Базовый путь внутреннего ONLYOFFICE не должен дублироваться"
);
assert.throws(
  () => resolveOnlyOfficeEditedDocumentUrl("file:///tmp/output.docx", "http://127.0.0.1:8082"),
  /неподдерживаемую ссылку/u
);
assert.equal(
  sanitizeOnlyOfficeEditorSaveError(new Error(
    "ONLYOFFICE не передал отредактированный документ: HTTP 404 <!DOCTYPE html><html>Error</html>"
  )),
  "ONLYOFFICE не передал отредактированный документ: HTTP 404",
  "HTML-страница внутреннего сервера не должна попадать в пользовательское окно"
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

const realDateNow = Date.now;
let simulatedEditorNow = realDateNow();
Date.now = () => simulatedEditorNow;
try {
  const slidingEditorPreviewToken = await registerGeneratedDocumentPreview({
    bytes: editorSourceBytes,
    editableBytes: editorSourceBytes,
    outputFormat: "docx",
    fileName: "Продление активности редактора.docx",
    extraHeaders: {}
  }, owner);
  const slidingEditorSession = await beginGeneratedDocumentPreviewEditor(
    slidingEditorPreviewToken,
    owner
  );
  simulatedEditorNow += 90 * 60 * 1000;
  assert.equal(
    await storeGeneratedDocumentPreviewEditedDocx(
      slidingEditorPreviewToken,
      slidingEditorSession.editorToken,
      editorChangedBytes
    ),
    slidingEditorSession.editRevision + 1,
    "Автосохранение через 90 минут должно продлить срок editor session"
  );
  simulatedEditorNow += 60 * 60 * 1000;
  assert.equal(
    await storeGeneratedDocumentPreviewEditedDocx(
      slidingEditorPreviewToken,
      slidingEditorSession.editorToken,
      editorSourceBytes
    ),
    slidingEditorSession.editRevision + 2,
    "Повторное сохранение через 150 минут от старта должно работать благодаря sliding TTL"
  );
  await discardGeneratedDocumentPreviewEditor(
    slidingEditorPreviewToken,
    slidingEditorSession.editorToken,
    owner
  );
  assert.equal(await cancelGeneratedDocumentPreview(slidingEditorPreviewToken, owner), true);
} finally {
  Date.now = realDateNow;
}

simulatedEditorNow = realDateNow();
Date.now = () => simulatedEditorNow;
try {
  const authSessionExpiresAt = simulatedEditorNow + 3 * 60 * 60 * 1000;
  const authBoundOwner = { ...owner, sessionExpiresAt: authSessionExpiresAt };
  const authBoundPreviewToken = await registerGeneratedDocumentPreview({
    bytes: editorSourceBytes,
    editableBytes: editorSourceBytes,
    outputFormat: "docx",
    fileName: "Сессия редактора в пределах авторизации.docx",
    extraHeaders: {}
  }, authBoundOwner);
  const authBoundEditorSession = await beginGeneratedDocumentPreviewEditor(
    authBoundPreviewToken,
    authBoundOwner
  );
  simulatedEditorNow = authSessionExpiresAt + 60 * 1000;
  await assert.rejects(
    refreshGeneratedDocumentPreviewEditor(
      authBoundPreviewToken,
      authBoundEditorSession.editorToken,
      authBoundOwner
    ),
    (error) => error?.statusCode === 403,
    "Editor capability не должна восстанавливаться после окончания исходной auth-сессии"
  );
  pruneGeneratedDocumentPreviews(simulatedEditorNow);
  assert.equal(
    await cancelGeneratedDocumentPreview(authBoundPreviewToken, authBoundOwner),
    false,
    "Cleaner должен удалить preview после ограниченного auth-сессией recovery TTL"
  );
} finally {
  Date.now = realDateNow;
}

simulatedEditorNow = realDateNow();
Date.now = () => simulatedEditorNow;
try {
  const recoverableEditorPreviewToken = await registerGeneratedDocumentPreview({
    bytes: editorSourceBytes,
    editableBytes: editorSourceBytes,
    outputFormat: "docx",
    fileName: "Восстановление сессии редактора.docx",
    extraHeaders: {}
  }, owner);
  const recoverableEditorSession = await beginGeneratedDocumentPreviewEditor(
    recoverableEditorPreviewToken,
    owner
  );
  await assert.rejects(
    refreshGeneratedDocumentPreviewEditor(
      recoverableEditorPreviewToken,
      recoverableEditorSession.editorToken,
      ownerOtherSession
    ),
    (error) => error?.statusCode === 403,
    "Другая авторизационная сессия того же пользователя не должна обновлять editor session"
  );
  await assert.rejects(
    refreshGeneratedDocumentPreviewEditor(
      recoverableEditorPreviewToken,
      "wrong-editor-token",
      owner
    ),
    (error) => error?.statusCode === 403,
    "Неверный editor token не должен обновлять или заменять editor session"
  );
  assert.ok(
    await refreshGeneratedDocumentPreviewEditor(
      recoverableEditorPreviewToken,
      recoverableEditorSession.editorToken,
      owner
    ),
    "Отказы чужой сессии и неверного token не должны повреждать исходную editor session"
  );
  simulatedEditorNow += 2 * 60 * 60 * 1000 + 60 * 1000;
  assert.ok(
    await refreshGeneratedDocumentPreviewEditor(
      recoverableEditorPreviewToken,
      recoverableEditorSession.editorToken,
      owner
    ),
    "Та же editor session должна восстанавливаться после основного TTL в пределах recovery grace"
  );
  pruneGeneratedDocumentPreviews(simulatedEditorNow);
  assert.equal(
    await storeGeneratedDocumentPreviewEditedDocx(
      recoverableEditorPreviewToken,
      recoverableEditorSession.editorToken,
      editorChangedBytes
    ),
    recoverableEditorSession.editRevision + 1,
    "Обновлённая просроченная editor session должна принимать последующее сохранение"
  );
  await discardGeneratedDocumentPreviewEditor(
    recoverableEditorPreviewToken,
    recoverableEditorSession.editorToken,
    owner
  );
  assert.equal(await cancelGeneratedDocumentPreview(recoverableEditorPreviewToken, owner), true);
} finally {
  Date.now = realDateNow;
}

simulatedEditorNow = realDateNow();
Date.now = () => simulatedEditorNow;
try {
  const replacementEditorPreviewToken = await registerGeneratedDocumentPreview({
    bytes: editorSourceBytes,
    editableBytes: editorSourceBytes,
    outputFormat: "docx",
    fileName: "Конфликт сессий редактора.docx",
    extraHeaders: {}
  }, owner);
  const expiredEditorSession = await beginGeneratedDocumentPreviewEditor(
    replacementEditorPreviewToken,
    owner
  );
  simulatedEditorNow += 2 * 60 * 60 * 1000 + 60 * 1000;
  const activeReplacementSession = await beginGeneratedDocumentPreviewEditor(
    replacementEditorPreviewToken,
    owner
  );
  assert.notEqual(activeReplacementSession.editorToken, expiredEditorSession.editorToken);
  await assert.rejects(
    refreshGeneratedDocumentPreviewEditor(
      replacementEditorPreviewToken,
      expiredEditorSession.editorToken,
      owner
    ),
    (error) => [403, 409, 423].includes(Number(error?.statusCode || 0)),
    "Старая вкладка не должна перехватывать preview после открытия новой активной editor session"
  );
  assert.equal(
    await storeGeneratedDocumentPreviewEditedDocx(
      replacementEditorPreviewToken,
      activeReplacementSession.editorToken,
      editorChangedBytes
    ),
    activeReplacementSession.editRevision + 1,
    "Неудачный refresh старой вкладки не должен повреждать новую активную editor session"
  );
  await discardGeneratedDocumentPreviewEditor(
    replacementEditorPreviewToken,
    activeReplacementSession.editorToken,
    owner
  );
  assert.equal(await cancelGeneratedDocumentPreview(replacementEditorPreviewToken, owner), true);
} finally {
  Date.now = realDateNow;
}

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
const storedEditorRevision = await storeGeneratedDocumentPreviewEditedDocx(
  editorPreviewToken,
  editorSession.editorToken,
  editorChangedBytes
);
assert.equal(storedEditorRevision, 1);
const completedEditor = await completeGeneratedDocumentPreviewEditor(
  editorPreviewToken,
  editorSession.editorToken,
  storedEditorRevision
);
assert.deepEqual(completedEditor, { completed: true, editRevision: storedEditorRevision });
await assert.rejects(
  refreshGeneratedDocumentPreviewEditor(
    editorPreviewToken,
    editorSession.editorToken,
    owner
  ),
  (error) => [403, 409].includes(Number(error?.statusCode || 0)),
  "Уже завершённая editor session не должна восстанавливаться"
);
await assert.rejects(
  storeGeneratedDocumentPreviewEditedDocx(
    editorPreviewToken,
    editorSession.editorToken,
    editorSourceBytes
  ),
  (error) => error?.statusCode === 403,
  "Успешно сохранённая сессия редактора должна быть завершена"
);
const reopenedEditorSession = await beginGeneratedDocumentPreviewEditor(editorPreviewToken, owner);
const reopenedEditorDiscard = await discardGeneratedDocumentPreviewEditor(
  editorPreviewToken,
  reopenedEditorSession.editorToken,
  owner
);
assert.equal(reopenedEditorDiscard.discarded, true);
const editedPreview = await takeGeneratedDocumentPreview(editorPreviewToken, owner);
assert.deepEqual(
  editedPreview.bytes,
  editorChangedBytes,
  "Отмена новой сессии не должна откатывать уже сохранённые ранее изменения"
);
await completeGeneratedDocumentPreview(editedPreview);

const editorDiscardPreviewToken = await registerGeneratedDocumentPreview({
  bytes: editorSourceBytes,
  editableBytes: editorSourceBytes,
  outputFormat: "docx",
  fileName: "Отмена редактирования.docx",
  extraHeaders: {}
}, owner);
const editorDiscardSession = await beginGeneratedDocumentPreviewEditor(editorDiscardPreviewToken, owner);
assert.equal(
  await storeGeneratedDocumentPreviewEditedDocx(
    editorDiscardPreviewToken,
    editorDiscardSession.editorToken,
    editorChangedBytes
  ),
  editorDiscardSession.editRevision + 1
);
await assert.rejects(
  discardGeneratedDocumentPreviewEditor(
    editorDiscardPreviewToken,
    editorDiscardSession.editorToken,
    stranger
  ),
  (error) => error?.statusCode === 403,
  "Другой пользователь не должен отменять изменения в редакторе"
);
const discardedEditor = await discardGeneratedDocumentPreviewEditor(
  editorDiscardPreviewToken,
  editorDiscardSession.editorToken,
  owner
);
assert.equal(discardedEditor?.discarded, true);
assert.equal(discardedEditor?.editRevision, editorDiscardSession.editRevision);
await assert.rejects(
  storeGeneratedDocumentPreviewEditedDocx(
    editorDiscardPreviewToken,
    editorDiscardSession.editorToken,
    editorChangedBytes
  ),
  (error) => error?.statusCode === 403,
  "Завершённая отменой сессия не должна принимать запоздалое сохранение ONLYOFFICE"
);
const discardedEditorPreview = await takeGeneratedDocumentPreview(editorDiscardPreviewToken, owner);
assert.deepEqual(
  discardedEditorPreview.bytes,
  editorSourceBytes,
  "Отмена редактирования должна вернуть документ к состоянию перед входом в редактор"
);
await completeGeneratedDocumentPreview(discardedEditorPreview);

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
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
process.env.AIS_TRUST_GATEWAY = "1";
process.env.AIS_DISABLE_PREVIEW_CLEANUP_WORKER = "1";
const api = require(${JSON.stringify(path.join(root, "app-server.js"))});
const action = process.argv[1];
const token = process.argv[2] || "";
const editorToken = process.argv[3] || "";
const owner = { id: "cross-process-owner", authSessionKey: "gateway:cross-process-session" };
const generated = {
  bytes: Buffer.from("cross-process-preview"),
  outputFormat: "pdf",
  fileName: "preview.pdf",
  extraHeaders: {}
};
const editorSourceBytes = fs.readFileSync(path.join(
  ${JSON.stringify(root)},
  "storage",
  "document-templates",
  "employee-contract-general-no-stamp.docx"
));
const editorChangedBytes = fs.readFileSync(path.join(
  ${JSON.stringify(root)},
  "storage",
  "document-templates",
  "employee-contract-education-no-stamp.docx"
));
const editorGenerated = {
  bytes: editorSourceBytes,
  editableBytes: editorSourceBytes,
  outputFormat: "docx",
  fileName: "cross-process-editor.docx",
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
  if (action === "register-editor") {
    process.stdout.write(await api.registerGeneratedDocumentPreview(editorGenerated, owner));
    return;
  }
  if (action === "begin-editor") {
    process.stdout.write(JSON.stringify(await api.beginGeneratedDocumentPreviewEditor(token, owner)));
    return;
  }
  if (action === "refresh-editor") {
    await api.refreshGeneratedDocumentPreviewEditor(token, editorToken, owner);
    process.stdout.write("refreshed");
    return;
  }
  if (action === "store-editor") {
    process.stdout.write(String(await api.storeGeneratedDocumentPreviewEditedDocx(
      token,
      editorToken,
      editorChangedBytes
    )));
    return;
  }
  if (action === "discard-editor-foreign") {
    try {
      await api.discardGeneratedDocumentPreviewEditor(
        token,
        editorToken,
        { id: "cross-process-stranger", authSessionKey: "gateway:cross-process-stranger" }
      );
      process.stdout.write("unexpected");
    } catch (error) {
      process.stdout.write(String(error?.statusCode || 0));
    }
    return;
  }
  if (action === "discard-editor") {
    process.stdout.write(JSON.stringify(
      await api.discardGeneratedDocumentPreviewEditor(token, editorToken, owner)
    ));
    return;
  }
  if (action === "store-editor-late") {
    try {
      await api.storeGeneratedDocumentPreviewEditedDocx(token, editorToken, editorChangedBytes);
      process.stdout.write("unexpected");
    } catch (error) {
      process.stdout.write(String(error?.statusCode || 0));
    }
    return;
  }
  if (action === "take-editor") {
    const preview = await api.takeGeneratedDocumentPreview(token, owner);
    if (!preview) {
      process.stdout.write("missing");
      return;
    }
    process.stdout.write(crypto.createHash("sha256").update(preview.bytes).digest("hex"));
    await api.completeGeneratedDocumentPreview(preview);
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
const runPreviewChild = (action, token = "", editorToken = "") => {
  const result = spawnSync(process.execPath, ["-e", childScript, action, token, editorToken], {
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
const crossProcessEditorToken = runPreviewChild("register-editor");
assert.match(crossProcessEditorToken, /^[A-Za-z0-9_-]{32}$/u);
const crossProcessEditorSession = JSON.parse(runPreviewChild("begin-editor", crossProcessEditorToken));
assert.match(crossProcessEditorSession.editorToken, /^[A-Za-z0-9_-]{43}$/u);
const crossProcessEditorMetadataPath = path.join(
  crossProcessStorageRoot,
  `${crossProcessEditorToken}.json`
);
const staleCrossProcessEditorMetadata = JSON.parse(
  fs.readFileSync(crossProcessEditorMetadataPath, "utf8")
);
const crossProcessEditorKey = staleCrossProcessEditorMetadata.editorSession.key;
const crossProcessEditorBaseline = staleCrossProcessEditorMetadata.editorSession.baseline;
staleCrossProcessEditorMetadata.editorSession.expiresAt = Date.now() - 60 * 1000;
fs.writeFileSync(
  crossProcessEditorMetadataPath,
  JSON.stringify(staleCrossProcessEditorMetadata),
  "utf8"
);
assert.equal(
  runPreviewChild(
    "refresh-editor",
    crossProcessEditorToken,
    crossProcessEditorSession.editorToken
  ),
  "refreshed",
  "Просроченная собственная editor session должна обновляться из другого процесса"
);
const refreshedCrossProcessEditorMetadata = JSON.parse(
  fs.readFileSync(crossProcessEditorMetadataPath, "utf8")
);
assert.ok(
  Number(refreshedCrossProcessEditorMetadata.editorSession.expiresAt || 0) > Date.now(),
  "Cross-process refresh должен продлить editorSession.expiresAt"
);
assert.ok(
  Number(refreshedCrossProcessEditorMetadata.expiresAt || 0)
    >= Number(refreshedCrossProcessEditorMetadata.editorSession.expiresAt || 0),
  "Cross-process refresh должен сохранить preview не меньше срока editor session"
);
assert.equal(
  refreshedCrossProcessEditorMetadata.editorSession.key,
  crossProcessEditorKey,
  "Refresh не должен менять ONLYOFFICE document key"
);
assert.deepEqual(
  refreshedCrossProcessEditorMetadata.editorSession.baseline,
  crossProcessEditorBaseline,
  "Refresh не должен менять baseline для отмены правок"
);
assert.equal(
  runPreviewChild("store-editor", crossProcessEditorToken, crossProcessEditorSession.editorToken),
  String(crossProcessEditorSession.editRevision + 1)
);
assert.equal(
  runPreviewChild("discard-editor-foreign", crossProcessEditorToken, crossProcessEditorSession.editorToken),
  "403"
);
const crossProcessDiscarded = JSON.parse(runPreviewChild(
  "discard-editor",
  crossProcessEditorToken,
  crossProcessEditorSession.editorToken
));
assert.equal(crossProcessDiscarded.discarded, true);
assert.equal(crossProcessDiscarded.editRevision, crossProcessEditorSession.editRevision);
assert.equal(
  runPreviewChild("store-editor-late", crossProcessEditorToken, crossProcessEditorSession.editorToken),
  "403"
);
assert.equal(
  runPreviewChild("take-editor", crossProcessEditorToken),
  require("node:crypto").createHash("sha256").update(editorSourceBytes).digest("hex"),
  "Файловое хранилище должно восстановить версию до входа в редактор"
);
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
assert.match(appSource, /function getDefaultDocumentOpenAfterGeneration/u);
assert.match(appSource, /\["contract", "employeeContract", "education", "postalEnvelope"\]\.includes\(documentKind\)/u);
assert.match(appSource, /const documentOpenAfterGenerationDefaultVersion = "postal-envelope-open-v1"/u);
assert.match(appSource, /isPostalEnvelopeTemplate && !hasCurrentOpenAfterGenerationDefault[\s\S]+\? true/u);
assert.match(appSource, /data-document-open-after-generation-toggle/u);
assert.match(appSource, />Открывать после генерации</u);
assert.match(appSource, /name="openAfterGeneration" type="checkbox"/u);
assert.match(appSource, /const openAfterGenerationInput = form\?\.elements\.openAfterGeneration/u);
assert.match(appSource, /openAfterGeneration,\s*emailDeliveryMode/u);
assert.match(appSource, /openGeneratedDocumentAfterGeneration/u);
assert.match(appSource, /selectedFileName:\s*savedFileName/u);
assert.match(appSource, /skipPreview:\s*true/u, "Групповые операции не должны открывать окно для каждого слушателя");
assert.match(appSource, /skipOpenAfterGeneration:\s*true/u, "Групповые операции должны открывать только первый сформированный документ");
assert.match(appSource, /student-document-preview\/finalize/u);
assert.match(appSource, /student-document-preview\/cancel/u);
assert.match(appSource, /student-document-preview\/editor-start/u);
assert.match(appSource, /student-document-preview\/editor-refresh/u);
assert.match(appSource, /student-document-preview\/editor-save/u);
assert.match(appSource, /student-document-preview\/editor-discard/u);
assert.match(appSource, /data-action="edit-generated-document-preview"/u);
assert.match(appSource, /data-action="refresh-generated-document-editor"[^>]*>Обновить сессию</u);
assert.match(appSource, /data-action="save-generated-document-editor"/u);
assert.match(appSource, /data-action="cancel-generated-document-editor-or-preview"/u);
assert.match(appSource, /ais-generated-document-editor/u);
assert.match(appSource, /closeGeneratedDocumentPreview/u);
assert.match(appSource, /Отправка по email:/u);
assert.match(appSource, /button\?\.isConnected\s*&&\s*!button\.disabled/u);
assert.match(
  appSource,
  /event\.data\.type === "state"[\s\S]+editorChangesPending = Boolean\(event\.data\.modified\)[\s\S]+if \(editorChangesPending\) editorDirty = true[\s\S]+saveButton\.disabled = !editorReady \|\| editorChangesPending/u,
  "Сохранение должно ждать передачи последней правки из редактора в ONLYOFFICE"
);
assert.match(
  appSource,
  /const saveCurrentEditorChanges = async \(\) => \{[\s\S]+saveGeneratedDocumentEditor\([\s\S]+editorDirty[\s\S]+setPreviewMode\(/u,
  "Явный выбор «Сохранить» должен передать в ONLYOFFICE флаг наличия правок и вернуть обновлённый PDF"
);
assert.match(
  appSource,
  /const discardCurrentEditorChanges = async \(\{ closePreview = false \} = \{\}\) => \{[\s\S]+discardGeneratedDocumentEditor\([\s\S]+if \(closePreview\) \{\s*finish\(false\);/u,
  "Выбор «Не сохранять» должен отменить серверную сессию редактора до закрытия"
);
assert.match(
  appSource,
  /4 \* 60 \* 1000, "ONLYOFFICE не завершил сохранение документа за 4 минуты/u,
  "Клиент должен ждать дольше максимального серверного цикла сохранения и конвертации"
);

const editorClientApiStart = appSource.indexOf("  function generatedDocumentEditorResponseError");
const editorClientApiEnd = appSource.indexOf(
  "  function showGeneratedDocumentPreview",
  editorClientApiStart
);
assert.ok(editorClientApiStart >= 0 && editorClientApiEnd > editorClientApiStart);
const editorClientApiSource = appSource
  .slice(editorClientApiStart, editorClientApiEnd)
  .replace(/^  /gmu, "");
const clientRequestLog = [];
let clientResponseQueue = [];
const editorClientApiContext = {
  Boolean,
  Error,
  Math,
  Number,
  String,
  URL,
  documentProcessingApiUrl: (pathname) => pathname,
  fetchWithTimeout: async (url, request, _timeoutMs, _timeoutMessage, parseResponse) => {
    clientRequestLog.push({ url, request });
    const specification = clientResponseQueue.shift();
    assert.ok(specification, `Не подготовлен тестовый ответ для ${url}`);
    const headers = new Map(Object.entries(specification.headers || {}).map(([name, value]) => [
      name.toLowerCase(),
      String(value)
    ]));
    const response = {
      ok: specification.status >= 200 && specification.status < 300,
      status: specification.status,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
      json: async () => specification.payload || {},
      blob: async () => specification.blob || { kind: "pdf" }
    };
    return parseResponse(response);
  }
};
vm.createContext(editorClientApiContext);
vm.runInContext(
  `${editorClientApiSource}\nthis.saveGeneratedDocumentEditor = saveGeneratedDocumentEditor;`,
  editorClientApiContext
);
const makeClientEditorSession = () => ({
  editorUrl: "https://editor.example/session",
  editorOrigin: "https://editor.example",
  editorToken: "editor-token",
  editRevision: 0,
  expiresAt: 0
});

clientResponseQueue = [
  { status: 404, payload: { error: "Сессия редактирования не найдена." } },
  {
    status: 200,
    payload: {
      ok: true,
      editorToken: "editor-token",
      editorUrl: "https://editor.example/session",
      editRevision: 0,
      expiresAt: Date.now() + 60 * 60 * 1000
    }
  },
  {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "X-Document-Preview-Revision": "1"
    }
  }
];
clientRequestLog.length = 0;
const recoveredClientSave = await editorClientApiContext.saveGeneratedDocumentEditor(
  "preview-token",
  makeClientEditorSession(),
  "https://processing.example",
  true
);
assert.equal(recoveredClientSave.editRevision, 1);
assert.deepEqual(
  clientRequestLog.map(({ url }) => url),
  [
    "/api/contracts/student-document-preview/editor-save",
    "/api/contracts/student-document-preview/editor-refresh",
    "/api/contracts/student-document-preview/editor-save"
  ],
  "404 сохранения должен вызвать ровно один refresh и ровно один повтор save"
);

clientResponseQueue = [
  { status: 404, payload: { error: "Сессия редактирования не найдена." } },
  {
    status: 200,
    payload: {
      ok: true,
      editorToken: "editor-token",
      editorUrl: "https://editor.example/session",
      editRevision: 0,
      expiresAt: Date.now() + 60 * 60 * 1000
    }
  },
  { status: 404, payload: { error: "Сессия редактирования не найдена." } }
];
clientRequestLog.length = 0;
await assert.rejects(
  Promise.race([
    editorClientApiContext.saveGeneratedDocumentEditor(
      "preview-token",
      makeClientEditorSession(),
      "https://processing.example",
      true
    ),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("Повтор сохранения зациклился.")),
      250
    ))
  ]),
  /Сессия редактирования не найдена/u
);
assert.equal(
  clientRequestLog.filter(({ url }) => url.endsWith("/editor-save")).length,
  2,
  "Постоянный 404 допускает не больше двух save-запросов"
);
assert.equal(
  clientRequestLog.filter(({ url }) => url.endsWith("/editor-refresh")).length,
  1,
  "Постоянный 404 допускает только одну попытку refresh"
);

clientResponseQueue = [
  { status: 409, payload: { error: "Документ изменился во время сохранения." } }
];
clientRequestLog.length = 0;
await assert.rejects(
  editorClientApiContext.saveGeneratedDocumentEditor(
    "preview-token",
    makeClientEditorSession(),
    "https://processing.example",
    true
  ),
  /Документ изменился/u
);
assert.deepEqual(
  clientRequestLog.map(({ url }) => url),
  ["/api/contracts/student-document-preview/editor-save"],
  "409 конфликта нельзя лечить refresh или автоматическим перехватом"
);

const previewModalStart = appSource.indexOf("function showGeneratedDocumentPreview");
const previewModalEnd = appSource.indexOf("function documentEmailMessageContainsHtml", previewModalStart);
assert.ok(previewModalStart >= 0 && previewModalEnd > previewModalStart);
const previewModalSource = appSource.slice(previewModalStart, previewModalEnd);
assert.match(
  previewModalSource,
  /\.modal-head \[data-action='cancel-generated-document-preview'\]/u,
  "Крестик должен по-прежнему закрывать весь процесс формирования"
);
assert.match(
  previewModalSource,
  /const requestClosePreview = async \(\) => \{[\s\S]+if \(editorDirty\)[\s\S]+chooseUnsavedChangesAction\([\s\S]+decision === "cancel"[\s\S]+decision === "save"[\s\S]+saveCurrentEditorChanges\(\)[\s\S]+discardCurrentEditorChanges\(\{ closePreview: true \}\)/u,
  "Закрытие ONLYOFFICE с правками должно показывать общий диалог «Сохранить / Не сохранять / Отмена»"
);
assert.match(
  previewModalSource,
  /if \(editorSession\) return discardCurrentEditorChanges\(\{ closePreview: true \}\);[\s\S]+finish\(false\)/u,
  "Даже чистую сессию ONLYOFFICE нужно удалить на сервере перед закрытием предпросмотра"
);
assert.match(previewModalSource, /backdrop\.closeGeneratedDocumentPreview = requestClosePreview/u);
assert.match(
  previewModalSource,
  /backdrop\.forceCloseGeneratedDocumentPreview = \(confirmed = false\) => \{[\s\S]+const sessionToDiscard = editorSession[\s\S]+discardGeneratedDocumentEditor\([\s\S]+sessionToDiscard\.editorToken[\s\S]+\.catch\(\(\) => null\)[\s\S]+finish\(confirmed\)/u,
  "Принудительное закрытие должно очистить активную серверную сессию ONLYOFFICE"
);
assert.match(previewModalSource, /if \(event\.target === backdrop\) requestClosePreview\(\)/u);
assert.match(previewModalSource, /\.modal-head \[data-action='cancel-generated-document-preview'\][\s\S]+\.addEventListener\("click", requestClosePreview\)/u);
const editorCancelHandlerStart = previewModalSource.indexOf("const requestCancelEditorOrPreview = async () =>");
const editorCancelHandlerEnd = previewModalSource.indexOf("backdrop.closeGeneratedDocumentPreview", editorCancelHandlerStart);
assert.ok(editorCancelHandlerStart >= 0 && editorCancelHandlerEnd > editorCancelHandlerStart);
const editorCancelHandlerSource = previewModalSource.slice(editorCancelHandlerStart, editorCancelHandlerEnd);
assert.match(editorCancelHandlerSource, /if \(!editorSession\) return requestClosePreview\(\)/u);
assert.match(editorCancelHandlerSource, /if \(editorDirty\)[\s\S]+chooseUnsavedChangesAction\(/u);
assert.match(editorCancelHandlerSource, /decision === "cancel"[\s\S]+return false/u);
assert.match(editorCancelHandlerSource, /decision === "save"[\s\S]+saveCurrentEditorChanges\(\)/u);
assert.match(
  editorCancelHandlerSource,
  /return discardCurrentEditorChanges\(\)/u,
  "После выбора «Не сохранять» нижняя кнопка должна вернуть исходный PDF"
);
assert.match(previewModalSource, /cancelButton\?\.addEventListener\("click", requestCancelEditorOrPreview\)/u);
assert.match(previewModalSource, /let editorStartPending = false;\s+let editorStartSequence = 0;/u);
assert.match(
  previewModalSource,
  /const finish = \(confirmed\) => \{[\s\S]+settled = true;\s+editorStartSequence \+= 1;/u,
  "Закрытие предпросмотра должно инвалидировать незавершённый запуск ONLYOFFICE"
);
assert.match(
  previewModalSource,
  /editButton\?\.addEventListener\("click", async \(\) => \{[\s\S]+const startSequence = \+\+editorStartSequence;\s+editorStartPending = true;[\s\S]+const requestedSession = await requestGeneratedDocumentEditor\([\s\S]+if \(settled \|\| startSequence !== editorStartSequence\) \{[\s\S]+await discardGeneratedDocumentEditor\([\s\S]+requestedSession\.editorToken[\s\S]+\.catch\(\(\) => null\);\s+return;[\s\S]+setEditorMode\(requestedSession\)/u,
  "Поздний ответ editor-start после закрытия должен удалить созданную сессию, а не открыть редактор в удалённом окне"
);
assert.match(
  previewModalSource,
  /finally \{\s+if \(startSequence === editorStartSequence\) editorStartPending = false;\s+if \(!settled && startSequence === editorStartSequence\)/u,
  "Завершение устаревшего editor-start не должно менять состояние нового или закрытого предпросмотра"
);
assert.match(
  previewModalSource,
  /const refreshCurrentEditorSession = async \(\) => \{[\s\S]+refreshGeneratedDocumentEditor\([\s\S]+if \(settled \|\| editorSession !== sessionToRefresh\) return false;[\s\S]+frame\.src = refreshedEditorFrameUrl\(sessionToRefresh\)/u,
  "Кнопка обновления должна продлить ту же сессию и перезагрузить iframe только пока открыт тот же редактор"
);
const manualRefreshStart = previewModalSource.indexOf("const refreshCurrentEditorSession = async () =>");
const manualRefreshEnd = previewModalSource.indexOf("const saveCurrentEditorChanges = async () =>", manualRefreshStart);
const manualRefreshSource = previewModalSource.slice(manualRefreshStart, manualRefreshEnd);
const manualRefreshRequest = manualRefreshSource.indexOf("await refreshGeneratedDocumentEditor(");
const manualRefreshReload = manualRefreshSource.indexOf("frame.src = refreshedEditorFrameUrl");
const pendingRecheck = manualRefreshSource.indexOf("if (editorChangesPending)", manualRefreshRequest);
assert.ok(manualRefreshRequest >= 0 && pendingRecheck > manualRefreshRequest);
assert.ok(manualRefreshReload > pendingRecheck);
assert.match(manualRefreshSource, /frame\.setAttribute\("inert", ""\)[\s\S]+frame\.style\.pointerEvents = "none"/u);
assert.match(manualRefreshSource, /frame\.removeAttribute\("inert"\)[\s\S]+frame\.style\.pointerEvents = previousFramePointerEvents/u);
assert.match(
  previewModalSource,
  /refreshButton\?\.addEventListener\("click", refreshCurrentEditorSession\)/u,
  "Кнопка «Обновить сессию» должна иметь обработчик"
);
assert.match(
  previewModalSource,
  /refreshBeforeSave:\s*sessionExpiresSoon[\s\S]+\[403, 404\]\.includes\(editorSessionRefreshStatus\)/u,
  "Сохранение должно предварительно обновлять истекающую или ранее потерянную сессию"
);
assert.match(
  previewModalSource,
  /catch \(error\) \{[\s\S]+\[403, 404\]\.includes\(Number\(error\?\.status \|\| 0\)\)[\s\S]+markEditorSessionRefreshError/u,
  "После исчерпания bounded retry UI должен предложить ручное обновление сессии"
);
assert.match(
  previewModalSource,
  /finally \{[\s\S]+editorActionPending = false;[\s\S]+saveButton\.disabled = !editorReady \|\| editorChangesPending;[\s\S]+refreshButton\.disabled = editorChangesPending;[\s\S]+cancelButton\.disabled = false;/u,
  "Неудачное сохранение или обновление не должно навсегда блокировать действия окна"
);

const pipelineStart = appSource.indexOf("async function downloadStudentDocumentFromTemplate");
const pipelineEnd = appSource.indexOf("async function openStudentEducationDocument", pipelineStart);
const pipeline = appSource.slice(pipelineStart, pipelineEnd);
assert.ok(pipeline.indexOf("showGeneratedDocumentPreview") < pipeline.indexOf("prepareStudentDocumentStorageRequest"));
assert.ok(pipeline.indexOf("student-document-preview/finalize") < pipeline.indexOf("finishStudentDocumentGeneration"));
assert.ok(pipeline.indexOf("finishStudentDocumentGeneration") < pipeline.indexOf("addAudit"));

assert.match(serverSource, /if \(body\.previewOnly\)[\s\S]+registerGeneratedDocumentPreview/u);
assert.match(serverSource, /handleGeneratedDocumentPreviewFinalize/u);
assert.match(serverSource, /if \(body\.openAfterGeneration === true\)[\s\S]+await revealFileInExplorer\(localSaveResult\.path\)/u);
const localPromptSaveStart = serverSource.indexOf("async function promptAndSaveStudentDocumentLocally");
const localPromptSaveEnd = serverSource.indexOf("async function saveStudentDocumentLocally", localPromptSaveStart);
assert.ok(localPromptSaveStart >= 0 && localPromptSaveEnd > localPromptSaveStart);
assert.doesNotMatch(
  serverSource.slice(localPromptSaveStart, localPromptSaveEnd),
  /revealFileInExplorer/u,
  "Открытие локального документа должно зависеть от настройки шаблона"
);
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
assert.match(serverSource, /handleGeneratedDocumentPreviewEditorRefresh/u);
assert.match(
  serverSource,
  /const GENERATED_DOCUMENT_EDITOR_RECOVERY_TTL_MS = 12 \* 60 \* 60 \* 1000;/u,
  "Recovery grace editor session должен составлять 12 часов"
);
assert.match(
  serverSource,
  /const GENERATED_DOCUMENT_EDITOR_HEARTBEAT_MS = 60 \* 1000;/u,
  "Iframe должен обновлять editor session раз в минуту"
);
assert.match(
  serverSource,
  /function generatedDocumentEditorTokenMatches[\s\S]+crypto\.timingSafeEqual/u,
  "Refresh должен сверять editor token constant-time"
);
assert.match(
  serverSource,
  /function refreshGeneratedDocumentPreviewEditorMetadata[\s\S]+generatedDocumentEditorTokenMatches\(metadata\.editorSession, editorToken\)[\s\S]+extendGeneratedDocumentEditorSession\(metadata, authUser, now\)/u,
  "Refresh должен продлевать только ту же editor session и проверять владельца"
);
assert.match(
  serverSource,
  /async function storeGeneratedDocumentPreviewEditedDocx[\s\S]+extendGeneratedDocumentEditorSession\(metadata, null, savedAt\)/u,
  "Успешный callback/autosave должен продлевать editorSession.expiresAt"
);
const editorRefreshHandlerSource = serverSource.slice(
  serverSource.indexOf("async function handleGeneratedDocumentPreviewEditorRefresh"),
  serverSource.indexOf("async function handleGeneratedDocumentPreviewEditorPage")
);
assert.match(editorRefreshHandlerSource, /assertGeneratedDocumentEditorBackendAvailable\(req\)/u);
assert.match(editorRefreshHandlerSource, /refreshGeneratedDocumentPreviewEditor\(/u);
assert.match(editorRefreshHandlerSource, /Set-Cookie/u, "Refresh должен продлевать proxy-cookie ONLYOFFICE");
const editorPageHandlerSource = serverSource.slice(
  serverSource.indexOf("async function handleGeneratedDocumentPreviewEditorPage"),
  serverSource.indexOf("async function handleGeneratedDocumentPreviewEditorFile")
);
assert.match(editorPageHandlerSource, /let sessionRefreshPending = false/u);
assert.match(
  editorPageHandlerSource,
  /if \(sessionRefreshPending\) return;[\s\S]+sessionRefreshPending = true;[\s\S]+finally \{\s*sessionRefreshPending = false;/u,
  "Heartbeat не должен запускать перекрывающиеся refresh-запросы"
);
assert.match(editorPageHandlerSource, /student-document-preview\/editor-refresh/u);
assert.match(editorPageHandlerSource, /window\.setInterval\([\s\S]+GENERATED_DOCUMENT_EDITOR_HEARTBEAT_MS/u);
assert.match(editorPageHandlerSource, /document\.addEventListener\("visibilitychange"[\s\S]+visibilityState === "visible"[\s\S]+refreshSession/u);
assert.match(editorPageHandlerSource, /window\.addEventListener\("online", refreshSession\)/u);
assert.match(editorPageHandlerSource, /window\.addEventListener\("pageshow", refreshSession\)/u);
assert.match(editorPageHandlerSource, /beforeunload[\s\S]+clearInterval\(sessionHeartbeat\)/u);
assert.match(
  serverSource,
  /function assertGeneratedDocumentEditorBackendAvailable[\s\S]+generatedDocumentRequestBackend\(req\) !== "server"[\s\S]+Онлайн-редактор доступен только через локальный сервис[\s\S]+503/u,
  "SERVER preview не должен выдавать editor URL на tunnel, где нет его token."
);
assert.match(serverSource, /handleGeneratedDocumentPreviewEditorCallback/u);
assert.match(serverSource, /handleGeneratedDocumentPreviewEditorSave/u);
assert.match(
  serverSource,
  /await clearGeneratedDocumentPreviewEditorError\(previewToken, editorToken\);\s+const forceSave/u,
  "Повторная попытка сохранения не должна завершаться из-за ошибки предыдущей попытки"
);
assert.match(serverSource, /handleGeneratedDocumentPreviewEditorDiscard/u);
assert.match(serverSource, /discardGeneratedDocumentPreviewEditor/u);
assert.match(
  serverSource,
  /async function commitGeneratedDocumentPreviewRenderedPdf[\s\S]+metadata\.editorSession\s*=\s*null/u,
  "Запись PDF и закрытие сессии редактора должны выполняться одной операцией"
);
assert.match(
  serverSource,
  /async function renderGeneratedDocumentPreviewEditorPdf[\s\S]+await commitGeneratedDocumentPreviewRenderedPdf\(/u,
  "Подготовка сохранённого PDF должна атомарно завершать сессию редактора"
);
assert.match(serverSource, /student-document-preview\/editor-discard/u);
assert.match(serverSource, /requestOnlyOfficeForceSave/u);
assert.match(serverSource, /verifyOnlyOfficeJwt/u);
assert.match(serverSource, /proxyOnlyOfficeHttpRequest/u);
assert.match(serverSource, /proxyOnlyOfficeWebSocket/u);
assert.match(serverSource, /server\.on\("upgrade"/u);
assert.match(gatewaySource, /x-ais-session-id/u);
assert.match(
  gatewaySource,
  /\$isPreviewControlRequest\s*=\s*in_array\([\s\S]+student-document-preview\/editor-discard[\s\S]+true\);/u
);
assert.match(gatewaySource, /\$requestBodyLimit\s*=\s*\$isPreviewControlRequest\s*\?\s*4096/u);
assert.match(gatewaySource, /stream_get_contents\(\$inputStream,\s*\$requestBodyLimit\s*\+\s*1\)/u);
assert.match(stylesSource, /\.generated-document-preview-dialog/u);
assert.match(stylesSource, /\.generated-document-preview-frame/u);
assert.match(stylesSource, /\.generated-document-preview-frame\.is-editor/u);
const desktopPreviewActionsRule = getCssRule(
  stylesSource,
  ".generated-document-preview-actions"
);
assert.match(desktopPreviewActionsRule, /display:\s*flex/u);
assert.match(desktopPreviewActionsRule, /flex-wrap:\s*wrap/u);
assert.doesNotMatch(desktopPreviewActionsRule, /grid-template-columns/u);
const previewButtonsMarkup = previewModalSource.match(/<div class="generated-document-preview-buttons">([\s\S]*?)<\/div>/u)?.[1];
assert.ok(previewButtonsMarkup, "Кнопки предпросмотра и редактора должны находиться в общей панели.");
assert.deepEqual(
  Array.from(previewButtonsMarkup.matchAll(/data-action="([^"]+)"/gu), (match) => match[1]),
  [
    "edit-generated-document-preview",
    "refresh-generated-document-editor",
    "save-generated-document-editor",
    "confirm-generated-document-preview",
    "cancel-generated-document-editor-or-preview"
  ],
  "Сохранение и отмена должны стоять в одном ряду с остальными действиями, в прежнем порядке."
);
const previewButtonsRule = getCssRule(stylesSource, ".generated-document-preview-buttons");
assert.match(previewButtonsRule, /display:\s*flex/u);
assert.match(previewButtonsRule, /flex-wrap:\s*wrap/u);
assert.match(previewButtonsRule, /justify-content:\s*flex-end/u);
const previewButtonRule = getCssRule(
  stylesSource,
  ".generated-document-preview-buttons button"
);
assert.match(previewButtonRule, /flex:\s*0\s+0\s+auto/u);
assert.match(previewButtonRule, /width:\s*auto/u);
assert.match(previewButtonRule, /white-space:\s*nowrap/u);
const mobilePreviewStart = stylesSource.indexOf("@media (max-width: 720px)", stylesSource.indexOf(".student-mailbox-dialog"));
assert.notEqual(mobilePreviewStart, -1, "Не найден адаптивный блок предварительного просмотра.");
const mobilePreviewActionsRule = getCssRule(
  stylesSource,
  ".generated-document-preview-actions",
  mobilePreviewStart
);
assert.doesNotMatch(mobilePreviewActionsRule, /grid-template-columns/u);
const mobilePreviewHintRule = getCssRule(
  stylesSource,
  ".generated-document-preview-actions small",
  mobilePreviewStart
);
assert.match(mobilePreviewHintRule, /flex-basis:\s*100%/u);
const mobilePreviewButtonRule = getCssRule(stylesSource, ".generated-document-preview-actions button", mobilePreviewStart);
assert.doesNotMatch(mobilePreviewButtonRule, /width:\s*100%/u, "Кнопки не должны растягиваться и на мобильном экране.");
assert.doesNotMatch(stylesSource, /generated-document-preview-actions \[data-action="edit-generated-document-preview"\][\s\S]*?grid-column:\s*1\s*\/\s*-1/u);

console.log("Document generation preview tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
