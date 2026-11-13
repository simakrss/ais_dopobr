"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const source = fs.readFileSync(path.join(root, "partner-app.js"), "utf8").replace(/\r\n/g, "\n");
const extract = name => source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}$`, "m"))[0];
const rule = selector => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
assert.match(rule(".partner-profile-summary"), /grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(rule(".partner-profile-photo-controls"), /grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(rule(".partner-profile-photo-upload"), /white-space:\s*normal/);
assert.match(rule(".partner-profile-photo-upload > span"), /overflow-wrap:\s*anywhere/);
assert.match(rule(".partner-profile-photo-controls > small"), /overflow-wrap:\s*anywhere/);
assert.match(rule(".partner-profile-photo-upload > .partner-icon"), /flex-shrink:\s*0/);
assert.match(css, /\.partner-profile-summary\s*\{\s*grid-template-columns:\s*72px minmax\(0, 1fr\)/);
const c = {state:{portal:{profile:{name:"Тестовая Мария Александровна",photoAvailable:true,tabs:{main:[]}}},profileTab:"main",profileTabs:["main"],profileDraft:{},profilePhotoRevision:1},
  PROFILE_TABS:[{id:"main",label:"Основное"}],authApi:{appUrl:()=>'/photo.svg'},renderEmpty:()=>"Данные профиля",renderProfileField:()=>"",renderDocumentsModal:()=>""};
vm.createContext(c);vm.runInContext(["escapeHtml","escapeAttr","icon","renderProfile"].map(extract).join("\n"),c);
const withPhoto=c.renderProfile();assert.match(withPhoto,/Заменить фотографию/);assert.match(withPhoto,/Файл сохраняется автоматически/);
c.state.portal.profile.photoAvailable=false;
const withoutPhoto=c.renderProfile();assert.match(withoutPhoto,/Загрузить фотографию/);
c.state.profilePhotoUploading=true;assert.match(c.renderProfile(),/Загрузка\.\.\./);assert.match(c.renderProfile(),/data-partner-photo-input[^>]+disabled/);
console.log("Partner summary: constrained grid, wrapping labels/help/name, stable icon, mobile grid and upload states: OK");
if(process.argv.includes("--serve")) {
 const summary=html=>html.match(/<aside class="partner-profile-summary partner-panel">[\s\S]*?<\/aside>/)[0];
 const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Проверка профиля партнёра</title><body style="margin:0;padding:12px"><h2>Карточки шириной 203 и 240 px</h2><div style="display:flex;flex-wrap:wrap;gap:16px"><div style="width:203px">${summary(withPhoto)}</div><div style="width:240px">${summary(withoutPhoto)}</div></div><h2>Адаптивный профиль</h2>${withPhoto}</body></html>`;
 require("node:http").createServer((req,res)=>{
  if(req.url==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(html);}
  else if(req.url==="/styles.css"){res.writeHead(200,{"Content-Type":"text/css"});res.end(fs.readFileSync(path.join(root,"styles.css")));}
  else if(req.url==="/photo.svg"){res.writeHead(200,{"Content-Type":"image/svg+xml"});res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112"><rect width="112" height="112" fill="#dcefe8"/><circle cx="56" cy="42" r="18" fill="#4e8072"/><path d="M20 110V85a36 32 0 0 1 72 0v25" fill="#4e8072"/></svg>');}
  else{res.writeHead(404);res.end();}
 }).listen(0,"127.0.0.1",function(){console.log(`Partner summary fixture: http://127.0.0.1:${this.address().port}/`);});
}
