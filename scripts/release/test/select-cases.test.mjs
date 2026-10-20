// Controls for the release casebook (REQ-STUDIO-RELEASE-CASEBOOK). Local git only, no GitHub.
//   node --test scripts/release/test/select-cases.test.mjs
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {CASEBOOK_DIR, loadCasebook, parseYaml, validateCasebook} from '../casebook.mjs';
import {appChanged, decide} from '../daily-gate.mjs';
import {idsFromDiff, isRecentEscape, linkedTouched, renderMarkdown, requirementIds, run, selectCases} from '../select-cases.mjs';
import {CLEAR, HOLD, extractRun, validateRun} from '../validate-blackbox-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const kase = (id, extra = {}) => ({
  id, journey: 'CUJ-1', priority: 'P1', title: `case ${id}`, requirements: ['REQ-A1'],
  steps: ['step'], expect: ['expect'], origin: {kind: 'design'}, ...extra,
});
const book = cases => ({journeys: [{id: 'CUJ-1', title: 'J1', goal: 'g'}, {id: 'CUJ-2', title: 'J2', goal: 'g'}], cases});

// --- YAML subset parser -------------------------------------------------------------------

test('parseYaml reads the subset the casebook uses', () => {
  const doc = parseYaml([
    '# comment',
    'cases:',
    '  - id: BB-001',
    '    requirements: [REQ-STUDIO-FREE-START, "TUX-SP-14"]',
    '    title: "첫 결과물 # not a comment"',
    '    quoted: "바로 시작하기: 버튼"',
    "    single: 'it''s'",
    '    steps:',
    '      - 설치한다',
    '      - 앱에서 "참여 코드가 있어요" 를 누르지 않는다',
    '    notes: |',
    '      line one',
    '',
    '      line three',
    '    n: 3',
    '    flag: false',
    '    empty:',
    'tail: ~',
  ].join('\n'));
  assert.deepEqual(doc.cases[0], {
    id: 'BB-001', requirements: ['REQ-STUDIO-FREE-START', 'TUX-SP-14'], title: '첫 결과물 # not a comment',
    quoted: '바로 시작하기: 버튼', single: "it's", steps: ['설치한다', '앱에서 "참여 코드가 있어요" 를 누르지 않는다'],
    notes: 'line one\n\nline three\n', n: 3, flag: false, empty: null,
  });
  assert.equal(doc.tail, null);
});

test('parseYaml refuses what it does not understand instead of half-reading it', () => {
  assert.throws(() => parseYaml('a:\n\t- b'), /tab/);
  assert.throws(() => parseYaml('a: &anchor b'), /unsupported/);
  assert.throws(() => parseYaml('a: "open'), /unterminated/);
  assert.throws(() => parseYaml('a:\n  - "quoted" then text'), /unterminated/);
  assert.throws(() => parseYaml('a: 1\na: 2'), /duplicate key/);
  assert.throws(() => parseYaml('a: 1\n   b: 2'), /indentation/);
  assert.throws(() => parseYaml('a: [x, [y]]'), /nested/);
  assert.throws(() => parseYaml('ref: #2094'), /quote a value that starts with #/);
  assert.throws(() => parseYaml('date: 2026-10-20'), /quote the date/);
  assert.throws(() => parseYaml('a: b # trailing'), /quote a value containing/);
  assert.throws(() => parseYaml('a:\n  - 확인: 문구'), /quote a value containing/);
  assert.throws(() => parseYaml('a: no'), /YAML 1.1 boolean/);
});

test('the real casebook parses the same as PyYAML (cross-check when PyYAML is installed)', t => {
  const probe = spawnSync('python3', ['-c', 'import yaml'], {encoding: 'utf8'});
  if (probe.status !== 0) return t.skip('PyYAML not installed');
  for (const f of ['journeys.yaml', 'cases.yaml']) {
    const file = path.join(CASEBOOK_DIR, f);
    const py = execFileSync('python3', ['-c', 'import json,sys,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1],encoding="utf-8")),ensure_ascii=False))', file], {encoding: 'utf8'});
    assert.deepEqual(parseYaml(fs.readFileSync(file, 'utf8'), f), JSON.parse(py), f);
  }
});

// --- the real casebook ----------------------------------------------------------------------

test('the real casebook is valid, every journey has a P0 case and the three 2026-10-20 escapes are recorded', () => {
  const {journeys, cases} = loadCasebook();
  for (const j of journeys) assert.ok(cases.some(c => c.journey === j.id && c.priority === 'P0'), `${j.id} has no P0 case`);
  const escapes = cases.filter(c => c.origin.kind === 'escaped-bug' && c.origin.date === '2026-10-20');
  assert.ok(escapes.length >= 3, `expected the three escaped bugs of 2026-10-20, found ${escapes.length}`);
  assert.ok(escapes.some(c => /#2094/.test(c.origin.ref)), 'free start folder conflict (#2094) missing');
});

test('validateCasebook: a well-formed case passes; each broken field is named', () => {
  assert.deepEqual(validateCasebook(book([kase('BB-001')])), []);
  const bad = validateCasebook(book([
    kase('BB-1'),
    kase('BB-002', {journey: 'CUJ-9'}),
    kase('BB-003', {priority: 'P5'}),
    kase('BB-004', {requirements: ['ticket-12']}),
    kase('BB-005', {origin: {kind: 'escaped-bug'}}),
    kase('BB-006', {status: '자동화됨'}),
    kase('BB-007', {steps: []}),
  ]));
  for (const want of [/BB-1: id/, /unknown journey CUJ-9/, /BB-003: priority/, /ticket-12/, /BB-005: escaped-bug origin needs date/, /BB-006: 자동화됨 needs automated_by/, /BB-007: steps/]) {
    assert.ok(bad.some(p => want.test(p)), `missing problem ${want}`);
  }
});

// --- requirement id extraction ----------------------------------------------------------------

test('requirementIds finds each family once and ignores look-alikes', () => {
  assert.deepEqual(requirementIds('fix (REQ-STUDIO-FREE-START) TUX-SP-14A US-04 PRA-01 CGP-CHAT-R-012 REQ-STUDIO-FREE-START'),
    ['REQ-STUDIO-FREE-START', 'TUX-SP-14A', 'US-04', 'PRA-01', 'CGP-CHAT-R-012']);
  // negative controls: lowercase, a bare prefix, an issue number
  assert.deepEqual(requirementIds('req-studio-x, REQ- alone, #2094, US-4'), []);
});

test('idsFromDiff counts changed lines only, not context or file headers', () => {
  const diff = [
    'diff --git a/docs/studio-requirements.md b/docs/studio-requirements.md',
    '--- a/docs/studio-requirements.md',
    '+++ b/docs/studio-requirements.md',
    '@@ -1,3 +1,3 @@ REQ-HEADER-CONTEXT',
    ' | REQ-UNCHANGED | context |',
    '-| REQ-I14 | old |',
    '+| REQ-I14 | new, see TUX-COND-02 |',
  ].join('\n');
  assert.deepEqual(idsFromDiff(diff), ['REQ-I14', 'TUX-COND-02']);
});

test('linkedTouched: a touched child reaches its parent; a touched parent does not reach a child', () => {
  assert.deepEqual(linkedTouched(['REQ-L12'], ['REQ-L12-14']), ['REQ-L12']);
  assert.deepEqual(linkedTouched(['REQ-L12-14'], ['REQ-L12']), []);
  assert.deepEqual(linkedTouched(['REQ-L1'], ['REQ-L12']), []);
});

// --- selection --------------------------------------------------------------------------------

test('selectCases: P0 always, touched requirements, recent escapes; nothing else', () => {
  const cases = [
    kase('BB-001', {priority: 'P0'}),
    kase('BB-002', {requirements: ['REQ-TOUCHED']}),
    kase('BB-003', {origin: {kind: 'escaped-bug', date: '2026-10-20', ref: '#2094'}}),
    kase('BB-004'),                                                                  // negative: P1, untouched, design
    kase('BB-005', {origin: {kind: 'escaped-bug', date: '2026-10-06', ref: '#1'}}),  // negative: 14 days old
    kase('BB-006', {priority: 'P0', status: '자동화됨', automated_by: 'ci.yml'}),     // negative: automated
    kase('BB-007', {priority: 'P2', journey: 'CUJ-2', requirements: ['REQ-TOUCHED-SUB']}), // negative: parent touched only
  ];
  const sel = selectCases(book(cases), {touched: ['REQ-TOUCHED'], today: '2026-10-20'});
  assert.deepEqual(sel.map(c => [c.id, c.reasons]), [
    ['BB-001', ['p0']],
    ['BB-002', ['touched:REQ-TOUCHED']],
    ['BB-003', ['escaped:2026-10-20']],
  ]);
});

test('isRecentEscape window is the last 14 days, today included, future excluded', () => {
  const esc = date => ({origin: {kind: 'escaped-bug', date, ref: 'x'}});
  assert.equal(isRecentEscape(esc('2026-10-20'), '2026-10-20'), true);
  assert.equal(isRecentEscape(esc('2026-10-07'), '2026-10-20'), true);
  assert.equal(isRecentEscape(esc('2026-10-06'), '2026-10-20'), false);
  assert.equal(isRecentEscape(esc('2026-10-21'), '2026-10-20'), false);
  assert.equal(isRecentEscape({origin: {kind: 'design', date: '2026-10-20'}}, '2026-10-20'), false);
});

test('renderMarkdown groups by journey, gives a checkbox per case and lists touched ids', () => {
  const b = book([kase('BB-001', {priority: 'P0'}), kase('BB-002', {journey: 'CUJ-2'})]);
  const md = renderMarkdown(b, selectCases(b, {touched: ['REQ-A1'], today: '2026-10-20'}), {touched: ['REQ-A1']});
  assert.match(md, /P0 하나라도 FAIL 이면 승인하지 않습니다/);
  assert.match(md, /\*\*CUJ-1 J1\*\*\n\n- \[ \] \*\*BB-001\*\* P0/);
  assert.match(md, /\*\*CUJ-2 J2\*\*\n\n- \[ \] \*\*BB-002\*\* P1 .*변경 REQ-A1/);
  assert.match(md, /`REQ-A1`/);
});

// End to end over a throwaway git repository: the range since the last stable tag decides.
test('run: touched ids come from commit bodies and requirement-doc diffs since the last stable tag', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-cases-'));
  const g = (...a) => execFileSync('git', ['-C', tmp, ...a], {encoding: 'utf8', env: {...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x'}});
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(tmp, 'docs'), {recursive: true});
  fs.writeFileSync(path.join(tmp, 'docs/studio-requirements.md'), '| REQ-OLD | a |\n| REQ-DOC | b |\n');
  g('add', '.'); g('commit', '-q', '-m', 'feat: before the release (REQ-BEFORE)');
  g('tag', 'v1.0.0');
  g('commit', '-q', '--allow-empty', '-m', 'feat(chat): x (#1)', '-m', 'Body mentions REQ-BODY.');
  fs.writeFileSync(path.join(tmp, 'docs/studio-requirements.md'), '| REQ-OLD | a |\n| REQ-DOC | changed |\n');
  g('commit', '-q', '-am', 'docs: edit a row (#2)');
  g('tag', 'v1.0.1-rc.1');                                 // an rc tag is not a baseline
  const dir = path.join(tmp, 'book');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'journeys.yaml'), 'journeys:\n  - id: CUJ-1\n    title: J\n    goal: g\n');
  const c = (id, req, pri = 'P1') => `  - id: ${id}\n    journey: CUJ-1\n    priority: ${pri}\n    title: t\n    requirements: [${req}]\n    steps:\n      - s\n    expect:\n      - e\n    origin:\n      kind: design\n`;
  fs.writeFileSync(path.join(dir, 'cases.yaml'), `cases:\n${c('BB-001', 'REQ-BODY')}${c('BB-002', 'REQ-DOC')}${c('BB-003', 'REQ-OLD')}${c('BB-004', 'REQ-BEFORE')}`);
  const out = path.join(tmp, 'out');
  const {json, markdown} = run({root: tmp, candidate: 'main', today: '2026-10-20', out, dir});
  assert.equal(json.baseline, 'v1.0.0');
  assert.deepEqual(json.touched_requirements, ['REQ-BODY', 'REQ-DOC']);
  // positive: BB-001 (body), BB-002 (changed doc row); negative: BB-003 (unchanged row), BB-004 (before the tag)
  assert.deepEqual(json.cases.map(x => x.id), ['BB-001', 'BB-002']);
  assert.ok(fs.existsSync(path.join(out, 'cases.json')) && fs.existsSync(path.join(out, 'cases.md')));
  assert.match(markdown, /BB-001/);
  fs.rmSync(tmp, {recursive: true, force: true});
});

// --- results schema ---------------------------------------------------------------------------

const goodRun = (over = {}) => ({
  schema: 'hps-blackbox-run/1', pr: 2140, head_sha: 'a'.repeat(40), rc_tag: 'v2026.1021.0-rc.1',
  tester: {kind: 'agent', name: 'codex-pre-tester'}, started_at: '2026-10-21T17:30:00+09:00', finished_at: '2026-10-21T18:10:00+09:00',
  cases: [
    {id: 'BB-001', priority: 'P0', result: 'PASS', attempts: 1, screenshot: 'shots/BB-001.png'},
    {id: 'BB-002', priority: 'P1', result: 'BLOCKED', attempts: 1, note: 'Google 로그인 화면에서 멈춤 (규칙)'},
  ],
  p0_verdict: CLEAR, suggested_cases: [], ...over,
});

test('validateRun: a complete run is valid (positive control)', () => {
  assert.deepEqual(validateRun(goodRun()), []);
  const failing = goodRun({p0_verdict: HOLD, cases: [{id: 'BB-001', priority: 'P0', result: 'FAIL', attempts: 2, screenshot: 's.png', note: '채팅이 열리지 않음'}]});
  assert.deepEqual(validateRun(failing), []);
});

test('validateRun: each rule has a negative control', () => {
  const p0fail = {id: 'BB-001', priority: 'P0', result: 'FAIL', attempts: 2, screenshot: 's.png', note: 'n'};
  const cases = [
    [goodRun({cases: [p0fail]}), /must be "승인 보류 권장"/],
    [goodRun({p0_verdict: HOLD}), /no P0 case failed/],
    [goodRun({cases: [{id: 'BB-001', priority: 'P0', result: 'PASS', attempts: 1}]}), /PASS needs a screenshot/],
    [goodRun({p0_verdict: HOLD, cases: [{...p0fail, attempts: 1}]}), /one retry from a clean profile/],
    [goodRun({cases: [{id: 'BB-002', priority: 'P1', result: 'BLOCKED', attempts: 1}]}), /BLOCKED needs a note/],
    [goodRun({head_sha: 'abc1234'}), /head_sha/],
    [goodRun({rc_tag: 'v2026.1021.0'}), /rc_tag/],
  ];
  for (const [r, want] of cases) assert.ok(validateRun(r).some(p => want.test(p)), `expected ${want}`);
  assert.ok(validateRun(goodRun(), {selected: {cases: [{id: 'BB-001'}, {id: 'BB-009'}]}}).some(p => /BB-009 has no row/.test(p)));
});

test('extractRun reads the JSON block out of a PR comment and refuses a comment without one', () => {
  const comment = `| 케이스 | 결과 |\n|---|---|\n\n<details><summary>결과 JSON</summary>\n\n\`\`\`json\n${JSON.stringify(goodRun())}\n\`\`\`\n</details>`;
  assert.equal(extractRun(comment).pr, 2140);
  assert.throws(() => extractRun('no json here'), /no ```json block/);
});

// --- daily schedule gate ----------------------------------------------------------------------

test('appChanged: app paths count, Service/Chalk/docs/workflows do not', () => {
  assert.deepEqual(appChanged(['extensions/hypeproof-chat/src/a.ts', 'vscodium-base', 'scripts/release/templates/install-mac.sh']).length, 3);
  assert.deepEqual(appChanged(['docs/x.md', 'worker/src/a.ts', 'chalk/a.ts', '.github/workflows/release-cut.yml', 'e2e/a.mjs', 'scripts/release/select-cases.mjs']), []);
});

test('decide: create only on schedule with an app change and no live class; everything else is dry-run or skip', () => {
  const app = ['extensions/hypeproof-chat/src/a.ts'];
  assert.deepEqual(decide({event: 'schedule', appFiles: app, live: 'proceed'}), {run: true, mode: 'create', reason: 'scheduled cut, 1 app file(s) changed, no live class, mode create'});
  assert.equal(decide({event: 'schedule', appFiles: app, live: 'proceed', dailySwitch: 'dry-run'}).mode, 'dry-run');
  // negative controls
  assert.equal(decide({event: 'schedule', appFiles: [], live: 'proceed'}).run, false);
  assert.equal(decide({event: 'schedule', appFiles: app, live: 'blocked'}).run, false);
  assert.equal(decide({event: 'schedule', appFiles: app, live: ''}).run, false);           // freeze check failed: fail closed
  assert.equal(decide({event: 'schedule', appFiles: app, live: 'override'}).run, false);   // no override on a schedule
  assert.equal(decide({event: 'schedule', appFiles: app, live: 'proceed', dailySwitch: 'off'}).run, false);
  assert.equal(decide({event: 'schedule', appFiles: app, live: 'proceed', dailySwitch: 'yes'}).run, false);
  // manual dispatch keeps its input; absent input is a dry run
  assert.equal(decide({event: 'workflow_dispatch', inputMode: 'create'}).mode, 'create');
  assert.equal(decide({event: 'workflow_dispatch'}).mode, 'dry-run');
  assert.equal(decide({event: ''}).mode, 'dry-run');
});

test('the release PR template puts the rc one-liner first and carries the case checklist', () => {
  const tpl = fs.readFileSync(path.join(here, '../templates/release-pr.md'), 'utf8');
  assert.ok(tpl.indexOf('{{INSTALL_ONELINER}}') < tpl.indexOf('## 1. Candidate'));
  for (const k of ['{{BLACKBOX_CASES}}', '{{CHANGED_REQUIREMENTS}}']) assert.ok(tpl.includes(k), k);
});
