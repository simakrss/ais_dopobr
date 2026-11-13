// Developer-only build. Use the bundled artifact-tool runtime, not application dependencies.
// Annual input is a macro-disabled, link-disabled Excel SaveAs copy of the user's XLS.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const runtime = process.env.AIS_ARTIFACT_MODULES;
if (!runtime) throw Error('Set AIS_ARTIFACT_MODULES to the bundled Node modules directory.');
const {Workbook, SpreadsheetFile} = await import(path.join(runtime, '@oai/artifact-tool/dist/artifact_tool.mjs')).catch(async () => {
  const entry = require.resolve('@oai/artifact-tool', {paths:[runtime]});
  return import('node:url').then(({pathToFileURL}) => import(pathToFileURL(entry).href));
});
const JSZip = require(path.join(runtime, 'jszip'));
const X = require('../vendor/sheetjs/xlsx.full.min.js');
const input = process.argv[2], output = path.resolve(process.argv[3] || path.join(import.meta.dirname, '../pk-report-templates.js'));
if (!input) throw Error('Provide the converted annual.xlsx path.');
const bytes = await fs.readFile(input), book = X.read(bytes), zip = await JSZip.loadAsync(bytes);
const xmlEscape = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const styles = await zip.file('xl/styles.xml').async('string');
const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g);
const unlocked = new Set(xfs.flatMap((xf,i) => /<protection\b[^>]*locked="0"/.test(xf) ? [i] : []));
const metadata = [];
// Retain original XML parts, dimensions, styles, notes, print areas and merged cells.
// Do not ship historical respondent values or unused shared strings in public assets.
for (let i=0; i<book.SheetNames.length; i++) {
  const name=book.SheetNames[i], sheet=book.Sheets[name], file=`xl/worksheets/sheet${i+1}.xml`;
  const cells=[], section={name,file,cells};
  let xml=await zip.file(file).async('string');
  xml=xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(whole,attrs,inner='') => {
    const a=attrs.match(/\br="([A-Z]+\d+)"/)?.[1], style=Number(attrs.match(/\bs="(\d+)"/)?.[1]||0), c=sheet[a];
    const note=(c?.c||[]).map(t=>t.t.split('\0')[0]).find(t=>/\[ИсточникДанных\]/i.test(t));
    const coord=a?X.utils.decode_cell(a):{r:0,c:0};
    const mergedChild=(sheet['!merges']||[]).some(m=>coord.r>=m.s.r&&coord.r<=m.e.r&&coord.c>=m.s.c&&coord.c<=m.e.c&&(coord.r!==m.s.r||coord.c!==m.s.c));
    const rowCode=sheet['O'+(coord.r+1)]?.v;
    const dataCell=/^Раздел/.test(name)&&coord.r>=20&&coord.c>=15&&/^\d+$/.test(String(rowCode??''))&&!/^[хx]$/i.test(String(c?.v??''));
    const constantFormula=Boolean(c?.f)&&!/[A-Z]+\d+/.test(c.f);
    const editable=!mergedChild && (Boolean(note)||constantFormula||dataCell||(unlocked.has(style)&&/^Раздел/.test(name)&&coord.r>=20&&coord.c>=15)||(name==='Титульный лист'&&['AO20','X29','X30','V38'].includes(a)));
    const formula=constantFormula?'':c?.f;
    const title = Object.entries(sheet).filter(([key,v])=>key.match(/\d+$/)?.[0]===a?.match(/\d+$/)?.[0] && typeof v.v==='string' && !v.c && key!==a && X.utils.decode_cell(key).c<15).map(([,v])=>v.v).join(' · ') + (coord.c>=15 ? ` · графа ${coord.c-12}` : '');
    const titleLabel=name==='Титульный лист'?({AO20:'Отчётный год',X29:'Наименование отчитывающейся организации',X30:'Почтовый адрес',V38:'Код ОКПО'}[a]):'';
    if (note || editable || formula) cells.push({address:a, note:note||'', formula:formula||'', editable:editable&&!note&&!formula, label:titleLabel||title.slice(0,700)});
    if (name==='Настройки') {
      if (a==='B3') return `<c${attrs.replace(/\s+t="[^"]*"/,'')}><v>0</v></c>`;
      if (a==='B4') return `<c${attrs.replace(/\s+t="[^"]*"/,'')} t="inlineStr"><is><t>Текущая база АИС: слушатели и реестр программ</t></is></c>`;
      if (a==='B1') return `<c${attrs.replace(/\s+t="[^"]*"/,'')} t="inlineStr"><is><t>Расчёт по примечаниям. Ячейки без формул заполняются вручную. Возраст на 1 января следующего за отчётным года (раздел 2.4). Форма из предоставленного файла 2025 года; актуальность формы перед подачей проверяется отдельно.</t></is></c>`;
    }
    attrs=attrs.replace(/\s+t="[^"]*"/,'');
    if (note || (editable&&!formula)) return `<c${attrs}/>`;
    if (formula) return `<c${attrs}><f>${xmlEscape(formula)}</f></c>`;
    if (c?.t==='s') return `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(c.v)}</t></is></c>`;
    return whole;
  });
  // Shared formulas have been expanded above; all dependent caches were cleared.
  zip.file(file,xml);
  if (cells.length && /^(Раздел|Титульный)/.test(name)) metadata.push(section);
}
zip.remove('xl/sharedStrings.xml'); zip.remove('xl/calcChain.xml');
for (const file of Object.keys(zip.files)) if(file.startsWith('xl/externalLinks/')) zip.remove(file);
let workbookXml=await zip.file('xl/workbook.xml').async('string');
workbookXml=workbookXml.replace(/<externalReferences\b[^>]*>[\s\S]*?<\/externalReferences>/g,'').replace(/<definedName\b[^>]*>[^<]*\[\d+\][^<]*<\/definedName>/g,'');
zip.file('xl/workbook.xml',workbookXml);
for (const file of ['[Content_Types].xml','xl/_rels/workbook.xml.rels']) {
  let xml=await zip.file(file).async('string');
  xml=xml.replace(/<(?:Override|Relationship)\b[^>]*(?:sharedStrings|calcChain|externalLink)[^>]*\/>/g,'');
  zip.file(file,xml);
}
for (const file of Object.keys(zip.files)) if(file.endsWith('.vml')) zip.file(file,(await zip.file(file).async('string')).replace(/<x:FmlaMacro\b[^>]*>[\s\S]*?<\/x:FmlaMacro>/g,''));
zip.file('docProps/core.xml','<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>');
const annual=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
const w=Workbook.create(), s=w.worksheets.add('1-ПК квартальный');
s.getRange('A1:F12').format.font={name:'Times New Roman',size:12};
s.getRange('A1:F12').format.wrapText=true;
s.getRange('A1:F12').format.verticalAlignment='center';
for(const [col,width] of [['A',52],['B',10],['C',18],['D',18],['E',18],['F',18]])s.getRange(`${col}:${col}`).format.columnWidth=width;
for(const range of ['A1:F1','A2:F2','A3:F3','A5:F5','A6:A7','B6:B7','C6:D6','E6:F6','A11:C11','D11:F11'])s.mergeCells(range);
s.getRange('A1').values=[['Отчет 1-ПК квартальный']];
s.getRange('A2').values=[['Отчётный период']];
s.getRange('A3').values=[['Дата составления']];
s.getRange('A5').values=[['Код по ОКЕИ: человек — 792']];
s.getRange('A6:F6').values=[['Наименование показателей','№ строки','Программы повышения квалификации',null,'Программы профессиональной переподготовки',null]];
s.getRange('C7:F7').values=[['Всего обучено','Из них женщины','Всего обучено','Из них женщины']];
s.getRange('A8:F8').values=[['Всего обучено по дополнительным профессиональным программам в возрасте 15 лет и старше','01',0,0,0,0]];
s.getRange('A11').values=[['Генеральный директор']];
s.getRange('A6:F8').format.borders={preset:'all',style:'thin',color:'#000000'};
s.getRange('A6:F7').format.font.bold=true;
s.getRange('A1:F1').format.font.bold=true;
s.getRange('A1:F3').format.rowHeight=27;
s.getRange('A6:F6').format.rowHeight=44;
s.getRange('A7:F7').format.rowHeight=32;
s.getRange('A8:F8').format.rowHeight=66;
s.getRange('B6:F8').format.horizontalAlignment='center';
s.getRange('C8:F8').setNumberFormat('0');
s.getRange('B8').setNumberFormat('00');
w.recalculate();
await fs.writeFile(path.join(path.dirname(input),'quarter-template.png'),new Uint8Array(await (await w.render({sheetName:s.name,range:'A1:F11',scale:1,format:'png'})).arrayBuffer()));
const qblob=await SpreadsheetFile.exportXlsx(w);
await qblob.save(path.join(path.dirname(input),'quarter-artifact.xlsx'));
const quarter=await fs.readFile(path.join(path.dirname(input),'quarter-artifact.xlsx'));
const qzip=await JSZip.loadAsync(quarter);
let qxml=await qzip.file('xl/worksheets/sheet1.xml').async('string');
qxml=qxml.replace(/(<\/?)x:/g,'$1').replace('xmlns:x=','xmlns=');
qxml=qxml.replace(/<pageSetup\b[^>]*\/>/,'').replace('</worksheet>','<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/></worksheet>');
qzip.file('xl/worksheets/sheet1.xml',qxml);
qzip.file('xl/workbook.xml',(await qzip.file('xl/workbook.xml').async('string')).replace(/(<\/?)x:/g,'$1').replace('xmlns:x=','xmlns='));
const quarterly=await qzip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
await fs.writeFile(path.join(path.dirname(input),'annual-sanitized.xlsx'),annual);
await fs.writeFile(path.join(path.dirname(input),'quarter-template.xlsx'),quarterly);
const data={source:'Форма 1-ПК (2025)_исх.xls; 1-ПК квартальные.docx',annual:annual.toString('base64'),quarterly:quarterly.toString('base64'),sections:metadata};
await fs.writeFile(output,'// Generated sanitized templates: no respondent values, macros or database connection strings.\n(function(root){const data='+JSON.stringify(data)+'; if(typeof module==="object"&&module.exports)module.exports=data;else root.AIS_PK_TEMPLATES=data;})(globalThis);\n');
console.log(JSON.stringify({sections:metadata.length,notes:metadata.reduce((n,s)=>n+s.cells.filter(c=>c.note).length,0),annualBytes:annual.length,quarterBytes:quarterly.length}));
