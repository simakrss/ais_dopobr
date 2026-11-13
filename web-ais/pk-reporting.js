(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AIS_PK_REPORTING=api;})(globalThis,()=>{
  'use strict';
  const normalize=v=>String(v??'').replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU');
  const text=v=>String(v??'').trim();
  const escapeXml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  function date(value){
    const s=text(value), iso=/^(\d{4})-(\d{2})-(\d{2})/.exec(s), ru=/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?:\D|$)/.exec(s);
    if(!iso&&!ru)return null;
    const y=iso?+iso[1]:+ru[3]<100?2000+(+ru[3]):+ru[3],m=+(iso?iso[2]:ru[2]),d=+(iso?iso[3]:ru[1]);
    const v=new Date(Date.UTC(y,m-1,d));
    return v.getUTCFullYear()===y&&v.getUTCMonth()===m-1&&v.getUTCDate()===d?v:null;
  }
  const iso=d=>d.toISOString().slice(0,10);
  const russianDate=s=>s.split('-').reverse().join('.');
  function period(kind,year,now=new Date(),quarter=null){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const part=k=>Number(parts.find(p=>p.type===k).value),currentYear=part('year'),month=part('month');
    year=Number(year|| (kind==='annual'?currentYear-1:currentYear));
    if(!Number.isInteger(year)||year<2000||year>currentYear)throw Error('Выберите отчётный год от 2000 до текущего.');
    if(!['annual','quarterly'].includes(kind))throw Error('Неизвестный вид отчёта.');
    if(kind==='annual'&&year===currentYear)throw Error('Годовой отчёт доступен только за завершённый год.');
    const automaticQuarters=kind==='annual'||year<currentYear?4:Math.floor((month-1)/3);
    const manualQuarter=kind==='quarterly'&&quarter!=null&&quarter!==''&&quarter!=='auto';
    const quarters=manualQuarter?Number(quarter):automaticQuarters;
    if(manualQuarter&&(!Number.isInteger(quarters)||quarters<1||quarters>4))throw Error('Выберите квартал от I до IV.');
    if(manualQuarter&&quarters>automaticQuarters)throw Error('Выбранный квартал ещё не завершён. Выберите завершённый квартал или предыдущий год.');
    const end=quarters?iso(new Date(Date.UTC(year,quarters*3,0))):null;
    return {kind,year,quarters,automaticQuarters,quarterMode:manualQuarter?'manual':'auto',start:`${year}-01-01`,end,available:quarters>0,
      asOf:`${currentYear}-${String(month).padStart(2,'0')}-${String(part('day')).padStart(2,'0')}`,
      label:kind==='annual'?`${year} год`:quarters?`${quarters===1?'1 квартал':`1–${quarters} кварталы`} ${year}`:'В текущем году ещё нет полных кварталов'};
  }
  function ageAt(birth,end){const b=date(birth),e=date(end);if(!b||!e||b>e)return null;return e.getUTCFullYear()-b.getUTCFullYear()-Number(e.getUTCMonth()<b.getUTCMonth()||(e.getUTCMonth()===b.getUTCMonth()&&e.getUTCDate()<b.getUTCDate()));}
  const fieldMap={
    'Прогр обуч факт':'program','Вид программы ДПО':'educationType','Форма обучения':'studyForm','Пол':'gender',
    'Категория занятости':'employmentCategory','Обр_Вид образования':'educationDocument','Квалификация':'qualification',
    'Источник финансирования':'fundingSource','Статус ОВЗ':'ovzStatus','Дата начала обучения':'startDate','Дата окончания обучения':'endDate',
    'Вид экономической деятельности (для 1-ПК)':'economicActivity','Минимальный уровень образования слушателя':'minimumEducationLevel',
    'Фамилия':'lastName','Возраст':'age','ТиповоеОграничение':'eligible'
  };
  const columns=new Map(Object.entries(fieldMap).map(([k,v])=>[normalize(k),v]));
  function prepare(students,programs,p){
    const byName=new Map();for(const program of programs||[]){const k=normalize(program.name);if(!byName.has(k))byName.set(k,[]);byName.get(k).push(program);}
    const issues=[],rows=[];
    for(const s of students||[]){
      if(s.deleted||s.deletedAt||s.isDeleted)continue;
      const matches=byName.get(normalize(s.program))||[],program=matches.length===1?matches[0]:{};
      const type=text(s.educationType||program.type).toUpperCase();
      if(!['КПК','ППП'].includes(type))continue;
      const dismissal=date(s.expulsionDate),end=date(s.endDate),within=d=>d&&p.end&&iso(d)>=p.start&&iso(d)<=p.end;
      // Both dates are used with OR, exactly as Настройки!B5 in the supplied form.
      if(!text(s.diplomaBlankNo))continue;
      if(!dismissal&&!end){issues.push({id:s.id,name:text(s.name)||`Запись ${s.id}`,fields:['не удалось определить отчётный период: нет корректной даты отчисления или окончания обучения']});continue;}
      if(!(within(dismissal)||within(end)))continue;
      // The header of annual section 2.4 explicitly uses 1 January of the next year.
      const reportAge=ageAt(s.birthDate,p.kind==='annual'?`${p.year+1}-01-01`:p.end),gender=normalize(s.gender),study=normalize(s.studyForm||program.studyForm);
      const row={...s,educationType:type,lastName:text(s.name).split(/\s+/)[0]||null,age:reportAge,eligible:true,
        gender:['ж','жен','женский','женщина'].includes(gender)?'Ж':['м','муж','мужской','мужчина'].includes(gender)?'М':text(s.gender),
        studyForm:study==='дистанционная'||study==='дистант'?'Дистант':text(s.studyForm||program.studyForm),
        economicActivity:text(program.economicActivity),minimumEducationLevel:text(program.minimumEducationLevel)};
      rows.push(row);
      const missing=[];
      if(reportAge===null)missing.push('дата рождения');
      if(!['Ж','М'].includes(row.gender))missing.push('пол');
      if(!row.lastName)missing.push('ФИО');
      if(p.kind==='annual'){
        if(matches.length!==1)missing.push(matches.length?'неоднозначная связь с программой':'программа в реестре');
        for(const [key,label] of [['economicActivity','вид экономической деятельности'],['minimumEducationLevel','минимальный уровень образования программы'],['fundingSource','источник финансирования'],['educationDocument','вид образования'],['studyForm','форма обучения']])if(!text(row[key]))missing.push(label);
      }
      if(missing.length)issues.push({id:s.id,name:text(s.name)||`Запись ${s.id}`,fields:missing});
    }
    return {rows,issues};
  }
  // A bounded, read-only parser: no eval/Function, database connections or arbitrary SQL.
  function predicate(source){
    const tokens=[],re=/\s+|'(?:[^']|'')*'|"(?:[^"]|"")*"|\[[^\]]+\]|\d+(?:\.\d+)?|[\p{L}_][\p{L}\p{N}_]*|<>|<=|>=|[(),=<>]/uy;
    for(let i=0;i<source.length;){re.lastIndex=i;const m=re.exec(source);if(!m)throw Error(`Не поддерживается условие: ${source.slice(i,i+35)}`);i=re.lastIndex;if(!/^\s/.test(m[0]))tokens.push(m[0]);}
    let pos=0;const peek=k=>tokens[pos]?.toUpperCase()===k,take=k=>peek(k)?(pos++,true):false,expect=k=>{if(!take(k))throw Error(`В формуле ожидалось ${k}`);};
    function primary(){
      if(take('(')){const f=or();expect(')');return f;}
      const t=tokens[pos++];if(!t)throw Error('Незавершённое условие.');
      if(t[0]==="'"||t[0]==='"')return ()=>t.slice(1,-1).replaceAll(t[0]+t[0],t[0]);
      if(/^\d/.test(t))return ()=>Number(t);
      if(t.toUpperCase()==='ISNULL'){expect('(');const f=or();expect(')');return r=>f(r)==null;}
      const key=columns.get(normalize(t.replace(/^\[|\]$/g,'')));if(!key)throw Error(`Неизвестное поле в примечании: ${t}`);
      return r=>r[key]===''||r[key]==null?null:r[key];
    }
    function compare(){
      const a=primary();const neg=peek('NOT')&&tokens[pos+1]?.toUpperCase()==='IN';if(neg)pos++;
      if(take('IN')){expect('(');const list=[];do{list.push(primary());}while(take(','));expect(')');return r=>a(r)==null?null:list.some(f=>normalize(f(r))===normalize(a(r)))!==neg;}
      if(take('LIKE')){const b=primary();return r=>{if(a(r)==null||b(r)==null)return null;const pattern=normalize(b(r)).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll('%','.*').replaceAll('_','.');return new RegExp(`^${pattern}$`,'u').test(normalize(a(r)));};}
      if(['=','<>','<','>','<=','>='].includes(tokens[pos])){const op=tokens[pos++],b=primary();return r=>{const av=a(r),bv=b(r);if(av==null||bv==null)return null;const cmp=typeof av==='number'||typeof bv==='number'?Number(av)-Number(bv):normalize(av).localeCompare(normalize(bv),'ru');return op==='='?cmp===0:op==='<>'?cmp!==0:op==='<'?cmp<0:op==='>'?cmp>0:op==='<='?cmp<=0:cmp>=0;};}
      return a;
    }
    function not(){if(take('NOT')){const f=not();return r=>f(r)==null?null:!f(r);}return compare();}
    function and(){let f=not();while(take('AND')){const a=f,b=not();f=r=>{const av=a(r),bv=b(r);return av===false||bv===false?false:av==null||bv==null?null:Boolean(av&&bv);};}return f;}
    function or(){let f=and();while(take('OR')){const a=f,b=and();f=r=>{const av=a(r),bv=b(r);return av===true||bv===true?true:av==null||bv==null?null:Boolean(av||bv);};}return f;}
    const f=or();if(pos!==tokens.length)throw Error(`Не поддерживается окончание условия: ${tokens.slice(pos).join(' ')}`);return r=>f(r)===true;
  }
  function compileNote(note){
    let sql=text(note).replace(/^\[ИсточникДанных\]\s*/i,'').replace(/\s+/g,' ').trim();
    sql=sql.replace(/\(SELECT TOP 1 \[Вид экономической деятельности \(для 1-ПК\)\] FROM \[Реестр программ\$\] WHERE \[Наименование программы\]=\[Прогр обуч факт\]\)/gi,'[Вид экономической деятельности (для 1-ПК)]');
    sql=sql.replace(/\(SELECT count\(\*\) FROM \[Реестр программ\$\] WHERE \[База\$\]\.\[Прогр обуч факт\]=\[Реестр программ\$\]\.\[Наименование программы\] and \[Реестр программ\$\]\.\[Минимальный уровень образования слушателя\]=('[^']*')\)>0/gi,'[Минимальный уровень образования слушателя]=$1');
    let mode='count',where;
    const distinct=/^SELECT count\(\*\) FROM \(SELECT DISTINCT \[Прогр обуч факт\] FROM \[База\$\] WHERE (.*)\)$/i.exec(sql);
    const count=/^SELECT count\((\*|Фамилия)\) FROM \[База\$\] WHERE (.*)$/i.exec(sql);
    const duration=/^SELECT round\(Сумма,1\) FROM \( SELECT sum\(iif\(isNull\(\[Дата начала обучения\]\) or isNull\(\[Дата окончания обучения\]\),iif\(\[Вид программы ДПО\]='КПК',14\/30,iif\(\[Вид программы ДПО\]='ППП',180\/30,0\)\), datediff\('d',cdate\(mid\(\[Дата начала обучения\],1,8\)\),cdate\(mid\(\[Дата окончания обучения\],1,8\)\)\)\/30\)\)\/12 as Сумма FROM \[База\$\] WHERE (.*)\)$/i.exec(sql);
    if(distinct){mode='distinct';where=distinct[1];}else if(count){mode=count[1]==='*'?'count':'named';where=count[2];}else if(duration){mode='duration';where=duration[1];}else throw Error('Не поддерживается запрос из примечания: '+sql.slice(0,100));
    const filter=predicate(where);
    return rows=>{
      const selected=rows.filter(filter);
      if(mode==='distinct')return new Set(selected.map(r=>normalize(r.program))).size;
      if(mode==='named')return selected.filter(r=>r.lastName!=null).length;
      if(mode==='duration'){
        const days=selected.reduce((sum,r)=>{const a=date(r.startDate),b=date(r.endDate);if((text(r.startDate)&&!a)||(text(r.endDate)&&!b))throw Error('Некорректные даты для расчёта среднегодовой численности.');if(a&&b&&b<a)throw Error('Дата окончания раньше начала обучения.');return sum+(a&&b?(b-a)/86400000:r.educationType==='КПК'?14:180);},0);
        // Access ROUND uses ties-to-even. Integer days avoid floating-point tie drift.
        const units=days/36,lower=Math.floor(units);
        return (days%36===18?(lower%2?lower+1:lower):Math.round(units))/10;
      }
      return selected.length;
    };
  }
  async function calculate({kind,year,quarter,students,programs,templates,now,manual={},signal,onProgress=()=>{}}){
    const p=period(kind,year,now,quarter);if(!p.available)throw Error(p.label);
    onProgress({stage:'Проверка данных слушателей'});
    const {rows,issues}=prepare(students,programs,p),values={},sections=[],check=()=>{if(signal?.aborted)throw new DOMException('Формирование отчёта прервано.','AbortError');};
    check();
    if(kind==='quarterly'){
      onProgress({stage:'Расчёт квартальных показателей',completed:0,total:4});
      const eligible=rows.filter(r=>r.age!=null&&r.age>=15);
      const n=(type,women)=>eligible.filter(r=>r.educationType===type&&(!women||r.gender==='Ж')).length;
      values['1-ПК квартальный']={C8:n('КПК'),D8:n('КПК',true),E8:n('ППП'),F8:n('ППП',true),D11:manual['1-ПК квартальный']?.D11||''};
    }else{
      const total=templates.sections.reduce((n,s)=>n+s.cells.filter(c=>c.note).length,0);let completed=0;
      for(const section of templates.sections){
        const result={};values[section.name]=result;
        for(const c of section.cells){
          check();
          if(c.note){try{result[c.address]=compileNote(c.note)(rows);}catch(e){throw Error(`${section.name}!${c.address}: ${e.message}`);}completed++;}
          else if(c.editable&&Object.hasOwn(manual[section.name]||{},c.address))result[c.address]=manual[section.name][c.address];
          if(completed%40===0){onProgress({stage:'Расчёт показателей',completed,total});await new Promise(resolve=>setTimeout(resolve,0));}
        }
        sections.push({name:section.name,automatic:section.cells.filter(c=>c.note).length,manual:section.cells.filter(c=>c.editable).length});
      }
      values['Настройки']={B3:p.year};
      values['Титульный лист']={...values['Титульный лист'],AO20:p.year};
    }
    check();onProgress({stage:'Подготовка результатов',completed:1,total:1});
    return {period:p,values,sections,formSections:kind==='annual'?templates.sections:[],issues,students:rows.length,generatedAt:(now||new Date()).toISOString(),manual};
  }
  function exportXlsx(report,templates,X,onProgress=()=>{}){
    onProgress({stage:'Открытие шаблона Excel'});
    const kind=report.period.kind,cfb=X.CFB.read(templates[kind],{type:'base64'}),files=new Map();
    for(let i=0;i<cfb.FullPaths.length;i++)files.set(cfb.FullPaths[i].replace(/^Root Entry\//,''),cfb.FileIndex[i]);
    const decode=file=>new TextDecoder().decode(file.content),encode=s=>new TextEncoder().encode(s);
    const workbook=X.read(templates[kind],{type:'base64',cellFormula:true,sheetStubs:true}),values=structuredClone(report.values);
    if(kind==='quarterly')Object.assign(values['1-ПК квартальный'],{A1:values['1-ПК квартальный'].A1||'Отчет 1-ПК квартальный',A2:`за ${report.period.label} (с ${russianDate(report.period.start)} по ${russianDate(report.period.end)})`,A3:`на дату — ${russianDate(report.period.asOf)}`,A11:`Генеральный директор · ${russianDate(report.period.asOf)}`});
    const calculating=new Set();
    function cellValue(sheet,address){
      if(Object.hasOwn(values[sheet]||{},address))return values[sheet][address];
      const c=workbook.Sheets[sheet]?.[address];if(!c?.f)return c?.v??0;
      const key=sheet+'!'+address;if(calculating.has(key))throw Error('Циклическая формула '+key);calculating.add(key);
      let f=c.f.replace(/SUM\(([A-Z]+\d+):([A-Z]+\d+)\)/g,(_,a,b)=>{const range=X.utils.decode_range(a+':'+b);let sum=0;for(let r=range.s.r;r<=range.e.r;r++)for(let col=range.s.c;col<=range.e.c;col++)sum+=Number(cellValue(sheet,X.utils.encode_cell({r,c:col})))||0;return String(sum);}).replace(/SUM\(([A-Z]+\d+)\)/g,'$1').replace(/[A-Z]+\d+/g,a=>String(Number(cellValue(sheet,a))||0));
      if(!/^\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)*$/.test(f))throw Error('Не поддерживается формула Excel '+key+': '+c.f);
      const result=(f.match(/[+-]?\d+(?:\.\d+)?/g)||[]).reduce((s,n)=>s+Number(n),0);
      calculating.delete(key);(values[sheet]??={})[address]=result;return result;
    }
    for(const name of workbook.SheetNames){
      for(const [a,c]of Object.entries(workbook.Sheets[name]))if(c.f)cellValue(name,a);
      const index=workbook.SheetNames.indexOf(name)+1,fileName=`xl/worksheets/sheet${index}.xml`,file=files.get(fileName);if(!file)throw Error('Отсутствует лист шаблона '+name);
      let xml=decode(file);const seen=new Set();
      xml=xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(whole,attrs,inner='')=>{
        const a=attrs.match(/\br="([A-Z]+\d+)"/)?.[1];if(!Object.hasOwn(values[name]||{},a))return whole;seen.add(a);
        const v=values[name][a];attrs=attrs.replace(/\s+t="[^"]*"/,'');
        if(v===''||v==null)return `<c${attrs}/>`;
        const formula=inner.match(/<f\b[^>]*>[\s\S]*?<\/f>/)?.[0]||'';
        if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Некорректное число '+name+'!'+a);return `<c${attrs}>${formula}<v>${v}</v></c>`;}
        return `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
      });
      for(const [a,v]of Object.entries(values[name]||{}))if(!seen.has(a)){
        const row=a.match(/\d+$/)[0],cell=typeof v==='number'?`<c r="${a}"><v>${v}</v></c>`:`<c r="${a}" t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`;
        const rx=new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
        if(!rx.test(xml))throw Error('В шаблоне нет строки '+name+'!'+a);
        xml=xml.replace(rx,(_,start,body,end)=>start+body+cell+end);
      }
      file.content=encode(xml);file.size=file.content.length;
      onProgress({stage:'Заполнение листов Excel',completed:index,total:workbook.SheetNames.length});
    }
    const wf=files.get('xl/workbook.xml');let wx=decode(wf).replace(/<calcPr\b[^>]*\/>/g,'');wx=wx.replace('</workbook>','<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');
    wf.content=encode(wx);wf.size=wf.content.length;
    onProgress({stage:'Упаковка файла Excel'});
    return X.CFB.write(cfb,{fileType:'zip',type:'array',compression:true});
  }
  return {period,date,ageAt,prepare,compileNote,calculate,exportXlsx};
});

// Use this same public module as a dedicated worker: heavy calculation/ZIP work
// must not freeze progress animation or the cancellation button in the interface.
if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope){
  globalThis.onmessage=async({data})=>{
    const onProgress=progress=>postMessage({type:'progress',progress});
    try{
      const resource=name=>new URL(name+location.search,location.href).href;
      // Quarterly counts do not need an Excel template. Load it only for annual
      // calculation or an explicit download, never as a second UI dependency.
      if(data.action==='export'||(data.action==='calculate'&&data.options.kind==='annual')){
        onProgress({stage:'Загрузка формы отчёта'});
        importScripts(resource('pk-report-templates.js'));
      }
      if(data.action==='calculate'){
        const result=await AIS_PK_REPORTING.calculate({...data.options,templates:globalThis.AIS_PK_TEMPLATES,onProgress});
        postMessage({type:'result',result});
      }else if(data.action==='export'){
        importScripts(resource('vendor/sheetjs/xlsx.full.min.js'));
        const bytes=AIS_PK_REPORTING.exportXlsx(data.report,AIS_PK_TEMPLATES,XLSX,onProgress);
        const buffer=bytes instanceof ArrayBuffer?bytes:new Uint8Array(bytes).buffer;
        postMessage({type:'result',result:buffer},[buffer]);
      }else throw Error('Неизвестная операция отчётности.');
    }catch(error){postMessage({type:'error',message:error.message});}
  };
}
