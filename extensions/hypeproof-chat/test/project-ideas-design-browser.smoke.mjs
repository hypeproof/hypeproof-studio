// CGP-SHELL-D-019 / DES-SHELL-19 — the idea list's design acceptance measured on the real App in
// headless Chromium, with input sent through the DevTools protocol (never the OS):
// - at most six cards, and each WHOLE card (title plus 이걸로 시작) is at most two line boxes, even
//   for a title far longer than any shipped one; shipped titles are never clipped;
// - one column below a 640px chat pane and two at 640px and wider, measured at 639 and 640;
// - 내가 정할래요 is the topmost element at its own centre in a short pane without any scrolling;
// - a real mouse pick fills the composer and never sends, and a pick during a real IME composition
//   (Input.imeSetComposition) keeps the composed syllable and the learner's text exactly as typed.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {THEMES,KIND_CLASS} from './lib/vscode-default-themes.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Browser required');console.log('NOT RUN project ideas design');process.exit(0);}
const built=await build({entryPoints:['webview-ui/src/main.tsx'],bundle:true,write:false,outdir:'out',format:'iife',platform:'browser',loader:{'.svg':'dataurl','.png':'dataurl'}});
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text,js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const browser=await launch(bin);
const page=(theme)=>{const vars=Object.entries(theme).filter(([k,v])=>!['kind','file'].includes(k)&&v!==null).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 return `<!doctype html><html style="${vars};--vscode-editor-foreground:${theme.foreground}"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>window.messages=[];window.saved=null;window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){return window.saved},setState(s){window.saved=s}});${js.replaceAll('</script','<\\/script')}</script></body></html>`;};
const config={hasToken:true,coach:{name:'코치',configured:true},activity:{id:'a1',name:'작업',kind:'personal',workspace:'/synthetic',verified:true},taskWorkspace:{scope:'s',revision:1,tasks:[],sourceSelection:null},profile:{profile_id:'synthetic',activity_kind:'personal',lesson:null,welcome:{greeting_md:''},ux:{coach:{naming_mode:'fixed',fallback_name:'코치'},suggestions:{initial:[],follow_up:[]},hints:{short_input:{enabled:false},roll_input_button:{enabled:false}},retry_button:{enabled:false}}},textSize:'base'};
const msg=(id,role,content)=>({id,role,content,createdAt:1});
const history=[msg('a0','assistant','안녕하세요! 오늘은 무엇을 만들어 보고 싶어요?'),msg('u1','user','잘 모르겠어요'),msg('a1','assistant','괜찮아요. 같이 찾아봐요.')];
// Conditions, not fixed delays: poll an expression until it holds.
const waitFor=async(expr,what,ms=5000)=>{const end=Date.now()+ms;for(;;){if(await browser.evaluate(expr))return;if(Date.now()>end)throw Error(`timed out waiting for ${what}`);await new Promise(r=>setTimeout(r,25));}};
// Runtime.evaluate with awaitPromise: the shared evaluate() returns a promise unresolved.
const settle=async(expr)=>{const r=await browser.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??'evaluate failed');return r.result.value;};
const frames=()=>settle(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
const post=(m)=>browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(m)}}))`);
const open=async(theme,width,height,forcedColors=false)=>{await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(theme),{width,height,dark:theme.kind==='dark',forcedColors});
 await post({type:'config',config});await waitFor(`!!document.querySelector('.hps-input textarea')`,'composer');
 await post({type:'history',messages:history});await waitFor(`document.querySelectorAll('[data-project-ideas] .hps-project-idea').length>0`,'idea list');
 // Two animation frames so layout and the newest-end scroll have settled before measuring.
 await frames();};
const value=()=>browser.evaluate(`document.querySelector('.hps-input textarea').value`);
const sends=async()=>JSON.parse(await browser.evaluate('JSON.stringify(messages)')).filter(m=>m.type==='sendMessage'||m.type==='send').length;
const center=(sel)=>browser.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
const mouseClick=async(sel)=>{const {x,y}=await center(sel);for(const type of ['mousePressed','mouseReleased'])await browser.send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});};
// Visible line boxes of one element's text, counted from the browser's own rects (not height /
// line-height); lines a clamp hides fall outside the element's box and are not counted.
const CARD=`(card)=>{const lines=(el)=>{const box=el.getBoundingClientRect(),rg=document.createRange();rg.selectNodeContents(el);const tops=[];for(const r of rg.getClientRects()){if(r.width<1||r.top<box.top-1||r.bottom>box.bottom+1)continue;if(!tops.some(t=>Math.abs(t-r.top)<2))tops.push(r.top);}return tops.length;};
 const t=card.querySelector('.hps-project-idea-title'),u=card.querySelector('.hps-project-idea-use'),cs=getComputedStyle(card),lh=parseFloat(getComputedStyle(t).lineHeight);
 const c=card.getBoundingClientRect(),ur=u.getBoundingClientRect();
 const content=c.height-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom)-parseFloat(cs.borderTopWidth)-parseFloat(cs.borderBottomWidth);
 return {titleLines:lines(t),useLines:lines(u),lh,content,clipped:t.scrollHeight>t.clientHeight+1,useInside:ur.left>=c.left-.5&&ur.right<=c.right+.5&&ur.top>=c.top-.5&&ur.bottom<=c.bottom+.5};}`;
const cards=()=>browser.evaluate(`[...document.querySelectorAll('[data-project-ideas] .hps-project-idea')].map(${CARD})`);
const twoLineCard=(x,label)=>{
 assert.ok(x.titleLines<=2,`${label}: title at most two lines: ${JSON.stringify(x)}`);
 assert.equal(x.useLines,1,`${label}: 이걸로 시작 on one line: ${JSON.stringify(x)}`);
 assert.ok(x.useInside,`${label}: 이걸로 시작 inside its card: ${JSON.stringify(x)}`);
 assert.ok(x.content<=2*x.lh+1,`${label}: whole card at most two lines tall: ${JSON.stringify(x)}`);};
let cases=0;
try{
 // 1. Card count and the two-line card, both themes, 320/800/1420 px, plus forced colours.
 const runs=[];for(const n of ['Dark+','Light+'])for(const w of [320,800,1420])runs.push([n,w,false]);runs.push(['Dark+',320,true]);
 for(const [name,width,forced] of runs){
  await open(THEMES[name],width,900,forced);const label=`${name} ${width}px${forced?' forced':''}`;
  const list=await cards();
  assert.ok(list.length>=1&&list.length<=6,`${label}: at most six cards: ${list.length}`);
  for(const x of list){twoLineCard(x,label);assert.equal(x.clipped,false,`${label}: a shipped title is never clipped: ${JSON.stringify(x)}`);}
  // A title far longer than any shipped one: the clamp holds the whole card, not only the title.
  const long=await browser.evaluate(`(()=>{const card=document.querySelector('.hps-project-idea'),t=card.querySelector('.hps-project-idea-title'),before=t.textContent;t.textContent='아주 긴 아이디어 제목 '.repeat(30);const m=(${CARD})(card);t.textContent=before;return m;})()`);
  twoLineCard(long,`${label} long title`);
  cases++;
 }
 // 2. Columns follow the chat pane's own width: 639px is one column, 640px is two.
 await open(THEMES['Dark+'],1420,900);
 const seen=new Set();
 for(const target of [320,639,640,900]){
  const g=await settle(`(async()=>{const shell=document.querySelector('.hps-shell'),cs=getComputedStyle(shell);
   const outer=${target}+parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)+parseFloat(cs.borderLeftWidth)+parseFloat(cs.borderRightWidth);
   shell.style.flex='0 0 auto';shell.style.width=outer+'px';shell.style.maxWidth=outer+'px';shell.style.minWidth=outer+'px';
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const pane=shell.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
   const lefts=new Set([...document.querySelectorAll('[data-project-ideas] .hps-project-idea')].map(b=>Math.round(b.getBoundingClientRect().left)));
   return {pane,cols:lefts.size};})()`);
  assert.equal(Math.round(g.pane),target,`chat pane set to ${target}px: ${JSON.stringify(g)}`);
  assert.equal(g.cols,target>=640?2:1,`columns at a ${target}px chat pane: ${JSON.stringify(g)}`);
  seen.add(`${target}:${g.cols}`);cases++;
 }
 assert.ok(seen.has('639:1')&&seen.has('640:2'),'the 640px boundary was measured on both sides');
 // 3. 내가 정할래요 visible without scrolling: nothing scrolls it into view, and at its centre the
 //    topmost element is the button itself (not the composer or another layer), in short panes.
 for(const [name,width,height,forced] of [['Dark+',320,500,false],['Light+',320,420,false],['Dark+',1420,500,false],['Dark+',320,420,true]]){
  await open(THEMES[name],width,height,forced);
  const v=await browser.evaluate(`(()=>{const own=document.querySelector('.hps-project-ideas-own'),s=document.querySelector('.hps-messages'),o=own.getBoundingClientRect(),sr=s.getBoundingClientRect();
   const hit=document.elementFromPoint(o.left+o.width/2,o.top+o.height/2);
   return {text:own.textContent,top:o.top,bottom:o.bottom,sTop:sr.top,sBottom:sr.bottom,vh:innerHeight,onTop:hit===own||own.contains(hit),pageScroll:scrollY};})()`);
  const label=`${name} ${width}x${height}${forced?' forced':''}`;
  assert.equal(v.text,'내가 정할래요');
  assert.ok(v.top>=v.sTop-.5&&v.bottom<=v.sBottom+.5&&v.bottom<=v.vh,`${label}: 내가 정할래요 inside the visible conversation: ${JSON.stringify(v)}`);
  assert.ok(v.onTop,`${label}: 내가 정할래요 is the topmost element at its centre: ${JSON.stringify(v)}`);
  assert.equal(v.pageScroll,0,`${label}: the page itself did not scroll`);
  cases++;
 }
 // 4. Real input. While a Korean IME composition is open, every pick is disabled. A real mouse press
 //    on a card first commits the composition (Chromium ends it on the press, as the OS IME does),
 //    so the composed syllable is kept exactly as typed and the idea goes on a new line after it;
 //    nothing is overwritten and nothing is sent. A keyboard pick behaves the same.
 const PROMPT='내가 좋아하는 주제로 문제 다섯 개짜리 퀴즈 페이지를 만들고 싶어요.';
 await open(THEMES['Dark+'],800,900);
 await browser.evaluate(`document.querySelector('.hps-input textarea').focus()`);
 await browser.send('Input.insertText',{text:'내 생각 '});
 await waitFor(`document.querySelector('.hps-input textarea').value==='내 생각 '`,'typed text');
 await browser.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
 await waitFor(`[...document.querySelectorAll('.hps-project-idea')].every(b=>b.disabled)`,'picks inert while composing');
 await browser.send('Input.imeSetComposition',{text:'하',selectionStart:1,selectionEnd:1});
 assert.ok(await browser.evaluate(`[...document.querySelectorAll('.hps-project-idea')].every(b=>b.disabled)`),'still inert mid-syllable');
 await mouseClick('.hps-project-idea[data-idea="quiz"]');
 await waitFor(`document.querySelector('.hps-input textarea').value.includes('퀴즈')`,'idea after the committed syllable');
 assert.equal(await value(),'내 생각 하\n'+PROMPT,'the composed syllable is kept exactly as typed, then the idea on a new line');
 assert.equal(await sends(),0,'a pick never sends');
 // A second pick replaces the first idea and still keeps the learner's own text.
 await mouseClick('.hps-project-idea[data-idea="trip-plan"]');
 await waitFor(`document.querySelector('.hps-input textarea').value.includes('여행')`,'second idea');
 const second=await value();
 assert.ok(second.startsWith('내 생각 하\n')&&!second.includes('퀴즈'),`second pick replaces the first, learner text kept: ${JSON.stringify(second)}`);
 // Keyboard: focus a card and press Enter (DevTools key events, not the OS).
 await browser.evaluate(`document.querySelector('.hps-project-idea[data-idea="quiz"]').focus()`);
 await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await waitFor(`document.querySelector('.hps-input textarea').value.includes('퀴즈')`,'keyboard pick');
 assert.ok((await value()).startsWith('내 생각 하\n'),'keyboard pick keeps the learner text');
 assert.equal(await sends(),0,'no pick sends');
 cases++;
 console.log(`PASS project ideas design (DES-SHELL-19): ${cases} cases (at most six cards, whole card at most two lines incl. a long title, 639/640px pane columns, 내가 정할래요 topmost without scrolling, real mouse pick and IME composition intact).`);
}finally{await browser.close();}
