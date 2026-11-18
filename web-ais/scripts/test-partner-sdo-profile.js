"use strict";
// Synthetic partner records only. No live account, database, password or mail access.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n?/g, "\n");
const client = fs.readFileSync(path.join(root, "partner-app.js"), "utf8").replace(/\r\n?/g, "\n");
process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";
const {buildPartnerProfile, sanitizePartnerProfileUpdate, selectPartnerEmployee, getPartnerSdoUrl} = require("../app-server");
function extract(source, name, indent = "") {
  const match = source.match(new RegExp(`^${indent}(?:async )?function ${name}\\([\\s\\S]*?^${indent}}`, "m"));
  assert.ok(match, name); return match[0];
}
const employee = {id:"fixture-own", name:"Тестовый Партнёр Иванович", login:"partner.test", password:"synthetic-only-123", email:"partner@example.test", phone:"+7 000 000-00-00", notificationEmail:true};
const other = {id:"fixture-other", name:"Другой Партнёр Иванович", login:"another.test", password:"another-synthetic-secret"};
const user = {role:"partner", employeeId:employee.id, login:employee.login};
async function backendTests() {
  for (const input of [{login:"hack", password:"hack", notificationEmail:false}, {login:"", password:""}]) assert.deepEqual(sanitizePartnerProfileUpdate(input), {});
  const settings = value => ({dictionaries:{sdoSettings:[{key:"portalUrl", value}]}});
  assert.equal(getPartnerSdoUrl(settings("https://training.example.test/my/")), "https://training.example.test/my/");
  for (const url of ["javascript:alert(1)", "file:///c:/secret", "https://name:secret@example.test", "not a url"]) assert.equal(getPartnerSdoUrl(settings(url)), "https://portal.edu-plus.ru/");
  assert.equal(getPartnerSdoUrl({dictionaries:{moodlePortalUrls:["", "https://legacy.example.test"]}}), "https://legacy.example.test/");
  const c = vm.createContext({
    URL, CORS_HEADERS:{}, buildPartnerProfile, sanitizePartnerProfileUpdate, selectPartnerEmployee, getPartnerSdoUrl,
    normalizePartnerIdentity:value => String(value || "").trim().toLowerCase(),
    readPartnerSharedData:async () => ({collections:{contracts:[employee,other]}}),
    readJsonBody:async req => req.testBody,
    readSharedApplicationStateDocument:async () => ({document:{revision:1,data:{collections:{contracts:[employee,other]}}}}),
    saveSharedApplicationState:async patch => { c.patch = patch; return {}; },
    safelyAppendAuditEntry:async row => { c.audit = row; }
  });
  vm.runInContext(["sendJson","sendError","resolvePartnerPortalContext","updatePartnerProfile","handlePartnerPortalRequest"].map(name => extract(server,name)).join("\n"), c);
  function response() { return {writeHead(code,headers){this.code=code;this.headers=headers;},end(body){this.body=JSON.parse(body);}}; }
  const url = new URL("https://example.test/api/partner/sdo-password?employeeId=fixture-other");
  const res = response();
  await c.handlePartnerPortalRequest({method:"POST",testBody:{employeeId:other.id}}, res, user, url);
  assert.equal(res.code,200); assert.equal(res.body.password,employee.password);
  assert.equal(res.headers["Cache-Control"],"no-store");
  assert.equal(c.audit,undefined, "Never audit the password response");
  for (const role of ["manager","admin",null]) {
    const denied=response();
    await c.handlePartnerPortalRequest({method:"POST"},denied,role ? {...user,role} : null,url);
    assert.equal(denied.code,403); assert.equal(denied.body.password,undefined);
  }
  const noEmployee=response();
  await c.handlePartnerPortalRequest({method:"POST"},noEmployee,{role:"partner",employeeId:"unknown",login:"unknown"},url);
  assert.equal(noEmployee.code,403);
  const get=response(); await c.handlePartnerPortalRequest({method:"GET"},get,user,url); assert.equal(get.code,404);
  const update=response();
  await c.updatePartnerProfile({testBody:{values:{login:"hacked",password:"hacked",notificationEmail:false,phone:"+7 111 111-11-11"}}},update,user);
  assert.equal(update.code,200);
  const saved=c.patch.patch.collections.contracts.upserts[0];
  assert.equal(saved.login,employee.login); assert.equal(saved.password,employee.password);
  assert.equal(saved.notificationEmail,true); assert.equal(saved.phone,"+7 111 111-11-11");
  assert.doesNotMatch(JSON.stringify(update.body), /synthetic-only|another-synthetic|hacked/);
  assert.equal(update.body.profile.tabs.documents.find(f=>f.key==="password").editable,false);
  assert.equal(update.body.profile.tabs.main.some(f=>f.key==="notificationEmail"),false);
  const dashboard = extract(client,"renderDashboard","  ");
  assert.ok(dashboard.indexOf("<h3>К выплате</h3>") < dashboard.indexOf("<h3>Выплаты по месяцам</h3>"));
  console.log("PASS: partner-only password endpoint, own-account binding, no-store, write protection, notification retained, safe configured SDO URL, dashboard order");
}
async function browserTests() {
  const portal={profile:buildPartnerProfile(employee),sdoUrl:"https://training.example.test/my/",payments:{summary:{currentPayable:500,totalPaid:1000},rows:[{statusKey:"payable",amount:500,description:"Тестовое начисление",source:"Рекомендация",effectiveDate:"2026-09-27"}],monthly:[{month:"2026-08",label:"Август 2026",amount:1000}]},materials:{}};
  // Verify compatibility while an old backend still marks these fields editable.
  portal.profile.tabs.documents.filter(f=>["login","password"].includes(f.key)).forEach(f=>{f.editable=true;});
  portal.profile.tabs.main.push({key:"notificationEmail",label:"Уведомления по email",kind:"boolean",value:true,editable:true});
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="app"></div><script>
    const portal=${JSON.stringify(portal)}; window.updates=[]; window.reveals=0;
    window.AIS_AUTH_USER={role:"partner",name:portal.profile.name,login:"partner.test"};
    window.AIS_AUTH_API={appUrl:path=>path,request:async(path,options)=>{
      if(path==='api/partner/portal')return structuredClone(portal);
      if(path==='api/partner/sdo-password'){window.reveals++;return fetch('/password',{method:options.method}).then(r=>r.json());}
      if(path==='api/partner/profile'){window.updates.push(JSON.parse(options.body));return {profile:structuredClone(portal.profile)};}
      throw Error('Unexpected fixture request');
    }};
    </script><script src="/partner-app.js"></script></html>`;
  const http=require("node:http");
  const fixture=http.createServer((req,res)=>{
    if(req.url==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});return res.end(html);}
    if(req.url==="/password"){assert.equal(req.method,"POST");res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});return res.end(JSON.stringify({password:employee.password}));}
    if(["/partner-app.js","/styles.css"].includes(req.url)){res.writeHead(200,{"Content-Type":req.url.endsWith(".css")?"text/css":"text/javascript"});return res.end(fs.readFileSync(path.join(root,req.url.slice(1))));}
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>fixture.listen(0,"127.0.0.1",resolve));
  let browser;
  try {
    const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
    const page=await browser.newPage(),errors=[]; page.on("pageerror",e=>errors.push(e.message));
    for(const viewport of [{width:1366,height:900},{width:390,height:844}]){
      await page.setViewportSize(viewport);await page.goto(`http://127.0.0.1:${fixture.address().port}`);
      await page.waitForSelector(".partner-chart-panel");
      assert.deepEqual(await page.locator(".partner-content h3").allTextContents(),["К выплате","Выплаты по месяцам"]);
      await page.evaluate(()=>{location.hash="partner/profile";});
      await page.waitForSelector("[data-profile-form]");
      assert.equal(await page.getByText("Уведомления по email").count(),0);
      await page.locator('[data-profile-field="phone"]').fill("+7 111 111-11-11");
      await page.click('[data-profile-tab="documents"]');
      const login=page.locator("[data-partner-sdo-login]"), password=page.locator("[data-partner-sdo-password]"), toggle=page.locator('[data-action="toggle-sdo-password"]');
      assert.equal(await login.inputValue(),employee.login); assert.equal(await login.getAttribute("readonly"),"");
      assert.equal(await password.getAttribute("readonly"),""); assert.equal(await password.inputValue(),"");
      assert.equal(await page.locator('[data-profile-field="login"], [data-profile-field="password"]').count(),0);
      assert.equal(await page.evaluate(()=>window.reveals),0);
      const open=page.getByRole("link",{name:"Открыть СДО"});
      assert.equal(await open.getAttribute("href"),portal.sdoUrl);assert.equal(await open.getAttribute("target"),"_blank");
      await toggle.click();await page.waitForFunction(()=>document.querySelector('[data-partner-sdo-password]').type==='text');
      assert.equal(await password.inputValue(),employee.password);
      assert.equal(await toggle.getAttribute("aria-pressed"),"true");
      await toggle.click();assert.equal(await password.inputValue(),"");assert.equal(await password.getAttribute("type"),"password");
      assert.equal(await page.evaluate(()=>window.reveals),1);
      const fits=await page.locator(".partner-sdo-password-control").evaluate(el=>el.scrollWidth<=el.clientWidth+1);
      assert.ok(fits,"Password controls overflow");
      await toggle.click();await page.waitForFunction(()=>document.querySelector('[data-partner-sdo-password]').type==='text');
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await password.inputValue(),"");
      await page.evaluate(()=>{delete document.hidden;});
      await page.getByRole("button",{name:"Сохранить изменения",exact:true}).click();
      await page.waitForFunction(()=>window.updates.length===1);
      assert.deepEqual(await page.evaluate(()=>window.updates[0].values),{phone:"+7 111 111-11-11"});
      assert.equal(await password.inputValue(),"");
      if(process.env.AIS_PARTNER_SCREENSHOT&&viewport.width===1366)await page.screenshot({path:process.env.AIS_PARTNER_SCREENSHOT,fullPage:true});
    }
    assert.deepEqual(errors,[]);
    console.log("PASS: desktop/mobile dashboard, hidden checkbox, readonly SDO inputs, lazy reveal/hide, clear on background/save, safe link, other profile edits preserved");
  } finally {await browser?.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
}
backendTests().then(()=>process.argv.includes("--browser")?browserTests():null).catch(e=>{console.error(e);process.exitCode=1;});
