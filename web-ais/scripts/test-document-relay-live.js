"use strict";
// Explicit opt-in: sends a synthetic DOCX, never real student data, through the installed queue.
if (!process.argv.includes("--live")) throw Error("Use --live to test the installed document queue with synthetic data.");
const assert=require("node:assert/strict"),path=require("node:path"),app=require("../app-server"),relay=require("../document-relay");
async function main() {
  const calls=[];
  const client=await relay.fromStorage(path.resolve(__dirname,"../storage"),{fetch:async(url,options)=>{
    const started=Date.now(),response=await fetch(url,options);calls.push({action:new URL(url).searchParams.get("action"),ms:Date.now()-started});return response;
  }});
  const health=await client.call("health");assert.ok(health.pdf>0,"At least one PDF worker must be online");
  const docx=app.buildDocxZip([
    {name:"[Content_Types].xml",content:'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'},
    {name:"_rels/.rels",content:'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
    {name:"word/document.xml",content:'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:sz w:val="48"/></w:rPr><w:t>AIS TEST 12345</w:t></w:r></w:p><w:p><w:r><w:t>23.09.2026</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'}
  ]);
  const started=Date.now(),result=await client.run("pdf",{base64:docx.toString("base64")});
  const pdf=Buffer.from(result.base64,"base64");assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
  const parsed=await require("../vendor/pdf-lib.min.js").PDFDocument.load(pdf);assert.equal(parsed.getPageCount(),1);
  console.log("LIVE PDF OK",JSON.stringify({ms:Date.now()-started,bytes:pdf.length,calls}));
  if(process.argv.includes("--ocr")) {
    const page=await client.run("ocr",{operation:"render-page",payload:{fileName:"relay-test.pdf",mimeType:"application/pdf",page:1,base64:pdf.toString("base64")}});
    assert.ok(page.ok&&page.preview.base64);
    const imageBytes=Buffer.from(page.preview.base64,"base64"), jpeg=imageBytes[0]===255&&imageBytes[1]===216;
    const ocr=await client.run("ocr",{operation:"recognize",payload:{fileName:jpeg?"relay-test.jpg":"relay-test.png",mimeType:jpeg?"image/jpeg":"image/png",base64:page.preview.base64}});
    assert.equal(ocr.ok,true);assert.match(ocr.textPreview,/12345/);console.log("LIVE OCR and page preview OK");
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
