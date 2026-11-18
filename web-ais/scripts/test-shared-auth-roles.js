"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
// Must be set before loading app-server: live tests use an isolated namespace only.
const stateKey = `role-test-${crypto.randomBytes(8).toString("hex")}`;
process.env.AIS_SHARED_STATE_KEY = stateKey;
const root = path.resolve(__dirname,".."), roles = require(path.join(root,"app-server.js"));
const user = {id:"local-user",login:"role-check",employeeId:"local-contract",authSource:"employee",role:"partner",status:"active"};
const key = roles.sharedAuthRoleIdentity(user).key;
assert.equal(key,roles.sharedAuthRoleIdentity({...user,login:" ROLE-CHECK ",employeeId:"different-contract"}).key);
assert.notEqual(key,roles.sharedAuthRoleIdentity({login:user.login}).key,"Manual and employee identities must never collide");
assert.equal(roles.applySharedAuthRole(user,{principal_key:key,role:"manager",revision:9}).sharedRoleVersion,"9");
assert.throws(()=>roles.applySharedAuthRole(user,{principal_key:key,role:"admin",revision:1}),/Некорректное/);
assert.throws(()=>roles.applySharedAuthRole(user,{principal_key:"wrong-key",role:"manager",revision:1}),/Некорректное/);
assert.equal(roles.applySharedAuthRole(user,null).role,"partner");
assert.equal(roles.sharedAuthRoleExpectedVersion({...user,sharedRoleVersion:"4"},{...user,login:"renamed-user"},"4"),"0");
assert.throws(()=>roles.sharedAuthRoleExpectedVersion({...user,sharedRoleVersion:"4"},{...user,login:"renamed-user"},"3"),e=>e.statusCode===409);

async function heartbeatTests() {
  const source=fs.readFileSync(path.join(root,"auth-bootstrap.js"),"utf8").replace(/\r\n/g,"\n");
  const extract=name=>source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  \\}$`,"m"))[0];
  let payload={user:{id:"same",role:"partner"},demoModeEnabled:false},reloads=0;
  const c={databaseDemoModeHeartbeatRunning:false,authenticatedUser:{id:"same",role:"manager"},app:{innerHTML:"manager",style:{}},request:async()=>payload,window:{location:{reload:()=>reloads++}},handleExternalDatabaseDemoMode:()=>false};
  vm.createContext(c);vm.runInContext(extract("verifyDatabaseDemoMode"),c);
  assert.equal(await c.verifyDatabaseDemoMode(),true);assert.equal(reloads,1);assert.equal(c.app.innerHTML,"");
  c.authenticatedUser={id:"same",role:"partner"};await c.verifyDatabaseDemoMode();assert.equal(reloads,1,"Same role must not reload endlessly");
  payload={user:{id:"other",role:"partner"},demoModeEnabled:false};await c.verifyDatabaseDemoMode();assert.equal(reloads,2);
  c.request=async()=>{throw Error("offline");};await c.verifyDatabaseDemoMode();assert.equal(c.databaseDemoModeHeartbeatRunning,false);
  console.log("Identity boundaries, role validation and session-role refresh: OK");
}

async function mysqlTests() {
  const {createPool}=require("./migrate-shared-auth-roles.js"),pool=createPool();
  try {
    await roles.initializeSharedAuthRoles([user],pool);
    const websiteUser={...user,id:"website-user",employeeId:"website-contract",role:"manager"};
    assert.equal((await roles.resolveSharedAuthUser(websiteUser,pool)).role,"partner");
    const changed=await roles.saveSharedAuthRole(websiteUser,"1","test-admin",pool);
    assert.equal(changed.sharedRoleVersion,"2");
    assert.equal((await roles.resolveSharedAuthUser(user,pool)).role,"manager");
    await roles.initializeSharedAuthRoles([user],pool);
    assert.equal((await roles.resolveSharedAuthUser(user,pool)).role,"manager","Old copy must not overwrite a shared assignment");
    await assert.rejects(roles.saveSharedAuthRole(user,"1","stale-window",pool),e=>e.statusCode===409);
    assert.equal((await roles.resolveSharedAuthUser(user,pool)).sharedRoleVersion,"2");
    // An ordinary existing Node session must use the common role, not the local users.json role.
    const source=fs.readFileSync(path.join(root,"app-server.js"),"utf8").replace(/\r\n/g,"\n");
    const extract=name=>source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`,"m"))[0];
    const c={requestHasTrustedGatewayIdentity:()=>false,parseRequestCookies:()=>({session:"test-token"}),AUTH_COOKIE_NAME:"session",crypto,
      loadAuthSessions:async()=>[{tokenHash:crypto.createHash("sha256").update("test-token").digest("hex"),userId:user.id,expiresAt:Date.now()+100000}],
      loadAuthUsers:async()=>[{...user,role:"partner"}],maybeRunAutomaticContractExpiration:async()=>{},resolveSharedAuthUser:u=>roles.resolveSharedAuthUser(u,pool)};
    vm.createContext(c);vm.runInContext(extract("publicAuthUser")+"\n"+extract("getRequestAuthUser"),c);
    assert.equal((await c.getRequestAuthUser({})).role,"manager");
    // Run the PHP implementation against this same isolated namespace when requested.
    const php=process.env.AIS_TEST_PHP;
    if (php) {
      const ext=path.join(path.dirname(php),"ext");
      const result=require("node:child_process").spawnSync(php,["-d",`extension_dir=${ext}`,"-d","extension=mbstring","-d","extension=pdo_mysql",path.join(__dirname,"test-shared-auth-roles.php"),"--mysql"],{encoding:"utf8",env:process.env,timeout:60000});
      assert.equal(result.status,0,result.stderr||result.stdout);console.log(result.stdout.trim());
      assert.equal((await roles.resolveSharedAuthUser(websiteUser,pool)).role,"partner","PHP change must apply in Node");
      assert.equal((await roles.resolveSharedAuthUser(websiteUser,pool)).sharedRoleVersion,"3");
    }
    await assert.rejects(roles.resolveSharedAuthUser(user,{query:async()=>{throw Error("offline");}}),/offline/,"Unavailable authority must not return stale privileged role");
    console.log("MySQL: cross-copy roles, stale-copy safety, optimistic conflicts, live session, rollback and offline rejection: OK");
  } finally {
    assert.match(stateKey,/^role-test-[a-f0-9]{16}$/);
    await pool.query("DELETE FROM ais_auth_roles WHERE state_key = ?",[stateKey]);
    await pool.end();
  }
}
heartbeatTests().then(()=>process.argv.includes("--mysql")?mysqlTests():null).catch(error=>{console.error(error);process.exitCode=1;});
