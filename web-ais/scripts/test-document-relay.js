"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const {spawn} = require("node:child_process");
const relay = require("../document-relay");
const secret = "a".repeat(64);
async function main() {
  const encrypted = relay.encrypt(secret, {privateText: "Паспорт ТЕСТ"}, "test", "input");
  assert.ok(!encrypted.includes(Buffer.from("Паспорт")));
  assert.deepEqual(relay.decrypt(secret, encrypted, "test", "input"), {privateText: "Паспорт ТЕСТ"});
  assert.throws(() => relay.decrypt(secret, encrypted, "other-job", "input"));
  assert.throws(() => relay.decrypt(secret, encrypted, "test", "output"));
  assert.throws(() => relay.decrypt("b".repeat(64), encrypted, "test", "input"));
  let active = 0, maximum = 0;
  const ordered = await relay.mapConcurrent([0,1,2,3], 2, async index => {
    maximum = Math.max(maximum, ++active); await new Promise(r => setTimeout(r, 20 - index)); active--; return index;
  });
  assert.equal(maximum, 2); assert.deepEqual(ordered, [0,1,2,3]);
  const php = process.env.PHP_BINARY || "C:/Users/ronad/AppData/Local/Microsoft/WinGet/Packages/PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe/php.exe";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ais-relay-node-"));
  const direct = process.argv.includes("--direct");
  const publicRoot = path.join(temp,"public_html");
  fs.mkdirSync(path.join(publicRoot,"wp-content","mu-plugins"),{recursive:true});
  fs.writeFileSync(path.join(temp,"ais-program-site.key"),secret,{mode:0o600});
  fs.copyFileSync(path.join(__dirname,"../services/wordpress/ais-document-relay.php"),path.join(publicRoot,"wp-content","mu-plugins","ais-document-relay.php"));
  const net = require("node:net"); const probe = net.createServer();
  await new Promise(r => probe.listen(0, "127.0.0.1", r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const child = spawn(php, ["-S", `127.0.0.1:${port}`, ...(direct ? ["-t",publicRoot] : [path.join(__dirname, "test-document-relay.php")])], {env: {...process.env, AIS_RELAY_TEST_ROOT: temp}, windowsHide: true, stdio: "ignore"});
  let startupError = null;
  child.on("error", error => { startupError = error; });
  const clientOptions = {base: `http://127.0.0.1:${port}${direct ? "/wp-content/mu-plugins/ais-document-relay.php" : "/wp-json/ais-document-relay/v1"}`, fetch: (url,options) => new Promise((resolve,reject) => {
    const request = require("node:http").request(url,{method:options.method,signal:options.signal,headers:{...options.headers,Host:"zifra-plus.ru"}}, response => {
      const chunks=[]; response.on("data",chunk=>chunks.push(chunk)); response.on("end",()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode}))); response.on("error",reject);
    }); request.on("error",reject); request.end(options.body);
  })};
  const client = relay.createClient(secret, clientOptions);
  const workers = [], handled = [];
  try {
    for (let n = 0; ; n++) { if (startupError) throw startupError; try { await client.call("health"); break; } catch(error) { if (n > 50) throw error; await new Promise(r=>setTimeout(r,100)); } }
    await assert.rejects(relay.createClient("b".repeat(64), clientOptions).call("health"), error => error.statusCode === 403);
    for (const workerId of ["1".repeat(32), "2".repeat(32)]) {
      workers.push(relay.startWorker({workerId, getClient: async () => client, getCapabilities: async () => ["pdf", "ocr"], execute: async (kind, payload, controller) => {
        handled.push({workerId, index: payload.index, kind});
        if (payload.cancel) await new Promise((resolve, reject) => { controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {once:true}); });
        else await new Promise(r=>setTimeout(r,150));
        return {index: payload.index, size: payload.large?.length || 0};
      }}));
    }
    for (let n = 0; n < 30 && (await client.call("health")).workers < 2; n++) await new Promise(r=>setTimeout(r,100));
    assert.equal((await client.call("health")).workers, 2);
    const results = await Promise.all([0,1,2,3].map(index => client.run(index % 2 ? "ocr" : "pdf", {index, ...(index === 0 ? {large: "x".repeat(900000)} : {})})));
    assert.deepEqual(results.map(x=>x.index), [0,1,2,3]); assert.equal(results[0].size,900000);
    assert.equal(handled.length, 4); assert.equal(new Set(handled.map(x=>x.workerId)).size,2);
    const privateRoot = path.join(temp,"ais-document-relay-private");
    assert.equal(fs.readdirSync(privateRoot).filter(file=>/\.(input|output)$/.test(file)).length, 0, "Received payloads must be removed");
    const controller = new AbortController();
    const cancelled = client.run("ocr", {index: 99, cancel: true}, {signal:controller.signal});
    const rejected = assert.rejects(cancelled);
    for (let n=0;n<100&&!handled.some(x=>x.index===99);n++) await new Promise(r=>setTimeout(r,100));
    assert.ok(handled.some(x=>x.index===99)); controller.abort(new Error("test cancel")); await rejected;
    assert.equal(fs.readdirSync(privateRoot).filter(file=>/\.(input|output)$/.test(file)).length,0);
    console.log(`Relay ${direct ? "direct" : "WordPress"} end-to-end: PHP/Node signatures, encrypted multi-chunk transfer, two concurrent workers, balanced jobs, result cleanup, cancellation and stable order OK`);
  } finally {
    workers.forEach(worker => worker.stop());
    if (child.exitCode === null && !startupError) await new Promise(resolve => { child.once("exit",resolve); child.kill(); });
    // The path is freshly created above and must retain the known test prefix.
    assert.ok(path.basename(temp).startsWith("ais-relay-node-")); fs.rmSync(temp,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
