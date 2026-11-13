"use strict";
// Run the real SSO endpoint against a minimal Moodle/session fixture. In
// particular, logout closes the PHP session, so login must use a new request.
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const { spawn } = require("node:child_process"), { request } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ais-sso-flow-")), site = path.join(dir, "site"), key = "a".repeat(64);
fs.mkdirSync(site); fs.writeFileSync(path.join(dir, "ais-sso.key"), key); fs.copyFileSync(path.join(__dirname, "../services/moodle/ais-sso.php"), path.join(site, "ais-sso.php"));
fs.writeFileSync(path.join(site, "authlib.php"), `<?php
namespace core\\lock { class lock_config { static function get_lock_factory($name) { return new self; } function get_lock($key,$wait) { return $this; } function release() {} } }
namespace core\\session { class manager { static function apply_concurrent_login_limit($id,$sid) {} } }
`);
fs.writeFileSync(path.join(site, "config.php"), `<?php
session_start();
$CFG=(object)['wwwroot'=>'https://portal.edu-plus.ru','libdir'=>__DIR__,'mnet_localhost_id'=>1];
$USER=(object)($_SESSION['user']??['id'=>0,'username'=>'']);
if(!isset($_SESSION['moodle'])) $_SESSION['moodle']=new stdClass;
$SESSION=$_SESSION['moodle'];
class core_text { static function strtolower($v){return strtolower($v);} }
class moodle_url { function __construct(public $path){} }
class fixture_db {
 function record_exists($t,$v){$rows=json_decode(@file_get_contents(__DIR__.'/used.json')?:'[]',true);return in_array($v['value'],$rows,true);}
 function insert_record($t,$v){$rows=json_decode(@file_get_contents(__DIR__.'/used.json')?:'[]',true);$rows[]=$v->value;file_put_contents(__DIR__.'/used.json',json_encode($rows));}
 function delete_records_select($t,$q,$v){}
}
$DB=new fixture_db;
function get_complete_user_data($field,$name,$host){return $name==='student'?(object)['id'=>9,'username'=>'student','email'=>'student@example.test','deleted'=>false,'suspended'=>file_exists(__DIR__.'/blocked'),'confirmed'=>true,'auth'=>'manual']:false;}
function isguestuser($user=null){return false;}
function is_siteadmin($user){return false;}
function is_enabled_auth($auth){return $auth==='manual';}
function isloggedin(){global $USER;return $USER->id>0;}
function sesskey(){return $_SESSION['csrf']??=bin2hex(random_bytes(12));}
function require_sesskey(){if(!hash_equals(sesskey(),$_POST['sesskey']??''))throw new RuntimeException('Invalid CSRF');}
function require_logout(){global $USER;$_SESSION=[];session_destroy();setcookie(session_name(),'',time()-3600,'/');$USER=(object)['id'=>0];}
function complete_user_login($user){global $USER;if(session_status()!==PHP_SESSION_ACTIVE)throw new RuntimeException('LOGIN AFTER CLOSED SESSION');session_regenerate_id(true);$USER=$user;$_SESSION['user']=(array)$user;}
function redirect($url){header('Location: '.$url->path, true, 302);exit;}
`);
fs.writeFileSync(path.join(site, "who.php"), `<?php require __DIR__.'/config.php'; if(isset($_GET['seed'])){$USER=(object)['id'=>7,'username'=>'old-account'];$_SESSION['user']=(array)$USER;} header('Content-Type: application/json');echo json_encode(['id'=>$USER->id]);`);
function token() { const claim = { iss: "ais-dopobr", aud: "https://portal.edu-plus.ru", username: "student", email: "student@example.test", studentId: "s", nonce: crypto.randomBytes(24).toString("hex"), exp: Math.floor(Date.now()/1000)+60 };
  const data = Buffer.from(JSON.stringify(claim)).toString("base64url"); return `${data}.${crypto.createHmac("sha256", key).update(data).digest("hex")}`; }
function hidden(html, name) { return html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1]; }
(async () => {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const php = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", site], { windowsHide: true, stdio: "ignore" });
  const api = await request.newContext({ baseURL: `http://127.0.0.1:${port}` });
  const post = (form, origin = "https://edu-plus.ru") => api.post("/ais-sso.php", { form, headers: { Origin: origin }, maxRedirects: 0 });
  try {
    for (let i=0;;i++) { try { await api.get('/who.php?seed=1'); break; } catch(error) { if(i===30)throw error; await new Promise(resolve=>setTimeout(resolve,100)); } }
    const original = token(), start = await post({ token: original }); assert.equal(start.status(),200);
    const html = await start.text(); assert.ok(html.includes('Сменить учётную запись')); assert.ok(html.includes('old-account'));
    let form = { decision:'no', request:hidden(html,'request'), sesskey:hidden(html,'sesskey') };
    const cancel = await post(form,'https://portal.edu-plus.ru'); assert.equal(cancel.status(),302); assert.equal((await (await api.get('/who.php')).json()).id,7);
    assert.equal((await post({token:original})).status(),403,'initial assertion cannot be replayed');
    const next = await (await post({token:token()})).text(); form={decision:'yes',request:hidden(next,'request'),sesskey:hidden(next,'sesskey')};
    assert.equal((await post(form,'https://attacker.test')).status(),403);
    assert.equal((await post({...form,sesskey:'forged'},'https://portal.edu-plus.ru')).status(),403);
    const handoff = await post(form,'https://portal.edu-plus.ru'); assert.equal(handoff.status(),200);
    const resume=hidden(await handoff.text(),'token'); assert.ok(resume); assert.equal((await (await api.get('/who.php')).json()).id,0,'old account actually logged out');
    const login=await post({token:resume},'https://portal.edu-plus.ru'); assert.equal(login.status(),302); assert.equal(login.headers().location,'/my/courses.php');
    assert.equal((await (await api.get('/who.php')).json()).id,9); assert.equal((await post({token:resume},'https://portal.edu-plus.ru')).status(),403);
    const same=await post({token:token()}); assert.equal(same.status(),302); assert.equal(same.headers().location,'/my/courses.php');
    await api.get('/who.php?seed=1'); const pending=await(await post({token:token()})).text(); fs.writeFileSync(path.join(site,'blocked'),'1');
    assert.equal((await post({decision:'yes',request:hidden(pending,'request'),sesskey:hidden(pending,'sesskey')},'https://portal.edu-plus.ru')).status(),403);
    assert.equal((await (await api.get('/who.php')).json()).id,7,'blocked target cannot log out current user');
    console.log('PASS: real SSO confirmation/cancel, CSRF/origin/replay protection, logout/new-session handoff, target revalidation and My courses redirect');
  } finally { await api.dispose(); php.kill(); await new Promise(resolve=>php.once('exit',resolve));
    const resolved=path.resolve(dir); if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('ais-sso-flow-'))throw Error('Unsafe cleanup path'); fs.rmSync(resolved,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
