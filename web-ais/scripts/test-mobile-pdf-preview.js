"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const root=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),viewer=fs.readFileSync(path.join(root,"pdf-preview.js"),"utf8");
const start=app.indexOf("  function showGeneratedDocumentPreview("),end=app.indexOf("  function documentEmailMessageContainsHtml",start);
const preview=app.slice(start,end);
assert.ok(start>0&&end>start);
assert.match(preview,/data-generated-pdf-viewer/);assert.doesNotMatch(preview,/#toolbar=1/);
assert.match(preview,/previewBlob = saved.blob/);assert.match(preview,/startPdfPreview\(\)/);
assert.match(viewer,/4000000/);assert.match(viewer,/renderTask\?\.cancel/);assert.match(viewer,/loading\?\.destroy/);
assert.match(viewer,/download\.href = url/);assert.match(viewer,/getDocument\(\{data, isEvalSupported: false/);
const files=["pdf-preview.js","pdfjs-core.js","pdfjs-worker.js","pdfjs-license.html"];
const updater=require("../local-update");for(const file of files)assert.ok(updater.FILES.includes(file));
for(const file of files)assert.match(file,/^[a-z][a-z0-9-]*\.(?:js|css|html)$/,"New assets must pass the already-installed updater path policy");
console.log("Mobile PDF: canvas viewer, single-page memory cap, cancellation, updated content after editing, download links and signed assets OK");
if(process.argv.includes("--serve") || process.argv.includes("--browser")) (async()=>{
  const {PDFDocument,StandardFonts,rgb}=require("../vendor/pdf-lib.min.js");
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let n=1;n<=2;n++){const page=pdf.addPage([595,842]);page.drawRectangle({x:15,y:15,width:565,height:812,borderWidth:3,borderColor:rgb(0,.45,.4)});page.drawText(`MOBILE PDF TEST - PAGE ${n}`,{x:45,y:730,size:22,font});page.drawText("12345 / 23.09.2026",{x:45,y:675,size:20,font});}
  const bytes=Buffer.from(await pdf.save()).toString("base64");
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><script>
    const APP_BASE_URL=new URL("/",location.href);const normalizeDocumentGenerationFormat=x=>x;
    const escapeHtml=x=>String(x).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");const escapeAttr=escapeHtml;
    ${preview}
    showGeneratedDocumentPreview(new Blob([Uint8Array.from(atob("${bytes}"),x=>x.charCodeAt(0))],{type:"application/pdf"}),{title:"Тест просмотра",fileName:"Проверка.pdf",outputFormat:"pdf",editorAvailable:false,readOnly:true});
  </script></body></html>`;
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,"http://localhost").pathname.slice(1);
    if(!name){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});return res.end(html);}
    if(![...files,"styles.css"].includes(name)){res.writeHead(404);return res.end();}
    res.writeHead(200,{"Content-Type":name.endsWith(".css")?"text/css":"text/javascript"});fs.createReadStream(path.join(root,name)).pipe(res);
  });
  if(!process.argv.includes("--browser")){server.listen(18893,"127.0.0.1",()=>console.log("Synthetic PDF preview fixture: http://127.0.0.1:18893"));return;}
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  try {
    const page=await browser.newPage({isMobile:true,hasTouch:true,deviceScaleFactor:3}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>Object.defineProperty(navigator,'pdfViewerEnabled',{get:()=>false}));
    for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1366,height:900}]){
      await page.setViewportSize(viewport);await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForSelector('[data-generated-pdf-viewer][data-pdf-state="ready"]');
      assert.equal(await page.locator('[data-pdf-page]').textContent(),'1 / 2');
      assert.ok(await page.locator('[data-pdf-canvas]').evaluate(c=>c.width>0&&c.height>0&&c.width*c.height<=4000000));
      assert.match(await page.locator('[data-pdf-download]').getAttribute('href'),/^blob:/);
      assert.equal(await page.locator('[data-pdf-download]').getAttribute('download'),'Проверка.pdf');
      await page.click('[data-pdf-next]');await page.waitForFunction(()=>document.querySelector('[data-pdf-page]').textContent==='2 / 2');
      const width=await page.locator('[data-pdf-canvas]').evaluate(c=>parseFloat(c.style.width));
      await page.click('[data-pdf-plus]');await page.waitForFunction(w=>parseFloat(document.querySelector('[data-pdf-canvas]').style.width)>w,width);
      await page.click('[data-pdf-minus]');await page.waitForFunction(w=>Math.abs(parseFloat(document.querySelector('[data-pdf-canvas]').style.width)-w)<1,width);
      await page.click('.modal-head [data-action="cancel-generated-document-preview"]');
      assert.equal(await page.locator('[data-generated-document-preview]').count(),0);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: generated-document PDF on mobile/desktop without native plugin, real rendering, page navigation, zoom, downloads and cleanup');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
