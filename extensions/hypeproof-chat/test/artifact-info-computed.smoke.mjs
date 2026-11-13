// CGP-KNOW-D-016 (DES-KNOW-29) — the file info popover measured on the built CSS and the real list
// markup in headless Chromium: dark/light, 320/800/1420 px, normal and forced colours, personal and
// classroom-style shells. The turn link is underlined and a 44px target, every value is at least 14px
// with 4.5:1 contrast, nothing overflows the window, the popover has a focus ring, and a real Escape
// key press closes it and puts focus back on 정보.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER)throw Error('Chromium required');console.log('NOT RUN artifact info popover: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const fixture=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ArtifactProvenanceList} from './src/ArtifactProvenanceList';function Fixture(){React.useEffect(()=>{window.__fixtureMounted=true;},[]);return <ArtifactProvenanceList view={window.view} onOpenTurn={(t,m)=>window.__opened.push([t,m])}/>;}createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const long='가'.repeat(40);
const view={entries:[{path:`site/${long}.html`,kind:'ai_changed',label:'AI가 고침',symbol:'↻',history:['AI가 만듦','AI가 고침'],at:2}],more:0,unobserved:false,unconfirmed:false};
const info={path:view.entries[0].path,type:'웹페이지 (HTML)',size:'2KB',created:{kind:'turn',taskId:'t1',messageId:'m1',taskTitle:`홈페이지 ${long}`},changed:{kind:'text',text:'대화를 찾을 수 없어요. 대화 기록이 지워졌거나 다른 곳으로 옮겨졌을 수 있어요.'}};
const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const color=value=>value.match(/[\d.]+/g).map(Number);
const contrast=(a,b)=>{const x=luminance(color(a)),y=luminance(color(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const evidence=process.env.ARTIFACT_INFO_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const b=await launch(bin);
const diagnostic={browser:{path:bin,...await b.send('Browser.getVersion')},events:[]};
const stopEvents=b.onEvent(event=>{if(event.method==='Runtime.exceptionThrown'){diagnostic.events.push(event);if(diagnostic.events.length>20)diagnostic.events.shift();}});
const until=async(fn,what)=>{
 const end=Date.now()+5000;
 for(;;){const value=await fn();if(value)return value;if(Date.now()>end)throw Error(`timed out waiting for ${what} (${JSON.stringify(diagnostic.case)})`);await new Promise(r=>setTimeout(r,25));}
};
const key=async k=>{for(const type of ['keyDown','keyUp'])await b.send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:{Escape:27}[k]});};
try{for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420])for(const forcedColors of [false,true]){
 diagnostic.case={seat,dark,width,forcedColors};
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await b.load(`<!doctype html><style>:root{${vars}}${css}.tw-workspace{display:block;max-width:100%;padding:8px;box-sizing:border-box}</style><body class="${dark?'vscode-dark':'vscode-light'}" style="margin:0;background:var(--hp-bg-app-default);color:var(--hp-text-primary-default)"><div class="hps-shell" ${seat==='personal'?'data-chat-detail="personal"':''}><div class="tw-workspace"><div id="root"></div></div></div><script>window.view=${JSON.stringify(view)};window.__posted=[];window.__opened=[];window.__fixtureMounted=false;window.__input=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m),getState(){},setState(){}});for(const type of ['pointermove','click'])document.addEventListener(type,e=>{window.__input.push({type:e.type,trusted:e.isTrusted,opener:!!e.target.closest('[data-artifact-info-open]')});if(window.__input.length>12)window.__input.shift();},true);</script><script>${fixture.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body>`,{width,height:1100,dark,forcedColors});
 // A visible React node alone does not prove its initial effects have settled. The fixture
 // parent's effect runs after the list's effects; wait for it before the single real click.
 await until(()=>b.evaluate(`window.__fixtureMounted===true`),'the React fixture to finish mounting');
 await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
 const at=await until(async()=>{
  const point=await b.evaluate(`(()=>{const e=document.querySelector('[data-artifact-info-open]');if(!e||!e.checkVisibility({visibilityProperty:true}))return null;const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return r.width>0&&r.height>0&&document.elementFromPoint(x,y)===e?[x,y]:null})()`);
  if(!point)return false;
  await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point[0],y:point[1]});
  return await b.evaluate(`window.__input.some(e=>e.type==='pointermove'&&e.trusted&&e.opener)`) ? point : false;
 },'a trusted pointer to reach the visible information button');
 for(const type of ['mousePressed','mouseReleased'])await b.send('Input.dispatchMouseEvent',{type,x:at[0],y:at[1],button:'left',clickCount:1});
 await until(()=>b.evaluate(`window.__input.some(e=>e.type==='click'&&e.trusted&&e.opener)`),'the trusted information click');
 const requestId=await until(()=>b.evaluate(`window.__posted.find(m=>m.type==='artifactInfoRequest')?.requestId`),'the file information request');
 assert.ok(requestId,'opening asks the host');
 await b.evaluate(`window.postMessage({type:'artifactInfo',requestId:${JSON.stringify(requestId)},info:${JSON.stringify(info)}},'*')`);
 await until(()=>b.evaluate(`(()=>{const pop=document.querySelector('[data-artifact-info]');return !!pop&&pop.querySelectorAll('dt').length===4&&!!pop.querySelector('[data-artifact-info-link]')&&document.activeElement===pop})()`),'the answered popover and its focus');
 const m=await b.evaluate(`(()=>{const pop=document.querySelector('[data-artifact-info]'),open=document.querySelector('[data-artifact-info-open]'),link=document.querySelector('[data-artifact-info-link]'),close=pop.querySelector('.tw-artifact-info-close');const ps=getComputedStyle(pop),ls=getComputedStyle(link),r=pop.getBoundingClientRect();
  return {rows:[...pop.querySelectorAll('dt')].map(d=>d.textContent),texts:[...pop.querySelectorAll('dt,dd,[data-artifact-info-text]')].map(e=>({font:parseFloat(getComputedStyle(e).fontSize),fg:getComputedStyle(e).color})),bg:ps.backgroundColor,border:parseFloat(ps.borderTopWidth),left:r.left,right:r.right,
  link:{deco:ls.textDecorationLine,h:link.getBoundingClientRect().height,font:parseFloat(ls.fontSize),fg:ls.color,right:link.getBoundingClientRect().right,tag:link.localName},openH:open.getBoundingClientRect().height,closeH:close.getBoundingClientRect().height,focused:document.activeElement===pop,scroll:document.documentElement.scrollWidth>innerWidth}})()`);
 assert.deepEqual(m.rows,['종류','크기','만든 대화','마지막으로 바꾼 대화']);
 assert.ok(m.focused,'focus moves into the popover');
 for(const x of m.texts){assert.ok(x.font>=14,`text ${x.font}px`);assert.ok(contrast(x.fg,m.bg)>=4.5,`contrast ${x.fg}/${m.bg}`);}
 assert.equal(m.link.tag,'button');assert.equal(m.link.deco,'underline','turn link underlined');assert.ok(m.link.h>=44,`link ${m.link.h}px`);assert.ok(m.link.font>=14);
 assert.ok(contrast(m.link.fg,m.bg)>=4.5,`link contrast ${m.link.fg}/${m.bg}`);
 assert.ok(m.openH>=44&&m.closeH>=44,'정보 and 닫기 are 44px targets');assert.ok(m.border>=1,'popover is bounded');
 assert.ok(m.left>=0&&m.right<=width&&m.link.right<=width,'inside the window');assert.equal(m.scroll,false,'no horizontal scroll');
 const ring=await b.focusVisibleStyle('[data-artifact-info]',['outline-width','outline-style']);
 assert.ok(parseFloat(ring['outline-width'])>=1&&ring['outline-style']!=='none','popover focus ring');
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}-${forcedColors?'forced':'normal'}.png`,Buffer.from(shot.data,'base64'));}
 await b.evaluate(`document.querySelector('[data-artifact-info]').focus()`);
 await key('Escape');
 await until(()=>b.evaluate(`!document.querySelector('[data-artifact-info]')&&document.activeElement===document.querySelector('[data-artifact-info-open]')`),'Escape to close the popover and return focus');
 const after=await b.evaluate(`({open:!!document.querySelector('[data-artifact-info]'),back:document.activeElement===document.querySelector('[data-artifact-info-open]'),expanded:document.querySelector('[data-artifact-info-open]').getAttribute('aria-expanded')})`);
 assert.deepEqual(after,{open:false,back:true,expanded:'false'},'Escape closes and returns focus to 정보');
 console.log(`PASS artifact info popover ${seat} ${dark?'dark':'light'} ${width} ${forcedColors?'forced':'normal'}`);
}}catch(error){diagnostic.failure={message:error.message,stack:error.stack};throw error;}
finally{
 diagnostic.state=await b.evaluate(`({mounted:window.__fixtureMounted,input:window.__input,requests:window.__posted?.map(m=>({type:m.type,requestId:m.requestId})),popover:!!document.querySelector('[data-artifact-info]'),rows:document.querySelectorAll('[data-artifact-info] dt').length,focusedPopover:!!document.activeElement?.matches('[data-artifact-info]')})`).catch(error=>({error:String(error)}));
 stopEvents();
 try{console.log(`artifact info diagnostics: ${JSON.stringify(diagnostic)}`);if(evidence)writeFileSync(`${evidence}/diagnostics.json`,JSON.stringify(diagnostic,null,2)+'\n');}finally{await b.close();}
}
