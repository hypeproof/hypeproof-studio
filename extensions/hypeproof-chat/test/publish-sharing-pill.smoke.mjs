import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const src=fileURLToPath(new URL('../webview-ui/src',import.meta.url));
const files=readdirSync(src).filter(f=>f.endsWith('.css')&&!['tokens.css','designTokens.css','focusGeometry.css','styles.css','chatDetails.css'].includes(f)).sort();
const css=(await build({stdin:{contents:['tokens.css','focusGeometry.css',...files,'styles.css','chatDetails.css'].map(f=>`@import './${f}';`).join('\n'),loader:'css',resolveDir:src},bundle:true,write:false,outdir:'out',logLevel:'silent',plugins:[{name:'assets',setup(b){b.onResolve({filter:/\.(svg|png|woff2?)$/},a=>({path:a.path,external:true}))}}]})).outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PublishPanel} from './PublishPanel';const root=createRoot(document.getElementById('root'));window.refreshes=0;window.show=(state='live')=>{const version='sha256:'+'a'.repeat(64);const link={id:'l',state:state==='closed'?'revoked':'live',expires_at:Date.now()+(state==='expired'?-1000:state==='soon'?400:86400000),share_url:'https://test.invalid/page',channel:null,qr:null};const view={available:state!=='unavailable',read_failed:state==='unknown'||state==='unavailable',reason:state==='unknown'||state==='unavailable'?'공유 상태를 확인하지 못했어요':null,version:{id:version,files:[],manifest_added:[],refusal:null,refusal_lines:[]},verification:{state:'not_verified'},experiments:state==='unpublished'?[]:[{id:'e',product_version_id:version,question:'페이지 시험',week:1,links:[link],status:'running'}],hypotheses:[],timing:null};root.render(<PublishPanel view={view} error={null} errorLines={[]} shareUrl={null} busy={false} onManifest={()=>{}} onSubmit={()=>{throw Error('unexpected publish')}} onLink={()=>{}} onRevoke={()=>{}} onRefresh={()=>window.refreshes++} onClose={()=>{}}/>)};show();`,loader:'tsx',resolveDir:src},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'silent'})).outputFiles[0].text;
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN sharing pill browser');process.exit(0)}
const browser=await launch(bin),wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(const seat of ['personal','classroom'])for(const dark of [false,true])for(const width of [320,800,1420]){
  await browser.load(`<!doctype html><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}" style="margin:0;--vscode-sideBar-background:${dark?'#1e1e1e':'#fff'};--vscode-input-background:${dark?'#333':'#fff'};--vscode-input-foreground:${dark?'#ccc':'#333'};--vscode-descriptionForeground:${dark?'#aaa':'#616161'};--vscode-foreground:${dark?'#ccc':'#333'};--vscode-editor-background:${dark?'#1e1e1e':'#fff'};--vscode-editorWidget-background:${dark?'#252526':'#f3f3f3'};background:var(--vscode-editor-background);color:var(--vscode-foreground)"><div class="hps-shell" data-chat-detail="${seat}" style="display:block;width:100%"><div id="root"></div></div><script>${js}</script>`,{width,dark});await browser.evaluate(`document.documentElement.style.cssText=document.body.style.cssText`);await wait(50);
  for(const [state,label] of [['live','링크가 있는 누구나'],['unpublished','나만 볼 수 있어요'],['closed','링크 끊김'],['expired','링크 끊김'],['unknown','공유 상태 확인 필요'],['unavailable','공유 상태 확인 필요']]){
   await browser.evaluate(`show('${state}')`);await wait(30);
   const m=await browser.evaluate(`(()=>{const p=document.querySelector('[data-testid="sharing-pill"]'),r=p.getBoundingClientRect(),s=getComputedStyle(p);return {count:document.querySelectorAll('[data-testid="sharing-pill"]').length,text:p.textContent,height:r.height,width:r.width,font:parseFloat(s.fontSize),radius:parseFloat(s.borderTopLeftRadius),icon:!!p.querySelector('svg[aria-hidden="true"]'),sig:[p.querySelector('rect')?'lock':'',p.querySelector('circle')?'unknown':'',p.querySelector('path[d="m3 3 18 18"]')?'broken':'',p.querySelector('path[d="m9 15 6-6"]')?'link':''].join(''),adjacent:!!p.parentElement.querySelector('[data-testid="publish-submit"]'),scroll:document.documentElement.scrollWidth}})()`);
   assert.equal(m.count,1);assert.equal(m.text,label);assert.ok([...m.text].length<=20);assert.ok(m.height>=44&&m.font>=14&&m.width<=width,JSON.stringify(m));assert.ok(m.radius>=m.height/2,JSON.stringify(m));assert.equal(m.icon,true);assert.equal(m.sig,{live:'link',unpublished:'lock',closed:'broken',expired:'broken',unknown:'unknown',unavailable:'unknown'}[state],'icon for '+state+': '+m.sig);assert.equal(await browser.evaluate(`getComputedStyle(document.getElementById('root')).backgroundColor`),dark?'rgb(30, 30, 30)':'rgb(255, 255, 255)');assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid=sharing-pill]')).color`),dark?'rgb(204, 204, 204)':'rgb(51, 51, 51)');assert.equal(m.adjacent,state!=='unavailable');assert.ok(m.scroll<=width,JSON.stringify(m));
   await browser.evaluate(`document.querySelector('[data-testid="sharing-pill"]').click()`);await wait(30);
   assert.equal(await browser.evaluate(`document.querySelector('.hps-share-settings').open`),true);
   assert.equal(await browser.evaluate(`document.activeElement.tagName`),'SUMMARY');
   assert.equal(await browser.evaluate(`document.querySelector('[data-testid="sharing-pill"]').getAttribute('aria-expanded')`),'true');
   if(state==='unknown'){await browser.evaluate(`document.querySelector('.hps-sharing-refresh').click()`);assert.ok(await browser.evaluate('refreshes>0'));}
   if(state==='live')assert.match(await browser.evaluate(`document.querySelector('.hps-share-settings').textContent`),/활성 링크 1개/);
   if(process.env.HPS_SHARING_PILL_EVIDENCE&&state==='live'){mkdirSync(process.env.HPS_SHARING_PILL_EVIDENCE,{recursive:true});const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.HPS_SHARING_PILL_EVIDENCE}/${seat}-${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'))}
   await browser.evaluate(`document.querySelector('.hps-share-settings').open=false`);await wait(30);
   assert.equal(await browser.evaluate(`document.querySelector('[data-testid="sharing-pill"]').getAttribute('aria-expanded')`),'false');
  }
 }
 await browser.evaluate(`show('soon')`);await wait(50);
 assert.equal(await browser.evaluate(`document.querySelector('[data-testid="sharing-pill"]').dataset.sharing`),'live');
 for(let i=0;i<50 && await browser.evaluate(`document.querySelector('[data-testid="sharing-pill"]').dataset.sharing`)!=='closed';i++)await wait(100);
 assert.equal(await browser.evaluate(`document.querySelector('[data-testid="sharing-pill"]').dataset.sharing`),'closed');
 await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
 await browser.evaluate(`document.querySelector('[data-testid="sharing-pill"]').focus()`);
 const focus=await browser.evaluate(`(()=>{const p=document.activeElement,s=getComputedStyle(p);return {visible:p.matches(':focus-visible'),width:parseFloat(s.outlineWidth),style:s.outlineStyle,border:s.borderTopStyle}})()`);
 assert.ok(focus.visible&&focus.width>=2&&focus.style==='solid'&&focus.border==='solid',JSON.stringify(focus));
 await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
 await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait(30);
 assert.equal(await browser.evaluate(`document.querySelector('.hps-share-settings').open`),true);
 console.log('PASS sharing pill: 12 seat/theme/width cases x 6 states,20 chars,44px,icon,adjacency,settings,focus and disclosure state');
}finally{await browser.close()}
