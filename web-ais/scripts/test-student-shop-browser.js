"use strict";
// Real PHP session handling and browser cross-site forms, with isolated identities
// and a fake Node transport. No requests reach the production sites.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), net = require("node:net"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ais-shop-browser-")), app = path.join(__dirname, "..");
fs.copyFileSync(path.join(app, "auth-lib.php"), path.join(dir, "auth-lib.php"));
fs.copyFileSync(path.join(app, "shop-sso.php"), path.join(dir, "shop-sso.php"));
fs.copyFileSync(path.join(app, "styles.css"), path.join(dir, "styles.css"));
fs.writeFileSync(path.join(dir, "gateway.php"), `<?php
$_SERVER['HTTPS']='on'; $_SERVER['SCRIPT_NAME']='/lms/shop-sso.php';
require_once __DIR__.'/auth-lib.php';
function ais_audit_try_append($entry,$user) {}
function gateway_run_node($path,$method,$headers,$body) {
 $data=json_decode($body,true);$token=$data['token']??'';$used=json_decode(@file_get_contents(__DIR__.'/used.json')?:'[]',true);
 if(file_exists(__DIR__.'/blocked')||in_array($token,$used,true))return ['status'=>403,'body'=>'{}'];
 if($data['consume']??false){$used[]=$token;file_put_contents(__DIR__.'/used.json',json_encode($used));}
 return ['status'=>200,'body'=>json_encode(['user'=>['id'=>'student:target','studentId'=>'target','login'=>'target','name'=>'Слушатель','role'=>'student','studentCredentialVersion'=>str_repeat('a',64)]])];
}
`);
fs.writeFileSync(path.join(dir, "router.php"), `<?php
$url=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);
if($url==='/lms/styles.css'){header('Content-Type:text/css');readfile(__DIR__.'/styles.css');return;}
if($url==='/lms/shop-sso.php'){require __DIR__.'/shop-sso.php';return;}
require __DIR__.'/gateway.php';
if(isset($_GET['seed']))ais_auth_login_student(['id'=>'student:other','studentId'=>'other','login'=>'other-account','name'=>'Другой слушатель','role'=>'student','studentCredentialVersion'=>str_repeat('b',64)]);
header('Content-Type:application/json');echo json_encode(ais_auth_current_user());
`);
(async () => {
  const reserve = net.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const phpPath = process.env.PHP_BIN || 'php', phpDir = path.dirname(phpPath);
  const php = spawn(phpPath, ['-d', `extension_dir=${phpDir}/ext`, '-d', 'extension=mbstring', '-S', `127.0.0.1:${port}`, path.join(dir, 'router.php')], { windowsHide: true, stdio: 'ignore', cwd: dir });
  let browser;
  try {
    for (let i=0;;i++) { try { await fetch(`http://127.0.0.1:${port}/lms/`); break; } catch(error) { if(i===40)throw error; await new Promise(r=>setTimeout(r,100)); } }
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 800 } }), page = await context.newPage(), stages = [];
    await context.route('**/*', route => route.abort());
    await context.route('https://edu-plus.ru/lms/**', async route => {
      const req = route.request(), url = new URL(req.url()), headers = { ...await req.allHeaders() }; delete headers.host; delete headers['content-length'];
      if(req.method()==='POST') stages.push({origin:headers.origin,body:new URLSearchParams(req.postData()).get('stage')||'start',cookie:Boolean(headers.cookie)});
      const response = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { method:req.method(), headers, body:req.postDataBuffer()||undefined, redirect:'manual' });
      const outgoing = Object.fromEntries(response.headers); delete outgoing['content-length'];
      if(response.status===303){assert.equal(outgoing.location,'./');delete outgoing.location;outgoing['content-type']='text/html';return route.fulfill({status:200,headers:outgoing,body:'<script>location.replace("/lms/")</script>'});}
      await route.fulfill({status:response.status,headers:outgoing,body:Buffer.from(await response.arrayBuffer())});
    });
    let serial=0;
    const shopSource=fs.readFileSync(path.join(app,'services/wordpress/ais-student-accounts.php'),'utf8');
    const shopPolicy=shopSource.match(/header\('Referrer-Policy: ([a-z-]+)'\)/)[1];
    assert.equal(shopPolicy,'strict-origin','Cross-site POST must retain the shop Origin without disclosing its path');
    await context.route('https://zifra-plus.ru/account-fixture', route => route.fulfill({headers:{'Referrer-Policy':shopPolicy},contentType:'text/html; charset=utf-8',body:`<meta name="referrer" content="${shopPolicy}"><form method="post" action="https://edu-plus.ru/lms/shop-sso.php"><input type="hidden" name="token" value="fixture${++serial}.${'a'.repeat(64)}"><button>Открыть кабинет</button></form>`}));
    await page.goto('https://edu-plus.ru/lms/?seed=1');
    await page.goto('https://zifra-plus.ru/account-fixture'); await page.getByRole('button',{name:'Открыть кабинет',exact:true}).click();
    await page.getByRole('button',{name:'Войти как слушатель',exact:true}).waitFor();
    assert.ok(await page.getByText('other-account',{exact:true}).isVisible(), 'Existing strict-cookie session retained');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,'Mobile dialog fits');
    assert.equal(stages[0].cookie,false,'Cross-site post must not receive Strict cookie');
    assert.equal(stages[1].cookie,true,'Same-origin continuation must see current account');
    assert.deepEqual(stages.map(s=>s.origin),['https://zifra-plus.ru','https://edu-plus.ru']);
    const screenshots = path.join(app,'.runtime','student-shop-verification'); fs.mkdirSync(screenshots,{recursive:true}); await page.screenshot({path:path.join(screenshots,'confirm-mobile.png'),fullPage:true});
    await page.getByRole('link',{name:'Отмена',exact:true}).click(); await page.waitForURL('https://edu-plus.ru/lms/');
    assert.equal(JSON.parse(await page.locator('body').innerText()).studentId,'other','Cancel retains original identity');
    await page.goto('https://zifra-plus.ru/account-fixture'); await page.getByRole('button',{name:'Открыть кабинет',exact:true}).click();
    await page.getByRole('button',{name:'Войти как слушатель',exact:true}).click(); await page.waitForURL('https://edu-plus.ru/lms/');
    assert.equal(JSON.parse(await page.locator('body').innerText()).studentId,'target','Confirmation opens student cabinet');
    await page.goto('https://zifra-plus.ru/account-fixture'); await page.getByRole('button',{name:'Открыть кабинет',exact:true}).click(); await page.waitForURL('https://edu-plus.ru/lms/');
    assert.equal(JSON.parse(await page.locator('body').innerText()).studentId,'target','Same account enters automatically');
    await context.close();
    console.log('PASS: browser cross-site Origin, Strict cookies, session preservation, confirmation/cancel, automatic same-user login, mobile layout');
  } finally {
    if(browser)await browser.close(); php.kill(); await new Promise(resolve=>php.once('exit',resolve));
    const target=path.resolve(dir);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(target).startsWith('ais-shop-browser-'))throw Error('Unsafe cleanup');fs.rmSync(target,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
