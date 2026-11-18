"use strict";
const crypto = require("node:crypto");
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const ids = value => [...String(value || "").matchAll(/<([^<>\r\n\s]+@[^<>\r\n\s]+)>/g)].map(match => match[1]);
const addresses = value => { const source = String(value || ""), angled = [...source.matchAll(/<([^<>]+)>/g)].map(match => match[1]).join(" "); return [...(angled || source).matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(match => match[0].toLowerCase()); };
function messageId(account, request) { return `${hash(`student-feedback:${account}:${request}`)}@ais.edu-plus.ru`; }
function createStore(deps) {
  const key = account => hash(`${deps.namespace}:student-feedback:${account}`);
  async function pool() {
    const db = await deps.pool();
    await db.query(`CREATE TABLE IF NOT EXISTS ais_student_correspondence (
      account_key CHAR(64) NOT NULL, message_key CHAR(64) NOT NULL, application_id VARCHAR(200) NOT NULL,
      created_at BIGINT NOT NULL, payload MEDIUMTEXT NOT NULL,
      PRIMARY KEY(account_key,message_key), KEY timeline(account_key,application_id,created_at))`);
    await db.query(`CREATE TABLE IF NOT EXISTS ais_student_correspondence_sync (
      account_key CHAR(64) PRIMARY KEY, checked_at BIGINT NOT NULL)`);
    return db;
  }
  async function save(account, item) {
    const db = await pool();
    await db.query(`INSERT INTO ais_student_correspondence (account_key,message_key,application_id,created_at,payload)
      VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)`,
    [key(account), hash(item.messageId), item.applicationId, item.createdAt, JSON.stringify(item)]);
  }
  async function all(account, application) {
    const db = await pool();
    const [rows] = await db.query(`SELECT payload FROM ais_student_correspondence WHERE account_key=? AND application_id=? ORDER BY created_at,message_key`, [key(account), application]);
    return rows.map(row => JSON.parse(row.payload));
  }
  async function history(account, application) {
    const rows = await all(account, application);
    return { messages: rows.map(({ requestId, subject, message, direction, status, createdAt, messageId, threadId }) =>
      ({ id: requestId || hash(messageId), subject, message, direction, status, createdAt, threadId })) };
  }
  // Read only the center's configured mailbox. A reply must reference a known message
  // in this application; email/subject matches alone never authorize disclosure.
  async function sync(account, record) {
    const deadline = Date.now() + 25000;
    const remaining = () => { if (Date.now() > deadline) throw Error("mail sync timeout"); };
    const db = await pool(), accountKey = key(`${account}:${record.id}`);
    const [times] = await db.query("SELECT checked_at FROM ais_student_correspondence_sync WHERE account_key=?", [accountKey]);
    if (Date.now() - Number(times[0]?.checked_at || 0) < 60000) return { ...await history(account, record.id), cached: true };
    await db.query("INSERT INTO ais_student_correspondence_sync (account_key,checked_at) VALUES (?,?) ON DUPLICATE KEY UPDATE checked_at=VALUES(checked_at)", [accountKey, Date.now()]);
    const known = await all(account, record.id), warnings = [];
    const mailboxes = deps.mailboxes().filter(box => box.login && box.password && box.host);
    if (!mailboxes.length) return { ...await history(account, record.id), warning: "Почта учебного центра пока не подключена. Сохранённая переписка показана ниже." };
    const roots = await deps.legacy(account);
    for (const box of mailboxes) {
      let client;
      try {
        remaining();
        client = await deps.connect(box);
        const fetched = new Set();
        const fetchMessage = async uid => {
          const bytes = deps.literals(await client.command(`UID FETCH ${uid} (UID BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.196608>)`, 12000)).map(item => item.bytes);
          if (!bytes.length) return null;
          const raw = Buffer.concat(bytes), headers = deps.headers(raw).headers;
          return { ...deps.parse(uid, raw), refs: [...ids(headers["in-reply-to"]), ...ids(headers.references)] };
        };
        // Restore messages sent before durable history was introduced, by the exact
        // unpredictable SMTP Message-ID and the application identifier in their body.
        for (const root of roots.slice(-100)) {
          remaining();
          const digest = hash(`student-feedback:${account}:${root.request_id}`);
          if (known.some(item => item.messageId.startsWith(`${digest}@`))) continue;
          const found = deps.search(await client.command(`UID SEARCH HEADER Message-ID ${deps.quote(digest)}`, 12000));
          for (const uid of found.slice(-2)) {
            const mail = await fetchMessage(uid);
            if (!mail?.messageId.startsWith(`${digest}@`) || !mail.text.includes(`Заявка: ${record.id}`)) continue;
            const item = { requestId: root.request_id, applicationId: record.id, threadId: root.request_id,
              messageId: mail.messageId, direction: "student", status: root.status, subject: mail.subject.replace(/^Слушатель:\s*/u, ""),
              message: mail.text, createdAt: Number(root.created_at) };
            await save(account, item); known.push(item);
          }
        }
        if (!known.length) continue;
        const listed = (await client.command('LIST "" "*"', 12000)).toString("utf8");
        const sent = listed.split(/\r?\n/).flatMap(line => {
          const match = line.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) ("(?:\\.|[^"])*"|[^\s]+)$/i);
          if (!match) return [];
          const name = match[2].startsWith('"') ? match[2].slice(1, -1).replace(/\\(["\\])/g, "$1") : match[2];
          return /\\Sent\b/i.test(match[1]) || /(?:^|[./])sent(?: items| messages)?$/i.test(name) ? [name] : [];
        });
        const folders = ["INBOX", ...new Set(sent)];
        const email = String(record.email || "").trim().toLowerCase();
        for (const folder of folders) {
          await client.command(`EXAMINE ${deps.quote(folder)}`, 12000);
          // Exact references, no broad scans of the center's mailbox.
          const pending = [...known];
          for (let index = 0; index < pending.length && index < 120; index++) {
            remaining();
            const parent = pending[index];
            const found = deps.search(await client.command(`UID SEARCH OR HEADER In-Reply-To ${deps.quote(parent.messageId)} HEADER References ${deps.quote(parent.messageId)}`, 12000));
            for (const uid of found.slice(-100)) {
              remaining();
              const fetchKey = `${folder}:${uid}`;
              if (fetched.has(fetchKey)) continue;
              const mail = await fetchMessage(uid);
              if (!mail?.messageId || known.some(item => item.messageId === mail.messageId) || !mail.refs.includes(parent.messageId)) continue;
              fetched.add(fetchKey);
              const from = addresses(mail.from), to = addresses(mail.to);
              const direction = folder !== "INBOX" && from.includes(box.login.toLowerCase()) && to.includes(email) ? "center"
                : folder === "INBOX" && from.includes(email) && to.includes(box.login.toLowerCase()) ? "student" : "";
              if (!direction) continue;
              const item = { applicationId: record.id, threadId: parent.threadId, messageId: mail.messageId,
                direction, status: "sent", subject: mail.subject, message: mail.text.slice(0, 30000),
                createdAt: Number.isFinite(Date.parse(mail.date)) ? Date.parse(mail.date) : Date.now() };
              await save(account, item); known.push(item); pending.push(item);
            }
          }
        }
      } catch { warnings.push("Не удалось проверить ответы в почте. Сохранённая переписка доступна; повторите обновление позже."); }
      finally { if (client) await client.close().catch(() => {}); }
    }
    return { ...await history(account, record.id), warning: warnings[0] || "" };
  }
  return { save, all, history, sync };
}
module.exports = { createStore, messageId, ids, addresses };
