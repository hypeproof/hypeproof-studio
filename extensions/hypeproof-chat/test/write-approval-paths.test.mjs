// REQ-E1 / CGP-AGENT-R-005 — when `writeFile` is in requireApprovalFor, the write approval lists every path the
// call will write, relative to the work folder (`작업 폴더/src/app.js`), up to 8 then "외 N개" with a full-list
// button that names the real total. Outside paths (absolute, `..`, a symlink that resolves outside) read
// 작업 폴더 밖 and are refused before any modal. 새 파일 / 바꿈 only when the tool input says so. Names cannot fake
// a line. The approval covers exactly the listed paths: a path that changes while the modal is open is refused.
//
// Pure module first, then the real chatPanelProvider bundled with a scripted `vscode` (as
// browser-target-host.test.mjs does), then the real runSdkCoach with a scripted CLI (as
// orchestrator-switch.smoke.mjs does), then the local runtime. .claude/rules/verification.md §2: every
// "inside" case is a positive control for every "outside" case.
// Run: node --experimental-strip-types --test test/write-approval-paths.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';

// sdkCoach.ts imports its siblings without extensions (esbuild resolves them); resolve them the same way and
// `vscode` to the shared stub, as orchestrator-switch.smoke.mjs does.
const stub = new URL('./fixtures/vscode-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'vscode') return { url: stub, shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { return nextResolve(specifier, context); }
    }
    return nextResolve(specifier, context);
  },
});

const {
  writeTargetsOf, writeTargetsFromPayload, writePathEntries, writeApprovalCopy, writePathLine, writeScopeKeys, writeScopeCovered,
  WRITE_PATHS_SHOWN,
} = await import('../src/writeApprovalPaths.ts');
const { sdkToolToActionRequest } = await import('../src/sdkCoachHelpers.ts');

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hps-write-paths-')));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const WS = path.join(scratch, 'work');
const OUT = path.join(scratch, 'elsewhere');
fs.mkdirSync(path.join(WS, 'src'), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(WS, 'src', 'app.js'), 'old');
fs.symlinkSync(OUT, path.join(WS, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
const LINES = /[\n\r\u0085\u2028\u2029]/;
const TITLE = '코치가 파일을 저장하려고 해요:';

test('single write: one path, relative to the work folder; change tag only when the input says so', () => {
  const w = writePathEntries(writeTargetsOf('Write', { file_path: path.join(WS, 'src/app.js'), content: 'x' }), WS);
  assert.deepEqual(w.map(writePathLine), ['작업 폴더/src/app.js'], 'Write says nothing: create or overwrite is not in the input');
  const rel = writePathEntries(writeTargetsOf('Write', { file_path: 'index.html', content: 'x' }), WS);
  assert.deepEqual(rel.map(writePathLine), ['작업 폴더/index.html'], 'a relative path resolves against the work folder');
  const edit = writePathEntries(writeTargetsOf('Edit', { file_path: path.join(WS, 'src/app.js'), old_string: 'old', new_string: 'new' }), WS);
  assert.deepEqual(edit.map(writePathLine), ['작업 폴더/src/app.js · 바꿈']);
  const create = writeTargetsOf('Edit', { file_path: path.join(WS, 'new.css'), old_string: '', new_string: 'a{}' });
  assert.deepEqual(writePathEntries(create, WS).map(writePathLine), ['작업 폴더/new.css · 새 파일']);
  const multi = writeTargetsOf('MultiEdit', { file_path: path.join(WS, 'src/app.js'), edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] });
  assert.equal(multi[0].change, 'changed');
  assert.equal(writeTargetsOf('MultiEdit', { file_path: 'x', edits: [{ old_string: 'a' }, { old_string: '' }] })[0].change, undefined, 'mixed: no guess');
  assert.equal(writeTargetsOf('MultiEdit', { file_path: 'x', edits: [{ new_string: 'a' }] })[0].change, undefined, 'malformed: no guess');
  assert.equal(writeTargetsOf('NotebookEdit', { notebook_path: path.join(WS, 'a.ipynb'), new_source: '' })[0].change, 'changed');
  assert.deepEqual(writeTargetsOf('Read', { file_path: 'a' }), [], 'not a write tool');
  const copy = writeApprovalCopy(TITLE, edit);
  assert.equal(copy.message, `${TITLE}\n\n작업 폴더/src/app.js · 바꿈`);
  assert.equal(copy.allLabel, undefined, 'nothing hidden → no full-list button');
});

test('multi-file write lists every path; over 8 shows 외 N개 and a full list with the real count', () => {
  const targets = Array.from({ length: 12 }, (_, i) => ({ path: path.join(WS, `p${String(i + 1).padStart(2, '0')}.html`) }));
  const entries = writePathEntries(targets, WS);
  assert.equal(entries.length, 12);
  const exact = writeApprovalCopy(TITLE, entries.slice(0, WRITE_PATHS_SHOWN));
  assert.equal(exact.message.split('\n').length, 2 + 8, 'exactly 8: all listed, no 외');
  assert.ok(!exact.message.includes('외'));
  const three = writeApprovalCopy(TITLE, entries.slice(0, 3));
  assert.equal(three.message, `${TITLE}\n\n작업 폴더/p01.html\n작업 폴더/p02.html\n작업 폴더/p03.html`);
  const over = writeApprovalCopy(TITLE, entries);
  assert.equal(WRITE_PATHS_SHOWN, 8);
  assert.equal(over.hidden, 4);
  assert.match(over.message, /\n작업 폴더\/p08\.html\n외 4개$/);
  assert.ok(!over.message.includes('p09'), 'the ninth is not in the short list');
  assert.equal(over.allLabel, '전체 목록 보기 (12개)');
  assert.equal(over.allMessage.split('\n').filter((l) => l.startsWith('작업 폴더/')).length, 12, 'the full list has every path');
  assert.match(over.allMessage, /모두 12개:/);
  // payload form (what sdkToolToActionRequest sends), strings and objects
  assert.deepEqual(writeTargetsFromPayload({ paths: ['a', { path: 'b', change: 'new' }, { path: '' }, 7] }), [{ path: 'a' }, { path: 'b', change: 'new' }]);
  assert.deepEqual(writeTargetsFromPayload({ path: 'only' }), [{ path: 'only' }]);
});

test('outside, a .. escape and a symlink are marked 작업 폴더 밖; inside is the positive control', () => {
  const lines = writePathEntries([
    { path: path.join(WS, 'src/app.js') },
    { path: path.join(OUT, 'secret.txt') },
    { path: path.join(WS, '..', 'elsewhere', 'escape.txt') },
    { path: path.join(WS, 'src', '..', '..', 'x.txt') },
    { path: path.join(WS, 'link', 'via-link.txt') },
    { path: path.join(WS, 'link', 'deeper', 'new.txt') },
    { path: '../rel-escape.txt' },
  ], WS);
  assert.deepEqual(lines.map((e) => [e.display, e.outside]), [
    ['작업 폴더/src/app.js', false],
    ['작업 폴더 밖 · secret.txt', true],
    ['작업 폴더 밖 · escape.txt', true],
    ['작업 폴더 밖 · x.txt', true],
    ['작업 폴더 밖 · via-link.txt', true],
    ['작업 폴더 밖 · new.txt', true],
    ['작업 폴더 밖 · rel-escape.txt', true],
  ]);
  assert.ok(!lines.some((e) => e.display.includes(scratch)), 'never the full path');
  // A symlinked WORK FOLDER (macOS /var → /private/var) is still inside: the root is canonical too.
  const alias = path.join(scratch, 'alias');
  fs.symlinkSync(WS, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(writePathEntries([{ path: path.join(WS, 'a.js') }], alias).map((e) => [e.display, e.outside]), [['작업 폴더/a.js', false]]);
  assert.deepEqual(writePathEntries([{ path: 'a.js' }], null).map((e) => e.outside), [true], 'no work folder → outside');
});

test('a control, bidi or line-separator character in a name cannot fake a line', () => {
  const forged = ['a\u2028작업 폴더/ok.js', 'b\n작업 폴더/ok2.js', 'c\r\u0085.js', '\u202esj.exe', 'd\u2029\u2066e\u2069.js'];
  const entries = writePathEntries(forged.map((n) => ({ path: path.join(WS, n) })), WS);
  const copy = writeApprovalCopy(TITLE, entries);
  assert.equal(copy.message.split(LINES).length, 2 + forged.length, JSON.stringify(copy.message));
  assert.deepEqual(entries.map((e) => e.display), ['작업 폴더/a작업 폴더/ok.js', '작업 폴더/b작업 폴더/ok2.js', '작업 폴더/c.js', '작업 폴더/sj.exe', '작업 폴더/de.js']);
  // a name that is nothing but controls still yields one line
  const blank = writePathEntries([{ path: path.join(OUT, '\u2028\u2029') }], WS);
  assert.equal(writeApprovalCopy(TITLE, blank).message.split(LINES).length, 3);
});

test('scope keys: the approval covers exactly the listed paths', () => {
  const approved = writeScopeKeys('Write', { file_path: path.join(WS, 'src/app.js') }, WS);
  assert.equal(approved.length, 1);
  assert.ok(writeScopeCovered(approved, writeScopeKeys('Write', { file_path: path.join(WS, 'src/app.js') }, WS)), 'positive control');
  assert.ok(!writeScopeCovered(approved, writeScopeKeys('Write', { file_path: path.join(WS, 'src/other.js') }, WS)), 'another path');
  assert.ok(!writeScopeCovered(approved, []), 'nothing named → not covered');
});

test('the request carries every path and its change tag (sdkToolToActionRequest)', () => {
  const req = sdkToolToActionRequest({ toolName: 'Edit', input: { file_path: path.join(WS, 'src/app.js'), old_string: 'a', new_string: 'b' } });
  assert.equal(req.kind, 'writeFile');
  assert.equal(req.payload.path, path.join(WS, 'src/app.js'), 'path kept for the Tier-2 check and older callers');
  assert.deepEqual(req.payload.paths, [{ path: path.join(WS, 'src/app.js'), change: 'changed' }]);
  const w = sdkToolToActionRequest({ toolName: 'Write', input: { file_path: 'index.html', content: 'x' } });
  assert.deepEqual(w.payload.paths, [{ path: 'index.html' }]);
});

// ── The real approval modal (chatPanelProvider + scripted vscode) ──
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL('../src/chatPanelProvider.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' });
const source = bundle.outputFiles[0].text;
const modals = [];
let answer = () => undefined;
let required = ['executeShell', 'openBrowser', 'delegateAgent', 'browserType', 'writeFile'];
const vscode = {
  window: { showWarningMessage: async (message, options, ...buttons) => { const m = { message, options, buttons }; modals.push(m); return answer(m); } },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => (key === 'requireApprovalFor' ? required : fallback) }),
    workspaceFolders: [{ uri: { fsPath: WS } }],
  },
};
const mod = { exports: {} };
vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (id) => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, AbortSignal, URL, TextEncoder, TextDecoder });
const P = mod.exports.ChatPanelProvider.prototype;
const host = { approvedCommandSignatures: new Set(), approvedBrowserOrigins: new Set(), coachDisplayName: () => '코치', sitePublisher: () => ({ allowed: () => false }), resolveCoachCwd: () => WS };
const captured = [];
const ask = async (label, req, pick) => {
  modals.length = 0;
  answer = pick ?? (() => undefined);
  const approved = await P.resolveActionApproval.call(host, { requestId: 'r', kind: 'writeFile', description: 'raw', ...req });
  captured.push({ label, approved, modals: modals.map((m) => ({ ...m })) });
  return { approved, modals: [...modals] };
};

test('the native modal lists the paths in Korean; 저장 approves; dismiss does not', async () => {
  const one = await ask('single Edit', sdkToolToActionRequest({ toolName: 'Edit', input: { file_path: path.join(WS, 'src/app.js'), old_string: 'old', new_string: 'new' } }));
  assert.equal(one.approved, false);
  assert.equal(one.modals.length, 1);
  assert.equal(one.modals[0].message, `${TITLE}\n\n작업 폴더/src/app.js · 바꿈`);
  assert.deepEqual(one.modals[0].buttons, ['저장']);
  assert.equal(one.modals[0].options.modal, true);
  assert.ok(!one.modals[0].message.includes(scratch), 'no absolute path in the modal');
  const yes = await ask('single Write, approved', sdkToolToActionRequest({ toolName: 'Write', input: { file_path: path.join(WS, 'index.html'), content: 'x' } }), () => '저장');
  assert.equal(yes.approved, true);
  assert.equal(yes.modals[0].message, `${TITLE}\n\n작업 폴더/index.html`);
});

test('over 8 paths: 외 N개, and 전체 목록 보기 (N개) opens every path before the answer', async () => {
  const paths = Array.from({ length: 11 }, (_, i) => ({ path: path.join(WS, `pages/p${i + 1}.html`) }));
  const r = await ask('11 paths, full list, approved', { payload: { path: paths[0].path, paths } }, (m) => (m.buttons.includes('전체 목록 보기 (11개)') ? '전체 목록 보기 (11개)' : '저장'));
  assert.equal(r.modals.length, 2, 'short list, then the full list');
  assert.match(r.modals[0].message, /\n외 3개$/);
  assert.equal(r.modals[0].message.split('\n').filter((l) => l.startsWith('작업 폴더/')).length, 8);
  assert.deepEqual(r.modals[0].buttons, ['저장', '전체 목록 보기 (11개)']);
  assert.equal(r.modals[1].message.split('\n').filter((l) => l.startsWith('작업 폴더/')).length, 11);
  assert.deepEqual(r.modals[1].buttons, ['저장']);
  assert.equal(r.approved, true);
  const dismissed = await ask('11 paths, full list, dismissed', { payload: { paths } }, (m) => (m.buttons.length > 1 ? '전체 목록 보기 (11개)' : undefined));
  assert.equal(dismissed.approved, false, 'looking at the list is not approving it');
});

test('an outside, .. or symlinked path is refused before any modal, and the notice is marked, not the full path', async () => {
  for (const [label, p] of [['outside', path.join(OUT, 'secret.txt')], ['.. escape', path.join(WS, '..', 'elsewhere', 'e.txt')], ['symlink', path.join(WS, 'link', 'via.txt')]]) {
    const r = await ask(`refused: ${label}`, { payload: { path: path.join(WS, 'ok.txt'), paths: [{ path: path.join(WS, 'ok.txt') }, { path: p }] } }, () => '저장');
    assert.equal(r.approved, false, label);
    assert.equal(r.modals.length, 1, `${label}: one notice`);
    assert.equal(r.modals[0].options, undefined, `${label}: a notice, not a modal`);
    assert.match(r.modals[0].message, /작업 폴더 밖 · /, label);
    assert.ok(!r.modals[0].message.includes(scratch), `${label}: no full path in the notice`);
  }
});

test('writeFile not in requireApprovalFor (the default): no modal, as before', async () => {
  required = ['executeShell', 'openBrowser', 'delegateAgent', 'browserType'];
  const r = await ask('default list: no modal', sdkToolToActionRequest({ toolName: 'Write', input: { file_path: path.join(WS, 'a.html'), content: 'x' } }));
  assert.equal(r.approved, true);
  assert.equal(r.modals.length, 0);
  required = ['executeShell', 'openBrowser', 'delegateAgent', 'browserType', 'writeFile'];
  const out = process.env.WRITE_PATHS_CAPTURE;
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const norm = (s) => String(s).split(scratch).join('<SCRATCH>');
    fs.writeFileSync(out, captured.map((c) => [`=== ${c.label} → approved=${c.approved}`, ...c.modals.map((m) => `--- ${m.options?.modal ? 'modal' : 'notice'} (buttons: ${m.buttons.join(' | ') || '-'})\n${norm(m.message)}`)].join('\n')).join('\n\n') + '\n');
  }
});

// ── The SDK gate: the approval covers exactly the listed path ──
const HOME = path.join(scratch, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR', 'HPS_SDK_BINARY']) delete process.env[k];
const { runSdkCoach } = await import('../src/sdkCoach.ts');

async function sdkTurn(probes, onApproval) {
  const approvals = [], decisions = [];
  const sdk = {
    query({ options }) {
      return (async function* () {
        for (const [i, [name, input]] of probes.entries()) {
          decisions.push(await options.canUseTool(name, structuredClone(input), { toolUseID: `w${i}`, signal: new AbortController().signal }));
        }
        yield { type: 'result', subtype: 'success', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
      })();
    },
  };
  const quiet = console.warn; console.warn = () => {};
  try {
    await runSdkCoach({
      gatewayUrl: 'https://api.hypeproof-ai.xyz/v1', token: 'hps-t', model: 'claude-sonnet-5-5', effort: 'medium', turnId: 'turn_w',
      profile: { profile_id: 'homepage-practice-s1', game: { template_tier: 'website' }, sdk_tools: { read: true, write: true } },
      systemPrompt: '', history: [], userText: '저장해 주세요', signal: new AbortController().signal, cwd: WS, stallTimeoutMs: 0,
      binaryResolution: { available: true, source: 'setting', path: '/opt/claude', reasons: [] }, sdk,
      onDelta: () => {}, onActivity: () => {}, onUsage: () => {}, onCitations: () => {}, onAssetScore: () => {},
      requestApproval: async (action) => { approvals.push(structuredClone(action)); await onApproval?.(action, approvals.length); return { approved: true, actor: 'user' }; },
    });
  } finally { console.warn = quiet; }
  return { approvals, decisions };
}

test('SDK: each write asks with its own path; a later write of another path is asked again, never covered', async () => {
  const a = path.join(WS, 'src/app.js'), b = path.join(WS, 'src/other.js');
  const r = await sdkTurn([['Write', { file_path: a, content: '1' }], ['Write', { file_path: b, content: '2' }]]);
  assert.equal(r.approvals.length, 2, 'no remembered write approval');
  assert.deepEqual(r.approvals.map((x) => x.input.file_path), [a, b]);
  assert.deepEqual(r.decisions.map((d) => [d.behavior, d.updatedInput?.file_path]), [['allow', a], ['allow', b]], 'positive control: what was listed is written');
});

test('SDK: a path that changes while the modal is open (a symlink swapped in) is refused, not written', async () => {
  const dir = path.join(WS, 'swap');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'page.html');
  const r = await sdkTurn([['Write', { file_path: target, content: 'x' }]], async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.symlinkSync(OUT, dir, process.platform === 'win32' ? 'junction' : 'dir');
  });
  assert.equal(r.approvals.length, 1);
  assert.equal(r.decisions[0].behavior, 'deny', JSON.stringify(r.decisions[0]));
  assert.match(r.decisions[0].message, /승인한 파일 목록/);
  fs.rmSync(dir, { force: true });
});

test('SDK: the input the approval saw cannot be changed into an unlisted path', async () => {
  const a = path.join(WS, 'listed.html');
  const r = await sdkTurn([['Write', { file_path: a, content: 'x' }]], async (action) => { try { action.input.file_path = path.join(WS, 'unlisted.html'); } catch { /* frozen */ } });
  const d = r.decisions[0];
  assert.ok(d.behavior === 'deny' || d.updatedInput.file_path === a, `the written path is the listed one or nothing: ${JSON.stringify(d)}`);
});

// ── Local runtime: the gate re-resolves the path after the answer ──
test('local runtime: a symlink swapped in during the approval is refused, not written', async () => {
  const { workspaceTools } = await import('../src/localRuntime/tools.ts');
  const dir = path.join(WS, 'lswap');
  fs.mkdirSync(dir, { recursive: true });
  const tools = workspaceTools({
    cwd: WS, profile: { profile_id: 'homepage-practice-s1', game: { template_tier: 'website' }, sdk_tools: { read: true, write: true } }, signal: new AbortController().signal,
    approve: async () => { fs.rmSync(dir, { recursive: true, force: true }); fs.symlinkSync(OUT, dir, process.platform === 'win32' ? 'junction' : 'dir'); return true; },
  });
  await assert.rejects(tools.call('Write', { file_path: 'lswap/x.txt', content: 'x' }), /경로가 바뀌었습니다|작업 폴더 밖/, 'refused either by the post-answer path check or by the re-run containment');
  assert.ok(!fs.existsSync(path.join(OUT, 'x.txt')), 'nothing written outside');
  fs.rmSync(dir, { force: true });
});
