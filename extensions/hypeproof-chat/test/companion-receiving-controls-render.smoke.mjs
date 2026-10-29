// #3135: actual ChatPanel with shipped CSS, hidden native statusbar and real keyboard input.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chatConfig,chatPanelProps} from './sx-screen-fixtures.mjs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const bin=findChromium();if(!bin)throw Error('Chromium required for visible receiving controls');
const props=chatPanelProps(),callbacks=Object.entries(props).filter(([,v])=>typeof v==='function').map(([k])=>`${k}:()=>{}`).join(',');
const asset=await build({entryPoints:[`${root}/webview-ui/src/main.tsx`],bundle:true,write:false,outdir:'out',loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=asset.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';window.mount=(config,instructor)=>createRoot(document.getElementById('root')).render(<ChatPanel {...${JSON.stringify(props)}} {...{${callbacks}}} config={config} instructor={instructor} streaming={true} onSend={()=>{}}/>);`,resolveDir:root+'/webview-ui',loader:'tsx'},bundle:true,write:false,outdir:'fixture-assets',format:'iife',platform:'browser',loader:{'.svg':'dataurl'},logLevel:'silent'})).outputFiles.find(f=>f.path.endsWith('.js')).text;

const browser=await launch(bin);
const until=async(expr)=>{const end=Date.now()+5000;for(;;){if(await browser.evaluate(`!!(${expr})`))return;if(Date.now()>end)throw Error('render observation timed out: '+expr);await new Promise(r=>setTimeout(r,30));}};
const host=data=>browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);
const controls=(nonce,state='listening')=>({nonce,state,canStop:['listening','processing','awaiting-approval'].includes(state),canRevoke:true});
try{
 for(const [width,dark]of [[360,false],[1280,true]]){
  const config=chatConfig(3,{profile:{...chatConfig().profile,lesson:null,activity_kind:'personal'},activity:{id:'a1',name:'작업',kind:'personal',workspace:'/w',verified:true},taskWorkspace:{scope:'a',revision:1,activeTaskId:'t1',tasks:[],sourceSelection:null}});
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await browser.load(`<html style="${vars}"><style>${css} .statusbar{display:none}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="statusbar">휴대폰 요청 수신 중</div><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`,{width,height:900,dark});
  await browser.evaluate(`mount(${JSON.stringify(config)},false)`);await until(`posted.some(m=>m.type==='companionReceivingStateRequest')`);
  assert.equal(await browser.evaluate(`!!document.querySelector('.hps-companion-receiving')`),false,'no owner means no stale action');
  await host({type:'companionReceivingState',controls:controls('owner-1','processing')});await until(`document.querySelector('.hps-companion-receiving button')`);
  const measured=await browser.evaluate(`(()=>{const s=document.querySelector('.hps-companion-receiving'),b=s.querySelector('button'),r=b.getBoundingClientRect(),p=s.getBoundingClientRect();return {label:s.getAttribute('aria-label'),text:s.innerText,disabled:b.disabled,x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,screen:innerWidth,within:p.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),bar:getComputedStyle(document.querySelector('.statusbar')).display};})()`);
  assert.equal(measured.bar,'none');assert.equal(measured.label,'휴대폰 연결');assert.equal(measured.disabled,false);assert.ok(measured.text.includes('휴대폰 요청 확인 중'));assert.ok(measured.text.includes('기기 연결 해제'));assert.ok(measured.text.includes('수신 중지는 연결을 해제하지 않아요.'));assert.equal(measured.text.includes('서버 권한'),false);assert.ok(measured.h>=44&&measured.w>=44&&measured.x>=0&&measured.right<=width&&measured.within&&measured.hit,JSON.stringify(measured));
  if(process.env.COMPANION_CONTROLS_EVIDENCE){mkdirSync(process.env.COMPANION_CONTROLS_EVIDENCE,{recursive:true});const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.COMPANION_CONTROLS_EVIDENCE}/${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
  const ring=await browser.focusVisibleStyle('.hps-companion-receiving button',['outline-width','outline-style']);assert.ok(parseFloat(ring['outline-width'])>=2&&ring['outline-style']!=='none');
  await browser.evaluate(`document.querySelector('.hps-companion-receiving button').focus()`);
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(`posted.some(m=>m.type==='companionReceivingAction')`);assert.deepEqual(await browser.evaluate(`posted.filter(m=>m.type==='companionReceivingAction').map(({nonce,action})=>({nonce,action}))`),[{nonce:'owner-1',action:'stop'}]);
  await host({type:'companionReceivingState',controls:controls('owner-1','stopped')});await until(`document.querySelector('.hps-companion-receiving button').disabled`);
  await host({type:'companionReceivingState',controls:controls('owner-2','needs-check')});await until(`document.querySelector('.hps-companion-receiving').innerText.includes('수신 결과 확인 필요')`);
  assert.equal(await browser.evaluate(`document.querySelector('.hps-companion-receiving button').disabled`),true);
  await browser.evaluate(`document.querySelectorAll('.hps-companion-receiving button')[1].focus()`);
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(`posted.filter(m=>m.type==='companionReceivingAction').length===2`);
  assert.deepEqual(await browser.evaluate(`posted.filter(m=>m.type==='companionReceivingAction').at(-1).nonce`),'owner-2');
  await host({type:'companionReceivingState',controls:null});await until(`!document.querySelector('.hps-companion-receiving')`);
  assert.equal(await browser.evaluate(`posted.some(m=>['sendMessage','retryMessage'].includes(m.type))`),false,'controls never Send');
 }
 console.log('PASS actual ChatPanel visible Stop/Revoke at360/light and1280/dark, hidden shell bar, keyboard, inactive/unknown/replacement states');
}finally{await browser.close();}
