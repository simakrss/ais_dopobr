"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { createStore, messageId, addresses } = require("../student-feedback-history");
test("mail replies require exact thread references, sender, recipient and trusted Sent folder; refresh is durable and deduplicated", async () => {
  const database = new Map(), checked = new Map(), commands = []; let folder = "INBOX";
  const known = messageId("account", "root"), unrelated = "other@ais.edu-plus.ru";
  const mails = {
    "1": { messageId: "reply@center.test", from: "Учебный центр <center@example.test>", to: "student@example.test", refs: [known], text: "Ответ учебного центра", date: "2026-11-12T10:00:00Z" },
    "2": { messageId: "foreign@center.test", from: "center@example.test", to: "student@example.test", refs: [unrelated], text: "Чужая переписка" },
    "3": { messageId: "spoof@invalid.test", from: '"center@example.test" <intruder@example.test>', to: "student@example.test", refs: [known], text: "Подделка отправителя" },
    "4": { messageId: "recipient@center.test", from: "center@example.test", to: "other@example.test", refs: [known], text: "Другому слушателю" },
    "5": { messageId: "followup@student.test", from: "student@example.test", to: "center@example.test", refs: ["reply@center.test"], text: "Спасибо за ответ", date: "2026-11-12T11:00:00Z" }
  };
  const db = { async query(sql, args = []) {
    if (sql.startsWith("INSERT INTO ais_student_correspondence_sync")) { checked.set(args[0], args[1]); return [[]]; }
    if (sql.startsWith("SELECT checked_at")) return [[...(checked.has(args[0]) ? [{ checked_at: checked.get(args[0]) }] : [])]];
    if (sql.startsWith("INSERT INTO ais_student_correspondence ")) { database.set(`${args[0]}:${args[1]}`, { account: args[0], application: args[2], payload: args[4] }); return [[]]; }
    if (sql.startsWith("SELECT payload")) return [[...database.values()].filter(row => row.account === args[0] && row.application === args[1])];
    return [[]];
  } };
  const deps = { namespace: "fixture", pool: async () => db, legacy: async () => [],
    mailboxes: () => [{ host: "imap.example.test", login: "center@example.test", password: "test-only" }],
    connect: async () => ({ close: async () => {}, command: async cmd => {
      commands.push(cmd); if (cmd.startsWith("EXAMINE")) { folder = JSON.parse(cmd.slice(8)); return Buffer.from(""); }
      if (cmd.startsWith("LIST")) return Buffer.from('* LIST (\\HasNoChildren \\Sent) "." Sent\r\n');
      if (cmd.startsWith("UID SEARCH")) return Buffer.from(folder === "Sent" ? "1 2 3 4" : "5");
      const id = cmd.match(/^UID FETCH (\d+)/)[1]; return Buffer.from(JSON.stringify(mails[id]));
    } }), quote: JSON.stringify, search: bytes => bytes.toString().split(" "), literals: bytes => [{ bytes }],
    headers: bytes => { const mail = JSON.parse(bytes); return { headers: { references: mail.refs.map(id => `<${id}>`).join(" ") } }; }, parse: (_uid, bytes) => JSON.parse(bytes)
  };
  const store = createStore(deps);
  await store.save("account", { applicationId: "program1", requestId: "root", threadId: "root", messageId: known,
    direction: "student", status: "sent", subject: "Вопрос", message: "Исходное обращение", createdAt: 1 });
  await store.save("account", { applicationId: "program2", messageId: unrelated, message: "Другой курс", createdAt: 1 });
  const result = await store.sync("account", { id: "program1", email: "student@example.test" });
  assert.equal(result.warning, ""); assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].message, "Ответ учебного центра"); assert.equal(result.messages[1].direction, "center");
  checked.clear(); const nextProcess = createStore(deps);
  const next = await nextProcess.sync("account", { id: "program1", email: "student@example.test" });
  assert.equal(next.messages.length, 3); assert.equal(next.messages[2].message, "Спасибо за ответ");
  assert.equal((await store.history("foreign-account", "program1")).messages.length, 0);
  assert.equal((await store.history("account", "program2")).messages.length, 1);
  assert.ok(commands.every(cmd => !/STORE|DELETE|EXPUNGE/u.test(cmd))); assert.ok(commands.some(cmd => cmd.includes("BODY.PEEK")));
  assert.deepEqual(addresses('"center@example.test" <intruder@example.test>'), ["intruder@example.test"]);
});
test("mail connection failure preserves cached messages and reports a retryable warning", async () => {
  const db = { query: async sql => sql.startsWith("SELECT payload") ? [[{ payload: JSON.stringify({ messageId: "id@center", message: "Сохранено" }) }]] : [[]] };
  const store = createStore({ namespace: "test", pool: async () => db, legacy: async () => [], mailboxes: () => [{ host: "mail", login: "a@b.c", password: "fixture" }], connect: async () => { throw Error("offline"); } });
  const result = await store.sync("account", { id: "application" }); assert.equal(result.messages[0].message, "Сохранено"); assert.match(result.warning, /Не удалось/);
});
