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
  let current = { ...pair }, batch = messages, ackFailure = false, handler, receive;
  const client = { role: 'host', row: pair,
    async receive() { calls.push('receive'); if (receive) return receive(); return batch; },
    async prepare(text, id) { calls.push(`prepare:${id}`); return 'injected-encrypted'; },
    async send(id) { calls.push(`send:${id}`); },
    async acknowledge(id) { calls.push(`ack:${id}`); if (ackFailure) { ackFailure = false; throw Error('lost ACK response'); } },
    close() { calls.push('close'); },
  };
  const bridge = { async handleAndReply(message, reply) {
    calls.push(`handle:${message.messageId}`);
    assert.equal(message.sender, 'device'); assert.equal(message.invitationDigest, pair.invitation_digest);
    if (handler) return handler(message, reply);
    await reply.prepare('verified-result', `result-${message.messageId}`); await reply.send(`result-${message.messageId}`);
    return { state: 'completed', code: 'preview_read' };
  } };
  const session = new CompanionHostSession({ client, bridge, currentPair: async () => current }, options);
  return { session, calls, messages, set pair(value) { current = value; }, get pair() { return current; },
    set batch(value) { batch = value; }, set ackFailure(value) { ackFailure = value; },
    set handler(value) { handler = value; }, set receive(value) { receive = value; } };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('explicit host turn preserves a delivered batch after ACK failure; concurrent calls do not reread or reexecute', async () => {
  const f = setup(); f.ackFailure = true;
  assert.deepEqual(f.calls, [], 'construction does not poll or execute');
  const first = f.session.receiveAndHandle(); assert.equal(f.session.receiveAndHandle(), first);
  assert.deepEqual(await first, { state: 'waiting', processed: 0, pending: 2, reason: 'transport_unavailable' });
  assert.deepEqual(f.calls, ['receive', 'handle:request-1', 'prepare:result-request-1', 'send:result-request-1', 'ack:request-1']);
  assert.deepEqual(await f.session.receiveAndHandle(), { state: 'processed', processed: 2, pending: 0 });
  assert.equal(f.calls.filter(x => x === 'receive').length, 1);
  assert.equal(f.calls.filter(x => x === 'handle:request-1').length, 1);
  assert.equal(f.calls.filter(x => x === 'handle:request-2').length, 1);
  assert.equal(f.calls.filter(x => x === 'ack:request-1').length, 2);
  f.session.close();
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
