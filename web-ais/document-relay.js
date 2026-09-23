"use strict";
// A private, encrypted compute queue. Never contains database credentials or arbitrary commands/URLs.
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const BASE = "https://zifra-plus.ru/wp-json/ais-document-relay/v1";
const POLL_MS = 3000;
const CHUNK_BYTES = 384 * 1024;
const MAX_BYTES = 48 * 1024 * 1024;
const KINDS = ["pdf", "ocr"];
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const derive = (secret, purpose) => crypto.createHmac("sha256", secret).update(`ais-document-relay-v1:${purpose}`).digest();
function failure(message, status = 503) { return Object.assign(new Error(message), { statusCode: status }); }
function encrypt(secret, value, id, direction) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", derive(secret, "encryption"), iv);
  cipher.setAAD(Buffer.from(`${id}:${direction}`));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  const result = Buffer.concat([iv, cipher.getAuthTag(), bytes]);
  if (result.length > MAX_BYTES) throw failure("Документ превышает размер задания очереди.", 413);
  return result;
}
function decrypt(secret, bytes, id, direction) {
  if (bytes.length < 28 || bytes.length > MAX_BYTES) throw failure("Повреждён пакет обработки документов.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", derive(secret, "encryption"), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${id}:${direction}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason || failure("Обработка отменена.", 499)); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, {once: true});
  });
}
function createClient(secret, options = {}) {
  if (!/^[a-f0-9]{64}$/.test(secret || "")) throw failure("Ключ защищённой очереди не настроен.");
  const fetcher = options.fetch || fetch;
  const base = options.base || BASE;
  async function call(action, payload = {}, signal) {
    const body = JSON.stringify(payload), resource = `/wp-json/ais-document-relay/v1/${action}`;
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(16).toString("hex");
    const proof = crypto.createHmac("sha256", derive(secret, "authentication"))
      .update(["POST", resource, timestamp, nonce, hash(body)].join("\n")).digest("hex");
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
    const response = await fetcher(`${base}/${action}`, {method: "POST", redirect: "error", signal: requestSignal,
      headers: {"Content-Type": "application/json", "X-AIS-Timestamp": timestamp, "X-AIS-Nonce": nonce, "X-AIS-Signature": proof}, body});
    // Read incrementally so a broken endpoint cannot exhaust the worker's memory.
    let length = 0; const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 1024 * 1024) throw failure("Сайт вернул слишком большой ответ очереди.");
      chunks.push(chunk);
    }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw failure(`Очередь zifra-plus.ru недоступна (HTTP ${response.status}).`); }
    if (!response.ok) throw failure(String(result?.message || "Очередь отклонила запрос.").slice(0, 500), response.status);
    return result;
  }
  async function put(action, identity, bytes, signal) {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const data = bytes.subarray(offset, offset + CHUNK_BYTES).toString("base64");
      // Same offset and bytes are idempotent if an acknowledgement was lost.
      let last;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await call(action, {...identity, offset, data}, signal); last = null; break; }
        catch (error) { last = error; if (signal?.aborted || error.statusCode < 500) throw error; }
      }
      if (last) throw last;
    }
  }
  async function read(identity, size, digest, signal) {
    if (!Number.isSafeInteger(size) || size < 28 || size > MAX_BYTES || !/^[a-f0-9]{64}$/.test(digest || "")) throw failure("Некорректный размер результата очереди.");
    const chunks = []; let length = 0;
    while (length < size) {
      const part = await call("read", {...identity, offset: length}, signal);
      const bytes = Buffer.from(String(part.data || ""), "base64");
      if (!bytes.length || bytes.length > CHUNK_BYTES || length + bytes.length > size) throw failure("Повреждён фрагмент документа.");
      chunks.push(bytes); length += bytes.length;
    }
    const bytes = Buffer.concat(chunks);
    if (hash(bytes) !== digest) throw failure("Контрольная сумма документа не совпадает.");
    return bytes;
  }
  async function run(kind, payload, {signal, timeoutMs = 6 * 60 * 1000, onProgress} = {}) {
    if (!KINDS.includes(kind)) throw failure("Недопустимый вид обработки.", 400);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(failure("Серверы не завершили обработку вовремя. Проверьте доступные компьютеры.")), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const id = crypto.randomBytes(16).toString("hex"), owner = crypto.randomBytes(32).toString("hex");
    const input = encrypt(secret, {kind, payload}, id, "input");
    const identity = {id, owner}; let submitted = false;
    try {
      // Remember before sending: even a lost response must be followed by cancellation.
      submitted = true;
      await call("submit", {...identity, kind, size: input.length, digest: hash(input)}, combined);
      await put("put", identity, input, combined);
      await call("commit", identity, combined);
      for (;;) {
        combined.throwIfAborted();
        const status = await call("status", identity, combined);
        onProgress?.(status);
        if (status.state === "complete") {
          const bytes = await read(identity, status.size, status.digest, combined);
          const result = decrypt(secret, bytes, id, "output");
          await call("ack", identity, combined);
          submitted = false;
          if (!result.ok) throw failure(result.error || "Не удалось обработать документ.");
          return result.result;
        }
        if (["cancelled", "failed"].includes(status.state)) throw failure("Задание отменено или исполнитель недоступен. Повторите обработку.");
        await pause(POLL_MS, combined);
      }
    } finally {
      clearTimeout(timeout);
      if (submitted) await call("cancel", identity).catch(() => null);
    }
  }
  return {call, put, read, run, encrypt: (value, id, direction) => encrypt(secret, value, id, direction), decrypt: (bytes, id, direction) => decrypt(secret, bytes, id, direction)};
}
async function fromStorage(storageRoot, options) {
  const keys = JSON.parse(await fs.readFile(path.join(storageRoot, "program-site-keys.json"), "utf8"));
  return createClient(keys.shop, options);
}
function startWorker({getClient, getCapabilities, execute, isPaused = () => false, onError = () => {}, workerId}) {
  const worker = workerId || hash(`${os.hostname().toLowerCase()}\0${process.cwd()}`).slice(0, 32);
  let stopped = false, busy = false, timer = null, current = null, lastError = "", completed = 0;
  async function tick() {
    if (stopped || busy) return;
    busy = true;
    let renewal = null;
    try {
      const client = await getClient();
      const capabilities = isPaused() ? [] : await getCapabilities();
      const claim = await client.call("claim", {worker, capabilities});
      if (!claim.job || stopped) return;
      const {id, lease, kind, size, digest} = claim.job;
      const identity = {id, lease, worker};
      const controller = new AbortController(); current = controller;
      let renewBusy = false, lastRenewed = Date.now();
      renewal = setInterval(async () => {
        if (renewBusy || controller.signal.aborted) return;
        renewBusy = true;
        try { await client.call("renew", identity, controller.signal); lastRenewed = Date.now(); }
        catch (error) { if (error.statusCode === 409 || Date.now() - lastRenewed > 25000) controller.abort(error); }
        finally { renewBusy = false; }
      }, 8000);
      try {
        const bytes = await client.read(identity, size, digest, controller.signal);
        const request = client.decrypt(bytes, id, "input");
        if (request.kind !== kind || !KINDS.includes(kind)) throw failure("Некорректное задание очереди.");
        let result;
        try { result = {ok: true, result: await execute(kind, request.payload, controller)}; }
        catch (error) { controller.signal.throwIfAborted(); result = {ok: false, error: String(error.message || error).slice(0, 500)}; }
        const output = client.encrypt(result, id, "output");
        await client.call("result-start", {...identity, size: output.length, digest: hash(output)}, controller.signal);
        await client.put("result-put", identity, output, controller.signal);
        await client.call("complete", identity, controller.signal);
        completed++;
      } finally { current = null; }
      lastError = "";
    } catch (error) {
      const message = String(error.message || error).slice(0, 300);
      if (message !== lastError) onError(message);
      lastError = message;
    } finally {
      clearInterval(renewal); busy = false;
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  }
  timer = setTimeout(tick, 0);
  return {stop() { stopped = true; clearTimeout(timer); current?.abort(failure("Исполнитель остановлен.")); },
    status: () => ({worker, active: Boolean(current), busy, completed, error: lastError, pollMs: POLL_MS})};
}
async function mapConcurrent(items, concurrency, processItem) {
  let next = 0; const results = new Array(items.length);
  await Promise.all(Array.from({length: Math.min(items.length, Math.max(1, Math.min(6, concurrency || 1)))}, async () => {
    while (next < items.length) { const index = next++; results[index] = await processItem(items[index], index); }
  }));
  return results;
}
module.exports = {BASE, POLL_MS, CHUNK_BYTES, MAX_BYTES, hash, derive, encrypt, decrypt, createClient, fromStorage, startWorker, mapConcurrent};
