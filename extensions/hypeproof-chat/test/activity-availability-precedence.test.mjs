import assert from 'node:assert/strict';
import test from 'node:test';
import { activityFailure, responseEvidence, accessFailure } from '../src/activityAvailability.ts';

test('test_tc_0204_code_evidence_beats_status', () => {
  assert.deepEqual(activityFailure({ code: 'expired', status: 401 }, 'solo'), { cause: 'expired', audience: 'solo' });
});

test('test_tc_0205_revoked_beats_expired', () => {
  const r = activityFailure({ code: 'trial_revoked_or_reissued', type: 'expired' }, 'classroom');
  assert.equal(r?.cause, 'revoked');
  assert.equal(r?.audience, 'classroom');
});

test('test_tc_0206_status_boundaries', () => {
  assert.equal(activityFailure({ status: 500 }, 'solo')?.cause, 'outage');
  assert.equal(activityFailure({ status: 599 }, 'solo')?.cause, 'outage');
  assert.equal(activityFailure({ status: 499 }, 'solo'), null);
  assert.equal(activityFailure({ status: 600 }, 'solo'), null);
  assert.equal(activityFailure({ status: 429 }, 'solo')?.cause, 'limited');
  assert.equal(activityFailure({ status: 403 }, 'solo')?.cause, 'forbidden');
});

test('test_tc_0207_response_evidence_discards_malformed_values', () => {
  assert.deepEqual(responseEvidence(403, '{"error":{"code":"Bad-Code","type":"expired"}}'), { status: 403, code: undefined, type: 'expired' });
  const ok = 'a'.repeat(64);
  const long = 'a'.repeat(65);
  assert.equal(responseEvidence(403, JSON.stringify({ error: { code: ok } })).code, ok);
  assert.equal(responseEvidence(403, JSON.stringify({ error: { code: long } })).code, undefined);
  assert.equal(responseEvidence(403, JSON.stringify({ error: { type: long } })).type, undefined);
});

test('test_tc_0208_invalid_json_keeps_only_status', () => {
  const r = responseEvidence(500, 'not json');
  assert.deepEqual(r, { status: 500, code: undefined, type: undefined });
  assert.equal(r.status, 500);
  assert.equal(r.code, undefined);
  assert.equal(r.type, undefined);
});

test('test_tc_0209_access_failure_states', () => {
  assert.equal(accessFailure('ended', 'solo')?.cause, 'ended');
  assert.equal(accessFailure('active', 'solo'), null);
  assert.equal(accessFailure(undefined, 'solo'), null);
});
