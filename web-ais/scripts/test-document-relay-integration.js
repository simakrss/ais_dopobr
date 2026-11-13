"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const gateway = fs.readFileSync(path.join(root, "gateway.php"), "utf8");
const block = (start, end) => server.slice(server.indexOf(start), server.indexOf(end, server.indexOf(start)));
async function main() {
  let calls = 0, local = true, cancelled = false;
  const controller = new AbortController();
  const sandbox = {Buffer, documentRelay: require("../document-relay"),
    throwIfDocumentGenerationCancelled() { if (cancelled) throw Error("cancelled"); },
    convertDocxBytesToPdfWithLibreOffice: async () => { if (local) return Buffer.from("%PDF-local"); throw Error("No LibreOffice"); },
    documentGenerationContext: {getStore: () => controller},
    getDocumentRelayClient: async () => ({run: async (kind, payload, options) => {
      calls++; assert.equal(kind, "pdf"); assert.equal(Buffer.from(payload.base64,"base64").toString(), "PK-test");
      assert.equal(options.signal, controller.signal); return {base64: Buffer.from("%PDF-queue").toString("base64")};
    }})};
  vm.createContext(sandbox);
  vm.runInContext(block("async function convertDocxBytesToPdf(docxBytes", "async function removeBlankInteriorPdfPages"), sandbox);
  assert.equal((await sandbox.convertDocxBytesToPdf(Buffer.from("PK-test"))).toString(),"%PDF-local"); assert.equal(calls,0);
  local=false; assert.equal((await sandbox.convertDocxBytesToPdf(Buffer.from("PK-test"))).toString(),"%PDF-queue"); assert.equal(calls,1);
  cancelled=true; await assert.rejects(sandbox.convertDocxBytesToPdf(Buffer.from("PK-test")),/cancelled/); assert.equal(calls,1);
  const executor=block("async function executeDocumentRelayJob", "function startDocumentRelayWorker");
  assert.match(executor,/convertDocxBytesToPdfWithLibreOffice\(bytes\)/);
  assert.doesNotMatch(executor,/client\.run|convertDocxBytesToPdf\(bytes\)/,"Workers must not submit work recursively");
  for(const operation of ["recognize", "render-page", "recognize-field"]) assert.ok(server.includes(`runDocumentRelayOcr("${operation}"`));
  assert.match(server,/documentRelay\.mapConcurrent\(documents, concurrency/);
  assert.match(server,/documentRelayWorker\?\.status\(\)\.busy/,"Updater must drain in-flight claims too");
  assert.match(gateway,/&& !gateway_document_compute_uses_queue\(\$method, \$path, \$previewAffinityBackend\)/);
  assert.match(gateway,/\$affinity === '' && \$method === 'POST' && \$path === '\/api\/contracts\/student-document'/);
  assert.ok(require("../local-update").FILES.includes("document-relay.js"));
  console.log("Relay integration: local-first PDF, queue fallback, cancellation signal, non-recursive workers, all OCR operations, parallel files, update drain and gateway routing OK");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
