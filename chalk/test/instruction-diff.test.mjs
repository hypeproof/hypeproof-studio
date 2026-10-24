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
  assert.deepEqual(kit.instructionDiff(same, structuredClone(same)), { skipped: false, rows: [], added: 0, removed: 0 });
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

test('the served page inlines the tested kit and names the reviewed base on confirm', async () => {
  // Rendered behaviour (markers, escaping, fold, lock) is covered in a real browser: e2e/chalk-authoring/confirm-diff.mjs.
  const r = await chalk.fetch(new Request('https://chalk.test/authoring'), env, {});
  const html = await r.text();
  assert.ok(!html.includes('/*@instruction-diff*/'), 'the marker is replaced by the kit');
  assert.ok(html.includes(INSTRUCTION_DIFF_SCRIPT), 'the page inlines exactly the tested kit');
  assert.match(html, /\|\|confirmDiff\?\.candidate!==readiness\?\.version\|\|confirmDiff\?\.state!=='ready';/, 'confirm waits for the diff of THIS candidate');
  assert.match(html, /compared_with:reviewed\.base\}/, 'the confirm request names the base it was reviewed against');
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
  assert.equal(kit.instructionText(lesson(['열기', '하나\n둘'], [' 고치기 ', ''])), '[단계] 열기\n하나\n둘\n[단계] 고치기');
  assert.equal(kit.instructionText({}), '');
  assert.equal(kit.instructionText(undefined), '');
});

test('inserting a step does not show later step headers as changed', () => {
  const steps = [['열기', 'a'], ['고치기', 'b'], ['확인', 'c']];
  const d = kit.instructionDiff(lesson(...steps), lesson(['준비', 'p'], ...steps));
  assert.deepEqual([d.added, d.removed], [2, 0], 'only the new header and its line');
});

test('Myers diff is a minimal edit script (fuzz against a brute-force LCS)', () => {
  const lcs = (a, b) => { const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    return t[0][0]; };
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 2000; n++) {
    const pick = () => Array.from({ length: Math.floor(rnd() * 12) }, () => 'abcd'[Math.floor(rnd() * 4)]);
    const a = pick(), b = pick(), rows = kit.lineDiff(a.join('\n'), b.join('\n'));
    assert.equal(rows.filter((r) => r.kind === 'same').length, lcs(a, b), JSON.stringify([a, b]));
    assert.deepEqual(rows.filter((r) => r.kind !== 'add').map((r) => r.text), a);
    assert.deepEqual(rows.filter((r) => r.kind !== 'del').map((r) => r.text), b);
  }
});

test('large lessons diff by line, never as a misleading full replace', () => {
  const big = Array.from({ length: 3000 }, (_, i) => 'line ' + i), edited = [...big];
  edited[0] = 'first'; edited[2999] = 'last';
  const d = kit.instructionDiff(lesson(['A', big.join('\n')]), lesson(['B', edited.join('\n')]));
  assert.equal(d.skipped, false);
  assert.deepEqual([d.added, d.removed], [3, 3], 'renamed header + first + last, not 3000/3000');
  // Beyond the edit limit the kit says it skipped; it does not invent thousands of 추가/삭제 lines.
  const other = Array.from({ length: 3000 }, (_, i) => 'other ' + i);
  const s = kit.instructionDiff(lesson(['A', big.join('\n')]), lesson(['A', other.join('\n')]));
  assert.deepEqual([s.skipped, s.rows.length, s.added, s.limit], [true, 0, null, kit.MAX_EDITS]);
  // Negative control: the same limit does not trip on a small change.
  assert.equal(kit.instructionDiff(lesson(['A', 'x']), lesson(['A', 'y']), 2).skipped, false);
});

test('a whitespace-only change is flagged, and composed/decomposed Hangul is not a change', () => {
  const rows = kit.lineDiff('abc\nx\ty', 'abc \nx y');
  assert.deepEqual(rows.map((r) => r.kind + (r.ws ? '/ws' : '')), ['del/ws', 'del/ws', 'add/ws', 'add/ws']);
  assert.deepEqual(kit.foldRows(kit.lineDiff('한글 수업'.normalize('NFD'), '한글 수업')), []);
  // Negative control: a real text change is not flagged as whitespace.
  assert.ok(kit.lineDiff('abc', 'abd').every((r) => !r.ws));
});

test('grouped fields use the same versions, hide unchanged groups and retain all changed values', () => {
  const before={title:'이전 제목',model:{default:'a',allowed:['a','b']},steps:[{id:'one',instructions:'이전'}],starter:'자료',learning:{week:1}};
  const after={...before,title:'<img src=x>',model:{allowed:['a','b'],default:'a'},steps:[{id:'one',instructions:'새 안내'}],learning:{week:2},extra:{a:1}};
  const groups=kit.groupedChanges(before,after);
  assert.deepEqual(groups.map(g=>g.label),['이름·소개','지시문','수업 기준','기타 설정']);
  assert.equal(groups[0].fields[0].before,'이전 제목');assert.equal(groups[0].fields[0].after,'<img src=x>');
  assert.deepEqual(kit.groupedChanges(before,structuredClone(before)),[]);
  assert.equal(kit.groupedChanges(before,{...before,model:{default:'a',allowed:['b','a']}})[0].label,'모델·기능','array order is preserved');
  assert.equal(kit.groupedChanges({starter:'자료'},{} )[0].fields[0].after,undefined,'removed setting remains a deletion');
  assert.deepEqual(before.steps,[{id:'one',instructions:'이전'}],'comparison never edits draft input');
});


test('grouped instructions normalize line endings and Hangul exactly like the line diff', () => {
  const old={steps:[{id:'s',title:'안내',instructions:'한글\r\n다음 줄\r\n'.normalize('NFD')}]};
  const next={steps:[{id:'s',title:'안내',instructions:'한글\n다음 줄'}]};
  assert.deepEqual(kit.groupedChanges(old,next),[]);
  assert.deepEqual(kit.instructionDiff(old,next).rows,[]);
  assert.equal(kit.groupedChanges(next,{steps:[{...next.steps[0],instructions:'한글\n다음 줄 '} ]}).length,1,'meaningful trailing spaces still show');
});


test('hostile property names remain literal labels, never inherited JavaScript members', () => {
 const next=JSON.parse('{"__proto__":{"title":"목표"},"constructor":"문자열"}');
 const fields=kit.groupedChanges({},next)[0].fields;
 assert.deepEqual(fields.map(f=>f.label),['__proto__','constructor']);
 assert.equal({}.title,undefined);
});
