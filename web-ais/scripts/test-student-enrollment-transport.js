"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { Readable } = require("node:stream"), crypto = require("node:crypto"), generator = require("../program-site-generator.js");
const source = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8");
function handlers() {
  const calls = [], key = "a".repeat(64), context = { Buffer, crypto, JSON, Date, Number, String, Object, path,
    SERVER_CODE_ROOT: "/test", ROOT: "/test", STORAGE_ROOT: "/storage", isDatabaseDemoModeEnabled: () => false,
    programSiteGenerator: { signature: generator.signature, readKeys: async () => ({ shop: key }) },
    getStudentEnrollmentService: () => ({ provisionOrder: async id => { calls.push(id); return { ok: true }; }, portal: async (user, id) => ({ id, role: user.role }) }),
    sendJson: (_res, status, body) => ({ status, body }) };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("async function handlePaidStudentEnrollment("), source.indexOf("async function runStudentApplicationsQuery(")), context);
  return { context, calls, key };
}
test("payment HMAC binds method, body and resource; expired and unsigned requests do no work", async () => {
  const { context, calls, key } = handlers(), body = '{"orderId":"101"}', stamp = String(Math.floor(Date.now() / 1000)), nonce = "b".repeat(32);
  const req = (data, headers = {}) => Object.assign(Readable.from([Buffer.from(data)]), { headers });
  await assert.rejects(context.handlePaidStudentEnrollment(req(body), {}), { statusCode: 403 });
  const headers = { "x-ais-timestamp": stamp, "x-ais-nonce": nonce, "x-ais-signature": generator.signature(key, "POST", "/api/student-enrollment/paid-order", stamp, nonce, body) };
  await assert.rejects(context.handlePaidStudentEnrollment(req('{"orderId":"102"}', headers), {}), { statusCode: 403 });
  await assert.rejects(context.handlePaidStudentEnrollment(req(body, { ...headers, "x-ais-timestamp": "1000000000" }), {}), { statusCode: 403 });
  assert.equal(calls.length, 0);
  await context.handlePaidStudentEnrollment(req(body, headers), {}); assert.deepEqual(calls, ["101"]);
});
test("portal works with CGI response interface and denies employee roles and all nonportal paths", async () => {
  const { context } = handlers(), user = { role: "student", studentId: "s" };
  const result = await context.handleStudentPortal({ method: "GET" }, {}, user, new URL("https://example.test/api/student-portal?id=s"));
  assert.equal(result.status, 200); assert.equal(result.body.id, "s");
  for (const endpoint of ["/api/shared-state", "/data/seed.js", "/api/admin/users", "/api/student-portal/foreign"]) {
    await assert.rejects(context.handleStudentPortal({ method: "GET" }, {}, user, new URL(`https://example.test${endpoint}`)), { statusCode: 403 });
  }
  await assert.rejects(context.handleStudentPortal({ method: "GET" }, {}, { role: "manager" }, new URL("https://example.test/api/student-portal")), { statusCode: 403 });
});
test("early route guards precede shared state, admin operations and protected seed data", () => {
  const route = source.slice(source.indexOf("async function route("));
  const studentGate = route.indexOf('protectedRequest && (authUser?.role === "student"');
  assert.ok(studentGate > 0 && studentGate < route.indexOf('requestUrl.pathname === "/api/admin/demo-mode"'));
  assert.ok(studentGate < route.indexOf('requestUrl.pathname === "/api/shared-state"'));
  const php = fs.readFileSync(path.join(__dirname, "../gateway.php"), "utf8");
  assert.ok(php.indexOf("$sessionUser['role'] ?? ''") < php.lastIndexOf("gateway_serve_protected_data($requestPath)"));
  assert.ok(php.includes("$authenticatedHeaders['x-ais-student-version'] = (string) ($currentUser['studentCredentialVersion'] ?? '')"));
  assert.ok(source.includes('process.env.AIS_OCR_CLI !== "1" || !requestHasConfiguredGatewaySecret(req)'));
});
