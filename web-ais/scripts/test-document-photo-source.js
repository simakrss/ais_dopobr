"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app-server.js"), "utf8").replace(/\r\n/g, "\n");
const names = [
  "normalizeWebDavPath", "normalizeSystemDocumentsRelativePath", "usesParentSystemDocumentsFolder",
  "getAbsoluteFileSystemPathApi", "getRuntimeFileSystemPathApi", "resolveLocalDocumentsPath",
  "resolveLocalSystemDocumentsFolder", "getLocalSystemDocumentsAvailability", "resolveStoredPhotoPath",
  "imageExtensionFromPath", "imageDimensions", "parseDataUrl", "loadPersonPhotoBytes", "loadContractPhoto",
  "handleStudentSourcePhoto"
];
function extract(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  const next = /\n(?:async )?function /g;
  next.lastIndex = start + 1;
  const end = next.exec(source)?.index;
  assert.ok(start >= 0 && end > start, `Function ${name} is present`);
  return source.slice(start, end);
}

function createPhotoRuntime(overrides = {}) {
  const ROOT = path.resolve(os.tmpdir(), "ais-photo-test-app");
  const context = {
    Buffer, URL, path, process, fs: fs.promises, ROOT, PHOTO_ROOT: path.join(ROOT, "storage/photos"), PORT: 8081,
    DEFAULT_LOCAL_DOCUMENTS_ROOT: path.parse(ROOT).root, DEFAULT_YANDEX_DISK_BASE_PATH: "АИС Допобразование",
    MAX_STUDENT_PHOTO_BYTES: 16 * 1024 * 1024,
    IMAGE_CONTENT_TYPES: { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" },
    serverSettings: { openDocumentsLocally: true, localDocumentsRoot: path.join(os.tmpdir(), "ais-photo-test-documents"), yandexDiskBasePath: "Организация/АИС Допобразование", localDocumentsRootIsSystemParent: true },
    isInsideRoot: file => !path.relative(ROOT, file).startsWith("..") && !path.isAbsolute(path.relative(ROOT, file)),
    resolveDatabaseDemoPhotoAccess: () => ({ enabled: false }), CORS_HEADERS: {},
    sendError: (res, status, message) => { res.status = status; res.error = message; },
    loadSystemDocumentFromYandexDisk: async () => { throw new Error("Unexpected cloud access in a local test"); },
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(names.map(extract).join("\n"), context);
  return context;
}

async function runTests() {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBVkAAAAASUVORK5CYII=", "base64");
  const remotePng = Buffer.from(png);
  const calls = [];
  const entries = new Map();
  const runtime = createPhotoRuntime({
    fs: {
      stat: async file => {
        calls.push(["stat", file]);
        if (!entries.has(file)) throw Object.assign(new Error("Missing fixture"), { code: "ENOENT" });
        const value = entries.get(file);
        return { isDirectory: () => value === null, isFile: () => value !== null, size: value?.length || 0 };
      },
      readFile: async file => { calls.push(["read", file]); return entries.get(file); }
    },
    loadSystemDocumentFromYandexDisk: async value => { calls.push(["cloud", value]); return remotePng; }
  });
  const initialSettings = JSON.stringify(runtime.serverSettings);
  const localRoot = runtime.resolveLocalSystemDocumentsFolder();
  entries.set(localRoot, null);
  for (const folder of ["Слушатели", "Сотрудники"]) {
    const relative = `\\${folder}\\ТестТА\\Документы\\Фото.png`;
    const local = runtime.resolveLocalDocumentsPath(relative);
    entries.set(local, png);
    for (const value of [relative, relative.replaceAll("\\", "/"), local]) {
      calls.length = 0;
      const photo = await runtime.loadContractPhoto({ Фото: value });
      assert.ok(photo.bytes.equals(png));
      assert.equal(photo.width, 1);
      assert.equal(photo.height, 1);
      assert.equal(photo.mime, "image/png");
      assert.deepEqual(calls.filter(([kind]) => kind === "read"), [["read", local]]);
      assert.equal(calls.some(([kind]) => kind === "cloud"), false, "Local mode never reads a different cloud copy");
    }
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(bytes) { this.bytes = bytes; } };
    const url = new URL("http://localhost/api/student-photo");
    url.searchParams.set("path", relative);
    await runtime.handleStudentSourcePhoto({ method: "GET" }, response, url);
    assert.equal(response.status, 200);
    assert.ok(response.bytes.equals((await runtime.loadContractPhoto({ photoPath: relative })).bytes));
    assert.equal(response.headers["Content-Type"], "image/png");
  }
  assert.equal(JSON.stringify(runtime.serverSettings), initialSettings, "Resolving photos must not change folder settings");
  const relative = "\\Слушатели\\ТестТА\\Документы\\Фото.png";
  runtime.serverSettings.openDocumentsLocally = false;
  calls.length = 0;
  assert.ok((await runtime.loadContractPhoto({ photo: relative })).bytes.equals(remotePng));
  assert.deepEqual(calls, [["cloud", relative]], "Cloud mode ignores even an existing local copy");
  runtime.serverSettings.openDocumentsLocally = true;
  entries.delete(localRoot);
  calls.length = 0;
  assert.ok((await runtime.loadContractPhoto({ Фото: relative })).bytes.equals(remotePng));
  assert.equal(calls.filter(([kind]) => kind === "cloud").length, 1, "A host without the local drive uses the same fallback as the card");
  entries.set(localRoot, null);
  calls.length = 0;
  assert.equal(await runtime.loadContractPhoto({ Фото: "\\Слушатели\\ТестТА\\missing.png" }), null);
  assert.equal(calls.some(([kind]) => kind === "cloud"), false, "Do not substitute a different cloud photo for a missing local file");
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(runtime.MAX_STUDENT_PHOTO_BYTES + 1), null]) {
    entries.set(runtime.resolveLocalDocumentsPath(relative), bytes);
    calls.length = 0;
    assert.equal(await runtime.loadContractPhoto({ Фото: relative }), null);
    assert.equal(calls.some(([kind]) => kind === "read" || kind === "cloud"), false);
  }
  calls.length = 0;
  assert.equal(await runtime.loadContractPhoto({ Фото: "../outside.png" }), null);
  assert.equal(await runtime.loadContractPhoto({ Фото: "" }), null);
  assert.equal(await runtime.loadContractPhoto({ Фото: "file.txt" }), null);
  assert.equal(calls.length, 0);
  const storedPath = path.join(runtime.PHOTO_ROOT, "legacy.png");
  entries.set(storedPath, png);
  assert.ok((await runtime.loadContractPhoto({ Фото: "/storage/photos/legacy.png" })).bytes.equals(png));
  assert.ok((await runtime.loadContractPhoto({ Фото: `data:image/png;base64,${png.toString("base64")}` })).bytes.equals(png));
  runtime.resolveStoredPhotoPath = () => path.join(runtime.ROOT, "outside.png");
  await assert.rejects(runtime.loadPersonPhotoBytes("outside.png"), /Недопустимый путь/);
  console.log("Document photos: local/cloud sources, card parity, student/employee paths, bounds, legacy/inline images and unchanged settings: OK");
}

module.exports = { createPhotoRuntime };
if (require.main === module) runTests().catch(error => { console.error(error); process.exitCode = 1; });
