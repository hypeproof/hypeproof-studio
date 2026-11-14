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
const railHints=()=>browser.evaluate(`[...document.querySelectorAll('details > summary')].filter(s=>s.textContent.trim()==='힌트 보기').length`);
const LONG_NOTE='팁을 껐어요. 여기 다시 켜기로 언제든 다시 켤 수 있어요.', SHORT_NOTE='팁을 꺼 두었어요.';
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
 assert.deepEqual([n.role,n.text,n.button,n.focused],['status',LONG_NOTE,'다시 켜기',true],'the note: status, the way back, focus on it');
 assert.ok(await railHints()>0,'the rail\'s 힌트 보기 stays while tips are off');
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
 // After the next send the announcement ends, but a quiet way back stays where the tip was (never one-way).
 n=await note();assert.deepEqual([n?.role,n?.text,n?.button],['group',SHORT_NOTE,'다시 켜기'],'a quiet line with 다시 켜기 stays, no live region');
 assert.equal((await tips()).length,0,'and tips stay off');
 assert.ok(await railHints()>0,'the rail\'s 힌트 보기 still stays');
 cases++;
 // 4. A reload or another window with the stored preference off: no tip anywhere, no note.
 await open({tipsOn:false});
 assert.equal((await tips()).length,0,'off after a reload');
 n=await note();assert.deepEqual([n?.role,n?.text],['group',SHORT_NOTE],'after a reload: the quiet way back, not the announcement');
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
 // Only the Service seat id changes (same window, same local activity), so the panel is not remounted.
 const seatB=configFor('classroom',lesson,true);seatB.profile={...seatB.profile,activity_id:'b'.repeat(64)};
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
 // 7b. The lasting switch in the settings dialog (reached from the access chip on a lesson seat): it shows this seat's
 // state and writes it; a seat without a lesson has no such switch.
 const resource={meter:'requests:count',remaining:37,held:3,unresolved:2,spent:10,limit:50,overrun:0,shared:false};
 const access={status:'ready',selected:'c1',view:{schema:'hps-access-view/1',configured:true,as_of:'2026-11-14T06:42:00Z',choices:[{id:'c1',label:'수업',source_kind:'cohort',mode:'included',active:true,available:true,state:'ready',ends_at:1,can_request:false,allowed:{models:[],efforts:[],features:[],runtimes:[]},resources:[resource]}]}};
 const openSettings=async(tipsOn)=>{await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(THEMES['Dark+'],null),{width:800,height:900,dark:true,appReady:true});await send({type:'config',config:{...configFor('classroom',lesson,tipsOn),access}});await click('.hps-access-chip');};
 const setting=()=>browser.evaluate(`(()=>{const f=document.querySelector('.hps-lesson-tips-setting');if(!f)return null;const i=f.querySelector('input[type=checkbox]'),l=f.querySelector('label').getBoundingClientRect();return {checked:i.checked,legend:f.querySelector('legend').textContent,h:l.height,fs:parseFloat(getComputedStyle(f.querySelector('label')).fontSize),hint:document.getElementById(i.getAttribute('aria-describedby'))?.textContent};})()`);
 await openSettings(false);
 let st=await setting();assert.ok(st,'the 팁 보기 switch is in the settings dialog');
 assert.deepEqual([st.checked,st.legend,st.hint],[false,'팁 보기','수업 단계의 도움말을 입력창 위에 보여 줘요.'],'shows this seat\'s off state, named and described');
 assert.ok(st.h>=44&&st.fs>=14,`44px/14px ${JSON.stringify(st)}`);
 const b3=(await posted()).length;await click('.hps-lesson-tips-setting input');
 assert.deepEqual(writes((await posted()).slice(b3)),[true],'checking it writes tips on');
 await openSettings(true);st=await setting();assert.equal(st.checked,true,'on state');
 const b4=(await posted()).length;await click('.hps-lesson-tips-setting input');assert.deepEqual(writes((await posted()).slice(b4)),[false],'unchecking writes off');
 await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(THEMES['Dark+'],null),{width:800,height:900,dark:true,appReady:true});
 const noLesson={...configFor('classroom',lesson,true),access};noLesson.profile={...noLesson.profile,lesson:null};
 await send({type:'config',config:noLesson});
 await click('.hps-access-chip');assert.equal(await setting(),null,'no lesson: no 팁 보기 switch');
 cases++;
 // 7c. High contrast and forced colours: the new button, the note and the switch keep readable ink and a visible edge.
 const lum=`const rgb=c=>{const m=c.match(/[\\d.]+/g).map(Number);return m.slice(0,3)};const L=c=>{const v=rgb(c).map(x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)});return .2126*v[0]+.7152*v[1]+.0722*v[2]};const ratio=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};const bg=e=>{for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c))return c;}return 'rgb(255,255,255)'};`;
 for(const [themeName,forced] of [['HC Dark',false],['HC Light',false],['Dark+',true],['Light+',true]]){
  const theme=THEMES[themeName];
  await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(theme,null),{width:800,height:900,dark:theme.kind!=='light'&&theme.kind!=='hcLight',forcedColors:forced,appReady:true});
  await send({type:'config',config:{...configFor('classroom',lesson,true),access}});
  const tag=`${themeName}${forced?' forced':''}`;
  const btn=await browser.evaluate(`(()=>{${lum}const b=document.querySelector('.hps-lesson-tip-stop'),s=getComputedStyle(b);return {ratio:ratio(s.color,bg(b)),fs:parseFloat(s.fontSize)};})()`);
  assert.ok(btn.ratio>=4.5&&btn.fs>=14,`${tag}: 팁 그만 보기 ink ${JSON.stringify(btn)}`);
  await click('.hps-lesson-tip-stop');
  const nt=await browser.evaluate(`(()=>{${lum}const n=document.querySelector('.hps-lesson-tips-off'),p=n.querySelector('p'),s=getComputedStyle(n),ps=getComputedStyle(p);return {ratio:ratio(ps.color,bg(p)),edge:parseFloat(s.borderTopWidth)>=1&&s.borderTopStyle!=='none'};})()`);
  assert.ok(nt.ratio>=4.5&&nt.edge,`${tag}: the off note ${JSON.stringify(nt)}`);
  await click('.hps-access-chip');
  const sw=await browser.evaluate(`(()=>{${lum}const f=document.querySelector('.hps-lesson-tips-setting'),l=f.querySelector('label span'),h=f.querySelector('.hps-lesson-tips-setting-hint');return {label:ratio(getComputedStyle(l).color,bg(l)),hint:ratio(getComputedStyle(h).color,bg(h))};})()`);
  assert.ok(sw.label>=4.5&&sw.hint>=4.5,`${tag}: the 팁 보기 switch ${JSON.stringify(sw)}`);
  cases++;
 }
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
 console.log(`PASS lesson tips off: ${cases} cases; 팁 그만 보기 posts one off write and shows the way back (다시 켜기, focused, role=status), off hides every tip (other steps, reload, new window) but never the lesson, 다시 켜기 brings tips back, 닫기 unchanged, the announcement ends with the next send but a quiet 다시 켜기 stays (also after a reload), the rail's 힌트 보기 stays, a seat switch drops the note, the settings dialog's 팁 보기 switch reads and writes this seat, HC Dark/HC Light and forced colours keep 4.5:1 ink and edges, no lesson or a hintless step draws nothing, 44px/14px/ring in both themes at 320-1420px`);
}finally{await browser.close();}
