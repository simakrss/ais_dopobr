"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const stateKey = `layout-test-${crypto.randomBytes(8).toString("hex")}`;
process.env.AIS_SHARED_STATE_KEY = stateKey;
const root = path.resolve(__dirname, ".."), backend = require(path.join(root, "app-server.js"));
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const extract = name => {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  \\}$`, "m"));
  assert.ok(match, name); return match[0];
};
const functions = ["captureInterfaceLayout", "readInterfaceLayoutPending", "storeInterfaceLayoutPending", "queueInterfaceLayoutSave", "mergeVisibleInterfaceOrder", "applyInterfaceLayout", "refreshInterfaceLayoutDom", "synchronizeInterfaceLayout", "getOrderedTabs", "persistTableSettings", "persistTabOrders", "persistNavItemOrder", "persistDashboardStudentStatusOrder", "resetNavItemOrder", "resetDashboardStudentStatusOrder"].map(extract).join("\n");
const clone = value => JSON.parse(JSON.stringify(value));
function client(shared, local = true, stored = new Map()) {
  let notices = 0, renders = 0;
  const c = {
    state: { navItemOrder: ["programs", "settings", "students"], dashboardStudentStatusOrder: ["Учится", "На зачисление"],
      tabOrders: {"program-card": ["site", "main"]}, tableSettings: {students:{order:["name","startDate"],widths:{name:160},pageSize:50}}, view:"students", modal:null },
    localStorage: { getItem:key=>stored.get(key) || null, setItem:(key,value)=>stored.set(key,value), removeItem:key=>stored.delete(key) },
    START_VIEW_KEY:"start", NAV_ITEM_ORDER_KEY:"nav", DASHBOARD_STATUS_ORDER_KEY:"dashboard", TABLE_SETTINGS_KEY:"tables", TAB_ORDER_SETTINGS_KEY:"tabs", INTERFACE_LAYOUT_PENDING_KEY:"pending",
    TABLE_PAGE_SIZE_OPTIONS:[25,50,100,200], navItems:[{id:"dashboard"},{id:"students"},{id:"programs"},{id:"settings"}],
    isDatabaseDemoMode:()=>false, AbortSignal, console:{warn:()=>{}},
    window:{setTimeout:()=>1,clearTimeout:()=>{}},
    document:{visibilityState:"visible",querySelector:()=>null,querySelectorAll:()=>[],activeElement:null},
    showDocumentGenerationNotice:()=>notices++, render:()=>renders++,closeNavItemMenu:()=>{},
    getOrderedNavItems:()=>[],getOrderedDashboardStudentStatuses:()=>[],
    authRequest:async(_url, options)=>{
      if (shared.offline) throw Error("offline");
      if (options?.body) {
        const body = JSON.parse(options.body);
        backend.validateSharedInterfaceLayout(body.changes);
        if (body.initialize && !shared.initialized) {
          shared.preferences = {...body.changes, ...shared.preferences}; shared.initialized = true;
        } else if (!body.initialize) Object.assign(shared.preferences, body.changes);
      }
      if (shared.hold) await shared.hold;
      return clone({preferences:shared.preferences, initialized:shared.initialized, canInitialize:local});
    }
  };
  vm.createContext(c); vm.runInContext(functions,c);
  c.interfaceLayoutSync = {snapshot:c.captureInterfaceLayout(),migration:c.captureInterfaceLayout(),pending:c.readInterfaceLayoutPending(),running:false,needsRender:false};
  return Object.assign(c, {getNotices:()=>notices, getRenders:()=>renders, stored});
}
async function clientTests() {
  const shared = {preferences:{},initialized:false}, a = client(shared), b = client(shared,false);
  // The website never seeds its own browser defaults ahead of the local installation.
  await b.synchronizeInterfaceLayout({startup:true}); assert.equal(shared.initialized,false);
  assert.deepEqual(clone(b.state.navItemOrder),[]);
  await a.synchronizeInterfaceLayout({startup:true}); assert.equal(shared.initialized,true);
  await b.synchronizeInterfaceLayout({startup:true});
  assert.deepEqual(clone(b.state.tableSettings),clone(a.state.tableSettings));
  assert.deepEqual(clone(b.state.tabOrders),clone(a.state.tabOrders));
  const stale = client(shared); stale.interfaceLayoutSync.migration.nav=["dashboard"];
  await stale.synchronizeInterfaceLayout({startup:true});
  assert.deepEqual(shared.preferences.nav,["programs","settings","students"],"Stale local copy must not overwrite initial layout");
  a.state.navItemOrder=["students","settings","programs"]; a.persistNavItemOrder();
  b.state.tableSettings.students.widths.name=240; b.persistTableSettings();
  await a.synchronizeInterfaceLayout(); await b.synchronizeInterfaceLayout(); await a.synchronizeInterfaceLayout();
  assert.equal(a.state.tableSettings.students.widths.name,240);
  assert.deepEqual(clone(b.state.navItemOrder),["students","settings","programs"],"Independent concurrent changes merge");
  assert.deepEqual(clone(a.mergeVisibleInterfaceOrder(["programs","settings","students"],["students","programs"])),["students","settings","programs"],"Hidden administrator items retain position");
  // Resets are explicit tombstones, not missing values which old caches can resurrect.
  delete a.state.tableSettings.students.widths.name; a.persistTableSettings();
  delete a.state.tabOrders["program-card"]; a.persistTabOrders();
  a.resetNavItemOrder(); a.resetDashboardStudentStatusOrder();
  await a.synchronizeInterfaceLayout(); await b.synchronizeInterfaceLayout();
  assert.equal(shared.preferences["table:students:width:name"],null);
  assert.equal(b.state.tableSettings.students.widths?.name,undefined);
  assert.equal(b.state.tabOrders["program-card"],undefined);
  assert.deepEqual(clone(b.state.navItemOrder),[]); assert.deepEqual(clone(b.state.dashboardStudentStatusOrder),[]);
  // Offline changes survive a browser restart and flush automatically on reconnection.
  shared.offline=true;
  a.state.navItemOrder=["programs","students"];a.persistNavItemOrder();await a.synchronizeInterfaceLayout();
  assert.equal(a.getNotices(),1);await a.synchronizeInterfaceLayout();assert.equal(a.getNotices(),1);
  const restarted=client(shared,true,a.stored);
  shared.offline=false;await restarted.synchronizeInterfaceLayout();await b.synchronizeInterfaceLayout();
  assert.deepEqual(clone(b.state.navItemOrder),["programs","students"]);assert.deepEqual(clone(restarted.interfaceLayoutSync.pending),{});
  // A newer local action while a save is in flight must remain queued.
  let release;shared.hold=new Promise(resolve=>release=resolve);
  a.state.navItemOrder=["students"];a.persistNavItemOrder();
  const inFlight=a.synchronizeInterfaceLayout();await Promise.resolve();
  a.state.navItemOrder=["programs"];a.persistNavItemOrder();release();shared.hold=null;
  await inFlight;await a.synchronizeInterfaceLayout();assert.deepEqual(shared.preferences.nav,["programs"]);
  // No repaint may destroy an open card/draft or interrupt a column resize.
  b.state.modal={draft:"unsaved text"};b.interfaceLayoutSync.needsRender=true;
  const before=b.getRenders();b.refreshInterfaceLayoutDom();assert.equal(b.getRenders(),before);assert.equal(b.state.modal.draft,"unsaved text");
  b.document.querySelector=selector=>selector.includes("is-resizing-column")?{}:null;
  const preferencesBefore=clone(shared.preferences);await b.synchronizeInterfaceLayout();assert.deepEqual(shared.preferences,preferencesBefore);
  b.document.querySelector=()=>null;b.isDatabaseDemoMode=()=>true;
  b.state.navItemOrder=["dashboard"];b.persistNavItemOrder();await b.synchronizeInterfaceLayout();assert.deepEqual(shared.preferences,preferencesBefore);
  // Real node movement preserves draft fields and the button event handlers.
  const nodes=[{dataset:{orderableTab:"main",orderableTabDefaultIndex:"0"}},{dataset:{orderableTab:"site",orderableTabDefaultIndex:"1"}}];
  const parent={children:[...nodes],appendChild(node){this.children=this.children.filter(child=>child!==node);this.children.push(node);}};
  nodes.forEach(node=>node.parentElement=parent);
  b.state.tabOrders={"program-card":["site","main"]};
  b.document.querySelectorAll=selector=>selector==="[data-orderable-tabs]"?[{dataset:{orderableTabs:"program-card"},querySelectorAll:()=>nodes}]:[];
  b.refreshInterfaceLayoutDom();assert.deepEqual(parent.children,[nodes[1],nodes[0]]);assert.equal(b.state.modal.draft,"unsaved text");
  console.log("Browser clients: initial local migration, two-way sync, concurrent keys, hidden tabs, resets, offline/restart, live forms, drag/resize and demo isolation: OK");
}
function validationTests() {
  backend.validateSharedInterfaceLayout({nav:[],"tabs:student-card":["main","documents"],"table:students:width:name":150,startView:"students","table:students:expandedGroups":["pro:Программа"],"table:students:pageSize":50});
  for(const value of [[],null,{password:"secret"},{"tabs:__proto__":[]},{nav:"students"},{nav:[{}]},{startView:"https://example.test"},{"table:students:width:name":-1},{"table:students:width:name":"150"}]) {
    assert.throws(()=>backend.validateSharedInterfaceLayout(value),e=>e.statusCode===400);
  }
  assert.match(source,/window\.setInterval\(\(\) => void synchronizeInterfaceLayout\(\), 5000\)/);
  console.log("Layout schema rejects credentials, paths, prototype keys and malformed values: OK");
}
async function mysqlTests() {
  const pool=require("./migrate-shared-auth-roles.js").createPool();
  try {
    assert.equal((await backend.readSharedInterfaceLayout(pool)).initialized,false);
    // A deliberate website change before migration wins over the old local cache.
    await backend.saveSharedInterfaceLayout({"tabs:program-card":["site","main"]},false,pool);
    assert.equal((await backend.readSharedInterfaceLayout(pool)).initialized,false);
    await backend.saveSharedInterfaceLayout({nav:["programs","students"],"tabs:program-card":["main","site"],"table:students:width:name":180},true,pool);
    await backend.saveSharedInterfaceLayout({nav:["stale"]},true,pool);
    let result=await backend.readSharedInterfaceLayout(pool);
    assert.equal(result.initialized,true);assert.deepEqual(result.preferences.nav,["programs","students"]);
    assert.deepEqual(result.preferences["tabs:program-card"],["site","main"]);
    await Promise.all([
      backend.saveSharedInterfaceLayout({nav:["students","programs"]},false,pool),
      backend.saveSharedInterfaceLayout({"table:students:width:name":250},false,pool)
    ]);
    result=await backend.readSharedInterfaceLayout(pool);
    assert.deepEqual(result.preferences.nav,["students","programs"]);assert.equal(result.preferences["table:students:width:name"],250);
    const php=process.env.AIS_TEST_PHP;
    if (php) {
      const run=require("node:child_process").spawnSync(php,["-d",`extension_dir=${path.join(path.dirname(php),"ext")}`,"-d","extension=mbstring","-d","extension=pdo_mysql","-f",path.join(__dirname,"test-shared-interface-layout.php"),"--","--mysql"],{encoding:"utf8",env:process.env,timeout:60000});
      assert.equal(run.status,0,run.stderr||run.stdout);console.log(run.stdout.trim());
      result=await backend.readSharedInterfaceLayout(pool);
      assert.deepEqual(result.preferences.nav,["programs","students"]);assert.equal(result.preferences["table:students:width:name"],null);
    }
    await assert.rejects(backend.saveSharedInterfaceLayout({nav:["bad"],password:"no"},false,pool));
    assert.notDeepEqual((await backend.readSharedInterfaceLayout(pool)).preferences.nav,["bad"],"Invalid batch cannot partially write");
    console.log("MySQL: initial import, explicit changes preserved, stale migrations, concurrent patches, validation atomicity and PHP/Node parity: OK");
  } finally {
    assert.match(stateKey,/^layout-test-[a-f0-9]{16}$/);
    await pool.query("DELETE FROM ais_interface_layout WHERE state_key = ?",[stateKey]);await pool.end();
  }
}
validationTests();clientTests().then(()=>process.argv.includes("--mysql")?mysqlTests():null).catch(error=>{console.error(error);process.exitCode=1;});
