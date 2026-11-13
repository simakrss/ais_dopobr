"use strict";
// URL/UI tests only. Never opens WordPress or changes real records.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname,"..");
const source = fs.readFileSync(path.join(root,"app.js"),"utf8").replace(/\r\n/g,"\n");
const styles = fs.readFileSync(path.join(root,"styles.css"),"utf8");
function extract(name) {
  const match=source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}$`,"m"));
  assert.ok(match,name);return match[0];
}
const production=["getEmployeeCouponAdminUrl","openEmployeeCoupon","renderContractPartnerSection","renderOrdersSdoIcon","isRecordReadOnlyButtonAllowed"].map(extract).join("\n");
const list="https://zifra-plus.ru/wp-admin/edit.php?post_type=shop_coupon#";
const escapeHtml=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fields={coupon:{key:"coupon",label:"Персональный купон"},couponId:{key:"couponId",label:"ID купона"},notificationEmail:{key:"notificationEmail",label:"Email для уведомлений"}};
class FakeButton {
  constructor(action){this.dataset={action};}
  matches(){return false;}
}
function test() {
  const opened=[];
  let form={elements:{couponId:{value:"4590"}}};
  const c={
    document:{querySelector:selector=>{assert.equal(selector,"#recordForm[data-config='contracts']");return form;}},
    openExternalUrl:url=>opened.push(url), HTMLButtonElement:FakeButton,
    getContractField:key=>fields[key],renderField:field=>`<label>${field.label}<input name="${field.key}"></label>`
  };
  vm.createContext(c);vm.runInContext(production,c);
  for(const id of ["4590",4590,"  7812  ","004590","9007199254740993"]) {
    assert.equal(c.getEmployeeCouponAdminUrl(id),`https://zifra-plus.ru/wp-admin/post.php?post=${String(id).trim()}&action=edit&classic-editor#`);
  }
  for(const id of ["",null,undefined,"  ",0,"000","-5","12.3","4590&action=delete","javascript:alert(1)","<script>","coupon-17"])assert.equal(c.getEmployeeCouponAdminUrl(id),list);
  const before=JSON.stringify(form);
  c.openEmployeeCoupon();assert.equal(opened.at(-1),c.getEmployeeCouponAdminUrl("4590"));
  assert.equal(JSON.stringify(form),before,"Navigation must not change or save the card");
  form.elements.couponId.value="7812";c.openEmployeeCoupon();assert.equal(opened.at(-1),c.getEmployeeCouponAdminUrl("7812"));
  form.elements.couponId.value="";c.openEmployeeCoupon();assert.equal(opened.at(-1),list);
  form={elements:{}};c.openEmployeeCoupon();assert.equal(opened.at(-1),list);
  form=null;c.openEmployeeCoupon();assert.equal(opened.length,4);
  assert.equal(c.isRecordReadOnlyButtonAllowed(new FakeButton("open-employee-coupon")),true);
  assert.equal(c.isRecordReadOnlyButtonAllowed(new FakeButton("generate-employee-coupon")),false);
  const markup=c.renderContractPartnerSection({});
  assert.match(markup,/data-action="open-employee-coupon" type="button"/u);
  assert.match(markup,/aria-label="Открыть купон в магазине"/u);
  assert.match(markup,/data-action="generate-employee-coupon"/u);
  assert.ok(markup.indexOf('name="couponId"')<markup.indexOf('data-action="open-employee-coupon"'));
  assert.ok(markup.indexOf('data-action="open-employee-coupon"')<markup.indexOf('data-action="generate-employee-coupon"'));
  assert.match(c.renderOrdersSdoIcon("link"),/<path /u);
  assert.match(source,/\[data-action='open-employee-coupon'\][\s\S]{0,100}addEventListener\("click", openEmployeeCoupon\)/u);
  assert.match(styles,/\.contract-coupon-id-control\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto auto/u);
  assert.match(styles,/\.contract-coupon-open-button\s*\{[^}]*width:\s*32px/u);
  console.log("Employee coupon link: numeric/current/empty/unsafe IDs, unchanged card, readonly access, SVG and layout: OK");
}
function serveFixture(){
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка ссылки купона</title><link rel="stylesheet" href="/styles.css"><body><main style="max-width:900px;margin:20px auto;padding:16px"><h1>Тест ссылки купона</h1><p>Переход перехватывается: магазин не открывается.</p><form id="recordForm" data-config="contracts"></form><p id="result" role="status"></p></main><script>
  const fields=${JSON.stringify(fields)},getContractField=key=>fields[key];
  const escapeHtml=${escapeHtml.toString()};
  const renderField=(field,record)=>'<label><span>'+field.label+'</span><input name="'+field.key+'" value="'+escapeHtml(record[field.key]||'')+'"></label>';
  const openExternalUrl=url=>{document.getElementById('result').textContent=url;};
  ${production}
  document.getElementById('recordForm').innerHTML=renderContractPartnerSection({coupon:'TEST15',couponId:'4590'});
  document.querySelector('[data-action="open-employee-coupon"]').addEventListener('click',openEmployeeCoupon);
  </script></body></html>`;
  require("node:http").createServer((req,res)=>{
    if(req.url==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(html);}
    else if(req.url==="/styles.css"){res.writeHead(200,{"Content-Type":"text/css"});res.end(styles);}
    else {res.writeHead(404);res.end();}
  }).listen(0,"127.0.0.1",function(){console.log(`Coupon link fixture: http://127.0.0.1:${this.address().port}/`);});
}
if(process.argv.includes("--serve"))serveFixture();else test();
