// CGP-CHAT-R-027 / CGP-CHAT-D-027 (REQ-STUDIO-CHAT-FIND): the real ChatPanel in headless
// Chromium. Cmd/Ctrl+F opens the find bar, plain-text matches are counted "n/m" over planted
// answers (inline formatting, a collapsed code pill, literal markup, case), Enter/Shift+Enter and
// the buttons move with wrap-around, the match scrolls into view under the bar, Esc closes and
// returns focus, and neither opening nor closing moves the transcript or changes follow-the-bottom.
// Geometry (44px targets, 14px floor, the bar inside the transcript column) is measured, in both
// seats, dark/light, 800/1420 px and forced colours. Fails under FOCUS_REQUIRE_BROWSER=1 without a browser.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';

const bin=findChromium();
if(!bin){
  if(process.env.FOCUS_REQUIRE_BROWSER){console.error('chat-find-browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1');process.exit(1);}
  console.log('chat-find-browser NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');process.exit(0);
}
const {build}=await import('esbuild');
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'find-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'}),css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';const root=createRoot(document.getElementById('root'));window.paint=(props=window.__props,key='initial')=>root.render(<ChatPanel key={key} {...props}/>);paint();`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});

const filler=(tag,n)=>Array.from({length:n},(_,i)=>`${tag} 문단 ${i+1}: 오늘은 날씨가 맑고 바람이 조금 붑니다.`).join('\n\n');
const messages=[
  {id:'u1',role:'user',content:'사과 이야기를 해 줘',createdAt:1},
  {id:'a1',role:'assistant',content:`사**과**는 빨갛다. APPLE and apple.\n\n${filler('앞',25)}\n\n\`\`\`js\nconst 사과 = 1;\n\`\`\`\n\n${filler('중간',3)}`,createdAt:2},
  {id:'u2',role:'user',content:'<b>사과</b> 고마워',createdAt:3},
  {id:'a2',role:'assistant',content:`${filler('뒤',25)}\n\n마지막 사과.`,createdAt:4},
];
const TOTAL=5; // u1, a1 prose (split by <strong>), a1 code pill (collapsed), u2 literal markup, a2 end.

const settle=(ms=90)=>new Promise(r=>setTimeout(r,ms));
let b;
try{b=await launch(bin);}catch(error){
  if(process.env.FOCUS_REQUIRE_BROWSER)throw error;
  console.log('chat-find-browser NOT RUN: '+error.message);process.exit(0);
}
const evidence=process.env.CHAT_FIND_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const mac=()=>b.evaluate(`/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent)`);
const key=async(k,code,vk,modifiers=0)=>{await b.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:k,code,windowsVirtualKeyCode:vk,modifiers});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk,modifiers});await settle();};
const findKey=async()=>key('f','KeyF',70,(await mac())?4:2);
const count=()=>b.evaluate(`document.querySelector('.hps-find-count')?.textContent`);
const scrollTop=()=>b.evaluate(`document.querySelector('.hps-messages').scrollTop`);
const atBottom=()=>b.evaluate(`(()=>{const s=document.querySelector('.hps-messages');return s.scrollHeight-s.scrollTop-s.clientHeight<=2})()`);
// The current match's rectangle must sit inside the scroller, below the bar.
const currentVisible=()=>b.evaluate(`(()=>{const h=CSS.highlights.get('hp-find-current');if(!h||h.size!==1)return 'no current highlight';const r=[...h][0].getBoundingClientRect(),s=document.querySelector('.hps-messages').getBoundingClientRect(),bar=document.querySelector('.hps-find').getBoundingClientRect();return r.top>=bar.bottom-1&&r.bottom<=s.bottom+1?true:JSON.stringify({r:[r.top,r.bottom],s:[s.top,s.bottom],bar:bar.bottom})})()`);
const currentText=()=>b.evaluate(`(()=>{const h=CSS.highlights.get('hp-find-current');return h?[...h][0].toString():null})()`);
try{
for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420]){
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{scope:'find',revision:1,activeTaskId:'task',tasks:[],sourceSelection:null}:undefined});
  // The AI notice sits in the scroller but outside every message body: never a match.
  const props=chatPanelProps({config,messages,aiNotice:'AI 안내: 사과 표시는 안내문'});
  await b.load(`<html style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark?'vscode-dark':'vscode-light'}" style="margin:0"><div id="root"></div><script>window.__props=${JSON.stringify(props).replaceAll('<','\\u003c')};window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:800,dark});
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'forced-colors',value:'none'}]});
  await settle(200);
  const label=`${seat} ${dark?'dark':'light'} ${width}`;
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail="personal"]')`),seat==='personal',label);
  assert.equal(await b.evaluate(`document.querySelectorAll('.hps-codepill-body').length`),0,`${label}: the code pill starts collapsed`);
  // Start reading at the bottom with the composer focused.
  await b.evaluate(`{const s=document.querySelector('.hps-messages');s.scrollTop=s.scrollHeight}`);await settle();
  assert.ok(await atBottom(),`${label}: transcript starts at the bottom`);
  await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);
  // What the reader sees: the last message's top on screen and the distance to the bottom.
  const view=`(()=>{const s=document.querySelector('.hps-messages'),m=[...s.querySelectorAll('.hps-msg')].at(-1).getBoundingClientRect();return {msg:Math.round(m.top),toBottom:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)}})()`;
  const before=await b.evaluate(view);

  // Cmd/Ctrl+F opens the bar, focuses its input, changes no layout.
  await findKey();
  assert.equal(await b.evaluate(`document.activeElement?.className`),'hps-find-input',`${label}: Cmd/Ctrl+F focuses the find input`);
  assert.deepEqual(await b.evaluate(view),before,`${label}: opening the bar moves no text and keeps the distance to the bottom`);
  const geo=await b.evaluate(`(()=>{const bar=document.querySelector('.hps-find').getBoundingClientRect(),s=document.querySelector('.hps-messages').getBoundingClientRect();
    const ctl=[...document.querySelectorAll('.hps-find-input, .hps-find-btn')].map(e=>{const r=e.getBoundingClientRect();return {c:e.className,w:r.width,h:r.height,f:parseFloat(getComputedStyle(e).fontSize)}});
    return {bar:[bar.top,bar.left,bar.right,bar.bottom],s:[s.top,s.left,s.right],ctl,pos:getComputedStyle(document.querySelector('.hps-find')).position,count:parseFloat(getComputedStyle(document.querySelector('.hps-find-count')).fontSize)}})()`);
  assert.equal(geo.pos,'static');
  assert.ok(geo.bar[3]<=geo.s[0]&&geo.bar[3]>=geo.s[0]-12,`${label}: bar sits right above the transcript's top edge ${JSON.stringify(geo)}`);
  assert.ok(geo.bar[1]>=geo.s[1]&&geo.bar[2]<=geo.s[2],`${label}: bar stays inside the chat column ${JSON.stringify(geo)}`);
  for(const c of geo.ctl){assert.ok(c.h>=44&&c.f>=14,`${label}: ${c.c} is a 44px target with >=14px text ${JSON.stringify(c)}`);if(c.c==='hps-find-btn')assert.ok(c.w>=44,`${label}: button width ${c.w}`);}
  assert.ok(geo.count>=14,`${label}: count text >= 14px`);
  const ring=await b.focusVisibleStyle('.hps-find-input');assert.ok(parseFloat(ring['outline-width'])>=2&&ring['outline-style']==='solid',`${label}: input focus ring ${JSON.stringify(ring)}`);
  const btnRing=await b.focusVisibleStyle('.hps-find-btn');assert.ok(parseFloat(btnRing['outline-width'])>=2,`${label}: button focus ring`);

  // Typing searches; the first match below the reading position (the bottom) is the last one.
  await b.evaluate(`document.querySelector('.hps-find-input').focus()`);
  await b.send('Input.insertText',{text:'사과'});await settle();
  assert.equal(await b.evaluate(`document.querySelector('.hps-ai-disclosure')?.textContent.includes('사과')`),true,'planted chrome text');
  assert.equal(await count(),`${TOTAL}/${TOTAL}`,`${label}: count`);
  assert.equal(await b.evaluate(`CSS.highlights.get('hp-find').size+CSS.highlights.get('hp-find-current').size`),TOTAL-1,`${label}: the collapsed pill's match is counted, not painted`);
  assert.equal(await currentText(),'사과');assert.equal(await currentVisible(),true,`${label}: current visible`);
  // Next wraps to the first (user prompt), Shift+Enter goes back.
  await key('Enter','Enter',13);assert.equal(await count(),`1/${TOTAL}`,`${label}: Enter wraps to the first`);assert.equal(await currentVisible(),true,`${label}: first visible`);
  assert.equal(await b.evaluate(`[...CSS.highlights.get('hp-find-current')][0].startContainer.parentElement.closest('.hps-msg-user')!==null`),true);
  assert.equal(await atBottom(),false,`${label}: moving to an earlier match scrolls up`);
  await key('Enter','Enter',13,8);assert.equal(await count(),`${TOTAL}/${TOTAL}`,`${label}: Shift+Enter wraps back`);
  await key('Enter','Enter',13);await key('Enter','Enter',13);
  assert.equal(await count(),`2/${TOTAL}`);assert.equal(await currentText(),'사과','match across <strong>');
  assert.equal(await b.evaluate(`[...CSS.highlights.get('hp-find-current')][0].endContainer.parentElement.tagName`),'STRONG');
  // Into the collapsed code pill: it opens and the match inside is current and visible.
  await b.evaluate(`document.querySelectorAll('.hps-find-btn')[1].click()`);await settle(160);
  assert.equal(await count(),`3/${TOTAL}`,`${label}: next button`);
  assert.equal(await b.evaluate(`document.querySelectorAll('.hps-codepill-body').length`),1,`${label}: the pill opened`);
  assert.equal(await b.evaluate(`!![...CSS.highlights.get('hp-find-current')][0].startContainer.parentElement.closest('.hps-codepill')`),true,`${label}: current is inside the pill`);
  assert.equal(await currentVisible(),true);
  await b.evaluate(`document.querySelectorAll('.hps-find-btn')[1].click()`);await settle();
  assert.equal(await count(),`4/${TOTAL}`);assert.equal(await b.evaluate(`[...CSS.highlights.get('hp-find-current')][0].startContainer.parentElement.closest('.hps-msg-body').textContent.includes('<b>사과</b>')`),true,'literal markup is text');
  await b.evaluate(`document.querySelectorAll('.hps-find-btn')[0].click()`);await settle();assert.equal(await count(),`3/${TOTAL}`,'previous button');

  // Case-insensitive plain text; regex syntax is literal; hostile invisible characters are dropped.
  await b.evaluate(`document.querySelector('.hps-find-input').select()`);await b.send('Input.insertText',{text:'Apple'});await settle();
  assert.match(await count(),/\/2$/,`${label}: APPLE and apple`);
  await b.evaluate(`document.querySelector('.hps-find-input').select()`);await b.send('Input.insertText',{text:'a.p'});await settle();assert.equal(await count(),'0/0','no regex');
  assert.equal(await b.evaluate(`document.querySelectorAll('.hps-find-btn')[0].disabled&&document.querySelectorAll('.hps-find-btn')[1].disabled`),true,'no match disables next/previous');
  await b.evaluate(`document.querySelector('.hps-find-input').select()`);await b.send('Input.insertText',{text:'사\u202e과'});await settle();
  assert.match(await count(),new RegExp(`/${TOTAL}$`),'a bidi control in the query is ignored');

  // A new answer while the bar is open is searched without scrolling the reader.
  await b.evaluate(`document.querySelector('.hps-find-input').select()`);await b.send('Input.insertText',{text:'사과'});await settle();
  const reading=await scrollTop();
  await b.evaluate(`paint({...__props,messages:[...__props.messages,{id:'a3',role:'assistant',content:'새 사과 답변',createdAt:5}]})`);await settle(200);
  assert.equal(await count().then(c=>c.split('/')[1]),String(TOTAL+1),`${label}: new text is counted`);
  if(seat==='personal')assert.equal(await scrollTop(),reading,`${label}: a reader away from the bottom is not pulled down`);

  // Esc closes: focus returns to the composer, highlights clear, the transcript does not move.
  // Read a match away from the transcript's very top (within the bar's height of the top, the
  // transcript cannot scroll further up to compensate; see REQ-STUDIO-CHAT-FIND).
  for(let i=0;i<8&&!(await count()).startsWith('5/');i++)await key('Enter','Enter',13);
  assert.ok((await scrollTop())>100,`${label}: reading in the middle of the transcript`);
  const seen=await b.evaluate(`(()=>{const r=[...CSS.highlights.get('hp-find-current')][0].getBoundingClientRect();return Math.round(r.top)})()`);
  const toBottom=await b.evaluate(`(()=>{const s=document.querySelector('.hps-messages');return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)})()`);
  const anchor=await b.evaluate(`window.__anchor=[...CSS.highlights.get('hp-find-current')][0].cloneRange(),1`);
  await b.evaluate(`document.querySelector('.hps-find-input').focus()`);await key('Escape','Escape',27);
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-find')`),false,`${label}: Esc closes`);
  assert.equal(await b.evaluate(`document.activeElement?.matches('.hps-input textarea')`),true,`${label}: focus returns to the previously focused composer`);
  assert.equal(await b.evaluate(`CSS.highlights.has('hp-find')||CSS.highlights.has('hp-find-current')`),false,'highlights cleared');
  assert.equal(await b.evaluate(`Math.round(__anchor.getBoundingClientRect().top)`),seen,`${label}: closing does not move the text being read`);
  assert.equal(await b.evaluate(`(()=>{const s=document.querySelector('.hps-messages');return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)})()`),toBottom,`${label}: closing keeps the distance to the bottom`);

  // CGP-CHAT-D-027 (D80): Esc returns focus to whatever was focused before the bar opened, not
  // always to the composer; the composer is only the fallback once that element is gone.
  const prior=await b.evaluate(`(()=>{const e=[...document.querySelectorAll('.hps-messages button')].find(x=>!x.disabled&&x.getClientRects().length);if(!e)return null;e.focus({preventScroll:true});e.dataset.findPrior='1';return document.activeElement===e})()`);
  assert.equal(prior,true,`${label}: a transcript button takes focus before find opens`);
  await findKey();assert.equal(await b.evaluate(`document.activeElement?.className`),'hps-find-input',`${label}: find opened from a transcript button`);
  await key('Escape','Escape',27);
  assert.equal(await b.evaluate(`document.activeElement?.dataset?.findPrior??null`),'1',`${label}: Esc returns focus to the previously focused transcript button, not the composer`);
  await b.evaluate(`delete document.querySelector('[data-find-prior]').dataset.findPrior`);
  await b.evaluate(`{const t=document.createElement('button');t.id='find-gone';t.textContent='x';document.body.append(t);t.focus()}`);
  await findKey();await b.evaluate(`document.getElementById('find-gone').remove()`);await key('Escape','Escape',27);
  assert.equal(await b.evaluate(`document.activeElement?.matches('.hps-input textarea')`),true,`${label}: with the earlier element gone, Esc falls back to the composer`);

  // At the bottom, open and close: following the live answer stays on.
  await b.evaluate(`{const s=document.querySelector('.hps-messages');s.scrollTop=s.scrollHeight}`);await settle();
  await findKey();await b.evaluate(`document.querySelectorAll('.hps-find-btn')[2].click()`);await settle();
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-find')`),false,'close button closes');
  await b.evaluate(`paint({...__props,messages:[...__props.messages,{id:'a3',role:'assistant',content:'새 사과 답변',createdAt:5},{id:'a4',role:'assistant',content:${JSON.stringify(filler('추가',6))},createdAt:6}]})`);await settle(250);
  assert.equal(await atBottom(),true,`${label}: after open/close at the bottom, a new answer is still followed`);

  // Reopening (Korean input source: key 'ㄹ', physical KeyF) keeps the query, moves nothing and keeps following.
  const more=`[...__props.messages,{id:'a3',role:'assistant',content:'새 사과 답변',createdAt:5},{id:'a4',role:'assistant',content:${JSON.stringify(filler('추가',6))},createdAt:6}]`;
  const stAtBottom=await scrollTop();
  await key('ㄹ','KeyF',70,(await mac())?4:2);
  assert.equal(await b.evaluate(`document.querySelector('.hps-find-input')?.value`),'사과',`${label}: Hangul-layout shortcut reopens with the kept query`);
  assert.equal(await scrollTop()-stAtBottom,await b.evaluate(`document.querySelector('.hps-find').getBoundingClientRect().bottom-document.querySelector('.hps-find').getBoundingClientRect().top+parseFloat(getComputedStyle(document.querySelector('.hps-find')).marginTop)+parseFloat(getComputedStyle(document.querySelector('.hps-find')).marginBottom)`),`${label}: reopening only compensates the bar's height`);
  assert.equal(await atBottom(),true,`${label}: still at the bottom after reopening`);
  await b.evaluate(`paint({...__props,messages:[...${more},{id:'a5',role:'assistant',content:${JSON.stringify(filler('끝',6))},createdAt:7}]})`);await settle(250);
  assert.equal(await atBottom(),true,`${label}: with the bar open and a kept query, a new answer is still followed`);
  // Enter during IME composition does not move.
  const c0=await count();
  await b.evaluate(`document.querySelector('.hps-find-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true}))`);await settle();
  assert.equal(await count(),c0,`${label}: Enter while composing does not move`);
  // Another task or activity closes the bar.
  await b.evaluate(`paint({...__props,config:{...__props.config,activity:{...__props.config.activity,id:'other-activity'}}})`);await settle();
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-find')`),false,`${label}: a conversation switch closes the bar`);
  assert.equal(await b.evaluate(`CSS.highlights.has('hp-find')`),false,`${label}: and clears its highlights`);
  await findKey();
  assert.equal(await b.evaluate(`document.querySelector('.hps-find-input').value`),'',`${label}: another activity does not inherit the previous query`);
  await b.send('Input.insertText',{text:'사과'});await settle();
  assert.equal(await currentText(),'사과');
  assert.equal(await currentVisible(),true,`${label}: same query in the new activity reveals its selected result`);
  await b.evaluate(`paint(__props)`);await settle();
  if(seat==='personal') {
    await findKey();await b.send('Input.insertText',{text:'사과'});await settle();
    await b.evaluate(`paint({...__props,config:{...__props.config,taskWorkspace:{...__props.config.taskWorkspace,activeTaskId:'other-task'}}})`);await settle();
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-find')`),false,`${label}: task switch closes find`);
    await findKey();
    assert.equal(await b.evaluate(`document.querySelector('.hps-find-input').value`),'',`${label}: task switch clears query`);
    await b.send('Input.insertText',{text:'사과'});await settle();
    assert.equal(await currentVisible(),true,`${label}: same query after task switch reveals a result`);
    await b.evaluate(`paint(__props)`);await settle();
  }

  // A modal dialog owns the keyboard: no find bar behind it.
  await b.evaluate(`{const d=document.createElement('div');d.id='modal';d.setAttribute('aria-modal','true');document.body.append(d)}`);
  await findKey();assert.equal(await b.evaluate(`!!document.querySelector('.hps-find')`),false,`${label}: no find behind a modal`);
  await b.evaluate(`document.getElementById('modal').remove()`);

  if(evidence){await findKey();await b.send('Input.insertText',{text:'사과'});await settle();const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
}
// Forced colours: system colours on the bar and the highlights.
{
  const config=chatConfig(3,{activity:{...chatConfig().activity,kind:'personal'},profile:{...chatConfig().profile,lesson:null},taskWorkspace:{scope:'find',revision:1,activeTaskId:'task',tasks:[],sourceSelection:null}});
  await b.load(`<html><style>${css}</style><style>html,body,#root{height:100%}</style><body class="vscode-dark" style="margin:0"><div id="root"></div><script>window.__props=${JSON.stringify(chatPanelProps({config,messages})).replaceAll('<','\\u003c')};window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});</script><script>${script.outputFiles[0].text}</script></body></html>`,{width:800,height:800,forcedColors:true});
  await settle(200);await findKey();await b.send('Input.insertText',{text:'사과'});await settle();
  assert.match(await count(),new RegExp(`/${TOTAL}$`),'forced colours: search works');
  const fc=await b.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.hps-find'));return s.borderTopStyle+' '+parseFloat(s.borderTopWidth)})()`);
  assert.match(fc,/^solid [1-9]/,'forced colours: the bar keeps a visible border');
  if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/personal-800-forced.png`,Buffer.from(shot.data,'base64'));}
}
console.log('PASS transcript find: Cmd/Ctrl+F, n/m over 5 planted matches (formatting, collapsed code, literal markup, case), wrap, reveal in view, Esc focus return, text stays put on open/close, follow kept; 2 seats x 2 themes x 3 widths + forced colours');
}finally{await b.close()}
