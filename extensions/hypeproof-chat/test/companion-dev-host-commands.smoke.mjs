import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/companionDevHostCommands.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function host() {
  let state = 'idle', publication;
  const calls = [], challenge = { schema: 'fixture-challenge', invite_secret: 'explicit-copy-only', host_key: 'fixture-public-key' };
  const api = {
    view: () => ({ state, ...(state === 'claimed' ? { comparisonCode: '123456' } : {}), ...(publication?{publication}:{}), executionAuthorized: false }),
    async startInvitation(signal) { calls.push(['start', signal]); state = 'inviting'; return { challenge, view: api.view() }; },
    async inspectClaim(signal) { calls.push(['inspect', signal]); if (state === 'inviting') state = 'claimed'; return api.view(); },
    async confirmComparedCode(code, signal) { calls.push(['confirm', code, signal]); if (code !== '123456') throw Error('private-token and /private/workspace'); state = 'approved'; return api.view(); },
    async connectCipher(signal) { calls.push(['connect', signal]); state = 'connected'; return api.view(); },
    async describeSelected(requestId, signal) { calls.push(['describe', requestId, signal]); return { taskId: 'task-1', version: 3, artifactId: 'artifact-1', artifactVersion: 'a'.repeat(64) }; },
    async publishSelected(requestId,signal){calls.push(['publish',requestId,signal]);publication={state:calls.filter(c=>c[0]==='publish').length===1?'delivery_unconfirmed':'transport_accepted',requestId,messageId:'selection_'+'a'.repeat(64),revision:1};return publication;},
    async receiveAndHandle(signal) { calls.push(['receive', signal]); return { state: 'waiting', processed: 1, acknowledged: 0, expired: 0, pending: 1 }; },
    close() { calls.push(['close']); state = 'closed'; },
    async revoke(signal) { calls.push(['revoke', signal]); state = 'revoked'; return api.view(); },
  };
  return { api, calls, challenge };
}
function fixture(owners = [host()], mode = 2) {
  const actions = [], inputs = [], warnings = [], menus = [], inputOptions = [], messages = [], clipboard = [], progress = [];
  const handlers=new Map(),statuses=[],controls=[];
  let handler, invalidation, created = 0, unregistered = false;
  class Disposable { constructor(fn) { this.fn = fn; } dispose() { this.fn?.(); this.fn = undefined; } }
  const ui = {
    createStatusBarItem(){const item={text:'',command:'',show(){this.visible=true;},hide(){this.visible=false;},dispose(){this.visible=false;}};statuses.push(item);return item;},
    async showQuickPick(items, options) { menus.push({ items, options }); const action = actions.shift(); if (action === undefined) return undefined; const item = items.find(i => i.action === action); assert.ok(item, 'requested action must be available: ' + action); return item; },
    async showInputBox(options) { inputOptions.push(options); return inputs.shift(); },
    async showWarningMessage(message, options, ...buttons) { messages.push({ type: 'warning', message, buttons }); return warnings.shift(); },
    async showInformationMessage(message) { messages.push({ type: 'info', message }); },
    async showErrorMessage(message) { messages.push({ type: 'error', message }); },
    async withProgress(options, work) { let cancel; const item = { options, cancel: () => cancel?.() }; progress.push(item); return work({}, { onCancellationRequested(fn) { cancel = fn; return new Disposable(() => { cancel = undefined; }); } }); },
  };
  const vscode = { Disposable, ExtensionMode: { Development: 2, Production: 1 }, ProgressLocation: { Notification: 15 }, window: ui,
    env: { clipboard: { async writeText(text) { clipboard.push(text); } } },
    commands: { registerCommand(id, fn) { assert.ok(['hypeproofChat.devCompanionHost','hypeproofChat.devCompanionStopReceiving','hypeproofChat.devCompanionRevoke'].includes(id));handlers.set(id,fn);if(id==='hypeproofChat.devCompanionHost')handler=fn; return new Disposable(() => { unregistered = true; }); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), AbortController });
  const context = { extensionMode: mode, subscriptions: [] };
  const ports = { receivingControls:binding=>controls.push(binding), createOwner: async signal => { const owner = owners[created++]; assert.ok(owner); return owner.api; }, onDidInvalidate(fn) { invalidation = fn; return new Disposable(() => { invalidation = undefined; }); } };
  const registration = module.exports.registerDevCompanionHostCommands(context, ports);
  return { actions, inputs, warnings, menus, inputOptions, messages, clipboard, progress, ports, context, registration,handlers,statuses,controls,
    run: action => { actions.push(action); return handler?.(); }, invalidate: () => invalidation?.(), get created() { return created; }, get registered() { return !!handler; }, get unregistered() { return unregistered; } };
}

test('actual DEV gate and explicit gestures: no opening side effects, no implicit copy, code approval or receive', async () => {
  const production = fixture([], 1); assert.equal(production.registered, false); assert.equal(production.created, 0); production.registration.dispose();
  const h = host(), f = fixture([h]);
  await f.run(undefined); assert.equal(f.created, 0);
  await f.run('prepare'); assert.equal(f.created, 1); assert.equal(f.clipboard.length, 0); assert.equal(h.calls.length, 1);
  await f.run('copy'); assert.deepEqual(JSON.parse(f.clipboard[0]), h.challenge);
  await f.run('inspect'); assert.ok(f.messages.some(m => m.message.includes('123456') && m.message.includes('아직 승인하지'))); assert.equal(h.calls.filter(c => c[0] === 'confirm').length, 0);
  await f.run('compare'); assert.equal(h.calls.filter(c => c[0] === 'confirm').length, 0); assert.equal(f.inputOptions[0].value, undefined);
  f.inputs.push('123456'); await f.run('compare'); assert.equal(h.calls.filter(c => c[0] === 'confirm').length, 0);
  f.inputs.push('654321'); f.warnings.push('두 화면의 코드가 같아요'); await f.run('compare'); assert.equal(h.api.view().state, 'claimed');
  assert.ok(f.messages.some(m => m.type === 'error')); assert.ok(!JSON.stringify(f.messages).includes('private-token'));
  f.inputs.push('123456'); f.warnings.push('두 화면의 코드가 같아요'); await f.run('compare'); assert.equal(h.api.view().state, 'approved');
  assert.equal(h.calls.filter(c => c[0] === 'connect').length, 0);
  await f.run('connect'); await f.run('describe'); assert.equal(h.calls.filter(c => c[0] === 'receive').length, 0);
  assert.match(h.calls.find(c => c[0] === 'describe')[1], /^[a-f0-9-]{36}$/);
  await f.run('receive'); assert.equal(h.calls.filter(c => c[0] === 'receive').length, 1);
  assert.ok(f.messages.some(m => m.message.includes('대기 1건') && m.message.includes('아직 끝나지')));
  assert.ok(!JSON.stringify(f.messages).includes('explicit-copy-only')); assert.ok(!JSON.stringify(f.menus).includes('fixture-public-key'));
  assert.equal(f.context.subscriptions.length, 1); f.registration.dispose(); assert.equal(f.unregistered, true);
});

test('local close and signed revoke are separate, cancellable actions with truthful server outcomes', async () => {
  const first = host(), second = host(), f = fixture([first, second]); await f.run('prepare');
  await f.run('close'); assert.equal(first.calls.filter(c => c[0] === 'close').length, 0);
  f.warnings.push('이 컴퓨터 연결 닫기'); await f.run('close'); assert.equal(first.calls.filter(c => c[0] === 'close').length, 1); assert.equal(first.calls.filter(c => c[0] === 'revoke').length, 0);
  assert.ok(f.messages.some(m => m.message.includes('철회는 확인하지')));
  await f.run('prepare'); await f.run('revoke'); assert.equal(second.calls.filter(c => c[0] === 'revoke').length, 0);
  second.api.revoke = async () => { throw Error('Bearer private-token'); };
  f.warnings.push('연결 권한 철회 요청'); await f.run('revoke'); assert.ok(f.messages.at(-1).type === 'error'); assert.equal(second.api.view().state, 'inviting');
  second.api.revoke = async () => ({ state: 'revoked', executionAuthorized: false });
  f.warnings.push('연결 권한 철회 요청'); await f.run('revoke'); assert.equal(f.messages.at(-1).message, '이 기기의 연결 권한 철회를 확인했어요.');
  f.registration.dispose();
});

test('invalidated old owner resolve/reject cannot reopen, notify or release replacement busy work', async () => {
  for (const rejected of [false, true]) {
    const old = host(), next = host(), f = fixture([old, next]), oldEntered = deferred(), nextEntered = deferred(), oldGate = deferred(), nextGate = deferred();
    const oldStart = old.api.startInvitation, nextStart = next.api.startInvitation;
    old.api.startInvitation = async signal => { oldEntered.resolve(signal); await oldGate.promise; return oldStart(signal); };
    next.api.startInvitation = async signal => { nextEntered.resolve(); await nextGate.promise; return nextStart(signal); };
    const oldRun = f.run('prepare'), oldSignal = await oldEntered.promise; f.invalidate(); assert.equal(oldSignal.aborted, true); assert.equal(old.calls.filter(c => c[0] === 'close').length, 1);
    const nextRun = f.run('prepare'); await nextEntered.promise;
    const count = f.messages.length;
    if (rejected) oldGate.reject(Error('old private-token')); else oldGate.resolve(); await oldRun;
    assert.equal(f.messages.length, count, 'stale old completion must stay silent');
    const menuCount = f.menus.length; await f.run(undefined); assert.equal(f.menus.length, menuCount); assert.equal(f.created, 2, 'replacement remains busy');
    f.actions.length = 0;
    nextGate.resolve(); await nextRun; assert.equal(next.api.view().state, 'inviting');
    await f.run('copy'); assert.equal(f.clipboard.length, 1); f.registration.dispose();
  }
});

test('cancelled progress closes owner and suppresses late turns; stale factory result is immediately closed', async () => {
  const h = host(), f = fixture([h]); await f.run('prepare'); await f.run('inspect'); f.inputs.push('123456'); f.warnings.push('두 화면의 코드가 같아요'); await f.run('compare'); await f.run('connect');
  const entered = deferred(), gate = deferred(); h.api.receiveAndHandle = async signal => { entered.resolve(signal); return gate.promise; };
  const pending = f.run('receive'), signal = await entered.promise, count = f.messages.length; f.progress.at(-1).cancel(); assert.equal(signal.aborted, true);
  gate.resolve({ state: 'processed', processed: 1, acknowledged: 1, expired: 0, pending: 0 }); await pending; assert.equal(f.messages.length, count); assert.equal(h.api.view().state, 'closed');
  f.registration.dispose();
  const late = host(), g = fixture([]), factoryEntered = deferred(), factoryGate = deferred();
  g.ports.createOwner = async () => { factoryEntered.resolve(); return factoryGate.promise; };
  const preparing = g.run('prepare'); await factoryEntered.promise; g.registration.dispose(); factoryGate.resolve(late.api); await preparing;
  assert.equal(late.calls.filter(c => c[0] === 'close').length, 1); assert.equal(late.calls.filter(c => c[0] === 'start').length, 0); assert.equal(g.messages.length, 0);
});

test('explicit selected-work announcement retries the uncertain ID and never claims phone receipt or file approval',async()=>{
 const h=host(),f=fixture([h]);await f.run('prepare');await f.run('inspect');f.inputs.push('123456');f.warnings.push('두 화면의 코드가 같아요');await f.run('compare');await f.run('connect');
 await f.run(undefined);assert.equal(h.calls.filter(c=>c[0]==='publish').length,0);
 await f.run('publish');const first=h.calls.find(c=>c[0]==='publish');assert.match(first[1],/^[a-f0-9-]{36}$/);
 assert.ok(f.messages.at(-1).message.includes('아직 확인하지 못했어요'));
 await f.run('publish');const calls=h.calls.filter(c=>c[0]==='publish');assert.equal(calls[1][1],calls[0][1]);
 assert.ok(f.messages.at(-1).message.includes('서버가 접수했어요'));assert.ok(f.messages.at(-1).message.includes('휴대폰 수신과 파일 전달 승인은 아직 확인하지 않았어요'));
 assert.equal(h.calls.filter(c=>c[0]==='receive').length,0);f.registration.dispose();
});

test('persistent Stop and Revoke commands remain reachable while the menu command is busy',async()=>{for(const action of ['stop','revoke']){const h=host(),f=fixture([h]),entered=deferred(),gate=deferred();let stops=0;h.api.stopReceiving=()=>{stops++;};h.api.startReceiving=()=>true;
 await f.run('prepare');await f.run('inspect');f.inputs.push('123456');f.warnings.push('두 화면의 코드가 같아요');await f.run('compare');await f.run('connect');
 h.api.receiveAndHandle=async()=>{entered.resolve();return gate.promise;};const work=f.run('receive');await entered.promise;
 assert.ok(f.statuses.some(s=>s.command==='hypeproofChat.devCompanionStopReceiving'&&s.visible));assert.ok(f.statuses.some(s=>s.command==='hypeproofChat.devCompanionRevoke'&&s.visible));
 await f.handlers.get(action==='stop'?'hypeproofChat.devCompanionStopReceiving':'hypeproofChat.devCompanionRevoke')();assert.equal(action==='stop'?stops:h.calls.filter(c=>c[0]==='revoke').length,1);
 gate.resolve({state:'closed',processed:0,acknowledged:0,expired:0,pending:0});await work;f.registration.dispose();assert.ok(f.statuses.every(s=>!s.visible));}});


test('visible controls route the same independent handlers, fence old owners and hide inactive owners',async()=>{
 const first=host(),second=host();let receiving='listening',changed;
 for(const h of [first,second]){const original=h.api.view;h.api.view=()=>({...original(),receiving:{state:receiving}});h.api.stopReceiving=()=>{h.calls.push(['stop']);receiving='stopped';changed?.();};h.api.onReceivingChanged=fn=>{changed=fn;return{dispose(){changed=undefined;}};};}
 const f=fixture([first,second]);
 const connect=async()=>{await f.run('prepare');await f.run('inspect');f.inputs.push('123456');f.warnings.push('두 화면의 코드가 같아요');await f.run('compare');await f.run('connect');};
 await connect();const held=f.controls.at(-1);assert.equal(held.view.canStop,true);assert.equal(held.view.canRevoke,true);
 // A pending native menu action must not own admission of the visible Stop.
 const pending=deferred();first.api.receiveAndHandle=()=>pending.promise;const run=f.run('receive');await Promise.resolve();await held.act('stop');assert.equal(first.calls.filter(c=>c[0]==='stop').length,1);
 await held.act('stop');assert.equal(first.calls.filter(c=>c[0]==='stop').length,1,'stopped is not another action');pending.resolve({state:'waiting',processed:0,acknowledged:0,expired:0,pending:0});await run;
 f.invalidate();assert.equal(f.controls.at(-1),null);receiving='listening';await connect();assert.notEqual(f.controls.at(-1).view.nonce,held.view.nonce);
 await held.act('stop');await held.act('revoke');assert.equal(second.calls.some(c=>['stop','revoke'].includes(c[0])),false,'old control cannot act on replacement');
 await f.controls.at(-1).act('revoke');assert.equal(second.calls.filter(c=>c[0]==='revoke').length,1);assert.equal(f.controls.at(-1),null);assert.ok(f.messages.some(m=>m.message==='이 기기의 연결 권한 철회를 확인했어요.'));
 f.registration.dispose();assert.equal(f.controls.at(-1),null);
 const prod=fixture([],1);assert.equal(prod.controls.length,0,'production never publishes controls');
});

test('visible revoke failure keeps unconfirmed feedback instead of reporting server success',async()=>{
 const h=host(),f=fixture([h]);await f.run('prepare');await f.run('inspect');f.inputs.push('123456');f.warnings.push('두 화면의 코드가 같아요');await f.run('compare');await f.run('connect');
 h.api.revoke=async()=>{h.api.close();throw Error('synthetic unavailable');};
 await f.controls.at(-1).act('revoke');assert.equal(f.controls.at(-1),null);assert.ok(f.messages.some(m=>m.type==='error'&&m.message.includes('서버 권한 철회는 확인하지 못했어요')));assert.equal(f.messages.some(m=>m.message==='이 기기의 연결 권한 철회를 확인했어요.'),false);
});
