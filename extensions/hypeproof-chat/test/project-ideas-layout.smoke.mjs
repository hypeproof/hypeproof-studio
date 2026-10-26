// CGP-SHELL-R-020 / DES-SHELL-19 — example project ideas on the real App in headless Chromium:
// never on the first screen; after a no-idea answer to a goal question up to six ideas with
// "이걸로 시작" and "내가 정할래요"; a pick fills the composer for editing and never sends; hidden
// during a turn, in a lesson, in the instructor console and once the learner moves on; dismissal
// survives a reload. Computed geometry: 44px targets, >=14px text, one column at 320px and two at
// >=640px, cards at most two lines, "내가 정할래요" visible without scrolling, focus ring, forced colours.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {THEMES,KIND_CLASS} from './lib/vscode-default-themes.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Browser required');console.log('NOT RUN project ideas layout');process.exit(0);}
const built=await build({entryPoints:['webview-ui/src/main.tsx'],bundle:true,write:false,outdir:'out',format:'iife',platform:'browser',loader:{'.svg':'dataurl','.png':'dataurl'}});
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text,js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const shots=process.env.BROWSER_SCREENSHOTS;
const browser=await launch(bin);let cases=0,twoCols=0;
const theme0=THEMES['Dark+'];
const page=(theme,state)=>{const vars=Object.entries(theme).filter(([k,v])=>!['kind','file'].includes(k)&&v!==null).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 return `<!doctype html><html style="${vars};--vscode-editor-foreground:${theme.foreground}"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>window.messages=[];window.saved=${JSON.stringify(state??null)};window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){return window.saved},setState(s){window.saved=s}});${js.replaceAll('</script','<\\/script')}</script></body></html>`;};
const lesson={course_id:'c',version:'v1',sha256:'f'.repeat(64),content:{title:'수업',steps:[{id:'s1',title:'첫 단계',instructions:'i',hint:'',acceptance:'a'}]}};
const configFor=(seat,greeting='',followUp=[])=>({hasToken:true,coach:{name:'코치',configured:true},activity:{id:'a1',name:'작업',kind:seat,workspace:'/synthetic',verified:true},taskWorkspace:seat==='personal'?{scope:'s',revision:1,tasks:[],sourceSelection:null}:undefined,profile:{profile_id:'synthetic',activity_kind:seat,lesson:seat==='classroom'?lesson:null,welcome:{greeting_md:greeting},ux:{coach:{naming_mode:'fixed',fallback_name:'코치'},suggestions:{initial:[],follow_up:followUp},hints:{short_input:{enabled:false},roll_input_button:{enabled:false}},retry_button:{enabled:false}}},textSize:'base'});
const msg=(id,role,content)=>({id,role,content,createdAt:1});
const Q=msg('a0','assistant','안녕하세요! 오늘은 무엇을 만들어 보고 싶어요?'),A=msg('u1','user','잘 모르겠어요'),R=msg('a1','assistant','괜찮아요. 같이 찾아봐요.');
const send=async(m)=>{await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(m)}}))`);await new Promise(r=>setTimeout(r,120));};
const open=async(theme,width,{seat='personal',history=[Q,A,R],state=null,greeting='',config,forcedColors=false,height=900}={})=>{await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(theme,state),{width,height,dark:theme.kind==='dark',forcedColors});await send({type:'config',config:config??configFor(seat,greeting)});if(history.length)await send({type:'history',messages:history});};
const ideas=()=>browser.evaluate(`[...document.querySelectorAll('[data-project-ideas] .hps-project-idea')].map(b=>({id:b.dataset.idea,text:b.textContent,pressed:b.getAttribute('aria-pressed')}))`);
const has=()=>browser.evaluate(`!!document.querySelector('[data-project-ideas]')`);
const value=()=>browser.evaluate(`document.querySelector('.hps-input textarea').value`);
const click=async(sel)=>{await browser.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);await new Promise(r=>setTimeout(r,100));};
const sent=async()=>JSON.parse(await browser.evaluate('JSON.stringify(messages)')).filter(m=>m.type==='sendMessage'||m.type==='send');
try{
 // First screen: never, even when the greeting itself asks the goal question.
 await open(theme0,800,{history:[],greeting:'오늘은 무엇을 만들어 볼까요?'});
 assert.equal(await has(),false,'first screen shows no idea cards');
 // Never mid-work: a written file, an existing artifact, a late conversation or a detail question.
 const toolRow={id:'t1',role:'tool',content:'',createdAt:1,tool:{icon:'✍️',label:'파일 고치기 · index.html',state:'done'}};
 await open(theme0,800,{history:[Q,toolRow,A,R]});
 assert.equal(await has(),false,'a file was written in this task: no ideas');
 const withSurface=configFor('personal');withSurface.taskWorkspace.sourceSelection={url:'file:///synthetic/index.html',pinned:false};
 await open(theme0,800,{config:withSurface});
 assert.equal(await has(),false,'an artifact is picked in this task: no ideas');
 await open(theme0,800,{history:[msg('x1','user','안녕'),msg('y1','assistant','네'),msg('x2','user','도와줘'),msg('y2','assistant','네'),msg('x3','user','응'),msg('y3','assistant','네'),Q,A,R]});
 assert.equal(await has(),false,'late in the conversation (4th learner message): no ideas');
 await open(theme0,800,{history:[msg('a0','assistant','어떤 색으로 만들까요?'),A,R]});
 assert.equal(await has(),false,'a detail question is not a goal question: no ideas');
 // After the no-idea answer: six ideas, both actions.
 await open(theme0,800);
 let list=await ideas();assert.equal(list.length,6,'six ideas');
 for(const i of list)assert.ok(i.text.includes('이걸로 시작'),'each idea offers 이걸로 시작');
 assert.equal(await browser.evaluate(`document.querySelector('.hps-project-ideas-own').textContent`),'내가 정할래요');
 // Pick: fills the composer with the idea's prompt, never sends; a second pick replaces the first.
 await click('.hps-project-idea[data-idea="quiz"]');
 const quiz=await value();assert.match(quiz,/퀴즈/);assert.equal((await sent()).length,0,'a pick never sends');
 assert.equal((await ideas()).find(i=>i.id==='quiz').pressed,'true');
 assert.ok(await browser.evaluate(`document.activeElement===document.querySelector('.hps-input textarea')`),'focus goes to the composer for editing');
 await click('.hps-project-idea[data-idea="trip-plan"]');
 const trip=await value();assert.match(trip,/여행/);assert.ok(!trip.includes('퀴즈'),'second pick replaces the first');
 assert.equal((await sent()).length,0);
 // The chosen mark follows the composer: editing the sentence away clears it.
 const typeDraft=async(v)=>{await browser.evaluate(`(()=>{const t=document.querySelector('.hps-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(v)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,80));};
 await typeDraft('내가 다시 쓸게요');
 assert.ok((await ideas()).every(i=>i.pressed==='false'),'no idea marked once its sentence is gone');
 // Korean IME: while the composer is composing, picks are inert, so the composition is never overwritten.
 await typeDraft('');
 await browser.evaluate(`document.querySelector('.hps-input textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'ㅎ'}))`);await new Promise(r=>setTimeout(r,80));
 assert.ok(await browser.evaluate(`[...document.querySelectorAll('.hps-project-idea')].every(b=>b.disabled)`),'composing: picks disabled');
 await click('.hps-project-idea[data-idea="quiz"]');assert.equal(await value(),'','composing: no prefill');
 await browser.evaluate(`document.querySelector('.hps-input textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'하'}))`);await new Promise(r=>setTimeout(r,80));
 assert.ok(await browser.evaluate(`[...document.querySelectorAll('.hps-project-idea')].every(b=>!b.disabled)`),'after composition: picks enabled');
 // A missing task folder makes the draft read-only: picks are inert.
 await send({type:'missingTaskFolder',notice:{message:'폴더가 없어요',action:'다시 고르기'}});
 assert.ok(await browser.evaluate(`[...document.querySelectorAll('.hps-project-idea')].every(b=>b.disabled)`),'missing folder: picks disabled');
 await send({type:'missingTaskFolder',notice:null});
 // Profile follow-up chips give way to the idea list: one picker at a time.
 await open(theme0,800,{config:configFor('personal','',[{text:'이어서 하기',style:'good'}])});
 assert.equal(await has(),true);assert.equal(await browser.evaluate(`document.querySelectorAll('.hps-chips-rack').length`),0,'no follow-up chips beside the ideas');
 await open(theme0,800,{config:configFor('personal','',[{text:'이어서 하기',style:'good'}]),history:[Q,msg('u1','user','퀴즈 만들래요'),R]});
 assert.equal(await browser.evaluate(`document.querySelectorAll('.hps-chips-rack').length`),1,'control: follow-up chips without an offer');
 // Learner text already in the composer is kept; the idea goes on a new line.
 await open(theme0,800);
 await browser.evaluate(`(()=>{const t=document.querySelector('.hps-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'내 생각');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,80));
 await click('.hps-project-idea[data-idea="quiz"]');
 assert.ok((await value()).startsWith('내 생각\n'),'manual text kept: '+JSON.stringify(await value()));
 // Hidden while the coach's reply to the answer streams in (text already showing), back after it ends.
 await open(theme0,800,{history:[Q,A]});
 assert.equal(await has(),true,'answer without a reply yet (turn about to run)');
 await send({type:'streamStart',streamId:'s1',messageId:'m1'});
 await send({type:'streamChunk',streamId:'s1',delta:'괜찮아요. 같이 찾아봐요.'});
 assert.equal(await has(),false,'hidden while the reply streams');
 await send({type:'streamEnd',streamId:'s1',messageId:'m1'});
 assert.equal(await has(),true,'back after the turn ends');
 // "내가 정할래요": closes, returns focus to the composer, survives a reload.
 await open(theme0,800);
 await click('.hps-project-ideas-own');
 assert.equal(await has(),false,'closed');
 assert.ok(await browser.evaluate(`document.activeElement===document.querySelector('.hps-input textarea')`),'focus returns to the composer');
 const state=await browser.evaluate('window.saved');assert.equal(state.projectIdeasDismissed.length,1);
 await open(theme0,800,{state});assert.equal(await has(),false,'dismissal survives a reload');
 // A later no-idea answer is a new offer.
 await open(theme0,800,{state,history:[Q,A,R,msg('a2','assistant','그럼 무엇을 만들고 싶어요?'),msg('u3','user','몰라요'),msg('a3','assistant','좋아요')]});
 assert.equal((await ideas()).length,6,'a new answer gets its own offer');
 // Not offered: the learner moved on, a named goal, a non-goal question, a lesson, the instructor console.
 await open(theme0,800,{history:[Q,A,R,msg('u2','user','퀴즈로 할게요')]});assert.equal(await has(),false,'moved on');
 await open(theme0,800,{history:[Q,msg('u1','user','퀴즈 만들래요'),R]});assert.equal(await has(),false,'named goal');
 await open(theme0,800,{history:[msg('a0','assistant','파일을 저장했어요. 다른 질문 있어요?'),A,R]});assert.equal(await has(),false,'not a goal question');
 await open(theme0,800,{seat:'classroom'});assert.equal(await has(),false,'lesson seat: none');
 await open(theme0,800,{config:{...configFor('personal'),isInstructor:true}});
 assert.ok(await browser.evaluate(`!!document.querySelector('.hps-instructor-band')`),'instructor console rendered');
 assert.equal(await has(),false,'instructor console: none');
 // A seat that cannot type keeps the list but its picks are inert.
 const unverified=configFor('personal');unverified.activity={...unverified.activity,verified:false};
 await open(theme0,800,{config:unverified});
 assert.equal(await has(),true,'unavailable seat keeps the list');
 assert.ok(await browser.evaluate(`[...document.querySelectorAll('.hps-project-idea')].every(b=>b.disabled)`),'unavailable: picks disabled');
 await click('.hps-project-idea[data-idea="quiz"]');assert.equal(await value(),'','unavailable: no prefill');
 cases++;
 // Geometry in both themes, three widths, plus forced colours.
 const runs=[];for(const n of ['Dark+','Light+'])for(const w of [320,800,1420])runs.push([n,w,false,900]);runs.push(['Dark+',800,true,900],['Dark+',320,false,500]);
 for(const [themeName,width,forced,height] of runs){
  const theme=THEMES[themeName];await open(theme,width,{forcedColors:forced,height});
  const g=await browser.evaluate(`(()=>{const box=document.querySelector('[data-project-ideas]'),own=document.querySelector('.hps-project-ideas-own'),scroller=document.querySelector('.hps-messages');
   const cards=[...box.querySelectorAll('.hps-project-idea')].map(b=>b.getBoundingClientRect());
   const titles=[...box.querySelectorAll('.hps-project-idea-title')].map(t=>({h:t.getBoundingClientRect().height,lh:parseFloat(getComputedStyle(t).lineHeight)}));
   const targets=[own,...box.querySelectorAll('.hps-project-idea')].map(b=>{const r=b.getBoundingClientRect();return {w:r.width,h:r.height}});
   const fs=[...box.querySelectorAll('p,button,span')].map(x=>parseFloat(getComputedStyle(x).fontSize));
   const lefts=new Set(cards.map(r=>Math.round(r.left)));const o=own.getBoundingClientRect(),s=scroller.getBoundingClientRect(),b=box.getBoundingClientRect();
   return {cols:lefts.size,targets,fs,titles,own:{top:o.top,bottom:o.bottom},sTop:s.top,sBottom:s.bottom,box:{left:b.left,right:b.right},sLeft:s.left,sRight:s.right,pane:document.querySelector('.hps-shell').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,border:getComputedStyle(box.querySelector('.hps-project-idea')).borderTopStyle};})()`);
  // DES-SHELL-19 measures the chat pane (the studio-chat container), not the window: the personal
  // task rail takes part of an 800px window.
  assert.equal(g.cols,g.pane>=640?2:1,`columns at a ${g.pane}px chat pane: ${g.cols}`);if(g.cols===2)twoCols++;
  for(const x of g.targets)assert.ok(x.w>=44&&x.h>=44,`44px targets: ${JSON.stringify(x)}`);
  for(const f of g.fs)assert.ok(f>=14,`text >= 14px: ${g.fs}`);
  for(const t of g.titles)assert.ok(t.h<=2*t.lh+1,`card title at most two lines: ${JSON.stringify(t)}`);
  // The clamp itself: a title far longer than any shipped idea still stops at two lines.
  const long=await browser.evaluate(`(()=>{const t=document.querySelector('.hps-project-idea-title'),before=t.textContent;t.textContent='아주 긴 아이디어 제목 '.repeat(30);const h=t.getBoundingClientRect().height,lh=parseFloat(getComputedStyle(t).lineHeight);t.textContent=before;return {h,lh};})()`);
  assert.ok(long.h<=2*long.lh+1,`long title clamped to two lines: ${JSON.stringify(long)}`);
  assert.ok(g.own.top>=g.sTop-.5&&g.own.bottom<=g.sBottom+.5,`내가 정할래요 visible without scrolling: ${JSON.stringify(g)}`);
  assert.ok(g.box.left>=g.sLeft-.5&&g.box.right<=g.sRight+.5,'inside the chat column');
  assert.equal(g.overflow,false,'no horizontal overflow');
  assert.notEqual(g.border,'none','cards keep a visible border (also in forced colours)');
  for(const sel of ['.hps-project-ideas-own','.hps-project-idea']){const ring=await browser.focusVisibleStyle(sel);assert.equal(ring['outline-width'],'2px');assert.notEqual(ring['outline-style'],'none');}
  if(shots){mkdirSync(shots,{recursive:true});const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${shots}/personal-${forced?'forced':theme.kind}-${width}x${height}.png`,Buffer.from(png.data,'base64'));}
  if(shots&&!forced&&width===800){await open(theme,width,{seat:'classroom'});const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${shots}/classroom-${theme.kind}-${width}.png`,Buffer.from(png.data,'base64'));}
  cases++;
 }
 assert.ok(twoCols>0,'some case reaches a pane of at least 640px and shows two columns');
 console.log(`PASS project ideas actual App: behaviour + ${cases-1} geometry cases (never on the first screen, six ideas after a no-idea answer, pick fills the composer and never sends, 내가 정할래요 closes and survives reload, none in a lesson or the instructor console).`);
}finally{await browser.close();}
