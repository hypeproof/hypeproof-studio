// TC-0066..TC-0068, TC-0070 — trial offer helpers (src/trialOffer.ts).
// Run: node --experimental-strip-types --test test/trial-choice-disclosure.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrialOffer, trialEntryNote, fetchTrialOffer, TRIAL_CODE_LINE } from '../src/trialOffer.ts';

test('test_tc_0066_code_line_always_and_no_allowance_without_numbers', () => {
  assert.deepEqual(trialEntryNote(null), { code: TRIAL_CODE_LINE });
  assert.deepEqual(trialEntryNote({ entry: 'open' }), { code: TRIAL_CODE_LINE });
  assert.equal(trialEntryNote(null).allowance, undefined);
  assert.equal(trialEntryNote({ entry: 'open' }).allowance, undefined);
});

test('test_tc_0067_allowance_text_from_parsed_offer', () => {
  const a = trialEntryNote(parseTrialOffer({ entry: 'code', duration_hours: 48, request_limit: 50 }));
  assert.equal(a.allowance, '체험 2일 · AI 요청 50번');
  assert.equal(a.code, TRIAL_CODE_LINE);
  const b = trialEntryNote(parseTrialOffer({ entry: 'code', duration_hours: 1.5, request_limit: 1000 }));
  assert.equal(b.allowance, '체험 1시간 30분 · AI 요청 1,000번');
  // Only one of the two numbers advertised: no allowance.
  assert.equal(trialEntryNote({ entry: 'code', durationHours: 48 }).allowance, undefined);
  assert.equal(trialEntryNote({ entry: 'code', requestLimit: 50 }).allowance, undefined);
});

test('test_tc_0068_parse_drops_both_numbers_when_one_is_invalid', () => {
  assert.deepEqual(parseTrialOffer({ entry: 'code', duration_hours: 48 }), { entry: 'code' });
  assert.deepEqual(parseTrialOffer({ entry: 'code', duration_hours: 48, request_limit: 0 }), { entry: 'code' });
  assert.deepEqual(parseTrialOffer({ entry: 'open', request_limit: 50 }), { entry: 'open' });
});

test('test_tc_0070_fetch_returns_null_on_500_or_throw_without_authorization', async () => {
  const calls = [];
  const f500 = async (url, init = {}) => { calls.push({ url, init }); return new Response('{}', { status: 500 }); };
  assert.equal(await fetchTrialOffer('https://service.test/v1', f500), null);
  const fThrow = async (url, init = {}) => { calls.push({ url, init }); throw new Error('offline'); };
  assert.equal(await fetchTrialOffer('https://service.test/v1', fThrow), null);
  assert.equal(calls.length, 2, 'one read each');
  for (const c of calls) {
    assert.equal(new Headers(c.init.headers).get('authorization'), null);
    assert.equal(c.url, 'https://service.test/v1/trial/offer');
  }
});
