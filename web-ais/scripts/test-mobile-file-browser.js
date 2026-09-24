"use strict";
// Actual file-browser DOM/CSS in an isolated browser; synthetic files, no WebDAV access.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"app.js"),"utf8").replace(/\r\n/g,"\n");
const extract=name=>source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`,"m"))[0];
const action=name=>`[data-action="student-webdav-${name}"]`;
(async()=>{
  const {PDFDocument}=require("../vendor/pdf-lib.min.js");const doc=await PDFDocument.create();doc.addPage([595,842]);const pdf=Buffer.from(await doc.save());
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  try {
    const page=await browser.newPage({viewport:{width:360,height:640}}),errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.route("**/*",route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/test.pdf')return route.fulfill({contentType:'application/pdf',body:pdf});
      if(url.pathname==='/test.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="3072"><rect width="2048" height="3072" fill="#cde9e3"/><text x="200" y="300" font-size="90">TEST DOCUMENT</text></svg>'});
      return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fs.readFileSync(path.join(root,"styles.css"),"utf8")}</style>`});
    });
    await page.goto('http://127.0.0.1/isolated-file-browser');
    await page.addScriptTag({content:`
      const nativeFetch=window.fetch.bind(window),requests=[],downloads=[];
      const entries=[{name:'Фотография_документа_с_длинным_названием.jpg',path:'image',size:12345,previewKind:'image'},
        {name:'Протокол_итоговой_аттестации_длинное_название.pdf',path:'pdf',size:54321,previewKind:'pdf'},
        {name:'Заявление.docx',path:'text',size:4321,previewKind:'document'},
        {name:'Архив',path:'folder',isDirectory:true},...Array.from({length:30},(_,i)=>({name:'Документ '+i+'.txt',path:'text-'+i,size:100,previewKind:'text'}))];
      const fetch=async(url,options)=>{
        requests.push({url,body:options?.body});
        if(url==='/list'){const body=JSON.parse(options.body);return {ok:true,json:async()=>({path:body.path,entries})};}
        if(url==='/preview')return {ok:true,json:async()=>({text:'Тестовый текст документа '.repeat(300),limitedExtraction:true})};
        return nativeFetch(url,options);
      };
      const photoApiUrl=url=>url.endsWith('/list')?'/list':url;
      const getStudentWebDavDocumentFileUrl=(folder,file)=>file==='image'?'/test.svg':'/test.pdf';
      const getStudentWebDavDocumentPreviewUrl=()=>'/preview';
      const downloadBlob=(name,blob)=>downloads.push({name,size:blob.size});
      const getStudentWebDavEntryIconKind=()=>'',renderStudentWebDavEntryIcon=()=>'<span class="student-webdav-browser-entry-icon">▧</span>';
      const formatBytes=value=>value+' Б',formatStudentWebDavModifiedAt=()=> '24.09.2026';
      const getStudentWebDavParentPath=value=>value.split('/').slice(0,-1).join('/');
      const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
      const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');const escapeAttr=escapeHtml;
      ${extract('openStudentWebDavDocumentsManager')}
    `});
    async function open(kind,notice=''){
      await page.evaluate(({kind,notice})=>openStudentWebDavDocumentsManager(kind+'/ОченьДлинноеНазваниеПапки/Документы','Тестовая Очень-Длинная Фамилия Имя Отчество',{title:kind==='students'?'Документы слушателя: Тестовая Очень-Длинная Фамилия Имя Отчество':'Документы сотрудника: Тестовая Очень-Длинная Фамилия Имя Отчество',notice}),{kind,notice});
      await page.waitForSelector('[data-webdav-browser-entry="image"]');
    }
    async function fits(selector,minHeight=0){
      const box=await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,height:r.height,vw:innerWidth,vh:innerHeight};});
      assert.ok(box.left>=-1&&box.top>=-1&&box.right<=box.vw+1&&box.bottom<=box.vh+1&&box.height>=minHeight,selector+': '+JSON.stringify(box));
    }
    for(const kind of ['students','contracts']){
      for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
        await page.setViewportSize(size);await open(kind);
        await fits('.student-webdav-browser-dialog');await fits('[data-student-webdav-list]',150);
        assert.equal(await page.locator('[data-student-webdav-preview]').isVisible(),false);
        await page.click('[data-webdav-browser-entry="image"]');
        await page.waitForFunction(()=>document.querySelector('[data-student-webdav-preview-image]')?.naturalWidth>0);
        await fits('[data-student-webdav-image-stage]',150);await fits('[data-student-webdav-preview-image]');
        await fits(action('preview-expand'));await fits(action('download'));
        if(kind==='students'&&size.width===390&&process.env.UI_SCREENSHOT) await page.screenshot({path:process.env.UI_SCREENSHOT});
        assert.match(await page.locator(action('preview-expand')).textContent(),/К файлам/);
        assert.equal(await page.locator('[data-student-webdav-list]').isVisible(),false);
        await page.click(action('preview-zoom-in'));assert.equal(await page.locator('[data-student-webdav-preview-scale]').textContent(),'125%');
        await page.click(action('preview-fit'));await page.click(action('preview-next'));
        await page.waitForFunction(()=>document.querySelector('[data-student-webdav-preview-pdf]')?.dataset.previewReady==='true');
        await fits('[data-student-webdav-pdf-stage]',150);await fits('[data-student-webdav-preview-pdf]');
        await page.click(action('download'));await page.waitForFunction(()=>document.querySelector('[data-student-webdav-status]').textContent.includes('передан'));
        await fits('[data-student-webdav-pdf-stage]',100);
        await page.click(action('preview-next'));await page.waitForSelector('[data-student-webdav-preview-text]');
        await fits('[data-student-webdav-preview-body]',100);
        await page.click(action('preview-expand'));await fits('[data-student-webdav-list]',100);
        await page.click('[data-webdav-browser-entry="folder"]');
        assert.equal(await page.locator('[data-student-webdav-preview]').isVisible(),false);
        await page.click('[data-action="close-student-webdav-browser"]');
      }
    }
    await page.setViewportSize({width:1366,height:900});await open('students');
    assert.equal(await page.locator('[data-student-webdav-preview]').isVisible(),true);
    await page.click('[data-webdav-browser-entry="image"]');await fits('[data-student-webdav-list]',200);await fits('[data-student-webdav-preview]',200);
    await page.setViewportSize({width:390,height:700});await page.waitForFunction(()=>document.querySelector('.student-webdav-browser-workspace').classList.contains('is-preview-expanded'));
    await fits('[data-student-webdav-image-stage]',200);
    await page.setViewportSize({width:844,height:390});await fits('[data-student-webdav-image-stage]',150);
    await page.setViewportSize({width:1366,height:900});await page.waitForFunction(()=>!document.querySelector('.student-webdav-browser-workspace').classList.contains('is-preview-expanded'));
    await fits('[data-student-webdav-list]',200);
    await page.setViewportSize({width:360,height:640});await open('contracts','Локальная папка недоступна. Используется WebDAV. '.repeat(12));
    await fits('[data-student-webdav-list]',150);await page.click('[data-webdav-browser-entry="image"]');await fits('[data-student-webdav-image-stage]',100);
    await page.click('[data-action="close-student-webdav-browser"]');await page.setViewportSize({width:390,height:844});
    assert.deepEqual(errors,[]);
    console.log('PASS: both card browsers at 320/390/844px, portrait/landscape, list/preview navigation, image/PDF/text, downloads, long warnings, rotation/resizing and desktop split view');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
