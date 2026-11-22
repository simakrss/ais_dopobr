"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"),
  crypto = require("node:crypto"), vm = require("node:vm");
const appRoot = path.resolve(__dirname, "..");
function extract(source, name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
  assert.ok(match, name); return match[0];
}
(async () => {
  const source = await fs.readFile(path.join(appRoot, "app-server.js"), "utf8");
  const parent = path.join(appRoot, ".runtime", "award-storage-tests");
  await fs.mkdir(parent, { recursive: true });
  const temp = await fs.mkdtemp(path.join(parent, "case-")), root = path.join(temp, "documents");
  await fs.mkdir(root);
  try {
    let localAvailable = true, remoteCalls = [], now = Date.now();
    const tickets = new Map();
    const pool = { async query(sql, values = []) {
      if (sql.startsWith("CREATE TABLE")) return [{}];
      if (sql.startsWith("INSERT")) { tickets.set(values[0], { payload: values[1], expires_at: values[2] }); return [{ affectedRows: 1 }]; }
      if (sql.startsWith("SELECT")) return [tickets.has(values[0]) ? [tickets.get(values[0])] : []];
      if (sql.includes("expires_at < ?")) { for (const [key, row] of tickets) if (row.expires_at < values[0]) tickets.delete(key); return [{}]; }
      const exists = tickets.has(values[0]) && tickets.get(values[0]).expires_at > values[1];
      if (exists) tickets.delete(values[0]); return [{ affectedRows: Number(exists) }];
    } };
    const c = vm.createContext({ crypto, Buffer, path, fs, Date: { now: () => now },
      serverSettings: { localDocumentsRoot: root }, DEFAULT_LOCAL_DOCUMENTS_ROOT: root,
      SHARED_STATE_MYSQL_KEY: "fixture-state", studentEnrollmentPool: async () => pool,
      isLocalDocumentStorageAvailable: async () => localAvailable,
      getLocalSystemDocumentsAvailability: async () => ({ available: localAvailable }),
      resolveLocalDocumentsFolder: folder => path.resolve(root, folder),
      resolveStudentWebDavBrowserResource: (folder, name = "") => ({ targetPath: "/fixture/" + folder + (name ? "/" + name : "") }),
      ensureYandexDiskFolder: async folder => remoteCalls.push(["mkdir", folder]),
      requestYandexWebDav: async (method, target, options) => { remoteCalls.push([method, target, options.body]); return {}; },
      isUnavailableDocumentPathError: error => ["ENOENT", "EACCES"].includes(error.code),
      getWebDavBrowserContentType: name => /pdf$/i.test(name) ? "application/pdf" : "image/jpeg"
    });
    vm.runInContext(["issueStudentAwardLocalTicket", "consumeStudentAwardLocalTicket", "resolveLocalStudentAwardFile",
      "uploadStudentAwardFile", "readLocalStudentAwardFile"].map(name => extract(source, name)).join("\n"), c);
    const folder = "Слушатели/Тест", bytes = Buffer.from("%PDF-1.4\nfixture");
    for (const name of ["Документ об образовании.pdf", "Скан.jpg", "Скан.png"]) {
      const result = await c.uploadStudentAwardFile(folder, name, bytes, "application/pdf", "local");
      assert.equal(result.storage, "local");
      assert.deepEqual(await fs.readFile(path.join(root, folder, name)), bytes);
      assert.deepEqual((await c.readLocalStudentAwardFile({ folder, name, storage: "local" })).body, bytes);
      assert.equal(await c.readLocalStudentAwardFile({ folder, name, storage: "local" }, true), true);
      assert.equal(await c.readLocalStudentAwardFile({ folder, name, storage: "yandex" }), null);
    }
    assert.equal(remoteCalls.length, 0, "Local mode does not depend on Yandex credentials or upload a second copy");
    assert.equal((await c.uploadStudentAwardFile(folder, "Облако.pdf", bytes, "application/pdf", "yandex")).storage, "yandex");
    assert.equal(remoteCalls.length, 2); assert.equal(remoteCalls[1][0], "PUT"); assert.deepEqual(remoteCalls[1][2], bytes);
    await assert.rejects(fs.stat(path.join(root, folder, "Облако.pdf")), { code: "ENOENT" });
    localAvailable = false;
    await assert.rejects(c.uploadStudentAwardFile(folder, "Недоступно.pdf", bytes, "application/pdf", "local"), { statusCode: 503 });
    assert.equal(remoteCalls.length, 2, "Explicit local mode must not silently upload to another destination");
    assert.equal((await c.uploadStudentAwardFile(folder, "Старая версия.pdf", bytes, "application/pdf")).storage, "yandex");
    localAvailable = true;
    assert.equal(await c.readLocalStudentAwardFile({ folder, name: "Не синхронизирован.pdf", storage: "local" }), null);
    for (const name of ["../outside.pdf", "bad\\scan.pdf", "bad:stream.pdf", "file.exe"]) {
      await assert.rejects(c.resolveLocalStudentAwardFile(folder, name, true), { statusCode: 400 });
    }
    await assert.rejects(c.resolveLocalStudentAwardFile("../outside", "file.pdf", true), { statusCode: 400 });
    const outside = path.join(temp, "outside"); await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, "junction"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(c.uploadStudentAwardFile("junction/new", "file.pdf", bytes, "application/pdf", "local"), { statusCode: 400 });
    assert.deepEqual(await fs.readdir(outside), [], "A forbidden junction is rejected before creating directories");
    const actor = { id: "staff-id", login: "staff", name: "Сотрудник", role: "manager", password: "must-not-be-copied" };
    const claim = { id: "student", clientId: "card-window", kind: "scan", format: "", sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    const ticket = await c.issueStudentAwardLocalTicket(actor, claim);
    assert.ok(![...tickets.values()][0].payload.includes(actor.password));
    await assert.rejects(c.consumeStudentAwardLocalTicket({ ticket: ticket.ticket, base64: Buffer.from("changed").toString("base64") }), { statusCode: 403 });
    const verified = await c.consumeStudentAwardLocalTicket({ ticket: ticket.ticket, base64: bytes.toString("base64"), id: "forged", actor: { role: "admin" } });
    assert.equal(verified.id, "student"); assert.equal(verified.actor.login, "staff"); assert.equal(verified.actor.role, "manager");
    assert.equal(verified.clientId, "card-window");
    await assert.rejects(c.consumeStudentAwardLocalTicket({ ticket: ticket.ticket, base64: bytes.toString("base64") }), { statusCode: 403 });
    const expired = await c.issueStudentAwardLocalTicket(actor, claim); now += 120001;
    await assert.rejects(c.consumeStudentAwardLocalTicket({ ticket: expired.ticket, base64: bytes.toString("base64") }), { statusCode: 403 });
    const race = await c.issueStudentAwardLocalTicket(actor, claim);
    const results = await Promise.allSettled([1, 2].map(() => c.consumeStudentAwardLocalTicket({ ticket: race.ticket, base64: bytes.toString("base64") })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const proxy = await fs.readFile(path.join(appRoot, "local-server.js"), "utf8");
    vm.runInContext('const localDocumentServicesHealthPath = "/health";\n' + extract(proxy, "isRemoteDocumentServicePath"), c);
    assert.equal(c.isRemoteDocumentServicePath("/api/students/education-documents/local-upload"), true);
    assert.equal(c.isRemoteDocumentServicePath("/api/students/education-documents"), false, "Generic employee writes stay out of the local browser-service allowlist");
    console.log("Student award storage: PASS (real local PDF/JPEG/PNG files, cloud-only writes, path boundaries, junctions, exact-file authorization, expiry and concurrent replay)");
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(parent) + path.sep));
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
