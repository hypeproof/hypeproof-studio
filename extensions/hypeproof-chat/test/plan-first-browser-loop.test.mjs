// CGP-CHAT-R-004 — the REAL ChatPanelProvider.runBrowserLoop (proxy runtime with browser_control) and the real
// pre-built world shortcut, driven with a fake proxy stream: a planning turn runs no browser tool, reveals no
// model-written HTML into index.html and opens no pre-built world; the ordinary turn does all three.
//   node --experimental-strip-types --test test/plan-first-browser-loop.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { PLANNING_GATE, PlanFirstSession } from '../src/planFirst.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-first-loop-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const stubSrc = `const h={get:(t,k)=>k==='__esModule'?false:(k in t?t[k]:new Proxy(function(){},h)),apply:()=>new Proxy(function(){},h),construct:()=>new Proxy({},h)};module.exports=new Proxy({Uri:{file:p=>({fsPath:p})},EventEmitter:class{constructor(){this.event=()=>({dispose(){}})}fire(){}dispose(){}}},h);`;
const out = path.join(root, 'cpp.cjs');
await build({ entryPoints: [fileURLToPath(new URL('../src/chatPanelProvider.ts', import.meta.url))], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
  external: ['@anthropic-ai/claude-agent-sdk', 'zod', 'playwright-core', 'electron'],
  plugins: [{ name: 'vscode', setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 's' })); b.onLoad({ filter: /.*/, namespace: 's' }, () => ({ contents: stubSrc, loader: 'js' })); } }] });
const { ChatPanelProvider } = createRequire(import.meta.url)(out);

const sse = chunks => new Response(new ReadableStream({ start(c) { for (const j of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(j)}\n\n`)); c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const HTML = '```html\n<!doctype html><html><head><title>x</title></head><body><p>made during planning</p></body></html>\n```';

async function loop(planGate) {
  let call = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => (++call === 1
    ? sse([{ choices: [{ delta: { content: '1. 페이지 만들기\n' + HTML } }] }, { choices: [{ delta: { hps_tool_use: { id: 'tu1', name: 'browser_navigate', input: { url: 'https://example.com' } } } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }])
    : sse([{ choices: [{ delta: { content: '계획입니다' }, finish_reason: 'stop' }] }]));
  const executed = [], reveals = [], logs = [];
  const fake = Object.create(ChatPanelProvider.prototype);
  Object.assign(fake, {
    cachedProfile: { browser_control: { enabled: true, max_iterations: 4 } },
    isCurriculumRuntimeEnabled: () => true,
    mcpBrowser: { crNewTurn() {}, execute: async c => { executed.push(c.name); return { content: [{ type: 'text', text: 'ok' }] }; }, dispose: async () => {} },
    crBrowserOptions: () => ({}), liveServer: { currentUrl: () => null }, proxyUsageRecorder: () => () => {},
    revealBuilt: async html => { reveals.push(html.length); return true; },
    retargetLoopbackNavigation: async c => ({ call: c }), noteTaskActivity() {}, postToolLog: (_s, e) => logs.push(e),
  });
  try {
    await ChatPanelProvider.prototype.runBrowserLoop.call(fake, { planGate, proxyUrl: 'http://127.0.0.1:1/v1', model: 'm', token: 't', history: [], userText: 'q', images: [], signal: new AbortController().signal, streamId: 's1', onDelta() {}, onRefusal() {}, onCitations() {} });
  } finally { globalThis.fetch = realFetch; }
  return { executed, reveals, errorLines: logs.filter(l => l.state === 'error').length };
}

test('proxy browser loop: a planning turn runs no browser tool and reveals no model-written HTML; the ordinary turn does both', async () => {
  const ordinary = await loop(undefined);
  assert.deepEqual(ordinary.executed, ['browser_navigate'], 'control: the ordinary turn executes the tool');
  assert.equal(ordinary.reveals.length, 1, 'control: the ordinary turn reveals the HTML');
  const planning = await loop(PLANNING_GATE);
  assert.deepEqual(planning.executed, [], 'browser.execute is never called on a planning turn');
  assert.deepEqual(planning.reveals, [], 'no index.html write on a planning turn');
});

test('pre-built world shortcut: skipped on a planning turn, opened on an ordinary one', async () => {
  const worlds = [{ id: 'w1', chip: '🐱 초코', guest: '초코', emoji: '🐱' }];
  const run = async planning => {
    const opened = [];
    const fake = Object.create(ChatPanelProvider.prototype);
    fake.revealPrebuiltWorld = async id => { opened.push(id); return true; };
    const result = await ChatPanelProvider.prototype.openPrebuiltWorldForTurn.call(fake, { text: '초코', worlds, token: 't', proxyUrl: 'http://127.0.0.1:1/v1', planning });
    return { opened, result };
  };
  const ordinary = await run(false);
  assert.deepEqual(ordinary.opened, ['w1']); assert.equal(ordinary.result.shown, true);
  const planning = await run(true);
  assert.deepEqual(planning.opened, [], 'no world is saved into index.html while a plan is pending'); assert.equal(planning.result, null);
});

test('instructor seat: a plan mode a learner left on never gates an instructor turn, and the instructor cannot switch it', async () => {
  const seat = isInstructor => {
    const fake = Object.create(ChatPanelProvider.prototype);
    const session = new PlanFirstSession({ newId: () => 'p1' });
    Object.defineProperty(fake, 'planFirst', { get: () => session });
    Object.assign(fake, { _instructorMode: { isInstructor }, currentTaskStore: () => ({ getView: () => ({ activeTaskId: 't1' }) }), posts: [], post: async function (m) { this.posts.push(m); } });
    return { fake, session };
  };
  const learner = seat(false);
  learner.session.setOn('t1', true);
  const asLearner = ChatPanelProvider.prototype.beginPlanTurn.call(learner.fake, 'q');
  assert.equal(asLearner.planning, true); assert.equal(asLearner.gate, PLANNING_GATE);
  // Same workspace state, instructor seat: no gate, no planning.
  const instructor = seat(true);
  instructor.session.setOn('t1', true);
  const asInstructor = ChatPanelProvider.prototype.beginPlanTurn.call(instructor.fake, 'q');
  assert.equal(asInstructor.planning, false); assert.equal(asInstructor.gate, undefined); assert.equal(asInstructor.ready('1. x'), null);
  // The instructor's switch message is refused and changes nothing.
  const off = seat(true); off.session.setOn('t1', false);
  await ChatPanelProvider.prototype.handlePlanFirst.call(off.fake, { type: 'planFirstSet', on: true });
  assert.equal(off.session.view('t1').on, false, 'the instructor cannot enable it');
  // With the mode off nothing reads the instructor flag at all (pending-send keeps its early-return order).
  const plain = seat(false); let reads = 0;
  Object.defineProperty(plain.fake, '_instructorMode', { get() { reads++; return { isInstructor: false }; } });
  const quiet = ChatPanelProvider.prototype.beginPlanTurn.call(plain.fake, 'q');
  assert.equal(quiet.planning, false); assert.equal(quiet.gate, undefined); assert.equal(reads, 0);
});

test('DEC-10 class switch: served false hides the mode, turns a learner\'s own "on" off visibly, and resolves a pending plan safely; absent changes nothing', async () => {
  const seat = profile => {
    const fake = Object.create(ChatPanelProvider.prototype);
    const session = new PlanFirstSession({ newId: () => 'p1' });
    const sent = [];
    Object.defineProperty(fake, 'planFirst', { get: () => session });
    Object.assign(fake, { cachedProfile: profile, _instructorMode: { isInstructor: false }, currentTaskStore: () => ({ getView: () => ({ activeTaskId: 't1' }) }), posts: [], post: async function (m) { this.posts.push(m); }, handleSend: async (...a) => { sent.push(a[0]); } });
    return { fake, session, sent };
  };
  const handle = (s, msg) => ChatPanelProvider.prototype.handlePlanFirst.call(s.fake, msg);
  // Absent (and an explicit true): the switch works exactly as before, and the message carries no new field.
  for (const profile of [{}, { plan_first: { available: true } }, null]) {
    const s = seat(profile);
    await handle(s, { type: 'planFirstSet', on: true });
    assert.deepEqual(s.fake.posts.at(-1), { type: 'planFirstState', on: true, plan: null });
    s.session.beginTurn('t1', 'x').ready('1. a');
    await handle(s, { type: 'planFirstApprove', planId: 'p1', text: '1. a' });
    assert.equal(s.sent.length, 1, 'an available seat still runs the approved turn');
  }
  // Served false while the learner had it on and a plan was waiting.
  const s = seat({ plan_first: { available: false } });
  s.session.setOn('t1', true); s.session.beginTurn('t1', 'x').ready('1. a');
  await handle(s, { type: 'planFirstRequest' });
  assert.deepEqual(s.fake.posts.at(-1), { type: 'planFirstState', on: false, plan: null, available: false, switchedOff: true }, 'turned off visibly');
  assert.equal(s.session.view('t1').on, false); assert.equal(s.session.view('t1').plan, null);
  // A stale press on the card the learner still sees: nothing is sent, nothing is left pending.
  await handle(s, { type: 'planFirstApprove', planId: 'p1', text: '1. a' });
  assert.deepEqual(s.sent, [], 'no approved turn runs');
  assert.deepEqual(s.fake.posts.at(-1), { type: 'planFirstState', on: false, plan: null, available: false });
  // The switch flips off in the instant after an approval (the profile refreshes while the state post is in flight):
  // the approved text must not go out as a normal turn; the plan is dropped and the learner sees the status line once.
  const w = seat({});
  w.session.setOn('t1', true); w.session.beginTurn('t1', 'x').ready('1. a');
  w.fake.post = async function (m) { this.posts.push(m); this.cachedProfile = { plan_first: { available: false } }; };
  await handle(w, { type: 'planFirstApprove', planId: 'p1', text: '1. a' });
  assert.deepEqual(w.sent, [], 'a plan approved just before the switch went off is not sent');
  assert.deepEqual(w.fake.posts.at(-1), { type: 'planFirstState', on: false, plan: null, available: false, switchedOff: true }, 'calm status line, mode off');
  assert.equal(w.session.view('t1').plan, null); assert.equal(w.session.view('t1').on, false);
  const next = ChatPanelProvider.prototype.beginPlanTurn.call(w.fake, '1. a');
  assert.equal(next.planning, false, 'no approval is left to spend');
  // A stale chip press cannot turn it back on.
  await handle(s, { type: 'planFirstSet', on: true });
  assert.equal(s.session.view('t1').on, false);
  // A mode left on (restored workspace state) with an unspent approval: the next turn is ordinary.
  const t = seat({ plan_first: { available: false } });
  t.session.setOn('t1', true); t.session.beginTurn('t1', 'x').ready('1. a');
  const approval = t.session.approve('t1', 'p1', '1. a');
  const turn = ChatPanelProvider.prototype.beginPlanTurn.call(t.fake, approval.sendText);
  assert.equal(turn.planning, false); assert.equal(turn.gate, undefined); assert.equal(turn.ready('1. late'), null);
  assert.equal(t.session.view('t1').on, false);
  // The profile sync posts only for a class that switched it off (or just switched it back on).
  const u = seat({ plan_first: { available: false } });
  ChatPanelProvider.prototype.syncPlanFirstWithProfile.call(u.fake); await new Promise(r => setImmediate(r));
  assert.equal(u.fake.posts.length, 1);
  u.fake.cachedProfile = {}; ChatPanelProvider.prototype.syncPlanFirstWithProfile.call(u.fake); await new Promise(r => setImmediate(r));
  assert.deepEqual(u.fake.posts.at(-1), { type: 'planFirstState', on: false, plan: null }, 'back to available: the old field is gone');
  const v = seat({}); ChatPanelProvider.prototype.syncPlanFirstWithProfile.call(v.fake); await new Promise(r => setImmediate(r));
  assert.equal(v.fake.posts.length, 0, 'a class that never switched it sees no new message');
});
