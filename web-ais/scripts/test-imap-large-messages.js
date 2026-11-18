"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createHash } = require("node:crypto");
const {
  createImapResponseReader,
  createImapCommandMatcher,
  fetchImapMessages,
  parseStudentMailboxMessage,
  IMAP_MESSAGE_CHUNK_BYTES,
  MAX_IMAP_MESSAGE_BYTES,
  MAX_IMAP_MESSAGE_BATCH_BYTES
} = require("../app-server.js");

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const smallMessage = Buffer.from("Subject: Small message\r\nContent-Type: text/plain\r\n\r\nComplete text\r\n");

function fakeClient(records, transform = (bytes) => bytes) {
  const calls = [];
  return {
    calls,
    async command(command) {
      calls.push(command);
      const sizeRequest = /^UID FETCH (\d+) \(UID RFC822\.SIZE\)$/.exec(command);
      if (sizeRequest) {
        const uid = sizeRequest[1];
        const record = records[uid];
        if (!record) return Buffer.from("A0001 OK No message\r\n");
        const size = record.size ?? record.bytes.length;
        // Exercise UID both before and after the requested data item.
        return Buffer.from(record.uidLast
          ? `* 7 FETCH (RFC822.SIZE ${size} UID ${uid})\r\nA0001 OK Size\r\n`
          : `* 7 FETCH (UID ${uid} RFC822.SIZE ${size})\r\nA0001 OK Size\r\n`);
      }
      const partial = /^UID FETCH (\d+) \(UID BODY\.PEEK\[\]<(\d+)\.(\d+)>\)$/.exec(command);
      assert.ok(partial, `Only read-only partial fetches are allowed: ${command}`);
      const [, uid, offsetText, countText] = partial;
      const offset = Number(offsetText);
      const count = Number(countText);
      assert.ok(count > 0 && count <= IMAP_MESSAGE_CHUNK_BYTES);
      const record = records[uid];
      const chunk = record.bytes ? record.bytes.subarray(offset, offset + count) : Buffer.alloc(count, 65);
      const response = Buffer.concat([
        Buffer.from(`* 7 FETCH (${record.uidLast ? "" : `UID ${uid} `}BODY[]<${offset}> {${chunk.length}}\r\n`),
        chunk,
        Buffer.from(`${record.uidLast ? ` UID ${uid}` : ""})\r\nA0001 OK Partial fetch\r\n`)
      ]);
      assert.ok(response.length < 32 * 1024 * 1024, "Every response stays below the transport guard");
      return transform(response, { uid, offset, count });
    }
  };
}

async function testLargeMime() {
  const attachment = Buffer.alloc(13 * 1024 * 1024, 88);
  const encoded = attachment.toString("base64");
  const mime = Buffer.from([
    "Subject: Large attachments",
    'Content-Type: multipart/mixed; boundary="large-mail-test"',
    "",
    "--large-mail-test",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Documents attached.",
    ...["first.pdf", "second.pdf"].flatMap((fileName) => [
      "--large-mail-test",
      `Content-Type: application/pdf; name="${fileName}"`,
      `Content-Disposition: attachment; filename="${fileName}"`,
      "Content-Transfer-Encoding: base64",
      "",
      encoded
    ]),
    "--large-mail-test--",
    ""
  ].join("\r\n"));
  assert.ok(mime.length > 32 * 1024 * 1024);
  const client = fakeClient({ "8142": { bytes: mime }, "8143": { bytes: smallMessage, uidLast: true } });
  const warnings = [];
  const messages = await fetchImapMessages(client, ["8142", "8143"], warnings);
  assert.deepEqual(warnings, []);
  assert.deepEqual(messages.map((message) => message.uid), ["8142", "8143"]);
  assert.equal(digest(messages[0].bytes), digest(mime), "All original MIME bytes survive chunk boundaries");
  assert.deepEqual(messages[1].bytes, smallMessage);
  const parsed = parseStudentMailboxMessage("8142", messages[0].bytes);
  assert.equal(parsed.attachments.length, 2);
  parsed.attachments.forEach((file) => assert.equal(digest(file.bytes), digest(attachment)));
  assert.equal(client.calls.filter((call) => call.startsWith("UID FETCH 8142 (UID BODY")).length,
    Math.ceil(mime.length / IMAP_MESSAGE_CHUNK_BYTES));
}

async function testInvalidParts() {
  const partialSource = Buffer.alloc(IMAP_MESSAGE_CHUNK_BYTES + 7, 65);
  const corruptions = [
    (response) => Buffer.from(response.toString("latin1").replace("UID 1 ", "UID 99 "), "latin1"),
    (response) => Buffer.from(response.toString("latin1").replace(`BODY[]<${IMAP_MESSAGE_CHUNK_BYTES}>`, "BODY[]<0>"), "latin1"),
    (response) => Buffer.from(response.toString("latin1").replace("{7}\r\n", "{6}\r\n"), "latin1"),
    (response) => Buffer.from(response.toString("latin1").replace("AAAAAAA)", "AAAAAA)"), "latin1"),
    (response) => response.subarray(0, response.indexOf("\r\n") + 4),
    () => { throw new Error("Test network failure"); }
  ];
  for (const corrupt of corruptions) {
    const client = fakeClient({ "1": { bytes: partialSource }, "2": { bytes: smallMessage, uidLast: true } },
      (response, { uid, offset }) => uid === "1" && offset > 0 ? corrupt(response) : response);
    const warnings = [];
    const messages = await fetchImapMessages(client, ["1", "2"], warnings);
    assert.deepEqual(messages.map((message) => message.uid), ["2"], "No partial MIME is returned; the next email is still read");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Письмо UID 1 пропущено:/u);
  }
}

async function testLimits() {
  const client = fakeClient({
    "1": { size: MAX_IMAP_MESSAGE_BYTES + 1 },
    "2": { bytes: smallMessage },
    "3": { size: 0 },
    "4": { size: Number.MAX_SAFE_INTEGER + 1 }
  });
  const warnings = [];
  const messages = await fetchImapMessages(client, ["1", "2", "3", "4", "5", "6 BAD"], warnings);
  assert.deepEqual(messages.map((message) => message.uid), ["2"]);
  assert.equal(warnings.length, 5);
  assert.match(warnings[0], /150 МБ/u);
  assert.equal(client.calls.filter((call) => call.includes("BODY.PEEK")).length, 1, "Invalid/oversized messages are rejected before downloading");
  assert.equal(client.calls.some((call) => call.includes("BAD")), false);

  const batchClient = fakeClient({ "1": { bytes: smallMessage }, "2": { size: MAX_IMAP_MESSAGE_BATCH_BYTES } });
  const batchWarnings = [];
  const batch = await fetchImapMessages(batchClient, ["1", "2"], batchWarnings);
  assert.deepEqual(batch.map((message) => message.uid), ["1"]);
  assert.match(batchWarnings[0], /Загрузите это письмо отдельно/u);
  assert.equal(batchClient.calls.some((call) => call.startsWith("UID FETCH 2 (UID BODY")), false);
}

async function testResponseFraming() {
  const socket = new EventEmitter();
  socket.destroy = (error) => { if (error) socket.emit("error", error); socket.emit("close"); };
  const reader = createImapResponseReader(socket);
  const literal = Buffer.from("Mail body\r\nA0001 OK Not a real completion\r\n* 99 FETCH (UID 99 BODY[]<0> {9}\r\nMore body");
  const packet = Buffer.concat([
    Buffer.from(`* 7 FETCH (UID 1 BODY[]<0> {${literal.length}}\r\n`), literal,
    Buffer.from(")\r\n* 8 FETCH (UID 2 BODY[HEADER] {3}\r\nxyz BODY[TEXT] {2}\r\nab)\r\nA0001 OK Finished\r\n")
  ]);
  let resolved = false;
  const pending = reader.waitFor(createImapCommandMatcher("A0001"), "Test timeout", 1000).then((result) => {
    resolved = true;
    return result;
  });
  for (let index = 0; index < packet.length - 1; index += 1) {
    socket.emit("data", packet.subarray(index, index + 1));
    await Promise.resolve();
    assert.equal(resolved, false, "Neither an embedded tag nor an incomplete protocol line finishes the command");
  }
  socket.emit("data", packet.subarray(-1));
  const result = await pending;
  assert.equal(result.status, "OK");
  assert.deepEqual(result.response, packet);

  const rejected = reader.waitFor(createImapCommandMatcher("A0002"), "Test timeout", 1000);
  socket.emit("data", Buffer.from("A0002 NO Not available\r\n"));
  assert.equal((await rejected).status, "NO");

  const oversized = reader.waitFor(createImapCommandMatcher("A0003"), "Test timeout", 1000);
  const guardCheck = assert.rejects(oversized, /Ответ IMAP-сервера превышает допустимый размер/u);
  socket.emit("data", Buffer.alloc(32 * 1024 * 1024 + 1));
  await guardCheck;
}

(async () => {
  await testLargeMime();
  await testInvalidParts();
  await testLimits();
  await testResponseFraming();
  console.log("Large IMAP messages, MIME integrity, limits, continuation and response framing: OK");
})().catch((error) => { console.error(error); process.exitCode = 1; });
