// CGP-SHELL-R-035 / CGP-SHELL-D-034 — "새로운 기능" on the real App in headless Chromium: drawn only
// when the host says it is due, never while a turn runs (and not recorded as seen until drawn),
// closed by its × (focus back to the composer, a late answer cannot reopen it), absent from the
// instructor console, reachable later from the settings dialog, lines rendered as text; computed
// geometry (above the composer, inside the column, 44px close, >=14px text, focus ring, ChatIcon,
// forced colours) for personal and classroom, dark and light, 320/800/1420 px.
// CGP-SHELL-D-034 (DES-SHELL-34) — the shipped lines render as at most 3 bullets of at most 40
// characters (visible disc markers with room inside the row), the row is in flow and not modal
// (no dialog, aria-modal or inert; the composer stays hit-testable under it) and its text keeps
// >= 4.5:1 against the row in dark and light.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {LEARNER_RELEASE_NOTES} from '../src/learnerReleaseNotes.ts';
const bin=findChromium();
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN whats-new layout: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'whats-new-assets',write:false,loader:{'.svg':'dataurl','.png':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text,script=app.outputFiles.find(f=>f.path.endsWith('.js')).text;
const b=await launch(bin),shots=process.env.WHATS_NEW_EVIDENCE;if(shots)mkdirSync(shots,{recursive:true});
const settle=(ms=80)=>new Promise(r=>setTimeout(r,ms));
const send=async data=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await settle();};
const shim=`window.__posts=[];if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');}window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(m),getState:()=>undefined,setState:()=>{}});`;
const page=(vars,dark)=>`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>${shim}</script><script>${script.replaceAll('</script','<\\/script')}</script></body></html>`;
const NOTES={id:LEARNER_RELEASE_NOTES.id,items:[...LEARNER_RELEASE_NOTES.items]};
const workspace={scope:'whats-new',revision:1,activeTaskId:'task',tasks:[{id:'task',title:'고양이 페이지',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null};
const configFor=(seat,extra={})=>chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?workspace:undefined,access:seat==='classroom'?{status:'unavailable'}:undefined,...extra});
const posts=async()=>JSON.parse(await b.evaluate('JSON.stringify(window.__posts)'));
const answer=async(show,notes=NOTES)=>{const req=(await posts()).filter(m=>m.type==='whatsNewRequest').at(-1);assert.ok(req,'the webview asks the host');await send({type:'whatsNew',requestId:req.requestId,notes,show});};
const panel=()=>b.evaluate(`(()=>{const p=document.querySelector('.hps-whats-new');return p?{title:p.querySelector('h2').textContent,items:[...p.querySelectorAll('li')].map(l=>l.textContent),html:p.innerHTML,modal:!!p.closest('dialog')}:null})()`);
const shown=async()=>(await posts()).filter(m=>m.type==='whatsNewShown');
const vars=theme=>Object.entries(THEMES[theme]).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
const rgb=c=>{const m=c.match(/[\d.]+/g).map(Number);return {r:m[0],g:m[1],b:m[2],a:m[3]??1};};
const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
const over=(top,under)=>({r:top.r*top.a+under.r*(1-top.a),g:top.g*top.a+under.g*(1-top.a),b:top.b*top.a+under.b*(1-top.a)});
const contrast=(fg,bg)=>{const [x,y]=[lum(fg),lum(bg)].sort((a,b)=>b-a);return (x+.05)/(y+.05);};
const open=async(seat,{dark=true,width=800,forcedColors=false,extra={}}={})=>{await b.send('Page.navigate',{url:'about:blank'});await b.load(page(vars(dark?'Dark+':'Light+'),dark),{width,height:900,dark,forcedColors});await send({type:'config',config:configFor(seat,extra)});await send({type:'history',messages:[]});};
let cases=0;
try{
 for(const seat of ['personal','classroom']){
  // Not due: nothing drawn, nothing recorded.
  await open(seat);await answer(false);
  assert.equal(await panel(),null,`${seat}: not due, no panel`);assert.equal((await shown()).length,0);
  // Due: three lines as text, a non-modal row, and the host is told it was drawn.
  await open(seat);await answer(true);
  let p=await panel();assert.ok(p,`${seat}: panel drawn`);assert.equal(p.title,'새로운 기능');assert.deepEqual(p.items,NOTES.items);assert.equal(p.modal,false,'not modal');
  assert.deepEqual((await shown()).map(m=>m.notesId),[NOTES.id],'drawing it is reported once');
  assert.equal(await b.evaluate(`document.activeElement?.closest('.hps-whats-new')??null`),null,'it never takes focus');
  // Hidden while a turn runs; back after it ends.
  await send({type:'streamStart',streamId:'s1',messageId:'m1'});assert.equal(await panel(),null,`${seat}: hidden during a turn`);
  await send({type:'streamEnd',streamId:'s1',messageId:'m1'});assert.ok(await panel(),'back after the turn');
  // Hidden while a send is pending (sent, no streamStart yet); back once the host rejects it.
  await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);await b.send('Input.insertText',{text:'안녕'});await settle();
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await settle(120);
  assert.ok((await posts()).some(m=>m.type==='sendMessage'),`${seat}: the send went out`);
  assert.equal(await panel(),null,`${seat}: hidden while a send is pending`);
  await send({type:'inputRejected',text:'안녕'});assert.ok(await panel(),`${seat}: back once the pending send ends`);
  // Hidden while a lesson rehearsal send is in flight; back when it settles.
  await send({type:'rehearsalState',state:'sending'});assert.equal(await panel(),null,`${seat}: hidden during a rehearsal send`);
  await send({type:'rehearsalState',state:'sent',verdict:'ok',reasons:[]});assert.ok(await panel(),`${seat}: back after the rehearsal send`);
  // Close: hidden, reported, focus to the composer; a late "due" answer cannot reopen it.
  await b.evaluate(`document.querySelector('.hps-whats-new-dismiss').click()`);await settle(120);
  assert.equal(await panel(),null,'closed');
  assert.deepEqual((await posts()).filter(m=>m.type==='whatsNewDismiss').map(m=>m.notesId),[NOTES.id]);
  assert.ok(await b.evaluate(`document.activeElement===document.querySelector('.hps-input textarea')`),'focus returns to the composer');
  await answer(true);assert.equal(await panel(),null,'a late due answer after the close does not reopen it');
  // A turn already running when the answer arrives: not drawn and not reported until it ends.
  await open(seat);await send({type:'streamStart',streamId:'s2',messageId:'m2'});await answer(true);
  assert.equal(await panel(),null,'not drawn during a running turn');assert.equal((await shown()).length,0,'not reported as seen while hidden');
  await send({type:'streamEnd',streamId:'s2',messageId:'m2'});assert.ok(await panel());assert.equal((await shown()).length,1);
  // Lines are text: markup from the notes never becomes an element.
  await open(seat);await answer(true,{id:'x1',items:['<img src=x onerror=alert(1)>']});
  p=await panel();assert.deepEqual(p.items,['<img src=x onerror=alert(1)>']);assert.ok(!/<img/.test(p.html.replace(/&lt;img/g,'')),'no element from the notes');
  // Later from Help: the settings dialog lists 새로운 기능 next to 키보드 단축키 and opens the same lines.
  await open(seat);await answer(false);
  const settings=seat==='personal'?`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='설정')`:`document.querySelector('.hps-access-chip')`;
  if(seat==='personal'){await b.evaluate(`(()=>{const t=document.querySelector('.tw-chat-menu-toggle');if(t.getAttribute('aria-expanded')!=='true')t.click();})()`);await settle();}
  await b.evaluate(`(()=>{const e=${settings};e.focus();e.click()})()`);await settle(160);
  const entry=`[...document.querySelectorAll('dialog.hps-preferences[open] button')].find(e=>e.textContent.trim()==='새로운 기능')`;
  const box=await b.evaluate(`(()=>{const e=${entry};if(!e)return null;const r=e.getBoundingClientRect();return {w:r.width,h:r.height,font:parseFloat(getComputedStyle(e).fontSize)}})()`);
  assert.ok(box,`${seat}: settings lists 새로운 기능`);assert.ok(box.w>=44&&box.h>=44&&box.font>=14,`entry 44px, >=14px: ${JSON.stringify(box)}`);
  await b.evaluate(`(${entry}).click()`);await settle(200);
  const sheet=await b.evaluate(`(()=>{const d=document.querySelector('dialog.hps-whats-new-sheet[open]');if(!d)return null;const r=d.getBoundingClientRect(),c=d.querySelector('header button').getBoundingClientRect();return {items:[...d.querySelectorAll('li')].map(l=>l.textContent),title:d.querySelector('h2')?.textContent,open:document.querySelectorAll('dialog[open]').length,inView:r.left>=0&&r.right<=innerWidth+.5,close:[c.width,c.height],fonts:[...d.querySelectorAll('li,h2')].map(e=>parseFloat(getComputedStyle(e).fontSize))}})()`);
  assert.ok(sheet,`${seat}: the sheet opens from settings`);assert.deepEqual(sheet.items,NOTES.items,'same lines later');assert.equal(sheet.open,1,'settings closed; only the sheet');
  assert.ok(sheet.inView&&sheet.close[0]>=44&&sheet.close[1]>=44&&Math.min(...sheet.fonts)>=14,`sheet geometry: ${JSON.stringify(sheet)}`);
  await b.evaluate(`document.querySelector('dialog.hps-whats-new-sheet header button').click()`);await settle(400);
  assert.equal(await b.evaluate(`!!document.querySelector('dialog.hps-whats-new-sheet[open]')`),false,'× closes the sheet');
  // Before the host has answered, the sheet says it is loading, never "nothing new".
  await open(seat);
  if(seat==='personal'){await b.evaluate(`(()=>{const t=document.querySelector('.tw-chat-menu-toggle');if(t.getAttribute('aria-expanded')!=='true')t.click();})()`);await settle();}
  await b.evaluate(`(()=>{const e=${settings};e.focus();e.click()})()`);await settle(160);await b.evaluate(`(${entry}).click()`);await settle(200);
  assert.equal(await b.evaluate(`document.querySelector('dialog.hps-whats-new-sheet[open] p')?.textContent`),'새로운 기능을 불러오고 있어요.');
  // With no valid notes the sheet says so instead of an empty list.
  await open(seat);await answer(false,null);
  if(seat==='personal'){await b.evaluate(`(()=>{const t=document.querySelector('.tw-chat-menu-toggle');if(t.getAttribute('aria-expanded')!=='true')t.click();})()`);await settle();}
  await b.evaluate(`(()=>{const e=${settings};e.focus();e.click()})()`);await settle(160);await b.evaluate(`(${entry}).click()`);await settle(200);
  assert.equal(await b.evaluate(`document.querySelector('dialog.hps-whats-new-sheet[open] p')?.textContent`),'이번 버전에서 새로 알려 드릴 기능이 없어요.');
  cases++;
 }
 // Instructor console: no panel even if a host answer says due.
 await open('classroom',{extra:{isInstructor:true}});
 assert.ok(await b.evaluate(`!!document.querySelector('.hps-instructor-band')`),'instructor console rendered');
 await answer(true);assert.equal(await panel(),null,'instructor console: no panel');assert.equal((await shown()).length,0);
 // Geometry.
 for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420]){
  await open(seat,{dark,width});await answer(true);
  const g=await b.evaluate(`(()=>{const p=document.querySelector('.hps-whats-new'),input=document.querySelector('.hps-input'),foot=document.querySelector('.hps-input-area');const r=p.getBoundingClientRect(),c=input.getBoundingClientRect(),f=foot.getBoundingClientRect();const x=p.querySelector('.hps-whats-new-dismiss'),q=x.getBoundingClientRect();
   return {bottom:r.bottom,left:r.left,right:r.right,cTop:c.top,fLeft:f.left,fRight:f.right,close:[q.width,q.height],fonts:[...p.querySelectorAll('h2,li')].map(e=>parseFloat(getComputedStyle(e).fontSize)),overflow:document.documentElement.scrollWidth>innerWidth,svg:x.querySelectorAll('svg[data-icon="close"]').length,glyph:x.textContent.trim(),label:x.getAttribute('aria-label')}})()`);
  const label=`${seat} ${dark?'dark':'light'} ${width}`;
  assert.ok(g.bottom<=g.cTop+.5,`${label}: above the composer (${g.bottom} <= ${g.cTop})`);
  assert.ok(g.left>=g.fLeft-.5&&g.right<=g.fRight+.5,`${label}: inside the composer column`);
  assert.equal(g.overflow,false,`${label}: no horizontal overflow`);
  assert.ok(g.close[0]>=44&&g.close[1]>=44,`${label}: 44px close ${g.close}`);
  assert.ok(Math.min(...g.fonts)>=14,`${label}: text >= 14px ${g.fonts}`);
  assert.equal(g.svg,1);assert.equal(g.glyph,'','close is a ChatIcon, not a glyph');assert.equal(g.label,'새로운 기능 닫기');
  // DES-SHELL-34: short (<= 3 bullets, <= 40 characters), visible bullets, not modal, readable in this theme.
  const d=await b.evaluate(`(()=>{const p=document.querySelector('.hps-whats-new'),ps=getComputedStyle(p),pr=p.getBoundingClientRect(),c=document.querySelector('.hps-input textarea'),cr=c.getBoundingClientRect();
   const lis=[...p.querySelectorAll('.hps-whats-new-list > li')];
   return {list:p.querySelector('.hps-whats-new-list').tagName,n:lis.length,lens:lis.map(l=>[...l.textContent].length),
    bullets:lis.map(l=>{const s=getComputedStyle(l);return {display:s.display,type:s.listStyleType,room:l.getBoundingClientRect().left-pr.left-parseFloat(ps.borderInlineStartWidth),font:parseFloat(s.fontSize)}}),
    position:ps.position,modal:p.closest('dialog,[aria-modal="true"],[role="dialog"],[role="alertdialog"]')!==null,inert:document.querySelector('[inert]')!==null,openDialogs:document.querySelectorAll('dialog[open]').length,
    hit:document.elementFromPoint(cr.left+cr.width/2,cr.top+cr.height/2)===c,
    bg:ps.backgroundColor,page:getComputedStyle(document.body).backgroundColor,text:[...p.querySelectorAll('h2,li')].map(e=>getComputedStyle(e).color)}})()`);
  assert.equal(d.list,'UL',`${label}: the lines are a bulleted list`);
  assert.ok(d.n>=1&&d.n<=3,`${label}: 1-3 bullets (${d.n})`);
  assert.ok(d.lens.every(n=>n<=40),`${label}: each bullet <= 40 characters (${d.lens})`);
  for(const x of d.bullets){assert.equal(x.display,'list-item',`${label}: bullet is a list item`);assert.notEqual(x.type,'none',`${label}: bullet marker visible`);assert.ok(x.room>=x.font,`${label}: marker has room inside the row (${x.room} >= ${x.font})`);}
  assert.ok(['static','relative'].includes(d.position),`${label}: in flow, not an overlay (${d.position})`);
  assert.equal(d.modal,false,`${label}: not inside a dialog or aria-modal`);assert.equal(d.inert,false,`${label}: nothing made inert`);assert.equal(d.openDialogs,0,`${label}: no dialog open`);
  assert.ok(d.hit,`${label}: the composer stays hit-testable with the panel shown`);
  const back=over(rgb(d.bg),rgb(d.page));
  for(const color of d.text){const ratio=contrast(over(rgb(color),back),back);assert.ok(ratio>=4.5,`${label}: text ${color} on ${d.bg} is ${ratio.toFixed(2)}:1`);}
  const ring=await b.focusVisibleStyle('.hps-whats-new-dismiss');assert.equal(ring['outline-width'],'2px');assert.notEqual(ring['outline-style'],'none');
  if(shots){const png=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${shots}/${seat}-${dark?'dark':'light'}-${width}.png`,Buffer.from(png.data,'base64'));}
  cases++;
 }
 // Forced colours: the row keeps a visible system border and the close a system colour.
 for(const seat of ['personal','classroom']){
  await open(seat,{forcedColors:true});await answer(true);
  const fc=await b.evaluate(`(()=>{const p=getComputedStyle(document.querySelector('.hps-whats-new'));return {style:p.borderTopStyle,width:parseFloat(p.borderTopWidth),color:p.borderTopColor}})()`);
  assert.equal(fc.style,'solid');assert.ok(fc.width>=1,`forced colours border: ${JSON.stringify(fc)}`);
  if(shots){const png=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${shots}/${seat}-forced-800.png`,Buffer.from(png.data,'base64'));}
  cases++;
 }
 console.log(`PASS whats-new actual App: ${cases} cases (due-only, hidden during a turn, seen only when drawn, close + late answer, instructor none, Help sheet, text-only lines, geometry both seats/themes/widths, DES-SHELL-34 shape/non-modal/contrast, forced colours)`);
}finally{await b.close();}
