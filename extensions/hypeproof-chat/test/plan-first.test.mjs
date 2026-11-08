// CGP-CHAT-R-004 — "먼저 계획 보기": the host refuses every tool while the plan waits, on each runtime that runs
// tools; approval runs the turn under the ordinary gates; decline and redo run nothing.
//   node --experimental-strip-types --test test/plan-first.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { PlanFirstSession, PLAN_FIRST_REFUSAL, PLANNING_GATE, planFirstToolResult, planFirstTurnText, withoutTools } from '../src/planFirst.ts';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-first-')));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const src = rel => fileURLToPath(new URL(rel, import.meta.url));
const stub = { name: 'vscode-stub', setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports={window:{},workspace:{},Uri:{file:p=>({fsPath:p})}}', loader: 'js' })); } };
const bundle = async (entry, name) => {
  const out = path.join(root, name);
  await build({ entryPoints: [src(entry)], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['@anthropic-ai/claude-agent-sdk', 'zod'], plugins: [stub] });
  return createRequire(import.meta.url)(out);
};
const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' } };
const PERSONAL = { profile_id: 'synthetic-personal', activity_kind: 'personal', activity_id: 'act-1', ux, sdk_tools: { read: true, write: true, shell: true, browser: true }, game: { template_tier: 'website' } };
const MINOR = { ...PERSONAL, profile_id: 'synthetic-minor', minor_cohort: true, game: { template_tier: 'kids-rich' } };

// ---- the state machine ----
test('mode off: a turn is untouched and holds no gate', () => {
  const s = new PlanFirstSession();
  const turn = s.beginTurn('t1', 'hello');
  assert.equal(turn.mode, 'off'); assert.equal(turn.gate, undefined); assert.equal(turn.ready('1. a'), null);
});
test('mode on: the first turn is a planning turn with the gate; its answer becomes the waiting plan', () => {
  const s = new PlanFirstSession({ newId: () => 'p1' });
  s.setOn('t1', true);
  const turn = s.beginTurn('t1', 'make a page');
  assert.equal(turn.mode, 'planning'); assert.equal(turn.gate, PLANNING_GATE);
  assert.deepEqual(turn.ready('1. 파일 만들기\n2. 확인하기'), { on: true, plan: { id: 'p1', text: '1. 파일 만들기\n2. 확인하기' } });
});
test('an empty answer makes no plan; a superseded turn cannot plant one', () => {
  const s = new PlanFirstSession({ newId: () => 'p1' });
  s.setOn('t1', true);
  assert.equal(s.beginTurn('t1', 'a').ready('   '), null);
  const first = s.beginTurn('t1', 'a'); s.beginTurn('t1', 'b');
  assert.equal(first.ready('1. old'), null, 'a newer turn owns the task');
});
test('approval mints a single-use approval bound to exactly the returned send text', () => {
  const s = new PlanFirstSession({ newId: () => 'p1' });
  s.setOn('t1', true); s.beginTurn('t1', 'x').ready('1. a');
  const a = s.approve('t1', 'p1', '1. a\n2. b');
  assert.ok(a.ok); assert.match(a.sendText, /^계획대로 진행해 주세요\./);
  assert.equal(s.approvedFor('t1').edited, true); assert.equal(s.approvedFor('t1').revision, 2);
  assert.equal(s.beginTurn('t1', 'something else').mode, 'planning', 'a different send gets no approval');
  s.beginTurn('t1', 'x').ready('1. a'); // new plan after the planning turn above
  const b = s.approve('t1', 'p1', '1. a'); assert.ok(b.ok);
  assert.equal(s.beginTurn('t1', b.sendText).mode, 'approved');
  assert.equal(s.beginTurn('t1', b.sendText).mode, 'planning', 'single use');
});
test('approve refuses a wrong plan id, an empty or oversized text, and a task whose mode is off', () => {
  const s = new PlanFirstSession({ newId: () => 'p1' });
  s.setOn('t1', true); s.beginTurn('t1', 'x').ready('1. a');
  assert.deepEqual(s.approve('t1', 'nope', 'x'), { ok: false, reason: 'no_plan' });
  assert.deepEqual(s.approve('t2', 'p1', 'x'), { ok: false, reason: 'no_plan' });
  assert.deepEqual(s.approve('t1', 'p1', '  '), { ok: false, reason: 'empty' });
  assert.deepEqual(s.approve('t1', 'p1', 'x'.repeat(6001)), { ok: false, reason: 'too_long' });
  s.setOn('t1', false);
  assert.deepEqual(s.approve('t1', 'p1', 'x'), { ok: false, reason: 'no_plan' });
});
test('decline and redo drop the plan and mint nothing; the next turn is another planning turn', () => {
  const s = new PlanFirstSession({ newId: () => 'p1' });
  s.setOn('t1', true); s.beginTurn('t1', 'x').ready('1. a');
  assert.equal(s.decline('t1', 'p1').plan, null);
  assert.equal(s.beginTurn('t1', 'next').mode, 'planning');
  s.beginTurn('t1', 'x').ready('1. a');
  const r = s.redo('t1', 'p1', '1. a'); assert.ok(r.ok); assert.equal(r.sendText, '계획을 다시 세워 주세요.');
  assert.equal(s.beginTurn('t1', r.sendText).mode, 'planning');
});
test('the mode is per task and survives a restore; turning it off drops the plan', () => {
  let snap;
  const s = new PlanFirstSession({ onChange: v => { snap = v; } });
  s.setOn('t1', true);
  assert.equal(new PlanFirstSession({ restore: snap }).view('t1').on, true);
  assert.equal(new PlanFirstSession({ restore: snap }).view('t2').on, false);
  s.beginTurn('t1', 'x').ready('1. a'); s.setOn('t1', false);
  assert.deepEqual(s.view('t1'), { on: false, plan: null });
});
test('gate helpers: the model-facing line, the proxy tool result, and no advertised tools', () => {
  assert.match(planFirstTurnText('q'), /먼저 계획 보기/);
  const r = planFirstToolResult(PLANNING_GATE, 'browser_navigate');
  assert.equal(r.isError, true); assert.equal(r.content[0].text, PLAN_FIRST_REFUSAL);
  const w = withoutTools({ permittedTools: ['Write'], permittedMcpTools: ['m'], permittedAgentTools: ['Task'], orchestrator: {} });
  assert.deepEqual([w.permittedTools, w.permittedMcpTools, w.permittedAgentTools, w.orchestrator], [[], [], [], undefined]);
});

// ---- runtime 1: the Agent SDK ----
test('Agent SDK: a planning turn advertises no tool and canUseTool refuses every one without asking; an approved turn is ordinary', async () => {
  const { runSdkCoach } = await bundle('../src/sdkCoach.ts', 'sdk.cjs');
  for (const profile of [PERSONAL, MINOR]) {
    const run = async planGate => {
      let options, asked = 0;
      const sdk = { query: a => { options = a.options; return (async function* () { yield { type: 'result', subtype: 'success', is_error: false }; })(); }, tool: (n, d, s, h) => ({ name: n, handler: h }), createSdkMcpServer: s => s };
      await runSdkCoach({ sdk, zod: { string: () => ({}) }, binaryResolution: { available: true, reasons: [] }, gatewayUrl: 'http://127.0.0.1:1/v1', token: 't', model: 'm', profile, systemPrompt: '', history: [], userText: 'q', cwd: root, planGate,
        signal: new AbortController().signal, stallTimeoutMs: 0, onDelta() {}, requestApproval: async () => { asked++; return true; }, memoryRememberHost: { write: async () => ({ ok: true, item: 'x' }) } });
      return { options, asked: () => asked };
    };
    const planning = await run(PLANNING_GATE);
    assert.deepEqual(planning.options.tools, [], 'no built-in tool is advertised');
    assert.equal(planning.options.mcpServers, undefined, 'no MCP server (browser, memory, email) is registered');
    for (const [name, input] of [['Write', { file_path: path.join(root, 'a.html'), content: 'x' }], ['Edit', { file_path: path.join(root, 'a.html'), old_string: 'a', new_string: 'b' }], ['Bash', { command: 'ls' }], ['Read', { file_path: path.join(root, 'a.html') }], ['mcp__hypeproof__browser_open', { url: 'https://example.com' }], ['mcp__hypeproof_memory__remember', { note: 'n' }], ['Task', {}]]) {
      const verdict = await planning.options.canUseTool(name, input, { toolUseID: 'u-' + name });
      assert.equal(verdict.behavior, 'deny', name); assert.equal(verdict.message, PLAN_FIRST_REFUSAL);
    }
    assert.equal(planning.asked(), 0, 'the learner is not even asked');
    const approved = await run(undefined);
    assert.ok(approved.options.tools.length > 0, 'an approved turn advertises its normal tools');
    const verdict = await approved.options.canUseTool('Write', { file_path: path.join(root, 'ok.html'), content: 'x' }, { toolUseID: 'u1' });
    assert.notEqual(verdict.message, PLAN_FIRST_REFUSAL, 'the ordinary gates decide an approved turn');
    if (profile.minor_cohort) assert.equal(approved.asked(), 1, 'a minor seat still asks before the write');
  }
});

// ---- runtime 2: the local CLI (claude) through the tool server ----
test('local CLI: a planning turn offers no tool and the host refuses a call made anyway; an approved turn writes only after the ordinary gate', async () => {
  const { runLocalCoach } = await bundle('../src/localRuntime/index.ts', 'local.cjs');
  const exe = path.join(root, 'fake-claude.mjs');
  fs.writeFileSync(exe, `#!/usr/bin/env node
import fs from 'node:fs';
const a = process.argv.slice(2);
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
const cfg = JSON.parse(a[a.indexOf('--mcp-config') + 1]).mcpServers.studio;
const rpc = async (id, method, params) => (await (await fetch(cfg.url, { method: 'POST', headers: { authorization: cfg.headers.Authorization, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })).json()).result;
const listed = (await rpc(1, 'tools/list', {})).tools.map(t => t.name);
const called = await rpc(2, 'tools/call', { name: 'Write', arguments: { file_path: process.cwd() + '/made.html', content: '<p>hi</p>' } });
fs.writeFileSync(process.cwd() + '/../local-result.json', JSON.stringify({ listed, called }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', usage: {} }));
`, { mode: 0o755 });
  const run = async (planGate, profile) => {
    const ws = fs.mkdtempSync(path.join(root, 'ws-')); let asked = 0;
    await runLocalCoach({ config: { provider: 'claude', executable: exe, model: 'm', label: 'l' }, profile, cwd: ws, history: [], userText: 'q', signal: new AbortController().signal, onDelta() {}, planGate,
      requestApproval: async () => { asked++; return { approved: true, actor: 'user' }; } });
    return { ws, asked, result: JSON.parse(fs.readFileSync(path.join(ws, '..', 'local-result.json'), 'utf8')) };
  };
  const planning = await run(PLANNING_GATE, PERSONAL);
  assert.deepEqual(planning.result.listed, [], 'no tool is offered');
  assert.equal(planning.result.called.content[0].text, PLAN_FIRST_REFUSAL);
  assert.equal(fs.existsSync(path.join(planning.ws, 'made.html')), false, 'no file was written'); assert.equal(planning.asked, 0);
  const approved = await run(undefined, MINOR);
  assert.ok(approved.result.listed.includes('Write'));
  assert.equal(approved.asked, 1, 'the minor seat is asked before the write');
  assert.equal(fs.existsSync(path.join(approved.ws, 'made.html')), true);
});

// ---- runtime 3: the proxy browser loop, and the host wiring of every runtime ----
test('host wiring (the proxy loop itself runs in plan-first-browser-loop.test.mjs): every runtime call site receives the gate, and a planning turn skips shortcuts, reveal and agent.md', () => {
  const host = fs.readFileSync(src('../src/chatPanelProvider.ts'), 'utf8');
  for (const call of ['runLocalCoach({planGate,', 'runInstructorTurn({\n            planGate,', 'runSdkCoach({\n            planGate,', 'this.runBrowserLoop({\n            planGate,']) assert.ok(host.includes(call), call);
  for (const guard of ["mode === 'auto' && !planning && wikiSwitch", "mode === 'auto' && !planning && !carriesAnnotations && isShowIntent", "mode === 'auto' && !planning && !carriesAnnotations && isProjectSwitchRequest", 'generalBrowserRequest || revealed || planning', '!generalBrowserRequest && !planning) await this.saveAgentMdIfPresent', 'openPrebuiltWorldForTurn({ text, worlds: profile?.worlds, token, proxyUrl, planning })']) assert.ok(host.includes(guard), guard);
  assert.ok(host.includes('this.planFirst.beginTurn(this.planTaskKey(), text)'));
});
