"use strict";
// Embedded in the Authenticode-signed first-run installer by the publisher.
// Never execute a downloaded module to verify its own signature.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const PUBLIC_KEY = "MCowBQYDK2VwAyEARDRUcPC/vPdxq9MOFlSfwBJUJNEz58fA8Jxhiuz9sCE=";
const BASE = "https://edu-plus.ru/lms/updates/";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function validate(envelope) {
  if (typeof envelope?.payload !== "string" || envelope.payload.length > 200000 || typeof envelope.signature !== "string") throw Error("Некорректное описание установки.");
  const payload = Buffer.from(envelope.payload, "base64");
  const key = crypto.createPublicKey({ key: Buffer.from(PUBLIC_KEY, "base64"), format: "der", type: "spki" });
  if (!crypto.verify(null, payload, key, Buffer.from(envelope.signature, "base64"))) throw Error("Подпись пакета АИС не подтверждена.");
  const release = JSON.parse(payload);
  if (release.protocol !== 1 || !/^\d+\.\d+\.\d+$/.test(release.version) || !/^[a-f0-9]{40}$/.test(release.commit)) throw Error("Неподдерживаемый пакет АИС.");
  const parts = release.version.split(".").map(Number), minimum = [1, 7, 602];
  const difference = parts.map((part, index) => part - minimum[index]).find(value => value !== 0) || 0;
  if (difference < 0) throw Error("Пакет не поддерживает самостоятельную установку. Обновите публикацию АИС.");
  if (!Array.isArray(release.files) || !Array.isArray(release.components)) throw Error("Неполный пакет АИС.");
  const files = [...release.files, ...release.components], seen = new Set();
  let total = 0;
  if (files.length < 50 || files.length > 200) throw Error("Неполный состав пакета АИС.");
  for (const file of files) {
    const name = file.path;
    if (typeof name !== "string" || name.length > 180 || /[\\:\x00-\x1f]/.test(name)
      || name.startsWith("/") || name.split("/").some(part => !part || part === "." || part === "..")
      || /^(?:storage|data|\.runtime|\.git)(?:\/|$)/i.test(name)
      || !/^(?:[a-z][a-z0-9.-]*\.(?:js|css|html|ico|png|webmanifest|yml)|scripts\/[a-z][a-z0-9.-]*\.(?:js|ps1|vbs|cs)|services\/ocr\/(?:[a-z_.-]+|Dockerfile)|vendor\/[a-zA-Z0-9/_.-]+)$/.test(name)
      || seen.has(name.toLowerCase()) || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 32 * 1024 * 1024) throw Error("Недопустимый файл пакета АИС.");
    seen.add(name.toLowerCase()); total += file.size;
  }
  if (total > 100 * 1024 * 1024 || !["app-server.js", "local-server.js", "local-update.js", "scripts/start-lan-system.js", "scripts/bootstrap-local-system.ps1"].every(name => seen.has(name))) throw Error("Неполный комплект установки АИС.");
  return { release, files };
}

async function download(url, limit, fetcher = fetch) {
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(120000) });
  if (!response.ok || Number(response.headers.get("content-length")) > limit) throw Error("Ошибка загрузки компонента АИС: HTTP " + response.status);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error("Превышен размер компонента АИС.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function assertLocalDirectory(directory) {
  let current = path.resolve(directory);
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error("Папка установки не должна быть ссылкой.");
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}

async function install(root, options = {}) {
  root = path.resolve(root);
  assertLocalDirectory(root);
  // An installed copy updates itself through its normal idle/backup/rollback workflow.
  if (fs.existsSync(root)) {
    const marker = path.join(root, ".runtime", "standalone-install.json");
    if (!fs.existsSync(marker) || !fs.existsSync(path.join(root, "scripts", "start-lan-system.js"))) throw Error("Папка уже занята. Существующие данные не изменены.");
    return { reused: true };
  }
  const read = options.download || download;
  const { release, files } = validate(JSON.parse(await read(BASE + "latest.json", 200000)));
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, "ais-install-"));
  let installed = false;
  try {
    let next = 0, completed = 0;
    // Wait for every worker before cleaning up a failed stage.
    const workers = await Promise.allSettled(Array.from({ length: 4 }, async () => {
      for (let i; (i = next++) < files.length;) {
        const file = files[i], bytes = await read(BASE + "files/" + file.sha256 + ".bin", file.size);
        if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw Error("Контрольная сумма не совпала: " + file.path);
        const target = path.join(stage, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes, { flag: "wx" });
        options.progress?.(++completed, files.length);
      }
    }));
    const failure = workers.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    fs.mkdirSync(path.join(stage, ".runtime"));
    fs.writeFileSync(path.join(stage, ".runtime", "standalone-install.json"), JSON.stringify({ version: release.version, commit: release.commit, installedAt: Date.now() }));
    assertLocalDirectory(root);
    if (fs.existsSync(root)) throw Error("Другой запуск уже создал папку АИС. Повторите запуск.");
    fs.renameSync(stage, root);
    installed = true;
    return { version: release.version, files: files.length };
  } finally {
    if (!installed && path.dirname(stage) === parent && path.basename(stage).startsWith("ais-install-")) fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) install(process.argv[2], { progress: (done, total) => console.log(`Файлы АИС: ${done} из ${total}`) })
  .then(result => console.log(result.reused ? "Установленная копия АИС найдена." : `АИС ${result.version} загружена и проверена.`))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { validate, download, install, assertLocalDirectory };
