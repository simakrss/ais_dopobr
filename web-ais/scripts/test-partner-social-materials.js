"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,".."),server=require("../app-server.js");
const source=fs.readFileSync(path.join(root,"partner-app.js"),"utf8").replace(/\r\n/g,"\n");
const extract=(name,text=source,indent="  ")=>{const match=text.match(new RegExp(`^${indent}(?:async )?function ${name}\\([\\s\\S]*?^${indent}\\}$`,"m"));assert.ok(match,name);return match[0];};
const base={status:"Набор",type:"КПК",hours:72,price:8500,promoSite:"https://edu-plus.ru/course",password:"private-password",gradeReportUrl:"https://private.test/report"};
const data={collections:{programs:[
  {...base,id:"excel",name:"Практический Excel",promoMessage1:"Освойте Excel для работы!\n\n✅ Формулы и отчёты\n\nКупон на скидку в 15%: OTHER_PARTNER\n\nПодать заявку: https://edu-plus.ru/course",promoMessage2:"SECOND SHOULD NOT WIN"},
  {...base,id:"web",name:"Онлайн-семинар: ИИ в работе преподавателя",type:"ПРО",webinarDate:"2026-09-25",webinarTime:"18:00",promoSite:"web_ai"},
  {...base,id:"fallback",name:"Управление проектами",type:"ППП",promoMessage1:"  ",promoMessage2:"<p>Развивайте навыки управления!</p><p>Купон — ANOTHER_PARTNER</p>"},
  {...base,id:"dop",name:"Знакомство с программированием",type:"ДОП",promoMessage1:'<p>Начните изучать программирование.</p><script>alert("unsafe")</script>'},
  {...base,id:"archived",name:"Архив",status:"АРХИВ"},
  {...base,id:"past",name:"Прошедший вебинар",type:"ПРО",webinarDate:"01.09.2026"},
  {...base,id:"not-enrolling",name:"В работе",status:"В работе"}
]}};
const build=(coupon="PARTNER_42")=>server.buildPartnerSocialMaterials(data,{coupon,password:"secret"},"2026-09-23");
function backendTests(){
 const result=build(),text=JSON.stringify(result);
 assert.equal(result.programs.length,4);
 assert.ok(result.programs.every(program=>program.message.includes("Персональный купон: PARTNER_42")));
 assert.doesNotMatch(text,/OTHER_PARTNER|ANOTHER_PARTNER|SECOND SHOULD NOT WIN|private-password|private\.test|alert|secret|15%/);
 assert.match(result.programs.find(p=>p.id==="fallback").message,/Развивайте навыки управления/);
 assert.match(result.programs.find(p=>p.id==="web").message,/25\.09\.2026 в 18:00 \(мск\)/);
 assert.equal(result.programs.find(p=>p.id==="web").landingUrl,"https://edu-plus.ru/web_ai");
 assert.equal(build("").coupon,"");assert.ok(build("").programs.every(p=>!p.message.includes("Персональный купон:")));
 assert.ok(build("OTHER_USER").programs.every(p=>p.message.includes("OTHER_USER")&&!p.message.includes("PARTNER_42")),"No cross-partner coupon cache");
 for(const url of ["javascript:alert(1)","https://edu-plus.ru.evil.test/","https://user:pass@edu-plus.ru/","https://edu-plus.ru/?p=1&preview=true","Не размещено","evil.test/path"]) assert.equal(server.partnerSocialLandingUrl(url),"");
 assert.equal(server.partnerSocialLandingUrl("/web_ai"),"https://edu-plus.ru/web_ai");
 assert.equal(server.partnerSocialPlainText("A&nbsp;&amp; B &#x1f381; &#999999999;"),"A & B 🎁");
 assert.equal(server.partnerSocialPlainText('<a href="https://edu-plus.ru/x">Ссылка</a>'),"Ссылка — https://edu-plus.ru/x");
 console.log("Partner social server: enrollment/past-event filtering, promo fallback, coupon isolation/replacement, safe URLs, no private fields, text normalization: OK");
}
async function routeTests(){
 const serverSource=fs.readFileSync(path.join(root,"app-server.js"),"utf8").replace(/\r\n/g,"\n");
 let response,identity;
 const context={sendError:(_res,status,message)=>response={status,message},sendJson:(_res,status,payload)=>response={status,payload},
  resolvePartnerPortalContext:async user=>{identity=user;return {data,employee:{coupon:user.login}};},
  buildPartnerSocialMaterials:(data,employee)=>server.buildPartnerSocialMaterials(data,employee,"2026-09-23")};
 vm.createContext(context);vm.runInContext(extract("handlePartnerPortalRequest",serverSource,""),context);
 await context.handlePartnerPortalRequest({method:"GET"},{},{role:"manager"},new URL("https://test/api/partner/social-materials"));assert.equal(response.status,403);assert.equal(identity,undefined);
 const user={role:"partner",login:"OWN_COUPON"};
 await context.handlePartnerPortalRequest({method:"GET"},{},user,new URL("https://test/api/partner/social-materials?coupon=STOLEN&employeeId=other"));
 assert.equal(response.status,200);assert.equal(identity,user);assert.equal(response.payload.coupon,"OWN_COUPON");
 console.log("Partner social route: role enforcement, session-bound identity and ignored spoofed coupon/employee query: OK");
}
async function uiTests(){
 let copied="",renders=0,copyAllowed=true;
 const state={socialMaterials:build(),socialSearch:"",socialType:"",socialProgramId:"excel",socialDrafts:{},socialCopyStatus:"",socialLoading:false,socialError:""};
 const c={state,window:{isSecureContext:true},navigator:{clipboard:{writeText:async text=>{if(!copyAllowed)throw Error("denied");copied=text;}}},
  app:{querySelector:()=>null},document:{},render:()=>renders++,icon:()=>"",renderEmpty:message=>`<p>${message}</p>`,authApi:{request:async()=>build("NEW_COUPON")}};
 vm.createContext(c);vm.runInContext(["escapeHtml","escapeAttr","getSocialMessages","getFilteredSocialPrograms","renderSocialMaterials","loadSocialMaterials","copySocialMessage"].map(name=>extract(name)).join("\n"),c);
 state.socialSearch="excel";assert.equal(c.getFilteredSocialPrograms().length,1);
 state.socialType="ППП";assert.equal(c.getFilteredSocialPrograms().length,0);state.socialType="";state.socialSearch="";
 assert.match(c.renderSocialMaterials(),/Информация для соцсетей/);assert.match(c.renderSocialMaterials(),/PARTNER_42/);
 state.socialDrafts.excel="Отредактировано. Купон PARTNER_42";await c.copySocialMessage();assert.equal(copied,state.socialDrafts.excel);assert.match(state.socialCopyStatus,/скопировано/);
 copyAllowed=false;await c.copySocialMessage();assert.match(state.socialCopyStatus,/Ctrl\+C/);
 await c.loadSocialMaterials();assert.equal(state.socialMaterials.coupon,"NEW_COUPON");assert.equal(state.socialDrafts.excel,undefined,"Coupon change cannot retain old partner text");
 state.socialMaterials=build("");assert.match(c.renderSocialMaterials(),/Персональный купон не назначен/);assert.match(c.renderSocialMaterials(),/data-action="copy-social-message" type="button" disabled/);
 state.socialMaterials=build('<img src=x onerror="alert(1)">');assert.doesNotMatch(c.renderSocialMaterials(),/<img src=x/);
 state.socialProgramId="excel";state.socialDrafts.excel="</textarea><script>unsafe()</script>";assert.doesNotMatch(c.renderSocialMaterials(),/<script>/);
 assert.ok(renders>0);console.log("Partner social UI: search/types, preview, edited copy, clipboard failure, missing/changed coupon, XSS escaping: OK");
}
async function generalMessageTests(){
 let copied="",result=build();
 const id="general:training-center";
 const state={socialMaterials:build(),socialSearch:"",socialType:"",socialProgramId:"",socialDrafts:{},socialCopyStatus:"",socialLoading:false,socialError:""};
 const c={state,window:{isSecureContext:true},navigator:{clipboard:{writeText:async text=>{copied=text;}}},
  app:{querySelector:()=>null},document:{},render:()=>{},icon:()=>"",renderEmpty:message=>`<p>${message}</p>`,authApi:{request:async()=>result}};
 vm.createContext(c);vm.runInContext(["escapeHtml","escapeAttr","getSocialMessages","getFilteredSocialPrograms","renderSocialMaterials","loadSocialMaterials","copySocialMessage"].map(name=>extract(name)).join("\n"),c);
 const html=c.renderSocialMaterials();
 assert.equal(state.socialProgramId,id,"General message is selected by default");
 assert.match(html,/Об учебном центре/);assert.match(html,/Открыть сайт/);assert.match(html,/aria-pressed="true"/);
 const general=c.getSocialMessages()[0];
 assert.equal(general.landingUrl,"https://edu-plus.ru/");
 assert.match(general.message,/Новые знания — новые возможности/);
 assert.match(general.message,/Учебный центр «Цифровизация Плюс»/);
 assert.match(general.message,/https:\/\/edu-plus\.ru\//);
 assert.match(general.message,/Персональный купон: PARTNER_42/);
 assert.doesNotMatch(general.message,/OTHER_PARTNER|ANOTHER_PARTNER|15%/);
 await c.copySocialMessage();assert.equal(copied,general.message);
 state.socialDrafts[id]="Мой текст. https://edu-plus.ru/ Купон PARTNER_42";
 await c.copySocialMessage();assert.equal(copied,state.socialDrafts[id]);
 await c.loadSocialMaterials();assert.equal(state.socialDrafts[id],copied,"Refresh retains the personal edit with unchanged coupon/source");
 state.socialProgramId="excel";assert.match(c.renderSocialMaterials(),/Практический Excel/);
 state.socialProgramId=id;assert.match(c.renderSocialMaterials(),/Мой текст/);
 delete state.socialDrafts[id];await c.copySocialMessage();assert.equal(copied,general.message,"Restore uses the original general text");
 state.socialType="ППП";state.socialSearch="no matching course";
 assert.match(c.renderSocialMaterials(),/Новые знания — новые возможности/);
 assert.equal(state.socialProgramId,id,"Course filters do not hide the general message");
 state.socialMaterials={coupon:"ONLY_GENERAL",programs:[]};
 assert.match(c.renderSocialMaterials(),/ONLY_GENERAL/);await c.copySocialMessage();assert.match(copied,/ONLY_GENERAL/);
 state.socialDrafts[id]="OLD COUPON";result={coupon:"NEW_COUPON",programs:[]};
 await c.loadSocialMaterials();assert.equal(state.socialDrafts[id],undefined);
 await c.copySocialMessage();assert.match(copied,/NEW_COUPON/);assert.doesNotMatch(copied,/OLD COUPON|ONLY_GENERAL|PARTNER_42/);
 state.socialMaterials={coupon:"",programs:[]};
 assert.match(c.renderSocialMaterials(),/data-action="copy-social-message" type="button" disabled/);
 const lastCopied=copied;await c.copySocialMessage();assert.equal(copied,lastCopied);
 state.socialMaterials={coupon:'<img src=x onerror="unsafe()">',programs:[]};
 assert.doesNotMatch(c.renderSocialMaterials(),/<img src=x/);
 state.socialDrafts[id]="</textarea><script>unsafe()</script>";
 assert.doesNotMatch(c.renderSocialMaterials(),/<script>/);
 state.socialMaterials=null;assert.equal(c.getSocialMessages().length,0);
 assert.match(source,/action === "select-social-general"/);
 console.log("Partner general social message: default selection, copy/edit/restore, site link, filter/empty-list availability, coupon isolation/refresh/missing coupon, safe HTML: OK");
}
function serveFixture(){
 const portal={profile:{name:"Тестовый партнёр",tabs:{main:[],contract:[],documents:[]}},payments:{rows:[],summary:{}},materials:{publicUrl:"https://disk.yandex.ru/d/example"}};
 const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="app"></div><output id="fixture-copy-result" aria-label="Проверка копирования"></output><script>
 // Show exactly what the real clipboard API accepted; browser automation may use a separate clipboard.
 const fixtureWriteClipboard=navigator.clipboard.writeText.bind(navigator.clipboard);
 navigator.clipboard.writeText=async text=>{await fixtureWriteClipboard(text);document.getElementById('fixture-copy-result').textContent='Проверка копирования: '+text;};
 window.AIS_AUTH_USER={name:'Тестовый партнёр',login:'test.partner',role:'partner'};
 window.AIS_AUTH_API={appUrl:path=>path,request:async path=>{
  if(path==='api/partner/portal')return ${JSON.stringify(portal)};
  if(path==='api/partner/social-materials')return ${JSON.stringify(build())};
  return {path:'/',items:[]};
 }};history.replaceState({},'','#partner/materials');</script><script src="/partner-app.js"></script></html>`;
 require("node:http").createServer((req,res)=>{
  if(req.url==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(html);}
  else if(["/styles.css","/partner-app.js"].includes(req.url)){res.writeHead(200,{"Content-Type":req.url.endsWith(".css")?"text/css":"text/javascript"});res.end(fs.readFileSync(path.join(root,req.url.slice(1))));}
  else{res.writeHead(404);res.end();}
 }).listen(0,"127.0.0.1",function(){console.log(`Partner social fixture: http://127.0.0.1:${this.address().port}/`);});
}
backendTests();Promise.all([routeTests(),uiTests(),generalMessageTests()]).then(()=>{if(process.argv.includes("--serve"))serveFixture();}).catch(error=>{console.error(error);process.exitCode=1;});
