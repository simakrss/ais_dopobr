"use strict";
// Synthetic records and IMAP replies only; never reads live mail or saves attachments.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root,"app.js"),"utf8").replace(/\r\n/g,"\n");
const server = fs.readFileSync(path.join(root,"app-server.js"),"utf8").replace(/\r\n/g,"\n");
function extract(source, name, indent="") {
  const match=source.match(new RegExp(`^${indent}(?:async )?function ${name}\\([\\s\\S]*?^${indent}}`,"m"));
  assert.ok(match,name);return match[0];
}
const collections = {programs:[{id:"p",name:"Программа",commissionSetId:"c",commissionChair:"Прежний Председатель"},
  {id:"other",name:"Другая программа",commissionChair:"Другой Председатель"}],
  commissionSets:[{id:"c",commissionChair:"Петров Пётр Петрович, профессор"}],
  contracts:[{name:"Петров Петр Петрович",email:"CHAIR@example.test"},{name:" Петров  Пётр Петрович ",email:"chair@example.test; second@example.test"},
    {name:"Другой Председатель",email:"unrelated@example.test"},{name:"Прежний Председатель",email:"old@example.test"}]};
const ui = vm.createContext({state:{data:{collections}},applyProgramCommissionSetToProgram:(program,set)=>({...program,...set})});
vm.runInContext(["normalizeProgramName","getStudentContextProgram","getProgramCommissionSetById","resolveProgramCommissionRecord","normalizeEmployeeActPersonName","getStudentMailboxChair"].map(name=>extract(app,name,"  ")).join("\n"),ui);
const plain=value=>JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(ui.getStudentMailboxChair({programId:"p",program:"Другая программа"})),{name:"Петров Пётр Петрович",emails:["chair@example.test","second@example.test"],warning:""});
assert.equal(ui.getStudentMailboxChair({program:"Программа"}).emails.length,2);
assert.equal(ui.getStudentMailboxChair({programId:"missing",program:"Программа"}).emails.length,0,"Do not substitute a different program when a saved ID cannot be resolved");
collections.programs.push({id:"ambiguous",name:"Программа"});
assert.equal(ui.getStudentMailboxChair({program:"Программа"}).emails.length,0);
assert.deepEqual(plain(ui.getStudentMailboxChair({programId:"other"}).emails),["unrelated@example.test"],"Legacy commission fields work too");
collections.contracts[2].email="not an email";
assert.match(ui.getStudentMailboxChair({programId:"other"}).warning,/Email/);

let commands=[],closed=0,studentUids=[],chairUids=[],previewUids=[],fixtures=new Map(),failSearch=false;
const client={command:async command=>{commands.push(command);if(failSearch)throw Error("IMAP unavailable");const ids=command.includes("OR FROM \"learner@example.test\" OR TO")?studentUids:chairUids;return Buffer.from(`* SEARCH ${ids.join(" ")}\r\nA OK\r\n`);},close:async()=>{closed++;}};
const ctx=vm.createContext({Buffer,Date,Set,Map,normalizeMailboxId:(value,fallback)=>value||fallback,
  getStudentDocumentMailboxSettings:()=>({id:"test",label:"Test",login:"inbox@example.test"}),connectStudentApplicationsImap:async()=>client,
  fetchImapMessagePreviews:async(_client,ids)=>{previewUids=plain(ids);return ids.map(uid=>fixtures.get(uid)).filter(Boolean);},
  safeStudentMailboxAttachmentName:(value,fallback)=>value||fallback});
vm.runInContext(["formatImapDate","addDaysToIsoDate","quoteImapValue","parseImapSearchUids","parseStudentMailboxSearchBody","studentMailboxMessageIsFromChair","queryStudentMailboxMessages"].map(name=>extract(server,name)).join("\n"),ctx);
const body={email:"learner@example.test",chairEmails:["chair@example.test","second@example.test"],dateFrom:"2026-01-01",dateTo:"2026-09-24"};
const msg=(uid,from,fileName="Протокол.pdf")=>({uid,from,to:"inbox@example.test",cc:"",subject:"Документы",text:"",date:"2026-09-24",attachments:[{fileName,contentType:"application/pdf",size:123,bytes:Buffer.alloc(0)}]});
async function main(){
  assert.throws(()=>ctx.parseStudentMailboxSearchBody({email:"learner@example.test\r\nLOGOUT"}),/Некорректный email/);
  assert.throws(()=>ctx.parseStudentMailboxSearchBody({...body,chairEmails:['x@example.test"\r\nLOGOUT']}),/Email председателя/);
  assert.throws(()=>ctx.parseStudentMailboxSearchBody({}),/Укажите email/);
  assert.equal(ctx.parseStudentMailboxSearchBody({chairEmails:body.chairEmails}).chairEmails.length,2,"Chair-only search works without a learner email");
  studentUids=["1","3"];chairUids=["2","3","4","5"];
  fixtures=new Map([msg("1","Learner <learner@example.test>"),msg("2","Chair <CHAIR@example.test>","Протокол_Иванова.pdf"),msg("3","second@example.test"),msg("4","notchair@example.test"),msg("5",'"chair@example.test" <other@example.test>')].map(m=>[m.uid,m]));
  let result=await ctx.queryStudentMailboxMessages(body);
  assert.deepEqual(plain(result.messages.map(m=>[m.uid,m.fromChair])),[["3",true],["2",true],["1",false]]);
  assert.equal(result.messages[1].attachments[0].name,"Протокол_Иванова.pdf");
  assert.equal(closed,1);assert.equal(new Set(previewUids).size,previewUids.length);
  assert.match(commands[0],/SINCE .* BEFORE .* OR FROM "learner@example.test" OR TO "learner@example.test" CC "learner@example.test"$/);
  assert.match(commands[1],/OR FROM "chair@example.test" FROM "second@example.test"$/);
  assert.doesNotMatch(commands[1],/TO |CC /,"Chair search is inbound only");
  result=await ctx.queryStudentMailboxMessages({...body,query:"Иванова"});
  assert.deepEqual(plain(result.messages.map(m=>m.uid)),["2"],"Search attachment names as well as subject/body");
  commands=[];await ctx.queryStudentMailboxMessages({...body,entityType:"contract"});
  assert.equal(commands.length,1,"Employee documents do not include commission mail");
  commands=[];await ctx.queryStudentMailboxMessages({...body,chairEmails:[]});assert.equal(commands.length,1,"Toggle off keeps original search");
  commands=[];await ctx.queryStudentMailboxMessages({...body,email:""});assert.equal(commands.length,1);assert.doesNotMatch(commands[0],/TO |CC /,"No unfiltered inbox query without learner email");
  studentUids=Array.from({length:120},(_,i)=>String(i+1));chairUids=Array.from({length:150},(_,i)=>String(i+200));
  result=await ctx.queryStudentMailboxMessages(body);assert.equal(previewUids.length,200);assert.ok(previewUids.includes("21")&&previewUids.includes("120"));assert.equal(result.truncated,true);assert.equal(result.total,270);
  failSearch=true;const before=closed;await assert.rejects(ctx.queryStudentMailboxMessages(body),/IMAP unavailable/);assert.equal(closed,before+1,"Always close IMAP on errors");
  console.log("PASS: current/legacy commission, exact employee match, multiple emails, inbound chair mail, combined search, UID deduplication, independent limits, attachments, opt-out and IMAP safety");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
