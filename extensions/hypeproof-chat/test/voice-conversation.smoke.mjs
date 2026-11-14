import assert from 'node:assert/strict';
import { VoiceConversation } from '../src/voiceConversation.ts';
import { ReadAloud } from '../src/voiceReadAloud.ts';

function rig() {
  let now=0, scope='a/task', ready=true, endpoint, lost, cleaned=0, media=0, stopped=0;
  const clips=[], sends=[], utterances=[], timers=new Map(); let seq=0;
  class Recorder {
    static isTypeSupported(){return true}
    state='inactive'; ondataavailable=null; onstop=null; onerror=null;
    start(){this.state='recording'}
    stop(){this.state='inactive';this.ondataavailable?.({data:{size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}});queueMicrotask(()=>this.onstop?.())}
  }
  const clock={getUserMedia:async()=>{media++;return {getTracks:()=>[{stop(){stopped++}}]}},Recorder,now:()=>now,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{at:now+ms,fn});return id},clearTimeout:id=>timers.delete(id)};
  const speech=new ReadAloud({synth:{getVoices:()=>[],cancel(){},speak:u=>utterances.push(u)},makeUtterance:text=>({text,onend:null,onerror:null,lang:'',rate:1,voice:null})});
  const loop=new VoiceConversation({recorder:clock,observe:(stream,end,fail)=>{endpoint=end;lost=fail;return()=>cleaned++},scope:()=>scope,ready:()=>ready,transcribe:(id,clip)=>clips.push({id,clip}),submit:text=>{sends.push(text);return 'u'+sends.length},speech,changed(){},id:()=>`r${++seq}`});
  const flush=async()=>{await new Promise(r=>setImmediate(r))};
  const tick=async ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn()}await flush()};
  return {loop,speech,clips,sends,utterances,tick,flush,end:()=>endpoint(),lost:()=>lost(),scope:v=>scope=v,ready:v=>ready=v,stats:()=>({media,stopped,cleaned}),reply(text='무엇이 마음에 남았나요?'){const n=sends.length;loop.host({type:'streamStart',streamId:'s'+n,messageId:'a'+n,userMessageId:'u'+n});loop.host({type:'streamChunk',streamId:'s'+n,delta:text});loop.host({type:'streamEnd',streamId:'s'+n})}};
}
const r=rig(); r.loop.start();r.loop.start();await r.flush();assert.equal(r.stats().media,1);
for(let n=1;n<=2;n++) {
  await r.tick(1000);r.end();await r.flush();
  assert.equal(r.loop.state.phase,'transcribing');assert.equal(r.stats().media,n);assert.ok(r.stats().stopped>=n);
  const request=r.clips.at(-1);r.loop.host({type:'voiceTranscribeResult',requestId:request.id,ok:true,text:'한 번의 대답'+n});
  r.loop.host({type:'voiceTranscribeResult',requestId:request.id,ok:true,text:'중복'});assert.equal(r.sends.length,n);
  r.reply();assert.equal(r.loop.state.phase,'speaking');assert.equal(r.stats().media,n);
  r.utterances.at(-1).onend();await r.tick(0);assert.equal(r.stats().media,n+1);
}
r.loop.stop();assert.equal(r.loop.state.phase,'stopped');assert.equal(r.stats().cleaned,3);
const stopped=rig();stopped.loop.start();await stopped.flush();await stopped.tick(1000);stopped.end();await stopped.flush();stopped.loop.host({type:'voiceTranscribeResult',requestId:stopped.clips[0].id,ok:true,text:'대답'});stopped.reply();stopped.speech.stop();stopped.utterances[0].onend();await stopped.tick(0);assert.equal(stopped.stats().media,1);assert.equal(stopped.loop.state.phase,'stopped');
const stale=rig();stale.loop.start();await stale.flush();await stale.tick(1000);stale.end();await stale.flush();stale.scope('b/task');stale.loop.host({type:'voiceTranscribeResult',requestId:stale.clips[0].id,ok:true,text:'다른 계정에 보내면 안 됨'});assert.equal(stale.sends.length,0);
const cap=rig();cap.loop.start();await cap.flush();await cap.tick(1000);cap.end();await cap.flush();cap.loop.host({type:'voiceTranscribeResult',requestId:cap.clips[0].id,ok:false,kind:'cap',message:'한도',retry:false});assert.equal(cap.sends.length,0);assert.equal(cap.loop.state.note,'한도');
const ceiling=rig();ceiling.loop.start();await ceiling.flush();await ceiling.tick(58000);assert.equal(ceiling.clips.length,0);assert.equal(ceiling.loop.state.phase,'stopped');
console.log('PASS: two automatic turns, exclusive capture, duplicate refusal, natural-vs-stop, stale scope, cap, and non-speech ceiling');

// #3928 + #3984 integration: a refused automatic reading ends that conversation.
// The answer remains manually recoverable, but a later resume never reopens capture.
const blocked=rig();blocked.loop.start();await blocked.flush();await blocked.tick(1000);blocked.end();await blocked.flush();
blocked.loop.host({type:'voiceTranscribeResult',requestId:blocked.clips[0].id,ok:true,text:'대답'});
blocked.reply('오래 읽을 답변이에요. '.repeat(45));
const queued=blocked.utterances.slice();assert.ok(queued.length>2);
queued[0].onend();await blocked.tick(0);assert.equal(blocked.stats().media,1,'an intermediate chunk never reopens capture');
queued[1].onerror({error:'not-allowed'});await blocked.tick(0);
assert.equal(blocked.loop.state.phase,'stopped','a blocked automatic reading terminates the voice loop');
assert.deepEqual(blocked.speech.getStatus(),{kind:'blocked',id:'a1'},'manual recovery is preserved');
queued.at(-1).onend();await blocked.tick(0);assert.equal(blocked.stats().media,1,'late old completion cannot reopen capture');
const resumeAt=blocked.utterances.length;assert.equal(blocked.speech.resume('a1'),true);
const resumed=blocked.utterances.slice(resumeAt);assert.deepEqual(resumed.map(u=>u.text),queued.slice(1).map(u=>u.text),'resume reads only unheard chunks');
for(const u of resumed)u.onend();await blocked.tick(0);
assert.equal(blocked.stats().media,1,'manual resumed playback completion never restarts the stopped conversation');
assert.equal(blocked.sends.length,1,'manual recovery sends no extra request');

const terminal=rig(),outcomes=[];
terminal.speech.play('chunks','긴 문장이에요. '.repeat(60),value=>outcomes.push(value));
const chunks=terminal.utterances.slice();assert.ok(chunks.length>2);
for(const u of chunks.slice(0,-1))u.onend();assert.deepEqual(outcomes,[],'completion waits for the final chunk');
chunks.at(-1).onend();chunks.at(-1).onend();terminal.speech.stop();
assert.deepEqual(outcomes,['completed'],'final completion is reported once');
terminal.speech.play('cancel','중지할 문장',value=>outcomes.push(value));
const cancelled=terminal.utterances.at(-1);terminal.speech.stop();terminal.speech.stop();cancelled.onend();cancelled.onerror({error:'not-allowed'});
assert.deepEqual(outcomes,['completed','stopped'],'cancellation settles once and fences stale callbacks');
terminal.speech.play('blocked','다시 읽을 문장',value=>outcomes.push(value));
terminal.utterances.at(-1).onerror({error:'not-allowed'});assert.equal(terminal.speech.resume('blocked'),true);terminal.utterances.at(-1).onend();
assert.deepEqual(outcomes,['completed','stopped','error'],'blocked reading settles once; manual resume has no old completion callback');
console.log('PASS: blocked automatic playback, manual unheard-chunk recovery without auto-listen, final-chunk timing and exactly-once cancellation');
