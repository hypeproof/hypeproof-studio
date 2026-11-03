// DES-CGP-AGENT-57: actual mounted ChatPanel and shipped CSS, including recovery behavior.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chatConfig,chatPanelProps} from './sx-screen-fixtures.mjs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const props=chatPanelProps(),callbacks=Object.entries(props).filter(([,v])=>typeof v==='function').map(([k])=>`${k}:()=>{}`).join(',');
const asset=await build({entryPoints:[`${root}/webview-ui/src/main.tsx`],bundle:true,write:false,outdir:'out',loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=asset.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';window.mount=(config,extra)=>createRoot(document.getElementById('root')).render(<ChatPanel {...${JSON.stringify(props)}} {...{${callbacks}}} {...(extra||{})} config={config} onSend={(...a)=>window.sent.push(a)}/>);`,resolveDir:root+'/webview-ui',loader:'tsx'},bundle:true,write:false,outdir:'fixture-assets',format:'iife',platform:'browser',loader:{'.svg':'dataurl'},logLevel:'silent'})).outputFiles.find(f=>f.path.endsWith('.js')).text;
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN: missing-folder browser unavailable');process.exit(0);}
const browser=await launch(bin),evidence=process.env.MISSING_FOLDER_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const delay=()=>new Promise(r=>setTimeout(r,80));
const draft='보관할 초안 <img src=x onerror=alert(1)>\n'+ '아주 긴 내용도 그대로 보관합니다. '.repeat(12);
const open=async(config,width,dark,extra)=>{
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await browser.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.sent=[];window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`,{width,height:900,dark});
  await browser.evaluate(`mount(${JSON.stringify(config)},${JSON.stringify(extra||null)})`);await delay();
  await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config)}}}));window.dispatchEvent(new MessageEvent('message',{data:{type:'missingTaskFolder',activityId:'a1',${config.activity.kind==='personal'?"taskId:'t1',":''}notice:{message:'이 작업의 폴더를 찾을 수 없어요.',action:'다시 고르기'}}}));`);await delay();
};
try{
 for(const seat of ['personal','classroom'])for(const dark of [false,true])for(const width of [320,800,1420]){
  const config=chatConfig(3,{profile:{...chatConfig().profile,lesson:null,activity_kind:seat},activity:{id:'a1',name:'작업',kind:seat,workspace:'/w',verified:true},activityDraft:{text:draft,images:[],queued:null},...(seat==='personal'?{taskWorkspace:{scope:'a',revision:1,activeTaskId:'t1',tasks:[{id:'t1',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null}}:{})});
  await open(config,width,dark);
  const m=await browser.evaluate(`(()=>{const el=document.querySelector('[data-testid=missing-task-folder]'),ta=document.querySelector('.hps-input textarea');if(!el)return {notice:false,readOnly:ta.readOnly};const wrap=el.closest('.hps-input'),buttons=[...el.querySelectorAll('button')],r=el.getBoundingClientRect(),tr=ta.getBoundingClientRect();return {notice:true,inside:!!wrap,readOnly:ta.readOnly,value:ta.value,buttons:buttons.map(b=>({text:b.textContent,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,x:b.getBoundingClientRect().x,y:b.getBoundingClientRect().y,font:parseFloat(getComputedStyle(b).fontSize)})),draftBelow:tr.top>=r.bottom,overflow:document.documentElement.scrollWidth>innerWidth,tools:!!wrap.querySelector('.hps-composer-tools'),send:!!wrap.querySelector('.hps-btn-send'),script:!!wrap.querySelector('img'),live:el.getAttribute('aria-live')}})()`);
  if(seat==='classroom'){assert.equal(m.notice,false);continue;}
  assert.equal(m.inside,true);assert.equal(m.readOnly,true);assert.equal(m.value,draft);assert.equal(m.draftBelow,true);assert.equal(m.overflow,false);assert.equal(m.tools,false);assert.equal(m.send,false);assert.equal(m.script,false);assert.equal(m.live,'polite');assert.deepEqual(m.buttons.map(x=>x.text),['다시 확인','다시 고르기']);for(const b of m.buttons)assert.ok(b.w>=44&&b.h>=44&&b.font>=14);
  if(width===320){assert.equal(m.buttons[0].x,m.buttons[1].x);assert.ok(m.buttons[1].y>=m.buttons[0].y+m.buttons[0].h);}
  await browser.evaluate(`document.querySelector('.hps-input textarea').focus()`);
  for(const expected of ['다시 고르기','다시 확인']){
   await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
   await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
   assert.equal(await browser.evaluate(`document.activeElement.textContent`),expected);
   assert.ok(await browser.evaluate(`parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`));
  }
  // Read-only is not only the attribute: synthetic edit paths must each be refused by their own guard.
  await browser.evaluate(`(()=>{const ta=document.querySelector('.hps-input textarea'),out={};posted.length=0;sent.length=0;
   const dt=()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'p.png',{type:'image/png'}));return d};
   const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});ta.dispatchEvent(enter);out.enterPrevented=enter.defaultPrevented;
   const paste=new ClipboardEvent('paste',{clipboardData:dt(),bubbles:true,cancelable:true});ta.dispatchEvent(paste);out.pastePrevented=paste.defaultPrevented;
   const tp=new DataTransfer();tp.setData('text/plain','붙여넣기');const text=new ClipboardEvent('paste',{clipboardData:tp,bubbles:true,cancelable:true});ta.dispatchEvent(text);out.textPastePrevented=text.defaultPrevented;
   const drop=new DragEvent('drop',{dataTransfer:dt(),bubbles:true,cancelable:true});ta.dispatchEvent(drop);out.dropPrevented=drop.defaultPrevented;
   const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(ta,'바뀐 내용');ta.dispatchEvent(new Event('input',{bubbles:true}));
   window.__g=out})()`);await delay();
  const g=await browser.evaluate(`(()=>{const ta=document.querySelector('.hps-input textarea'),out=window.__g;out.value=ta.value;out.posted=posted.map(m=>m.type);out.sent=sent.length;out.thumbs=document.querySelectorAll('.hps-input img, .hps-staged-photo, [data-testid=staged-photo]').length;return out})()`);
  assert.equal(g.enterPrevented,false,'Enter must return before preventDefault while recovery holds');assert.deepEqual(g.posted,[],'no host request from Enter, paste or drop');assert.equal(g.sent,0);
  assert.equal(g.pastePrevented,true,'image paste is refused');assert.equal(g.textPastePrevented,true,'text paste is refused');assert.equal(g.dropPrevented,true,'file drop is refused');assert.equal(g.thumbs,0);
  assert.equal(g.value,draft,'onChange cannot rewrite the read-only draft');
  await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'missingTaskFolder',activityId:'a1',taskId:'other-task',notice:null}}))`);await delay();
  assert.equal(await browser.evaluate(`document.querySelector('.hps-input textarea').readOnly`),true,'foreign task cannot clear recovery');
  if(width===320){
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
   assert.ok(await browser.evaluate(`parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`));
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'none'},{name:'prefers-color-scheme',value:dark?'dark':'light'}]});
  }
  if(evidence){const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'));}
  await browser.evaluate(`posted.length=0;document.querySelector('[data-testid=missing-task-folder] button').click()`);await delay();assert.equal(await browser.evaluate(`posted.filter(m=>m.type==='missingTaskFolderRequest').length`),1);assert.equal(await browser.evaluate(`sent.length`),0);
  await browser.evaluate(`document.querySelectorAll('[data-testid=missing-task-folder] button')[1].click()`);assert.equal(await browser.evaluate(`posted.filter(m=>m.type==='missingTaskFolderRepick').length`),1);
  await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'missingTaskFolder',activityId:'a1',taskId:'t1',notice:null}}))`);await delay();assert.equal(await browser.evaluate(`document.querySelector('.hps-input textarea').readOnly`),false);assert.equal(await browser.evaluate(`sent.length`),0);assert.equal(await browser.evaluate(`document.querySelector('.hps-input textarea').value`),draft);
 }

 // Owner decision: pending file chips are not shown in recovery, and the flex column wins over the file-context grid.
 for(const width of [320,800]){
  const config=chatConfig(3,{profile:{...chatConfig().profile,lesson:null,activity_kind:'personal'},activity:{id:'a1',name:'작업',kind:'personal',workspace:'/w',verified:true},activityDraft:{text:draft,images:[],queued:null},taskWorkspace:{scope:'a',revision:1,activeTaskId:'t1',tasks:[{id:'t1',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null}});
  await open(config,width,false,{fileAttachment:{path:'notes/a.md',bytes:12,text:'hello'},fileAttachNotice:'파일을 붙였어요'});
  const c=await browser.evaluate(`(()=>{const w=document.querySelector('.hps-input'),cs=getComputedStyle(w);return {chip:!!document.querySelector('.hps-file-context,.hps-file-context-stack,.hps-file-attach-notice'),attr:w.hasAttribute('data-file-context'),display:cs.display,dir:cs.flexDirection,cols:cs.gridTemplateColumns,notice:!!document.querySelector('[data-testid=missing-task-folder]')}})()`);
  assert.equal(c.notice,true);assert.equal(c.chip,false,'file chips hidden in recovery');assert.equal(c.attr,false);assert.equal(c.display,'flex');assert.equal(c.dir,'column');
  // Even if a chip stack were rendered, the recovery rule must outrank main's data-file-context grid.
  const forced=await browser.evaluate(`(()=>{const w=document.querySelector('.hps-input');w.setAttribute('data-file-context','true');const s=document.createElement('div');s.className='hps-file-context-stack';w.prepend(s);const cs=getComputedStyle(w);return {display:cs.display,dir:cs.flexDirection,stack:getComputedStyle(s).display}})()`);
  assert.equal(forced.display,'flex');assert.equal(forced.dir,'column');assert.equal(forced.stack,'none');
 }
 // Stop stays reachable while a turn streams during recovery; send never appears.
 {
  const config=chatConfig(3,{profile:{...chatConfig().profile,lesson:null,activity_kind:'personal'},activity:{id:'a1',name:'작업',kind:'personal',workspace:'/w',verified:true},activityDraft:{text:draft,images:[],queued:null},taskWorkspace:{scope:'a',revision:1,activeTaskId:'t1',tasks:[{id:'t1',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null}});
  await open(config,800,false,{streaming:true,streamingId:'m1'});
  const st=await browser.evaluate(`(()=>{const w=document.querySelector('.hps-input');return {stop:!!w.querySelector('.hps-btn-stop'),send:!!w.querySelector('.hps-btn-send'),roll:!!w.querySelector('.hps-btn-roll'),readOnly:w.querySelector('textarea').readOnly,notice:!!document.querySelector('[data-testid=missing-task-folder]')}})()`);
  assert.deepEqual(st,{stop:true,send:false,roll:false,readOnly:true,notice:true},'streaming recovery keeps Stop only');
 }
 console.log('PASS missing-folder: actual ChatPanel, 12 seat/theme/width cases, readonly draft, actions, recovery without send');
}finally{await browser.close();}
