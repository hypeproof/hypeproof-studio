// CGP-DS-R-029: actual ChatPanel bridge, computed styles and grayscale/forced-colors.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN diff symbols: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'diff-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';createRoot(document.getElementById('root')).render(React.createElement(ChatPanel,window.__diffProps));`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const row=(id,kind,text,at,extra={})=>({id,kind,text,at,actor:'user',evidence_type:null,source_kind:'none',source_state:'self_reported',provenance:null,adopted_from:null,...extra});
const before='같은 줄\n이전 문장\n',after='같은 줄\n새 문장 <img src=x onerror=alert(1)>\n';
const rows=[row('before','artifact',before,1,{sha256:'a'.repeat(64)}),row('change','change_requested','바꿔 주세요',2,{artifact_before:'a'.repeat(64)}),row('after','artifact',after,3,{sha256:'b'.repeat(64)}),row('check','retest_confirmed','확인했어요',4,{artifact_after:'b'.repeat(64)})];
const learning={task:'task-1',phase:'working',currentStep:null,complete:{ok:false,reasons:[],missing:[]},declared:false,verification:{state:'unverified',source_state:'self_reported',line:'다시 확인해 주세요'},evidence:rows};
const view={turnId:'turn-1',state:'open',added:[],changed:['notes.txt'],deleted:[],notCovered:[],files:[{path:'notes.txt',added:1,removed:1,lines:[{kind:'same',text:'같은 줄\n'},{kind:'removed',text:'이전 문장\n'},{kind:'added',text:'새 문장 <img src=x onerror=alert(1)>\n'}]}]};
const b=await launch(bin),evidence=process.env.DIFF_SYMBOLS_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const dispatch=async(type,payload)=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify({type,...payload})}}))`);await new Promise(r=>setTimeout(r,60));};
try{
 for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [800,1420])for(const forcedColors of [false,true]){
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{tasks:[],sources:[]}:undefined});
  const props=chatPanelProps({config});
  await b.load(`<html style="${vars};--vscode-diffEditor-insertedTextBackground:green;--vscode-diffEditor-removedTextBackground:red"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="display:block;height:900px"><div id="root"></div></div><script>window.__diffProps=${JSON.stringify(props)};</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:1000,dark,forcedColors});
  await dispatch('learningState',{state:learning});await dispatch('turnReviewState',{view});
  await b.evaluate(`document.querySelectorAll('.hp-evidence,.hp-evidence-diff,.hps-turn-review details').forEach(e=>e.open=true);[...document.querySelectorAll('.hps-turn-review button')].find(e=>e.textContent==='전후 비교 보기').click()`);await new Promise(r=>setTimeout(r,60));
  for(const surface of ['.hps-turn-review','.hp-evidence-compare']){
   await b.evaluate(`document.querySelector('.hp-evidence').open=${surface==='.hp-evidence-compare'}`);await new Promise(r=>setTimeout(r,60));
   const state=await b.evaluate(`(()=>{const root=document.querySelector('${surface}');(root.querySelector('.hps-turn-diff')??root).scrollIntoView({block:'center'});return [...root.querySelectorAll('.hps-turn-diff-line')].filter(e=>e.getBoundingClientRect().height>0).map(e=>{const m=e.firstElementChild,c=e.querySelector('code'),d=e.querySelector('del'),r=e.getBoundingClientRect();return {kind:e.dataset.kind,marker:m.textContent,label:m.getAttribute('aria-label'),decoration:d?getComputedStyle(d).textDecorationLine:'none',text:c.textContent,background:getComputedStyle(e).backgroundColor,bounds:r.left>=0&&r.right<=innerWidth,vertical:r.top>=0&&r.bottom<=innerHeight,unoccluded:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),font:parseFloat(getComputedStyle(c).fontSize),markerVisible:getComputedStyle(m).visibility==='visible'&&m.getBoundingClientRect().width>0}})})()`);
   for(const kind of ['same','added','removed'])assert.ok(state.some(x=>x.kind===kind),`${surface}: ${kind} visible`);
   for(const x of state){assert.equal(x.bounds,true);assert.equal(x.vertical,true,'diff line in screenshot viewport');assert.equal(x.unoccluded,true,'diff line not clipped by scroll container or overlay');assert.equal(x.markerVisible,true);assert.ok(x.font>=14,`${surface} font ${x.font}`);if(x.kind==='same'){assert.equal(x.marker,' ');assert.equal(x.decoration,'none');}else{assert.equal(x.marker,x.kind==='added'?'+':'−');assert.equal(x.label,x.kind==='added'?'추가':'삭제');if(x.kind==='removed')assert.match(x.decoration,/line-through/);if(!forcedColors){assert.match(x.background,/0\.15\)/,'theme tint bounded even for opaque host colors');}}}
   assert.equal(await b.evaluate(`document.querySelector('${surface}').querySelectorAll('img').length`),0,'hostile text remains text');
   await b.evaluate(`document.body.style.filter='grayscale(1)'`);
   if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${surface.slice(1)}-${seat}-${width}-${dark?'dark':'light'}-${forcedColors?'forced':'gray'}.png`,Buffer.from(shot.data,'base64'));}
  }
 }
 // Each evidence column shows only its own side: the before column never carries additions and
 // the after column never carries removals, while both keep the unchanged lines.
 const columns=await b.evaluate(`[...document.querySelectorAll('.hp-evidence-compare pre')].map(p=>[...p.querySelectorAll('.hps-turn-diff-line')].map(e=>e.dataset.kind))`);
 assert.equal(columns.length,2,'evidence compare renders a before and an after column');
 assert.ok(columns[0].includes('removed')&&!columns[0].includes('added')&&columns[0].includes('same'),`before column kinds ${columns[0]}`);
 assert.ok(columns[1].includes('added')&&!columns[1].includes('removed')&&columns[1].includes('same'),`after column kinds ${columns[1]}`);
 // Missing history never invents additions. Changing snapshots refreshes the displayed comparison.
 await dispatch('learningState',{state:{...learning,evidence:rows.filter(r=>r.id!=='before')}});
 assert.equal(await b.evaluate(`document.querySelectorAll('.hp-evidence-compare .hps-turn-diff-line').length`),0);
 assert.match(await b.evaluate(`document.querySelector('.hp-evidence-compare').textContent`),/초안/);
 await dispatch('learningState',{state:{...learning,evidence:rows.map(r=>r.id==='after'?{...r,text:before}:r)}});
 assert.equal(await b.evaluate(`document.querySelectorAll('.hp-evidence-compare [data-kind="added"],.hp-evidence-compare [data-kind="removed"]').length`),0,'unchanged lines never carry change markers');
 await dispatch('learningState',{state:{...learning,evidence:rows.map(r=>r.id==='after'?{...r,text:'many\n'.repeat(501)}:r)}});
 assert.equal(await b.evaluate(`document.querySelectorAll('.hp-evidence-compare .hps-turn-diff-line').length`),0);
 assert.match(await b.evaluate(`document.querySelector('.hp-evidence-diff').textContent`),/500줄/);
 await dispatch('turnReviewState',{view:null});assert.equal(await b.evaluate(`document.querySelectorAll('.hps-turn-review').length`),0);
 console.log('PASS diff symbols: both real surfaces, seats/themes/widths, grayscale, forced colors, escaping, missing/changed/oversized history and cleared turn');
}finally{await b.close()}
