const { ClassicLevel } = require(process.env.CLASSIC_LEVEL_MODULE || "classic-level");

const [, , databasePath, origin, apiUrl] = process.argv;

function decodeChromeLocalStorageValue(value) {
  if (!Buffer.isBuffer(value) || !value.length) throw new Error("Chrome localStorage value is empty.");
  if (value[0] === 0) return value.subarray(1).toString("utf16le");
  if (value[0] === 1) return value.subarray(1).toString("utf8");
  return value.toString("utf8");
}

async function readApplicationState() {
  if (!databasePath || !origin || !apiUrl) {
    throw new Error("Usage: node migrate-chrome-state-to-shared.js <leveldb-path> <origin> <api-url>");
  }
  const keyPrefix = `_${origin}\0\x01`;
  const storageKey = "ais-dopobr-web-state-v1";
  const database = new ClassicLevel(databasePath, {
    keyEncoding: "buffer",
    valueEncoding: "buffer",
    readOnly: true
  });
  await database.open();
  try {
    for await (const [key, value] of database.iterator()) {
      if (key.toString("utf8") !== `${keyPrefix}${storageKey}`) continue;
      const data = JSON.parse(decodeChromeLocalStorageValue(value));
      if (!data?.collections || !data?.dictionaries) {
        throw new Error("The selected Chrome state is not an AIS database.");
      }
      return data;
    }
  } finally {
    await database.close();
  }
  throw new Error(`AIS localStorage was not found for ${origin}.`);
}

async function main() {
  const data = await readApplicationState();
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "AIS-Migration" },
    body: JSON.stringify({ baseRevision: 0, data })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Shared state API returned HTTP ${response.status}.`);
  const counts = Object.fromEntries(Object.entries(data.collections)
    .map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : null]));
  process.stdout.write(`${JSON.stringify({
    revision: payload.revision,
    versionTag: payload.versionTag,
    counts
  })}\n`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
