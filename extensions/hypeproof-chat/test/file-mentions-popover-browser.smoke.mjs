// CGP-CHAT-D-018 (CGP-CHAT-D08): the `@` file list is a popover above the composer, anchored at the `@`,
// showing at most 6 rows of 44px, driven by Up/Down/Enter/Esc, and never opened during IME composition.
// Every assertion is measured on the real ChatPanel with the built webview CSS in headless Chromium.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const NAME='file-mentions-popover-browser';
const bin=findChromium();
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER){console.error(`${NAME}: no headless Chromium and FOCUS_REQUIRE_BROWSER=1`);process.exit(1);}console.log(`${NAME} NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)`);process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'mention-popover-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'}),css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';const root=createRoot(document.getElementById('root'));window.paint=(props=window.__props,key='initial')=>root.render(<ChatPanel key={key} {...props} onAttachFile={()=>{}} onSend={()=>{window.__sent++;return true}}/>);paint();`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
let b;try{b=await launch(bin);}catch(error){if(process.env.FOCUS_REQUIRE_BROWSER)throw error;console.log(`${NAME} NOT RUN: ${error.message}`);process.exit(0);}
const evidence=process.env.FILE_MENTION_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const settle=()=>new Promise(r=>setTimeout(r,180));
const AREA='.hps-input textarea';
const focusArea=()=>b.evaluate(`document.querySelector('${AREA}').focus()`);
const input=async text=>{await focusArea();await b.send('Input.insertText',{text});await settle();};
const key=async value=>{const code={Enter:13,Escape:27,ArrowDown:40,ArrowUp:38}[value];await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:value,code:value,windowsVirtualKeyCode:code});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:value,code:value,windowsVirtualKeyCode:code});await settle();};
const searches=()=>b.evaluate(`__posted.filter(m=>m.type==='fileMentionSearch').length`);
const latest=()=>b.evaluate(`__posted.filter(m=>m.type==='fileMentionSearch').at(-1)`);
const reply=async data=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await settle();};
const open=async(text,files)=>{await input(text);const request=await latest();await reply({type:'fileMentionResults',requestId:request.requestId,files,limited:false});return request;};
const reset=async name=>{await b.evaluate(`paint(__props,${JSON.stringify(name)})`);await settle();};
const FILES=Array.from({length:9},(_,i)=>({path:i===0?'notes/긴 파일 이름으로 된 작업 자료 모음.txt':`file-${i}.md`,bytes:10+i}));
// Geometry of the open popover, its list, its rows, the composer card and the textarea, in CSS px.
const measure=()=>b.evaluate(`(()=>{const box=e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}};
 const pop=document.querySelector('.hps-file-mentions'),list=pop&&pop.querySelector('[role=listbox]'),card=document.querySelector('.hps-input'),area=document.querySelector('${AREA}');
 if(!pop)return null;const lb=list.getBoundingClientRect();
 const rows=[...list.querySelectorAll('[role=option]')].map(o=>{const r=o.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,hit=document.elementFromPoint(cx,cy);
  return {...box(o),font:parseFloat(getComputedStyle(o).fontSize),visible:r.top>=lb.top-0.5&&r.bottom<=lb.bottom+0.5,hit:!!hit&&o.contains(hit),selected:o.getAttribute('aria-selected')==='true',bg:getComputedStyle(o).backgroundColor,border:getComputedStyle(o).borderTopWidth+' '+getComputedStyle(o).borderTopColor,ink:[...o.querySelectorAll('span')].map(e=>getComputedStyle(e).color),icon:!!o.querySelector('svg[data-icon="check"]')}});
 return {pop:box(pop),list:{...box(list),scrollTop:list.scrollTop,clientHeight:list.clientHeight,scrollHeight:list.scrollHeight},card:box(card),area:box(area),rows,
  popBg:getComputedStyle(pop).backgroundColor,popPos:getComputedStyle(pop).position,
  scrollers:[...document.querySelectorAll('.hps-messages')].map(e=>e.scrollTop).concat([document.scrollingElement.scrollTop])};})()`);
const textWidth=text=>b.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('${AREA}')),span=document.createElement('span');for(const p of ['font-family','font-size','font-weight','font-style','letter-spacing','word-spacing'])span.style.setProperty(p,s.getPropertyValue(p));span.style.whiteSpace='pre';span.style.position='fixed';span.textContent=${JSON.stringify(text)};document.body.append(span);const w=span.getBoundingClientRect().width;span.remove();return w})()`);
let states=0,anchored=0;
try{
for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420])for(const forced of width===800?[false,true]:[false]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 const config=chatConfig(3,{fileMentions:true,fileAttach:true,activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null,minor_cohort:false},taskWorkspace:seat==='personal'?{scope:'mentions',revision:1,activeTaskId:'task',tasks:[],sourceSelection:null}:undefined});
 const props=chatPanelProps({config,messages:[]});
 await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="height:900px"><div id="root"></div></div><script>window.__props=${JSON.stringify(props).replaceAll('<','\\u003c')};window.__sent=0;window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:1000,dark,forcedColors:forced});await settle();
 const label=`${seat} ${dark?'dark':'light'} ${width}${forced?' forced':''}`;
 assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail="personal"]')`),seat==='personal',label);
 await open('질문 @f',FILES);
 const m=await measure();assert.ok(m,`${label}: popover open`);
 // Popover: floats (no layout push), sits wholly above the composer card and so above the caret line, inside the card's inline extent.
 assert.equal(m.popPos,'absolute',`${label}: popover is positioned, not in the composer flow`);
 assert.ok(m.pop.b<=m.card.t+0.5,`${label}: popover bottom ${m.pop.b} above composer top ${m.card.t}`);
 assert.ok(m.pop.b<=m.area.t+0.5,`${label}: popover above the caret's textarea`);
 assert.ok(m.pop.l>=m.card.l-0.5&&m.pop.r<=m.card.r+0.5,`${label}: popover inside the composer's inline extent ${JSON.stringify([m.pop,m.card])}`);
 assert.ok(m.pop.l>=0&&m.pop.r<=width,`${label}: popover inside the viewport`);
 assert.notEqual(m.popBg,'rgba(0, 0, 0, 0)',`${label}: popover has an opaque surface`);
 // At most 6 rows visible, 44px each; the rest scroll inside the list.
 assert.equal(m.rows.length,9);
 for(const r of m.rows){assert.ok(Math.abs(r.h-44)<0.5,`${label}: row height ${r.h}`);assert.ok(r.w>=44&&r.font>=14,`${label}: row ${r.w}px wide, ${r.font}px text`);}
 const visible=m.rows.filter(r=>r.visible);
 assert.equal(visible.length,6,`${label}: ${visible.length} rows visible`);
 assert.ok(Math.abs(m.list.clientHeight-6*44)<1,`${label}: list viewport ${m.list.clientHeight}`);
 assert.ok(m.list.scrollHeight>m.list.clientHeight,`${label}: the remaining rows scroll`);
 for(const r of visible)assert.ok(r.hit,`${label}: a visible row receives the pointer (not clipped or covered)`);
 assert.ok(m.rows[0].selected&&m.rows[0].icon&&m.rows.filter(r=>r.icon).length===1,`${label}: the chosen row carries the check icon`);
 if(forced){assert.notEqual(m.rows[0].border,m.rows[1].border,`${label}: chosen row has its own border in forced colours`);assert.equal(m.rows[0].border.split(' ')[0],'2px');for(const ink of m.rows[0].ink)assert.notEqual(ink,m.rows[0].bg,`${label}: chosen row text readable on its fill`);}
 else assert.notEqual(m.rows[0].bg,'rgba(0, 0, 0, 0)',`${label}: chosen row is filled`);
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}${forced?'-forced':''}.png`,Buffer.from(shot.data,'base64'));}
 // Keyboard: Down past the 6th row scrolls only the list; Up from the first wraps to the last; the transcript does not move.
 for(let i=0;i<6;i++)await key('ArrowDown');
 let k=await measure();assert.ok(k.rows[6].selected&&k.rows[6].visible,`${label}: 7th row chosen and scrolled into the list`);
 assert.ok(k.list.scrollTop>0);assert.deepEqual(k.scrollers,m.scrollers,`${label}: transcript scroll unchanged`);
 assert.ok(k.rows.filter(r=>r.visible).length<=6);
 // Every Up step keeps the chosen row wholly inside the list (offsets are list-relative, not popover-relative).
 for(let i=5;i>=0;i--){await key('ArrowUp');const u=await measure();assert.ok(u.rows[i].selected&&u.rows[i].visible,`${label}: Up to row ${i+1} keeps it in view`);}
 await key('ArrowUp');
 k=await measure();assert.ok(k.rows[8].selected&&k.rows[8].visible,`${label}: Up from the first row wraps to the last`);
 assert.equal(await b.evaluate(`document.activeElement===document.querySelector('${AREA}')`),true,'focus stays in the composer');
 // Hover (forced through CDP, as headless pointer moves do not set :hover): rows do not lift like the
 // personal composer buttons, and the chosen row keeps its fill.
 {const fill=await b.evaluate(`getComputedStyle(document.querySelector('[role=option][aria-selected=true]')).backgroundColor`);
  await b.send('DOM.enable');await b.send('CSS.enable');const {root}=await b.send('DOM.getDocument',{depth:0});
  const {nodeId}=await b.send('DOM.querySelector',{nodeId:root.nodeId,selector:'[role=option][aria-selected=true]'});
  await b.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});
  assert.deepEqual(await b.evaluate(`(()=>{const o=document.querySelector('[role=option][aria-selected=true]');return [getComputedStyle(o).transform,getComputedStyle(o).backgroundColor]})()`),['none',fill],`${label}: hovered chosen row stays put and filled`);
  await b.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
  // Control: the forced hover does apply; another row takes the hover layer and does not lift either.
  const other=(await b.send('DOM.querySelector',{nodeId:root.nodeId,selector:'[role=option][aria-selected=false]'})).nodeId;
  const idle=await b.evaluate(`getComputedStyle(document.querySelector('[role=option][aria-selected=false]')).backgroundColor`);
  await b.send('CSS.forcePseudoState',{nodeId:other,forcedPseudoClasses:['hover']});
  const hovered=await b.evaluate(`(()=>{const o=document.querySelector('[role=option][aria-selected=false]');return [getComputedStyle(o).transform,getComputedStyle(o).backgroundColor]})()`);
  await b.send('CSS.forcePseudoState',{nodeId:other,forcedPseudoClasses:[]});
  assert.equal(hovered[0],'none',`${label}: hovered row does not lift`);if(!forced)assert.notEqual(hovered[1],idle,`${label}: hovered row takes the hover layer`);}
 // A press on the popover's own surface (status line, gutter) keeps it open and the composer focused.
 for(const sel of ['.hps-file-mentions > p','.hps-file-mentions']){const r=await b.evaluate(`(()=>{const e=document.querySelector('${sel}').getBoundingClientRect();return {x:e.left+3,y:e.top+3}})()`);
  await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',clickCount:1});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x,y:r.y,button:'left',clickCount:1});await settle();
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-file-mentions')&&document.activeElement===document.querySelector('${AREA}')`),true,`${label}: pressing ${sel} keeps the list open`);}
 await key('Enter');
 assert.equal(await b.evaluate(`__posted.filter(m=>m.type==='fileMentionPick').at(-1).path`),'file-8.md',`${label}: Enter picks the chosen row`);assert.equal(await b.evaluate('__sent'),0);
 // A refused pick that lands after focus left still hands the keys back to the composer.
 await b.evaluate(`document.querySelector('${AREA}').blur()`);await settle();
 assert.equal(await b.evaluate(`!!document.querySelector('.hps-file-mentions')`),true,`${label}: a pick in flight is not closed by blur`);
 await reply({type:'fileMentionPicked',requestId:(await latest()).requestId,ok:false});
 assert.equal(await b.evaluate(`document.activeElement===document.querySelector('${AREA}')`),true,`${label}: a refused pick refocuses the composer`);
 await key('Escape');assert.equal(await b.evaluate(`!!document.querySelector('.hps-file-mentions')`),false,`${label}: Esc works after a refused pick`);
 // Esc closes without changing the draft.
 await reset(`esc-${states}`);await open('@f',FILES);await key('Escape');
 assert.equal(await b.evaluate(`!!document.querySelector('.hps-file-mentions')`),false,`${label}: Esc closes`);
 assert.equal(await b.evaluate(`document.querySelector('${AREA}').value`),'@f');
 // Focus leaving the composer closes the popover and keeps the draft.
 await reset(`blur-${states}`);await open('@f',FILES);
 await b.evaluate(`(()=>{const o=document.createElement('button');o.id='outside';o.textContent='x';document.body.append(o);o.focus();})()`);await settle();
 assert.equal(await b.evaluate(`!!document.querySelector('.hps-file-mentions')`),false,`${label}: blur closes`);
 assert.equal(await b.evaluate(`document.querySelector('${AREA}').value`),'@f');
 await b.evaluate(`document.getElementById('outside').remove()`);
 // IME: an `@` typed while composing never opens or searches; a composing ArrowDown on an open list does not move it.
 await reset(`ime-${states}`);const before=await searches();
 await b.evaluate(`document.querySelector('${AREA}').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`);await input('@');
 assert.equal(await searches(),before,`${label}: no search while composing`);assert.equal(await b.evaluate(`!!document.querySelector('.hps-file-mentions')`),false);
 await b.evaluate(`document.querySelector('${AREA}').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);await settle();
 await reset(`ime-open-${states}`);await open('@f',FILES);
 await b.evaluate(`document.querySelector('${AREA}').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true,isComposing:true}))`);await settle();
 assert.ok((await measure()).rows[0].selected,`${label}: a composing ArrowDown does not move the choice`);
 // Anchor: the popover's inline start follows the `@` (measured independently with canvas text metrics) until it is clamped.
 const card=(await measure()).card;
 await reset(`anchor-a-${states}`);await open('질문 @f',FILES);const near=(await measure()).pop.l;
 await reset(`anchor-b-${states}`);await open('질문질문질문 @f',FILES);const far=(await measure()).pop;
 const expected=await textWidth('질문질문'),room=card.r-(far.r-far.l);
 if(far.l<room-2){anchored++;assert.ok(Math.abs((far.l-near)-expected)<=2,`${label}: anchor moved ${far.l-near}px for ${expected}px of text`);}
 else assert.ok(Math.abs(far.r-card.r)<=1.5,`${label}: a far anchor clamps to the composer's end`);
 // The anchor follows a resized composer (sidebar drag, text size): widen the textarea's left padding.
 if(far.l<room-2){await b.evaluate(`document.querySelector('${AREA}').style.paddingInlineStart='60px'`);await settle();const moved=(await measure()).pop.l;assert.ok(moved>far.l+20,`${label}: anchor re-measured after a resize (${far.l} -> ${moved})`);}
 states++;
}
assert.ok(anchored>=4,`the anchor was measured unclamped in ${anchored} states`);
console.log(`PASS ${NAME}: ${states} states (${anchored} with an unclamped anchor) (personal/classroom, dark/light, 320/800/1420, forced colours) — popover above the composer at the @, 6 visible 44px rows, list-only scrolling, Up/Down/Enter/Esc, blur close, IME guard`);
}finally{await b.close()}
