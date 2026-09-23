"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name, text = source) {
  const match = text.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  \\}$`, "m"));
  assert.ok(match, name); return match[0];
}
const functions = ["getAuthUserEditorRecord", "getAuthEmployeeById", "renderAuthEmployeeSyncSummary", "getAuthRoleLabel", "renderAdminUsersPanel", "renderAuthUsersToolbar", "renderAuthUserManagementContent", "renderAuthUsersRows", "getFilteredAuthUsers", "refreshAuthUsersList", "fitAuthUsersTableToViewport", "renderAuthUserEditorDialog", "renderAuthUserEditor", "collectAuthUserEditorDraft", "openAuthUserEditor", "closeAuthUserEditor", "bindAuthUserManagement", "saveAuthUser"].map(name => extract(name)).join("\n");
const users = [
  {id:"a",login:"admin",name:"Администратор",role:"admin",status:"active",email:"admin@example.test",phone:"",lastLoginAt:"2026-09-20T00:00:00Z"},
  {id:"b",employeeId:"e1",login:"teacher10",name:"Яковлев Пётр",role:"partner",status:"active",email:"partner@example.test",phone:"+79001234567",lastLoginAt:"2026-09-23T00:00:00Z"},
  {id:"c",login:"teacher2",name:"Борисова Анна",role:"manager",status:"blocked",email:"manager@example.test",phone:"",lastLoginAt:""}
];
const employees = [
  {id:"e1",name:"Яковлев Пётр",login:"teacher10",defaultRole:"partner",defaultStatus:"active",email:"partner@example.test",phone:"+79001234567",section:"Действующие договора"},
  {id:"free",name:"Новый сотрудник",login:"new.employee",defaultRole:"manager",defaultStatus:"active",email:"new@example.test",phone:"",section:"Действующие договора"}
];
function createState() { return {
  authUsers: structuredClone(users), authEmployees: structuredClone(employees), authEmployeeSync:null,authUsersLoaded:true,authUsersLoading:false,authUsersError:"",
  authUserEditorId:"",authUserEmployeeSelection:null,authUserEditorDraft:null,authUserEditorBaseline:null,authUserSaving:false,
  authUsersFilters:{query:"",role:"",status:"",source:""},authUsersSort:{key:"name",direction:"asc"}
}; }
function unitTests() {
  const state = createState(), escapeHtml = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const c = { state, escapeHtml, escapeAttr:escapeHtml, getCurrentAuthUser:()=>({id:"a"}),formatDateTimeRu:value=>value };
  vm.createContext(c); vm.runInContext(functions,c);
  const ids = () => Array.from(c.getFilteredAuthUsers(),user=>user.id);
  assert.deepEqual(ids(),["a","c","b"]);
  state.authUsersFilters.query="петр teacher10";assert.deepEqual(ids(),["b"]);
  state.authUsersFilters.query="EXAMPLE.TEST";assert.equal(ids().length,3);
  state.authUsersFilters.query="1234567";assert.deepEqual(ids(),["b"]);
  state.authUsersFilters={query:"",role:"manager",status:"blocked",source:"manual"};assert.deepEqual(ids(),["c"]);
  state.authUsersFilters.source="employee";assert.deepEqual(ids(),[]);
  state.authUsersFilters={query:"",role:"",status:"",source:""};
  state.authUsersSort={key:"login",direction:"asc"};assert.deepEqual(ids(),["a","c","b"]);
  state.authUsersSort.direction="desc";assert.deepEqual(ids(),["b","c","a"]);
  state.authUsersSort={key:"lastLoginAt",direction:"desc"};assert.deepEqual(ids(),["b","a","c"]);
  state.authUsersSort.direction="asc";assert.deepEqual(ids(),["a","b","c"],"Never logged in stays last");
  assert.deepEqual(state.authUsers,users,"Search and sort never mutate records");
  state.authUserEditorId="new";state.authUserEmployeeSelection="free";
  assert.equal(c.getAuthUserEditorRecord().role,"partner","New employee is partner even when old server default is manager");
  state.authUserEditorId="c";assert.equal(c.getAuthUserEditorRecord().role,"manager","Existing role preserved");
  state.authUserEmployeeSelection=null;state.authUserEditorId="new";state.authUserEditorDraft={id:"",role:"manager",employeeId:"free"};
  assert.equal(c.getAuthUserEditorRecord().role,"manager","Explicit administrator choice preserved");
  assert.doesNotMatch(c.renderAuthUserManagementContent(),/<form class="auth-user-editor"/);
  assert.match(c.renderAuthUserEditorDialog(),/role="dialog" aria-modal="true"/);
  state.authUsers[0].name='<img src=x onerror=alert(1)>';
  assert.doesNotMatch(c.renderAuthUsersRows(),/<img src=x/);
  const php = fs.readFileSync(path.join(root,"gateway.php"),"utf8");
  assert.match(php,/'defaultRole' => 'partner'/);
  assert.match(php,/'role' => 'partner',[\s\S]{0,110}'employeeRoleOverride' => 'partner'/);
  assert.match(php,/\$beforePrivate\['role'\]\s*\?\? 'partner'/);
  console.log("Auth users interface: filters/search/sort, defaults, existing role preservation, modal, escaping and PHP parity: OK");
}
async function checkPartnerRouting() {
  const scripts = [], noop=()=>{};
  const c={window:{},applyDatabaseDemoMode:noop,setAuthenticatedSession:noop,request:noop,appUrl:noop,redirectToLogin:noop,renderStartupFailure:noop,installAuthenticatedFetch:noop,startDatabaseDemoModeHeartbeat:noop,renderLoading:noop,databaseDemoModeEnabled:false,loadScript:async name=>scripts.push(name)};
  vm.createContext(c);vm.runInContext(extract("startApplication",fs.readFileSync(path.join(root,"auth-bootstrap.js"),"utf8").replace(/\r\n/g,"\n")),c);
  await c.startApplication({role:"partner",employeeId:"test"},"2026-10-01");
  assert.deepEqual(scripts,["partner-app.js"],"Employee / partner must load only the partner cabinet");
  console.log("Partner role routes to partner-app.js, not administrator application: OK");
}
async function checkSaveLifecycle() {
  const state = createState();
  state.authUserEditorId = "b";
  const fields = {...users[1], password:""}, button = {}, fieldset = {};
  const form = {dataset:{userId:"b"}, querySelector:selector=>selector === "fieldset" ? fieldset : button};
  let requests = 0, finishRequest;
  const c = {state, isAdminUser:()=>true, getCurrentAuthUser:()=>({id:"a"}), render:()=>{},
    FormData:class {get(key) {return fields[key] ?? "";}},
    authRequest:async(_url,request)=>{
      requests++;
      const payload = JSON.parse(request.body);
      assert.equal(payload.role,"partner");
      assert.equal(payload.email,"retained@example.test");
      assert.equal(payload.password,undefined,"Linked employee credentials are never submitted");
      return await new Promise((resolve,reject)=>{finishRequest={resolve,reject};});
    }
  };
  vm.createContext(c);vm.runInContext(functions,c);
  fields.email="retained@example.test";
  const event={preventDefault:()=>{},currentTarget:form};
  const failed = c.saveAuthUser(event);
  assert.equal(state.authUserSaving,true);
  assert.equal(fieldset.disabled,true);
  await c.saveAuthUser(event);
  assert.equal(requests,1,"Repeated submit ignored during save");
  finishRequest.reject(Error("Temporary test failure"));await failed;
  assert.equal(state.authUserEditorId,"b","Keep dialog after failed save");
  assert.equal(state.authUserEditorDraft.email,fields.email,"Preserve draft on error");
  assert.equal(state.authUserSaving,false);
  assert.match(state.authUsersError,/Temporary test failure/);
  const saved = c.saveAuthUser(event);
  finishRequest.resolve({user:{...users[1],email:fields.email}});await saved;
  assert.equal(state.authUserEditorId,"","Successful save closes editor");
  assert.equal(state.authUserEditorDraft,null);
  assert.equal(state.authUsers.find(user=>user.id === "b").email,fields.email);
  console.log("Auth user save: duplicate prevention, error/draft preservation and successful close: OK");
}
function serveFixture() {
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Пользователи и роли — проверка</title><link rel="stylesheet" href="/styles.css"><body style="padding:16px"><h1 style="font-size:20px;margin:0 0 10px">Пользователи и роли — тестовый список</h1><label><input id="simulate-error" type="checkbox"> Проверять ошибку сохранения</label><output id="saved" role="status"></output><div id="fixture"></div><script>
  const state=${JSON.stringify(createState())};
  state.authUsers.push(...Array.from({length:60},(_,index)=>({id:'test'+index,login:'test'+index,name:'Сотрудник '+(index+1),role:'partner',status:index%3?'active':'blocked',employeeId:'unavailable-'+index,email:'test'+index+'@example.test',lastLoginAt:''})));
  const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const escapeAttr=escapeHtml,formatDateTimeRu=value=>new Date(value).toLocaleString('ru-RU');
  let authenticatedUser={id:'a',role:'admin'}, decision='cancel';
  const getCurrentAuthUser=()=>authenticatedUser,isAdminUser=()=>true;
  const scheduleMainRegistryTableViewportFit=()=>requestAnimationFrame(fitAuthUsersTableToViewport);
  const chooseUnsavedChangesAction=async()=>decision;
  const authRequest=async(_url,request)=>{
    if(document.getElementById('simulate-error').checked)throw Error('Тестовая ошибка соединения');
    const data=JSON.parse(request.body),employee=state.authEmployees.find(item=>item.id===data.employeeId);
    const user={...data,id:data.id||'created',...(employee?{login:employee.login,name:employee.name}:{})};
    document.getElementById('saved').textContent='Сохранено: '+user.name+' · '+getAuthRoleLabel(user.role);
    return {user};
  };
  ${functions}
  const render=()=>{document.getElementById('fixture').innerHTML=renderAdminUsersPanel()+(state.authUserEditorId?renderAuthUserEditorDialog():'');bindAuthUserManagement();scheduleMainRegistryTableViewportFit();};
  render();window.addEventListener('resize',fitAuthUsersTableToViewport);
  </script></html>`;
  require("node:http").createServer((req,res)=>{
    if(req.url==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(html);}
    else if(req.url==="/styles.css"){res.writeHead(200,{"Content-Type":"text/css"});res.end(fs.readFileSync(path.join(root,"styles.css")));}
    else{res.writeHead(404);res.end();}
  }).listen(0,"127.0.0.1",function(){console.log(`Users fixture: http://127.0.0.1:${this.address().port}/`);});
}
unitTests();
Promise.all([checkPartnerRouting(),checkSaveLifecycle()]).then(()=>{if(process.argv.includes("--serve"))serveFixture();}).catch(error=>{console.error(error);process.exitCode=1;});
