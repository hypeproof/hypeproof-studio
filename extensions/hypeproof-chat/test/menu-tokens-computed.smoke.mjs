// REQ-CGP-DS-24: shared menu geometry and real keyboard behavior.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN menu tokens: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const bundle=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'menu-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ComposerTools} from './src/ComposerTools';import {HeaderActions} from './src/ChatPanel';const noop=()=>{};createRoot(document.getElementById('mount')).render(<><header className="hps-header"><span>대화</span><HeaderActions personal taskId="t"><button>설정</button><button>기록</button><button>닫기</button></HeaderActions></header><div className="hps-input"><ComposerTools mode="auto" onMode={noop} locked={false} onAttach={noop} onAttachFile={noop} webSearch={{available:true}}/></div></>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const b=await launch(bin);const evidence=process.env.MENU_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const wait=()=>new Promise(r=>setTimeout(r,25));
const key=async(k,ime=false)=>{await b.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true,isComposing:${ime}}))`);await wait();};
try{
 for(const seat of ['personal','classroom'])for(const dark of [false,true])for(const width of [800,1420]){
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="display:block;height:800px"><div class="hps-shell" ${seat==='personal'?'data-chat-detail="personal"':''}><div id="mount"></div></div></div><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:900,dark});
  // Position only the fixture's composer to leave room for its above-trigger popover.
  await b.evaluate(`document.querySelector('.hps-input').style.marginTop='400px'`);
  for(const [name,trigger,menu] of [['tools','.hps-tool-trigger','.hps-tools-menu'],['header','.tw-chat-menu-toggle','.tw-chat-menu-panel']]){
   if(seat==='classroom'&&name==='header')continue;
   await b.evaluate(`document.querySelector('${trigger}').click()`);await wait();
   const measure=()=>b.evaluate(`(()=>{const panel=document.querySelector('${menu}');const s=getComputedStyle(panel);const rect=panel.getBoundingClientRect();return {bounds:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,radius:parseFloat(s.borderRadius),gutter:parseFloat(s.paddingTop),items:[...panel.querySelectorAll('button')].map(e=>({height:e.getBoundingClientRect().height,minHeight:parseFloat(getComputedStyle(e).minHeight),font:parseFloat(getComputedStyle(e).fontSize)})),descriptions:[...panel.querySelectorAll('button small')].map(e=>({font:parseFloat(getComputedStyle(e).fontSize),weight:Number(getComputedStyle(e).fontWeight),title:Number(getComputedStyle(e.parentElement).fontWeight),color:getComputedStyle(e).color,titleColor:getComputedStyle(e.parentElement).color})),border:(()=>{const rgba=c=>{const m=c.match(/[\\d.]+/g).map(Number);const k=c.startsWith('color(')?255:1;return [m[0]*k,m[1]*k,m[2]*k,m.length>3?m[3]:1];};const over=(f,b)=>[0,1,2].map(i=>f[i]*f[3]+b[i]*(1-f[3]));const lum=c=>{const l=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*l[0]+0.7152*l[1]+0.0722*l[2];};const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};let around=[255,255,255];const chain=[];for(let n=panel.parentElement;n;n=n.parentElement)chain.unshift(n);for(const n of chain){const c=rgba(getComputedStyle(n).backgroundColor);if(c[3]>0)around=over(c,around);}const edge=rgba(s.borderTopColor);return {width:parseFloat(s.borderTopWidth),style:s.borderTopStyle,vsAround:ratio(over(edge,around),around)};})(),at:[...panel.querySelectorAll('button')].indexOf(document.activeElement)}})()`);
   let m=await measure();assert.equal(m.bounds,true,`${name} must fit the viewport`);assert.equal(m.radius,12,`${name} radius`);assert.equal(m.gutter,4,`${name} gutter`);assert.ok(m.items.every(i=>i.height>=44&&i.font>=14),`${seat}/${name}: ${JSON.stringify(m)}`);assert.equal(m.at,0);
   assert.ok(m.items.every(i=>i.minHeight>=44),`${seat}/${name}: min-height declaration itself must be >=44px ${JSON.stringify(m.items)}`);
   assert.ok(m.descriptions.every(d=>d.font>=14),`${seat}/${name}: description font ${JSON.stringify(m.descriptions)}`);
   assert.ok(m.border.width>=1&&m.border.style==='solid'&&m.border.vsAround>=3,`${seat}/${name}: panel border must be visible, >=3:1 against its surroundings ${JSON.stringify(m.border)}`);
   if(name==='tools')assert.ok(m.descriptions.length===3&&m.descriptions.every(d=>d.title>d.weight&&d.titleColor!==d.color),`${seat}: tools title must outrank its description by weight and colour ${JSON.stringify(m.descriptions)}`);
   await key('End');assert.equal((await measure()).at,2);await key('ArrowDown');assert.equal((await measure()).at,0);await key('ArrowUp');assert.equal((await measure()).at,2);await key('Home');assert.equal((await measure()).at,0);
   await key('ArrowDown',true);assert.equal((await measure()).at,0,'composition keys must not move menu focus');await key('Escape',true);assert.ok(await b.evaluate(`!!document.querySelector('${menu}')`),'composition Escape keeps menu');
   if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}-${name}.png`,Buffer.from(shot.data,'base64'));}
   // The semantic role must remain connected even if an old component override comes later.
   await b.evaluate(`document.body.style.setProperty('--ds-c-menu-radius','18px');document.body.style.setProperty('--ds-c-menu-item-height','60px')`);
   m=await measure();assert.equal(m.radius,18);assert.ok(m.items.every(i=>i.height>=60));
   await b.evaluate(`document.body.style.removeProperty('--ds-c-menu-radius');document.body.style.removeProperty('--ds-c-menu-item-height')`);
   if(name==='tools'){
    await b.evaluate(`document.querySelector('.hps-input').setAttribute('data-expanded','true')`);
    const expanded=await measure();assert.ok(expanded.items.every(i=>i.height>=44&&i.font>=14),'expanded composer menu keeps learner targets');
    await b.evaluate(`document.querySelector('.hps-input').removeAttribute('data-expanded')`);
   }
   await b.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
   const focus=await b.focusVisibleStyle(menu+' button');assert.ok(parseFloat(focus['outline-width'])>=2);assert.notEqual(focus['outline-style'],'none');
   await b.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'none'}]});
   await key('Escape');assert.equal(await b.evaluate(`!!document.querySelector('${menu}')`),false);assert.equal(await b.evaluate(`document.activeElement===document.querySelector('${trigger}')`),true,'Escape restores opener');
  }
 }
 console.log('PASS menu token linkage, geometry, arrows/Home/End/Escape and IME across both fixture contexts/themes/windows');
}finally{await b.close();}
