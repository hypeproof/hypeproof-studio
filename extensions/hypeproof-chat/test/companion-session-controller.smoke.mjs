import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { CompanionMobileSessionController } from '../webview-ui/src/companionSessionController.ts';
import { packCompanionPreviewPayload } from '../src/companionPreviewPayload.ts';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const text = '<button>내 작품</button>' + '<p>내가 만든 퀴즈</p>'.repeat(300);
const request = { schema:'hps-companion-host-request/1',requestId:'request-one',actorId:'actor-one',deviceId:'phone-one',hostId:'host-one',workspaceId:'workspace-one',projectId:'project-one',taskId:'task-one',version:2,epoch:1,consentRevision:4,artifactId:'quiz',artifactVersion:createHash('sha256').update(text).digest('hex'),operation:'preview.read' };
const selection = { request, projectName:'내 작품', artifactName:'퀴즈' };
const raw = outcome => JSON.stringify({ schema:'hps-companion-host-result/1',requestId:request.requestId,outcome });
const completed = { state:'completed',code:'preview_read',requestId:request.requestId,artifact:{id:'quiz',version:request.artifactVersion,text} };
class Clock {
  timers = new Set();
  setTimeout(callback, ms) { const timer = { callback, ms }; this.timers.add(timer); return timer; }
  clearTimeout(timer) { this.timers.delete(timer); }
  fire(ms) { for (const timer of [...this.timers]) if (timer.ms === ms) { this.timers.delete(timer); timer.callback(); } }
}
function fixture(overrides = {}) {
  const calls = { prepare:0,send:0,receive:0,ack:[] };
  const clock = new Clock(); let online = true;
  let batch = [];
  const ports = { descriptor: async () => ({computerName:'내 컴퓨터',online,selection}), transport:{
    prepare:async()=>{calls.prepare++;},send:async()=>{calls.send++;},
    receive:async()=>{calls.receive++; const value=batch;batch=[];return value;},
    acknowledge:async id=>{calls.ack.push(id);}, ...overrides } };
  const controller = new CompanionMobileSessionController(ports,{clock,timeoutMs:1000,pollMs:10});
  return { controller,calls,clock,ports,batch:value=>{batch=value;},online:value=>{online=value;} };
}
const messages = parts => parts.map((text,i)=>({message_id:'part_'+i,text}));

test('one explicit delivery, framed exact result only after all validated fragments, reconnect never sends', async()=>{
  const parts=messages(await packCompanionPreviewPayload(raw(completed),request.requestId));
  const f=fixture(); const states=[];f.controller.subscribe(s=>states.push(s));
  await f.controller.reconnect();assert.equal(f.calls.send,0);
  f.batch(parts.slice(0,-1)); const one=f.controller.requestPreview(request),two=f.controller.requestPreview(request);assert.equal(one,two);
  // Wait for partial ACKs without allowing the test clock's bounded timeout to advance.
  while(f.calls.ack.length<parts.length-1) await new Promise(setImmediate);
  assert.equal(states.some(s=>s.receipt?.outcome.artifact),false);
  await tick();f.batch(parts.slice(-1));f.clock.fire(10);await one;
  assert.equal(f.calls.prepare,1);assert.equal(f.calls.send,1);
  assert.deepEqual(f.controller.getSnapshot().receipt.outcome,completed);
  assert.deepEqual(f.calls.ack,parts.map(p=>p.message_id));
  f.online(false);await f.controller.reconnect(request);assert.equal(f.controller.getSnapshot().connection,'waiting_for_computer');
  f.online(true);await f.controller.reconnect(request);
  assert.equal(f.controller.getSnapshot().connection,'connected');assert.equal(f.calls.send,1);
  const foreign={...request,epoch:2};await f.controller.requestPreview(foreign);assert.equal(f.calls.send,1);
  assert.equal(f.controller.getSnapshot().connection,'waiting_for_computer');f.controller.dispose();
});

test('bad fragments are never ACKed or exposed; denied result_too_large stays denied',async()=>{
  const bad=fixture();bad.batch([{message_id:'invalid',text:raw({...completed,artifact:{...completed.artifact,text:'tamper'}})}]);
  await bad.controller.requestPreview(request);assert.deepEqual(bad.calls.ack,[]);assert.equal(bad.controller.getSnapshot().receipt,null);bad.controller.dispose();
  const denied=fixture();denied.batch([{message_id:'denied',text:raw({state:'denied',code:'result_too_large'})}]);
  await denied.controller.requestPreview(request);assert.equal(denied.controller.getSnapshot().receipt.outcome.code,'result_too_large');assert.deepEqual(denied.calls.ack,['denied']);denied.controller.dispose();
});

test('timeout bounds a transport that ignores abort; reconnect only receives the same uncertain request',async()=>{
  const stalled=deferred();const f=fixture({send:()=>{f.calls.send++;return stalled.promise;}});
  const first=f.controller.requestPreview(request);await tick();f.clock.fire(1000);await first;
  assert.equal(f.controller.getSnapshot().connection,'waiting_for_computer');assert.equal(f.controller.getSnapshot().busy,false);
  f.batch([{message_id:'accepted',text:raw({state:'accepted',code:'accepted'})}]);
  const reconnect=f.controller.reconnect(request);await tick();f.clock.fire(1000);await reconnect;
  assert.equal(f.calls.send,1);assert.equal(f.calls.prepare,1);
  const before=f.controller.getSnapshot();stalled.resolve();await tick();assert.equal(f.controller.getSnapshot(),before);f.controller.dispose();
});

test('dispose suppresses late descriptor/message UI and ACK, cleans deadlines, and stays terminal',async()=>{
  for(const stage of ['descriptor','receive']) {
    const waiting=deferred();const f=fixture(stage==='receive'?{receive:()=>waiting.promise}:{});
    if(stage==='descriptor')f.ports.descriptor=()=>waiting.promise;
    let emissions=0;f.controller.subscribe(()=>{emissions++;});
    const pending=f.controller.requestPreview(request);await tick();f.controller.dispose();const before=emissions;
    waiting.resolve(stage==='descriptor'?{computerName:'late',online:true,selection}:[{message_id:'late',text:raw({state:'denied',code:'late'})}]);
    await pending;await tick();assert.equal(emissions,before);assert.deepEqual(f.calls.ack,[]);assert.equal(f.controller.getSnapshot().receipt,null);assert.equal(f.clock.timers.size,0);
    await assert.rejects(f.controller.reconnect(),/stopped/);
  }
});

test('ACK failure retains verified receipt privately and reconnect retries only its transport ACK',async()=>{
  let fail=true;const f=fixture({acknowledge:async id=>{f.calls.ack.push(id);if(fail)throw Error('offline');}});
  f.batch([{message_id:'deny',text:raw({state:'denied',code:'result_too_large'})}]);
  await f.controller.requestPreview(request);assert.equal(f.controller.getSnapshot().receipt,null);
  fail=false;await f.controller.reconnect(request);assert.equal(f.controller.getSnapshot().receipt.outcome.state,'denied');assert.equal(f.calls.send,1);assert.deepEqual(f.calls.ack,['deny','deny']);f.controller.dispose();
});


test('a receive finishing after timeout is reconciled once; a changed descriptor denies its ACK',async()=>{
  for (const changed of [false,true]) {
    const delayed=deferred();const f=fixture({receive:()=>{f.calls.receive++;return delayed.promise;}});
    const pending=f.controller.requestPreview(request);await tick();f.clock.fire(1000);await pending;
    assert.equal(f.calls.receive,1);
    if(changed)f.ports.descriptor=async()=>({computerName:'computer',online:true,selection:{...selection,request:{...request,epoch:2}}});
    delayed.resolve([{message_id:'late',text:raw({state:'denied',code:'result_too_large'})}]);await tick();
    assert.equal(f.controller.getSnapshot().receipt,null);assert.deepEqual(f.calls.ack,[]);
    await f.controller.reconnect(request);
    assert.equal(f.calls.receive,1);assert.equal(f.calls.send,1);
    if(changed){assert.equal(f.controller.getSnapshot().receipt,null);assert.deepEqual(f.calls.ack,[]);}
    else{assert.equal(f.controller.getSnapshot().receipt.outcome.state,'denied');assert.deepEqual(f.calls.ack,['late']);}
    f.controller.dispose();
  }
});

test('reconnect drains a deduplicated eight-part batch after the fourth ACK times out', {timeout:5000}, async()=>{
  const batchText='<html lang="ko"><body><h1>내 작품</h1><pre>'+'a'.repeat(7400)+'</pre></body></html>';
  const expected={...request,artifactVersion:createHash('sha256').update(batchText).digest('hex')};
  const outcome={...completed,artifact:{id:expected.artifactId,version:expected.artifactVersion,text:batchText}};
  const parts=messages(await packCompanionPreviewPayload(raw(outcome),expected.requestId));
  assert.equal(parts.length,8,'real packer produces exactly eight fragments');
  const entered=deferred(),pause=deferred();let hold=true;
  const seen=new Set(),acks=[],completedOutcomes=new Set();
  const f=fixture({
    receive:async()=>{
      f.calls.receive++;
      const fresh=parts.filter(part=>!seen.has(part.message_id));
      fresh.forEach(part=>seen.add(part.message_id));
      return fresh;
    },
    acknowledge:async id=>{
      if(hold&&id===parts[3].message_id){hold=false;entered.resolve();await pause.promise;}
      acks.push(id);
    },
  });
  f.ports.descriptor=async()=>({computerName:'내 컴퓨터',online:true,selection:{...selection,request:expected}});
  f.controller.subscribe(snapshot=>{if(snapshot.receipt?.outcome.state==='completed')completedOutcomes.add(snapshot.receipt.outcome);});
  try {
    const first=f.controller.requestPreview(expected);
    await entered.promise;
    assert.equal(seen.size,8,'transport deduplicates every delivered message before any ACK');
    assert.deepEqual(acks,parts.slice(0,3).map(part=>part.message_id));
    f.clock.fire(1000);await first;
    assert.equal(f.controller.getSnapshot().receipt,null,'partial HTML is never exposed');
    assert.equal(f.controller.getSnapshot().connection,'waiting_for_computer');
    pause.resolve();await tick();
    await f.controller.reconnect(expected);
    assert.deepEqual(f.controller.getSnapshot().receipt.outcome,outcome);
    assert.equal(new Set(acks).size,8,'remaining four fragments survive and receive their ACKs');
    assert.equal(f.calls.receive,1,'reconnect drains local batch without asking the deduplicating transport again');
    assert.equal(f.calls.prepare,1);assert.equal(f.calls.send,1);
    await f.controller.reconnect(expected);
    assert.equal(f.calls.receive,1);assert.equal(f.calls.send,1);
    assert.equal(completedOutcomes.size,1,'same verified outcome is reused, never reconstructed or duplicated');
  } finally {pause.resolve();f.controller.dispose();}
});
