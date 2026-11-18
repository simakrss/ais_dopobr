"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
const secret = "test-only-local-ocr-gateway-secret";
let bodyReads = 0;
let folderReads = 0;

function extract(name, async = false) {
  const start = source.indexOf(`${async ? "async " : ""}function ${name}(`);
  const end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start, `Missing function ${name}`);
  return source.slice(start, end + 2);
}

const context = vm.createContext({
  URL, Buffer, crypto,
  process: { env: { AIS_GATEWAY_SHARED_SECRET: secret } },
  async readJsonBody(req) {
    bodyReads++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  },
  normalizeSystemDocumentsRelativePath: value => value,
  normalizeStudentOcrSource: value => value,
  useWebDavWhenLocalDocumentsUnavailable: async value => value,
  async findStudentOcrDocuments() {
    folderReads++;
    return { source: "local", sourceLabel: "Test fixture", skippedCount: 0, totalBytes: 4,
      documents: [{ fileName: "fixture.txt", relativeName: "fixture.txt", contentType: "text/plain", size: 4 }] };
  },
  sendJson(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  },
  sendError(res, status, error) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error }));
  }
});
vm.runInContext([
  ...["requestHasGatewaySecret", "requestHasConfiguredGatewaySecret", "isTrustedPortlessLocalOcrOrigin", "isTrustedBrowserOrigin"].map(name => extract(name)),
  extract("handleStudentDocumentRecognitionFiles", true)
].join("\n"), context);

function request(headers = {}, properties = {}) {
  return {
    method: "POST", url: "/api/students/recognize-documents/files",
    socket: { remoteAddress: "127.0.0.1" }, ...properties,
    headers: {
      host: "127.0.0.1:8081", origin: "http://127.0.0.1", referer: "http://127.0.0.1:8081/",
      "x-requested-with": "AIS-Web", "sec-fetch-site": "same-origin",
      "x-forwarded-host": "127.0.0.1:8081", "x-forwarded-proto": "http", "x-forwarded-for": "127.0.0.1",
      "x-ais-gateway-token": secret, ...headers
    }
  };
}

function testOriginDecisions() {
  assert.equal(context.isTrustedBrowserOrigin(request()), true, "Observed portless Origin should pass with all independent proofs");
  assert.equal(context.isTrustedBrowserOrigin(request({ origin: "http://127.0.0.1:8081" })), true);
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(context.isTrustedBrowserOrigin(request({ "x-forwarded-for": address }, { socket: { remoteAddress: address } })), true);
  }
  for (const hostname of ["localhost", "[::1]"]) {
    assert.equal(context.isTrustedBrowserOrigin(request({
      origin: `http://${hostname}`, host: `${hostname}:8081`, "x-forwarded-host": `${hostname}:8081`, referer: `http://${hostname}:8081/`
    })), true);
  }
  for (const endpoint of ["files", "start", "direct", "status", "result", "page", "field-region"]) {
    assert.equal(context.isTrustedBrowserOrigin(request({}, { url: `/api/students/recognize-documents/${endpoint}?jobId=test` })), true);
  }
  assert.equal(context.isTrustedBrowserOrigin(request({ "x-requested-with": "" }, {
    method: "GET", url: "/api/students/recognize-documents/status?jobId=test"
  })), true, "GET polling does not set X-Requested-With");
  const invalidHeaders = [
    { origin: "http://127.0.0.1:8082" },
    { origin: "https://127.0.0.1" },
    { origin: "http://localhost" },
    { origin: "https://attacker.example" },
    { origin: "http://127.0.0.1.attacker.example" },
    { origin: "http://127.0.0.1/" },
    { origin: "http://user@127.0.0.1" },
    { origin: "http://127.0.0.1?port=8081" },
    { origin: "invalid" },
    { referer: "" },
    { referer: "http://127.0.0.1/" },
    { referer: "http://127.0.0.1:8082/" },
    { referer: "http://127.0.0.1:8081.attacker.example/" },
    { referer: "https://attacker.example/" },
    { referer: "http://user@127.0.0.1:8081/" },
    { "sec-fetch-site": "" },
    { "sec-fetch-site": "same-site" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "none" },
    { "x-requested-with": "" },
    { "x-requested-with": "XMLHttpRequest" },
    { "x-forwarded-for": "192.168.1.10" },
    { "x-forwarded-for": "127.0.0.1, 192.168.1.10" },
    { "x-forwarded-for": "" },
    { "x-forwarded-proto": "https" },
    { "x-ais-gateway-token": "invalid" },
    { "x-ais-gateway-token": "" },
    { origin: "http://192.168.1.10", "x-forwarded-host": "192.168.1.10:8081", referer: "http://192.168.1.10:8081/" },
    { origin: "http://edu-plus.ru", "x-forwarded-host": "edu-plus.ru:8081", referer: "http://edu-plus.ru:8081/" }
  ];
  for (const headers of invalidHeaders) {
    assert.equal(context.isTrustedBrowserOrigin(request(headers)), false, JSON.stringify(headers));
  }
  for (const url of ["/api/admin/users", "/api/program-sites/prepare", "/api/students/recognize-documents/files/extra", "/api/students/recognize-documents/unknown"]) {
    assert.equal(context.isTrustedBrowserOrigin(request({}, { url })), false, "Exception must not expand to other routes");
  }
  assert.equal(context.isTrustedBrowserOrigin(request({}, { socket: { remoteAddress: "192.168.1.10" } })), false);
  assert.equal(context.isTrustedBrowserOrigin(request({}, { socket: undefined })), false);
  context.process.env.AIS_GATEWAY_SHARED_SECRET = "";
  assert.equal(context.isTrustedBrowserOrigin(request()), false, "An unconfigured gateway must not authorize the exception");
  context.process.env.AIS_GATEWAY_SHARED_SECRET = secret;
  assert.equal(context.isTrustedBrowserOrigin(request({
    origin: "https://edu-plus.ru", "x-forwarded-host": "edu-plus.ru", "x-forwarded-proto": "https", "sec-fetch-site": "cross-site"
  })), true, "Existing authenticated cloud gateway support must remain intact");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(server.address().port); });
  });
}
function close(server) { return new Promise(resolve => server.close(resolve)); }

async function testGatewayAndHandler() {
  const backend = http.createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); return;
    }
    void context.handleStudentDocumentRecognitionFiles(req, res);
  });
  const reservation = http.createServer();
  let child;
  let exit;
  try {
    const backendPort = await listen(backend);
    const port = await listen(reservation);
    await close(reservation);
    const base = `http://127.0.0.1:${port}`;
    const stderr = [];
    child = spawn(process.execPath, [path.join(root, "local-server.js")], {
      cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), AIS_APP_SERVER_ORIGIN: `http://127.0.0.1:${backendPort}`, AIS_GATEWAY_SHARED_SECRET: secret }
    });
    exit = new Promise(resolve => child.once("exit", resolve));
    child.stderr.on("data", chunk => stderr.push(String(chunk)));
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(stderr.join(""));
      try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Startup only. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, "Test gateway did not start");
    async function send(overrides = {}) {
      return fetch(`${base}/api/students/recognize-documents/files`, {
        method: "POST", signal: AbortSignal.timeout(5000), body: JSON.stringify({ folder: "test-fixture", source: "local" }),
        headers: { "Content-Type": "application/json", "X-Requested-With": "AIS-Web", Origin: "http://127.0.0.1", Referer: `${base}/`, "Sec-Fetch-Site": "same-origin", ...overrides }
      });
    }
    for (const origin of ["http://127.0.0.1", base]) {
      const response = await send({ Origin: origin });
      assert.equal(response.status, 200, await response.clone().text());
      const payload = await response.json();
      assert.equal(payload.files[0].fileName, "fixture.txt");
    }
    const acceptedBodyReads = bodyReads, acceptedFolderReads = folderReads;
    assert.equal(acceptedFolderReads, 2);
    for (const headers of [
      { Origin: "https://attacker.example" },
      { Origin: "http://127.0.0.1:8082" },
      { Referer: "http://127.0.0.1/" },
      { "Sec-Fetch-Site": "cross-site" },
      { "X-Requested-With": "" },
      { Origin: "http://127.0.0.1:8082", "X-Forwarded-Host": "127.0.0.1:8082", "X-AIS-Gateway-Token": secret }
    ]) {
      const response = await send(headers);
      assert.equal(response.status, 403, JSON.stringify(headers));
      await response.text();
    }
    assert.equal(bodyReads, acceptedBodyReads, "Rejected requests must not parse the body");
    assert.equal(folderReads, acceptedFolderReads, "Rejected requests must not access documents");
    const cloud = await send({ Origin: "https://edu-plus.ru", Referer: "https://edu-plus.ru/lms/", "Sec-Fetch-Site": "cross-site" });
    assert.equal(cloud.status, 200, await cloud.text());
    console.log("OCR browser origin tests: unit decisions and real local proxy -> document-list handler passed");
  } finally {
    if (child && child.exitCode === null) { child.kill(); await exit; }
    await close(backend);
    if (reservation.listening) await close(reservation);
  }
}

testOriginDecisions();
testGatewayAndHandler().catch(error => { console.error(error); process.exitCode = 1; });
