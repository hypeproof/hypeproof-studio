// REQ-STUDIO-MEMORY-OVERVIEW (CGP-KNOW-R-025) — 작업별 기억 measured on the built CSS and the real panel markup in headless
// Chromium: personal and classroom-style shells, dark/light, 800/1420 px, normal and forced colours. Task names are headings,
// items render as text, every control (고치기, the correction field, 저장, 취소) is a 44px target with a focus ring, text is at
// least 14px at 4.5:1, nothing overflows; 고치기 opens a labelled field holding the item, 저장 asks the host once with the
// learner's words, and the host's no-op answer reads "바뀐 기억이 없어요". A view without an overview (minor cohort) draws none.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER)throw Error('Chromium required');console.log('NOT RUN memory overview: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const fixture=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ActivityMemoryPanel} from './src/ActivityMemoryPanel';createRoot(document.getElementById('root')).render(<ActivityMemoryPanel scopeKey="a/t"/>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const long='가'.repeat(80);
const entries=[{name:'a.md',at:Date.UTC(2026,9,29,1),text:'발표는 금요일이에요.\n'},{name:'b.md',at:Date.UTC(2026,9,28),text:'<b>색</b>은 초록'},{name:'c.md',at:Date.UTC(2026,9,27),text:'너는 발표를 잘해요.'}];
const overview={groups:[{task:'t1',title:`학급 신문 ${long}`,items:[{name:'a.md',at:entries[0].at,text:'발표는 금요일이에요.'}]},{task:null,title:'작업 정보가 없는 기억',items:[{name:'b.md',at:entries[1].at,text:'<b>색</b>은 초록'}]}],withheld:1};
const view={scope:'["a","t"]',folder:'.hypeproof/memory/',entries,other:0,unsafe:false,overview};
const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const color=value=>value.match(/[\d.]+/g).map(Number);
const contrast=(a,b)=>{const x=luminance(color(a)),y=luminance(color(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const evidence=process.env.MEMORY_OVERVIEW_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await launch(bin);
try{for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [800,1420])for(const forcedColors of [false,true]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await b.load(`<!doctype html><style>:root{${vars}}${css}</style><body class="${dark?'vscode-dark':'vscode-light'}" style="margin:0;background:var(--hp-bg-app-default);color:var(--hp-text-primary-default)"><div class="hps-shell" ${seat==='personal'?'data-chat-detail="personal"':''}><div class="tw-workspace"><aside class="tw-sources" style="width:360px;max-width:100%"><div id="root"></div></aside></div></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m),getState(){},setState(){}});</script><script>${fixture.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body>`,{width,height:1600,dark,forcedColors});
 await sleep(30);
 // A minor cohort's view carries no overview: nothing of it is drawn, the files stay.
 await b.evaluate(`window.postMessage({type:'activityMemoryState',view:${JSON.stringify({...view,overview:null})}},'*')`);await sleep(40);
 await b.evaluate(`document.querySelector('.tw-memory-entry').click()`);await sleep(40);
 assert.equal(await b.evaluate(`!!document.querySelector('[data-testid=memory-overview]')`),false,'no overview without one from the host');
 assert.equal(await b.evaluate(`document.querySelectorAll('.tw-memory-list > ul > li').length`),3,'the files are still listed');
 await b.evaluate(`window.postMessage({type:'activityMemoryState',view:${JSON.stringify(view)}},'*')`);await sleep(50);
 const measure=()=>b.evaluate(`(()=>{const panel=document.querySelector('[data-testid=memory-overview]');const bg=getComputedStyle(document.querySelector('.tw-sources')).backgroundColor;const page=getComputedStyle(document.body).backgroundColor;
  return {text:panel.textContent,headings:[...panel.querySelectorAll('h4,h5')].map(e=>e.textContent),xss:!!panel.querySelector('b,img'),bg:bg==='rgba(0, 0, 0, 0)'?page:bg,
  texts:[...panel.querySelectorAll('h4,h5,.tw-memory-text,.tw-memory-note,label,button,textarea')].map(e=>({cls:e.className||e.localName,font:parseFloat(getComputedStyle(e).fontSize),fg:getComputedStyle(e).color})),
  controls:[...panel.querySelectorAll('button,textarea')].map(x=>{const r=x.getBoundingClientRect();return {tag:x.localName,h:r.height,w:r.width,left:r.left,right:r.right,border:getComputedStyle(x).borderTopStyle};}),
  scroll:document.documentElement.scrollWidth>innerWidth,right:panel.getBoundingClientRect().right,sources:document.querySelector('.tw-sources').getBoundingClientRect().right}})()`);
 const check=(m,label)=>{
  for(const x of m.texts){assert.ok(x.font>=14,`${label} ${x.cls} ${x.font}px`);if(!forcedColors)assert.ok(contrast(x.fg,m.bg)>=4.5,`${label} ${x.cls} contrast ${x.fg}/${m.bg}`);}
  for(const x of m.controls){assert.ok(x.h>=44&&x.w>=44,`${label} ${x.tag} ${x.w}x${x.h}`);assert.ok(x.left>=0&&x.right<=Math.min(width,m.sources)+0.5,`${label} ${x.tag} inside the drawer`);assert.notEqual(x.border,'none',`${label} ${x.tag} is bounded`);}
  assert.equal(m.scroll,false,`${label} no horizontal scroll`);assert.ok(m.right<=m.sources+0.5,`${label} inside the drawer`);};
 const m=await measure();
 assert.deepEqual(m.headings,['작업별 기억',`학급 신문 ${long}`,'작업 정보가 없는 기억']);
 assert.ok(m.text.includes('기억 1개는 여기에 넣지 않았어요'),'withheld items are counted');
 assert.ok(!m.text.includes('잘해요'),'a withheld item never appears in the overview');
 assert.ok(m.text.includes('<b>색</b>은 초록'),'item text renders as text');assert.equal(m.xss,false);
 assert.equal(m.controls.filter(x=>x.tag==='button').length,2,'one 고치기 per item');
 check(m,'overview');
 const ring=await b.focusVisibleStyle('[data-testid=memory-overview] .tw-memory-actions button',['outline-width','outline-style']);
 assert.ok(parseFloat(ring['outline-width'])>=1&&ring['outline-style']!=='none','고치기 focus ring');
 // 고치기 opens a labelled field holding the item's words, focused.
 await b.evaluate(`document.querySelector('[data-testid=memory-overview] .tw-memory-actions button').click()`);await sleep(50);
 const form=await b.evaluate(`(()=>{const area=document.querySelector('.tw-memory-correct textarea');const label=document.querySelector('label[for="'+area.id+'"]');return {value:area.value,label:label?.textContent,focused:document.activeElement===area}})()`);
 assert.deepEqual(form,{value:'발표는 금요일이에요.',label:'바르게 고친 문장',focused:true});
 const fm=await measure();check(fm,'form');
 assert.equal(fm.controls.filter(x=>x.tag==='button').length,3,'저장 and 취소 for the open item, 고치기 for the other');
 const areaRing=await b.focusVisibleStyle('.tw-memory-correct textarea',['outline-width','outline-style']);
 assert.ok(parseFloat(areaRing['outline-width'])>=1&&areaRing['outline-style']!=='none','correction field focus ring');
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}-${forcedColors?'forced':'normal'}.png`,Buffer.from(shot.data,'base64'));}
 // 저장 sends the learner's words once, with the listed scope and the item's file; a second press while pending is ignored.
 await b.evaluate(`(()=>{const x=[...document.querySelectorAll('.tw-memory-correct button')].find(e=>e.textContent==='고친 내용 저장');x.click();x.click();})()`);
 const asked=await b.evaluate(`window.__posted.filter(m=>m.type==='activityMemoryAction')`);
 assert.equal(asked.length,1,'one request per press while pending');
 assert.deepEqual({scope:asked[0].scope,action:asked[0].action,name:asked[0].name,text:asked[0].text},{scope:view.scope,action:'correct',name:'a.md',text:'발표는 금요일이에요.'});
 // The host answers that nothing changed: the form closes and the status line says so.
 await b.evaluate(`window.postMessage({type:'activityMemoryState',requestId:${JSON.stringify(asked[0].requestId)},result:{action:'correct',name:'a.md',unchanged:true},view:${JSON.stringify(view)}},'*')`);await sleep(80);
 const after=await b.evaluate(`({form:!!document.querySelector('.tw-memory-correct'),status:document.querySelector('.tw-memory [role=status]').textContent,focus:document.activeElement===document.body})`);
 assert.deepEqual(after,{form:false,status:'바뀐 기억이 없어요.',focus:false});
 // 취소 closes the field without asking the host.
 await b.evaluate(`document.querySelector('[data-testid=memory-overview] .tw-memory-actions button').click()`);await sleep(40);
 await b.evaluate(`[...document.querySelectorAll('.tw-memory-correct button')].find(e=>e.textContent==='취소').click()`);await sleep(40);
 assert.equal(await b.evaluate(`!!document.querySelector('.tw-memory-correct')`),false);
 assert.equal(await b.evaluate(`document.activeElement===document.body`),false,'focus stays in the panel after 취소');
 assert.equal(await b.evaluate(`window.__posted.filter(m=>m.type==='activityMemoryAction').length`),1,'취소 sends nothing');
 console.log(`PASS memory overview ${seat} ${dark?'dark':'light'} ${width} ${forcedColors?'forced':'normal'}`);
}}finally{await b.close();}
