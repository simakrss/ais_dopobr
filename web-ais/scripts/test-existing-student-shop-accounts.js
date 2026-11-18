"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { plan, run } = require("./link-existing-student-shop-accounts.js");
function fixture() {
  const owner = { id: "s1", name: "Тестов Тест Иванович", email: "test@example.test", educationType: "ПРО", studentPortalEnabled: true,
    studentPortalLogin: "test", studentPortalPassword: "123456", studentPortalCredentialSalt: "salt" };
  return { collections: { students: [owner, { ...owner, id: "s2", educationType: "КПК", studentPortalAccountId: "s1", sourceOrderId: "123" }] } };
}
test("existing candidates are grouped by account across programs and never contain passwords", () => {
  const d = fixture(), result = plan(d); assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].accountId, "s1"); assert.deepEqual(result.candidates[0].orderIds, ["123"]);
  assert.ok(!Object.hasOwn(result.candidates[0], "password")); assert.ok(!Object.hasOwn(result.candidates[0], "studentPortalPassword"));
  d.collections.students.push({ ...d.collections.students[0], id: "other" });
  assert.equal(plan(d).candidates.length, 0); assert.equal(plan(d).skipped[0].reason, "ambiguous_student_email");
});
test("blocked and noneligible records are excluded; missing email is reported", () => {
  const d = fixture(); d.collections.students[1].studentPortalBlocked = true; assert.equal(plan(d).candidates.length, 0);
  d.collections.students[1].studentPortalBlocked = false; d.collections.students[0].email = ""; assert.equal(plan(d).skipped[0].reason, "invalid_email");
});
test("preview is read-only; apply uses a fresh unchanged candidate and the shop preview proof", async () => {
  const d = fixture(), calls = []; const call = async payload => { calls.push(payload); return { ok: true, mailSent: false, passwordsChanged: false,
    results: payload.accounts.map(a => ({ accountId: a.accountId, shopUserId: 42, status: payload.apply ? "linked" : "ready", proof: "proof" })) }; };
  const preview = await run({ readState: async () => d, call }); assert.equal(preview.totals.ready, 1); assert.ok(calls.every(c => !c.apply));
  calls.length = 0; const applied = await run({ readState: async () => d, call, apply: true }); assert.equal(applied.totals.linked, 1);
  assert.equal(calls[1].accounts[0].proof, "proof"); assert.equal(applied.results[0].proof, undefined);
});
test("changed or blocked student after preview is not linked", async () => {
  const d = fixture(); let applied = false;
  const report = await run({ readState: async () => d, apply: true, call: async payload => {
    if (payload.apply) applied = true; d.collections.students[0].studentPortalPassword = "changed";
    return { ok: true, results: [{ accountId: "s1", status: "ready", proof: "proof" }] };
  } }); assert.equal(applied, false); assert.equal(report.totals.student_changed, 1);
});
test("a partial or unsafe response cannot be reported as successful", async () => {
  await assert.rejects(run({ readState: async () => fixture(), call: async () => ({ ok: true, results: [] }) }), /полный план/);
  await assert.rejects(run({ readState: async () => fixture(), apply: true, call: async p => ({ ok: true,
    results: [{ accountId: "s1", status: p.apply ? "linked" : "ready", proof: "proof" }], mailSent: true, passwordsChanged: false }) }), /без писем/);
});
