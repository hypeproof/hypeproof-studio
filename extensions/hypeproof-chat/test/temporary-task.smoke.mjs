// CGP-KNOW-R-029 (REQ-KNOW-47) — "기록 없이 묻기": a task this computer keeps in memory only, on adult personal seats.
//   1. the store: a temporary task is never written (task file and every sidecar byte-identical), reads and writes its
//      transcript, draft and verdicts in memory, refuses rename, appearance, archive, move and recovery, is dropped by a
//      switch, a new task or 다시 열기, and a fresh read of the store (a restart) never sees it;
//   2. the seat gate (the real provider and real disk store): an adult personal seat may open one; class, lesson, minor,
//      unknown-tier, no-profile, instructor and trial seats (adult tier included: the lead's ruling) may not (fail
//      closed), and the press is refused with the reason;
//   3. the turn sweep (the real provider with a scripted model runtime, the real task store, a real on-disk session spool
//      and recorded workspaceState/globalState): a unique marker sent and answered in a temporary task, with memory read
//      (DEC-02) and its "기억 사용 N" ledger used, a draft and a verdict, is afterwards in no file under globalStorage, the
//      spool, the activity folder, the scratch TMPDIR, ~/.claude, and no workspaceState/globalState value; nor is the
//      temporary task's id (records that keep digests, not words, still name their task); the agent-sdk
//      turn runs with `ephemeralSession` (persistSession:false: memory-use-sdk.smoke.mjs proves the real CLI then writes
//      no session file) and with write, shell, browser and subagent tools dropped. The temporary task is the seat's FIRST
//      turn (a one-time record such as the accuracy-education offer is its to claim), no file under globalStorage, the
//      spool or the activity folder is created or changed while it is open (hashed keys: turn-restore points), and a
//      profile serving `observation` with a recording recorder records nothing. The same steps in an ordinary task
//      afterwards (control) leave the marker in the task file, the spool and the observation record;
//   4. photos: a temporary turn takes none (they would be saved into the work folder) and returns them with the reason;
//   5. writes: on a folder with access "full", an answer carrying a ```html fence, a <!doctype html> page or a ```js fence
//      leaves the work folder byte-identical (the host refuses every folder write for the temporary turn); the same
//      answer in an ordinary task writes it (control).
//   node --experimental-strip-types test/temporary-task.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { TaskWorkspaceStore, TEMPORARY_TASK_REFUSAL, TEMPORARY_TASK_TITLE } from '../src/taskWorkspaceStore.ts';
import { TEMPORARY_TASK_NO_IMAGES, TEMPORARY_TASK_NO_WRITE, TEMPORARY_TASK_UNAVAILABLE, temporaryTaskProfile } from '../src/temporaryTask.ts';
import { MEMORY_NOTICE_KEY } from '../src/memoryNotice.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const extension = fileURLToPath(new URL('..', import.meta.url));
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'temporary-task-')));
const started = Date.now() - 1000;
const VERDICT = 'right';
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const files = dir => { const out = []; const walk = d => { let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of entries) { const f = path.join(d, e.name); if (e.isDirectory() && !e.isSymbolicLink()) walk(f); else if (e.isFile()) out.push(f); } }; walk(dir); return out; };
const snapshot = dir => Object.fromEntries(files(dir).map(f => [path.relative(dir, f), fs.readFileSync(f, 'utf8')]));
// Every path (folders included) under a store whose name contains the marker: a task id used as a folder name is a trace.
const names = (dir, marker) => { const out = []; const walk = d => { let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of entries) { const f = path.join(d, e.name); if (e.name.includes(marker)) out.push(f); if (e.isDirectory() && !e.isSymbolicLink()) walk(f); } }; walk(dir); return out; };
const hits = (dir, marker, since = 0) => files(dir).filter(f => { try { const st = fs.statSync(f); return st.mtimeMs >= since && st.size < 8_000_000 && fs.readFileSync(f).includes(marker); } catch { return false; } });

try {
  await t('store: a temporary task lives in memory only and is never written', async () => {
    const root = fs.mkdtempSync(path.join(top, 'store-'));
    const store = new TaskWorkspaceStore(root, 'scope-a');
    await store.initialize();
    const base = store.getView();
    await store.append(base.activeTaskId, [{ id: 'u0', role: 'user', content: '보통 작업', createdAt: 1 }]);
    const before = snapshot(root);
    const view = await store.createTemporary({ taskId: store.getView().activeTaskId, revision: store.getView().revision });
    assert.ok(view.temporaryTaskId && view.activeTaskId === view.temporaryTaskId, 'the temporary task is open');
    assert.equal(view.tasks[0].id, view.temporaryTaskId); assert.equal(view.tasks[0].title, TEMPORARY_TASK_TITLE);
    const id = view.activeTaskId;
    await store.append(id, [{ id: 'u1', role: 'user', content: '비밀 질문', createdAt: 2 }, { id: 'a1', role: 'assistant', content: '비밀 답', createdAt: 3 }]);
    await store.saveDraft(id, { text: '비밀 초안', images: [], queued: null });
    const verdicts = await store.recordVerdict(id, { messageId: 'a1', verdict: VERDICT, at: 4 });
    assert.equal(Object.keys(verdicts).length, 1);
    assert.deepEqual(store.getHistory().map(m => m.content), ['비밀 질문', '비밀 답']);
    assert.equal(store.getDraft().text, '비밀 초안');
    assert.equal(store.getView().tasks[0].messageCount, 2);
    for (const [label, call] of [['rename', () => store.rename(id, '이름')], ['appearance', () => store.setAppearance(id, null)], ['archive', () => store.archiveTask(id, { taskId: id, revision: base.revision })],
      ['recover', () => store.recoverDraft(id, { text: 'x', images: [], queued: null })], ['surface', () => store.saveSurface(id, null)], ['release', () => store.releaseTask(id, { taskId: id, revision: base.revision })]])
      await assert.rejects(call(), error => error.message === TEMPORARY_TASK_REFUSAL, label);
    assert.throws(() => store.exportTask(id), error => error.message === TEMPORARY_TASK_REFUSAL);
    assert.deepEqual(snapshot(root), before, 'the task file and every sidecar are byte-identical');
    assert.equal(store.reread().getView().temporaryTaskId, undefined, 'a fresh read (a restart) never sees it');
    assert.ok(!JSON.stringify(store.search('비밀')).includes('비밀'), 'search does not find it');
    // Leaving it (a switch back to the task underneath) drops it.
    await store.select(base.activeTaskId, { taskId: id, revision: store.getView().revision });
    assert.equal(store.getView().temporaryTaskId, undefined); assert.equal(store.getView().activeTaskId, base.activeTaskId);
    assert.equal(store.getTask(id), undefined, 'gone');
    assert.deepEqual(store.getHistory().map(m => m.content), ['보통 작업']);
    // A new task and 새 작업 from a temporary one also drop it.
    await store.createTemporary({ taskId: base.activeTaskId, revision: store.getView().revision });
    await store.create('새 작업', { taskId: store.getView().activeTaskId, revision: store.getView().revision });
    assert.equal(store.getView().temporaryTaskId, undefined);
    assert.ok(!JSON.stringify(snapshot(root)).includes('비밀'), 'nothing of it reached the disk');
  });

  await t('profile: a temporary turn is chat only (read at most), browser control off, no orchestrator, no observation', async () => {
    const p = { profile_id: 'x', sdk_tools: { read: true, write: true, shell: true, browser: true, subagents: true }, browser_control: { enabled: true }, orchestrator: { enabled: false, reason: 'x' }, observation: { format: 'hps-observation/1' }, game: { template_tier: 'website' } };
    assert.deepEqual(temporaryTaskProfile(p), { profile_id: 'x', sdk_tools: { read: true }, browser_control: { enabled: false }, game: { template_tier: 'website' } });
    assert.equal(temporaryTaskProfile({ profile_id: 'y', sdk_tools: { write: true } }).sdk_tools, undefined);
  });

  await t('seat gate: only an adult personal seat may open one; every other seat is refused with the reason', async () => {
    const adult = { profile_id: 'adult', game: { template_tier: 'website' } };
    for (const [label, profile, instructor, expected, kind] of [
      ['adult personal', adult, false, true],
      ['minor cohort', { ...adult, minor_cohort: true }, false, false],
      ['kids tier', { profile_id: 'kids', game: { template_tier: 'kids-quest' } }, false, false],
      ['unknown tier', { profile_id: 'unknown' }, false, false],
      ['no profile', null, false, false],
      ['lesson', { ...adult, lesson: { sha256: 'x', content: { steps: [] } } }, false, false],
      ['instructor', adult, true, false],
      // The lead's ruling (2026-11-02): personal activities only; a trial seat is refused even with an adult tier.
      ['trial activity, adult tier', { ...adult, activity_kind: 'trial' }, false, false, 'trial'],
      ['personal record, served as trial', { ...adult, activity_kind: 'trial' }, false, false],
      ['served as personal', { ...adult, activity_kind: 'personal' }, false, true],
    ]) {
      const f = await createTaskHarness(fs.mkdtempSync(path.join(top, 'seat-')), () => {}, { profile });
      if (kind) f.activity.kind = kind;
      f.h.cachedProfile = profile;
      f.h._instructorMode = { isInstructor: instructor };
      assert.equal(f.h.temporaryTaskAllowed(), expected, label);
      f.h.setConnectionChanging = async () => {}; f.h.retryInterruptedHistory = async () => {}; f.h.postHistory = async () => {};
      await f.handle(f.scoped({ type: 'taskCreateTemporary' }));
      if (expected) assert.ok(f.store.getView().temporaryTaskId, `${label}: opened`);
      else {
        assert.equal(f.store.getView().temporaryTaskId, undefined, `${label}: not opened`);
        assert.equal(f.posts.filter(m => m.type === 'taskWorkspaceError').at(-1)?.error, TEMPORARY_TASK_UNAVAILABLE, `${label}: told why`);
      }
    }
  });

  // The real provider with a scripted model runtime (memory-use.smoke.mjs), but the real task store, the real
  // appendHistory/getHistory and a real on-disk spool.
  const turnBundle = await build({
    stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export { FOLDER_CONSENT_KEY } from './src/folderConsent'; export { SessionSpool } from './src/sessionSpool'; export { TaskWorkspaceStore } from './src/taskWorkspaceStore';", resolveDir: extension, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent',
    plugins: [{ name: 'scripted-runtime', setup(b) {
      const swap = { './proxyClient': 'proxy', './activityConnections': 'connections', './sdkCoach': 'sdk' };
      b.onResolve({ filter: /^\.\/(proxyClient|activityConnections|sdkCoach)$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: swap[args.path], namespace: 'runtime' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'runtime' }, args => ({ loader: 'ts', resolveDir: extension, contents: args.path === 'proxy'
        ? `export * from ${JSON.stringify(path.join(extension, 'src/proxyClient.ts'))}; export const proxyChat=(a)=>globalThis.runtime.proxy(a); export const verifyActivity=async()=>{};`
        : args.path === 'sdk'
        ? `export * from ${JSON.stringify(path.join(extension, 'src/sdkCoach.ts'))}; export const runSdkCoach=(a)=>globalThis.runtime.sdk(a);`
        : `export * from ${JSON.stringify(path.join(extension, 'src/activityConnections.ts'))}; export const activityConnections=()=>globalThis.runtime.connections;` }));
    } }],
  });
  const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' } };
  const ADULT = { profile_id: 'synthetic-adult', activity_kind: 'personal', activity_id: 'act-1', ux, game: { template_tier: 'website' }, analytics: { upload_session_logs: true },
    sdk_tools: { read: true, write: true, shell: true, browser: true, subagents: true } };

  // `memory: false` — an empty memory folder, so no turn carries memory and only the temporary task can ask for
  // persistSession:false (a memory-carrying turn already does, R-026).
  // `observation: true` — the served profile carries `observation`, and prepareObservation hands out a recorder that
  // really records (into workspaceState, as persistObservation does): not a null stub.
  // `access` — the folder consent level; `answer` — the scripted model's reply to the learner's text.
  const seat = (runtimeName, { memory = true, observation = false, access = 'read', answer = text => `답: ${text}` } = {}) => {
    const root = fs.mkdtempSync(path.join(top, 'turn-'));
    const storage = fs.mkdtempSync(path.join(top, 'storage-'));
    const spoolRoot = fs.mkdtempSync(path.join(top, 'spool-'));
    const scratchTmp = fs.mkdtempSync(path.join(top, 'tmp-'));
    fs.mkdirSync(path.join(root, '.hypeproof', 'memory'), { recursive: true });
    if (memory) fs.writeFileSync(path.join(root, '.hypeproof', 'memory', 'a-color.md'), '좋아하는 색은 초록이에요.');
    const calls = [], posts = [], state = new Map(), global = new Map(), sdkCalls = [];
    const connections = { scope: 'a1', current: { service: 'http://127.0.0.1:1/v1', serverId: 'srv', kind: 'personal' }, token: async () => 'synthetic-token', acquire: () => () => {} };
    const runtime = { connections,
      proxy: async a => { calls.push(JSON.stringify(a)); const text = answer(a.userText ?? ''); a.onDelta?.(text); return { text, toolUses: [] }; },
      sdk: async a => { sdkCalls.push(a); calls.push(JSON.stringify({ userText: a.userText })); const text = answer(a.userText ?? ''); a.onDelta?.(text); return {}; } };
    const vscode = {
      env: { appName: 'HypeProof Studio' },
      workspace: { createFileSystemWatcher: () => ({ onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }), onDidChange: () => ({ dispose() {} }), dispose() {} }),
        workspaceFolders: [{ uri: { fsPath: root } }],
        fs: { writeFile: async (uri, bytes) => fs.promises.writeFile(uri.fsPath, bytes), createDirectory: async uri => fs.promises.mkdir(uri.fsPath, { recursive: true }), readFile: async uri => fs.promises.readFile(uri.fsPath), stat: async uri => fs.promises.stat(uri.fsPath) },
        getConfiguration: () => ({ get: (k, d) => ({ coachRuntime: runtimeName, proxyUrl: 'http://127.0.0.1:1/v1' })[k] ?? d }) },
      window: { createOutputChannel: () => ({ appendLine() {} }), showOpenDialog: async () => undefined, showWarningMessage: async () => undefined, showInformationMessage: async () => undefined },
      commands: { executeCommand: async () => undefined },
      RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
      Uri: { file: fsPath => ({ fsPath }), joinPath: (u, ...n) => ({ fsPath: path.join(u.fsPath, ...n) }) },
      ProgressLocation: { Window: 10 },
    };
    const module = { exports: {} };
    vm.runInNewContext(turnBundle.outputFiles[0].text, {
      module, exports: module.exports, runtime, console, process: { ...process, env: { PATH: process.env.PATH, TMPDIR: scratchTmp } },
      require: id => id === 'vscode' ? vscode : require(id),
      Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval, performance, structuredClone,
      fetch: async () => { throw new Error('Network is forbidden in this test'); },
    });
    const { ChatPanelProvider, FOLDER_CONSENT_KEY, SessionSpool, TaskWorkspaceStore: Store } = module.exports;
    const spool = new SessionSpool({ root: spoolRoot, appVersion: 'test', os: { platform: process.platform, release: 'test', arch: process.arch } });
    const store = new Store(storage, 'a1');
    const recorder = () => { const events = []; const batch = { format: 'hps-observation/1', scope: 'obs', program: 'prog', events }; return { batch, missing: [], record: (id, kind, value) => events.push({ id, kind, value }), snapshot: () => JSON.parse(JSON.stringify(batch)) }; };
    const servedProfile = observation ? { ...ADULT, observation: { format: 'hps-observation/1' } } : ADULT;
    const p = Object.create(ChatPanelProvider.prototype);
    const copy = v => JSON.parse(JSON.stringify(v));
    Object.assign(p, {
      context: { globalStorageUri: { fsPath: storage }, workspaceState: { get: (k, d) => state.get(k) ?? d, update: async (k, v) => state.set(k, copy(v)) }, globalState: { get: k => global.get(k), update: async (k, v) => global.set(k, copy(v)) }, secrets: { get: async () => 'synthetic-token' }, subscriptions: [] },
      taskWorkspace: { activityId: 'a1', store }, draftWrites: Promise.resolve(), denialWrites: Promise.resolve(), taskChanging: false, connectionChanging: false,
      pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
      _instructorMode: { isInstructor: false, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: servedProfile, accessState: null, servedWorkspaceRoot: null,
      post: async m => { posts.push(copy(m)); }, postConfig: async () => {}, getCoach: () => ({ name: '코치', personality: '', configured: true }),
      ensureProfile: async () => servedProfile, loadAccess: async () => {}, observationWrites: Promise.resolve(),
      pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
      isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
      prepareObservation: async (_url, _token, served) => served?.observation ? recorder() : null, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: '' }), commitAttachedImages: () => '',
      resolveCoachCwd: () => root, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
      buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
      provenanceRecorder: () => null, spool, maybeOfferSdkSeed: async () => {},
    });
    global.set(FOLDER_CONSENT_KEY, { 'act-1': { [root]: { level: access, at: 1 } } });
    state.set(MEMORY_NOTICE_KEY, { a1: true });
    const settle = () => new Promise(resolve => setTimeout(resolve, 30));
    let n = 0;
    return {
      p, store, root, storage, spoolRoot, scratchTmp, state, global, posts, calls, sdkCalls, spool,
      init: () => store.initialize(),
      send: async text => { await p.handleMessage({ type: 'sendMessage', activityId: 'a1', taskId: store.getView().activeTaskId, text, history: [], toolMode: 'auto', userMessageId: `u-${randomUUID().slice(0, 8)}-${++n}` }); await settle(); },
      draft: async text => { await p.handleMessage({ type: 'saveActivityDraft', activityId: 'a1', taskId: store.getView().activeTaskId, draft: { text, images: [], queued: null } }); await settle(); },
      verdict: async messageId => { await p.handleMessage({ type: 'answerVerdict', activityId: 'a1', taskId: store.getView().activeTaskId, messageId, verdict: VERDICT }); await settle(); },
      ask: async messageId => { await p.handleMessage({ type: 'memoryUseRequest', activityId: 'a1', taskId: store.getView().activeTaskId, requestId: `r${posts.length}`, messageId }); await settle(); return posts.filter(m => m.type === 'memoryUseItems').at(-1); },
      answers: () => store.getHistory().filter(m => m.role === 'assistant').map(m => m.id),
    };
  };
  const sweep = async (run, marker) => {
    try { await run.spool.seal?.(); } catch { /* nothing open to seal */ }
    const found = [];
    for (const [label, dir] of [['globalStorage', run.storage], ['spool', run.spoolRoot], ['activity folder', run.root], ['TMPDIR (scratch)', run.scratchTmp]]) {
      for (const f of hits(dir, marker)) found.push(`${label}: ${path.relative(dir, f)}`);
      for (const f of names(dir, marker)) found.push(`${label} (a path named after it): ${path.relative(dir, f)}`);
    }
    for (const f of hits(fs.realpathSync(os.tmpdir()), marker, started)) if (!f.startsWith(top)) found.push(`TMPDIR: ${f}`);
    const claude = path.join(os.homedir(), '.claude');
    if (fs.existsSync(claude)) for (const f of hits(claude, marker, started)) found.push(`~/.claude: ${f}`);
    for (const [key, value] of run.state) if (JSON.stringify(value ?? null).includes(marker)) found.push(`workspaceState: ${key}`);
    for (const [key, value] of run.global) if (JSON.stringify(value ?? null).includes(marker)) found.push(`globalState: ${key}`);
    return found;
  };

  // Every file under the stores, with its mtime: a record the sweep cannot read by marker or id (a hashed key) still
  // shows up as a file created or changed while the temporary task was open.
  const stamp = run => Object.fromEntries([run.storage, run.spoolRoot, run.root].flatMap(dir => files(dir).map(f => [f, fs.statSync(f).mtimeMs])));
  const changed = (before, after) => Object.keys(after).filter(f => before[f] !== after[f]).map(f => path.relative(top, f));

  for (const [label, runtimeName, opts] of [['proxy', 'proxy', { memory: true }], ['agent-sdk', 'agent-sdk', { memory: false }], ['proxy, observation profile', 'proxy', { memory: false, observation: true }]]) {
    await t(`sweep (${label}): the temporary task as the seat's FIRST turn leaves nothing; an ordinary task afterwards does (control)`, async () => {
      const run = seat(runtimeName, opts);
      await run.init();
      // The temporary task comes first on a fresh seat, so any one-time record (the accuracy-education offer) is its to claim.
      const under = run.store.getView();
      const before = stamp(run);
      await run.store.createTemporary({ taskId: under.activeTaskId, revision: under.revision });
      const temporaryId = run.store.getView().activeTaskId;
      const marker = `MARK-TEMP-${randomUUID()}`;
      await run.send(`${marker} 비밀 질문`);
      assert.ok(run.calls.at(-1).includes(marker), 'the request reached the model');
      const [answer] = run.answers();
      assert.ok(answer && run.store.getHistory().some(m => m.content.includes(marker)), 'the conversation is there while the task is open');
      if (opts.memory) {
        assert.ok(run.calls.at(-1).includes('초록'), 'memory was read (DEC-02: memory stays on)');
        const marks = run.posts.filter(m => m.type === 'memoryUseMarks').at(-1)?.marks ?? {};
        assert.equal(marks[answer], 1, '기억 사용 1 on the answer (the ledger in memory)');
        assert.equal((await run.ask(answer)).items?.length, 1, 'the chip lists the item');
      }
      if (runtimeName === 'agent-sdk') {
        const args = run.sdkCalls.at(-1);
        assert.equal(args.memoryContext, undefined, 'control: this turn carried no memory');
        assert.equal(args.ephemeralSession, true, 'persistSession:false for the agent-sdk turn');
        const granted = Object.entries(args.profile?.sdk_tools ?? {}).filter(([, on]) => on).map(([name]) => name);
        assert.equal(JSON.stringify(granted), JSON.stringify(['read']), `chat only: write, shell, browser and subagents dropped (${granted})`);
        assert.equal(args.profile?.browser_control?.enabled ?? false, false, 'browser control off');
        assert.equal(args.profile?.observation, undefined, 'no observation');
      }
      await run.draft(`${marker} 비밀 초안`);
      await run.verdict(answer);
      // Leave it: back to the task underneath.
      await run.store.select(under.activeTaskId, { taskId: temporaryId, revision: run.store.getView().revision });
      assert.equal(run.store.getView().temporaryTaskId, undefined);
      const found = await sweep(run, marker);
      assert.deepEqual(found, [], `the marker is nowhere: ${found.join(', ')}`);
      // Records that hold no words (the 기억 사용 ledger keeps digests, per-task keys) still name the task: its id is nowhere either.
      const named = await sweep(run, temporaryId);
      assert.deepEqual(named, [], `the temporary task's id is nowhere: ${named.join(', ')}`);
      // And no file under globalStorage, the spool or the activity folder was created or changed meanwhile (a hashed
      // key: turn-restore points, the accuracy-education offer).
      const touched = changed(before, stamp(run));
      assert.deepEqual(touched, [], `no file written while the temporary task was open: ${touched.join(', ')}`);
      // Control: the same seat, an ordinary task, afterwards. The instruments see its marker.
      const kept = `MARK-KEEP-${randomUUID()}`;
      await run.send(`${kept} 질문`);
      await run.draft(`${kept} 초안`);
      const control = await sweep(run, kept);
      assert.ok(control.some(h => h.startsWith('globalStorage: task-workspaces')), `control: the task file holds the marker (${control})`);
      assert.ok(control.some(h => h.startsWith('spool')), `control: the spool holds the marker (${control})`);
      if (opts.observation) assert.ok(control.some(h => h.startsWith('workspaceState: hps.observation.')), `control: the observation recorder records an ordinary turn (${control})`);
      if (runtimeName === 'agent-sdk') assert.equal(run.sdkCalls.at(-1).ephemeralSession, undefined, 'control: the ordinary task\'s turn keeps its session file');
      assert.ok(changed(before, stamp(run)).length > 0, 'control: the ordinary turn writes files');
    });
  }

  // The work folder, byte for byte (hidden folders such as .hypeproof/history included).
  const folderBytes = dir => Object.fromEntries(files(dir).map(f => [path.relative(dir, f), fs.readFileSync(f).toString('base64')]));
  const PAGES = {
    'html fence': m => `여기 페이지예요.\n\n\`\`\`html\n<!doctype html><html><head><title>${m}</title></head><body><h1>${m}</h1></body></html>\n\`\`\``,
    'doctype page': m => `<!doctype html>\n<html><head><title>${m}</title></head><body><p>${m}</p></body></html>`,
    'js fence': m => `게임 코드예요.\n\n\`\`\`js\nconst title = ${JSON.stringify(m)};\ndocument.body.textContent = title;\n\`\`\``,
  };
  for (const [label, page] of Object.entries(PAGES)) {
    await t(`writes: with folder access "full", an answer with a ${label} in a temporary task leaves the work folder byte-identical; an ordinary task writes it (control)`, async () => {
      let marker = '';
      const run = seat('proxy', { memory: false, access: 'full', answer: () => page(marker) });
      await run.init();
      const under = run.store.getView();
      const before = folderBytes(run.root), stamps = stamp(run);
      await run.store.createTemporary({ taskId: under.activeTaskId, revision: under.revision });
      const temporaryId = run.store.getView().activeTaskId;
      marker = `MARK-PAGE-${randomUUID()}`;
      await run.send('페이지 만들어 줘');
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.ok(run.store.getHistory().some(m => m.content.includes(marker)), 'control: the answer carried the page');
      await run.store.select(under.activeTaskId, { taskId: temporaryId, revision: run.store.getView().revision });
      assert.deepEqual(Object.keys(folderBytes(run.root)).filter(f => !(f in before)), [], 'no file created in the work folder');
      assert.equal(JSON.stringify(folderBytes(run.root)), JSON.stringify(before), 'the work folder is byte-identical');
      assert.deepEqual(changed(stamps, stamp(run)), [], 'nothing under globalStorage, the spool or the folder changed');
      assert.deepEqual(await sweep(run, marker), [], 'the page is nowhere');
      assert.equal(run.posts.filter(m => m.type === 'artifactChanged').length, 0, 'no artifact change');
      // Control: the same answer in an ordinary task writes the page into the folder.
      marker = `MARK-PAGE-${randomUUID()}`;
      await run.send('페이지 만들어 줘');
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.ok(hits(run.root, marker).length > 0, `control: an ordinary task writes the page (${label})`);
    });
  }

  await t('writes: while a temporary task is open, the preview\'s and the trash\'s write guard refuses, and no photo is staged', async () => {
    const run = seat('proxy', { memory: false, access: 'full' });
    await run.init();
    const target = path.join(run.root, 'index.html');
    run.p.isImageFilesEnabled = () => true;
    assert.equal(run.p.folderWriteRefusalFor(target), null, 'control: an ordinary task may write (access full)');
    const under = run.store.getView();
    await run.store.createTemporary({ taskId: under.activeTaskId, revision: under.revision });
    assert.equal(run.p.folderWriteRefusalFor(target), TEMPORARY_TASK_NO_WRITE, 'the one write question refuses');
    assert.equal(run.p.stageImageBytes('s1', 'a.png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex')), TEMPORARY_TASK_NO_IMAGES, 'no photo is staged');
    await run.store.select(under.activeTaskId, { taskId: run.store.getView().activeTaskId, revision: run.store.getView().revision });
    assert.equal(run.p.folderWriteRefusalFor(target), null, 'leaving the task lifts it');
  });

  await t('photos: a temporary turn takes none (they would be saved into the work folder); the input goes back with the reason', async () => {
    const run = seat('proxy', { memory: false });
    await run.init();
    const under = run.store.getView();
    await run.store.createTemporary({ taskId: under.activeTaskId, revision: under.revision });
    const before = stamp(run);
    const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
    await run.p.handleMessage({ type: 'sendMessage', activityId: 'a1', taskId: run.store.getView().activeTaskId, text: '이 사진 봐 줘', images: [png], history: [], toolMode: 'auto', userMessageId: 'u-photo-1' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(run.calls.length, 0, 'nothing reached the model');
    assert.equal(run.posts.filter(m => m.type === 'streamError').at(-1)?.error, TEMPORARY_TASK_NO_IMAGES, 'told why');
    assert.ok(run.posts.some(m => m.type === 'inputRejected' && m.text === '이 사진 봐 줘' && m.images?.length === 1), 'the text and the photo go back to the composer');
    assert.deepEqual(changed(before, stamp(run)), [], 'no file was written');
  });

  // The seat is checked again on every turn, on the profile served for that turn: a seat that turned minor, kids-tier,
  // lesson or trial while a temporary task was open sends nothing, keeps its input and is told why.
  for (const [label, flip] of [
    ['minor cohort', p => ({ ...p, minor_cohort: true })],
    ['kids tier', p => ({ ...p, game: { template_tier: 'kids' } })],
    ['lesson', p => ({ ...p, lesson: { course_id: 'c', version: '1', sha256: 'x' } })],
    ['served as trial', p => ({ ...p, activity_kind: 'trial' })],
  ]) {
    await t(`seat re-check on a turn: a temporary task whose seat turned "${label}" sends nothing and says why`, async () => {
      const run = seat('proxy', { memory: false });
      await run.init();
      const under = run.store.getView();
      await run.store.createTemporary({ taskId: under.activeTaskId, revision: under.revision });
      const before = stamp(run);
      const flipped = flip(await run.p.ensureProfile());
      run.p.ensureProfile = async () => flipped;
      await run.p.handleMessage({ type: 'sendMessage', activityId: 'a1', taskId: run.store.getView().activeTaskId, text: '이어서 물어볼게', history: [], toolMode: 'auto', userMessageId: `u-flip-${passed}` });
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(run.calls.length, 0, `${label}: nothing reached the model`);
      assert.equal(run.posts.filter(m => m.type === 'streamError').at(-1)?.error, TEMPORARY_TASK_UNAVAILABLE, `${label}: told why`);
      assert.ok(run.posts.some(m => m.type === 'inputRejected' && m.text === '이어서 물어볼게'), `${label}: the input goes back to the composer`);
      assert.deepEqual(changed(before, stamp(run)), [], `${label}: no file was written`);
    });
  }

  console.log(`temporary task: ${passed} passed`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
