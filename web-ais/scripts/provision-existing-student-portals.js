"use strict";
// Run on the trusted installation with AIS_APP_ROOT pointing at its private storage.
// Dry run by default. This command never sends mail and never changes SDO credentials.
const fs = require("node:fs/promises"), path = require("node:path");
const server = require("../app-server.js");
(async () => {
  if (!process.env.AIS_APP_ROOT) throw Error("Укажите AIS_APP_ROOT действующей локальной АИС.");
  await server.ensureStorage();
  const apply = process.argv.includes("--apply");
  if (apply) {
    const snapshot = await server.readSharedApplicationStateDocument({ allowCache: false, skipOfflineSync: true });
    if (snapshot.offline || snapshot.syncPending) throw Error("Общая база недоступна.");
    const folder = path.join(process.env.AIS_APP_ROOT, "storage", "shared-state-backups", "private");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, `before-student-portals-${Date.now()}.json`), JSON.stringify(snapshot.document), { flag: "wx", mode: 0o600 });
  }
  const result = await server.getStudentEnrollmentService().provisionExisting({ apply, onProgress: progress => console.log(JSON.stringify(progress)) });
  console.log(JSON.stringify({ apply, mailSent: 0, ...result }));
  await server.closeSharedRecordLocksStorage();
  process.exit(0);
})().catch(error => { console.error(error.message); process.exit(1); });
