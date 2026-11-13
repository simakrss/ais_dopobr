"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");

process.env.AIS_TRUST_GATEWAY = "1";
process.env.AIS_GATEWAY_SHARED_SECRET = "test-database-demo-mode-secret";
process.env.AIS_DATABASE_DEMO_MODE = "1";

const { route, resolveDatabaseDemoPhotoAccess } = require("../app-server.js");

const server = http.createServer((req, res) => {
  Promise.resolve(route(req, res)).catch((error) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message }));
  });
});

function headers(role = "admin") {
  return {
    "X-AIS-Gateway-Token": process.env.AIS_GATEWAY_SHARED_SECRET,
    "X-AIS-User-Id": `test-${role}`,
    "X-AIS-User-Login": `test-${role}`,
    "X-AIS-User-Name": `Test ${role}`,
    "X-AIS-User-Role": role,
    "X-Requested-With": "AIS-Web"
  };
}

async function request(baseUrl, pathname, role = "admin", options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      ...headers(role),
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}

async function publicRequest(baseUrl, pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    redirect: "manual"
  });
}

async function main() {
  const forwardedPhotoSecret = "site-demo-photo-secret".repeat(3);
  const trustedForwardedRequest = {
    headers: {
      "x-ais-gateway-token": process.env.AIS_GATEWAY_SHARED_SECRET,
      "x-ais-demo-mode-id-secret": forwardedPhotoSecret
    }
  };
  for (const localDemoModeEnabled of [false, true]) {
    assert.deepEqual(
      resolveDatabaseDemoPhotoAccess(trustedForwardedRequest, localDemoModeEnabled),
      { enabled: true, idSecret: forwardedPhotoSecret, forwarded: true },
      "site HMAC secret должен работать через tunnel при любом локальном флаге"
    );
  }
  assert.equal(
    resolveDatabaseDemoPhotoAccess({ headers: {} }, false).enabled,
    false,
    "недоверенный запрос не должен включать демо-обход фото"
  );

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const statusResponse = await request(baseUrl, "/api/admin/demo-mode");
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).enabled, true);

  const unverifiedDisableResponse = await request(baseUrl, "/api/admin/demo-mode", "admin", {
    method: "POST",
    body: { enabled: false }
  });
  assert.equal(unverifiedDisableResponse.status, 400, "деморежим нельзя выключить без повторного ввода пароля");

  const managerStatusResponse = await request(baseUrl, "/api/admin/demo-mode", "manager");
  assert.equal(managerStatusResponse.status, 403);

  for (const [pathname, options] of [
    ["/api/shared-state", { method: "POST", body: { patch: {} } }],
    ["/api/shared-state?flush=1", { method: "GET" }],
    ["/api/shared-state/locks", { method: "GET" }],
    ["/api/admin/users", { method: "GET" }],
    ["/api/client-private-defaults", { method: "GET" }],
    ["/api/settings/system-documents", { method: "GET" }],
    ["/api/students/export-database", { method: "POST", body: {} }],
    ["/api/statistics/downloads", { method: "GET" }],
    ["/api/partner/profile", { method: "GET" }],
    ["/data/seed.js", { method: "GET" }],
    ["/data/private-defaults.js", { method: "GET" }]
  ]) {
    const response = await request(baseUrl, pathname, "admin", options);
    assert.equal(response.status, 403, `${options.method} ${pathname} должен быть заблокирован`);
    const payload = await response.json();
    assert.equal(payload.code, "DEMO_MODE_READ_ONLY");
  }

  const rawPhotoResponse = await request(baseUrl, "/api/student-photo?path=private-name.jpg");
  assert.equal(rawPhotoResponse.status, 404, "исходный путь фото не должен приниматься в деморежиме");

  const appResponse = await request(baseUrl, "/app.js");
  assert.equal(appResponse.status, 200, "статический интерфейс должен оставаться доступным");

  const maxIconResponse = await request(baseUrl, "/data/max-messenger-icon.png");
  assert.equal(maxIconResponse.status, 200, "неперсональная иконка MAX должна оставаться доступной");
  assert.equal(maxIconResponse.headers.get("content-type"), "image/png");

  for (const pathname of [
    "/DATA/seed.js",
    "/d%61ta/seed.js",
    "/%64ata/seed.js",
    "/data%2fseed.js",
    "/data%252fseed.js",
    "/.%2fstorage/shared-application-state.json",
    "/%2e%2fstorage/server-settings.json",
    "/x%2f..%2fstorage/users.json",
    "/storage/photos/private-name.jpg",
    "/.runtime/tunnel-secret.txt",
    "/tmp/private.xlsb",
    "/services/ocr/server.py",
    "/scripts/sync-student-database.ps1",
    "/app-server.js",
    "/demo-mode-privacy.js",
    "/demo-mode-settings.php"
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await publicRequest(baseUrl, pathname, { method });
      assert.equal(response.status, 404, `${method} ${pathname} не должен раздавать служебный файл`);
    }
  }
}

main()
  .then(() => console.log("database demo mode route checks: OK"))
  .finally(() => new Promise((resolve) => server.close(resolve)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
