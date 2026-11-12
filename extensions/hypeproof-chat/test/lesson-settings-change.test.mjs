// CGP-SHELL-R-024 / CGP-SHELL-D-023 — the pure rules of the classroom settings-change line (src/lessonSettingsChange.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LESSON_SETTINGS_BASELINE_KEY, LessonSettingsChangeTracker, diffLessonSettings, lessonSettingsChangeApplies,
  lessonSettingsChangeText, lessonSettingsSnapshot, placeLessonSettingsLines,
} from '../src/lessonSettingsChange.ts';

// CGP-AGENT-R-019: preset labels come from the one catalog copy, never an inline string.
const CATALOG = JSON.parse(readFileSync(new URL('../../../chalk/test/fixtures/approval-preset-catalog.json', import.meta.url), 'utf8'));
const ALWAYS = CATALOG.find(p => p.id === 'always_ask');
const caps = (on = ['read'], inputs = 'in') => ({ inputs, on });
const store = () => { const m = new Map(); return { m, get: k => m.get(k), update: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; };
const seatProfile = (over = {}) => ({ activity_kind: 'classroom', ...over });
const observe = (t, profile, o = {}) => t.observe({ seat: 's1', profile, caps: caps(), turnRunning: false, lastMessageId: null, task: null, ...o });

test('seats: classroom, served lesson or enforced binding; never instructor, local or an unknown seat', () => {
  assert.equal(lessonSettingsChangeApplies({ activity_kind: 'classroom' }), true);
  assert.equal(lessonSettingsChangeApplies({ activity_kind: 'personal', lesson: { version: '1' } }), true);
  assert.equal(lessonSettingsChangeApplies({ lesson_binding: { enforced: true } }), true);
  assert.equal(lessonSettingsChangeApplies({ activity_kind: 'classroom' }, true), false, 'instructor');
  assert.equal(lessonSettingsChangeApplies({ activity_kind: 'classroom' }, false, true), false, 'local mode');
  assert.equal(lessonSettingsChangeApplies({ activity_kind: 'personal' }), false, 'personal seat');
  assert.equal(lessonSettingsChangeApplies({}), false, 'unknown seat');
  assert.equal(lessonSettingsChangeApplies(null), false);
});

test('diff: fixed order, served labels, 기본 for no preset, capability words of the REQ-M47 card, free text named only', () => {
  const a = lessonSettingsSnapshot(seatProfile({ starters: ['하나'] }), caps(['read', 'write']));
  const b = lessonSettingsSnapshot(seatProfile({ approval_preset: { ...ALWAYS }, plan_first: { available: false }, starters: ['둘'], voice: { dictation: true, policy_version: 'hps-voice-policy/1' } }), caps(['read']));
  const items = diffLessonSettings(a, b);
  assert.deepEqual(items.map(i => i.key), ['approval_preset', 'plan_first', 'cap:write', 'dictation', 'starters']);
  assert.equal(lessonSettingsChangeText(items), `선생님이 도움 방식을 바꿨어요: 승인 방식 기본 → ${ALWAYS.label} · 계획 먼저 켜짐 → 꺼짐 · 작업 폴더의 파일 고치기 해요 → 안 해요 · 받아쓰기 꺼짐 → 켜짐 · 시작 문장 바뀜`);
  assert.ok(!JSON.stringify(b).includes('둘'), 'the snapshot holds a fingerprint, not the starter text');
});

test('diff: capability words are the card\'s (해요 / 물어봐요 / 안 해요); asking alone is not a row', () => {
  const asks = lessonSettingsSnapshot(seatProfile(), { inputs: 'in', on: ['read', 'write', 'shell'], asks: ['write', 'shell'] });
  const off = lessonSettingsSnapshot(seatProfile(), { inputs: 'in', on: ['read'], asks: [] });
  assert.equal(lessonSettingsChangeText(diffLessonSettings(asks, off)), '선생님이 도움 방식을 바꿨어요: 작업 폴더의 파일 고치기 물어봐요 → 안 해요 · 명령 실행하기 물어봐요 → 안 해요');
  assert.equal(lessonSettingsChangeText(diffLessonSettings(off, asks)), '선생님이 도움 방식을 바꿨어요: 작업 폴더의 파일 고치기 안 해요 → 물어봐요 · 명령 실행하기 안 해요 → 물어봐요');
  const noAsk = lessonSettingsSnapshot(seatProfile(), { inputs: 'in', on: ['read', 'write', 'shell'], asks: [] });
  assert.deepEqual(diffLessonSettings(asks, noAsk), [], 'only the asking changed: the preset item tells it, not a row');
  assert.deepEqual(lessonSettingsSnapshot(seatProfile(), { inputs: 'in', on: ['read'], asks: ['write'] }).caps.asks, [], 'asks only for capabilities that are on');
});

test('diff: capability rows are compared only under the same learner inputs', () => {
  const a = lessonSettingsSnapshot(seatProfile(), caps(['read', 'write'], 'sdk'));
  const b = lessonSettingsSnapshot(seatProfile(), caps([], 'proxy'));
  assert.deepEqual(diffLessonSettings(a, b), []);
});

test('tracker: silent first load, one line per change, same id on repost, replaced by a further change, cleared when undone', async () => {
  const s = store(), t = new LessonSettingsChangeTracker(s);
  assert.deepEqual((await observe(t, seatProfile())).notices, []);
  assert.ok(s.m.get(LESSON_SETTINGS_BASELINE_KEY).s1, 'baseline persisted');
  const off = seatProfile({ plan_first: { available: false } });
  const first = (await observe(t, off, { lastMessageId: 'm1' })).notices;
  assert.equal(first.length, 1);
  assert.equal(first[0].afterMessageId, 'm1');
  assert.equal((await observe(t, off)).notices[0].id, first[0].id, 'same change, same line');
  const more = seatProfile({ plan_first: { available: false }, voice: { read_aloud: true, policy_version: 'hps-voice-policy/1' } });
  const replaced = (await observe(t, more)).notices;
  assert.equal(replaced.length, 1, 'still one line');
  assert.equal(replaced[0].text, '선생님이 도움 방식을 바꿨어요: 계획 먼저 켜짐 → 꺼짐 · 읽어 주기 꺼짐 → 켜짐', 'listed from the old baseline');
  assert.deepEqual((await observe(t, seatProfile())).notices, [], 'undone before seen');
});

test('tracker: a running turn defers; seen moves the baseline; a stale or unknown id does nothing; a corrupt record re-baselines', async () => {
  const s = store(), t = new LessonSettingsChangeTracker(s);
  await observe(t, seatProfile());
  const off = seatProfile({ plan_first: { available: false } });
  const running = await observe(t, off, { turnRunning: true });
  assert.deepEqual(running, { notices: [], deferred: true });
  const [line] = (await observe(t, off)).notices;
  assert.equal(await t.seen('nope'), false);
  assert.equal(await t.seen(line.id), true);
  assert.equal(await t.seen(line.id), false, 'once');
  assert.equal(t.baseline('s1').planFirst, false);
  const fresh = new LessonSettingsChangeTracker(s);
  assert.deepEqual((await observe(fresh, off)).notices, [], 'a new window after seen: nothing');
  s.m.set(LESSON_SETTINGS_BASELINE_KEY, { s1: { v: 2, junk: true } });
  assert.deepEqual((await observe(new LessonSettingsChangeTracker(s), seatProfile())).notices, [], 'corrupt baseline: silent re-baseline');
  assert.equal(new LessonSettingsChangeTracker(s).baseline('s1').planFirst, true);
});

test('tracker: other seats are separate and the record keeps at most 32 seats', async () => {
  const s = store(), t = new LessonSettingsChangeTracker(s);
  for (let i = 0; i < 40; i++) await t.observe({ seat: `seat-${i}`, profile: seatProfile(), caps: caps(), turnRunning: false, lastMessageId: null, task: null });
  const seats = Object.keys(s.m.get(LESSON_SETTINGS_BASELINE_KEY));
  assert.equal(seats.length, 32);
  assert.equal(seats[0], 'seat-8', 'oldest dropped first');
  const r = await t.observe({ seat: 'seat-39', profile: seatProfile({ plan_first: { available: false } }), caps: caps(), turnRunning: false, lastMessageId: null, task: null });
  assert.equal(r.notices.length, 1);
  assert.deepEqual((await t.observe({ seat: 'seat-38', profile: seatProfile(), caps: caps(), turnRunning: false, lastMessageId: null, task: null })).notices, [], "another seat does not see seat-39's line");
});

test('placement: after its message, at the top for an empty conversation in the same task, unseen lines never lost', () => {
  const n = (id, afterMessageId, seen = false, task = null) => ({ id, text: id, items: [], afterMessageId, task, seen });
  const p = placeLessonSettingsLines([n('a', 'm2'), n('b', null), n('c', 'gone'), n('d', 'gone', true), n('e', null, true, 'other')], ['m1', 'm2'], null);
  assert.deepEqual(p.after.get('m2').map(x => x.id), ['a']);
  assert.deepEqual(p.top.map(x => x.id), ['b']);
  assert.deepEqual(p.bottom.map(x => x.id), ['c'], 'an unseen line whose place is gone goes to the bottom; a seen one is not drawn');
});
