"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");

process.env.AIS_TRUST_GATEWAY = "1";
process.env.AIS_GATEWAY_SHARED_SECRET = "test-admin-source-access-secret";

const { route } = require("../app-server.js");

const server = http.createServer((req, res) => {
  Promise.resolve(route(req, res)).catch((error) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message }));
  });
});

function gatewayHeaders(role) {
  return {
    "X-AIS-Gateway-Token": process.env.AIS_GATEWAY_SHARED_SECRET,
    "X-AIS-User-Id": `test-${role}`,
    "X-AIS-User-Login": `test-${role}`,
    "X-AIS-User-Name": `Test ${role}`,
    "X-AIS-User-Role": role,
    "X-Requested-With": "AIS-Web"
  };
}

async function request(baseUrl, pathname, role, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      ...gatewayHeaders(role),
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  for (const check of [
    ["/api/statistics/sources", { method: "GET" }],
    ["/api/statistics/sources", { method: "POST", body: { sources: [] } }],
    ["/api/statistics/sources/test", { method: "POST", body: { source: {} } }],
    ["/api/advertising/email-collector/settings", { method: "GET" }],
    ["/api/advertising/email-collector/settings", { method: "POST", body: { sources: [] } }]
  ]) {
    const response = await request(baseUrl, check[0], "manager", check[1]);
    assert.equal(response.status, 403, `${check[1].method} ${check[0]} должен быть закрыт для менеджера`);
  }

  const statisticsResponse = await request(baseUrl, "/api/statistics/sources", "admin");
  assert.equal(statisticsResponse.status, 200);
  const statisticsPayload = await statisticsResponse.json();
  assert.ok(Array.isArray(statisticsPayload.sources) && statisticsPayload.sources.length > 0);

  const advertisingResponse = await request(baseUrl, "/api/advertising/email-collector/settings", "admin");
  assert.equal(advertisingResponse.status, 200);
  const advertisingPayload = await advertisingResponse.json();
  assert.ok(Array.isArray(advertisingPayload.sources) && advertisingPayload.sources.length > 0);
}

main()
  .then(() => console.log("admin source access integration checks: OK"))
  .finally(() => new Promise((resolve) => server.close(resolve)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
