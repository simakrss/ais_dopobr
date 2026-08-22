const fs = require("node:fs");
const { Readable } = require("node:stream");
const {
  ensureStorage,
  closeSharedRecordLocksStorage,
  closeStudentApplicationsMySqlStorage,
  closeAssistantStatisticsMySqlStorage,
  route
} = require("./app-server");

const [, , requestPath, requestBodyPath, responsePath, responseBodyPath] = process.argv;

function writeResponse(status, headers, body) {
  fs.writeFileSync(responseBodyPath, body || Buffer.alloc(0));
  fs.writeFileSync(responsePath, JSON.stringify({ status, headers }), "utf8");
}

async function main() {
  if (!requestPath || !requestBodyPath || !responsePath || !responseBodyPath) {
    throw new Error("Incomplete CGI request arguments.");
  }

  const metadata = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const requestBody = fs.readFileSync(requestBodyPath);
  const req = Readable.from(requestBody.length ? [requestBody] : []);
  req.method = String(metadata.method || "GET").toUpperCase();
  req.url = String(metadata.url || "/");
  req.headers = metadata.headers && typeof metadata.headers === "object"
    ? metadata.headers
    : {};

  let status = 200;
  let headers = {};
  let ended = false;
  const res = {
    writeHead(nextStatus, nextHeaders = {}) {
      status = Number(nextStatus) || 200;
      headers = { ...headers, ...nextHeaders };
      return this;
    },
    end(value) {
      if (ended) return this;
      ended = true;
      const body = value === undefined || value === null
        ? Buffer.alloc(0)
        : Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
      writeResponse(status, headers, body);
      return this;
    }
  };

  await ensureStorage();
  await route(req, res);
  if (!ended) res.end();
}

main().catch((error) => {
  writeResponse(
    500,
    { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    Buffer.from(JSON.stringify({ error: error.message || "Server request failed." }), "utf8")
  );
  process.exitCode = 1;
}).finally(async () => {
  await Promise.all([
    closeSharedRecordLocksStorage(),
    closeStudentApplicationsMySqlStorage(),
    closeAssistantStatisticsMySqlStorage()
  ]);
});
