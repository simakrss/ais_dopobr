"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const localServerPath = path.join(root, "local-server.js");
const localServerSource = fs.readFileSync(localServerPath, "utf8").replace(/\r\n/g, "\n");
const appServerSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8").replace(/\r\n/g, "\n");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const startSource = fs.readFileSync(
  path.join(root, "scripts", "start-lan-system.js"),
  "utf8"
).replace(/\r\n/gu, "\n");

async function testSupervisorTransientHealthTimeoutRecovery() {
  const retryStart = startSource.indexOf("async function isAisServiceHealthyWithRetry");
  const retryEnd = startSource.indexOf("\n\nfunction processCommandLine", retryStart);
  const serverStart = startSource.indexOf("async function startServer");
  const serverEnd = startSource.indexOf("\n\nfunction startDocumentServices", serverStart);
  assert.ok(retryStart >= 0 && retryEnd > retryStart, "Не найден retry health-check супервизора");
  assert.ok(serverStart >= 0 && serverEnd > serverStart, "Не найден запуск сервера супервизора");
  const calls = [];
  const factory = new Function(
    "isAisServiceHealthy",
    "listeningPid",
    "wait",
    "console",
    `${startSource.slice(retryStart, retryEnd)}\n`
      + `${startSource.slice(serverStart, serverEnd)}\n`
      + "return startServer;"
  );
  const startServer = factory(
    async (_port, environment) => {
      calls.push(environment ? "authenticated" : "anonymous");
      return calls.length === 1 ? false : true;
    },
    () => 4242,
    async () => {},
    { log: () => {} }
  );
  const pid = await startServer(
    { name: "Application server", port: 19081, scriptName: "app-server.js" },
    { AIS_GATEWAY_SHARED_SECRET: "s".repeat(64) }
  );
  assert.equal(pid, 4242);
  assert.deepEqual(calls, ["authenticated", "anonymous", "authenticated"]);
}

function createDocumentProcessingResolver(healthPayload, options = {}) {
  const start = appSource.indexOf("  function documentProcessingApiUrl");
  const end = appSource.indexOf("\n\n  function photoPublicUrl", start);
  assert.ok(start >= 0 && end > start, "Не найден клиентский блок выбора сервиса документов");
  let fetchCount = 0;
  let capturedRequestOptions = null;
  const fetchMock = async (url, requestOptions) => {
    fetchCount += 1;
    capturedRequestOptions = requestOptions;
    const tunneled = String(url).startsWith("https://");
    if (options.reject === true || (options.rejectLocal === true && !tunneled)) {
      throw new Error("Local service unavailable");
    }
    const payload = tunneled && options.tunnelPayload ? options.tunnelPayload : healthPayload;
    return {
      ok: true,
      headers: {
        get: (name) => name === "X-AIS-Processing"
          ? (tunneled ? "local-tunnel" : "local-docker")
          : null
      },
      json: async () => payload
    };
  };
  const factory = new Function(
    "window",
    "fetch",
    "AbortController",
    "photoServerOrigin",
    `
const defaultPhotoServerOrigin = "http://localhost:8081";
const localDocumentServicesOrigin = "http://127.0.0.1:8081";
const localDocumentServicesCacheMilliseconds = 10000;
const localDocumentServicesState = { checkedAt: 0, capabilities: null, request: null };
${appSource.slice(start, end)}
return { probeLocalDocumentServices, resolveDocumentProcessingOrigin };
`
  );
  const api = factory(
    { location: { protocol: "https:" }, setTimeout, clearTimeout },
    fetchMock,
    AbortController,
    () => "https://edu-plus.ru/lms"
  );
  return {
    ...api,
    getFetchCount: () => fetchCount,
    getRequestOptions: () => capturedRequestOptions
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function getFreePort() {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function waitForServer(url, child, stderr) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Локальный сервер завершился при запуске: ${stderr.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child process has not opened the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Локальный сервер не запустился: ${stderr.join("")}`);
}

async function main() {
  await testSupervisorTransientHealthTimeoutRecovery();
  const localResolver = createDocumentProcessingResolver({
    appServerAvailable: true,
    ocrAvailable: true,
    documentConversionAvailable: true,
    localDocumentsAvailable: true,
    openDocumentsLocally: true
  });
  assert.equal(await localResolver.resolveDocumentProcessingOrigin("ocr"), "http://127.0.0.1:8081");
  assert.equal(
    await localResolver.resolveDocumentProcessingOrigin("documentConversion"),
    "http://127.0.0.1:8081"
  );
  assert.equal(localResolver.getFetchCount(), 1, "Проверка локальных сервисов должна кэшироваться");
  assert.equal(localResolver.getRequestOptions().targetAddressSpace, "local");
  assert.equal((await localResolver.probeLocalDocumentServices()).localDocumentsAvailable, true);

  const degradedResolver = createDocumentProcessingResolver({
    appServerAvailable: true,
    ocrAvailable: false,
    documentConversionAvailable: true
  });
  assert.equal(
    await degradedResolver.resolveDocumentProcessingOrigin("ocr"),
    "https://edu-plus.ru/lms"
  );
  assert.equal(
    await degradedResolver.resolveDocumentProcessingOrigin("documentConversion"),
    "http://127.0.0.1:8081"
  );
  const tunnelResolver = createDocumentProcessingResolver({}, {
    rejectLocal: true,
    tunnelPayload: {
      appServerAvailable: true,
      ocrAvailable: true,
      documentConversionAvailable: true,
      localDocumentsAvailable: true,
      openDocumentsLocally: true
    }
  });
  assert.equal(
    await tunnelResolver.resolveDocumentProcessingOrigin("ocr"),
    "https://edu-plus.ru/lms"
  );
  assert.equal(tunnelResolver.getFetchCount(), 2, "После локального сервиса должен проверяться туннель");
  const editingOnlyResolver = createDocumentProcessingResolver({
    appServerAvailable: true,
    ocrAvailable: false,
    documentConversionAvailable: false,
    documentEditingAvailable: true
  });
  assert.equal(
    await editingOnlyResolver.resolveDocumentProcessingOrigin("documentConversion"),
    "https://edu-plus.ru/lms",
    "ONLYOFFICE-редактор не должен выдаваться за высококачественный PDF-конвертер"
  );
  const unavailableResolver = createDocumentProcessingResolver({}, { reject: true });
  assert.equal(
    await unavailableResolver.resolveDocumentProcessingOrigin("ocr"),
    "https://edu-plus.ru/lms"
  );

  const forwardedRequests = [];
  let appHealthPayload = {
    ok: true,
    storage: "mysql",
    highQualityPdfConversionAvailable: true,
    localDocumentsAvailable: true,
    openDocumentsLocally: true
  };
  let documentEditingHealthy = true;
  const appServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(appHealthPayload));
        return;
      }
      forwardedRequests.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files: [], source: "local" }));
    });
  });
  const ocrServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const conversionServer = http.createServer((_req, res) => {
    res.writeHead(documentEditingHealthy ? 200 : 503, { "Content-Type": "text/plain" });
    res.end(documentEditingHealthy ? "true" : "false");
  });

  let child = null;
  try {
    const appPort = await listen(appServer);
    const ocrPort = await listen(ocrServer);
    const conversionPort = await listen(conversionServer);
    const localPort = await getFreePort();
    const gatewaySecret = "s".repeat(64);
    const stderr = [];
    child = spawn(process.execPath, [localServerPath], {
      cwd: root,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(localPort),
        AIS_APP_SERVER_ORIGIN: `http://127.0.0.1:${appPort}`,
        AIS_GATEWAY_SHARED_SECRET: gatewaySecret,
        AIS_OCR_HEALTH_URL: `http://127.0.0.1:${ocrPort}/health`,
        AIS_DOCUMENT_CONVERSION_HEALTH_URL: `http://127.0.0.1:${conversionPort}/healthcheck`
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));
    const baseUrl = `http://127.0.0.1:${localPort}`;
    await waitForServer(`${baseUrl}/api/local-document-services/health`, child, stderr);

    const remoteHeaders = {
      "Origin": "https://edu-plus.ru",
      "X-Requested-With": "AIS-Web"
    };
    const healthResponse = await fetch(`${baseUrl}/api/local-document-services/health`, {
      headers: remoteHeaders
    });
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.headers.get("access-control-allow-origin"), "https://edu-plus.ru");
    assert.equal(healthResponse.headers.get("access-control-allow-private-network"), "true");
    assert.equal(healthResponse.headers.get("x-ais-processing"), "local-docker");
    const health = await healthResponse.json();
    assert.deepEqual(health, {
      ok: true,
      appServerAvailable: true,
      ocrAvailable: true,
      documentConversionAvailable: true,
      documentEditingAvailable: true,
      localDocumentsAvailable: true,
      openDocumentsLocally: true
    });

    const preflight = await fetch(`${baseUrl}/api/students/recognize-documents/files`, {
      method: "OPTIONS",
      headers: {
        ...remoteHeaders,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-requested-with",
        "Access-Control-Request-Private-Network": "true"
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

    const filesResponse = await fetch(`${baseUrl}/api/students/recognize-documents/files`, {
      method: "POST",
      headers: { ...remoteHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "Слушатели/Тест/Документы", source: "local" })
    });
    const filesResponseText = await filesResponse.text();
    assert.equal(filesResponse.status, 200, filesResponseText);
    assert.equal(filesResponse.headers.get("x-ais-processing"), "local-docker");
    assert.equal(forwardedRequests.length, 1);
    assert.equal(forwardedRequests[0].headers["x-forwarded-host"], "edu-plus.ru");
    assert.equal(forwardedRequests[0].headers["x-forwarded-proto"], "https");
    assert.equal(forwardedRequests[0].headers["x-ais-gateway-token"], gatewaySecret);
    assert.equal(forwardedRequests[0].headers["x-ais-user-role"], "manager");

    const templateResponse = await fetch(`${baseUrl}/api/documents/template-reveal-local`, {
      method: "POST",
      headers: { ...remoteHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ templateUrl: "Документы/Шаблон.docx", templatePath: "" })
    });
    const templateResponseText = await templateResponse.text();
    assert.equal(templateResponse.status, 200, templateResponseText);
    assert.equal(templateResponse.headers.get("x-ais-processing"), "local-docker");
    assert.equal(forwardedRequests.length, 2);
    assert.equal(forwardedRequests[1].url, "/api/documents/template-reveal-local");
    assert.equal(forwardedRequests[1].headers["x-ais-gateway-token"], gatewaySecret);

    const databaseResponse = await fetch(
      `${baseUrl}/api/students/export-database/status?id=test-job`,
      {
        headers: {
          ...remoteHeaders,
          "X-AIS-Gateway-Token": gatewaySecret,
          "X-AIS-Session-Id": "remote-session",
          "X-AIS-User-Id": "admin-id",
          "X-AIS-User-Login": "admin",
          "X-AIS-User-Name": "Administrator",
          "X-AIS-User-Role": "admin"
        }
      }
    );
    assert.equal(databaseResponse.status, 200);
    assert.equal(forwardedRequests.length, 3);
    assert.equal(forwardedRequests[2].headers["x-ais-user-id"], "admin-id");
    assert.equal(forwardedRequests[2].headers["x-ais-user-role"], "admin");
    assert.equal(forwardedRequests[2].headers["x-ais-session-id"], "remote-session");

    const photoResponse = await fetch(
      `${baseUrl}/api/student-photo?path=${encodeURIComponent("\\Слушатели\\Тест\\Документы\\Тест.jpg")}`,
      { headers: remoteHeaders }
    );
    assert.equal(photoResponse.status, 200);
    assert.equal(forwardedRequests.length, 4);
    assert.equal(forwardedRequests[3].headers["x-ais-user-role"], "manager");

    const disallowedPath = await fetch(`${baseUrl}/api/admin/users`, { headers: remoteHeaders });
    assert.equal(disallowedPath.status, 403);
    const disallowedOrigin = await fetch(`${baseUrl}/api/local-document-services/health`, {
      headers: { ...remoteHeaders, "Origin": "https://example.invalid" }
    });
    assert.equal(disallowedOrigin.status, 403);

    appHealthPayload = { ok: true, storage: "mysql" };
    const editingOnlyHealthResponse = await fetch(`${baseUrl}/api/local-document-services/health`, {
      headers: remoteHeaders
    });
    const editingOnlyHealth = await editingOnlyHealthResponse.json();
    assert.deepEqual(editingOnlyHealth, {
      ok: true,
      appServerAvailable: true,
      ocrAvailable: true,
      documentConversionAvailable: false,
      documentEditingAvailable: true,
      localDocumentsAvailable: false,
      openDocumentsLocally: false
    });

    appHealthPayload.highQualityPdfConversionAvailable = true;
    documentEditingHealthy = false;
    const generationOnlyHealthResponse = await fetch(`${baseUrl}/api/local-document-services/health`, {
      headers: remoteHeaders
    });
    const generationOnlyHealth = await generationOnlyHealthResponse.json();
    assert.deepEqual(generationOnlyHealth, {
      ok: true,
      appServerAvailable: true,
      ocrAvailable: true,
      documentConversionAvailable: true,
      documentEditingAvailable: false,
      localDocumentsAvailable: false,
      openDocumentsLocally: false
    });
    documentEditingHealthy = true;

    await close(ocrServer);
    const degradedResponse = await fetch(`${baseUrl}/api/local-document-services/health`, {
      headers: remoteHeaders
    });
    const degraded = await degradedResponse.json();
    assert.equal(degraded.appServerAvailable, true);
    assert.equal(degraded.ocrAvailable, false);
    assert.equal(degraded.documentConversionAvailable, true);
    assert.equal(degraded.documentEditingAvailable, true);

    assert.match(appSource, /resolveDocumentProcessingOrigin\("ocr"\)/u);
    assert.match(appSource, /resolveDocumentProcessingOrigin\("documentConversion"\)/u);
    assert.match(appSource, /targetAddressSpace: "local"/u);
    assert.match(appSource, /status\?jobId=.*recognitionOrigin/su);
    assert.match(appSource, /student-document-preview\/finalize[\s\S]*documentProcessingOrigin/u);
    assert.match(startSource, /AIS_TRUST_GATEWAY:\s*"1"/u);
    assert.match(startSource, /AIS_GATEWAY_SHARED_SECRET:\s*getLocalServiceGatewaySecret\(\)/u);
    assert.match(localServerSource, /\/api\/students\/export-database/u);
    assert.match(localServerSource, /trustedForwardedGatewayIdentity/u);
    assert.match(appServerSource, /\/api\/local-document-services\/health/u);
    assert.match(appServerSource, /readOcrHealthPayload\(\)\.catch/u);
    assert.match(gatewaySource, /\/api\/students\/export-database/u);
    assert.match(gatewaySource, /\/api\/student-photo/u);
    assert.match(gatewaySource, /\/api\/local-document-services\/health/u);

    console.log("local document services priority tests: OK");
  } finally {
    if (child && child.exitCode === null) child.kill();
    await Promise.allSettled([close(appServer), close(ocrServer), close(conversionServer)]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
