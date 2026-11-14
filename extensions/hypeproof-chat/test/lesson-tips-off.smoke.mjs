// CGP-SHELL-R-019 (REQ-SHELL-19): "팁 그만 보기" turns every lesson tip (CGP-CHAT-R-021) off until the learner
// turns tips on again, measured on the real App in headless Chromium with a served lesson whose steps have hints.
//   node --experimental-strip-types test/lesson-tips-off.smoke.mjs
//
// - The tip row has a third, quiet action 팁 그만 보기 (44px, 14px). Pressing it posts exactly one
//   { type: "setLessonTips", on: false } and nothing else that carries lesson text; the tip goes, and a
//   role=status line says tips are off and how to get them back, with 다시 켜기 focused.
// - With the host's config lessonTips:false no tip appears on any hinted step, after a reload or in a new
//   window; the lesson itself stays (the steps, the rail's 힌트 보기, the composer).
// - 다시 켜기 posts one { on: true }; with lessonTips:true the next hinted step's tip is back. Per-step
//   dismissal (닫기) still works and posts no setLessonTips.
// - The note is said once: the next send ends it.
// - Negative controls: a personal seat (no lesson) and a hintless step draw no tip, no 팁 그만 보기 and post nothing.
// Reads are states, attributes and minimum boxes, never text widths. Without a headless Chromium this prints
// NOT RUN; FOCUS_REQUIRE_BROWSER=1 makes that a failure.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {THEMES,KIND_CLASS} from './lib/vscode-default-themes.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Browser required');console.log('NOT RUN lesson tips off');process.exit(0);}
const built=await build({entryPoints:['webview-ui/src/main.tsx'],bundle:true,write:false,outdir:'out',format:'iife',platform:'browser',loader:{'.svg':'dataurl','.png':'dataurl'}});
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text,js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const content=JSON.parse(readFileSync('test/fixtures/session-design/week-3.json','utf8'));
const first=content.steps[0],hintless=content.steps.find(s=>!s.hint.trim()),hinted2=content.steps.find((s,i)=>i>0&&s.hint.trim());
assert.ok(first.hint.trim()&&hintless&&hinted2,'fixture has a hinted first step, a hintless step and a second hinted step');
const lesson={course_id:'globalbuddy',version:'m1',sha256:'f'.repeat(64),content};
const browser=await launch(bin);
const page=(theme,state)=>{const vars=Object.entries(theme).filter(([k,v])=>!['kind','file'].includes(k)&&v!==null).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 return `<!doctype html><html style="${vars};--vscode-editor-foreground:${theme.foreground}"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>if(!crypto.randomUUID)crypto.randomUUID=()=>'u-'+Math.random().toString(16).slice(2);window.messages=[];window.saved=${JSON.stringify(state??null)};window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){return window.saved},setState(s){window.saved=s}});${js.replaceAll('</script','<\\/script')}</script></body></html>`;};
const configFor=(seat,les,lessonTips)=>({hasToken:true,coach:{name:'코치',configured:true},activity:{id:'a1',name:'작업',kind:seat,workspace:'/synthetic',verified:true},taskWorkspace:seat==='personal'?{scope:'s',revision:1,tasks:[],sourceSelection:null}:undefined,profile:{profile_id:'synthetic',activity_kind:seat,lesson:seat==='classroom'?les:null,welcome:{greeting_md:''},ux:{coach:{naming_mode:'fixed',fallback_name:'코치'},suggestions:{initial:[],follow_up:[]},hints:{short_input:{enabled:false},roll_input_button:{enabled:false}},retry_button:{enabled:false}}},textSize:'base',...(lessonTips===undefined?{}:{lessonTips})});
const wait=(ms=100)=>new Promise(r=>setTimeout(r,ms));
const send=async(msg)=>{await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}))`);await wait(120);};
const open=async({theme=THEMES['Dark+'],width=800,seat='classroom',state=null,tipsOn}={})=>{await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(theme,state),{width,height:900,dark:theme.kind==='dark',appReady:true});await send({type:'config',config:configFor(seat,lesson,tipsOn)});};
const tips=()=>browser.evaluate(`[...document.querySelectorAll('.hps-lesson-tip:not(.hps-lesson-tips-off)')].map(e=>({step:e.dataset.lessonTip,text:e.querySelector('.hps-lesson-tip-text').textContent}))`);
const note=()=>browser.evaluate(`(()=>{const n=document.querySelector('.hps-lesson-tips-off');return n?{role:n.getAttribute('role'),text:n.querySelector('.hps-lesson-tip-text').textContent,button:n.querySelector('button')?.textContent,focused:document.activeElement===n.querySelector('button')}:null;})()`);
const posted=()=>browser.evaluate('JSON.stringify(messages)').then(JSON.parse);
const tipsWrites=async()=>(await posted()).filter(m=>m.type==='setLessonTips');
// postToHost adds the activity/task scope; the write itself is only its `on`.
const writes=(ms)=>ms.filter(m=>m.type==='setLessonTips').map(m=>m.on);
const click=async(sel)=>{await browser.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);await wait();};
const pick=async(id)=>{await click(`button[data-step-id="${id}"]`);};
let cases=0;
try{
 // 1. Tips on (absent = on): one tip with three actions, the third being 팁 그만 보기.
 await open();
 let t=await tips();assert.equal(t.length,1,'one tip');assert.equal(t[0].text,first.hint.trim());
 assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('.hps-lesson-tip button')].map(b=>b.getAttribute('aria-label')??b.textContent)`),['입력창에 넣기','팁 그만 보기','이 단계 도움말 닫기'],'the actions, in order');
 // 2. 팁 그만 보기: one write, the tip goes, the note says how to get tips back, 다시 켜기 has focus.
 const before=(await posted()).length;
 await click('.hps-lesson-tip-stop');
 const after=(await posted()).slice(before);
 assert.deepEqual(writes(after),[false],'exactly one off write');
 assert.ok(after.every(m=>!JSON.stringify(m).includes(first.hint.trim())),'no lesson text leaves with it');
 assert.equal((await tips()).length,0,'the tip is gone at once');
 let n=await note();assert.ok(n,'the off note is shown');
 assert.deepEqual([n.role,n.text,n.button,n.focused],['status','팁을 껐어요. 다시 보려면 다시 켜기를 눌러 주세요.','다시 켜기',true],'the note: status, the way back, focus on it');
 // The lesson itself stays: steps, the rail hint disclosure, the composer.
 assert.ok(await browser.evaluate(`document.querySelectorAll('button[data-step-id]').length>0 && !!document.querySelector('.hps-input textarea')`),'lesson steps and composer stay');
 cases++;
 // 3. The host answers with lessonTips:false: no tip on any hinted step.
 await send({type:'config',config:configFor('classroom',lesson,false)});
 // The rail's step list only moves forward, so walk through the hintless step to the next hinted one.
 await pick(hintless.id);await pick(hinted2.id);assert.equal((await tips()).length,0,'another hinted step: no tip while off');
 // The note is said once: the next send ends it.
 await browser.evaluate(`(()=>{const t=document.querySelector('.hps-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'질문');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(80);
 await click('.hps-btn-send');
 await send({type:'inputRejected',reason:'synthetic'});
 assert.equal(await note(),null,'the note ended with the next send');
 assert.equal((await tips()).length,0,'and tips stay off');
 cases++;
 // 4. A reload or another window with the stored preference off: no tip anywhere, no note.
 await open({tipsOn:false});
 assert.equal((await tips()).length,0,'off after a reload');assert.equal(await note(),null,'no note on a fresh view');
 assert.ok(await browser.evaluate(`document.querySelectorAll('button[data-step-id]').length>0`),'the lesson is still drawn');
 cases++;
 // 5. 다시 켜기 from the note brings tips back.
 await open();await click('.hps-lesson-tip-stop');
 const b2=(await posted()).length;
 await click('.hps-lesson-tips-off button');
 assert.deepEqual(writes((await posted()).slice(b2)),[true],'one on write');
 await send({type:'config',config:configFor('classroom',lesson,true)});
 assert.equal(await note(),null,'note gone');
 t=await tips();assert.equal(t.length,1,'the tip is back');assert.equal(t[0].text,first.hint.trim());
 cases++;
 // 5b. Shared PC: learner A turns tips off, then learner B signs in on the same window. The host sends B's own
 // choice (tips on, lessonTips:true); B sees the tip and never A's note.
 await open();await click('.hps-lesson-tip-stop');assert.ok(await note(),'A sees the off note');
 const seatB=configFor('classroom',lesson,true);seatB.profile={...seatB.profile,activity_id:'b'.repeat(64)};seatB.activity={...seatB.activity,id:'a2'};
 await send({type:'config',config:seatB});
 assert.equal(await note(),null,'B never sees A\'s note');
 assert.equal((await tips()).length,1,'B sees the tip');
 cases++;
 // 6. Per-step 닫기 is unchanged and never writes the switch.
 await open();
 await click('.hps-lesson-tip-dismiss');
 assert.equal((await tips()).length,0,'dismissed for this step');assert.equal((await tipsWrites()).length,0,'닫기 writes no tips preference');
 await pick(hintless.id);await pick(hinted2.id);assert.equal((await tips()).length,1,'another step keeps its tip');
 cases++;
 // 7. Negative controls: no lesson, or a hintless step, draw no tip, no 팁 그만 보기 and post nothing.
 await open({seat:'personal'});
 assert.equal(await browser.evaluate(`document.querySelectorAll('.hps-lesson-tip, .hps-lesson-tip-stop').length`),0,'personal seat: nothing');
 assert.equal((await tipsWrites()).length,0,'personal seat: no write');
 await open();await click('.hps-lesson-tip-dismiss');await pick(hintless.id);
 assert.equal(await browser.evaluate(`document.querySelectorAll('.hps-lesson-tip-stop').length`),0,'hintless step: no 팁 그만 보기');
 cases++;
 // 8. Geometry: the new action and the note keep 44px targets and 14px text, in both themes and three widths.
 for(const themeName of ['Dark+','Light+'])for(const width of [320,800,1420]){
  await open({theme:THEMES[themeName],width});
  const g=await browser.evaluate(`(()=>{const b=document.querySelector('.hps-lesson-tip-stop').getBoundingClientRect(),s=getComputedStyle(document.querySelector('.hps-lesson-tip-stop'));return {w:b.width,h:b.height,fs:parseFloat(s.fontSize),inside:b.left>=0&&b.right<=innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert.ok(g.w>=44&&g.h>=44&&g.fs>=14&&g.inside&&!g.overflow,`${themeName} ${width}: 팁 그만 보기 ${JSON.stringify(g)}`);
  const ring=await browser.focusVisibleStyle('.hps-lesson-tip-stop');assert.equal(ring['outline-width'],'2px');
  await click('.hps-lesson-tip-stop');
  const h=await browser.evaluate(`(()=>{const n=document.querySelector('.hps-lesson-tips-off'),b=n.querySelector('button').getBoundingClientRect(),c=document.querySelector('.hps-input').getBoundingClientRect(),r=n.getBoundingClientRect();return {w:b.width,h:b.height,fs:Math.min(...[...n.querySelectorAll('p,button')].map(e=>parseFloat(getComputedStyle(e).fontSize))),above:r.bottom<=c.top+.5};})()`);
  assert.ok(h.w>=44&&h.h>=44&&h.fs>=14&&h.above,`${themeName} ${width}: the off note ${JSON.stringify(h)}`);
  cases++;
 }
 console.log(`PASS lesson tips off: ${cases} cases; 팁 그만 보기 posts one off write and shows the way back (다시 켜기, focused, role=status), off hides every tip (other steps, reload, new window) but never the lesson, 다시 켜기 brings tips back, 닫기 unchanged, the note ends with the next send, no lesson or a hintless step draws nothing, 44px/14px/ring in both themes at 320-1420px`);
}finally{await browser.close();}
