"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const roles = require("../app-server.js");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
const extract = name => source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, "m"))?.[0] || assert.fail(name);
const user = { id: "fixture", login: "fixture-admin", role: "admin", status: "active", passwordHash: "private-fixture" };
const key = roles.sharedAuthRoleIdentity(user).key;
const timeout = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
let directCalls = 0, httpCalls = 0;
let payload = { ok: true, roles: [{ principal_key: key, role: "manager", revision: "7" }] };
let failure = null;
const context = {
  process: { platform: "win32", env: { AIS_GATEWAY_SHARED_SECRET: "s".repeat(64), AIS_PUBLIC_APP_URL: "https://example.invalid/lms" } },
  URL, AbortSignal, Buffer, Date, console, setTimeout,
  SHARED_STATE_MYSQL_KEY: "fixture-state",
  sharedAuthRoleIdentity: roles.sharedAuthRoleIdentity,
  applySharedAuthRole: roles.applySharedAuthRole,
  isDatabaseDemoModeEnabled: () => false,
  resolveSharedAuthUserDirect: async () => { directCalls++; throw timeout; },
  resolveSharedAuthUsersDirect: async () => { directCalls++; throw timeout; },
  fetch: async (url, options) => {
    httpCalls++;
    assert.equal(String(url), "https://example.invalid/lms/api/auth/shared-roles");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["X-AIS-Gateway-Token"], "s".repeat(64));
    assert.deepEqual(JSON.parse(options.body), { principalKeys: [key], stateKey: "fixture-state" });
    assert.ok(!options.body.includes(user.passwordHash) && !options.body.includes(user.login));
    if (failure) throw failure;
    return Response.json(payload);
  }
};
vm.createContext(context);
vm.runInContext("let sharedAuthDirectRetryAt=0;\n" + ["readSharedAuthRolesThroughSite", "withSharedAuthReadFallback", "resolveSharedAuthUser", "resolveSharedAuthUsers"].map(extract).join("\n"), context);

(async () => {
  assert.equal((await context.resolveSharedAuthUser(user)).role, "manager", "Must use the current role, not stale local admin");
  assert.equal(directCalls, 1);
  payload.roles[0].role = "admin";
  assert.equal((await context.resolveSharedAuthUser(user)).role, "admin", "Must not cache an old role");
  assert.equal(directCalls, 1, "Backoff avoids repeated TCP timeouts");
  assert.equal(httpCalls, 2);
  const callsBeforeOverride = httpCalls;
  await assert.rejects(context.resolveSharedAuthUser(user, {}), e => e.code === "ETIMEDOUT");
  assert.equal(httpCalls, callsBeforeOverride, "Injected database must never query live authority");
  failure = new Error("offline");
  await assert.rejects(context.resolveSharedAuthUser(user), e => e.statusCode === 503);
  failure = null;
  payload.roles = [];
  await assert.rejects(context.resolveSharedAuthUser(user), e => e.statusCode === 503);
  payload.roles = [{ principal_key: "0".repeat(64), role: "admin", revision: "7" }];
  await assert.rejects(context.resolveSharedAuthUser(user), e => e.statusCode === 503);
  payload.roles = [{ principal_key: key, role: "unknown", revision: "7" }];
  await assert.rejects(context.resolveSharedAuthUser(user), e => e.statusCode === 503);
  payload.roles = [{ principal_key: key, role: "manager", revision: "7" }];
  context.resolveSharedAuthUserDirect = async () => { throw Object.assign(new Error("Bad SQL"), { code: "ER_PARSE_ERROR" }); };
  vm.runInContext("sharedAuthDirectRetryAt=0", context);
  await assert.rejects(context.resolveSharedAuthUser(user), e => e.code === "ER_PARSE_ERROR");
  context.resolveSharedAuthUserDirect = async () => user;
  assert.equal((await context.resolveSharedAuthUser(user)).role, "admin");
  context.resolveSharedAuthUserDirect = async () => { throw timeout; };

  // A successful fallback does not bypass password validation or create a session on failure.
  let password = "wrong", status = 0, sessions = 0;
  Object.assign(context, {
    readJsonBody: async () => ({ login: user.login, password }),
    normalizeAuthLogin: value => String(value).trim().toLowerCase(),
    loadAuthUsers: async () => [{ ...user }, { id: "linked", login: "linked", authSource: "employee" }],
    authVerifyPassword: value => value === "valid-fixture",
    saveAuthUsers: async () => {},
    createAuthSession: async () => { sessions++; return { expiresAt: Date.now() + 60000, token: "fixture-token" }; },
    safelyAppendAuditEntry: async () => {}, publicAuthUser: value => value,
    databaseDemoModePublicUser: value => value, databaseDemoModeResponseHeaders: () => ({}),
    authCookieHeader: () => "fixture-cookie",
    sendError: (res, code) => { status = code; },
    sendJson: (res, code) => { status = code; }
  });
  vm.runInContext(extract("handleAuthLogin"), context);
  const beforeInvalid = httpCalls;
  await context.handleAuthLogin({}, {});
  assert.equal(status, 401); assert.equal(sessions, 0); assert.equal(httpCalls, beforeInvalid);
  password = "valid-fixture";
  await context.handleAuthLogin({}, {});
  assert.equal(status, 200); assert.equal(sessions, 1);
  failure = new Error("offline");
  await assert.rejects(context.handleAuthLogin({}, {}), e => e.statusCode === 503);
  assert.equal(sessions, 1, "Unavailable authority must not create an authenticated session");

  const gateway = fs.readFileSync(path.join(root, "gateway.php"), "utf8");
  const handler = gateway.slice(gateway.indexOf("function gateway_handle_shared_auth_role_proxy("), gateway.indexOf("function gateway_handle_advertising_source_proxy("));
  assert.match(handler, /hash_equals/);
  assert.match(handler, /count\(\$keys\) > 200/);
  assert.match(handler, /stateKey[\s\S]*gateway_shared_state_key/);
  assert.match(handler, /SELECT principal_key, role, revision/);
  assert.doesNotMatch(handler, /INSERT|UPDATE|DELETE|initialize_shared_auth/i);
  console.log("PASS: password validation, live role authority, timeout fallback, no stale privileges, strict endpoint and error cases");
})().catch(error => { console.error(error); process.exitCode = 1; });
