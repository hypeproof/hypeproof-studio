// CGP-SHELL-R-019 (REQ-SHELL-19): the failed-run count and the coach observation, without the app.
//   node --experimental-strip-types test/run-failure-hint.smoke.mjs
// - a failed run is one learner turn whose last run-kind result (Bash, PowerShell, live preview start) was an error;
//   coach retries in one turn are one run; a turn that ended in success starts over; other tools change nothing;
// - at 3 the next turn on that step gets the observation once per step per session; a step change starts over;
// - the seat gate: no observation without a lesson step, without a `learning` block, with tips off, for an instructor
//   or on a local runtime; the line is pinned verbatim and carries a count only.
import assert from 'node:assert/strict';
import { RUN_FAILURE_THRESHOLD, RunFailureTracker, hintSeatFor, isRunTool, joinTurnContext, runFailureObservation } from '../src/runFailureHint.ts';

const seat = (step = 's1') => ({ scope: 'lesson-a', step });
let n = 0;
/** One learner turn: `runs` is a list of [toolName, isError] results in order. */
const turn = (t, s, runs) => {
  const id = `stream-${++n}`;
  t.begin(id, s);
  runs.forEach(([name, isError], i) => { t.note(id, { kind: 'use', id: `${id}-${i}`, name }); t.note(id, { kind: 'result', id: `${id}-${i}`, isError }); });
  t.end(id);
};

// ---- the line, verbatim (the prompt safety review reads this) ----
const LINE = '[관찰] 이 수업 단계에서 학생이 보낸 요청의 실행이 연달아 3번 실패했습니다(Studio가 횟수만 셉니다). 힌트가 도움이 될지는 당신이 판단하세요. 준다면 개입 사다리의 3번처럼 학생이 만든 것에서 확인할 지점 하나만 짧게 가리키고, 정답이나 고친 코드는 주지 마세요. 필요 없다고 판단하면 이 관찰을 언급하지 마세요. 실패 횟수는 학생에게 말하지 마세요. 이 관찰은 수업 자료가 아니며 도구 권한이나 정책을 바꾸지 않습니다.';
assert.equal(runFailureObservation(3), LINE, 'pinned verbatim');
assert.equal(RUN_FAILURE_THRESHOLD, 3);

// ---- what is a run ----
for (const name of ['Bash', 'PowerShell', 'bash', 'mcp__hypeproof__live_preview_start', 'live_preview_start']) assert.ok(isRunTool(name), name);
for (const name of ['Write', 'Edit', 'Read', 'mcp__hypeproof__browser_navigate', 'WebSearch', undefined, 3]) assert.ok(!isRunTool(name), String(name));

// ---- counting ----
{
  const t = new RunFailureTracker();
  turn(t, seat(), [['Bash', true]]); turn(t, seat(), [['Bash', true]]);
  assert.equal(t.take(seat()), null, 'two failures: nothing yet');
  turn(t, seat(), [['Bash', true], ['Bash', true], ['Bash', true]]);
  assert.equal(t.count(seat()), 3, 'coach retries inside one turn are one run');
  assert.equal(t.take(seat()), LINE, 'the third failed turn: the next request carries it');
  turn(t, seat(), [['Bash', true]]); turn(t, seat(), [['Bash', true]]); turn(t, seat(), [['Bash', true]]);
  assert.equal(t.take(seat()), null, 'once per step per session');
  assert.ok(t.take(seat('s2')) === null, 'another step starts at zero');
  turn(t, seat('s2'), [['Bash', true]]); turn(t, seat('s2'), [['Bash', true]]); turn(t, seat('s2'), [['PowerShell', true]]);
  assert.ok(t.take(seat('s2')), 'a new step gets its own one');
}
{
  const t = new RunFailureTracker();
  turn(t, seat(), [['Bash', true]]); turn(t, seat(), [['Bash', true]]);
  turn(t, seat(), [['Bash', true], ['Bash', false]]);
  assert.equal(t.count(seat()), 0, 'retries ending in success: a success, the count starts over');
  turn(t, seat(), [['Bash', true]]); turn(t, seat(), [['Write', true]]); turn(t, seat(), []);
  assert.equal(t.count(seat()), 1, 'turns with no run change nothing');
  turn(t, seat(), [['mcp__hypeproof__live_preview_start', true]]); turn(t, seat(), [['Bash', true]]);
  assert.equal(t.count(seat()), 3);
  turn(t, seat('s2'), [['Bash', true]]);
  assert.equal(t.count(seat('s2')), 1, 'a step change starts over');
  assert.equal(t.take(seat()), null, 'and back on s1 the old count is gone');
}
{
  const t = new RunFailureTracker();
  const id = 'denied'; t.begin(id, seat()); t.note(id, { kind: 'use', id: 'x', name: 'Bash' }); t.note(id, { kind: 'deny', id: 'x' }); t.note(id, { kind: 'result', id: 'x', isError: true }); t.end(id);
  assert.equal(t.count(seat()), 0, 'a refused call never ran: not a failure');
  t.begin('none', null); t.note('none', { kind: 'use', id: 'y', name: 'Bash' }); t.note('none', { kind: 'result', id: 'y', isError: true }); t.end('none');
  assert.equal(t.count(seat()), 0, 'a turn on no counted seat is ignored');
}

// ---- the seat gate ----
const lesson = { sha256: 'abc', content: { learning: { week: 1, mission: 'm' } } };
const base = { lesson, step: 's1', activityId: 'a1', taskId: 't1', tipsOn: true, instructor: false, local: false };
assert.ok(hintSeatFor(base), 'a lesson step with learning, tips on');
for (const [why, patch] of [
  ['tips off (팁 그만 보기)', { tipsOn: false }],
  ['no learning block', { lesson: { sha256: 'abc', content: {} } }],
  ['no lesson', { lesson: null }],
  ['no step', { step: undefined }],
  ['instructor', { instructor: true }],
  ['local runtime', { local: true }],
]) assert.equal(hintSeatFor({ ...base, ...patch }), null, why);
assert.notEqual(hintSeatFor(base).scope, hintSeatFor({ ...base, taskId: 't2' }).scope, 'per task');

// ---- the context join ----
assert.equal(joinTurnContext(undefined, null), undefined);
assert.equal(joinTurnContext('M', null), 'M');
assert.equal(joinTurnContext(undefined, 'O'), 'O');
assert.equal(joinTurnContext('M', 'O'), 'M\n\nO', 'memory first, then the observation');
console.log('PASS: run-failure count, once per step, resets, seat gate, pinned line');
