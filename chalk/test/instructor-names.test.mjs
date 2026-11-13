// E5 #3777: learners' names stay on the instructor's device. The kit (src/lib/instructor-names.ts) is inlined verbatim
// into /manage, so these checks run the page's own code. Browser behaviour (rows, answers view, no name in any request
// body, clear) is covered in Chromium by e2e/classroom/ops-names.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
const { instructorNamesKit, INSTRUCTOR_NAMES_SCRIPT } = await import('../src/lib/instructor-names.ts');
const { rosterCsvKit } = await import('../src/lib/roster-csv.ts');
const { default: chalk } = await import('../src/index.ts');
const kit = instructorNamesKit(), csv = rosterCsvKit();
const memory = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('names from a handle,name CSV are stored per cohort and read back; a missing name falls back to the handle', () => {
  const s = memory(), p = csv.preview('handle,name\ns01,김민지\ns02,\ns03,"이, 서준"\nBAD HANDLE,누구');
  const r = kit.merge(new Map(), p.rows);
  assert.deepEqual([r.added, r.skipped], [2, 2], 'a row without a name or with an invalid handle changes nothing');
  assert.equal(kit.save(s, 'cohort-a', r.names), true);
  const back = kit.load(s, 'cohort-a');
  assert.deepEqual([...back], [['s01', '김민지'], ['s03', '이, 서준']]);
  assert.deepEqual([kit.label(back, 's01'), kit.label(back, 's02')], ['김민지', 's02']);
  assert.equal(kit.load(s, 'cohort-b').size, 0, 'another cohort sees none of them');
  assert.equal(kit.clear(s, 'cohort-a'), true); assert.equal(kit.load(s, 'cohort-a').size, 0); assert.equal(s.m.size, 0, 'clear leaves nothing behind');
});

test('stored data is distrusted: malformed, oversized or invisible-character names never reach the screen', () => {
  const s = memory(), key = kit.keyOf('c');
  for (const bad of ['not json', '[1,2]', 'null', '"x"']) { s.setItem(key, bad); assert.equal(kit.load(s, 'c').size, 0, bad); }
  s.setItem(key, JSON.stringify({ s01: '김‮민지​', s02: 'a'.repeat(41), s03: 'x\ny', 'bad id!': '이름', s04: 7 }));
  assert.deepEqual([...kit.load(s, 'c')], [['s01', '김민지']], 'bidi/zero-width removed; too long, control characters, bad ids and non-strings dropped');
  // A storage that throws (private mode, quota) reads as empty and saving reports failure instead of throwing.
  const broken = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('denied'); } };
  assert.equal(kit.load(broken, 'c').size, 0); assert.equal(kit.save(broken, 'c', new Map([['s01', 'a']])), false); assert.equal(kit.clear(broken, 'c'), false);
});

test('/manage inlines the same kit and the roster CSV kit', async () => {
  const html = await (await chalk.fetch(new Request('https://chalk.test/manage'), { ENVIRONMENT: 'test' })).text();
  assert.ok(html.includes(INSTRUCTOR_NAMES_SCRIPT), 'the served page carries the kit verbatim');
  assert.ok(!html.includes('/*@instructor-names*/') && !html.includes('/*@roster-csv*/'), 'both markers are replaced');
});
