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
