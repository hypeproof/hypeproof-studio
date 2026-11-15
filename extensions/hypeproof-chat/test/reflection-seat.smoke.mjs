// Run: node --experimental-strip-types test/reflection-seat.smoke.mjs
// #4179: which seats may open "나의 질문". The entry flow itself is pinned end to end in
// personal-reflection-entry.test.tsx; this file pins the decision table, including the cases
// that test cannot reach cheaply (credential claims, the Service's seat_owner field, free seats).
import assert from 'node:assert/strict';
import { mayBeAccountSeatRecord, reflectionProfileAccepted, reflectionRecordAccepted, seatOwnership } from '../src/reflectionSeat.ts';

const token = (claims) => Buffer.from(JSON.stringify({ u: 'u1', c: 'c1', p: 'p1', ...claims })).toString('base64url') + '.sig';
const ME = 'acc_me', SESSION = 'sess_me';
const mineToken = token({ personal_account: ME, account_session: SESSION, native_trial: true });

// ── ownership ────────────────────────────────────────────────────────────────────────────────
assert.equal(seatOwnership({ token: 'opaque', accountPass: { sessionId: SESSION, passId: 'super' } }, ME, SESSION), 'mine', 'binding of this session');
assert.equal(seatOwnership({ token: mineToken }, ME, SESSION), 'mine', 'credential claims of this account and session');
assert.equal(seatOwnership({ token: token({ personal_account: ME }) }, ME, SESSION), 'mine', 'claims without a session still name this account');
assert.equal(seatOwnership({ token: 'opaque', accountPass: { sessionId: 'sess_old', passId: 'super' } }, ME, SESSION), 'other', 'binding of another session');
assert.equal(seatOwnership({ token: token({ personal_account: 'acc_other' }) }, ME, SESSION), 'other', 'claims of another account');
assert.equal(seatOwnership({ token: token({ personal_account: ME, account_session: 'sess_old' }) }, ME, SESSION), 'other', 'claims of another session');
assert.equal(seatOwnership({ token: token({ personal_account: 'acc_other' }), accountPass: { sessionId: SESSION, passId: 'super' } }, ME, SESSION), 'other', 'a contradiction wins over a match');
assert.equal(seatOwnership({ token: 'opaque' }, ME, SESSION), 'unknown', 'no evidence');
assert.equal(seatOwnership({ token: token({ c: 'studio-open-trial' }) }, ME, SESSION), 'unknown', 'free seat credential has no account claims');
assert.equal(seatOwnership({ token: mineToken }, undefined, SESSION), 'unknown', 'not signed in');
assert.equal(seatOwnership(undefined, ME, SESSION), 'unknown');
console.log('PASS ownership: binding and claims, contradictions win, no evidence is unknown');

// ── saved activity ───────────────────────────────────────────────────────────────────────────
const bound = { kind: 'trial', token: 'opaque', accountPass: { sessionId: SESSION, passId: 'super' } };
assert.equal(mayBeAccountSeatRecord(bound), true, 'a record saved earlier with kind trial and an account pass');
assert.equal(mayBeAccountSeatRecord({ kind: 'trial', token: mineToken }), true);
assert.equal(mayBeAccountSeatRecord({ kind: 'trial', token: 'opaque' }), false, 'code-issued trial without an account');
assert.equal(mayBeAccountSeatRecord({ ...bound, free: true }), false, 'free seat');
assert.equal(mayBeAccountSeatRecord({ ...bound, lesson: true }), false, 'lesson');
assert.equal(mayBeAccountSeatRecord({ ...bound, kind: 'classroom' }), false, 'classroom');
assert.equal(mayBeAccountSeatRecord({ ...bound, kind: 'personal' }), false, 'personal is handled as personal');

assert.equal(reflectionRecordAccepted(bound, 'mine'), true);
assert.equal(reflectionRecordAccepted(bound, 'unknown'), false);
assert.equal(reflectionRecordAccepted(bound, 'other'), false);
assert.equal(reflectionRecordAccepted({ kind: 'personal', token: 'legacy' }, 'unknown'), true, 'legacy personal record unchanged');
assert.equal(reflectionRecordAccepted({ kind: 'personal', token: 'legacy' }, 'other'), false);
assert.equal(reflectionRecordAccepted({ kind: 'personal', lesson: true, token: 'legacy' }, 'unknown'), false);
assert.equal(reflectionRecordAccepted({ kind: 'trial', free: true, token: 'free' }, 'mine'), false, 'free seat never');
assert.equal(reflectionRecordAccepted({ kind: 'classroom', token: 'c', accountPass: bound.accountPass }, 'mine'), false, 'classroom never');
console.log('PASS saved activity: personal as before, account trial seats when mine, free/lesson/classroom never');

// ── served profile ───────────────────────────────────────────────────────────────────────────
const seatProfile = { activity_kind: 'trial', profile_id: 'studio-native-trial', pass: { status: 'active' } };
assert.equal(reflectionProfileAccepted({ activity_kind: 'personal' }, 'unknown'), true, 'personal as before');
assert.equal(reflectionProfileAccepted(seatProfile, 'mine'), true, 'account trial seat, before Service #536');
assert.equal(reflectionProfileAccepted({ ...seatProfile, seat_owner: 'account' }, 'unknown'), true, 'Service #536 field');
assert.equal(reflectionProfileAccepted(seatProfile, 'unknown'), false, 'trial with no account evidence');
assert.equal(reflectionProfileAccepted({ ...seatProfile, seat_owner: 'account' }, 'other'), false, 'seat_owner never overrides another account');
assert.equal(reflectionProfileAccepted({ activity_kind: 'trial', profile_id: 'studio-open-trial' }, 'mine'), false, 'anonymous free seat');
assert.equal(reflectionProfileAccepted({ ...seatProfile, lesson: { content: { title: 'x' } } }, 'mine'), false, 'lesson');
assert.equal(reflectionProfileAccepted({ activity_kind: 'classroom', seat_owner: 'account' }, 'mine'), false, 'classroom');
assert.equal(reflectionProfileAccepted(null, 'mine'), false, 'no profile');
console.log('PASS served profile: personal, trial with this account or seat_owner; free, lesson, classroom and another account refused');

// ── Scope B: copy a free or class seat reads today carries no 체험 ───────────────────────────
const { TASK_MOVE_TRIAL_REASON } = await import('../src/taskMove.ts');
const { RATE_LIMIT_STALL_CLASSROOM } = await import('../src/seatVocabulary.ts');
const { SDK_RATE_LIMIT_FRIENDLY } = await import('../src/sdkCoachHelpers.ts');
for (const line of [TASK_MOVE_TRIAL_REASON, RATE_LIMIT_STALL_CLASSROOM, SDK_RATE_LIMIT_FRIENDLY]) assert(!line.includes('체험'), line);
assert.equal(TASK_MOVE_TRIAL_REASON, '이 활동의 작업은 다른 활동으로 옮길 수 없어요.');
assert.equal(RATE_LIMIT_STALL_CLASSROOM, SDK_RATE_LIMIT_FRIENDLY, 'one 429 sentence whichever way the turn ended');
console.log('PASS task-move reason and classroom 429 lines say no 체험');
