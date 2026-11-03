import assert from 'node:assert/strict';
import {readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const SRC=fileURLToPath(new URL('../webview-ui/src',import.meta.url));
const rest=readdirSync(SRC).filter(f=>f.endsWith('.css')&&!['tokens.css','designTokens.css','focusGeometry.css','styles.css','chatDetails.css'].includes(f)).sort();
const cssBundle=await build({stdin:{contents:['tokens.css','focusGeometry.css',...rest,'styles.css','chatDetails.css'].map(f=>`@import './${f}';`).join('\n'),loader:'css',resolveDir:SRC},bundle:true,write:false,outdir:'out',logLevel:'silent',plugins:[{name:'assets',setup(b){b.onResolve({filter:/\.(svg|png|jpe?g|gif|webp|woff2?)$/},a=>({path:a.path,external:true}))}}]});
const css=cssBundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PageCard} from './PageCard';const root=createRoot(document.getElementById('root'));window.clicks=[];window.show=(state='loading',status='unchecked',dataUrl='data:image/png;base64,invalid')=>root.render(<PageCard view={{turnId:'t',anchorId:'a',pages:[{path:'index.html',kind:'added',presentation:{title:'아주 긴 페이지 제목 '.repeat(30),versionId:'sha256:'+'a'.repeat(64),status,thumbnail:{state,dataUrl}}}]}} onOpen={p=>window.clicks.push(['open',p])} onReveal={p=>window.clicks.push(['reveal',p])}/>);window.show();`,loader:'tsx',resolveDir:SRC},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'silent'});
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('browser required');console.log('NOT RUN: browser missing');process.exit(0)}
const browser=await launch(bin);const delay=ms=>new Promise(r=>setTimeout(r,ms));
try {
 for(const seat of ['personal','classroom'])for(const dark of [false,true])for(const width of [320,800,1420]){
  await browser.load(`<!doctype html><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}" style="margin:0;--vscode-foreground:${dark?'#cccccc':'#333333'};--vscode-descriptionForeground:${dark?'#aaaaaa':'#616161'};--vscode-editor-background:${dark?'#1e1e1e':'#ffffff'};--vscode-editorWidget-background:${dark?'#252526':'#f3f3f3'};--vscode-focusBorder:${dark?'#007fd4':'#005fb8'};background:var(--vscode-editor-background);color:var(--vscode-foreground)"><div class="hps-shell" data-chat-detail="${seat}" style="display:block;width:100%"><div id="root"></div></div><script>${js.outputFiles[0].text}</script>`,{width,dark});
  await delay(50);
  const m=await browser.evaluate(`(()=>{const c=document.querySelector('.hps-page-card'),im=document.querySelector('.hps-page-result-thumbnail'),title=document.querySelector('.hps-page-result-title');return {width:c.getBoundingClientRect().width,ratio:im.getBoundingClientRect().width/im.getBoundingClientRect().height,title:getComputedStyle(title).textOverflow,wrap:getComputedStyle(title).whiteSpace,buttons:[...c.querySelectorAll('button')].map(b=>({height:b.getBoundingClientRect().height,font:parseFloat(getComputedStyle(b).fontSize)})),overflow:document.documentElement.scrollWidth>innerWidth,text:c.textContent}})()`);
  assert.ok(m.width<=360.1&&m.width>0,JSON.stringify(m));if(width===320){const vw=await browser.evaluate('document.documentElement.clientWidth');assert.ok(Math.abs(m.width-vw)<1&&vw>=300,`card fills the 320px pane: ${m.width} vs ${vw}`)}
  assert.ok(Math.abs(m.ratio-1.6)<.02);assert.equal(m.title,'ellipsis');assert.equal(m.wrap,'nowrap');assert.equal(m.buttons.length,2);assert.ok(m.buttons.every(b=>b.height>=44&&b.font>=14),JSON.stringify(m));assert.equal(m.overflow,false);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-page-card')).backgroundColor`),dark?'rgb(37, 37, 38)':'rgb(243, 243, 243)');assert.match(m.text,/판 aaaaaaaa/);assert.match(m.text,/○ 아직 확인 안 함/);
  await browser.evaluate(`show('failed','previous')`);await delay(30);assert.match(await browser.evaluate(`document.querySelector('.hps-page-result-badge').textContent`),/↶ 이전 판/);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-page-result-badge')).color`),dark?'rgb(204, 204, 204)':'rgb(51, 51, 51)');
  const lum=c=>{const [r,g,b]=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};
  const edge=await browser.evaluate(`(()=>{const t=getComputedStyle(document.querySelector('.hps-page-result-thumbnail'));return {border:t.borderTopColor,width:parseFloat(t.borderTopWidth),card:getComputedStyle(document.querySelector('.hps-page-card')).backgroundColor}})()`);
  const [hi,lo]=[lum(edge.border),lum(edge.card)].sort((x,y)=>y-x);assert.ok(edge.width>=1&&(hi+.05)/(lo+.05)>=3,`thumbnail border contrast ${(hi+.05)/(lo+.05)} ${JSON.stringify(edge)}`);
  await browser.evaluate(`document.querySelector('.hps-page-card-actions button').focus()`);
  const focus=await browser.evaluate(`(()=>{const b=document.activeElement,s=getComputedStyle(b);return {visible:b.matches(':focus-visible'),style:s.outlineStyle,width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset)}})()`);
  assert.ok(focus.visible&&focus.style==='solid'&&focus.width>=2&&focus.offset<=3,JSON.stringify(focus));
  await browser.evaluate(`document.querySelectorAll('.hps-page-card-actions button')[0].click();document.querySelectorAll('.hps-page-card-actions button')[1].click()`);assert.deepEqual(await browser.evaluate('clicks'),[['open','index.html'],['reveal','index.html']]);
  if(process.env.HPS_PAGE_CARD_EVIDENCE){mkdirSync(process.env.HPS_PAGE_CARD_EVIDENCE,{recursive:true});const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.HPS_PAGE_CARD_EVIDENCE}/${seat}-${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'))}
 }
 await browser.evaluate(`show('loading','unchecked')`);await delay(100);assert.equal(await browser.evaluate(`!!document.querySelector('.hps-page-result-shimmer')`),true);await delay(2000);assert.equal(await browser.evaluate(`!!document.querySelector('.hps-page-result-shimmer')`),false);
 await browser.evaluate(`show('ready','verified')`);await delay(100);assert.equal(await browser.evaluate(`!!document.querySelector('.hps-page-result-icon')`),true);assert.match(await browser.evaluate(`document.querySelector('.hps-page-result-badge').textContent`),/^ 확인됨$/);assert.equal(await browser.evaluate(`!!document.querySelector('.hps-page-result-badge svg[data-icon="check"]')`),true);
 await browser.evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=390;canvas.height=244;canvas.getContext('2d').fillRect(0,0,390,244);show('ready','unchecked',canvas.toDataURL())})()`);await delay(100);
 assert.deepEqual(await browser.evaluate(`(()=>{const i=document.querySelector('.hps-page-result-thumbnail img');return {lazy:i.loading,width:i.naturalWidth,height:i.naturalHeight}})()`),{lazy:'lazy',width:390,height:244});
 await browser.evaluate(`show('loading','unchecked')`);await delay(50);
 const anim=()=>browser.evaluate(`getComputedStyle(document.querySelector('.hps-page-result-shimmer')).animationName`);
 assert.notEqual(await anim(),'none');
 await browser.evaluate(`document.documentElement.dataset.reducedMotion='true'`);assert.equal(await anim(),'none','Studio reduced-motion setting alone stops the shimmer');
 await browser.evaluate(`delete document.documentElement.dataset.reducedMotion`);
 await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'},{name:'prefers-reduced-motion',value:'reduce'}]});
 await browser.evaluate(`show('loading','unchecked')`);await delay(50);
 assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-page-result-shimmer')).animationName`),'none');
 assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-page-result-thumbnail')).borderTopStyle`),'solid');
 assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-page-result-badge')).color===getComputedStyle(document.querySelector('.hps-page-card')).color`),true);
 console.log('PASS actual PageCard: 12 seat/theme/width cases, 16:10,360 cap,320 fill,ellipsis,44/14,actions,status icons,2s deadline, image failure, lazy decoded image, focus ring, forced colors and reduced motion');
}finally{await browser.close()}
