// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030) — the 내 작품 memory files list measured on the
// built CSS and the real panel markup in headless Chromium: personal and classroom-style shells,
// dark/light, 800/1420 px, normal and forced colours. Every control is a 44px target with a focus
// ring, every text is at least 14px with 4.5:1 contrast, nothing overflows the window, the folder
// is named, file text is shown as text (never markup), and 열기 / 지우기 ask the host with the
// listed scope and the exact file name.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER)throw Error('Chromium required');console.log('NOT RUN activity memory panel: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const fixture=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ActivityMemoryPanel} from './src/ActivityMemoryPanel';createRoot(document.getElementById('root')).render(<ActivityMemoryPanel scopeKey="a/t"/>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const long='가'.repeat(60);
const view={scope:'["a","t"]',folder:'.hypeproof/memory/',entries:[
  {name:'2026-10-29T01-00-00-000Z-0a1b2c3d.md',at:Date.UTC(2026,9,29,1),text:`좋아하는 색은 초록이에요.\n두 번째 줄 ${long}`},
  {name:'<img src=x onerror=alert(1)>.md'.replace(/[<>=()]/g,'_'),at:Date.UTC(2026,9,28),text:'<b>굵게</b> <img src=x onerror="window.__xss=1">'},
  {name:'big.md',at:Date.UTC(2026,9,27),text:null}],other:2,unsafe:false};
const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const color=value=>value.match(/[\d.]+/g).map(Number);
const contrast=(a,b)=>{const x=luminance(color(a)),y=luminance(color(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const evidence=process.env.ACTIVITY_MEMORY_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const b=await launch(bin);
try{for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [800,1420])for(const forcedColors of [false,true]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 // The panel sits in the 작업 자료 drawer; 360px is its default width.
 await b.load(`<!doctype html><style>:root{${vars}}${css}</style><body class="${dark?'vscode-dark':'vscode-light'}" style="margin:0;background:var(--hp-bg-app-default);color:var(--hp-text-primary-default)"><div class="hps-shell" ${seat==='personal'?'data-chat-detail="personal"':''}><div class="tw-workspace"><aside class="tw-sources" style="width:360px;max-width:100%"><div id="root"></div></aside></div></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m),getState(){},setState(){}});</script><script>${fixture.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body>`,{width,height:1400,dark,forcedColors});
 await new Promise(r=>setTimeout(r,30));
 assert.ok(await b.evaluate(`window.__posted.some(m=>m.type==='activityMemoryRequest')`),'mount asks the host for the list');
 assert.equal(await b.evaluate(`!!document.querySelector('[data-testid=activity-memory]')`),false,'no view, no panel');
 assert.equal(await b.evaluate(`!!document.querySelector('[data-testid=activity-memory-state]')`),false,'no store, no state line');
 // REQ-STUDIO-ACTIVITY-MEMORY-STATE (CGP-KNOW-R-022): a store that could not be read still says memory is on and says why, unexpanded.
 await b.evaluate(`window.postMessage({type:'activityMemoryState',view:${JSON.stringify({...view,entries:[],other:0,unsafe:true})}},'*')`);
 await new Promise(r=>setTimeout(r,50));
 const u=await b.evaluate(`({state:document.querySelector('[data-testid=activity-memory-state]')?.textContent,text:document.querySelector('[data-testid=activity-memory]').textContent})`);
 assert.equal(u.state,'AI 기억: 켜짐 · .hypeproof/memory/');assert.ok(u.text.includes('읽지 않았어요'),'an unreadable store is named before expanding');
 await b.evaluate(`window.postMessage({type:'activityMemoryState',view:${JSON.stringify(view)}},'*')`);
 await new Promise(r=>setTimeout(r,50));
 // The state line shows before the list is opened: on, and where the files live; a text, never a control.
 const st=await b.evaluate(`(()=>{const line=document.querySelector('[data-testid=activity-memory-state]');const panel=document.querySelector('[data-testid=activity-memory]');const bg=getComputedStyle(document.querySelector('.tw-sources')).backgroundColor;const page=getComputedStyle(document.body).backgroundColor;
  return {text:line?.textContent,tag:line?.localName,fonts:line?[line,...line.querySelectorAll('*')].map(e=>parseFloat(getComputedStyle(e).fontSize)):[],fg:line&&getComputedStyle(line).color,bg:bg==='rgba(0, 0, 0, 0)'?page:bg,
  visible:!!line&&(()=>{const r=line.getBoundingClientRect();let o=1;for(let e=line;e;e=e.parentElement)o*=parseFloat(getComputedStyle(e).opacity);const hit=document.elementFromPoint(r.left+Math.min(r.width,40)/2,r.top+Math.min(r.height,20)/2);
   return r.height>=parseFloat(getComputedStyle(line).fontSize)&&r.right<=innerWidth&&o>=.99&&getComputedStyle(line).visibility==='visible'&&!!hit&&line.contains(hit);})(),code:line?.querySelector('code')?.textContent,
  controls:line?line.querySelectorAll('button,input,select,[role=switch],[role=checkbox],[aria-pressed],[aria-checked],[tabindex]').length:-1,
  off:/꺼짐|끄기|선생님이 정해요/.test(panel.textContent),switches:panel.querySelectorAll('input,[role=switch],[role=checkbox],[aria-checked]').length,
  listOpen:!!document.getElementById('tw-memory-list')}})()`);
 assert.equal(st.text,'AI 기억: 켜짐 · .hypeproof/memory/','the state line names on and the folder');assert.equal(st.code,'.hypeproof/memory/');
 assert.equal(st.listOpen,false);assert.ok(st.visible,'the state line is drawn without opening the list');
 assert.equal(st.tag,'p');assert.equal(st.controls,0,'the state is text, not a switch');assert.equal(st.switches,0);assert.equal(st.off,false,'no off state or instructor choice');
 for(const f of st.fonts)assert.ok(f>=14,`state line ${f}px`);if(!forcedColors)assert.ok(contrast(st.fg,st.bg)>=4.5,`state line contrast ${st.fg}/${st.bg}`);
 await b.evaluate(`document.querySelector('.tw-memory-entry').click()`);
 await new Promise(r=>setTimeout(r,50));
 const m=await b.evaluate(`(()=>{const panel=document.querySelector('[data-testid=activity-memory]');const bg=getComputedStyle(document.querySelector('.tw-sources')).backgroundColor;const page=getComputedStyle(document.body).backgroundColor;
  return {entry:document.querySelector('.tw-memory-entry').textContent,expanded:document.querySelector('.tw-memory-entry').getAttribute('aria-expanded'),panelText:panel.textContent,
  xss:window.__xss===1||!!panel.querySelector('b,img'),bg:bg==='rgba(0, 0, 0, 0)'?page:bg,
  texts:[...panel.querySelectorAll('.tw-memory-state,.tw-memory-state code,.tw-memory-text,.tw-memory-name,.tw-memory-note:not(:empty),time,button')].map(e=>({cls:e.className||e.localName,font:parseFloat(getComputedStyle(e).fontSize),fg:getComputedStyle(e).color})),
  buttons:[...panel.querySelectorAll('button')].map(x=>{const r=x.getBoundingClientRect();return {h:r.height,w:r.width,left:r.left,right:r.right,border:getComputedStyle(x).borderTopStyle};}),
  scroll:document.documentElement.scrollWidth>innerWidth,right:panel.getBoundingClientRect().right,
  multiline:getComputedStyle(document.querySelector('.tw-memory-text')).whiteSpace}})()`);
 assert.equal(m.entry.trim(),'AI 기억 파일 · 3개');assert.equal(m.expanded,'true');
 assert.ok(m.panelText.includes('.hypeproof/memory/'),'the folder is named');
 assert.ok(m.panelText.includes('목록에 없는 파일 2개'),'unlisted files are counted');
 assert.ok(m.panelText.includes('<b>굵게</b>'),'file text renders as text');assert.equal(m.xss,false,'no markup from a file');
 assert.ok(m.panelText.includes('열기로 확인해 주세요'),'a large file is listed without its text');
 assert.equal(m.multiline,'pre-wrap','line breaks in a memory file stay visible');
 for(const x of m.texts){assert.ok(x.font>=14,`${x.cls} ${x.font}px`);if(!forcedColors)assert.ok(contrast(x.fg,m.bg)>=4.5,`${x.cls} contrast ${x.fg}/${m.bg}`);}
 assert.equal(m.buttons.length,1+view.entries.length*2);
 for(const x of m.buttons){assert.ok(x.h>=44&&x.w>=44,`button ${x.w}x${x.h}`);assert.ok(x.left>=0&&x.right<=width,'inside the window');assert.notEqual(x.border,'none','buttons are bounded');}
 assert.equal(m.scroll,false,'no horizontal scroll');assert.ok(m.right<=width);
 const ring=await b.focusVisibleStyle('.tw-memory-actions button',['outline-width','outline-style']);
 assert.ok(parseFloat(ring['outline-width'])>=1&&ring['outline-style']!=='none','button focus ring');
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}-${forcedColors?'forced':'normal'}.png`,Buffer.from(shot.data,'base64'));}
 // 지우기 asks the host with the listed scope and the exact name; a second press while pending is ignored.
 await b.evaluate(`(()=>{const x=[...document.querySelectorAll('.tw-memory-actions button')].find(e=>e.getAttribute('aria-label')==='지우기: big.md');x.click();x.click();})()`);
 const asked=await b.evaluate(`window.__posted.filter(m=>m.type==='activityMemoryAction')`);
 assert.equal(asked.length,1,'one request per press while pending');
 assert.deepEqual({scope:asked[0].scope,action:asked[0].action,name:asked[0].name},{scope:view.scope,action:'delete',name:'big.md'});
 // The host answers: the row is gone, a status line says so, and focus stays in the panel.
 await b.evaluate(`document.querySelector('[aria-label="지우기: big.md"]').focus()`);
 await b.evaluate(`window.postMessage({type:'activityMemoryState',requestId:${JSON.stringify(asked[0].requestId)},result:{action:'delete',name:'big.md'},view:${JSON.stringify({...view,entries:view.entries.slice(0,2)})}},'*')`);
 await new Promise(r=>setTimeout(r,100));
 const after=await b.evaluate(`({rows:document.querySelectorAll('.tw-memory-list li').length,status:document.querySelector('.tw-memory [role=status]').textContent,focus:document.activeElement?.className})`);
 assert.equal(after.rows,2);assert.match(after.status,/big\.md.*지웠어요/);assert.equal(after.focus,'tw-memory-entry','focus lands on the panel entry, not body');
 // The store goes away (an instructor seat, no task workspace): the state line goes with it.
 await b.evaluate(`window.postMessage({type:'activityMemoryState',view:null},'*')`);await new Promise(r=>setTimeout(r,50));
 assert.equal(await b.evaluate(`!!document.querySelector('[data-testid=activity-memory-state]')`),false,'no store, no state line');
 console.log(`PASS activity memory panel ${seat} ${dark?'dark':'light'} ${width} ${forcedColors?'forced':'normal'}`);
}}finally{await b.close();}
