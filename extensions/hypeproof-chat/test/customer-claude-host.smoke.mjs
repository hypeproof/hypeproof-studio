// Exercise the real host and consent session. Only VS Code and provider I/O are synthetic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [new URL('../src/personalContinuationHost.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent',
});
const disclosure = { provider: 'Anthropic', recipient: 'api.anthropic.com', account: 'learner@example.invalid', authMethod: 'claude.ai', funding: 'Claude Pro · 개인 계정', billingNotice: '추가 사용이 켜져 있으면 제공자가 청구할 수 있어요.' };
const ready = () => ({ status: 'ready', code: 'personal_subscription_ready', disclosure: structuredClone(disclosure), manualCommand: 'claude' });
const success = () => ({ status: 'success', code: 'completed', text: '직접 시험해 볼 제안' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function harness({ request = async () => success(), inspection = () => ready(), commitReply } = {}) {
  const posts = [], requests = [], commits = [], inspections = [];
  let receive, onDispose, closed = false, current = true, panel;
  const vscode = {
    ViewColumn: { Beside: 2 },
    window: { createWebviewPanel() {
      panel = {
        webview: {
          html: '',
          postMessage(message) { posts.push(plain(message)); return Promise.resolve(true); },
          onDidReceiveMessage(callback) { receive = callback; return { dispose() { receive = undefined; } }; },
        },
        onDidDispose(callback) { onDispose = callback; return { dispose() { onDispose = undefined; } }; },
        dispose() { if (!closed) { closed = true; onDispose?.(); } },
      };
      return panel;
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports,
    require: id => id === 'vscode' ? vscode : id === 'node:child_process' ? { spawn() { throw Error('A host smoke test must never invoke a real CLI'); } } : require(id),
    process, Buffer, console, AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout,
  });
  const original = { projectLabel: 'Current project', draft: 'Original unsent draft', history: [{ role: 'user', content: 'Selected earlier question' }, { role: 'assistant', content: 'Selected earlier answer' }] };
  const ports = {
    ...structuredClone(original),
    isCurrent: () => current,
    commitReply: async value => { commits.push(plain(value)); await commitReply?.(value); },
    transport: {
      inspect: async signal => { inspections.push(signal); return inspection(signal); },
      request: async (snapshot, signal) => { requests.push({ snapshot: plain(snapshot), signal }); return request(snapshot, signal); },
    },
  };
  const disposable = module.exports.openPersonalContinuation(ports);
  const nonce = /<script nonce="([a-f0-9]+)">/.exec(panel.webview.html)?.[1];
  assert.ok(nonce, 'read the nonce issued in the actual panel HTML');
  const raw = message => receive?.(message);
  const emit = message => raw({ nonce, ...message });
  const review = async ({ draft = 'Reviewed continuation request', material = '', history = false } = {}) => {
    await emit({ type: 'review', draft, material, history });
    const result = posts.findLast(message => message.type === 'review');
    assert.ok(result, 'the actual host issued a review');
    return result;
  };
  return { posts, requests, commits, inspections, ports, original, panel, nonce, raw, emit, review, close: () => disposable.dispose(), switchScope() { current = false; } };
}

test('only the current panel nonce and explicit consent authorize a reviewed payload; success commits once to the current task', async () => {
  const h = harness();
  try {
    await h.raw({ type: 'review', nonce: 'different-panel', draft: 'Wrong panel', material: '', history: false });
    await h.raw({ type: 'ready' });
    assert.equal(h.inspections.length, 0);
    await h.emit({ type: 'ready' });
    assert.equal(h.posts.at(-1).type, 'inspection');
    assert.equal(h.posts.at(-1).ready, true);
    assert.match(h.posts.at(-1).account, /learner@example\.invalid/);
    assert.equal(h.requests.length, 0);
    const reviewed = await h.review({ material: 'Only the chosen text', history: true });
    for (const consent of [undefined, false, 'true', 1]) await h.emit({ type: 'send', digest: reviewed.digest, consent });
    await h.emit({ type: 'send', digest: 'unreviewed-digest', consent: true });
    await h.raw({ type: 'send', nonce: 'different-panel', digest: reviewed.digest, consent: true });
    assert.equal(h.requests.length, 0);
    await h.emit({ type: 'send', digest: reviewed.digest, consent: true });
    assert.equal(h.requests.length, 1);
    const sent = h.requests[0].snapshot;
    assert.ok(reviewed.payload.includes(sent.systemPrompt));
    assert.ok(reviewed.payload.includes(sent.userPrompt));
    assert.deepEqual(JSON.parse(sent.userPrompt), { projectLabel: h.original.projectLabel, selectedText: [{ label: '직접 선택한 자료', text: 'Only the chosen text' }], history: h.original.history, draft: 'Reviewed continuation request' });
    assert.equal(h.commits.length, 1);
    assert.match(h.commits[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(h.commits[0].prompt, 'Reviewed continuation request');
    assert.equal(h.commits[0].text, success().text);
    await h.emit({ type: 'send', digest: reviewed.digest, consent: true });
    assert.equal(h.requests.length, 1); assert.equal(h.commits.length, 1);
    assert.equal(h.ports.draft, h.original.draft); assert.deepEqual(h.ports.history, h.original.history);
  } finally { h.close(); }
});

test('editing revokes the previous digest and a new review discloses only newly selected context', async () => {
  const h = harness();
  try {
    const oldReview = await h.review({ draft: 'First prompt', material: 'Previously selected private text', history: true });
    await h.emit({ type: 'edit' });
    await h.emit({ type: 'send', digest: oldReview.digest, consent: true });
    assert.equal(h.requests.length, 0);
    const newReview = await h.review({ draft: 'Edited prompt', history: false });
    assert.notEqual(newReview.digest, oldReview.digest);
    await h.emit({ type: 'send', digest: oldReview.digest, consent: true });
    assert.equal(h.requests.length, 0);
    await h.emit({ type: 'send', digest: newReview.digest, consent: true });
    assert.equal(h.requests.length, 1); assert.equal(h.commits.length, 1);
    assert.deepEqual(JSON.parse(h.requests[0].snapshot.userPrompt), { projectLabel: h.original.projectLabel, selectedText: [], history: [], draft: 'Edited prompt' });
    assert.equal(h.requests[0].snapshot.userPrompt.includes('Previously selected private text'), false);
    assert.equal(h.ports.draft, h.original.draft); assert.deepEqual(h.ports.history, h.original.history);
  } finally { h.close(); }
});

test('duplicate sends cannot replay while pending; cancellation, scope change and panel disposal discard late output', async () => {
  for (const action of ['cancel', 'scope', 'dispose']) {
    const waiting = deferred(), entered = deferred();
    const h = harness({ request: async () => { entered.resolve(); return waiting.promise; } });
    try {
      const reviewed = await h.review();
      const sending = h.emit({ type: 'send', digest: reviewed.digest, consent: true });
      await entered.promise;
      await h.emit({ type: 'send', digest: reviewed.digest, consent: true });
      assert.equal(h.requests.length, 1);
      if (action === 'cancel') await h.emit({ type: 'cancel' });
      if (action === 'scope') h.switchScope();
      if (action === 'dispose') h.close();
      if (action !== 'scope') assert.equal(h.requests[0].signal.aborted, true);
      const postsAtInvalidation = h.posts.length;
      waiting.resolve(success()); await sending;
      assert.equal(h.commits.length, 0, `${action} prevents the late answer from entering another task`);
      assert.equal(h.posts.length, postsAtInvalidation, `${action} prevents a late answer from being displayed`);
      assert.equal(h.ports.draft, h.original.draft); assert.deepEqual(h.ports.history, h.original.history);
    } finally { waiting.resolve(success()); h.close(); }
  }
});

test('changed account or provider failure consumes consent without committing or retrying', async () => {
  for (const outcome of ['account', 'quota', 'offline', 'auth', 'error']) {
    let accountChanged = false;
    const h = harness({ inspection: () => accountChanged ? { ...ready(), disclosure: { ...disclosure, account: 'different@example.invalid' } } : ready(), request: async () => ({ status: outcome, code: `synthetic_${outcome}` }) });
    try {
      const reviewed = await h.review();
      if (outcome === 'account') accountChanged = true;
      await h.emit({ type: 'send', digest: reviewed.digest, consent: true });
      assert.equal(h.requests.length, outcome === 'account' ? 0 : 1);
      assert.equal(h.commits.length, 0);
      assert.equal(h.posts.at(-1).type, 'result'); assert.equal(h.posts.at(-1).text, undefined);
      await h.emit({ type: 'send', digest: reviewed.digest, consent: true });
      assert.equal(h.requests.length, outcome === 'account' ? 0 : 1);
      assert.equal(h.ports.draft, h.original.draft); assert.deepEqual(h.ports.history, h.original.history);
    } finally { h.close(); }
  }
});
