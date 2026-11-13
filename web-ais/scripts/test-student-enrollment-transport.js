"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { Readable } = require("node:stream"), crypto = require("node:crypto"), generator = require("../program-site-generator.js");
const source = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8");
function handlers() {
  const calls = [], key = "a".repeat(64), context = { Buffer, crypto, JSON, Date, Number, String, Object, path, URL,
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

test("staff preview checks roles and demo mode, maps only portal operations and audits the original actor", async () => {
  const { context } = handlers(), actor = { id: "staff", login: "staff", role: "manager" }, audit = [], seen = [];
  context.getStudentEnrollmentService = () => ({
    staffSession: async (user, anchor, id) => { seen.push({ user, anchor, id }); return { user: { role: "student", actingStaff: user }, id: id || anchor, record: { id: anchor, name: "Fixture" } }; },
    portal: async (user, id) => ({ id, role: user.role }), update: async (user, id, body) => ({ id, role: user.role, body })
  });
  let response;
  context.sendJson = (_res, status, body) => { response = { status, body }; };
  context.safelyAppendAuditEntry = async (entry, user) => audit.push({ entry, user });
  const endpoint = new URL("https://example.test/api/students/portal-preview?studentId=a&id=b");
  for (const role of [undefined, "partner", "student"]) await assert.rejects(context.handleStaffStudentPortal({ method: "GET" }, {}, { role }, endpoint), { statusCode: 403 });
  context.isDatabaseDemoModeEnabled = () => true;
  await assert.rejects(context.handleStaffStudentPortal({ method: "GET" }, {}, actor, endpoint), { statusCode: 403 });
  context.isDatabaseDemoModeEnabled = () => false;
  await context.handleStaffStudentPortal({ method: "GET" }, {}, actor, endpoint);
  assert.equal(response.status, 200); assert.equal(response.body.id, "b"); assert.equal(response.body.role, "student");
  assert.equal(seen[0].anchor, "a"); assert.equal(audit[0].user, actor); assert.equal(actor.role, "manager");
  await assert.rejects(context.handleStaffStudentPortal({ method: "DELETE" }, {}, actor, endpoint), { statusCode: 405 });
  const foreign = new URL("https://example.test/api/students/portal-preview/admin/users?studentId=a");
  await assert.rejects(context.handleStaffStudentPortal({ method: "GET" }, {}, actor, foreign), { statusCode: 405 });
  const route = source.slice(source.indexOf("async function route("));
  assert.ok(route.indexOf('authUser?.role === "student"') < route.indexOf('requestUrl.pathname === "/api/students/portal-preview"'));
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

test("review endpoint denies nonstaff, demo mode and reads; forwards staff and packet version", async () => {
  const { context } = handlers(), actor = { role: "manager", id: "staff" }, calls = [];
  const body = { id: "student", decision: "accept", submissionId: "packet", comment: "Проверено" };
  context.readJsonBody = async () => body;
  context.getStudentEnrollmentService = () => ({ review: async (user, id, data) => { calls.push({ user, id, data }); return { id, enrollmentReviewStatus: "Приняты" }; } });
  for (const role of ["student", "partner", undefined]) await assert.rejects(context.handleStudentEnrollmentReview({ method: "POST" }, {}, { role }), { statusCode: 403 });
  context.isDatabaseDemoModeEnabled = () => true;
  await assert.rejects(context.handleStudentEnrollmentReview({ method: "POST" }, {}, actor), { statusCode: 403 });
  context.isDatabaseDemoModeEnabled = () => false;
  await assert.rejects(context.handleStudentEnrollmentReview({ method: "GET" }, {}, actor), { statusCode: 405 });
  const response = await context.handleStudentEnrollmentReview({ method: "POST" }, {}, actor);
  assert.equal(response.status, 200); assert.equal(response.body.review.enrollmentReviewStatus, "Приняты");
  assert.deepEqual(calls, [{ user: actor, id: "student", data: body }]);
});

test("feedback transport bounds input, rejects demo/read requests and delegates staff without replacing identity", async () => {
  const { context } = handlers(), user = { role: "student", studentId: "s" }, actor = { id: "staff", role: "manager" }, calls = [];
  context.readJsonBody = async (_req, limit) => { assert.equal(limit, 64000); return { subject: "Вопрос", message: "Текст обращения", requestId: "fixture" }; };
  context.getStudentEnrollmentService = () => ({
    correspondence: async () => ({ messages: [] }),
    feedback: async (auth, id, body) => { calls.push({ auth, id, body }); return { ok: true }; },
    staffSession: async (staff, anchor, id) => ({ user: { ...user, actingStaff: staff }, id: id || anchor, record: { id: anchor } })
  });
  const url = new URL("https://example.test/api/student-portal/feedback?id=s");
  assert.equal((await context.handleStudentPortal({ method: "GET" }, {}, user, url)).status, 200);
  context.isDatabaseDemoModeEnabled = () => true;
  await assert.rejects(context.handleStudentPortal({ method: "POST" }, {}, user, url), { statusCode: 403 });
  context.isDatabaseDemoModeEnabled = () => false;
  assert.equal((await context.handleStudentPortal({ method: "POST" }, {}, user, url)).status, 200);
  await context.handleStaffStudentPortal({ method: "POST" }, {}, actor, new URL("https://example.test/api/students/portal-preview/feedback?studentId=s&id=linked"));
  assert.equal(calls.length, 2); assert.equal(calls[0].auth, user); assert.equal(calls[1].auth.actingStaff, actor); assert.equal(calls[1].id, "linked");
});

test("layout approval is a bounded POST, blocks demo/foreign roles and preserves staff-preview attribution", async () => {
  const { context } = handlers(), user = { role: "student", studentId: "s" }, actor = { id: "staff", role: "manager" }, calls = [];
  const body = { fileId: "layout", revision: "a".repeat(64) };
  context.readJsonBody = async (_req, limit) => { assert.equal(limit, 4096); return body; };
  context.getStudentEnrollmentService = () => ({ approveLayout: async (auth, id, data) => { calls.push({ auth, id, data }); return { ok: true }; },
    staffSession: async staff => ({ user: { ...user, actingStaff: staff }, id: "linked" }) });
  const url = new URL("https://example.test/api/student-portal/approve-layout?id=s");
  await assert.rejects(context.handleStudentPortal({ method: "GET" }, {}, user, url), { statusCode: 403 });
  await assert.rejects(context.handleStudentPortal({ method: "POST" }, {}, { role: "partner" }, url), { statusCode: 403 });
  context.isDatabaseDemoModeEnabled = () => true;
  await assert.rejects(context.handleStudentPortal({ method: "POST" }, {}, user, url), { statusCode: 403 });
  context.isDatabaseDemoModeEnabled = () => false;
  assert.equal((await context.handleStudentPortal({ method: "POST" }, {}, user, url)).status, 200);
  await context.handleStaffStudentPortal({ method: "POST" }, {}, actor, new URL("https://example.test/api/students/portal-preview/approve-layout?studentId=s&id=linked"));
  assert.equal(calls[0].data, body); assert.equal(calls[1].id, "linked"); assert.equal(calls[1].auth.actingStaff, actor);
});
test("remarks POST bounds input, denies demo and delegates staff preview to the selected program", async () => {
  const { context } = handlers(), user = { role: "student", studentId: "s" }, actor = { id: "staff", role: "manager" }, calls = [];
  const body = { fileId: "layout", revision: "a".repeat(64), comment: "Исправить фамилию" };
  context.readJsonBody = async (_req, limit) => { assert.equal(limit, 24000); return body; };
  context.getStudentEnrollmentService = () => ({ layoutRemarks: async (auth, id, data) => { calls.push({ auth, id, data }); return { ok: true }; },
    staffSession: async staff => ({ user: { ...user, actingStaff: staff }, id: "linked" }) });
  const url = new URL("https://example.test/api/student-portal/layout-remarks?id=s");
  await assert.rejects(context.handleStudentPortal({ method: "GET" }, {}, user, url), { statusCode: 403 });
  context.isDatabaseDemoModeEnabled = () => true;
  await assert.rejects(context.handleStudentPortal({ method: "POST" }, {}, user, url), { statusCode: 403 });
  context.isDatabaseDemoModeEnabled = () => false;
  assert.equal((await context.handleStudentPortal({ method: "POST" }, {}, user, url)).status, 200);
  await context.handleStaffStudentPortal({ method: "POST" }, {}, actor, new URL("https://example.test/api/students/portal-preview/layout-remarks?studentId=s&id=linked"));
  assert.equal(calls[0].data, body); assert.equal(calls[1].id, "linked"); assert.equal(calls[1].auth.actingStaff, actor);
});
test("feedback journal persists hashed account keys and request states across server instances", async () => {
  const calls = [], context = { crypto, Date, Number, Math, SHARED_STATE_MYSQL_KEY: "fixture",
    studentEnrollmentPool: async () => ({ query: async (sql, args) => {
      calls.push({ sql, args });
      return sql.startsWith("SELECT") ? [[{ request_id: "r", message_hash: "hash", status: "sent", created_at: 100 }]] : [{}];
    } }) };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function studentFeedbackAccountKey("), source.indexOf("function getStudentEnrollmentService(")), context);
  const result = await context.readStudentFeedbackState("private-student-id", "r");
  assert.equal(result.request.status, "sent"); assert.equal(result.lastAttemptAt, 100);
  await context.saveStudentFeedbackState("private-student-id", { requestId: "r", messageHash: "hash", status: "pending", createdAt: 200 });
  assert.ok(!JSON.stringify(calls).includes("private-student-id"));
  assert.match(calls.find(call => call.sql.startsWith("INSERT")).args[0], /^[a-f0-9]{64}$/);
  assert.notEqual(context.studentFeedbackAccountKey("one"), context.studentFeedbackAccountKey("two"));
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


test("order email credentials require a signed recipient and are never cacheable", async () => {
  const { context, key } = handlers(), calls = [];
  context.getStudentEnrollmentService = () => ({ orderEmailAccess: async (id, recipient) => { calls.push({ id, recipient }); return { ok: true, accounts: [] }; } });
  context.sendJson = (_res, status, body, headers) => ({ status, body, headers });
  const body = JSON.stringify({ orderId: "101", orderEmailRecipient: "test@example.test" });
  const stamp = String(Math.floor(Date.now() / 1000)), nonce = "b".repeat(32);
  const headers = { "x-ais-timestamp": stamp, "x-ais-nonce": nonce, "x-ais-signature": generator.signature(key, "POST", "/api/student-enrollment/paid-order", stamp, nonce, body) };
  const req = (data, h = headers) => Object.assign(Readable.from([Buffer.from(data)]), { headers: h });
  await assert.rejects(context.handlePaidStudentEnrollment(req(body, {}), {}), { statusCode: 403 });
  await assert.rejects(context.handlePaidStudentEnrollment(req(body.replace("test@example", "other@example")), {}), { statusCode: 403 });
  assert.equal(calls.length, 0);
  const result = await context.handlePaidStudentEnrollment(req(body), {});
  assert.equal(result.status, 200); assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(calls, [{ id: "101", recipient: "test@example.test" }]);
});
