const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const STORAGE_ROOT = path.join(ROOT, "storage");
const PHOTO_ROOT = path.join(STORAGE_ROOT, "photos");
const PORT = Number(process.env.PORT || 8080);
const MAX_JSON_BYTES = 12 * 1024 * 1024;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

async function ensureStorage() {
  await fs.mkdir(PHOTO_ROOT, { recursive: true });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new Error("Payload is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([\s\S]+)$/i.exec(String(dataUrl || ""));
  if (!match) throw new Error("Expected image data URL");
  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const bytes = Buffer.from(match[3], "base64");
  if (!bytes.length) throw new Error("Empty image");
  return { bytes, ext, mime: match[1].toLowerCase() };
}

function safePhotoPath(photoPath) {
  const fileName = path.basename(String(photoPath || ""));
  if (!/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/i.test(fileName)) return null;
  return path.join(PHOTO_ROOT, fileName);
}

async function deletePhoto(photoPath) {
  const fullPath = safePhotoPath(photoPath);
  if (!fullPath) return false;
  try {
    await fs.unlink(fullPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function handlePhotoUpload(req, res) {
  try {
    const body = await readJsonBody(req);
    const { bytes, ext } = parseDataUrl(body.dataUrl);
    if (body.previousPath) await deletePhoto(body.previousPath);
    const fileName = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
    const fullPath = path.join(PHOTO_ROOT, fileName);
    await fs.writeFile(fullPath, bytes);
    sendJson(res, 201, {
      photoPath: `storage/photos/${fileName}`,
      photoUrl: `/storage/photos/${fileName}`
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handlePhotoDelete(req, res) {
  try {
    const body = await readJsonBody(req);
    const deleted = await deletePhoto(body.photoPath);
    sendJson(res, 200, { deleted });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const fullPath = path.resolve(ROOT, relativePath);
  if (!fullPath.startsWith(ROOT)) {
    sendError(res, 403, "Forbidden");
    return;
  }
  try {
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      res.writeHead(301, { Location: `${requestUrl.pathname.replace(/\/$/, "")}/index.html` });
      res.end();
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    const headers = { ...CORS_HEADERS, "Content-Type": MIME_TYPES[ext] || "application/octet-stream" };
    if (decodedPath.startsWith("/storage/photos/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
    const file = await fs.readFile(fullPath);
    res.writeHead(200, headers);
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendError(res, 404, "Not found");
      return;
    }
    sendError(res, 500, error.message);
  }
}

async function route(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, storage: "storage/photos" });
    return;
  }
  if (req.method === "POST" && req.url === "/api/photos") {
    await handlePhotoUpload(req, res);
    return;
  }
  if (req.method === "DELETE" && req.url === "/api/photos") {
    await handlePhotoDelete(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }
  sendError(res, 405, "Method not allowed");
}

ensureStorage()
  .then(() => {
    http.createServer((req, res) => {
      route(req, res).catch((error) => sendError(res, 500, error.message));
    }).listen(PORT, () => {
      console.log(`АИС Допобразование Web: http://localhost:${PORT}`);
      console.log(`Фото: ${PHOTO_ROOT}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
