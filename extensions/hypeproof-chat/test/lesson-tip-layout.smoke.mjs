// CGP-CHAT-R-021 / CGP-CHAT-D-021 — the lesson tip above the composer, measured on the real App
// in headless Chromium: source (served step hint only), one tip, per-step dismiss that survives a
// reload, prefill that never sends, hidden during a turn or a pending send, a long hint clamped in
// one row that never overlaps the composer (CGP-CHAT-D-021), forced colours, and computed geometry (44px targets,
// >=14px text, above the composer, inside the column, focus ring) in both themes and widths.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {THEMES,KIND_CLASS} from './lib/vscode-default-themes.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Browser required');console.log('NOT RUN lesson tip layout');process.exit(0);}
const built=await build({entryPoints:['webview-ui/src/main.tsx'],bundle:true,write:false,outdir:'out',format:'iife',platform:'browser',loader:{'.svg':'dataurl','.png':'dataurl'}});
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text,js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const content=JSON.parse(readFileSync('test/fixtures/session-design/week-3.json','utf8'));
const first=content.steps[0],hintless=content.steps.find(s=>!s.hint.trim()),hinted2=content.steps.find((s,i)=>i>0&&s.hint.trim());
assert.ok(first.hint.trim()&&hintless&&hinted2,'fixture has a hinted first step, a hintless step and a second hinted step');
const lesson={course_id:'globalbuddy',version:'m1',sha256:'f'.repeat(64),content};
const shots=process.env.BROWSER_SCREENSHOTS;
const browser=await launch(bin);let cases=0;
const theme0=THEMES['Dark+'];
const page=(theme,state)=>{const vars=Object.entries(theme).filter(([k,v])=>!['kind','file'].includes(k)&&v!==null).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 return `<!doctype html><html style="${vars};--vscode-editor-foreground:${theme.foreground}"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>if(!crypto.randomUUID)crypto.randomUUID=()=>'u-'+Math.random().toString(16).slice(2);window.messages=[];window.saved=${JSON.stringify(state??null)};window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){return window.saved},setState(s){window.saved=s}});${js.replaceAll('</script','<\\/script')}</script></body></html>`;};
const configFor=(seat,les)=>({hasToken:true,coach:{name:'코치',configured:true},activity:{id:'a1',name:'작업',kind:seat,workspace:'/synthetic',verified:true},taskWorkspace:seat==='personal'?{scope:'s',revision:1,tasks:[],sourceSelection:null}:undefined,profile:{profile_id:'synthetic',activity_kind:seat,lesson:seat==='classroom'?les:null,welcome:{greeting_md:''},ux:{coach:{naming_mode:'fixed',fallback_name:'코치'},suggestions:{initial:[],follow_up:[]},hints:{short_input:{enabled:false},roll_input_button:{enabled:false}},retry_button:{enabled:false}}},textSize:'base'});
const send=async(msg)=>{await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}))`);await new Promise(r=>setTimeout(r,120));};
const open=async(theme,width,seat,state,les=lesson)=>{await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(theme,state),{width,height:900,dark:theme.kind==='dark'});await send({type:'config',config:configFor(seat,les)});};
const tips=()=>browser.evaluate(`[...document.querySelectorAll('.hps-lesson-tip')].map(e=>({step:e.dataset.lessonTip,text:e.querySelector('.hps-lesson-tip-text').textContent,html:e.innerHTML}))`);
try{
 // Behaviour (Dark+, 800px).
 await open(theme0,800,'classroom',null);
 let t=await tips();assert.equal(t.length,1,'exactly one tip');assert.equal(t[0].step,first.id);assert.equal(t[0].text,first.hint.trim());
 assert.equal(await browser.evaluate(`document.querySelectorAll('.hps-lesson-tip,.hps-lesson-tip-badge').length`),2);
 assert.equal(await browser.evaluate(`document.querySelector('.hps-lesson-tip-badge').textContent`),'도움말');
 // Prefill: the composer gets the text, nothing is sent; a second press adds nothing.
 const before=await browser.evaluate('messages.length');
 await browser.evaluate(`document.querySelector('.hps-lesson-tip-use').click()`);await new Promise(r=>setTimeout(r,80));
 assert.equal(await browser.evaluate(`document.querySelector('.hps-input textarea').value`),first.hint.trim());
 await browser.evaluate(`document.querySelector('.hps-lesson-tip-use').click()`);await new Promise(r=>setTimeout(r,80));
 assert.equal(await browser.evaluate(`document.querySelector('.hps-input textarea').value`),first.hint.trim(),'double press does not duplicate');
 // The only host message carrying the text is the existing local draft save; nothing is sent.
 const posted=JSON.parse(await browser.evaluate(`JSON.stringify(messages.slice(${before}))`));
 assert.ok(posted.every(m=>m.type==='saveActivityDraft'||!JSON.stringify(m).includes(first.hint.trim())),'only the draft save carries the tip text: '+JSON.stringify(posted));
 assert.ok(!posted.some(m=>m.type==='sendMessage'),'no sendMessage');
 // Hidden while a turn runs, back after it ends.
 await send({type:'streamStart',streamId:'s1',messageId:'m1'});assert.equal((await tips()).length,0,'hidden during a turn');
 await send({type:'streamEnd',streamId:'s1',messageId:'m1'});assert.equal((await tips()).length,1,'back after the turn');
 // Region A only moves forward (actionsFrom), so the walk is: dismiss the first step's tip, then
 // a hintless step (no tip at all), then a later hinted step (its own tip, not hidden by the first dismissal).
 const pick=async(id)=>{await browser.evaluate(`document.querySelector('button[data-step-id="${id}"]').click()`);await new Promise(r=>setTimeout(r,80));};
 await browser.evaluate(`document.querySelector('.hps-lesson-tip-dismiss').click()`);await new Promise(r=>setTimeout(r,80));
 assert.equal((await tips()).length,0,'dismissed');
 assert.ok(await browser.evaluate(`document.activeElement===document.querySelector('.hps-input textarea')`),'focus returns to the composer');
 await pick(hintless.id);
 assert.equal((await tips()).length,0,'hintless step has no tip (no generic or product tip)');
 await pick(hinted2.id);
 t=await tips();assert.equal(t.length,1,'another step keeps its tip');assert.equal(t[0].text,hinted2.hint.trim());
 const state=await browser.evaluate('window.saved');assert.equal(state.lessonTipDismissed.length,1);
 await open(theme0,800,'classroom',state);
 assert.equal((await tips()).length,0,'dismissal survives a reload');
 // A new lesson version is a different served step: its tip shows again.
 await open(theme0,800,'classroom',state,{...lesson,version:'m2',sha256:'e'.repeat(64)});
 assert.equal((await tips()).length,1,'new lesson version shows its tip');
 // Hostile hint: rendered as text; bidi/zero-width/line separators removed.
 const RLO=String.fromCharCode(0x202e),ZW=String.fromCharCode(0x200b),LS=String.fromCharCode(0x2028);
 const hostile={...lesson,content:{...content,steps:[{...first,hint:`<img src=x onerror=alert(1)>${RLO}abc${ZW}${LS}def`},...content.steps.slice(1)]}};
 await open(theme0,800,'classroom',null,hostile);
 t=await tips();assert.equal(t.length,1);assert.equal(t[0].text,'<img src=x onerror=alert(1)>abc def');assert.ok(!/<img/.test(t[0].html.replace(/&lt;img/g,'')),'no element from the hint');
 // An existing draft is kept; the tip goes on a new line after it.
 await open(theme0,800,'classroom',null);
 await browser.evaluate(`(()=>{const t=document.querySelector('.hps-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'내 글');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,80));
 await browser.evaluate(`document.querySelector('.hps-lesson-tip-use').click()`);await new Promise(r=>setTimeout(r,80));
 assert.equal(await browser.evaluate(`document.querySelector('.hps-input textarea').value`),'내 글\n'+first.hint.trim(),'draft kept, tip appended');
 // Personal seat: no lesson, no tip.
 await open(theme0,800,'personal',null);assert.equal((await tips()).length,0,'personal seat has no tip');
 // Seat and lock paths (verify 2026-10-25): the instructor console never shows a tip; a seat that
 // cannot type (unavailable) keeps the row but its action is inert; a rehearsal shows the
 // tip exactly as a learner seat does.
 const openWith=async(cfg)=>{await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(theme0,null),{width:800,height:900,dark:true});await send({type:'config',config:cfg});};
 const useState=()=>browser.evaluate(`(()=>{const b=document.querySelector('.hps-lesson-tip-use'),d=document.querySelector('.hps-lesson-tip-dismiss');return {use:b?b.disabled:null,dismiss:d?d.disabled:null};})()`);
 const pressUse=async()=>{await browser.evaluate(`document.querySelector('.hps-lesson-tip-use').click()`);await new Promise(r=>setTimeout(r,80));return browser.evaluate(`document.querySelector('.hps-input textarea')?.value??''`);};
 await openWith({...configFor('classroom',lesson),isInstructor:true});
 assert.ok(await browser.evaluate(`!!document.querySelector('.hps-instructor-band')`),'instructor console rendered');
 assert.equal((await tips()).length,0,'instructor console has no tip');
 const unverified=configFor('classroom',lesson);unverified.activity={...unverified.activity,verified:false};
 await openWith(unverified);
 assert.equal((await tips()).length,1,'unavailable seat keeps the row');
 assert.deepEqual(await useState(),{use:true,dismiss:false},'unavailable: action disabled, close still works');
 assert.equal(await pressUse(),'','unavailable: the action does not prefill');
 // A verified seat again: the same row's action works (frozen and send-locked share this disabled prop;
 // `unavailable` already includes `frozen` in ChatPanel).
 await open(theme0,800,'classroom',null);
 assert.deepEqual(await useState(),{use:false,dismiss:false},'verified seat: action enabled');
 assert.equal(await pressUse(),first.hint.trim(),'verified seat: the action prefills');
 const rehearsal=configFor('classroom',lesson);rehearsal.profile={...rehearsal.profile,rehearsal:{id:'r1',course_id:lesson.course_id,version:lesson.version,expires_at:Date.now()+3600e3,judged:false}};
 await openWith(rehearsal);
 assert.ok(await browser.evaluate(`!!document.querySelector('[data-rehearsal-send]')`),'rehearsal panel rendered');
 t=await tips();assert.equal(t.length,1,'rehearsal shows the tip like a learner seat');assert.equal(t[0].text,first.hint.trim());
 assert.equal(await pressUse(),first.hint.trim(),'rehearsal: the action prefills');
 assert.ok(!JSON.parse(await browser.evaluate('JSON.stringify(messages)')).some(m=>m.type==='sendMessage'||m.type==='rehearsalSend'),'rehearsal: nothing is sent');
 // CGP-CHAT-D-021 (D19): hidden while a send is pending (before the host starts the turn), back
 // when the host rejects it; a long hint stays one clamped row that never overlaps the composer.
 await open(theme0,800,'classroom',null);await send({type:'history',messages:[]});
 await browser.evaluate(`(()=>{const t=document.querySelector('.hps-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'질문');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,80));
 await browser.evaluate(`document.querySelector('.hps-btn-send').click()`);await new Promise(r=>setTimeout(r,120));
 assert.ok(JSON.parse(await browser.evaluate('JSON.stringify(messages)')).some(m=>m.type==='sendMessage'),'the send was posted');
 assert.equal((await tips()).length,0,'hidden while the send is pending');
 await send({type:'inputRejected',reason:'synthetic'});
 assert.equal((await tips()).length,1,'back after the host rejects the send');
 const longHint=Array.from({length:12},(_,i)=>`${i+1}번째 줄: 학교 규정 원문 어디와 대조할지 먼저 정하고, 다른 자료와 비교해 보면 쉬워요.`).join('\n');
 const longLesson={...lesson,content:{...content,steps:[{...first,hint:longHint},...content.steps.slice(1)]}};
 for(const width of [320,800,1420])for(const textSize of ['base','xlarge']){
  await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(theme0,null),{width,height:900,dark:true});
  await send({type:'config',config:{...configFor('classroom',longLesson),textSize}});
  const L=await browser.evaluate(`(()=>{const tips=document.querySelectorAll('.hps-lesson-tip');const tip=tips[0],text=tip.querySelector('.hps-lesson-tip-text'),input=document.querySelector('.hps-input');const r=tip.getBoundingClientRect(),c=input.getBoundingClientRect(),q=text.getBoundingClientRect();
   const lh=parseFloat(getComputedStyle(text).lineHeight)||parseFloat(getComputedStyle(text).fontSize)*1.5;
   const kids=[...tip.children].map(e=>{const k=e.getBoundingClientRect();return {top:k.top,bottom:k.bottom}});
   return {count:tips.length,tipBottom:r.bottom,cTop:c.top,cBottom:c.bottom,textH:q.height,lh,clipped:text.scrollHeight>text.clientHeight+1,kids,vh:innerHeight};})()`);
  const tag=`${width}px ${textSize}`;
  assert.equal(L.count,1,`${tag}: one tip row`);
  assert.ok(L.textH<=2*L.lh+1,`${tag}: long hint clamped to two lines (${L.textH} <= 2x${L.lh})`);
  assert.ok(L.clipped,`${tag}: the long hint is actually clamped`);
  assert.ok(L.tipBottom<=L.cTop+.5,`${tag}: tip above the composer, no overlap (${L.tipBottom} <= ${L.cTop})`);
  assert.ok(L.cBottom<=L.vh+.5,`${tag}: the composer stays on screen`);
  // At chat-column widths every part of the tip shares one line; the 320px panel may wrap the
  // two buttons under the text inside the same row element (44px targets win, decisions.md).
  if(width>=800){const mid=k=>(k.top+k.bottom)/2,m0=mid(L.kids[0]);for(const k of L.kids)assert.ok(k.top<m0&&k.bottom>m0,`${tag}: badge, text and buttons share one line ${JSON.stringify(L.kids)}`);}
 }
 // Forced colours: the row keeps a system-colour border and the buttons stay system colours.
 await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(theme0,null),{width:800,height:900,dark:true,forcedColors:true});
 await send({type:'config',config:configFor('classroom',lesson)});
 const fc=await browser.evaluate(`(()=>{const tip=document.querySelector('.hps-lesson-tip'),s=getComputedStyle(tip),b=getComputedStyle(document.querySelector('.hps-lesson-tip-use'));return {bw:parseFloat(s.borderTopWidth),bs:s.borderTopStyle,bc:s.borderTopColor,fg:s.color,btn:b.color};})()`);
 assert.ok(fc.bw>=1&&fc.bs!=='none','forced colours: the row keeps its border');
 assert.equal(fc.bc,fc.fg,'forced colours: border is CanvasText (the text colour)');
 cases++;
 // Geometry in both themes and widths.
 for(const themeName of ['Dark+','Light+'])for(const width of [320,800,1420]){
  const theme=THEMES[themeName];await open(theme,width,'classroom',null);
  const g=await browser.evaluate(`(()=>{const tip=document.querySelector('.hps-lesson-tip'),input=document.querySelector('.hps-input'),foot=document.querySelector('.hps-input-area');const r=tip.getBoundingClientRect(),c=input.getBoundingClientRect(),f=foot.getBoundingClientRect();
   const b=[...tip.querySelectorAll('button')].map(x=>{const q=x.getBoundingClientRect();return {w:q.width,h:q.height}});
   const fs=[...tip.querySelectorAll('.hps-lesson-tip-text,.hps-lesson-tip-badge,button')].map(x=>parseFloat(getComputedStyle(x).fontSize));
   return {bottom:r.bottom,top:r.top,left:r.left,right:r.right,cTop:c.top,fLeft:f.left,fRight:f.right,b,fs,overflow:document.documentElement.scrollWidth>innerWidth,svg:tip.querySelectorAll('.hps-lesson-tip-dismiss svg[data-icon="close"]').length,glyph:tip.querySelector('.hps-lesson-tip-dismiss').textContent.trim()};})()`);
  assert.ok(g.bottom<=g.cTop+.5,`tip sits above the composer (${g.bottom} <= ${g.cTop})`);
  assert.ok(g.left>=g.fLeft-.5&&g.right<=g.fRight+.5,'tip stays inside the composer column');
  assert.equal(g.overflow,false,'no horizontal overflow');
  for(const x of g.b)assert.ok(x.w>=44&&x.h>=44,`44px targets: ${JSON.stringify(g.b)}`);
  for(const f of g.fs)assert.ok(f>=14,`text >= 14px: ${g.fs}`);
  assert.equal(g.svg,1);assert.equal(g.glyph,'','dismiss uses ChatIcon, not a glyph');
  for(const sel of ['.hps-lesson-tip-use','.hps-lesson-tip-dismiss']){const ring=await browser.focusVisibleStyle(sel);assert.equal(ring['outline-width'],'2px');assert.notEqual(ring['outline-style'],'none');}
  if(shots){mkdirSync(shots,{recursive:true});const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${shots}/classroom-${theme.kind}-${width}.png`,Buffer.from(png.data,'base64'));}
  if(shots&&width!==320){await open(theme,width,'personal',null);const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${shots}/personal-${theme.kind}-${width}.png`,Buffer.from(png.data,'base64'));}
  cases++;
 }
 console.log(`PASS lesson tip actual App: behaviour + ${cases-1} theme/width geometry cases (one tip from the served hint, prefill never sends, per-step dismiss survives reload, hidden during a turn and a pending send, long hint clamped to two lines in one row that never overlaps the composer at 320-1420px and xlarge text, forced-colours border, hostile text inert, personal seat none).`);
}finally{await browser.close();}
