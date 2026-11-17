// CGP-VOICE-R-018 (REQ-CGPV-22) — the 시작·끝 소리 switch on the real ChatPanelProvider host, and when a sound plays.
//   node --experimental-strip-types test/voice-sounds-host.smoke.mjs
// Host: off by default; per seat (A on, B on the same PC still off, A again on); an empty seat is memory only and
// never stored, and loses it on a seat switch; non-boolean writes refused; never synced; config carries it.
// Pairs: one start and one end per session however fast it flaps; nothing while off or while the window's sound is
// off; an end whose start was silent stays silent; the two sources are independent.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {VOICE_SOUNDS_KEY,VOICE_SOUNDS_SEATS_MAX,voiceSoundsOn,voiceSoundsStore,withVoiceSounds,VOICE_SOUNDS_SETTING,VOICE_SOUNDS_SETTING_HINT} from '../src/voiceSounds.ts';
import {EarconPairs,EARCON_TONES,EARCON_GAIN,WindowFlag} from '../src/voiceEarcons.ts';
import {collapseSeat} from '../src/lessonFocus.ts';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,logLevel:'silent'});
const vscode={env:{appName:'HypeProof Studio'},workspace:{getConfiguration:()=>({get:(_key,fallback)=>fallback})}};
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortController,AbortSignal,URL,TextEncoder,TextDecoder,crypto:webcrypto});
const proto=module.exports.ChatPanelProvider.prototype;
const memento=(seed={})=>{const data=new Map(Object.entries(seed));return {data,get:k=>data.get(k),update:async(k,v)=>{data.set(k,v);},keys:()=>[...data.keys()]};};
const A=collapseSeat({activityId:'a'.repeat(64)}),B=collapseSeat({activityId:'b'.repeat(64)});
assert.ok(A&&B&&A!==B);
function host(state){
 const h=Object.create(proto);let configs=0;
 const fields={context:{globalState:state,globalStorageUri:{fsPath:'/nonexistent'},secrets:{get:async()=>undefined},workspaceState:{get:()=>undefined}},_instructorMode:{isInstructor:false},post:async()=>{},postConfig:async()=>{configs++;}};
 for(const [k,v] of Object.entries(fields))Object.defineProperty(h,k,{value:v,writable:true,configurable:true});
 const seat=s=>h.voiceSounds.forSeat(s);
 const on=()=>h.voiceSounds.on(state.get(VOICE_SOUNDS_KEY));
 const press=async v=>{await h.handleMessage({type:'setVoiceSounds',on:v});};
 return {h,seat,on,press,configs:()=>configs};
}
const json=v=>JSON.stringify(v);
const state=memento();let w=host(state);
w.seat(A);assert.equal(w.on(),false,'off by default');
await w.press(true);assert.equal(w.on(),true,'A turned the sounds on');assert.equal(json(state.data.get(VOICE_SOUNDS_KEY)),json({on:[A]}));
assert.ok(w.configs()>=1,'the chat is refreshed after a press');
w.seat(B);assert.equal(w.on(),false,'learner B on the same PC: still off');
{const r=host(state);r.seat(A);assert.equal(r.on(),true,'A after a reload: on');}
w.seat(A);await w.press(false);assert.equal(w.on(),false,'A turned them off');assert.equal(json(state.data.get(VOICE_SOUNDS_KEY)),json({on:[]}));
// Refused writes change nothing.
await w.press(true);const before=json(state.data.get(VOICE_SOUNDS_KEY));
for(const junk of ['true',1,null,undefined,{}])await w.h.handleMessage({type:'setVoiceSounds',on:junk});
assert.equal(json(state.data.get(VOICE_SOUNDS_KEY)),before,'non-boolean writes are refused');assert.equal(await w.h.setVoiceSounds('yes'),'refused');
// An empty seat: memory only, never stored, gone on a switch.
const empty=memento();w=host(empty);w.seat('');assert.equal(w.on(),false);
assert.equal(await w.h.setVoiceSounds(true),'memory-only');assert.equal(w.on(),true,'the window honours it');assert.equal(empty.data.has(VOICE_SOUNDS_KEY),false,'nothing stored for an empty seat');
w.seat(A);assert.equal(w.on(),false);w.seat('');assert.equal(w.on(),false,'the in-memory choice did not survive the switch');
// Defensive reads and bounds.
for(const junk of [undefined,null,'on',[],{on:'x'},{on:[1,null,{}]}])assert.equal(voiceSoundsOn(junk,A),false,`junk ${json(junk)} is off`);
let s={};for(let i=0;i<VOICE_SOUNDS_SEATS_MAX+5;i++)s=withVoiceSounds(s,`seat:${i}`,true);
assert.equal(voiceSoundsStore(s).on.length,VOICE_SOUNDS_SEATS_MAX,'bounded');assert.equal(voiceSoundsOn(s,'seat:0'),false,'the oldest drops first (off again)');
assert.deepEqual(withVoiceSounds({on:[A,B,A]},A,true).on,[B,A],'de-duplicated, newest last');
// The provider wiring.
const src=readFileSync(new URL('../src/chatPanelProvider.ts',import.meta.url),'utf8');
assert.match(src,/this\.lessonTips\.forSeat\(tipsSeat\);\s*this\.voiceSounds\.forSeat\(tipsSeat\);/,'the same seat as 팁 보기, set by the same config build');
assert.match(src,/voiceSounds: this\.voiceSounds\.on\(this\.context\.globalState\?\.get\(VOICE_SOUNDS_KEY\)\)/,'config carries the seat\'s choice');
assert.ok(!/setKeysForSync\([^)]*VOICE_SOUNDS_KEY/.test(src),'never synced');
// Copy.
for(const t of [VOICE_SOUNDS_SETTING,VOICE_SOUNDS_SETTING_HINT])assert.match(t,/[가-힣]/);
// When a sound plays.
{const p=new EarconPairs();
 assert.equal(p.change('dictation',true,true),'start');assert.equal(p.change('dictation',true,true),null,'no second start while live');
 assert.equal(p.change('dictation',false,true),'stop');assert.equal(p.change('dictation',false,true),null,'no second end');
 // Rapid start → cancel, flapping: one start and one end per session.
 const out=[];for(let i=0;i<5;i++){out.push(p.change('conversation',true,true),p.change('conversation',false,true));}
 assert.deepEqual(out,Array(5).fill(['start','stop']).flat(),'each session gives exactly one start and one end');
 // Off or muted: silent, and the end of a silent start stays silent even if allowed by then.
 assert.equal(p.change('dictation',true,false),null);assert.equal(p.change('dictation',false,true),null,'an end without a sounded start is silent');
 // Turned off (or muted) mid-session: the end is silent.
 assert.equal(p.change('dictation',true,true),'start');assert.equal(p.change('dictation',false,false),null,'muted or off by the end: silent');
 // Sources are independent.
 assert.equal(p.change('dictation',true,true),'start');assert.equal(p.change('conversation',true,true),'start');
 assert.equal(p.change('conversation',false,true),'stop');assert.equal(p.change('dictation',false,true),'stop');}
assert.ok(EARCON_TONES.start.to>EARCON_TONES.start.from&&EARCON_TONES.stop.to<EARCON_TONES.stop.from,'start rises, end falls');
assert.ok(EARCON_TONES.start.ms<=150&&EARCON_TONES.stop.ms<=150&&EARCON_GAIN<=0.1,'short and quiet');
{const f=new WindowFlag();let n=0;const off=f.subscribe(()=>n++);f.set(true);f.set(true);f.set(false);off();f.set(true);assert.equal(n,2,'listeners run on changes only, until unsubscribed');}
// The player: the only sources are dictation and the conversation; read-aloud is not one; the window's mute gates it.
const player=readFileSync(new URL('../webview-ui/src/VoiceEarcons.tsx',import.meta.url),'utf8');
assert.match(player,/allowed\.current && !windowOutputMute\.getMuted\(\)/,'the window sound off (소리 끄기) silences every earcon');
assert.ok(!/ReadAloud|speechSynthesis|readAloud/.test(player.replace(/^\/\/.*$/gm,'')),'read-aloud is not a source');
const dict=readFileSync(new URL('../webview-ui/src/DictationControl.tsx',import.meta.url),'utf8');
assert.match(dict,/windowDictationRecording\.set\(state === "recording"\);/,'dictation publishes its recording state');
console.log('PASS voice sounds host');
