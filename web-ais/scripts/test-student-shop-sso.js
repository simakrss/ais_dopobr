"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { createService, createNonceStore, ACTION } = require("../student-shop-sso.js");
const enrollment = require("../student-enrollment.js");
function fixture() {
  const owner = { id: "student-1", name: "Тест", email: "test@example.test", studentPortalLogin: "test.2", studentPortalPassword: "003456", studentPortalCredentialSalt: "salt", studentPortalEnabled: true };
  const used = new Set(); let time = Date.now(); const key = "k".repeat(64);
  const service = createService({ key: async () => key, now: () => time,
    context: async user => { if (owner.studentPortalBlocked || user.studentId !== owner.id || user.studentCredentialVersion !== enrollment.fingerprint(owner)) throw Object.assign(new Error("Access revoked"), { statusCode: 401 }); return { owner }; },
    consumeNonce: async nonce => { if (used.has(nonce)) return false; used.add(nonce); return true; } });
  return { service, owner, used, key, setTime: value => { time = value; } };
}
test("shop ticket contains no password, uses fixed audience, survives inspection and is consumed once", async () => {
  const f = fixture(), ticket = await f.service.issue(enrollment.publicUser(f.owner), "73");
  assert.equal(ticket.action, ACTION); assert.ok(!Buffer.from(ticket.token.split('.')[0], 'base64url').toString().includes('003456'));
  assert.equal((await f.service.inspect(ticket.token)).user.studentId, f.owner.id); assert.equal(f.used.size, 0);
  const results = await Promise.allSettled([f.service.consume(ticket.token), f.service.consume(ticket.token)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'fulfilled').value.user.role, 'student');
  await assert.rejects(f.service.consume(ticket.token), { statusCode: 403 });
});
test("expired, altered and wrong audience tickets cannot create a session", async () => {
  const f = fixture(), ticket = await f.service.issue(enrollment.publicUser(f.owner), "73");
  await assert.rejects(f.service.consume(ticket.token.slice(0, -1) + (ticket.token.endsWith('0') ? '1' : '0')), { statusCode: 403 });
  await assert.rejects(f.service.consume('a'.repeat(5000)), { statusCode: 403 });
  const payload = JSON.parse(Buffer.from(ticket.token.split('.')[0], 'base64url').toString()); payload.aud = 'https://other.test';
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url'), derived = crypto.createHmac('sha256', f.key).update('ais-shop-student-sso-v1').digest('hex');
  await assert.rejects(f.service.consume(encoded + '.' + crypto.createHmac('sha256', derived).update(encoded).digest('hex')), { statusCode: 403 });
  f.setTime(Date.now() + 121000); await assert.rejects(f.service.consume(ticket.token), { statusCode: 403 }); assert.equal(f.used.size, 0);
});
test("blocking or changing credentials after inspection revokes an outstanding ticket", async () => {
  const f = fixture(), ticket = await f.service.issue(enrollment.publicUser(f.owner), "73");
  await f.service.inspect(ticket.token); f.owner.studentPortalPassword = '123456';
  await assert.rejects(f.service.consume(ticket.token), { statusCode: 401 }); assert.equal(f.used.size, 0);
  const second = await f.service.issue(enrollment.publicUser(f.owner), "73"); f.owner.studentPortalBlocked = true;
  await assert.rejects(f.service.consume(second.token), { statusCode: 401 });
});
test("shared nonce storage rejects duplicates across instances and fails closed on database errors", async () => {
  const rows = new Set(), queries = []; let offline = false;
  const db = { query: async (sql, args) => { if (offline) throw new Error('offline'); queries.push([sql, args]);
    if (sql.startsWith('INSERT')) { if (rows.has(args[0])) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }); rows.add(args[0]); } return [{}]; } };
  const one = createNonceStore(async () => db, 'db'), two = createNonceStore(async () => db, 'db');
  assert.equal(await one('a'.repeat(48), Date.now()+120000), true); assert.equal(await two('a'.repeat(48), Date.now()+120000), false);
  assert.ok(!JSON.stringify(queries).includes('a'.repeat(48))); offline = true; await assert.rejects(two('b'.repeat(48), Date.now()+120000), /offline/);
});
