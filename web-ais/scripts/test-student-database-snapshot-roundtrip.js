"use strict";
// Opt-in integration test. All writes are confined to a fresh OS temp directory.
// Usage: node test-student-database-snapshot-roundtrip.js source.xlsb [shared-state.json]
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const api = require("../app-server.js");

assert.ok(process.argv[2], "Pass a source XLSB; it is read only and never opened by Excel.");
const sourcePath = path.resolve(process.argv[2]);
const snapshotPath = process.argv[3] ? path.resolve(process.argv[3]) : "";
const sourceBytes = fs.readFileSync(sourcePath);
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sourceHash = hash(sourceBytes);
const snapshotBytes = snapshotPath ? fs.readFileSync(snapshotPath) : null;
const verifyDirectory = process.argv[4] ? path.resolve(process.argv[4]) : "";
const tempRoot = verifyDirectory || fs.mkdtempSync(path.join(os.tmpdir(), "ais-snapshot-roundtrip-"));
assert.equal(path.dirname(tempRoot), path.resolve(os.tmpdir()));
assert.ok(path.basename(tempRoot).startsWith("ais-snapshot-roundtrip-"));
const script = path.resolve(__dirname, "sync-student-database.ps1");
const inputPath = path.join(tempRoot, "input.xlsb");
const outputPath = path.join(tempRoot, "output.xlsb");
let succeeded = false;

function prepareClientPrograms(state) {
  // The persisted state can predate the client-side English-name migration.
  // Run the real pure migration rather than treating missing old keys as deletions.
  const source = fs.readFileSync(path.resolve(__dirname, "../app.js"), "utf8");
  const start = source.indexOf("  function mergeProgramPaymentRegistry");
  const end = source.indexOf("\n  function normalizeProgramName", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ window: {},
    normalizeProgramName: (value) => String(value || "").replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim().toLowerCase(),
    normalizePaymentPercent: (value, fallback) => Number(value ?? fallback)
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../data/program-payment-registry.js"), "utf8"), context);
  // Only the idempotent backfill is relevant; do not import historical prices/rates.
  const data = structuredClone(state);
  data.meta.programPaymentRegistryVersion = context.window.AIS_PROGRAM_PAYMENT_REGISTRY_VERSION;
  vm.runInContext(source.slice(start, end), context);
  const programs = context.mergeProgramPaymentRegistry(data, data.collections.programs);
  assert.equal(programs.length, data.collections.programs.length, "Client backfill must preserve all programs");
  return programs;
}

async function runExcel(input, output, payload, label) {
  for (const file of [input, output]) assert.equal(path.dirname(file), tempRoot);
  const payloadPath = path.join(tempRoot, `${label}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const launcher = [
      "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
      "$scriptText = [IO.File]::ReadAllText($env:AIS_SYNC_SCRIPT, [Text.UTF8Encoding]::new($false))",
      "& ([ScriptBlock]::Create($scriptText)) -InputPath $env:AIS_SYNC_INPUT -OutputPath $env:AIS_SYNC_OUTPUT -PayloadPath $env:AIS_SYNC_PAYLOAD"
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", Buffer.from(launcher, "utf16le").toString("base64")], {
      windowsHide: true, env: { ...process.env, AIS_SYNC_SCRIPT: script,
        AIS_SYNC_INPUT: input, AIS_SYNC_OUTPUT: output, AIS_SYNC_PAYLOAD: payloadPath }
    });
    let stdout = "", stderr = "", pending = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      pending += chunk;
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop();
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.type === "progress") console.log(`${label}: ${message.progress}%`);
        } catch {}
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        fs.writeFileSync(path.join(tempRoot, `${label}-error.log`), stderr || stdout);
        reject(new Error(`${label}: Excel exit ${code}; diagnostic retained in temp directory`));
        return;
      }
      const line = stdout.split(/\r?\n/u).reverse().find((entry) => entry.startsWith("{") && entry.includes('"type":"result"'));
      try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
    });
  });
}

async function main() {
  console.log(`Temporary copy: ${tempRoot}`);
  if (!verifyDirectory) fs.writeFileSync(inputPath, sourceBytes);
  else assert.equal(hash(fs.readFileSync(inputPath)), sourceHash, "Verification must use the same source copy");
  const imported = api.parseStudentDatabaseWorkbook(sourceBytes, () => {}, { includeStudentWriteLayout: true });
  const state = snapshotBytes ? JSON.parse(snapshotBytes).data : null;
  const collections = state?.collections || {
    ...imported, programs: imported.programPaymentSettings,
    directExpenses: [...(imported.directExpenses || []), ...imported.students.flatMap((student) => student.directExpenses || [])]
  };
  if (state) collections.programs = prepareClientPrograms(state);
  const payload = verifyDirectory
    ? JSON.parse(fs.readFileSync(path.join(tempRoot, "intended.json"), "utf8"))
    : api.sanitizeStudentDatabaseExportPayload({
    students: collections.students, contracts: collections.contracts,
    directExpenses: collections.directExpenses, generalExpenses: collections.generalExpenses,
    inventory: collections.inventory, trainingPlans: collections.trainingPlans, programs: collections.programs,
    agentPaymentRates: imported.agentPaymentRates,
    macroSettings: { ...imported.macroSettings,
      ...(state ? { studentEventTemplates: state.meta.studentEventTemplates,
        contractEventTemplates: state.meta.contractEventTemplates,
        eventSettingsUpdatedAt: state.meta.eventSettingsUpdatedAt } : {}) }
  });
  payload.programsReplaceAll = true;
  api.materializeStudentDatabaseMissingAdditionalStatuses(payload, imported);
  if (!verifyDirectory) fs.writeFileSync(path.join(tempRoot, "intended.json"), JSON.stringify(payload));
  console.log(JSON.stringify({ records: Object.fromEntries(["students", "contracts", "directExpenses", "generalExpenses", "inventoryRows", "programs", "trainingPlans"].map((key) => [key, payload[key].length])) }));
  if (!verifyDirectory) await runExcel(inputPath, outputPath, payload, "write-copy");
  const metadata = await runExcel(outputPath, path.join(tempRoot, "unused.xlsb"), {
    readSyncMetadataOnly: true,
    syncMetadataSheets: [
      ["База", "students"], ["Реестр договоров", "contracts"], ["Прямые затраты", "directExpenses"],
      ["Общие затраты", "generalExpenses"], ["Запасы", "inventoryUnits"], ["Реестр программ", "programs"], ["Учебные планы", "trainingPlans"]
    ].map(([sheetName, entity]) => ({ sheetName, entity }))
  }, "read-metadata");
  fs.writeFileSync(path.join(tempRoot, "metadata.json"), JSON.stringify(metadata.syncMetadataRows));
  const outputBytes = fs.readFileSync(outputPath);
  const output = api.parseStudentDatabaseWorkbook(outputBytes, () => {}, { syncMetadataRows: metadata.syncMetadataRows });
  fs.writeFileSync(path.join(tempRoot, "parsed-output.json"), JSON.stringify(output));
  const changes = api.buildStudentDatabaseSynchronizedChanges(payload, output);
  fs.writeFileSync(path.join(tempRoot, "changes.json"), JSON.stringify(changes));
  api.validateStudentDatabaseReconciliationSelectionsAgainstOutput(payload, output, {});
  api.validateStudentDatabaseFixedValueOverridesAgainstOutput(payload, output);
  assert.equal(api.hashStudentDatabaseEventSettings(payload), api.hashStudentDatabaseEventSettings(output), "Event settings preserved");
  const before = api.inspectStudentDatabaseBinary(sourceBytes);
  const after = api.inspectStudentDatabaseBinary(outputBytes);
  assert.ok(!before.hasVba || after.hasVba, "VBA preserved");
  assert.equal(after.vbaHash, before.vbaHash, "VBA hash preserved");
  succeeded = true;
  console.log("PASS full snapshot round-trip: records, fixed fields, events, overrides, VBA; original XLSB untouched");
}
main().catch((error) => {
  // Detailed diagnostics can contain personal data; keep them out of console/CI logs.
  fs.writeFileSync(path.join(tempRoot, "validation-error.log"), error.stack || String(error));
  console.error(`FAIL ${error.code || error.name}; details retained in ${tempRoot}`);
  process.exitCode = 1;
}).finally(() => {
  assert.equal(hash(fs.readFileSync(sourcePath)), sourceHash, "Original workbook must remain byte-identical");
  console.log("Original XLSB SHA-256 unchanged");
  // Delete only this test's validated, newly created temporary directory on success.
  if (succeeded && process.env.AIS_KEEP_TEST_ARTIFACTS !== "1") {
    assert.equal(path.dirname(tempRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tempRoot).startsWith("ais-snapshot-roundtrip-"));
    fs.rmSync(tempRoot, { recursive: true });
  }
});
