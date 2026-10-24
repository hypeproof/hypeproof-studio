import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin)throw Error('Chromium required');
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'paste-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'}),css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';const root=createRoot(document.getElementById('root'));window.paint=(props=window.__props,key='initial')=>root.render(<ChatPanel key={key} {...props} onSend={(...args)=>{window.__sent.push(args);return true}}/>);paint();`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const b=await launch(bin),evidence=process.env.PASTED_DRAFT_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});const settle=()=>new Promise(r=>setTimeout(r,70));
const text='긴 원문 <script>실행 안 함</script>\n'+'가'.repeat(2001);
const paste=async value=>{const prevented=await b.evaluate(`(()=>{const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});e.clipboardData.setData('text/plain',${JSON.stringify(value)});document.querySelector('.hps-input textarea').dispatchEvent(e);return e.defaultPrevented})()`);await settle();return prevented;};
const input=async value=>{await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);await b.send('Input.insertText',{text:value});await settle();};
const saved=()=>b.evaluate(`__posted.filter(m=>m.type==='saveActivityDraft').at(-1)?.draft`);
try{
for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{scope:'paste',revision:1,activeTaskId:'task',tasks:[],sourceSelection:null}:undefined});
 const props=chatPanelProps({config,messages:[]});
 await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="height:900px"><div id="root"></div></div><script>window.__props=${JSON.stringify(props).replaceAll('<','\\u003c')};window.__sent=[];window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:1000,dark});await settle();
 assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail="personal"]')`),seat==='personal');
 assert.equal(await paste('가'.repeat(2000)),false,'boundary stays ordinary paste');assert.equal(await paste('a\n'.repeat(39)+'a'),false);
 await input('앞 선택 뒤');await b.evaluate(`document.querySelector('.hps-input textarea').setSelectionRange(2,4)`);assert.equal(await paste(text),true);
 assert.equal(await b.evaluate(`document.querySelectorAll('.hps-pasted-chip').length`),1);assert.equal((await saved()).text,'앞 '+text+' 뒤');assert.equal(await b.evaluate('__sent.length'),0);
 await b.evaluate(`document.querySelector('.hps-pasted-chip button').click()`);await settle();assert.equal(await b.evaluate(`document.activeElement.className`),'hps-pasted-editor');
 assert.equal(await b.evaluate(`document.querySelector('.hps-pasted-editor').value`),text);await b.send('Input.insertText',{text:'수정'});await settle();
 const edited='수정'+text;assert.equal((await saved()).text,'앞 '+edited+' 뒤');
 const geometry=await b.evaluate(`[...document.querySelectorAll('.hps-pasted-chip button')].map(b=>{const r=b.getBoundingClientRect();return {h:r.height,w:r.width,l:r.left,r:r.right,font:parseFloat(getComputedStyle(b).fontSize)}})`);for(const r of geometry){assert.ok(r.h>=44&&r.w>=44&&r.font>=14);assert.ok(r.l>=0&&r.r<=width);}
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
 await b.evaluate(`document.querySelector('.hps-input textarea').setSelectionRange(2,2)`);assert.equal(await paste('나'.repeat(2001)),true);assert.equal((await saved()).text,'앞 '+edited+'나'.repeat(2001)+' 뒤');
 await b.evaluate(`document.querySelectorAll('.hps-pasted-chip')[1].querySelectorAll('button')[2].click()`);await settle();assert.equal((await saved()).text,'앞 '+edited+' 뒤');
 await b.evaluate(`document.querySelector('.hps-pasted-chip').querySelectorAll('button')[1].click()`);await settle();assert.equal(await b.evaluate(`document.querySelector('.hps-input textarea').value`),'앞 '+edited+' 뒤');assert.equal(await b.evaluate(`document.querySelectorAll('.hps-pasted-chip').length`),0);
 // Re-fold at the end, then assert real send callback receives full text once.
 await b.evaluate(`{const e=document.querySelector('.hps-input textarea');e.setSelectionRange(e.value.length,e.value.length)}`);await paste('다'.repeat(2001));
 const expected='앞 '+edited+' 뒤'+'다'.repeat(2001);assert.equal((await saved()).text,expected);
 await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await settle();assert.equal(await b.evaluate('__sent.length'),1);assert.equal(await b.evaluate('__sent[0][0]'),expected);assert.equal((await saved()).text,'');assert.equal(await b.evaluate(`document.querySelectorAll('.hps-pasted-chip').length`),0);
 // Running-turn queue uses canonical text, and restoration from saved draft retains it.
 await b.evaluate(`paint({...__props,streaming:true},'queue')`);await settle();await paste(text);await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await settle();assert.equal((await saved()).queued,text);assert.equal(await b.evaluate('__sent.length'),1);
 await b.evaluate(`paint({...__props,config:{...__props.config,activityDraft:{text:${JSON.stringify(text)},images:[],queued:null}}},'restored')`);await settle();assert.equal(await b.evaluate(`document.querySelector('.hps-input textarea').value`),text);
 if(width===320){
  if(seat==='personal'){
   // Read-only draft while the task folder is missing (main): the long-paste path must refuse and chip controls must be disabled.
   await b.evaluate(`paint(__props,'folder-missing')`);await settle();assert.equal(await paste(text),true);assert.equal(await b.evaluate(`document.querySelectorAll('.hps-pasted-chip').length`),1);
   const before=(await saved()).text;
   await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:__props.config}}));window.dispatchEvent(new MessageEvent('message',{data:{type:'missingTaskFolder',activityId:__props.config.activity.id,taskId:'task',notice:{message:'이 작업의 폴더를 찾을 수 없어요.',action:'다시 고르기'}}}))`);await settle();
   assert.equal(await b.evaluate(`document.querySelector('.hps-input textarea').readOnly`),true,'missing folder makes the draft read-only');
   assert.equal(await b.evaluate(`[...document.querySelectorAll('.hps-pasted-chip button')].map(x=>x.disabled).join()`),'false,true,true','chip inline/remove disabled; expand stays available to inspect');
   assert.equal(await paste(text),true,'paste is consumed');assert.equal(await b.evaluate(`document.querySelectorAll('.hps-pasted-chip').length`),1,'no second chip while folder is missing');
   assert.equal((await saved()).text,before,'draft unchanged by paste while folder is missing');
  }
  await b.evaluate(`paint(__props,'composition')`);await settle();
  await b.evaluate(`document.querySelector('.hps-input textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'가'}))`);await settle();assert.equal(await paste(text),false,'IME composition does not fold or consume paste');
  await b.evaluate(`document.querySelector('.hps-input textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}))`);await settle();
  const lines='줄\n'.repeat(40)+'끝';assert.equal(await paste(lines),true);assert.equal((await saved()).text,lines);
  await input('추가');assert.equal((await saved()).text,lines+'추가');
  assert.equal(await paste('가'.repeat(200001)),true);assert.equal((await saved()).text,lines+'추가','oversize paste cannot replace existing content');
  await b.evaluate(`paint({...__props,config:{...__props.config,activity:{...__props.config.activity,id:'other-activity'}}},'other-activity')`);await settle();assert.equal(await b.evaluate(`document.querySelectorAll('.hps-pasted-chip').length`),0,'conversation remount does not retain another draft chip');
 }

}
console.log('PASS pasted draft actual ChatPanel 12 states: thresholds, caret, editable chip, remove/inline, ordered full save/send/queue/reload, focus and44px controls');
}finally{await b.close()}
