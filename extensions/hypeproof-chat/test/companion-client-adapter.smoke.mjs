import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompanionClientAdapter } from '../src/companionClientAdapter.ts';
import { createCompanionAuthoringIntent } from '../src/companionAuthoringIntent.ts';
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const signal = () => new AbortController().signal;
const request = { schema: 'hps-companion-host-request/1', requestId: 'request-1', actorId: 'actor', deviceId: 'device', hostId: 'host', workspaceId: 'workspace', projectId: 'project', taskId: 'task', version: 1, epoch: 1, consentRevision: 1, artifactId: 'artifact', artifactVersion: 'a'.repeat(64), operation: 'preview.read' };
const raw = JSON.stringify(request);
const context = { accountId: 'account', sessionId: 'session', deviceId: 'device', pairingId: 'pair', cipherContext: 'b'.repeat(64), workspaceId: 'workspace', artifactId: 'artifact', artifactVersion: request.artifactVersion, epoch: 1 };

test('authoring is a separate selected draft message through the same budget, never a preview/execution receipt', async () => {
  const f=fixture();
  const proposed=createCompanionAuthoringIntent({requestId:'intent-one',pairingId:'pair',selection:request,text:'정답 뒤에 설명을 보여 주세요.'});
  await assert.rejects(f.adapter.submitAuthoring(proposed.text,proposed.requestId,signal()),/authoring_mismatch/);
  assert.equal(f.calls.prepare,0);
  await f.adapter.prepare(raw,request.requestId,signal());
  const wrong=createCompanionAuthoringIntent({requestId:'intent-one',pairingId:'other',selection:request,text:'다른 컴퓨터'});
  await assert.rejects(f.adapter.submitAuthoring(wrong.text,wrong.requestId,signal()),/authoring_mismatch/);
  const changed=createCompanionAuthoringIntent({requestId:'intent-one',pairingId:'pair',selection:{...request,taskId:'other-task'},text:'다른 작업'});
  await assert.rejects(f.adapter.submitAuthoring(changed.text,changed.requestId,signal()),/authoring_mismatch/);
  const receipt=await f.adapter.submitAuthoring(proposed.text,proposed.requestId,signal());
  assert.deepEqual(receipt,{state:'relay_received',requestId:'intent-one'});
  assert.equal(f.calls.send,1);assert.equal(f.calls.budget,1);
  await assert.rejects(f.adapter.submitAuthoring(proposed.text,proposed.requestId,signal()),/authoring_already_attempted/);
  assert.equal(f.calls.send,1);f.adapter.dispose();
});

test('uncertain authored delivery stays held; changed bytes, duplicate gestures and close cannot send again', async () => {
  const f=fixture({failSend:true});await f.adapter.prepare(raw,request.requestId,signal());
  const proposed=createCompanionAuthoringIntent({requestId:'intent-two',pairingId:'pair',selection:request,text:'다음 문제를 만들어 주세요.'});
  await assert.rejects(f.adapter.submitAuthoring(proposed.text,proposed.requestId,signal()),/http_429/);
  await assert.rejects(f.adapter.submitAuthoring(proposed.text,proposed.requestId,signal()),/authoring_already_attempted/);
  const altered=createCompanionAuthoringIntent({requestId:'intent-two',pairingId:'pair',selection:request,text:'바뀐 내용'});
  await assert.rejects(f.adapter.submitAuthoring(altered.text,altered.requestId,signal()),/authoring_mismatch/);
  f.adapter.dispose();await assert.rejects(f.adapter.submitAuthoring(proposed.text,proposed.requestId,signal()),/stopped/);
  assert.equal(f.calls.send,1);
});
function fixture(options = {}) {
  const calls = { prepare: 0, send: 0, receive: 0, ack: 0, close: 0, budget: 0, dispatch: [] };
  const pairing = { role: 'device', sessionId: 'session', invitation: { id: 'pair', status: 'paired', account_id: 'account', device_session_id: 'session', device_id: 'device', workspace_id: 'workspace' },
    transport: async (_role, _id, action, payload, abort) => { calls.dispatch.push({ action, payload, abort }); return { invitation: pairing.invitation }; },
    async refresh() { await this.transport('device', 'pair', 'status', {}); return this.invitation; } };
  let incoming = [{ message_id: 'result-1', text: '<button>내 작품</button>' }], liveContext = { ...context }, closed = false;
  const relay = { role: 'device', pairing, row: Object.freeze({ ...pairing.invitation }),
    transport: async (_role, _id, action, text, abort) => { calls.dispatch.push({ action, text, abort }); if (options.failSend && action === 'send') throw Error('http_429'); return { state: 'transport_acknowledged', message_id: 'result-1' }; },
    async prepare(text, id) { calls.prepare++; return JSON.stringify({ text, id }); },
    async send(id) { calls.send++; return this.transport('device', 'pair', 'send', JSON.stringify({ id })); },
    async receive() { calls.receive++; await this.transport('device', 'pair', 'receive', '{}'); await pairing.refresh(); const found = incoming; incoming = []; if (options.receiveGate) await options.receiveGate.promise; return found; },
    async acknowledge(id) { calls.ack++; await pairing.refresh(); const result = await this.transport('device', 'pair', 'ack', JSON.stringify({ id })); if (options.ackGate) await options.ackGate.promise; return result; },
    close() { calls.close++; closed = true; }, diagnostics() { return { closed, context_digest: closed ? null : context.cipherContext }; } };
  const budget = options.budget ?? { async run(operation, abort) { calls.budget++; assert.equal(abort.aborted, false); return operation(); } };
  const adapter = new CompanionClientAdapter({ relay, pairing, requestId: request.requestId, budget,
    checkpoint: { context, currentContext: async () => liveContext } });
  return { calls, pairing, relay, adapter, incoming: value => { incoming = value; }, current: value => { liveContext = value; } };
}

test('one exact request maps to package ports; every raw relay and current-pair request shares the budget', async () => {
  const f = fixture(); const abort = signal();
  assert.equal(await f.adapter.prepare(raw, request.requestId, abort), await f.adapter.prepare(raw, request.requestId, abort));
  await f.adapter.send(request.requestId, abort);
  assert.equal((await f.adapter.refresh(abort)).status, 'paired');
  const messages = await f.adapter.receive(abort);
  assert.deepEqual(messages, [{ message_id: 'result-1', text: '<button>내 작품</button>' }]);
  assert.ok(Object.isFrozen(messages) && Object.isFrozen(messages[0]));
  await f.adapter.receive(abort); assert.equal(f.calls.receive, 1);
  const ack = await f.adapter.acknowledge('result-1', abort);
  assert.deepEqual(await f.adapter.acknowledge('result-1', abort), ack);
  assert.deepEqual(f.calls.dispatch.map(c => c.action), ['send', 'status', 'receive', 'status', 'status', 'ack']);
  assert.equal(f.calls.budget, 6); assert.equal(f.calls.prepare, 1); assert.equal(f.calls.send, 1); assert.equal(f.calls.ack, 1);
  assert.ok(f.calls.dispatch.every(c => c.abort instanceof AbortSignal));
  f.adapter.dispose(); f.adapter.dispose(); assert.equal(f.calls.close, 1);
});

test('changed IDs/bytes and unreceived ACKs never select another request or trigger retries', async () => {
  const f = fixture({ failSend: true }), abort = signal();
  await assert.rejects(f.adapter.prepare(raw, 'another-request', abort), /request_mismatch/);
  await assert.rejects(f.adapter.send(request.requestId, abort), /send_not_ready/);
  await f.adapter.prepare(raw, request.requestId, abort);
  await assert.rejects(f.adapter.prepare(raw + ' ', request.requestId, abort), /request_mismatch/);
  await assert.rejects(f.adapter.acknowledge('unknown-id', abort), /unreceived_message/);
  await assert.rejects(f.adapter.send(request.requestId, abort), /http_429/);
  await assert.rejects(f.adapter.send(request.requestId, abort), /send_not_ready/);
  assert.equal(f.calls.send, 1); assert.equal(f.calls.prepare, 1); f.adapter.clear();
});

test('abort before budget admission prevents HTTP invocation and uncertain send is not repeated', async () => {
  let queued;
  const budget = { run(operation, abort) { queued = { operation, abort }; return new Promise((_resolve, reject) => abort.addEventListener('abort', () => reject(Error('cancelled')), { once: true })); } };
  const f = fixture({ budget }); await f.adapter.prepare(raw, request.requestId, signal());
  const abort = new AbortController(), pending = f.adapter.send(request.requestId, abort.signal);
  const stopped = assert.rejects(pending, /stopped/); await tick();
  assert.ok(queued); assert.equal(f.calls.dispatch.length, 0); abort.abort(); await stopped; await tick();
  await assert.rejects(f.adapter.send(request.requestId, signal()), /send_not_ready/);
  assert.equal(f.calls.dispatch.length, 0); f.adapter.dispose();
});

test('late verified receive/ACK survives caller cancellation for explicit reconciliation; clear blocks late output', async () => {
  const receiveGate = deferred(), ackGate = deferred(), f = fixture({ receiveGate, ackGate });
  const cancelled = new AbortController(), first = f.adapter.receive(cancelled.signal);
  const rejection = assert.rejects(first, /stopped/); await tick(); cancelled.abort(); await rejection;
  receiveGate.resolve(); await tick();
  const messages = await f.adapter.receive(signal()); assert.equal(messages[0].message_id, 'result-1'); assert.equal(f.calls.receive, 1);
  const ackAbort = new AbortController(), ack = f.adapter.acknowledge('result-1', ackAbort.signal);
  const ackRejection = assert.rejects(ack, /stopped/); await tick(); ackAbort.abort(); await ackRejection; ackGate.resolve(); await tick();
  await f.adapter.acknowledge('result-1', signal()); assert.equal(f.calls.ack, 1);
  const gate = deferred(), other = fixture({ receiveGate: gate });
  const pending = other.adapter.receive(signal()), disposed = assert.rejects(pending, /stopped/);
  await tick(); other.adapter.clear(); await disposed; gate.resolve(); await tick();
  await assert.rejects(other.adapter.receive(signal()), /stopped/); assert.equal(other.calls.close, 1); f.adapter.dispose();
});

test('same-live reattach attests exact authenticated ledger bytes including ACKed packets, never checkpoint plaintext', async () => {
  const f = fixture(); await f.adapter.prepare(raw, request.requestId, signal());
  const messages = await f.adapter.receive(signal()); await f.adapter.acknowledge('result-1', signal());
  const saved = { context, request, messages: [...messages, ...messages] };
  const reattach = f.adapter.reattach;
  assert.equal(await reattach(saved, signal()), 'same_live_transport_verified_bytes');
  assert.equal(await f.adapter.reattach({ ...saved, messages: [{ message_id: 'result-1', text: 'modified' }] }, signal()), 'unavailable');
  assert.equal(await f.adapter.reattach({ ...saved, messages: [{ message_id: 'invented', text: 'saved plaintext' }] }, signal()), 'unavailable');
  assert.equal(await f.adapter.reattach({ ...saved, context: { ...context, sessionId: 'old-session' } }, signal()), 'unavailable');
  f.current({ ...context, sessionId: 'new-session' }); assert.equal(await f.adapter.reattach(saved, signal()), 'unavailable');
  f.adapter.dispose(); assert.equal(await f.adapter.reattach(saved, signal()), 'keys_lost');
});

test('bounded adapter queue and receive ledger reject overflow without invoking unbounded work', async () => {
  const gate = deferred(), f = fixture({ receiveGate: gate });
  const pending = Array.from({ length: 32 }, () => f.adapter.receive(signal()));
  const settled = Promise.allSettled(pending);
  await assert.rejects(f.adapter.receive(signal()), /overloaded/);
  f.adapter.dispose(); gate.resolve(); await settled; assert.ok(f.calls.receive <= 1);
  const other = fixture(); other.incoming(Array.from({ length: 65 }, (_, i) => ({ message_id: 'part-' + i, text: 'x' })));
  await assert.rejects(other.adapter.receive(signal()), /invalid_batch/); other.adapter.dispose();
});

test('adapter structural injection accepts the locally packed private package declarations without a production dependency', { skip: !process.env.HPS_COMPANION_CLIENT_PACKAGE }, async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile), temp = await mkdtemp(join(tmpdir(), 'companion-adapter-package-'));
  try {
    const npm = join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
    const { stdout } = await exec(process.execPath, [npm, 'pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', temp], { cwd: process.env.HPS_COMPANION_CLIENT_PACKAGE, env: { ...process.env, npm_config_cache: join(temp, 'npm-cache') } });
    const [archive] = JSON.parse(stdout), installed = join(temp, 'node_modules/@hypeproof/companion-client');
    await mkdir(installed, { recursive: true });
    await exec('tar', ['-xzf', join(temp, archive.filename), '-C', installed, '--strip-components=1']);
    const adapterPath = fileURLToPath(new URL('../src/companionClientAdapter.ts', import.meta.url));
    await writeFile(join(temp, 'consumer.mts'), `import type {CompanionPreviewClient,CompanionRelayClient} from '@hypeproof/companion-client';\nimport {CompanionClientAdapter} from ${JSON.stringify(adapterPath)};\nexport function connect(pairing:CompanionPreviewClient,relay:CompanionRelayClient,budget:ConstructorParameters<typeof CompanionClientAdapter>[0]['budget']) { return new CompanionClientAdapter({pairing,relay,budget,requestId:'request-1'}); }\n`);
    await writeFile(join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], strict: true, skipLibCheck: false, noEmit: true, allowImportingTsExtensions: true, types: ['node'], typeRoots: [fileURLToPath(new URL('../node_modules/@types', import.meta.url))] }, files: ['consumer.mts'] }));
    await exec(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '-p', join(temp, 'tsconfig.json')], { maxBuffer: 1024 * 1024 });
  } finally { await rm(temp, { recursive: true, force: true }); }
});
