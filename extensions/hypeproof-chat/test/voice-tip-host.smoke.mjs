// CGP-VOICE-R-029 (REQ-CGPV-42) — the real ChatPanelProvider host for the voice tip, over a shared globalState:
// - seat A is due once: drawn, a panel remount in the same window keeps it until closed, a reload never brings it back;
// - seat B on the same PC is still due once, then never again; A coming back is not due;
// - a seat with 팁 그만 보기 (tips off) is never due; an empty seat is never due and stores nothing;
// - mid-task (taskEmpty false) is never due; the instructor console is never due;
// - a late "shown" after a close cannot reopen it; junk stored values read as nothing seen; the list is bounded.
//   node --experimental-strip-types test/voice-tip-host.smoke.mjs
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {VOICE_TIP_KEY,VOICE_TIP_SEATS_MAX,voiceTipDue,voiceTipStore,withVoiceTipSeen,VOICE_TIP_TEXT} from '../src/voiceTip.ts';
import {LESSON_TIPS_KEY,withLessonTips} from '../src/lessonTips.ts';
import {collapseSeat} from '../src/lessonFocus.ts';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,logLevel:'silent'});
const vscode={env:{appName:'HypeProof Studio'},workspace:{getConfiguration:()=>({get:(_key,fallback)=>fallback})}};
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortController,AbortSignal,URL,TextEncoder,TextDecoder,crypto:webcrypto});
const proto=module.exports.ChatPanelProvider.prototype;
const memento=(seed={})=>{const data=new Map(Object.entries(seed));return {data,get:k=>data.get(k),update:async(k,v)=>{data.set(k,v);},keys:()=>[...data.keys()]};};
const A=collapseSeat({activityId:'a'.repeat(64)}),B=collapseSeat({activityId:'b'.repeat(64)}),C=collapseSeat({activityId:'c'.repeat(64)});
assert.ok(A&&B&&C&&new Set([A,B,C]).size===3,'seat ids from the collapsed-blocks seat function');
// One host = one window's extension host; `seat` is what the last config build set (forSeat).
function host(state,{instructor=false}={}){
 const posts=[];const h=Object.create(proto);
 const fields={context:{globalState:state,globalStorageUri:{fsPath:'/nonexistent'},secrets:{get:async()=>undefined},workspaceState:{get:()=>undefined}},_instructorMode:{isInstructor:instructor},post:async m=>{posts.push(m);}};
 for(const [k,v] of Object.entries(fields))Object.defineProperty(h,k,{value:v,writable:true,configurable:true});
 let n=0;
 const seat=s=>h.lessonTips.forSeat(s);
 const ask=async(taskEmpty=true)=>{const requestId='r'+(++n);await h.handleMessage({type:'voiceTipRequest',requestId,taskEmpty});const m=posts.findLast(p=>p.type==='voiceTip');assert.equal(m.requestId,requestId);return m.show;};
 const shown=()=>h.handleMessage({type:'voiceTipShown'}),dismiss=()=>h.handleMessage({type:'voiceTipDismiss'});
 return {h,posts,seat,ask,shown,dismiss};
}
const state=memento();
// Seat A: due, drawn, kept through a remount in this window, closed, never again (reload included).
let w=host(state);w.seat(A);
assert.equal(await w.ask(false),false,'mid-task: never due');
assert.equal(await w.ask(),true,'seat A at the start of a task: due');
await w.shown();assert.equal(JSON.stringify(state.data.get(VOICE_TIP_KEY)),JSON.stringify({seen:[A]}),'drawing it records seat A');
assert.equal(await w.ask(),true,'a panel remount in the same window keeps it until closed');
assert.equal(await w.ask(false),false,'still never mid-task');
assert.equal(await host(state).ask(),false,'a reload (new host, no seat yet): not due');
{const r=host(state);r.seat(A);assert.equal(await r.ask(),false,'a reload for seat A: not due again');}
await w.dismiss();assert.equal(await w.ask(),false,'closed');
await w.shown();assert.equal(await w.ask(),false,'a late shown after the close does not reopen it');
// Seat B on the same PC: due once, then never; A is unaffected.
w.seat(B);assert.equal(await w.ask(),true,'seat B on the same PC: due');
await w.shown();await w.dismiss();assert.equal(await w.ask(),false,'seat B: never again');
{const r=host(state);r.seat(B);assert.equal(await r.ask(),false,'seat B after a reload: not due');}
w.seat(A);assert.equal(await w.ask(),false,'A coming back: not due');
assert.equal(JSON.stringify(state.data.get(VOICE_TIP_KEY)),JSON.stringify({seen:[A,B]}));
// Open for A, the seat switches to B, the tip goes away (dismiss arrives under B), back to A: not due (verify-r027).
{const st=memento();const v=host(st);v.seat(A);assert.equal(await v.ask(),true);await v.shown();
 v.seat(B);await v.dismiss();v.seat(A);assert.equal(await v.ask(),false,'a dismiss after a seat switch still closes A for good');}
{const st=memento();const v=host(st);v.seat(A);assert.equal(await v.ask(),true);await v.shown();
 v.seat('');await v.dismiss();v.seat(A);assert.equal(await v.ask(),false,'a dismiss under an empty seat still closes A');}
// A seat with tips off never sees it, and nothing is recorded for it.
const off=memento({[LESSON_TIPS_KEY]:withLessonTips({},C,false)});
w=host(off);w.seat(C);assert.equal(await w.ask(),false,'tips off for seat C: never due');
w.seat(A);assert.equal(await w.ask(),true,'tips off is per seat: seat A on that PC is still due');
// Negative control: the same seat with tips on is due (the tips-off answer came from the choice, not the seat).
{const on=host(memento());on.seat(C);assert.equal(await on.ask(),true,'control: seat C with tips on is due');}
// An empty seat: never due, nothing stored.
const empty=memento();w=host(empty);w.seat('');assert.equal(await w.ask(),false,'empty seat: not due');
await w.shown();await w.dismiss();assert.equal(empty.data.has(VOICE_TIP_KEY),false,'empty seat: nothing stored');
// Instructor console: never due.
w=host(memento(),{instructor:true});w.seat(A);assert.equal(await w.ask(),false,'instructor: never due');
// A bad request id is ignored.
{const r=host(memento());r.seat(A);await r.h.handleMessage({type:'voiceTipRequest',requestId:'x'.repeat(101),taskEmpty:true});await r.h.handleMessage({type:'voiceTipRequest',requestId:7,taskEmpty:true});assert.equal(r.posts.length,0,'invalid request ids get no answer');}
// The model: defensive reads, bounds, de-duplication.
for(const junk of [undefined,null,'x',7,[],{seen:'A'},{seen:[1,null,{}]}])assert.deepEqual(voiceTipStore(junk),{seen:[]},`junk ${JSON.stringify(junk)} reads as nothing seen`);
assert.equal(voiceTipDue({seen:'junk'},{seat:A,tipsOn:true,taskEmpty:true,instructor:false}),true,'a corrupt record shows it (once), never blocks the seat');
let s={};for(let i=0;i<VOICE_TIP_SEATS_MAX+5;i++)s=withVoiceTipSeen(s,`seat:${i}`);
assert.equal(voiceTipStore(s).seen.length,VOICE_TIP_SEATS_MAX,'bounded');
assert.equal(voiceTipDue(s,{seat:'seat:0',tipsOn:true,taskEmpty:true,instructor:false}),true,'the oldest seat drops first');
assert.deepEqual(withVoiceTipSeen({seen:[A,B,A]},A).seen,[B,A],'de-duplicated, newest last');
// The copy: Korean, short, no capability or score label.
assert.match(VOICE_TIP_TEXT,/[가-힣]/);assert.ok([...VOICE_TIP_TEXT].length<=40,'short enough for two lines at 320px');
for(const banned of ['역량','점수','FRAMING','JUDGMENT','VERIFY'])assert.ok(!VOICE_TIP_TEXT.includes(banned));
// Never synced to other machines.
const src=readFileSync(new URL('../src/chatPanelProvider.ts',import.meta.url),'utf8');
assert.ok(!/setKeysForSync\([^)]*VOICE_TIP_KEY/.test(src),'never synced');
console.log('PASS voice tip host');
