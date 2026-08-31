const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ais-shared-cache-"));
const cachePath = path.join(tempRoot, "shared-state.json");
process.env.AIS_SHARED_STATE_LOCAL_PATH = cachePath;

function makeDocument(revision, marker) {
  return {
    schemaVersion: 2,
    revision,
    updatedAt: new Date(2026, 7, 20, 12, 0, revision).toISOString(),
    updatedBy: "test",
    data: {
      collections: { students: [{ id: "student-1", marker }] },
      dictionaries: { citizenships: ["Россия"] },
      meta: {}
    }
  };
}

fs.writeFileSync(cachePath, JSON.stringify(makeDocument(1, "r1")), "utf8");

const {
  readSharedApplicationStateCache,
  writeSharedApplicationStateCache
} = require(path.join(__dirname, "..", "app-server.js"));

(async () => {
  try {
    const [, , firstWrite] = await Promise.all([
      readSharedApplicationStateCache(),
      readSharedApplicationStateCache(),
      writeSharedApplicationStateCache(makeDocument(2, "r2"))
    ]);
    assert.strictEqual(firstWrite, true);
    assert.strictEqual(await writeSharedApplicationStateCache(makeDocument(1, "r1")), false);
    await Promise.all([
      writeSharedApplicationStateCache(makeDocument(4, "r4")),
      writeSharedApplicationStateCache(makeDocument(3, "r3"))
    ]);
    const cached = await readSharedApplicationStateCache();
    assert.strictEqual(cached.revision, 4);
    assert.strictEqual(cached.data.collections.students[0].marker, "r4");
    const saved = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    assert.strictEqual(saved.revision, 4);
    assert.strictEqual(saved.data.collections.students[0].marker, "r4");
    console.log("shared application state cache monotonicity: OK");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
