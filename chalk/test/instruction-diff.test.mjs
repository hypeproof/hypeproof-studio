// CGP-AGENT-R-016 / CGP-DS-R-029 — the authoring confirm step diffs the candidate's step instructions against the
// newest confirmed version, line by line. The diff is a pure kit (src/lib/instruction-diff.ts) that the served page
// inlines verbatim, so the page and these tests run the same code.
import assert from 'node:assert/strict';
import test from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
const { instructionDiffKit, INSTRUCTION_DIFF_SCRIPT } = await import('../src/lib/instruction-diff.ts');
const { default: chalk } = await import('../src/index.ts');
const kit = instructionDiffKit();
const env = { HPS_SIGNING_SECRET: 'test-secret-0123456789abcdef', ENVIRONMENT: 'dev', HPS_SERVICE_ORIGIN: 'https://service.test' };
const lesson = (...steps) => ({ schema: 'hps-session-design/1', steps: steps.map(([title, instructions], n) => ({ id: 's' + n, title, instructions })) });
const kinds = (rows) => rows.map((r) => (r.kind === 'fold' ? 'fold:' + r.count : r.kind + ':' + r.text));
const lines = (n, p = 'line') => Array.from({ length: n }, (_, i) => p + ' ' + (i + 1));

test('identical text produces no diff lines', () => {
  const text = '첫 줄\n둘째 줄\n셋째 줄';
  assert.deepEqual(kit.foldRows(kit.lineDiff(text, text)), []);
  const same = lesson(['홈페이지 열기', '미리보기를 연다\n제목을 바꾼다']);
  assert.deepEqual(kit.instructionDiff(same, structuredClone(same)), { rows: [], added: 0, removed: 0 });
  // Negative control: the instrument is not "always empty" — one changed word in the same lesson is reported.
  const changed = lesson(['홈페이지 열기', '미리보기를 연다\n부제목을 바꾼다']);
  assert.deepEqual(kit.instructionDiff(same, changed).rows.map((r) => r.kind).filter((k) => k !== 'same'), ['del', 'add']);
});

test('added and removed lines carry their own kind, independent of colour', () => {
  assert.deepEqual(kinds(kit.lineDiff('a\nb\nc', 'a\nB\nc\nd')), ['same:a', 'del:b', 'add:B', 'same:c', 'add:d']);
  assert.deepEqual(kinds(kit.lineDiff('', 'new')), ['add:new']);
  assert.deepEqual(kinds(kit.lineDiff('gone', '')), ['del:gone']);
  const d = kit.instructionDiff(lesson(['A', 'x\ny']), lesson(['A', 'x\nz'], ['B', 'w']));
  assert.equal(d.added, 3, 'z, the new step header and its line, counted');
  assert.equal(d.removed, 1);
});

test('the served confirm step marks each line with a glyph AND a spoken word, never colour alone', async () => {
  const r = await chalk.fetch(new Request('https://chalk.test/authoring'), env, {});
  const html = await r.text();
  assert.match(html, /const DIFF_WORDS=\{add:\['\+','추가'\],del:\['−','삭제'\],same:\['','변경 없음'\]\};/, 'visible +/− glyph and a 추가/삭제 word per kind');
  assert.match(html, /className:'sr-only',textContent:word\+': '/, 'each line starts with its state word for screen readers');
  assert.match(html, /document\.createElement\(kind==='add'\?'ins':kind==='del'\?'del':'span'\)/, 'added text is <ins> (underlined), removed is <del> (struck)');
  assert.match(html, /#confirm-diff-lines ins\{text-decoration:underline/, 'added text is underlined');
  assert.match(html, /#confirm-diff-lines del\{text-decoration:line-through/, 'removed text is struck through');
  assert.match(html, /<ol id="confirm-diff-lines" aria-labelledby="confirm-diff-title" tabindex="0" hidden><\/ol>/, 'the list is a named, keyboard-scrollable region');
  assert.doesNotMatch(html, /confirm-diff-lines'\)\.innerHTML/, 'lesson text is never rendered as HTML');
  assert.ok(!html.includes('/*@instruction-diff*/'), 'the marker is replaced by the kit');
  assert.ok(html.includes(INSTRUCTION_DIFF_SCRIPT), 'the page inlines exactly the tested kit');
  // REQ-CGP-AGENT-28: confirm stays disabled until the diff for THIS candidate has loaded.
  assert.match(html, /\|\|confirmDiff\?\.candidate!==readiness\?\.version\|\|confirmDiff\?\.state!=='ready';/);
  // Both sides come from reads the page already makes; no new endpoint.
  assert.match(html, /await call\(scope\(\)\+'\/versions'\);const base=list\.versions\.find\(x=>x\.confirmed&&x\.version!==r\.version\);/);
  assert.match(html, /instructionDiffKit\.instructionDiff\(d\.module\?\.content,r\.content\)/);
});

test('the inlined script runs standalone (no bundler helpers in scope)', () => {
  // The bundle's keep-names pass injects __name(...) calls; simulate them and prove the wrapper supplies the helper.
  const src = INSTRUCTION_DIFF_SCRIPT.replace('return { splitLines', '__name(splitLines, "splitLines");\n  return { splitLines');
  const k = new Function(src + '\nreturn instructionDiffKit;')();
  assert.deepEqual(kinds(k.lineDiff('a', 'b')), ['del:a', 'add:b']);
});

test('unchanged runs longer than 3 lines fold into one "변경 없음" row', () => {
  const before = [...lines(10), 'old', ...lines(12, 'tail')].join('\n');
  const after = [...lines(10), 'new', ...lines(12, 'tail')].join('\n');
  const rows = kit.foldRows(kit.lineDiff(before, after));
  assert.deepEqual(kinds(rows), ['fold:9', 'same:line 10', 'del:old', 'add:new', 'same:tail 1', 'fold:11']);
  const folds = rows.filter((r) => r.kind === 'fold');
  assert.deepEqual(folds[0].lines, lines(9), 'the fold keeps its lines so the instructor can expand it');
  assert.equal(folds[1].lines.length, 11);
  // Between two changes, one context line stays on each side.
  const mid = kit.foldRows(kit.lineDiff(['x', ...lines(8), 'y'].join('\n'), ['X', ...lines(8), 'Y'].join('\n')));
  assert.deepEqual(kinds(mid), ['del:x', 'add:X', 'same:line 1', 'fold:6', 'same:line 8', 'del:y', 'add:Y']);
  // Negative control: a run of exactly 3 unchanged lines is shown, not folded.
  assert.deepEqual(kinds(kit.foldRows(kit.lineDiff('a\n1\n2\n3\nb', 'A\n1\n2\n3\nB'))), ['del:a', 'add:A', 'same:1', 'same:2', 'same:3', 'del:b', 'add:B']);
});

test('CRLF and a trailing newline do not create a false diff', () => {
  assert.deepEqual(kit.foldRows(kit.lineDiff('a\r\nb\r\n', 'a\nb')), []);
  assert.deepEqual(kit.foldRows(kit.lineDiff('a\rb', 'a\nb\n')), []);
  assert.deepEqual(kit.instructionDiff(lesson(['T', '하나\r\n둘\r\n']), lesson(['T', '하나\n둘'])).rows, []);
  // Negative control: an extra blank line is real content and is still reported.
  assert.deepEqual(kinds(kit.lineDiff('a\nb', 'a\nb\n\n')), ['same:a', 'same:b', 'add:']);
});

test('instruction text is step headers plus each step’s 안내 lines', () => {
  assert.equal(kit.instructionText(lesson(['열기', '하나\n둘'], [' 고치기 ', ''])), '[1. 열기]\n하나\n둘\n[2. 고치기]');
  assert.equal(kit.instructionText({}), '');
  assert.equal(kit.instructionText(undefined), '');
});
