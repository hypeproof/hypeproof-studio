// CGP-ART-R-020 / CGP-ART-D-020 (REQ-STUDIO-TASK-ACTIVITY) — the real ChatPanel in headless Chromium:
// chip counts equal the planted entries (no entry, no row), each chip opens its own list capped at 20
// with 더 보기, live entries of another task are dropped, a changed file the turn review lists opens that
// review at the file, and the geometry holds (44px targets, >=14px text, wrap at 320px, focus ring,
// forced colours) for personal and classroom seats in both themes.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';function Fixture(){const [props,setProps]=useState(window.fixture);window.patch=patch=>setProps(old=>({...old,...patch}));return <ChatPanel {...props}/>};createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN task activity layout: no Chromium');process.exit(0);}
const evidence=process.env.TASK_ACTIVITY_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});const pause=(ms=120)=>new Promise(r=>setTimeout(r,ms));
const f=(id,verb,target,inside)=>({id,verb,target,...(inside?{inside:true}:{})});
const searches=Array.from({length:25},(_,i)=>f(`q${i}`,'search',`검색어 ${i+1}`));
const activity=[f('r1','read','index.html',1),f('r2','read','css/style.css',1),f('r3','read','index.html',1),f('r4','read','notes/아주/긴/폴더/이름이/계속/이어지는/경로/그리고/더/깊은/하위/폴더/마지막-파일-이름.md',1),
 f('c1','created','css/new.css',1),f('w1','changed','index.html',1),f('w2','changed','old/page.html',1),f('p1','web','https://example.org/docs',0),...searches];
const messages=[{id:'u1',role:'user',content:'홈페이지 고쳐 줘',createdAt:1},{id:'t1',role:'tool',content:'',createdAt:2,tool:{icon:'🔧',label:'Edit(index.html)',state:'done'}},
 {id:'a1',role:'assistant',content:'고쳤어요.',createdAt:3,activity:activity.slice(0,20)},{id:'u2',role:'user',content:'더 찾아 줘',createdAt:4},{id:'a2',role:'assistant',content:'찾았어요.',createdAt:5,activity:activity.slice(20)}];
const review={turnId:'s9',state:'open',added:['css/new.css'],changed:['index.html','old/page.html'],deleted:[],notCovered:[],files:[{path:'index.html',added:1,removed:1,lines:[{kind:'removed',text:'<h1>old</h1>\n'},{kind:'added',text:'<h1>new</h1>\n'}]},{path:'old/page.html',added:1,removed:1,lines:[{kind:'removed',text:'<p>old</p>\n'},{kind:'added',text:'<p>new</p>\n'}]}]};
const host=(msg)=>`window.postMessage(${JSON.stringify(msg)},'*')`;
const b=await launch(bin);try{for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420])for(const forcedColors of (width===800?[false,true]:[false])){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,activity_kind:seat,lesson:null},taskWorkspace:seat==='personal'?{tasks:[],sources:[],activeTaskId:'task-one'}:undefined});
 const load=async(msgs)=>{await b.load(`<!doctype html><html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="display:block;height:900px"><div id="root"></div></div><script>window.fixture=${JSON.stringify(chatPanelProps({config,messages:msgs}))};</script><script>${js.outputFiles[0].text}</script></body></html>`,{width,height:900,dark,forcedColors});await pause();};
 // Negative control: the same conversation without entries draws no row.
 await load(messages.map(({activity,...m})=>m));assert.equal(await b.evaluate(`document.querySelectorAll('[data-testid=task-activity]').length`),0,'no entry, no row');
 await load(messages);
 const row=await b.evaluate(`(()=>{const s=document.querySelector('[data-testid=task-activity]');const chips=[...s.querySelectorAll('.hps-task-activity-chip')].map(c=>{const r=c.getBoundingClientRect(),st=getComputedStyle(c);return {text:c.textContent,w:r.width,h:r.height,font:parseFloat(st.fontSize),right:r.right,icon:!!c.querySelector('svg[data-icon]')}});const sr=s.getBoundingClientRect();return {title:s.querySelector('.hps-task-activity-title').textContent,titleFont:parseFloat(getComputedStyle(s.querySelector('.hps-task-activity-title')).fontSize),chips,secRight:sr.right,page:document.documentElement.scrollWidth}})()`);
 assert.equal(row.title,'AI가 한 일');assert.ok(row.titleFont>=14,JSON.stringify(row));
 assert.deepEqual(row.chips.map(c=>c.text),['읽음 3','만듦 1','바꿈 2','웹 페이지 1','검색 25'],'counts = distinct planted entries per verb');
 for(const c of row.chips){assert.ok(c.w>=44&&c.h>=44&&c.font>=14&&c.icon,JSON.stringify(c));assert.ok(c.right<=row.secRight+0.5,'chips wrap inside the row');}
 assert.ok(row.page<=width+1,`no horizontal page scroll at ${width}: ${row.page}`);
 const ring=await b.focusVisibleStyle('.hps-task-activity-chip');assert.ok(parseFloat(ring['outline-width'])>=2&&ring['outline-style']!=='none',JSON.stringify(ring));
 if(forcedColors)assert.ok(parseFloat(await b.evaluate(`getComputedStyle(document.querySelector('.hps-task-activity-chip')).borderTopWidth`))>=1,'forced colours keep the chip boundary');
 // 검색: capped at 20, 더 보기 shows the rest.
 const chip=(label)=>`[...document.querySelectorAll('.hps-task-activity-chip')].find(c=>c.textContent.startsWith('${label}'))`;
 await b.evaluate(`${chip('검색')}.click()`);await pause();
 let list=await b.evaluate(`(()=>({n:document.querySelectorAll('#hps-task-activity-list li').length,expanded:${chip('검색')}.getAttribute('aria-expanded'),more:document.querySelector('.hps-task-activity-more')?.textContent,moreH:document.querySelector('.hps-task-activity-more')?.getBoundingClientRect().height,font:parseFloat(getComputedStyle(document.querySelector('.hps-task-activity-target')).fontSize)}))()`);
 assert.deepEqual([list.n,list.expanded,list.more],[20,'true','더 보기 (5개)']);assert.ok(list.moreH>=44&&list.font>=14,JSON.stringify(list));
 await b.evaluate(`document.querySelector('.hps-task-activity-more').click()`);await pause();assert.equal(await b.evaluate(`document.querySelectorAll('#hps-task-activity-list li').length`),25);
 // 읽음: the long path is middle-ellipsized on screen, whole for assistive tech.
 await b.evaluate(`${chip('읽음')}.click()`);await pause();
 const read=await b.evaluate(`[...document.querySelectorAll('#hps-task-activity-list li .hps-task-activity-target')].map(e=>({shown:e.querySelector('[aria-hidden]').textContent,full:e.querySelector('.hps-sr-only').textContent}))`);
 assert.deepEqual(read.map(r=>r.full),['index.html','css/style.css','notes/아주/긴/폴더/이름이/계속/이어지는/경로/그리고/더/깊은/하위/폴더/마지막-파일-이름.md']);assert.ok(read[2].shown.includes('…')&&read[2].shown.endsWith('이름.md'),JSON.stringify(read[2]));
 // 바꿈 without a review: no link, an honest note.
 await b.evaluate(`${chip('바꿈')}.click()`);await pause();
 assert.equal(await b.evaluate(`document.querySelectorAll('.hps-task-activity-review').length`),0);assert.ok(await b.evaluate(`!!document.querySelector('.hps-task-activity-note')`));
 if(seat==='personal'){
  // Live: another task's entry is dropped; this task's adds to the count; a history load replaces live ones.
  await b.evaluate(host({type:'taskActivityFact',streamId:'s9',taskId:'task-other',fact:f('L0','read','other.md',1)}));await b.evaluate(host({type:'taskActivityFact',streamId:'s9',fact:f('L1','read','live.md',1)}));await b.evaluate(host({type:'taskActivityFact',streamId:'s9',fact:f('L1','read','live.md',1)}));await pause();
  assert.equal(await b.evaluate(`${chip('읽음')}.textContent`),'읽음 4','live entry once, other task dropped');
  await b.evaluate(`window.patch({config:{...window.fixture.config,taskWorkspace:{...window.fixture.config.taskWorkspace,activeTaskId:'task-two'}}})`);await pause();
  assert.equal(await b.evaluate(`${chip('읽음')}.textContent`),'읽음 3','a task switch drops live entries');
  await b.evaluate(`window.patch({config:window.fixture.config})`);await pause();
  // The review link: only files the open turn review lists get 바뀐 곳 보기, and it opens that file's comparison.
  await b.evaluate(host({type:'turnReviewState',view:review}));await pause();
  await b.evaluate(`${chip('바꿈')}.getAttribute('aria-expanded')==='true'||${chip('바꿈')}.click()`);await pause();
  const links=await b.evaluate(`[...document.querySelectorAll('.hps-task-activity-review')].map(e=>({label:e.getAttribute('aria-label'),h:e.getBoundingClientRect().height,w:e.getBoundingClientRect().width}))`);
  assert.deepEqual(links.map(l=>l.label),['index.html 바뀐 곳 보기','old/page.html 바뀐 곳 보기']);assert.ok(links[0].h>=44&&links[0].w>=44);
  await b.evaluate(`document.querySelector('.hps-task-activity-review').click()`);await pause(250);
  // The right file: with two files in the review, the link of one opens and focuses that file only.
  const where=()=>`(()=>{const d=document.querySelector('[data-testid=turn-review] details');const files=[...document.querySelectorAll('.hps-turn-file')];const at=n=>files.find(l=>l.querySelector('code').textContent===n);return {open:d.open,diffs:files.filter(l=>l.querySelector('.hps-turn-diff')).map(l=>l.querySelector('code').textContent),focusIn:files.filter(l=>l.contains(document.activeElement)).map(l=>l.querySelector('code').textContent)}})()`;
  assert.deepEqual(await b.evaluate(where()),{open:true,diffs:['index.html'],focusIn:['index.html']},'바뀐 곳 보기 opens the review at that file only');
  await b.evaluate(`[...document.querySelectorAll('.hps-task-activity-review')].find(e=>e.getAttribute('aria-label').startsWith('old/page.html')).click()`);await pause(250);
  assert.deepEqual(await b.evaluate(where()),{open:true,diffs:['index.html','old/page.html'],focusIn:['old/page.html']},'a second link focuses its own file, not the first');
  if(evidence){await b.evaluate(`document.querySelector('[data-testid=task-activity]').scrollIntoView({block:'start'})`);await pause();const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/task-activity-${seat}-${width}-${dark?'dark':'light'}${forcedColors?'-forced':''}.png`,Buffer.from(shot.data,'base64'));}
  // A new turn's review never takes focus from an old click.
  await b.evaluate(`document.body.focus();document.activeElement.blur()`);await b.evaluate(host({type:'turnReviewState',view:{...review,turnId:'s10'}}));await pause(250);
  assert.equal(await b.evaluate(`!!document.activeElement?.closest('[data-testid=turn-review]')`),false,'stale focus request is bound to its turn');
  await b.evaluate(host({type:'history',messages:messages}));await pause();
 } else if(evidence){await b.evaluate(`document.querySelector('[data-testid=task-activity]').scrollIntoView({block:'start'})`);await pause();const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/task-activity-${seat}-${width}-${dark?'dark':'light'}${forcedColors?'-forced':''}.png`,Buffer.from(shot.data,'base64'));}
 console.log('PASS',seat,width,dark?'dark':'light',forcedColors?'forced':'normal');
}}finally{await b.close()}
console.log('PASS task activity counts, lists, live scope, review link and geometry');
