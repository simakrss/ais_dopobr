"use strict";
// Explicit one-time import from the selected local installation. Never exports credentials.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const roles = require(path.join(root, "app-server.js"));
function createPool() {
  const settings = JSON.parse(fs.readFileSync(path.join(root, "storage/server-settings.json"), "utf8"));
  const raw = process.env.AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING || settings.sharedRecordLocksMySqlConnectionString
    || (settings.sharedRecordLocksMySqlUseApplicationsConnection !== false ? settings.studentApplicationsMySqlConnectionString : "");
  const config = raw ? roles.parseSharedRecordLocksMySqlConnectionString(raw) : {
    server: settings.sharedRecordLocksMySqlHost, port: settings.sharedRecordLocksMySqlPort,
    database: settings.sharedRecordLocksMySqlDatabase, uid: settings.sharedRecordLocksMySqlUser, pwd: settings.sharedRecordLocksMySqlPassword
  };
  const host = config.server || config.host, database = config.database || config.initialcatalog;
  const user = config.uid || config.user || config.userid, password = config.pwd || config.password;
  if (!host || !database || !user || !password) throw Error("Shared MySQL connection is not configured");
  return require(path.join(root, "vendor/mysql2-bundle.cjs")).createPool({host, database, user, password,
    port:Number(config.port)||3306, charset:"utf8mb4", timezone:"Z", connectionLimit:2, connectTimeout:10000});
}
async function main() {
  const users = JSON.parse(fs.readFileSync(path.join(root, "storage/users.json"), "utf8")).users;
  const seen = new Set();
  for (const user of users) {
    const identity = roles.sharedAuthRoleIdentity(user);
    if (seen.has(identity.key)) throw Error("Duplicate role identity; migration stopped");
    seen.add(identity.key);
    roles.applySharedAuthRole(user, {principal_key:identity.key, role:user.role, revision:1});
  }
  const pool = createPool(), stateKey = process.env.AIS_SHARED_STATE_KEY || "main";
  try {
    let previous = [];
    try { [previous] = await pool.query("SELECT principal_key, role, revision FROM ais_auth_roles WHERE state_key = ?", [stateKey]); }
    catch(error) { if(error.code !== "ER_NO_SUCH_TABLE") throw error; }
    const missing = users.filter(user=>!previous.some(row=>row.principal_key===roles.sharedAuthRoleIdentity(user).key));
    console.log(JSON.stringify({mode:process.argv.includes("--apply")?"apply":"dry-run",accounts:users.length,newAssignments:missing.length,existingAssignmentsPreserved:users.length-missing.length}));
    if (process.argv.includes("--apply")) {
      const connection = await pool.getConnection();
      try {
        await roles.ensureSharedAuthRoleTable(connection);
        await connection.beginTransaction();
        await roles.initializeSharedAuthRoles(users,connection);
        await connection.commit();
      } catch(error) {await connection.rollback();throw error;}
      finally {connection.release();}
      const resolved = await roles.resolveSharedAuthUsers(users,pool);
      const verifyLogin = process.argv[process.argv.indexOf("--verify-login") + 1];
      const selected = process.argv.includes("--verify-login") && resolved.find(user=>String(user.login).toLowerCase()===String(verifyLogin).toLowerCase());
      console.log(JSON.stringify({migrated:missing.length,verified:resolved.length,...(selected?{account:{login:selected.login,role:selected.role,version:selected.sharedRoleVersion}}:{})}));
    }
  } finally {await pool.end();}
}
if (require.main===module) main().catch(error=>{console.error(error.code || error.message);process.exitCode=1;});
module.exports={createPool};
