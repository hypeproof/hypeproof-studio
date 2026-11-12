import assert from 'node:assert/strict';
import test from 'node:test';
import { isEmailTestParticipant, emailTestDownloadStatus } from '../email-test-participant-auth.mjs';

const request = token => new Request('https://pilot.example.test/v1/automations', {
  headers: token === undefined ? {} : { authorization: 'Bearer ' + token },
});
const members = ['synthetic-author', 'synthetic-recipient-one', 'synthetic-recipient-two'];
const env = { HPS_EMAIL_TEST_PARTICIPANTS: JSON.stringify(members), HPS_EMAIL_TEST_PARTICIPANT: 'synthetic-old' };

test('all three explicit participants pass; other, missing and removed legacy credentials fail', async () => {
  for (const token of members) assert.equal(await isEmailTestParticipant(request(token), env), true);
  for (const token of [undefined, '', 'synthetic-other', 'synthetic-old', members[0] + '-suffix']) {
    assert.equal(await isEmailTestParticipant(request(token), env), false);
  }
  const reduced = { ...env, HPS_EMAIL_TEST_PARTICIPANTS: JSON.stringify(members.slice(1)) };
  assert.equal(await isEmailTestParticipant(request(members[0]), reduced), false);
  assert.equal(await isEmailTestParticipant(request(members[1]), reduced), true);
});

test('malformed or oversized allowlists fail closed instead of falling back to the old secret', async () => {
  const values = ['', '{', 'null', '{}', '[]', '"synthetic-old"', '[null]', '[12]', '[""]',
    JSON.stringify(['synthetic-old', 'synthetic-old']), JSON.stringify([...members, 'fourth']),
    JSON.stringify(['embedded whitespace']), JSON.stringify(['x'.repeat(8193)])];
  for (const value of values) {
    assert.equal(await isEmailTestParticipant(request('synthetic-old'), { ...env, HPS_EMAIL_TEST_PARTICIPANTS: value }), false);
  }
});

test('legacy single-participant rollback remains explicit and bounded', async () => {
  assert.equal(await isEmailTestParticipant(request('synthetic-old'), { HPS_EMAIL_TEST_PARTICIPANT: 'synthetic-old' }), true);
  assert.equal(await isEmailTestParticipant(request('synthetic-old'), {}), false);
  assert.equal(await isEmailTestParticipant(request('x'.repeat(8193)), env), false);
  assert.equal(await isEmailTestParticipant(new Request('https://pilot.example.test', { headers: { authorization: 'Basic synthetic-old' } }), env), false);
});

test('download rechecks expiry/revocation with the pinned Service and fails closed on its failure', async () => {
  let calls = 0, status = 200, version = 'reviewed-test-build';
  const runtime = { ...env, HPS_EMAIL_VERSION: '00000000-0000-4000-8000-000000000001',
    HPS_EMAIL_EXPECTED_BUILD: 'reviewed-test-build', EXISTING_AI: { async fetch(url, options) {
      calls++;
      assert.equal(url, 'https://api.hypeproof-ai.xyz/v1/access');
      assert.equal(options.headers.authorization, 'Bearer ' + members[0]);
      assert.equal(Object.keys(options.headers).length, 2);
      assert.equal(options.headers['Cloudflare-Workers-Version-Overrides'], 'hypeproof-studio-api="' + runtime.HPS_EMAIL_VERSION + '"');
      assert.equal(options.redirect, 'manual');
      return new Response('private response never returned', { status, headers: { 'x-hps-email-test': version } });
    } } };
  assert.equal(await emailTestDownloadStatus(request('outsider'), runtime), 401);
  assert.equal(calls, 0);
  assert.equal(await emailTestDownloadStatus(request(members[0]), runtime), 200);
  for (status of [401, 403]) assert.equal(await emailTestDownloadStatus(request(members[0]), runtime), 401);
  for (status of [302, 429, 500]) assert.equal(await emailTestDownloadStatus(request(members[0]), runtime), 503);
  status = 200; version = 'wrong-version';
  assert.equal(await emailTestDownloadStatus(request(members[0]), runtime), 503);
  assert.equal(await emailTestDownloadStatus(request(members[0]), { ...runtime, EXISTING_AI: { fetch() { throw new Error('private failure'); } } }), 503);
  assert.equal(await emailTestDownloadStatus(request(members[0]), env), 503);
});
