"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),vm=require("node:vm"),assert=require("node:assert/strict"),crypto=require("node:crypto"),{EventEmitter}=require("node:events");
const up=require("../local-update"),root=fs.mkdtempSync(path.join(os.tmpdir(),"ais-update-gateway-"));
let handler;
const http={createServer(callback){handler=callback;return{listen(){}};},request(){throw Error("Unexpected proxy call");}};
const context={require:name=>name==="http"?http:name==="./local-update.js"?up:require(name),__dirname:root,URL,Buffer,AbortSignal,fetch,setTimeout,clearTimeout,console,process:{env:{PORT:"18881"}}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,"../local-server.js"),"utf8"),context);
function request(method,url,body,origin){
  const req=new EventEmitter();Object.assign(req,{method,url,headers:{host:"127.0.0.1:18881",...(origin?{origin}:{}),"content-type":"application/json"},socket:{remoteAddress:"127.0.0.1"}});
  const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(value){this.body=value;}};
  handler(req,res);if(body!==undefined){req.emit("data",Buffer.from(JSON.stringify(body)));req.emit("end");}return res;
}
try{
  const id=crypto.randomUUID();
  assert.equal(request("GET","/api/local-update/status").status,200);
  assert.equal(request("POST","/api/local-update/status",{id,ready:false}).status,403);
  assert.equal(request("POST","/api/local-update/status",{id,ready:false},"https://attacker.test").status,403);
  assert.equal(request("POST","/api/local-update/status",{id,ready:false},"http://127.0.0.1:18881").status,200);
  assert.equal(up.clientsReady(root),false);
  up.atomicJson(path.join(up.runtimeDir(root),"status.json"),{phase:"installing",updatedAt:Date.now(),label:"Updating"});
  for(const method of ["GET","POST","DELETE"])assert.equal(request(method,"/api/students/save").status,503);
  const maintenancePage=request("GET","/");assert.equal(maintenancePage.status,503);assert.match(maintenancePage.body,/local-update-client.js\?v=maintenance/);
  assert.equal(request("POST","/api/local-update/status",{id,ready:true},"http://127.0.0.1:18881").status,200);
  assert.equal(up.clientsReady(root),true);
  const server=fs.readFileSync(path.join(__dirname,"../app-server.js"),"utf8");
  assert.match(server,/requestHasConfiguredGatewaySecret\(req\).*sendError\(res,404/s);
  assert.match(server,/routeFinished&&responseFinished/);
  const supervisor=fs.readFileSync(path.join(__dirname,"start-lan-system.js"),"utf8");
  assert.match(supervisor,/await localUpdater.recover\(\)/);assert.match(supervisor,/localUpdater\?\.maintenance\(\)/);
  assert.match(supervisor,/await isAisServiceHealthyWithRetry/);
  console.log("PASS: same-origin leases, CSRF rejection, all-method maintenance gate, live progress endpoint, request-drain and supervised health checks");
}finally{if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith("ais-update-gateway-"))fs.rmSync(root,{recursive:true,force:true});}
