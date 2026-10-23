import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'probe-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';function Fixture(){const [messages,setMessages]=useState(window.historyFixture);window.appendSyntheticReply=()=>setMessages(m=>[...m,{id:'new-u',role:'user',content:'새 질문',createdAt:9},{id:'new-a',role:'assistant',content:'새 답변 문단\\n\\n'.repeat(20),createdAt:10}]);return <ChatPanel {...window.propsFixture} messages={messages} onSelectAttempt={(rootId,attemptId,choose)=>setMessages(m=>m.map(x=>x.id===rootId?{...x,visibleAttemptId:attemptId,...(choose?{chosenAttemptId:attemptId}:{})}:x))}/>};createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const history=[{id:'old-user',role:'user',content:'앞선 질문',createdAt:1},{id:'old-answer',role:'assistant',content:'앞선 문단\n\n'.repeat(20),createdAt:2},{id:'u1',role:'user',content:'비교할 질문',createdAt:3},{id:'a1',role:'assistant',content:'짧은 첫 답변',createdAt:4},{id:'u2',role:'user',content:'비교할 질문',createdAt:5,retryOf:'u1'},{id:'a2',role:'assistant',content:'아주 긴 두 번째 답변 문단\n\n'.repeat(25),createdAt:6},{id:'u3',role:'user',content:'비교할 질문',createdAt:7,retryOf:'u1'},{id:'a3',role:'assistant',content:'짧은 세 번째 답변',createdAt:8}];
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN attempt pager: no Chromium');process.exit(0);}
const evidence=process.env.ATTEMPT_PAGER_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const b=await launch(bin);try{for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420])for(const forcedColors of [false,true]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{tasks:[],sources:[]}:undefined});
 await b.load(`<!doctype html><html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="display:block;height:800px"><div id="root"></div></div><script>window.propsFixture=${JSON.stringify(chatPanelProps({config}))};window.historyFixture=${JSON.stringify(history)};</script><script>${js.outputFiles[0].text}</script></body></html>`,{width,height:900,dark,forcedColors});
 await new Promise(r=>setTimeout(r,200));
 const measure=()=>b.evaluate(`(()=>{const s=document.querySelector('.hps-messages'),u=[...document.querySelectorAll('.hps-msg-user')].at(-1);return {scrollTop:s.scrollTop,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight,questionTop:u.getBoundingClientRect().top,pager:document.querySelector('.hps-answer-attempts').getBoundingClientRect().top}})()`);
 await b.evaluate(`{const e=document.querySelector('.hps-messages');e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));}`);await new Promise(r=>setTimeout(r,100));const first=await measure();
 await b.evaluate(`document.querySelector('.hps-answer-attempts .hps-version-pager button').click()`);await new Promise(r=>setTimeout(r,200));const longer=await measure();
 await b.evaluate(`document.querySelector('.hps-answer-attempts .hps-version-pager button').click()`);await new Promise(r=>setTimeout(r,200));const shorter=await measure();
 assert.ok(first.scrollHeight>first.clientHeight,'fixture actually scrolls');
 assert.ok(Math.abs(longer.questionTop-first.questionTop)<=2,`${seat}/${width}: growing attempt moved earlier question ${longer.questionTop-first.questionTop}px`);
 assert.ok(Math.abs(shorter.questionTop-first.questionTop)<=2,`${seat}/${width}: shrinking attempt moved earlier question`);
 assert.equal(await b.evaluate(`document.querySelector('.hps-answer-attempts .hps-version-pager').getAttribute('aria-label')`),'답변 1/3');
 assert.equal(await b.evaluate(`document.querySelector('.hps-answer-attempts .hps-version-pager button').disabled`),true);
 await b.evaluate(`document.querySelector('.hps-attempt-choose').click()`);await new Promise(r=>setTimeout(r,100));
 assert.equal(await b.evaluate(`document.querySelector('.hps-attempt-chosen')?.textContent`),'이 답변을 골랐어요');
 assert.equal(await b.evaluate(`document.querySelector('.hps-attempt-choose').getAttribute('aria-pressed')`),'true');
 const geometry=await b.evaluate(`(()=>{const row=document.querySelector('.hps-answer-attempts'),pager=row.querySelector('.hps-version-pager');row.scrollIntoView({block:'nearest'});const r=row.getBoundingClientRect(),p=pager.getBoundingClientRect(),badge=row.querySelector('.hps-attempt-chosen'),s=getComputedStyle(badge);return {right:r.right,pagerRight:p.right,badge:badge.getBoundingClientRect().width,font:parseFloat(s.fontSize),text:s.color,bg:s.backgroundColor,h:row.scrollHeight,w:row.scrollWidth,client:row.clientWidth}})()`);
 assert.ok(Math.abs(geometry.right-geometry.pagerRight)<=2,'pager is at the right end of its action row');assert.ok(geometry.badge>0&&geometry.font>=14);assert.ok(geometry.w<=geometry.client+1);
 if(forcedColors){const colors=await b.evaluate(`(()=>{const e=document.querySelector('.hps-attempt-choose'),s=getComputedStyle(e),p=document.createElement('span');p.style.color='CanvasText';document.body.append(p);const result={actual:s.color,expected:getComputedStyle(p).color};p.remove();return result})()`);assert.equal(colors.actual,colors.expected,'chosen control label remains readable in forced colors');}
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/pager-${seat}-${width}-${dark?'dark':'light'}-${forcedColors?'forced':'normal'}.png`,Buffer.from(shot.data,'base64'));}
 await b.evaluate(`document.querySelectorAll('.hps-answer-attempts .hps-version-pager button')[1].click()`);await new Promise(r=>setTimeout(r,100));
 assert.equal(await b.evaluate(`document.querySelectorAll('.hps-attempt-chosen').length`),0,'another attempt is not marked chosen');
 await b.evaluate(`document.querySelector('.hps-answer-attempts .hps-version-pager button').click()`);await new Promise(r=>setTimeout(r,100));
 assert.equal(await b.evaluate(`document.querySelectorAll('.hps-attempt-chosen').length`),1,'chosen mark survives browsing');
 if(seat==='personal'){
  await b.evaluate(`document.querySelectorAll('.hps-answer-attempts .hps-version-pager button')[1].click()`);await new Promise(r=>setTimeout(r,100));
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-catchup button')`),true,'navigation exposes explicit catch-up');
  await b.evaluate(`document.querySelector('.hps-catchup button').click();window.appendSyntheticReply()`);await new Promise(r=>setTimeout(r,150));
  const follow=await b.evaluate(`(()=>{const e=document.querySelector('.hps-messages');return e.scrollHeight-e.scrollTop-e.clientHeight})()`);assert.ok(Math.abs(follow)<=2,'Latest restores live follow after reading history');
 }
 console.log('PASS',seat,width,dark?'dark':'light',forcedColors?'forced':'normal','above-turn shift',longer.questionTop-first.questionTop,shorter.questionTop-first.questionTop);
}}finally{await b.close()}
console.log('PASS attempt pager navigation, chosen text and right alignment');
