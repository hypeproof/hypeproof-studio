import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const H = await import(process.env.ARTIFACT_HISTORY_SOURCE ?? '../src/turnRestore.ts');
const hash = data => createHash('sha256').update(data).digest('hex');
const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-history-')));
try {
  const root = path.join(tmp, 'work'); await fs.mkdir(root);
  const file = path.join(root, '작품.bin');
  const store = H.artifactHistoryStore(path.join(tmp, 'state'), root, '작품.bin');
  const one = Buffer.from([0, 255, 10, 20]), two = Buffer.from([10, 20, 30]);
  await fs.writeFile(file, one);
  const first = await H.captureArtifactVersion(store, root, '작품.bin', 'ai');
  await fs.writeFile(file, two);
  const current = await H.captureArtifactVersion(store, root, '작품.bin', 'learner');
  assert.equal(first.turnId, 'artifact-ai'); assert.equal(current.turnId, 'artifact-learner');
  await fs.writeFile(path.join(root, 'unrelated.txt'), 'keep');
  assert.deepEqual(await H.restoreArtifactVersion({ store, root, rel: '작품.bin', id: first.id, expected: hash(two) }), { ok: true });
  assert.deepEqual(await fs.readFile(file), one);
  assert.equal(await fs.readFile(path.join(root, 'unrelated.txt'), 'utf8'), 'keep');
  const versions = await H.listRestorePoints(store);
  assert(versions.some(p => p.files[0].sha256 === hash(two)), 'pre-restore bytes remain recoverable');
  assert(versions.filter(p => p.files[0].sha256 === hash(one)).length >= 2, 'restore creates a new head');
  // Stale UI must never overwrite bytes written after listing, including same-size changes.
  await fs.writeFile(file, Buffer.from([99, 98, 97, 96]));
  assert.equal((await H.restoreArtifactVersion({ store, root, rel: '작품.bin', id: current.id, expected: hash(one) })).reason, 'changed');
  assert.deepEqual(await fs.readFile(file), Buffer.from([99, 98, 97, 96]));
  // A task/connection/dirty-buffer change while the dialog is open fails closed.
  assert.equal((await H.restoreArtifactVersion({ store, root, rel: '작품.bin', id: first.id, expected: hash(Buffer.from([99,98,97,96])), stillCurrent: () => false })).reason, 'changed');
  await fs.unlink(file); await fs.symlink(path.join(root, 'unrelated.txt'), file);
  assert.equal(await H.captureArtifactVersion(store, root, '작품.bin', 'ai'), null);
  assert.equal((await H.restoreArtifactVersion({ store, root, rel: '작품.bin', id: first.id, expected: hash('keep') })).ok, false);
  assert.equal(await H.captureArtifactVersion(store, root, '../outside', 'ai'), null);
  assert.equal(await H.captureArtifactVersion(store, root, 'x/../unrelated.txt', 'ai'), null);
  // The shared lock serializes windows rather than dropping their capture.
  const { accountLock } = await import('../src/accountLock.ts');
  let release, entered;
  const gate = new Promise(r => { release = r; });
  const ready = new Promise(r => { entered = r; });
  const held = accountLock(store)(async () => { entered(); await gate; });
  await ready;
  let completed = false;
  const waiting = H.captureArtifactVersion(store, root, '작품.bin', 'unknown').then(() => { completed = true; });
  await new Promise(r => setTimeout(r, 20)); assert.equal(completed, false);
  release(); await held; await waiting;
  await fs.unlink(file); await fs.writeFile(file, two);
  let enabled = true;
  const picks = [];
  const native = { ViewColumn: { Beside: 2 }, workspace: { getConfiguration: () => ({ get: (_key, dflt) => enabled === undefined ? dflt : enabled }), textDocuments: [] }, window: {
    createOutputChannel: () => ({ appendLine() {} }),
    showQuickPick: async entries => entries.find(e => e.point.id === first.id),
    showWarningMessage: async () => '복원하기',
    showInformationMessage: async message => { notices.push(message); },
  } };
  const notices = [], require = createRequire(import.meta.url);
  const extension = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({ stdin: { contents: `export { ChatPanelProvider } from ${JSON.stringify(process.env.ARTIFACT_PROVIDER_SOURCE ?? "./src/chatPanelProvider")};`, resolveDir: extension, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? native : require(id), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto });
  const host = Object.create(module.exports.ChatPanelProvider.prototype);
  Object.assign(host, { resolveCoachCwd: () => root, _instructorMode: { isInstructor: false }, cachedProfile: { activity_kind: "classroom", minor_cohort: true }, hasActiveStream: () => false, pendingSends: 0, taskChanging: false, connectionChanging: false, clearingHistory: false, turnRestoreBusy: false, profileGeneration: 0, turnRestoreTaskKey: () => 'default', context: { globalStorageUri: { fsPath: path.join(tmp, 'state') } }, folderWriteRefusalFor: () => null, provenanceRecorder: () => ({ unobserved: async () => {} }) });
  // Cancel leaves disk unchanged, independent of any seat-age flag.
  native.window.showWarningMessage = async () => undefined;
  await host.showArtifactHistory(file); assert.deepEqual(await fs.readFile(file), two);
  native.window.showWarningMessage = async () => { host.profileGeneration++; return '복원하기'; };
  await host.showArtifactHistory(file); assert.deepEqual(await fs.readFile(file), two); assert.equal(notices.at(-1), '파일이 바뀌었어요');
  native.window.showWarningMessage = async () => '복원하기';
  native.workspace.textDocuments = [{ uri: { scheme: 'file', fsPath: file }, isDirty: true }];
  await host.showArtifactHistory(file); assert.deepEqual(await fs.readFile(file), two);
  native.workspace.textDocuments = [];
  await host.showArtifactHistory(file); assert.deepEqual(await fs.readFile(file), one);
  // Unknown save followed by measured exact-byte evidence enriches the revision.
  await fs.writeFile(file, 'manual-change');
  const unknown = await H.captureArtifactVersion(store, root, '작품.bin', 'unknown');
  native.window.showQuickPick = async entries => entries.find(e => e.point.id === unknown.id);
  native.window.showWarningMessage = async () => '내 수정으로 기록';
  await host.showArtifactHistory(file);
  assert.equal((await H.listRestorePoints(store))[0].turnId, 'artifact-learner');
  assert.equal(notices.at(-1), '내가 확인한 수정으로 기록했어요.');
  await fs.writeFile(file, 'ai-output');
  const beforeEvidence = await H.captureArtifactVersion(store, root, '작품.bin', 'unknown');
  const enriched = await H.captureArtifactVersion(store, root, '작품.bin', 'ai', hash('ai-output'));
  assert.equal(enriched.id, beforeEvidence.id); assert.equal(enriched.turnId, 'artifact-ai');
  assert.equal((await H.captureArtifactVersion(store, root, '작품.bin', 'learner', hash('ai-output'))).turnId, 'artifact-ai', 'cannot relabel AI bytes');
  // Exact-byte learner confirmation is refused if bytes/context move during its modal.
  await fs.writeFile(file, 'unconfirmed');
  const unconfirmed = await H.captureArtifactVersion(store, root, '작품.bin', 'unknown');
  native.window.showQuickPick = async entries => entries.find(e => e.point.id === unconfirmed.id);
  native.window.showWarningMessage = async () => { await fs.writeFile(file, 'external-change'); return '내 수정으로 기록'; };
  await host.showArtifactHistory(file); assert.equal(notices.at(-1), '파일이 바뀌었어요');
  assert.equal((await H.loadRestorePoint(store, unconfirmed.id)).turnId, 'artifact-unknown');
  native.window.showWarningMessage = async () => undefined;
  const defaultCount = (await H.listRestorePoints(store)).length;
  enabled = false; await host.recordArtifactSave(file); await host.showArtifactHistory(file);
  assert.equal((await H.listRestorePoints(store)).length, defaultCount, 'default off does not retain additional versions');
  enabled = true;
  for (const profile of [null, {activity_kind:'trial'}, {pass:{}}, {activity_kind:'lesson'}, {activity_kind:'classroom', minor_cohort:true}]) {
    host.cachedProfile = profile;
    assert.equal(host.artifactHistoryEnabled(), !!profile);
  }
  host._instructorMode.isInstructor = true; assert.equal(host.artifactHistoryEnabled(),false);
  host._instructorMode.isInstructor = null; assert.equal(host.artifactHistoryEnabled(),false);
  host._instructorMode.isInstructor = false;
  host.connectionChanging = true; assert.equal(host.artifactHistoryEnabled(),false); host.connectionChanging=false;
  // Recorder automatic history is off by default; enabling retains only measured writes.
  const { ArtifactProvenanceRecorder } = await import('../src/artifactProvenance.ts');
  const recorderBase = path.join(tmp, 'recorder');
  const recorderStore = H.artifactHistoryStore(recorderBase, root, '작품.bin');
  const recorder = new ArtifactProvenanceRecorder(recorderBase);
  await recorder.hostWrote(root, [{absPath:file,data:'external-change'}], 'ai');
  assert.equal((await H.listRestorePoints(recorderStore)).length,0);
  const optedIn = new ArtifactProvenanceRecorder(recorderBase, Date.now, () => true);
  await optedIn.hostWrote(root, [{absPath:file,data:'external-change'}], 'ai');
  assert.equal((await H.listRestorePoints(recorderStore))[0].turnId,'artifact-ai');
  // Default-off: the manifest default and the code default are both false, and an unset setting retains nothing.
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.strictEqual(pkg.contributes.configuration.properties['hypeproofChat.artifactHistoryEnabled'].default, false);
  enabled = undefined; assert.strictEqual(host.artifactHistoryEnabled(), false, 'unset setting is off'); enabled = true;
  // Editor saves are recorded as unknown, never as the learner.
  const fileB = path.join(root, 'b.txt'), storeB = H.artifactHistoryStore(path.join(tmp, 'state'), root, 'b.txt');
  await fs.writeFile(fileB, 'b1'); await host.recordArtifactSave(fileB);
  assert.deepEqual((await H.listRestorePoints(storeB)).map(p => p.turnId), ['artifact-unknown'], 'editor save actor is unknown');
  // The list shows who and when for AI / 나 / 기록 없음.
  for (const [data, actor] of [['b2', 'ai'], ['b3', 'learner'], ['b4', 'unknown']]) { await fs.writeFile(fileB, data); await H.captureArtifactVersion(storeB, root, 'b.txt', actor); }
  native.window.showQuickPick = async entries => { picks.push(entries); return undefined; };
  await host.showArtifactHistory(fileB);
  const shown = [...picks.at(-1)], want = { 'artifact-ai': 'AI', 'artifact-learner': '나', 'artifact-unknown': '기록 없음' };
  assert.deepEqual(shown.map(e => e.label), (await H.listRestorePoints(storeB)).map(p => `${want[p.turnId]} · ${new Date(p.createdAt).toLocaleString('ko-KR')}`));
  assert.deepEqual(shown.map(e => e.point.turnId), ['artifact-unknown', 'artifact-learner', 'artifact-ai', 'artifact-unknown']);
  assert.deepEqual(shown.map(e => e.description), ['현재 버전', '보관된 버전', '보관된 버전', '보관된 버전']);
  // Restore archives bytes that were never captured before, and the new head is 나.
  const three = Buffer.from('b5-never-captured');
  await fs.writeFile(fileB, three);
  const before = await H.listRestorePoints(storeB);
  assert(!before.some(p => p.files[0].sha256 === hash(three)), 'precondition: bytes not yet captured');
  const aiId = before.find(p => p.turnId === 'artifact-ai').id;
  assert.deepEqual(await H.restoreArtifactVersion({ store: storeB, root, rel: 'b.txt', id: aiId, expected: hash(three) }), { ok: true });
  assert.equal(await fs.readFile(fileB, 'utf8'), 'b2');
  const after = await H.listRestorePoints(storeB);
  const recovery = after.find(p => p.files[0].sha256 === hash(three));
  assert(recovery, 'pre-restore copy exists after restore');
  assert.equal(recovery.turnId, 'artifact-unknown', 'pre-restore recovery copy is 기록 없음, never 나');
  assert.equal(after[0].turnId, 'artifact-learner', 'restored head is 나'); assert.equal(after[0].files[0].sha256, hash('b2'));
  assert.deepEqual(await H.restoreArtifactVersion({ store: storeB, root, rel: 'b.txt', id: recovery.id, expected: hash('b2') }), { ok: true });
  assert.deepEqual(await fs.readFile(fileB), three, 'recovery copy holds the exact pre-restore bytes');
  // Automatic hooks and host-write actors, with the opt-in on and off.
  const hookBase = path.join(tmp, 'hooks'), hookOn = new ArtifactProvenanceRecorder(hookBase, Date.now, () => true), hookOff = new ArtifactProvenanceRecorder(hookBase);
  const hookStore = rel => H.artifactHistoryStore(hookBase, root, rel);
  const turns = async rel => (await H.listRestorePoints(hookStore(rel))).map(p => p.turnId);
  await fs.writeFile(path.join(root, 'h.txt'), 'h1');
  const hp = { turnId: 't1', createdAt: 1000, files: [{ path: 'h.txt', sha256: hash('h1') }] };
  await hookOff.turnStart(root, hp); assert.deepEqual(await turns('h.txt'), [], 'turnStart off by default');
  await hookOn.turnStart(root, hp); assert.deepEqual(await turns('h.txt'), ['artifact-unknown'], 'turnStart captures when opted in');
  await fs.writeFile(path.join(root, 'h.txt'), 'h2');
  const hafter = [{ path: 'h.txt', sha256: hash('h2') }];
  await hookOff.turnEnd(root, hp, { added: [], changed: ['h.txt'], deleted: [] }, hafter); assert.deepEqual(await turns('h.txt'), ['artifact-unknown']);
  await hookOn.turnEnd(root, hp, { added: [], changed: ['h.txt'], deleted: [] }, hafter); assert.deepEqual(await turns('h.txt'), ['artifact-ai', 'artifact-unknown'], 'turnEnd records AI');
  for (const [actor, rel, turn] of [['ai', 'w-ai.txt', 'artifact-ai'], ['studio', 'w-studio.txt', 'artifact-unknown'], ['learner_upload', 'w-up.txt', 'artifact-learner']]) {
    await fs.writeFile(path.join(root, rel), rel);
    await hookOn.hostWrote(root, [{ absPath: path.join(root, rel), data: rel }], actor);
    assert.deepEqual(await turns(rel), [turn], `hostWrote ${actor}`);
  }
  // turnStart capture is bounded by file count and total bytes.
  const { TURN_START_HISTORY_LIMITS: LIM } = await import('../src/artifactProvenance.ts');
  assert.deepEqual([LIM.files, LIM.bytes], [25, 4 * 1024 * 1024]);
  const many = [];
  for (let i = 0; i < 30; i++) { const rel = `many-${i}.txt`; await fs.writeFile(path.join(root, rel), `m${i}`); many.push({ path: rel, sha256: hash(`m${i}`) }); }
  await hookOn.turnStart(root, { turnId: 't2', createdAt: 2000, files: many });
  let capturedMany = 0; for (const f of many) capturedMany += (await turns(f.path)).length ? 1 : 0;
  assert.equal(capturedMany, LIM.files, 'turnStart file cap');
  const big = [];
  for (let i = 0; i < 4; i++) { const data = Buffer.alloc(1.5 * 1024 * 1024, i + 1), rel = `big-${i}.bin`; await fs.writeFile(path.join(root, rel), data); big.push({ path: rel, sha256: hash(data) }); }
  await hookOn.turnStart(root, { turnId: 't3', createdAt: 3000, files: big });
  let capturedBig = 0; for (const f of big) capturedBig += (await turns(f.path)).length ? 1 : 0;
  assert.equal(capturedBig, 2, 'turnStart byte cap');
  // turnEnd: only added/changed files get AI; an unchanged file with an unknown revision stays unknown.
  await fs.writeFile(path.join(root, 'e-chg.txt'), 'e1'); await fs.writeFile(path.join(root, 'e-same.txt'), 'e2'); await fs.writeFile(path.join(root, 'e-new.txt'), 'e3');
  await hookOn.hostWrote(root, [{ absPath: path.join(root, 'e-same.txt'), data: 'e2' }], 'studio');
  await hookOn.hostWrote(root, [{ absPath: path.join(root, 'e-chg.txt'), data: 'e1' }], 'studio');
  await fs.writeFile(path.join(root, 'e-chg.txt'), 'e1b');
  const eafter = [{ path: 'e-chg.txt', sha256: hash('e1b') }, { path: 'e-same.txt', sha256: hash('e2') }, { path: 'e-new.txt', sha256: hash('e3') }];
  await hookOn.turnEnd(root, { turnId: 't4', createdAt: 4000, files: [] }, { added: ['e-new.txt'], changed: ['e-chg.txt'], deleted: [] }, eafter);
  assert.deepEqual(await turns('e-chg.txt'), ['artifact-ai', 'artifact-unknown'], 'turnEnd changed file is AI');
  assert.deepEqual(await turns('e-new.txt'), ['artifact-ai'], 'turnEnd added file is AI');
  assert.deepEqual(await turns('e-same.txt'), ['artifact-unknown'], 'turnEnd leaves an unchanged file unknown');
  // turnEnd capture is bounded by file count and total bytes (and a skipped big file does not stop later small ones).
  const { TURN_END_HISTORY_LIMITS: ELIM } = await import('../src/artifactProvenance.ts');
  assert.deepEqual([ELIM.files, ELIM.bytes], [25, 4 * 1024 * 1024]);
  const eMany = [];
  for (let i = 0; i < 30; i++) { const rel = `emany-${i}.txt`; await fs.writeFile(path.join(root, rel), `x${i}`); eMany.push({ path: rel, sha256: hash(`x${i}`) }); }
  await hookOn.turnEnd(root, { turnId: 't5', createdAt: 5000, files: [] }, { added: eMany.map(f => f.path), changed: [], deleted: [] }, eMany);
  let eCount = 0; for (const f of eMany) eCount += (await turns(f.path)).length ? 1 : 0;
  assert.equal(eCount, ELIM.files, 'turnEnd file cap');
  const eBig = [];
  for (let i = 0; i < 3; i++) { const data = Buffer.alloc(1.5 * 1024 * 1024, i + 9), rel = `ebig-${i}.bin`; await fs.writeFile(path.join(root, rel), data); eBig.push({ path: rel, sha256: hash(data) }); }
  await fs.writeFile(path.join(root, 'ebig-small.txt'), 'small'); eBig.push({ path: 'ebig-small.txt', sha256: hash('small') });
  await hookOn.turnEnd(root, { turnId: 't6', createdAt: 6000, files: [] }, { added: eBig.map(f => f.path), changed: [], deleted: [] }, eBig);
  assert.deepEqual(await Promise.all(eBig.map(async f => (await turns(f.path)).length)), [1, 1, 0, 1], 'turnEnd byte cap skips the file over budget, later small file still fits');
  // A context switch during queued metadata/blob IO must not commit a new revision.
  await fs.writeFile(file, 'pending-context');
  const beforeRace = (await H.listRestorePoints(store)).map(p => p.id);
  let guards = 0;
  assert.equal(await H.captureArtifactVersion(store, root, '작품.bin', 'learner', hash('pending-context'), () => ++guards < 3), null);
  assert.deepEqual((await H.listRestorePoints(store)).map(p => p.id), beforeRace);
  // Exact-byte capture refuses an external edit that lands before metadata commit.
  let checks = 0;
  assert.equal(await H.captureArtifactVersion(store, root, '작품.bin', 'learner', hash('pending-context'), () => {
    if (++checks === 3) require('node:fs').writeFileSync(file, 'external-late');
    return true;
  }), null);
  assert.deepEqual((await H.listRestorePoints(store)).map(p => p.id), beforeRace);
  for (let i = 0; i < 25; i++) {
    await fs.writeFile(file, `bounded-${i}`);
    await H.captureArtifactVersion(store, root, '작품.bin', 'unknown');
  }
  assert.equal((await H.listRestorePoints(store)).length, 20, 'retention is bounded per file');
  // The public command's new side panel binds the original activity/profile/file.
  const panelViews=[];
  native.ViewColumn={Beside:2};
  native.window.tabGroups={all:[],close:async()=>true};
  native.workspace.registerTextDocumentContentProvider=()=>({dispose(){}});
  native.window.createWebviewPanel=(_type,_title,column)=>{
    const view={column,html:'',messages:[],webview:{set html(value){view.html=value;},onDidReceiveMessage(fn){view.receive=fn;},postMessage(m){view.messages.push(m);return Promise.resolve(true);}},onDidDispose(){}};
    panelViews.push(view);return view;
  };
  host.cachedProfile={activity_kind:'classroom',minor_cohort:true};host._instructorMode.isInstructor=false;
  host.profileGeneration=0;host.turnRestoreBusy=false;enabled=false;
  await host.openArtifactHistoryPanel(fileB);assert.equal(panelViews.length,0);assert.match(notices.at(-1),/설정에서 켠 활동/);
  enabled=true;host.pendingSends=1;await host.openArtifactHistoryPanel(fileB);assert.equal(panelViews.length,0);assert.match(notices.at(-1),/진행 중인 작업/);host.pendingSends=0;
  await host.openArtifactHistoryPanel(fileB);const panelView=panelViews.at(-1);assert.equal(panelView.column,2);assert.match(panelView.html,/지금/);
  const selectedForPanel=(await H.listRestorePoints(storeB)).at(-1);const beforePanel=await fs.readFile(fileB);
  native.window.showWarningMessage=async()=>{host.profileGeneration++;return '복원하기';};
  await panelView.receive({action:'restore',id:selectedForPanel.id});assert.deepEqual(await fs.readFile(fileB),beforePanel);assert.match(panelView.messages.at(-1).error,/파일이 바뀌었어요/);assert.equal(host.turnRestoreBusy,false);
  await host.openArtifactHistoryPanel(fileB);const dirtyPanel=panelViews.at(-1);
  native.window.showWarningMessage=async()=> '복원하기';native.workspace.textDocuments=[{uri:{scheme:'file',fsPath:fileB},isDirty:true}];
  await dirtyPanel.receive({action:'restore',id:selectedForPanel.id});assert.deepEqual(await fs.readFile(fileB),beforePanel);assert.match(dirtyPanel.messages.at(-1).error,/파일이 바뀌었어요/);
  native.workspace.textDocuments=[];
  // The panel's restore honours the REAL folder consent (folderWriteRefusalFor is not stubbed here) and the host's busy flag.
  {
    const FC = await import('../src/folderConsent.ts');
    const consent = new Map(), saved = { refusal: host.folderWriteRefusalFor, profile: host.cachedProfile, context: host.context };
    delete host.folderWriteRefusalFor;
    assert.equal(Object.hasOwn(host, 'folderWriteRefusalFor'), false, 'the prototype guard is in use');
    host.context = { ...saved.context, globalState: { get: k => consent.get(k), update: async (k, v) => { consent.set(k, v); } }, workspaceState: { get: () => undefined, update: async () => {} } };
    host.cachedProfile = { profile_id: 'p', activity_id: 'd'.repeat(64), activity_kind: 'personal' };
    host.servedWorkspaceRoot = path.join(tmp, 'elsewhere');
    native.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
    const choose = level => consent.set(FC.FOLDER_CONSENT_KEY, FC.writeFolderConsent(consent.get(FC.FOLDER_CONSENT_KEY), 'd'.repeat(64), FC.canonicalFolder(root), level));
    const fileC = path.join(root, 'c.txt'), storeC = H.artifactHistoryStore(path.join(tmp, 'state'), root, 'c.txt');
    try {
      await fs.writeFile(fileC, 'c1'); const c1 = await H.captureArtifactVersion(storeC, root, 'c.txt', 'ai');
      await fs.writeFile(fileC, 'c2');
      native.window.showWarningMessage = async () => '복원하기';
      for (const level of ['read', 'none', undefined]) {
        consent.clear(); if (level) choose(level);
        await host.openArtifactHistoryPanel(fileC); const view = panelViews.at(-1);
        await view.receive({ action: 'restore', id: c1.id });
        assert.equal(await fs.readFile(fileC, 'utf8'), 'c2', `${level ?? 'undecided'}: the folder choice refuses the restore`);
        assert.match(view.messages.at(-1).error, /파일이 바뀌었어요/);
      }
      // Control: with full access, the same press restores, so the refusals above are the consent check and nothing else.
      consent.clear(); choose('full');
      await host.openArtifactHistoryPanel(fileC); const full = panelViews.at(-1);
      let asked = 0; native.window.showWarningMessage = async () => { asked++; return '복원하기'; };
      host.turnRestoreBusy = true; await full.receive({ action: 'restore', id: c1.id });
      assert.equal(asked, 0, 'a busy host never opens the restore dialog'); assert.equal(await fs.readFile(fileC, 'utf8'), 'c2'); host.turnRestoreBusy = false;
      await full.receive({ action: 'restore', id: c1.id });
      assert.equal(asked, 1); assert.equal(await fs.readFile(fileC, 'utf8'), 'c1', 'control: full access restores');
    } finally { Object.assign(host, { cachedProfile: saved.profile, context: saved.context, folderWriteRefusalFor: saved.refusal, turnRestoreBusy: false }); native.workspace.workspaceFolders = undefined; }
  }
  console.log('artifact-history: PASS (binary restore, recovery head, stale bytes/context, links, traversal, shared lock)');
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
