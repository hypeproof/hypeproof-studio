// REQ-STUDIO-MEMORY-REMEMBER-TOOL (CGP-KNOW-R-027 / D-027) — the coach's `remember` tool end to end on real files: both
// runtimes' transports, the real provider (file + timeline line + undo + persisted undone state), class refusal, path
// traversal and oversize refusals, and a minor seat on a personal activity.
//   node --experimental-strip-types test/memory-remember-tool.smoke.mjs
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTaskHarness } from './task-workspace-harness.mjs';
import { runRemember, localRememberTools, MEMORY_NOTE_MAX, MEMORY_REMEMBER_TURN_CAP, MCP_MEMORY_REMEMBER, REMEMBER_REPLIES, REMEMBER_DESCRIPTION } from '../src/memoryRememberTool.ts';
import { evaluateSdkToolUse, isClassifiedSdkToolName } from '../src/sdkCoachHelpers.ts';
import { MemoryWriteLedger } from '../src/memoryWrite.ts';
import { ActivityMemory, MEMORY_LIMITS } from '../src/activityMemory.ts';
import { MEMORY_WRITE_COPY } from '../src/memoryWriteLine.ts';

const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-remember-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const files = root => (fs.existsSync(memDir(root)) ? fs.readdirSync(memDir(root)).sort() : []);
const text = r => r.content.map(c => c.text).join('\n');

const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' } };
const PERSONAL = { profile_id: 'synthetic-personal', activity_kind: 'personal', activity_id: 'act-1', ux, game: { template_tier: 'website' } };
const MINOR = { ...PERSONAL, profile_id: 'synthetic-minor', minor_cohort: true, game: { template_tier: 'kids-rich' } };
const CLASSROOM = { ...PERSONAL, profile_id: 'synthetic-class', activity_kind: 'classroom' };

let bundleDir;
try {
  // The Agent SDK runtime, bundled as the shipping code is (the vscode module stubbed).
  bundleDir = fs.mkdtempSync(path.join(top, 'sdk-'));
  const out = path.join(bundleDir, 'sdk.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('../src/sdkCoach.ts', import.meta.url))], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['@anthropic-ai/claude-agent-sdk', 'zod'], plugins: [{ name: 'vscode-stub', setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports={window:{},workspace:{},Uri:{file:(p)=>({fsPath:p})}};', loader: 'js' })); } }] });
  const { runSdkCoach } = createRequire(import.meta.url)(out);
  async function sdkTurn({ host, profile = PERSONAL, toolMode, approve = async () => true }) {
    let options;
    const sdk = { query: args => { options = args.options; return (async function* () { yield { type: 'result', subtype: 'success', is_error: false }; })(); }, tool: (name, description, schema, handler) => ({ name, description, handler }), createSdkMcpServer: s => s };
    await runSdkCoach({ sdk, zod: { string: () => ({}) }, binaryResolution: { available: true, reasons: [] }, gatewayUrl: 'http://127.0.0.1:1/v1', token: 'synthetic', model: 'synthetic', profile, systemPrompt: '', history: [], userText: 'synthetic', signal: new AbortController().signal, stallTimeoutMs: 0, onDelta: () => {}, requestApproval: approve, memoryRememberHost: host, toolMode });
    return options;
  }

  // ---- the tool's own input rules (no host involved) ----
  await t('oversized, empty, non-string and traversal inputs are refused before the host is called', async () => {
    let calls = 0;
    const host = { write: async () => { calls++; return { ok: true, item: 'x' }; } };
    for (const input of [{ note: 'ㄱ'.repeat(MEMORY_NOTE_MAX + 1) }, { note: '   ' }, { note: 5 }, null, 'note', { note: 'ok', item: '../../escape.md' }, { note: 'ok', item: '/etc/passwd' }, { note: 'ok', item: 'a/b.md' }, { note: 'ok', item: 7 }]) {
      const r = await runRemember(host, input);
      assert.equal(r.isError, true, JSON.stringify(input).slice(0, 40));
    }
    assert.equal(calls, 0);
    assert.equal(text(await runRemember(undefined, { note: 'x' })), REMEMBER_REPLIES.unavailable);
    assert.equal((await runRemember(host, { note: 'ㄱ'.repeat(MEMORY_NOTE_MAX) })).isError, undefined, 'exactly the cap is fine');
  });

  await t('the tool description carries the coach guidance (stated by the learner, nothing sensitive, undoable)', () => {
    assert.match(REMEMBER_DESCRIPTION, /stated themselves/);
    assert.match(REMEMBER_DESCRIPTION, /Never save sensitive personal data/);
    assert.match(REMEMBER_DESCRIPTION, /undo/);
  });

  // ---- the real provider ----
  const work = path.join(top, 'activity');
  fs.mkdirSync(work);
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  h.memoryWriteLedgers = new Map();
  h.turnTimelines = new Map();
  h.rememberedNames = new Map();
  h.rememberTurnWrites = new Map();
  h.cachedProfile = PERSONAL;
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  const logs = () => f.posts.filter(m => m.type === 'toolLog' && String(m.id).startsWith('memwrite-'));
  const results = () => f.posts.filter(m => m.type === 'memoryWriteResult');
  const press = id => f.handle(f.scoped({ type: 'memoryWriteUndo', id }));

  await t('coach calls remember: file in .hypeproof/memory, line in that turn, undo restores, undone state persists', async () => {
    const host = h.memoryRememberHostFor('turn-1');
    assert.ok(host);
    const r = await runRemember(host, { note: '발표는 짧게 하는 걸 좋아해요.' });
    assert.equal(r.isError, undefined);
    assert.equal(files(work).length, 1);
    assert.equal(fs.readFileSync(path.join(memDir(work), files(work)[0]), 'utf8').includes('발표는 짧게'), true);
    assert.equal(logs().length, 1);
    assert.equal(logs()[0].streamId, 'turn-1');
    assert.equal(logs()[0].label, '기억에 남겼어요: 발표는 짧게 하는 걸 좋아해요.');
    // The turn ends: its line is stored with the turn.
    const id = logs()[0].id;
    await h.appendHistory([{ id, role: 'tool', content: '', createdAt: Date.now(), tool: { icon: '🔖', label: logs()[0].label, state: 'done' } }]);
    await press(id);
    assert.equal(results().at(-1).state, 'undone');
    assert.deepEqual(files(work), []);
    const stored = h.getHistory().find(m => m.id === id);
    assert.equal(stored.tool.label, '되돌렸어요: 발표는 짧게 하는 걸 좋아해요.', 'a reload shows the undone line, not 되돌리기');
    await press(id);
    assert.equal(results().at(-1).notice, MEMORY_WRITE_COPY.unknown);
  });

  await t('an item named by the coach replaces that item; a name outside the store never reaches the disk', async () => {
    const host = h.memoryRememberHostFor('turn-2');
    await runRemember(host, { note: '이름은 민수예요.' });
    const [name] = files(work);
    const r = await runRemember(host, { note: '이름은 민수 대신 수민으로 불러 주세요.', item: name });
    assert.equal(r.isError, undefined);
    assert.equal(files(work).length, 1);
    assert.notEqual(files(work)[0], name);
    const outside = path.join(top, 'escape.md');
    const bad = await runRemember(host, { note: 'x', item: '../../../escape.md' });
    assert.equal(bad.isError, true);
    assert.equal(fs.existsSync(outside), false);
    assert.deepEqual(fs.readdirSync(top).filter(n => n.endsWith('.md')), []);
  });

  await t('a class activity has no tool, and a call after a switch to class refuses without writing', async () => {
    const before = files(work);
    const host = h.memoryRememberHostFor('turn-3');
    h.cachedProfile = CLASSROOM;
    assert.equal(h.memoryRememberHostFor('turn-3'), undefined, 'not offered');
    const r = await runRemember(host, { note: '수업 중 기억' });
    assert.equal(r.isError, true);
    assert.equal(text(r), REMEMBER_REPLIES.unavailable);
    assert.deepEqual(files(work), before);
    h.cachedProfile = PERSONAL;
    h._instructorMode = { isInstructor: true };
    assert.equal(h.memoryRememberHostFor('turn-3'), undefined, 'an instructor has none');
    h._instructorMode = { isInstructor: false };
  });

  await t('a minor seat on a personal activity writes and undoes', async () => {
    h.cachedProfile = MINOR;
    const host = h.memoryRememberHostFor('turn-4');
    assert.ok(host, 'minors are included (memory always on)');
    const before = files(work).length;
    const r = await runRemember(host, { note: '공룡 이야기를 좋아해요.' });
    assert.equal(r.isError, undefined);
    assert.equal(files(work).length, before + 1);
    const line = logs().at(-1);
    assert.equal(line.streamId, 'turn-4');
    await press(line.id);
    assert.equal(results().at(-1).state, 'undone');
    assert.equal(files(work).length, before);
    h.cachedProfile = PERSONAL;
  });

  await t('a "기록 없이 묻기" turn is not offered the tool and a late call writes nothing (REQ-KNOW-47)', async () => {
    const before = files(work);
    const logsBefore = logs().length;
    const host = h.memoryRememberHostFor('turn-5');
    assert.ok(host);
    h.temporaryStreams = new Set(['turn-5']);
    assert.equal(h.memoryRememberHostFor('turn-5'), undefined, 'not offered');
    const r = await runRemember(host, { note: '기록 없이 묻는 중' });
    assert.equal(r.isError, true);
    assert.equal(text(r), REMEMBER_REPLIES.unavailable);
    assert.equal(await h.recordTurnMemoryWrite('turn-5', 'x'), null, 'the entry itself refuses too');
    assert.deepEqual(files(work), before);
    assert.equal(logs().length, logsBefore);
    h.temporaryStreams = undefined;
    assert.ok(h.memoryRememberHostFor('turn-6'), 'an ordinary turn still has it');
  });

  await t('a read-only work folder is not offered the tool and a late call writes nothing', async () => {
    const before = files(work);
    const host = h.memoryRememberHostFor('turn-7');
    assert.ok(host);
    const proto = h.folderWriteRefusalFor;
    h.folderWriteRefusalFor = () => '이 폴더에는 쓸 수 없어요.';
    assert.equal(h.memoryRememberHostFor('turn-7'), undefined);
    assert.equal((await runRemember(host, { note: '읽기 전용 폴더' })).isError, true);
    assert.deepEqual(files(work), before);
    delete h.folderWriteRefusalFor;
    assert.equal(h.folderWriteRefusalFor, proto);
  });

  await t('a turn writes at most the cap; every write keeps an undo', async () => {
    const host = h.memoryRememberHostFor('turn-8');
    const before = files(work).length;
    for (let i = 0; i < MEMORY_REMEMBER_TURN_CAP; i++) assert.equal((await runRemember(host, { note: `기억 ${i}` })).isError, undefined);
    const over = await runRemember(host, { note: '넘치는 기억' });
    assert.equal(over.isError, true);
    assert.equal(text(over), REMEMBER_REPLIES.limit);
    assert.equal(files(work).length, before + MEMORY_REMEMBER_TURN_CAP);
    assert.equal((await runRemember(h.memoryRememberHostFor('turn-9'), { note: '다음 턴은 다시 쓸 수 있어요' })).isError, undefined);
  });

  await t('parallel calls in one turn cannot pass the cap: exactly the cap is written, the rest are refused, every write is undoable', async () => {
    const host = h.memoryRememberHostFor('turn-par');
    const before = files(work).length;
    const logsBefore = logs().length;
    const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => runRemember(host, { note: `동시 기억 ${i}` })));
    const saved = replies.filter(r => !r.isError);
    const refused = replies.filter(r => r.isError);
    assert.equal(saved.length, MEMORY_REMEMBER_TURN_CAP);
    assert.equal(refused.length, 12 - MEMORY_REMEMBER_TURN_CAP);
    for (const r of refused) assert.equal(text(r), REMEMBER_REPLIES.limit, 'calm refusal, no retry');
    assert.equal(files(work).length, before + MEMORY_REMEMBER_TURN_CAP);
    const lines = logs().slice(logsBefore);
    assert.equal(lines.length, MEMORY_REMEMBER_TURN_CAP);
    for (const line of lines) {
      assert.equal(line.streamId, 'turn-par');
      await press(line.id);
      assert.equal(results().at(-1).state, 'undone');
    }
    assert.equal(files(work).length, before);
    // A refused write gives its slot back: a failed call does not eat the cap.
    const again = h.memoryRememberHostFor('turn-par-2');
    h.temporaryStreams = new Set(['turn-par-2']);
    assert.equal((await runRemember(again, { note: '기록 없이' })).isError, true);
    h.temporaryStreams = undefined;
    for (let i = 0; i < MEMORY_REMEMBER_TURN_CAP; i++) assert.equal((await runRemember(again, { note: `다시 ${i}` })).isError, undefined, 'slot was released');
    assert.equal((await runRemember(again, { note: '넘침' })).isError, true);
  });

  await t('a read-only folder through the REAL consent guard: not offered, a late call is refused with no write', async () => {
    const readOnly = path.join(top, 'ro-folder');
    const home = path.join(top, 'served-home');
    fs.mkdirSync(readOnly); fs.mkdirSync(home);
    const ro = fs.realpathSync(readOnly);
    const savedFolders = f.vscode.workspace.workspaceFolders;
    const savedRoot = h.servedWorkspaceRoot;
    const savedCwd = h.resolveCoachCwd;
    const consent = new Map();
    const hadOwn = Object.prototype.hasOwnProperty.call(h.context, 'globalState');
    const savedGlobal = h.context.globalState;
    h.context.globalState = { get: key => consent.get(key), update: async (key, value) => { consent.set(key, value); } };
    try {
      f.vscode.workspace.workspaceFolders = [{ uri: { fsPath: ro, scheme: 'file' } }];
      h.servedWorkspaceRoot = home;
      h.resolveCoachCwd = () => ro;
      // The shipping guard is untouched: it must be the prototype's own method.
      assert.equal(Object.prototype.hasOwnProperty.call(h, 'folderWriteRefusalFor'), false);
      consent.set('hps.folderConsent.v1', { [f.activity.id]: { [ro]: { level: 'read', at: 1 } } });
      assert.ok(h.folderWriteRefusalFor(path.join(ro, '.hypeproof', 'memory')), 'the real guard says read-only');
      assert.equal(h.memoryRememberHostFor('turn-ro'), undefined, 'not offered');
      // A host made while the folder was writable, then the learner chose read-only.
      consent.set('hps.folderConsent.v1', { [f.activity.id]: { [ro]: { level: 'full', at: 2 } } });
      const host = h.memoryRememberHostFor('turn-ro-2');
      assert.ok(host, 'offered where the folder may be written');
      consent.set('hps.folderConsent.v1', { [f.activity.id]: { [ro]: { level: 'read', at: 3 } } });
      const logsBefore = logs().length;
      const r = await runRemember(host, { note: '읽기 전용으로 바꾼 뒤' });
      assert.equal(r.isError, true);
      assert.equal(text(r), REMEMBER_REPLIES.unavailable);
      assert.equal(files(ro).length, 0);
      assert.equal(fs.existsSync(memDir(ro)), false, 'no store directory was created');
      assert.equal(logs().length, logsBefore);
      assert.equal(await h.recordTurnMemoryWrite('turn-ro-2', 'x'), null, 'the entry itself refuses too');
    } finally {
      f.vscode.workspace.workspaceFolders = savedFolders;
      h.servedWorkspaceRoot = savedRoot;
      h.resolveCoachCwd = savedCwd;
      if (hadOwn) h.context.globalState = savedGlobal; else delete h.context.globalState;
    }
  });

  await t('the coach cannot replace an item the learner wrote or one from another scope', async () => {
    const learner = await new ActivityMemory(work).append('학생이 직접 쓴 기억');
    const host = h.memoryRememberHostFor('turn-10');
    const r = await runRemember(host, { note: '코치가 덮어쓰기', item: learner });
    assert.equal(r.isError, true);
    assert.equal(fs.readFileSync(path.join(memDir(work), learner), 'utf8').includes('학생이 직접'), true);
  });

  await t('a switch to another folder after the host was made refuses', async () => {
    const other = path.join(top, 'other');
    fs.mkdirSync(other);
    const host = h.memoryRememberHostFor('turn-11');
    const before = files(work);
    const saved = h.resolveCoachCwd;
    Object.defineProperty(h, 'activityMemoryBinding', { configurable: true, get: () => ({ root: other, scope: 'other-scope' }) });
    const r = await runRemember(host, { note: '다른 폴더' });
    delete h.activityMemoryBinding;
    h.resolveCoachCwd = saved;
    assert.equal(r.isError, true);
    assert.deepEqual(files(work), before);
    assert.deepEqual(files(other), []);
  });

  // ---- the Agent SDK runtime ----
  await t('SDK runtime: registered only with a host in a tools turn; approval is the work-folder write path', async () => {
    const host = { write: async (note) => ({ ok: true, item: note }) };
    const opts = await sdkTurn({ host });
    assert.ok(opts.mcpServers.hypeproof_memory);
    const tool = opts.mcpServers.hypeproof_memory.tools.find(x => x.name === 'remember');
    assert.ok(tool);
    assert.equal((await tool.handler({ note: '좋아하는 색은 초록' })).isError, undefined);
    let asked = null;
    const minorOpts = await sdkTurn({ host, profile: MINOR, approve: async a => { asked = a; return true; } });
    const verdict = await minorOpts.canUseTool(MCP_MEMORY_REMEMBER, { note: 'x' }, { signal: new AbortController().signal, toolUseID: 't1' });
    assert.equal(verdict.behavior, 'allow');
    assert.equal(asked.toolName, MCP_MEMORY_REMEMBER, 'the approval gate (preset) sees it');
    assert.equal((await sdkTurn({ host: undefined })).mcpServers?.hypeproof_memory, undefined);
    assert.equal((await sdkTurn({ host, toolMode: 'web-search', profile: { ...PERSONAL, tools: { web_search: true } } })).mcpServers?.hypeproof_memory, undefined, 'a web-only turn has no memory tool');
    const denied = await (await sdkTurn({ host: undefined })).canUseTool(MCP_MEMORY_REMEMBER, { note: 'x' }, { signal: new AbortController().signal, toolUseID: 't2' });
    assert.equal(denied.behavior, 'deny', 'ungranted name fails closed');
  });

  await t('policy: classified, ask only when granted, denied when not', () => {
    assert.equal(isClassifiedSdkToolName(MCP_MEMORY_REMEMBER), true);
    assert.equal(evaluateSdkToolUse({ toolName: MCP_MEMORY_REMEMBER, input: {}, permittedTools: [] }).decision, 'deny');
    assert.equal(evaluateSdkToolUse({ toolName: MCP_MEMORY_REMEMBER, input: {}, permittedTools: [MCP_MEMORY_REMEMBER] }).decision, 'ask');
    assert.equal(evaluateSdkToolUse({ toolName: MCP_MEMORY_REMEMBER, input: {}, permittedTools: [MCP_MEMORY_REMEMBER], minor: true, approvalPreset: 'always_ask' }).decision, 'ask');
  });

  // ---- the local runtime ----
  await t('local runtime: definition + call go through the approval gate, a denial writes nothing', async () => {
    let writes = 0;
    const host = { write: async (note) => { writes++; return { ok: true, item: note }; } };
    const none = localRememberTools(undefined, async () => true);
    assert.deepEqual(none.definitions, []);
    const denied = localRememberTools(host, async () => false);
    assert.equal(denied.definitions[0].name, 'remember');
    await assert.rejects(denied.call('remember', { note: '메모' }));
    assert.equal(writes, 0);
    const ok = localRememberTools(host, async name => name === MCP_MEMORY_REMEMBER);
    assert.equal(await ok.call('remember', { note: '메모' }), REMEMBER_REPLIES.saved);
    assert.equal(writes, 1);
    await assert.rejects(ok.call('remember', { note: 'ㄱ'.repeat(MEMORY_NOTE_MAX + 1) }));
    assert.equal(writes, 1);
  });

  // ---- #3596 follow-up (a): a replaced file larger than the restore cap ----
  await t('replacing a file above the restore cap is refused up front and nothing changes', async () => {
    const root = path.join(top, 'big');
    fs.mkdirSync(root);
    const store = new ActivityMemory(root);
    const ledger = new MemoryWriteLedger(store, () => 'x' + Math.random().toString(36).slice(2, 8));
    const name = await store.append('작은 기억');
    const file = path.join(memDir(root), name);
    fs.writeFileSync(file, 'a'.repeat(MEMORY_LIMITS.bytes + 1));
    const before = files(root);
    await assert.rejects(ledger.write('새 기억', { replacing: name }));
    assert.deepEqual(files(root), before);
    assert.equal(fs.statSync(file).size, MEMORY_LIMITS.bytes + 1);
    // Exactly the cap is still undoable, byte for byte.
    fs.writeFileSync(file, 'b'.repeat(MEMORY_LIMITS.bytes));
    const receipt = await ledger.write('새 기억', { replacing: name });
    assert.equal((await ledger.undo(receipt.id)).ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'b'.repeat(MEMORY_LIMITS.bytes));
  });
} finally { fs.rmSync(top, { recursive: true, force: true }); }
console.log(`memory-remember-tool smoke: ${passed} passed`);
