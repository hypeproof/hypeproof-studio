// CGP-CHAT-R-014: event kinds, not URL inference, in actual citation and workspace surfaces.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN citation kinds: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'kind-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';import {TaskWorkspace} from './src/TaskWorkspace';const root=createRoot(document.getElementById('root'));window.paintKinds=(view=window.__kindView)=>{const panel=<ChatPanel {...window.__kindProps}/>;root.render(window.__personal?<TaskWorkspace view={view} messages={window.__kindProps.messages} busy={false} error={null} onDismissError={()=>{}}>{panel}</TaskWorkspace>:panel)};paintKinds();`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const kinds=['web','lesson','file',undefined,'future'],labels=['웹','수업 자료','내 파일','출처','출처'];
const citations=kinds.map((kind,i)=>({url:`https://same.test/${i}/lesson.pdf`,title:`자료 ${i+1}`,domain:'same.test',tier:4,...(kind===undefined?{}:{kind})}));
// CGP-CHAT-D-014: the kind is a text label BEFORE the title on the title's own line, at least the title's
// size (14px floor in personal chat, DEC-29), and the row is exactly as tall as without the label.
const geometry=sel=>`(()=>{const out=[];for(const row of document.querySelectorAll(${JSON.stringify(sel)})){const k=row.querySelector('.hps-source-kind');if(!k){out.push({missing:true});continue;}
 const te=row.querySelector('.hps-cit-title,.cp-citation-title-text');const n=te||k.nextSibling;const r=document.createRange();if(te){r.selectNodeContents(te);}else if(n&&n.nodeType===3&&n.textContent.trim()===''&&n.nextSibling){r.setStartBefore(n.nextSibling);r.setEndAfter(n.nextSibling);}else if(n){r.selectNodeContents(n);}else{out.push({noTitle:true});continue;}
 const t=[...r.getClientRects()].find(x=>x.width>0)||r.getBoundingClientRect(),kr=k.getBoundingClientRect(),ks=getComputedStyle(k),tn=n.nodeType===1?n:(n.nextSibling&&n.nextSibling.nodeType===1?n.nextSibling:k.parentElement),ts=getComputedStyle(tn.nodeType===1?tn:k.parentElement);
 const h0=row.getBoundingClientRect().height;k.style.display='none';const h1=row.getBoundingClientRect().height;k.style.display='';
 out.push({text:k.textContent,before:kr.right<=t.left+0.5,sameLine:kr.top<t.bottom&&kr.bottom>t.top,kindPx:parseFloat(ks.fontSize),titlePx:parseFloat(ts.fontSize),h0,h1,inKindLine:!!k.closest('.cp-citation-domain,.hps-cit-domain,small')});}return out})()`;
const checkGeometry=async(sel,personal,where)=>{const rows=await b.evaluate(geometry(sel));assert.equal(rows.length,labels.length,`${where}: one row per source`);
 for(const [i,g] of rows.entries()){assert.ok(!g.missing&&!g.noTitle,`${where} row ${i}: label and title present`);
  assert.equal(g.before,true,`${where} row ${i}: kind label sits before the title`);assert.equal(g.sameLine,true,`${where} row ${i}: kind shares the title line`);
  assert.equal(g.inKindLine,false,`${where} row ${i}: kind is not on the domain line`);
  assert.ok(g.kindPx>=g.titlePx-0.01,`${where} row ${i}: kind ${g.kindPx}px not smaller than title ${g.titlePx}px`);if(personal)assert.ok(g.kindPx>=14,`${where} row ${i}: personal kind ${g.kindPx}px >= 14px`);
  assert.ok(Math.abs(g.h0-g.h1)<0.5,`${where} row ${i}: row height ${g.h0} unchanged by the label (${g.h1})`);}};
const b=await launch(bin),evidence=process.env.CITATION_KIND_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});const settle=()=>new Promise(r=>setTimeout(r,60));
try{
 for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420]){
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  const view={scope:'kind-fixture',revision:1,activeTaskId:'task',tasks:[{id:'task',title:'출처 확인',createdAt:1,updatedAt:1,messageCount:1}],sourceSelection:null};
  const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?view:undefined});
  const props=chatPanelProps({config,messages:[{id:'answer',role:'assistant',createdAt:1,content:'자료를 비교해 보세요.',citations}]});
  await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.__kindProps=${JSON.stringify(props)};window.__kindView=${JSON.stringify(view)};window.__personal=${seat==='personal'};window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:1000,dark});await settle();
  const rack=seat==='personal'?'.cp-rack':'.hps-cit-rack';
  assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('${rack} .hps-source-kind')].map(e=>e.textContent)`),labels);
  await checkGeometry(seat==='personal'?'.cp-rack .cp-citation':'.hps-cit-rack .hps-cit-chip',seat==='personal',`${seat} rack ${width} ${dark?'dark':'light'}`);
  if(seat==='personal'){
   assert.match(await b.evaluate(`document.querySelector('.cp-citation').getAttribute('aria-label')`),/^웹,/);
   await b.evaluate(`document.querySelector('.cp-citation').click()`);await settle();
   assert.equal(await b.evaluate(`document.querySelector('.cp-preview .hps-source-kind').textContent`),'웹');
   assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('.tw-source-list .hps-source-kind')].map(e=>e.textContent)`),[...labels].reverse());
   if(await b.evaluate(`!!document.querySelector('.tw-source-list button')&&document.querySelector('.tw-source-list button').getBoundingClientRect().width>0`))await checkGeometry('.tw-source-list button',true,`source list ${width} ${dark?'dark':'light'}`);
   await b.evaluate(`document.querySelector('.cp-preview .tw-pin').click()`);assert.deepEqual(await b.evaluate(`__posted.filter(m=>m.type==='taskSourceSelection').at(-1)`),{type:'taskSourceSelection',selection:{url:citations[0].url,pinned:true}});
   await b.evaluate(`paintKinds({...__kindView,sourceSelection:{url:${JSON.stringify(citations[0].url)},pinned:true}})`);await settle();
   assert.equal(await b.evaluate(`document.querySelector('.cp-preview .tw-pin').getAttribute('aria-pressed')`),'true');
   await b.evaluate(`document.querySelector('.cp-preview .tw-pin').click()`);assert.equal(await b.evaluate(`__posted.filter(m=>m.type==='taskSourceSelection').at(-1).selection.pinned`),false);
   await b.evaluate(`document.querySelector('.tw-source-close').click()`);await settle();
  }else{
   await b.evaluate(`document.querySelector('.hps-cit-chip').click()`);assert.deepEqual(await b.evaluate(`__posted.filter(m=>m.type==='openExternal').at(-1)`),{type:'openExternal',url:citations[0].url});
  }
  const visible=await b.evaluate(`(()=>{const e=document.querySelector('${rack} .hps-source-kind');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0 && r.height>0 && r.left>=0 && r.right<=innerWidth})()`);assert.equal(visible,true,'kind is visible in narrow and wide panes');
  if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
 }
 console.log('PASS source kinds across 12 actual ChatPanel states; URL-independent fallback, label before the title at unchanged row height, preview/list labels and unchanged pin/open payloads');
}finally{await b.close();}
