import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompanionHostSession } from '../src/companionHostSession.ts';

function setup(options = {}) {
  const pair = { schema: 'hps-companion-pairing-preview/2', id: 'pair', status: 'paired', account_id: 'account',
    host_session_id: 'host-session', device_session_id: 'phone-session', host_id: 'host', device_id: 'phone',
    workspace_id: 'workspace', project_id: 'project', invitation_digest: 'a'.repeat(64), claim_digest: 'b'.repeat(64),
    grant_expires_at: Math.floor(Date.now() / 1000) + 300, capability: 'preview.read' };
  const messages = [1, 2].map(i => ({ message_id: `request-${i}`, message_hash: String(i).repeat(64), text: `selected request ${i}` }));
  const calls = [];
  let current = { ...pair }, batch = messages, ackFailure = false, handler, receive, expired;
  const client = { role: 'host', row: pair,
    async receive() { calls.push('receive'); if (receive) return receive(); return batch; },
    async prepare(text, id) { calls.push(`prepare:${id}`); return 'injected-encrypted'; },
    async send(id) { calls.push(`send:${id}`); },
    async acknowledge(id) { calls.push(`ack:${id}`); if (id === expired) throw Error('relay_message_expired'); if (ackFailure) { ackFailure = false; throw Error('lost ACK response'); } },
    close() { calls.push('close'); },
  };
  const bridge = { async handleAndReply(message, reply) {
    calls.push(`handle:${message.messageId}`);
    assert.equal(message.sender, 'device'); assert.equal(message.invitationDigest, pair.invitation_digest);
    if (handler) return handler(message, reply);
    await reply.prepare('verified-result', `result-${message.messageId}`); await reply.send(`result-${message.messageId}`);
    return { state: 'completed', code: 'preview_read' };
  } };
  const session = new CompanionHostSession({ client, bridge, currentPair: async () => current, onClosed:options.onClosed,shouldContinue:options.shouldContinue }, options);
  return { session, calls, messages, set pair(value) { current = value; }, get pair() { return current; },
    set batch(value) { batch = value; }, set ackFailure(value) { ackFailure = value; },
    set handler(value) { handler = value; }, set receive(value) { receive = value; }, set expired(value) { expired = value; } };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('explicit host turn preserves a delivered batch after ACK failure; concurrent calls do not reread or reexecute', async () => {
  const f = setup(); f.ackFailure = true;
  assert.deepEqual(f.calls, [], 'construction does not poll or execute');
  const first = f.session.receiveAndHandle(); assert.equal(f.session.receiveAndHandle(), first);
  assert.deepEqual(await first, { state: 'waiting', processed: 0, acknowledged: 0, expired: 0, pending: 2, reason: 'transport_unavailable' });
  assert.deepEqual(f.calls, ['receive', 'handle:request-1', 'prepare:result-request-1', 'send:result-request-1', 'ack:request-1']);
  assert.deepEqual(await f.session.receiveAndHandle(), { state: 'processed', processed: 2, acknowledged: 2, expired: 0, pending: 0 });
  assert.equal(f.calls.filter(x => x === 'receive').length, 1);
  assert.equal(f.calls.filter(x => x === 'handle:request-1').length, 1);
  assert.equal(f.calls.filter(x => x === 'handle:request-2').length, 1);
  assert.equal(f.calls.filter(x => x === 'ack:request-1').length, 2);
  f.session.close();
});

test('a replied request whose ACK permanently expired is retired distinctly so later requests progress once', async () => {
  const f = setup(); f.expired = 'request-1';
  assert.deepEqual(await f.session.receiveAndHandle(), { state: 'processed', processed: 2, acknowledged: 1, expired: 1, pending: 0 });
  assert.equal(f.calls.filter(x => x === 'handle:request-1').length, 1);
  assert.equal(f.calls.filter(x => x === 'handle:request-2').length, 1);
  await f.session.receiveAndHandle();
  assert.equal(f.calls.filter(x => x.startsWith('handle:')).length, 2, 'finished-byte tombstones still prevent execution replay');
  f.session.close();
});

test('a deadline preserves earlier completed ACK counts while preventing the later response', async () => {
  const f = setup({ deadlineMs: 30 }); const release = deferred();
  f.handler = async (message, reply) => {
    if (message.messageId === 'request-2') await release.promise;
    await reply.send(`result-${message.messageId}`); return { state: 'completed', code: 'preview_read' };
  };
  const result = await f.session.receiveAndHandle();
  assert.deepEqual(result, { state: 'closed', processed: 1, acknowledged: 1, expired: 0, pending: 0, reason: 'session_closed' });
  release.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.calls.some(x => x === 'send:result-request-2' || x === 'ack:request-2'), false);
});

test('closing during an outstanding reply stops remaining output and ACK, despite a completed local decision', async () => {
  const f = setup(); const entered = deferred(), release = deferred(); let savedReply;
  f.handler = async (_message, reply) => { savedReply = reply; entered.resolve(); await release.promise;
    await reply.send('late-result'); return { state: 'completed', code: 'preview_read' }; };
  const turn = f.session.receiveAndHandle(); await entered.promise;
  f.session.close(); release.resolve();
  assert.equal((await turn).state, 'closed');
  await assert.rejects(() => savedReply.send('late-result'), /session_closed/);
  assert.equal(f.calls.some(x => x.startsWith('send:') || x.startsWith('ack:')), false);
  assert.equal(f.calls.filter(x => x.startsWith('handle:')).length, 1);
});

test('revocation before a fresh turn prevents delivery and pending ACK, with no automatic retry', async () => {
  const f = setup(); f.ackFailure = true; await f.session.receiveAndHandle();
  const before = [...f.calls]; f.pair = { ...f.pair, device_session_id: 'other-device-session' };
  assert.equal((await f.session.receiveAndHandle()).state, 'closed');
  assert.deepEqual(f.calls.slice(before.length), ['close']);
  await f.session.receiveAndHandle(); assert.deepEqual(f.calls.slice(before.length), ['close']);
});

test('receive timeout closes ephemeral transport; late packets cannot invoke the bridge', async () => {
  const f = setup({ deadlineMs: 10 }); const packet = deferred(); f.receive = () => packet.promise;
  assert.equal((await f.session.receiveAndHandle()).state, 'closed'); packet.resolve(f.messages);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.calls, ['receive', 'close']);
});

test('an invalid, conflicting or oversized batch is rejected before any host decision', async () => {
  for (const mutate of [f => [...f.messages, f.messages[0]], f => [{ ...f.messages[0], text: 'x'.repeat(2033) }],
    f => [{ ...f.messages[0], message_hash: 'missing' }], f => Array.from({ length: 9 }, (_, i) => ({ ...f.messages[0], message_id: `id-${i}` }))]) {
    const f = setup(); f.batch = mutate(f);
    assert.equal((await f.session.receiveAndHandle()).state, 'closed'); assert.deepEqual(f.calls, ['receive', 'close']);
  }
  const f = setup(); await f.session.receiveAndHandle(); const initialHandles = f.calls.filter(x => x.startsWith('handle:')).length;
  await f.session.receiveAndHandle(); assert.equal(f.calls.filter(x => x.startsWith('handle:')).length, initialHandles);
  f.batch = [{ ...f.messages[0], message_hash: 'f'.repeat(64) }];
  assert.equal((await f.session.receiveAndHandle()).state, 'closed');
  assert.equal(f.calls.filter(x => x.startsWith('handle:')).length, initialHandles);
});


test('deadline synchronously notifies owner before delayed work can perform effects',async()=>{
  const controller=new AbortController(),entered=deferred(),release=deferred();let closes=0,effects=0;
  const f=setup({deadlineMs:15,onClosed:()=>{closes++;controller.abort();}});
  f.handler=async()=>{entered.resolve();await release.promise;if(!controller.signal.aborted)effects++;};
  const pending=f.session.receiveAndHandle();await entered.promise;
  assert.equal((await pending).state,'closed');assert.equal(controller.signal.aborted,true);assert.equal(closes,1);
  release.resolve();await new Promise(r=>setTimeout(r,0));assert.equal(effects,0);assert.equal(f.calls.some(c=>c.startsWith('ack:')),false);
  f.session.close();assert.equal(closes,1,'terminal notification cannot fire twice');
});

test('semantic fence ACKs only the decided entry and retains exact remaining batch bytes without receiving again',async()=>{
 let proceed=true;const f=setup({shouldContinue:()=>proceed});let held;
 f.handler=async message=>{if(message.messageId==='request-1')proceed=false;else held=message.text;return{state:'outcome_unknown'};};
 const first=await f.session.receiveAndHandle();assert.equal(first.state,'waiting');assert.equal(first.reason,'semantic_check_required');assert.equal(first.processed,1);assert.equal(first.acknowledged,1);assert.equal(first.pending,1);assert.equal(f.calls.includes('handle:request-2'),false);
 const stopped=await f.session.receiveAndHandle();assert.equal(stopped.processed,0);assert.equal(stopped.pending,1);assert.equal(f.calls.filter(c=>c==='receive').length,1);
 proceed=true;await f.session.receiveAndHandle();assert.equal(held,f.messages[1].text);assert.equal(f.calls.filter(c=>c==='handle:request-1').length,1);assert.equal(f.calls.filter(c=>c==='receive').length,1);f.session.close();
});

test('semantic unknown with lost ACK permits explicit ACK-only reconciliation, never the next undecided entry',async()=>{
 let proceed=true;const f=setup({shouldContinue:()=>proceed});f.handler=async()=>{proceed=false;return{state:'outcome_unknown'};};f.ackFailure=true;
 const first=await f.session.receiveAndHandle();assert.equal(first.acknowledged,0);assert.equal(first.pending,2);
 const retry=await f.session.receiveAndHandle();assert.equal(retry.acknowledged,1);assert.equal(retry.processed,1);assert.equal(retry.pending,1);assert.equal(f.calls.filter(c=>c==='handle:request-1').length,1);assert.equal(f.calls.includes('handle:request-2'),false);assert.equal(f.calls.filter(c=>c==='receive').length,1);f.session.close();
});
