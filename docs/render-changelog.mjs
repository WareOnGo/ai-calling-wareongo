// The Markdown is the only authored changelog. HTML exists only in a temp folder.
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../tests/browser/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const md=readFileSync(join(root,'BOLNA_DB_FIXES_CHANGELOG.md'),'utf8'),draft=process.argv.includes('--draft');
const releaseDate=md.match(/^Unreleased · ([^·]+) ·/m)?.[1].trim();
if(!releaseDate)throw Error('The Markdown changelog must include its release date.');
if(!draft&&!md.includes('**Verification: passed.**'))throw Error('Finish the verification section in the Markdown before rendering the release PDF.');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=s=>escape(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1');
function render(body){
 const lines=body.trim().split('\n'),blocks=[];
 for(let i=0;i<lines.length;){
  const line=lines[i];if(!line.trim()){i++;continue;}
  const img=/^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line);
  if(img){const bytes=readFileSync(resolve(root,img[2]));blocks.push(`<figure><img src="data:image/png;base64,${bytes.toString('base64')}" alt="${escape(img[1])}"><figcaption>${inline(img[1])}</figcaption></figure>`);i++;continue;}
  if(line.startsWith('### ')){blocks.push('<h2>'+inline(line.slice(4))+'</h2>');i++;continue;}
  if(line.startsWith('|')){
   const rows=[];while(i<lines.length&&lines[i].startsWith('|'))rows.push(lines[i++].split('|').slice(1,-1).map(c=>c.trim()));
   blocks.push('<table><thead><tr>'+rows[0].map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(2).map(row=>'<tr>'+row.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>');continue;
  }
  if(/^(- |\d+\. )/.test(line)){
   const ordered=/^\d/.test(line),items=[];while(i<lines.length&&/^(- |\d+\. )/.test(lines[i]))items.push('<li>'+inline(lines[i++].replace(/^(- |\d+\. )/,''))+'</li>');
   blocks.push(`<${ordered?'ol':'ul'}>${items.join('')}</${ordered?'ol':'ul'}>`);continue;
  }
  const paragraph=[];while(i<lines.length&&lines[i].trim()&&!/^(##|\||!\[|- |\d+\. )/.test(lines[i]))paragraph.push(lines[i++]);
  if(!paragraph.length)throw Error('Unsupported Markdown block: '+lines[i]);
  blocks.push('<p>'+inline(paragraph.join(' '))+'</p>');
 }
 return blocks.join('\n');
}
const sections=md.split(/^## /m).slice(1),pages=sections.map((section,i)=>{
 const end=section.indexOf('\n'),title=section.slice(0,end),body=section.slice(end);
 return `<section class="page"><header><b>WAREONGO / BOLNA</b><span>${escape(releaseDate.toUpperCase())} · ${draft?'DRAFT':'UNRELEASED'}</span></header><div class="eyebrow">BOLNA DB FIXES · HANDOFF CHANGELOG</div><h1>${inline(title)}</h1>${render(body)}<footer><span>Local validation · synthetic screenshots · not deployed</span><b>${i+1} / ${sections.length}</b></footer></section>`;
});
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bolna DB Fixes — changelog</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;color:#193339;background:#edf3ef;font:10pt/1.5 Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;padding:15mm 17mm 18mm;background:white;position:relative;break-after:page}.page:last-child{break-after:auto}header{display:flex;justify-content:space-between;font-size:7.4pt;letter-spacing:.06em;color:#536f61;padding-bottom:6mm;border-bottom:1px solid #cfded4;margin-bottom:8mm}header b{color:#195d43}.eyebrow{font-size:8pt;letter-spacing:.1em;color:#2b8060;font-weight:bold;margin-bottom:3mm}h1{font-size:27pt;line-height:1.12;margin:0 0 6mm;letter-spacing:-.7px}h2{font-size:14pt;margin:5mm 0 3mm}p{margin:0 0 4mm}strong{color:#14553e}code{font-size:.9em;overflow-wrap:anywhere}ul,ol{padding-left:5mm;margin:3mm 0 5mm}li{padding-left:1mm;margin-bottom:3mm}figure{margin:3mm 0 5mm}img{display:block;width:100%;height:auto;max-height:120mm;object-fit:contain;border:1px solid #dbe5de;border-radius:2mm}figcaption{font-size:8pt;line-height:1.4;color:#62746a;margin-top:2mm}.page:nth-child(2) img{max-height:132mm}.page:nth-child(3) img{max-height:152mm}.page:nth-child(4) img{max-height:107mm}.page:nth-child(5) img{max-height:60mm}table{width:100%;border-collapse:collapse;font-size:9.2pt;line-height:1.4;margin:4mm 0 5mm}th{text-align:left;background:#e8f1ea;padding:3mm;color:#15573e}td{padding:2.8mm;border-bottom:1px solid #dce5df;vertical-align:top}td:first-child{font-weight:bold}.page:last-child table{font-size:8.4pt;line-height:1.25}.page:last-child td{padding:2.1mm 2.5mm}.page:last-child td:first-child{width:17mm}.page:last-child p{font-size:8.6pt}footer{position:absolute;bottom:10mm;left:17mm;right:17mm;border-top:1px solid #d7e2d9;padding-top:3mm;display:flex;justify-content:space-between;color:#63776a;font-size:7pt}@media screen{.page{margin:7mm auto;box-shadow:0 2px 15px #0002}}
</style></head><body>${pages.join('')}</body></html>`;
const folder=mkdtempSync(join(tmpdir(),'bolna-changelog-')),htmlPath=join(folder,'changelog.html');writeFileSync(htmlPath,html);
const browser=await chromium.launch({headless:true,executablePath:process.env.EVAL_CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto(pathToFileURL(htmlPath).href);await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready);
 const failures=await page.evaluate(()=>[...document.querySelectorAll('.page')].flatMap((p,i)=>{
  const footer=p.querySelector('footer').getBoundingClientRect(),bottom=Math.max(...[...p.children].filter(c=>c.tagName!=='FOOTER').map(c=>c.getBoundingClientRect().bottom));
  const unloaded=[...p.querySelectorAll('img')].some(im=>!im.complete||!im.naturalWidth);return bottom>footer.top-8||unloaded?[{page:i+1,bottom,footer:footer.top,unloaded}]:[];
 }));
 if(failures.length)throw Error('PDF layout or image failures: '+JSON.stringify(failures));
 await page.pdf({path:draft?join(tmpdir(),'bolna-changelog-draft.pdf'):join(root,'BOLNA_DB_FIXES_CHANGELOG.pdf'),preferCSSPageSize:true,printBackground:true,tagged:true,outline:true});
 console.log(`Rendered ${pages.length}-page changelog directly from Markdown; layout and image checks passed.`);
}finally{await browser.close();}
