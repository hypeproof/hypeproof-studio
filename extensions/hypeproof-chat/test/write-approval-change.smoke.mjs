// REQ-STUDIO-WRITE-APPROVAL-CHANGE (CGP-ART-R-021 / REQ-ART-21) — when the coach asks approval to overwrite an
// existing workspace file, the write approval carries a before/after summary from diffGuard (share changed and
// lines changed), computed before the write; a rewrite (changed_ratio above REWRITE_RATIO) reads "거의 전부
// 바뀌어요"; an overwrite whose change cannot be computed says so; never an overwrite with neither.
//
// 1. Pure module (writeApprovalChange.ts): the call's text, the CLI's replacement rules, the file reader.
// 2. The real chatPanelProvider bundled with a scripted `vscode` (as write-approval-paths.test.mjs does): the
//    prompt the dialog receives, the file untouched at prompt time, a file changed or created while the dialog
//    is open refused, a webview-origin request never supplying the text.
// .claude/rules/verification.md §2: each label has a control that must not get it.
// Run: node --experimental-strip-types test/write-approval-change.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';

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

const C = await import('../src/writeApprovalChange.ts');
const { REWRITE_RATIO } = await import('../src/diffGuard.ts');
const { sdkToolToActionRequest } = await import('../src/sdkCoachHelpers.ts');

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hps-write-change-')));
const WS = path.join(scratch, 'ws');
fs.mkdirSync(WS, { recursive: true });
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };

const PAGE = ['<!doctype html>', '<html>', '<head><title>내 가게</title></head>', '<body>',
  '<section id="hero"><h1>어서 오세요</h1></section>', '<section id="menu"><p>커피 3000원</p><p>차 2500원</p></section>',
  '<section id="info"><p>월요일 휴무</p></section>', '</body>', '</html>', ''].join('\n');
const REWRITE = ['<!doctype html>', '<html><body>', '<main><h2>완전히 새 페이지</h2><p>다른 내용 하나</p><p>다른 내용 둘</p></main>', '</body></html>', ''].join('\n');

try {
  // ── 1. The call's text and the CLI's replacement rules ──
  {
    assert.deepEqual(C.writeEditOf('Write', { file_path: 'a', content: 'x' }), { tool: 'write', content: 'x' });
    assert.deepEqual(C.writeEditOf('Edit', { file_path: 'a', old_string: 'o', new_string: 'n' }), { tool: 'edit', edits: [{ old_string: 'o', new_string: 'n', replace_all: false }] });
    assert.deepEqual(C.writeEditOf('MultiEdit', { file_path: 'a', edits: [{ old_string: 'a', new_string: 'b', replace_all: true }, { old_string: 'c', new_string: 'd' }] }).edits.map((e) => e.replace_all), [true, false]);
    assert.equal(C.writeEditOf('Write', { file_path: 'a' }), null, 'Write without content');
    assert.equal(C.writeEditOf('NotebookEdit', { notebook_path: 'a.ipynb', new_source: 'x' }), null, 'NotebookEdit is not computed');
    assert.equal(C.writeEditOf('Edit', { file_path: 'a', old_string: 1, new_string: 'n' }), null);
    assert.equal(C.writeEditOf('MultiEdit', { file_path: 'a', edits: [] }), null);
    assert.equal(C.asWriteEdit({ tool: 'write', content: 7 }), null, 'a malformed payload is not trusted');
    assert.equal(C.asWriteEdit({ tool: 'shell', content: 'x' }), null);
    assert.equal(C.asWriteEdit('x'), null);

    const edit = (o, n, all = false) => ({ tool: 'edit', edits: [{ old_string: o, new_string: n, replace_all: all }] });
    assert.equal(C.applyWriteEdit('a b a', edit('b', '$&$1')), 'a $&$1 a', '$ patterns in new_string are literal');
    assert.equal(C.applyWriteEdit('a b a', edit('a', 'z')), null, 'ambiguous old_string without replace_all: the CLI refuses');
    assert.deepEqual(C.applyWriteEditResult('a b a', edit('a', 'z')), { refused: 'ambiguous' });
    assert.deepEqual(C.applyWriteEditResult('a b', edit('a', 'a')), { refused: 'no-change' });
    assert.deepEqual(C.applyWriteEditResult('a b', edit('q', 'z')), { refused: 'no-match' });
    assert.equal(C.applyWriteEdit('a b a', edit('a', 'z', true)), 'z b z', 'replace_all');
    assert.equal(C.applyWriteEdit('a b', edit('q', 'z')), null, 'no match');
    assert.equal(C.applyWriteEdit('a b', edit('', 'z')), null, 'empty old_string on an existing file');
    assert.equal(C.applyWriteEdit('a b', { tool: 'edit', edits: [{ old_string: 'a', new_string: 'c', replace_all: false }, { old_string: 'c b', new_string: 'done', replace_all: false }] }), 'done', 'edits apply in order');
    ok('call text: Write content, Edit/MultiEdit with the CLI rules; NotebookEdit and malformed input are not computed');
  }

  // ── 2. The file as it is now ──
  {
    const file = path.join(WS, 'read.html');
    assert.deepEqual(C.readExistingText(file), { exists: false, fingerprint: 'absent' });
    fs.writeFileSync(file, '안녕');
    const r = C.readExistingText(file);
    assert.equal(r.exists, true); assert.equal(r.text, '안녕'); assert.match(r.fingerprint, /^[0-9a-f]{64}$/);
    fs.writeFileSync(file, Buffer.from([0x68, 0x00, 0x69]));
    assert.equal(C.readExistingText(file).reason, 'binary', 'NUL byte');
    fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0x41]));
    assert.equal(C.readExistingText(file).reason, 'binary', 'not UTF-8');
    fs.writeFileSync(file, 'x'.repeat(64));
    assert.equal(C.readExistingText(file, undefined, 10).reason, 'large');
    assert.equal(C.readExistingText(WS).reason, 'unreadable', 'a folder is not a text file');
    assert.equal(C.readExistingText(path.join(file, 'below')).exists, false, 'ENOTDIR is absent');
    ok('reader: absent, UTF-8 text with a sha256 fingerprint, binary, not UTF-8, too large, folder');
  }

  // ── 3. The view: measured, rewrite, unknown, none for a new file ──
  {
    const existing = (text) => ({ exists: true, fingerprint: 'f', text });
    const partial = C.writeChangeView(existing(PAGE), { tool: 'edit', edits: [{ old_string: '월요일 휴무', new_string: '화요일 휴무', replace_all: false }] }, 'index.html');
    assert.equal(partial.kind, 'measured'); assert.equal(partial.rewrite, false);
    assert.ok(partial.ratio > 0 && partial.ratio < REWRITE_RATIO, String(partial.ratio));
    assert.match(partial.percent, /^\d+%$/); assert.equal(partial.changedLines, 1);
    assert.equal(C.writeChangeDetail(partial), '바뀌는 줄 1개 · 새 줄 1개');
    const rewrite = C.writeChangeView(existing(PAGE), { tool: 'write', content: REWRITE }, 'index.html');
    assert.equal(rewrite.rewrite, true, 'a regenerated page is a rewrite'); assert.ok(rewrite.ratio > REWRITE_RATIO);
    assert.equal(rewrite.almostAll, rewrite.ratio >= C.ALMOST_ALL_RATIO); assert.equal(C.writeChangeWarning(rewrite), rewrite.almostAll ? '거의 전부 바뀌어요' : '절반 넘게 바뀌어요');
    assert.equal(C.writeChangeWarning(partial), null, 'negative control: a partial edit has no warning');
    const half = C.writeChangeView(existing('a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n'), { tool: 'write', content: 'a\nb\nc\nX\nY\nZ\nW\nV\nU\nj\n' }, 'x.txt');
    assert.ok(half.rewrite && !half.almostAll, `60% is a rewrite but not almost all: ${half.ratio}`);
    assert.equal(C.writeChangeWarning(half), '절반 넘게 바뀌어요');
    const full = C.writeChangeView(existing(PAGE), { tool: 'write', content: 'x\n' }, 'index.html');
    assert.equal(full.almostAll, true); assert.equal(C.writeChangeWarning(full), '거의 전부 바뀌어요');
    const same = C.writeChangeView(existing(PAGE), { tool: 'write', content: PAGE }, 'index.html');
    assert.equal(same.percent, '0%'); assert.equal(same.rewrite, false); assert.equal(C.writeChangeDetail(same), '내용은 그대로예요'); assert.equal(same.spacingOnly, false);
    const spaced = C.writeChangeView(existing(PAGE), { tool: 'write', content: PAGE.replace('<body>', '<body>  ') }, 'index.html');
    assert.equal(spaced.spacingOnly, true); assert.equal(C.writeChangeDetail(spaced), '글자는 그대로, 띄어쓰기·줄바꿈만 달라져요', 'whitespace-only is not called 그대로');
    const added = C.writeChangeView(existing(PAGE), { tool: 'edit', edits: [{ old_string: '</body>', new_string: '<footer>끝</footer>\n</body>', replace_all: false }] }, 'index.html');
    assert.equal(added.ratio, 0); assert.equal(C.writeChangeDetail(added), '새 줄 1개', 'an addition changes no existing content');
    assert.equal(C.writeChangeView({ exists: false, fingerprint: 'absent' }, { tool: 'write', content: 'x' }, 'n.html'), null, 'a new file has no summary');
    assert.deepEqual(C.writeChangeView(existing(PAGE), null, 'index.html'), { kind: 'unknown', reason: 'no-edit' });
    assert.deepEqual(C.writeChangeView(existing(PAGE), { tool: 'edit', edits: [{ old_string: '없는 글', new_string: 'x', replace_all: false }] }, 'index.html'), { kind: 'unknown', reason: 'no-match' });
    assert.deepEqual(C.writeChangeView({ exists: true, fingerprint: 'f', text: null, reason: 'large' }, { tool: 'write', content: 'x' }, 'big.html'), { kind: 'unknown', reason: 'large' });
    ok('view: partial below REWRITE_RATIO, rewrite above it, unchanged, pure addition, unknown, none for a new file');
    // CGP-ART-D-021: "바뀐 곳 보기" compares exactly the summarised bytes with the call's text; nothing when they match.
    assert.equal(spaced.diff, true); assert.equal(added.diff, true);
    assert.equal(C.writeChangeView(existing(PAGE), { tool: 'write', content: PAGE }, 'index.html').diff, false, 'identical text: no diff');
    assert.deepEqual(C.writeChangeComparison(existing(PAGE), { tool: 'edit', edits: [{ old_string: '월요일', new_string: '화요일', replace_all: false }] }), { before: PAGE, after: PAGE.replace('월요일', '화요일') });
    assert.equal(C.writeChangeComparison(existing(PAGE), { tool: 'write', content: PAGE }), null);
    assert.equal(C.writeChangeComparison(existing(PAGE), null), null);
    assert.equal(C.writeChangeComparison(existing(PAGE), { tool: 'edit', edits: [{ old_string: '없는 글', new_string: 'x', replace_all: false }] }), null, 'a refused replacement has nothing to show');
    assert.equal(C.writeChangeComparison({ exists: false, fingerprint: 'absent' }, { tool: 'write', content: 'x' }), null);
    assert.equal(C.writeChangeComparison({ exists: true, fingerprint: 'f', text: null, reason: 'binary' }, { tool: 'write', content: 'x' }), null);
    ok('comparison: the summarised before text and the call\'s after text; none for identical, refused, new or unreadable');
  }

  // ── 4. The request carries the call's text (host-built only) ──
  {
    const req = sdkToolToActionRequest({ toolName: 'Edit', input: { file_path: path.join(WS, 'index.html'), old_string: 'a', new_string: 'b' } });
    assert.deepEqual(req.payload.edit, { tool: 'edit', edits: [{ old_string: 'a', new_string: 'b', replace_all: false }] });
    assert.deepEqual(sdkToolToActionRequest({ toolName: 'Write', input: { file_path: 'x.html', content: 'c' } }).payload.edit, { tool: 'write', content: 'c' });
    ok('sdkToolToActionRequest: payload.edit for Write and Edit');
  }

  // ── 5. The real host: the prompt the dialog receives ──
  const require = createRequire(import.meta.url);
  const bundle = await build({ entryPoints: [new URL('../src/chatPanelProvider.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' });
  // CGP-ART-D-021: just enough of the editor API to see which diff opens, with what text, and which tabs close.
  class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
  const diffCalls = [], closedTabs = [], openTabs = [], providers = new Map();
  let onDiff = null;
  const vscode = {
    TabInputTextDiff, ViewColumn: { Beside: -2 },
    Uri: { from: ({ scheme, path: p }) => ({ scheme, path: p, toString: () => `${scheme}:${p}` }) },
    commands: { executeCommand: async (cmd, left, right, title, opts) => {
      diffCalls.push({ cmd, left: left.toString(), right: right.toString(), title, opts, before: providers.get(left.scheme).provideTextDocumentContent(left), after: providers.get(right.scheme).provideTextDocumentContent(right) });
      await onDiff?.(); // e.g. the dialog answered while the editor is still opening: the tab appears after that
      if (!openTabs.some((t) => t.input.original.toString() === left.toString())) openTabs.push({ input: new TabInputTextDiff(left, right) }); // the editor reuses an open diff
    } },
    window: { showWarningMessage: async () => undefined, tabGroups: { get all() { return [{ tabs: [...openTabs] }]; }, close: async (tabs) => { for (const t of tabs) { closedTabs.push(t.input.original.toString()); openTabs.splice(openTabs.indexOf(t), 1); } return true; } } },
    workspace: {
      registerTextDocumentContentProvider: (scheme, provider) => { providers.set(scheme, provider); return { dispose() {} }; },
      getConfiguration: () => ({ get: (key, fallback) => (key === 'requireApprovalFor' ? ['executeShell', 'openBrowser', 'delegateAgent', 'browserType', 'writeFile'] : fallback) }),
      workspaceFolders: [{ uri: { fsPath: WS } }],
    },
  };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, AbortSignal, URL, TextEncoder, TextDecoder });
  const P = mod.exports.ChatPanelProvider.prototype;
  const prompts = [];
  let during = () => {};
  let answer = true;
  const host = { postDenialNotice: async () => {}, approvedCommandSignatures: new Set(), approvedBrowserOrigins: new Set(), coachDisplayName: () => '코치', sitePublisher: () => ({ allowed: () => false }), resolveCoachCwd: () => WS, post: async () => true };
  host.writeApprovalScope = () => WS;
  host.context = { secrets: { get: async () => 'token' } };
  host.confirmWriteFiles = (...args) => P.confirmWriteFiles.call(host, ...args);
  host.resolveActionApprovalTracked = (req) => P.resolveActionApproval.call(host, req);
  host.writeApprovalRequest = { invalidate() {}, confirm: async (prompt) => { prompts.push(structuredClone(prompt)); await during(prompt); return answer; } };
  Object.assign(host, { writeApprovalDiffs: new Map(), writeApprovalDiffSeq: 0, writeApprovalDiffScheme: 'hps-write-approval-test', writeApprovalDiffContent: new Map() });
  for (const m of ['openWriteApprovalDiff', 'closeWriteApprovalDiffs', 'closeWriteApprovalDiffTabs']) host[m] = (...a) => P[m].call(host, ...a);
  const ask = async (toolName, input) => {
    prompts.length = 0;
    const approved = await P.resolveActionApproval.call(host, { requestId: 'r', ...sdkToolToActionRequest({ toolName, input }) });
    return { approved, prompt: prompts[0] };
  };

  {
    const page = path.join(WS, 'index.html');
    fs.writeFileSync(page, PAGE);
    let seenOnDisk = null;
    during = () => { seenOnDisk = fs.readFileSync(page, 'utf8'); };
    const edit = await ask('Edit', { file_path: page, old_string: '월요일 휴무', new_string: '화요일 휴무' });
    assert.equal(edit.approved, true);
    assert.equal(seenOnDisk, PAGE, 'the summary is computed and shown while the file is still the old one');
    assert.equal(edit.prompt.files[0], '작업 폴더/index.html · 바꿈');
    assert.equal(edit.prompt.changes.length, 1);
    assert.equal(edit.prompt.changes[0].kind, 'measured'); assert.equal(edit.prompt.changes[0].rewrite, false);
    const rewrite = await ask('Write', { file_path: page, content: REWRITE });
    assert.equal(rewrite.prompt.changes[0].rewrite, true, 'rewrite flagged');
    assert.ok(!JSON.stringify(rewrite.prompt).includes('완전히 새 페이지'), 'the call text never reaches the webview prompt');
    const fresh = await ask('Write', { file_path: path.join(WS, 'new.html'), content: REWRITE });
    assert.deepEqual(fresh.prompt.changes, [null], 'a new file: no summary');
    assert.equal(fresh.approved, true);
    const nomatch = await ask('Edit', { file_path: page, old_string: '없는 글', new_string: 'x' });
    assert.deepEqual(nomatch.prompt.changes[0], { kind: 'unknown', reason: 'no-match' });
    const twice = await ask('Edit', { file_path: page, old_string: '<section', new_string: '<div' });
    assert.deepEqual(twice.prompt.changes[0], { kind: 'unknown', reason: 'ambiguous' });
    during = () => {};
    ok('host: the dialog prompt has the summary before the write; rewrite flagged; new file none; text stays host-side');
  }

  {
    // CGP-ART-D-021: "바뀐 곳 보기" from the real host.
    const page = path.join(WS, 'diff.html');
    fs.writeFileSync(page, PAGE);
    let seen = null;
    during = async (prompt) => {
      seen = { id: prompt.id, material: host.writeApprovalDiffs.has(prompt.id) };
      for (const [id, index] of [[prompt.id, 1], [prompt.id, -1], [prompt.id, '0'], [prompt.id, 0.5], ['other', 0], [7, 0]]) await host.openWriteApprovalDiff(id, index);
      assert.equal(diffCalls.length, 0, 'a wrong id, a missing or malformed index opens nothing');
      fs.writeFileSync(page, PAGE.replace('커피', '라떼')); // changed after the summary, before the press
      await host.openWriteApprovalDiff(prompt.id, 0);
      await host.openWriteApprovalDiff(prompt.id, 0);
    };
    const r = await ask('Write', { file_path: page, content: REWRITE });
    assert.equal(seen.material, true);
    assert.equal(diffCalls.length, 2);
    const [first, again] = diffCalls;
    assert.equal(first.cmd, 'vscode.diff');
    assert.equal(first.before, PAGE, 'left is the file as summarised, not as it is when the button is pressed');
    assert.equal(first.after, REWRITE, 'right is the text the call leaves behind');
    assert.equal(again.before, PAGE, 'a second press shows the same summarised bytes, not a re-read');
    assert.equal(again.left, first.left, 'a second press reopens the same diff');
    assert.ok(first.left.endsWith('/0/지금/diff.html') && first.right.endsWith('/0/승인하면/diff.html'), first.left);
    assert.equal(first.title, '작업 폴더/diff.html · 지금 ↔ 승인하면');
    assert.deepEqual({ ...first.opts }, { preview: true, preserveFocus: true, viewColumn: -2 }, 'the dialog keeps focus; the chat stays visible');
    assert.equal(r.approved, false, 'the file changed while the dialog was open: still refused (the diff does not refresh the summary)');
    assert.equal(host.writeApprovalDiffs.size, 0, 'answered: the texts are dropped');
    assert.equal(host.writeApprovalDiffContent.size, 0);
    assert.deepEqual(closedTabs, [first.left], 'answered: the diff tab closes');
    diffCalls.length = 0;
    await host.openWriteApprovalDiff(seen.id, 0);
    assert.equal(diffCalls.length, 0, 'after the answer the diff cannot open');

    // Answered while the editor was still opening: the tab that opened late is closed too.
    fs.writeFileSync(page, PAGE);
    closedTabs.length = 0;
    let late = null;
    during = async (prompt) => { onDiff = () => P.closeWriteApprovalDiffs.call(host, prompt.id); await host.openWriteApprovalDiff(prompt.id, 0); onDiff = null; late = diffCalls.at(-1); };
    await ask('Edit', { file_path: page, old_string: '월요일 휴무', new_string: '화요일 휴무' });
    assert.equal(late.after, PAGE.replace('월요일 휴무', '화요일 휴무'));
    assert.deepEqual(closedTabs, [late.left]); assert.equal(openTabs.length, 0);

    // Denied (also Escape, timeout and panel close: confirm resolves false for each): the tab closes and the texts go.
    closedTabs.length = 0;
    let denied = null;
    answer = false;
    during = async (prompt) => { await host.openWriteApprovalDiff(prompt.id, 0); denied = diffCalls.at(-1); assert.equal(openTabs.length, 1); };
    const no = await ask('Edit', { file_path: page, old_string: '월요일 휴무', new_string: '화요일 휴무' });
    answer = true;
    assert.equal(no.approved, false);
    assert.deepEqual(closedTabs, [denied.left], 'denied: the diff tab closes');
    assert.equal(openTabs.length, 0);
    assert.equal(host.writeApprovalDiffs.size, 0, 'denied: the texts are dropped');
    assert.equal(host.writeApprovalDiffContent.size, 0);

    // No diff to offer: a new file, identical text, an unknown change, a webview-origin request.
    const offered = [];
    during = (prompt) => { offered.push(host.writeApprovalDiffs.has(prompt.id)); };
    await ask('Write', { file_path: path.join(WS, 'brand-new.html'), content: REWRITE });
    await ask('Write', { file_path: page, content: PAGE });
    await ask('Edit', { file_path: page, old_string: '없는 글', new_string: 'x' });
    await P.handleActionRequest.call(host, { requestId: 'w2', kind: 'writeFile', description: 'x', payload: { path: page, edit: { tool: 'write', content: REWRITE } } });
    assert.deepEqual(offered, [false, false, false, false]);
    assert.equal(prompts[0].changes[0].diff, undefined, 'the webview-origin view carries no diff flag');
    during = () => {};
    ok('host: 바뀐 곳 보기 opens the summarised bytes beside the call text, bound to the pending request, closed and dropped on the answer');
  }

  {
    const page = path.join(WS, 'race.html');
    fs.writeFileSync(page, PAGE);
    during = () => fs.writeFileSync(page, PAGE.replace('커피', '라떼'));
    assert.equal((await ask('Write', { file_path: page, content: REWRITE })).approved, false, 'changed while the dialog was open');
    const born = path.join(WS, 'born.html');
    during = () => fs.writeFileSync(born, PAGE);
    const r = await ask('Write', { file_path: born, content: REWRITE });
    assert.deepEqual(r.prompt.changes, [null]);
    assert.equal(r.approved, false, 'created while the dialog was open: an overwrite the learner never saw summarised');
    during = () => fs.rmSync(page);
    assert.equal((await ask('Write', { file_path: page, content: REWRITE })).approved, false, 'removed while the dialog was open');
    during = () => {};
    const big = path.join(WS, 'big.txt');
    fs.writeFileSync(big, 'a'.repeat(3 * 1024 * 1024));
    during = () => fs.writeFileSync(big, 'b' + 'a'.repeat(3 * 1024 * 1024 - 1));
    const large = await ask('Write', { file_path: big, content: 'x' });
    assert.deepEqual(large.prompt.changes[0], { kind: 'unknown', reason: 'large' });
    assert.equal(large.approved, false, 'a same-size change to a file too large to diff is still seen (whole-file hash)');
    // Same size AND same mtime (restored to a whole second, so no sub-ms drift): only a content hash can see it.
    const pin = (p) => fs.utimesSync(p, 1_000_000_000, 1_000_000_000);
    fs.writeFileSync(page, PAGE); pin(page);
    during = () => { fs.writeFileSync(page, PAGE.replace('커피', '라떼')); pin(page); };
    assert.equal((await ask('Write', { file_path: page, content: REWRITE })).approved, false, 'a same-size, same-mtime edit is refused');
    fs.writeFileSync(big, 'a'.repeat(3 * 1024 * 1024)); pin(big);
    during = () => { fs.writeFileSync(big, 'b' + 'a'.repeat(3 * 1024 * 1024 - 1)); pin(big); };
    assert.equal((await ask('Write', { file_path: big, content: 'x' })).approved, false, 'a same-size, same-mtime edit to a file too large to diff is refused');
    during = () => {};
    assert.equal((await ask('Write', { file_path: big, content: 'x' })).approved, true, 'positive control: untouched large file');
    fs.writeFileSync(page, PAGE);
    assert.equal((await ask('Write', { file_path: page, content: REWRITE })).approved, true, 'positive control: unchanged file is approved');
    answer = false;
    assert.equal((await ask('Write', { file_path: page, content: REWRITE })).approved, false, 'deny stays deny');
    answer = true;
    ok('host: a file changed, created or removed while the dialog is open is refused; unchanged is approved');
  }

  {
    const page = path.join(WS, 'index.html');
    fs.writeFileSync(page, PAGE);
    prompts.length = 0;
    await P.handleActionRequest.call(host, { requestId: 'w', kind: 'writeFile', description: 'x', payload: { path: page, edit: { tool: 'write', content: PAGE } } });
    assert.deepEqual(prompts[0].changes[0], { kind: 'unknown', reason: 'no-edit' }, 'a webview-origin edit is ignored: no forged "unchanged"');
    prompts.length = 0;
    await P.resolveActionApproval.call(host, { requestId: 'm', kind: 'writeFile', description: 'x', payload: { paths: [{ path: page }, { path: path.join(WS, 'other.html') }], edit: { tool: 'write', content: PAGE } } });
    assert.deepEqual(prompts[0].changes, [{ kind: 'unknown', reason: 'no-edit' }, null], 'several targets: one call text cannot describe each');
    ok('host: webview-origin and multi-target requests never get a computed summary');
  }

  console.log(`PASS write approval change summary (${passed} checks)`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
