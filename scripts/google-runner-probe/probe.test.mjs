import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('./probe.gs', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('./appsscript.json', import.meta.url), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const sheetA = 'synthetic_private_sheet_A';
const sheetB = 'synthetic_private_sheet_B';

function fixture() {
  let caller = 'synthetic-A';
  let allowlist = JSON.stringify(['synthetic-A', 'synthetic-B'].map(digest));
  let failure = null;
  const state = new Map();
  const calls = [];
  const response = (status, data) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(data) });
  const context = vm.createContext({
    ScriptApp: { getOAuthToken: () => `fake-token:${caller}` },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_, text) => [...createHash('sha256').update(text).digest()].map(byte => byte > 127 ? byte - 256 : byte),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: key => key === 'HPS_PROBE_SUB_SHA256' ? allowlist : null }),
      getUserProperties: () => {
        if (!state.has(caller)) state.set(caller, new Map());
        const properties = state.get(caller);
        return {
          getProperty: key => properties.get(key) ?? null,
          getProperties: () => Object.fromEntries(properties),
          setProperty: (key, value) => properties.set(key, value),
        };
      },
    },
    LockService: { getUserLock: () => ({ tryLock: () => failure !== 'locked', releaseLock: () => {} }) },
    UrlFetchApp: {
      fetch: (url, options) => {
        calls.push({ url, options });
        assert.equal(options.method, 'get');
        assert.equal(options.followRedirects, false);
        assert.equal(options.headers.Authorization, `Bearer fake-token:${caller}`);
        if (failure === 'throw') throw new Error('PRIVATE_TOKEN_OR_SHEET_ID');
        if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return response(200, { sub: caller });
        const match = /^https:\/\/sheets.googleapis.com\/v4\/spreadsheets\/([A-Za-z0-9_-]+)\/values\/A1\?valueRenderOption=UNFORMATTED_VALUE$/.exec(url);
        assert.ok(match, 'Only the fixed Google Sheets A1 read URL is permitted');
        if (failure === 'quota') return response(429, { error: 'PRIVATE_TOKEN_OR_SHEET_ID' });
        if (failure === 'malformed') return response(200, { values: [[{ secret: 'PRIVATE_CELL' }]] });
        const ownsSheet = (caller === 'synthetic-A' && match[1] === sheetA) || (caller === 'synthetic-B' && match[1] === sheetB);
        return ownsSheet ? response(200, { values: [[`PRIVATE_CELL:${caller}`]] }) : response(403, { error: 'PRIVATE_SHEET_ID' });
      },
    },
  });
  vm.runInContext(source, context);
  return {
    calls, state,
    use: subject => { caller = subject; },
    configure: value => { allowlist = value; },
    fail: value => { failure = value; },
    run: input => JSON.parse(JSON.stringify(context.hpsProbe(input))),
  };
}
const request = (sheetId = sheetA, marker) => ({ namespace: 'same-namespace', sheetId, range: 'A1', ...(marker === undefined ? {} : { marker }) });

test('two authenticated callers retain separate synthetic state in the same namespace', () => {
  const f = fixture();
  const a = f.run(request(sheetA, 'probe-alpha'));
  assert.deepEqual(a, { status: 'ok', callerDigest: digest('synthetic-A'), previousMarker: null, currentMarker: 'probe-alpha', sheetValueDigest: digest(JSON.stringify('PRIVATE_CELL:synthetic-A')) });
  f.use('synthetic-B');
  const b = f.run(request(sheetB, 'probe-beta'));
  assert.equal(b.status, 'ok');
  assert.equal(b.previousMarker, null);
  assert.equal(b.callerDigest, digest('synthetic-B'));
  assert.notEqual(b.sheetValueDigest, a.sheetValueDigest);
  f.use('synthetic-A');
  assert.equal(f.run(request()).currentMarker, 'probe-alpha');
  f.use('synthetic-B');
  assert.equal(f.run(request(sheetB)).currentMarker, 'probe-beta');
  assert.ok(!JSON.stringify([a, b]).includes('PRIVATE_CELL'));
});

test('cross-account sheet reads fail without returning values or mutating markers', () => {
  const f = fixture();
  f.run(request(sheetA, 'probe-alpha'));
  assert.deepEqual(f.run(request(sheetB, 'probe-replacement')), { status: 'sheet_access_denied', callerDigest: digest('synthetic-A') });
  assert.equal(f.run(request()).currentMarker, 'probe-alpha');
  f.use('synthetic-B');
  assert.equal(f.run(request(sheetA, 'probe-beta')).status, 'sheet_access_denied');
  assert.equal(f.run(request(sheetB)).currentMarker, null);
});

test('missing/malformed allowlists and unknown callers fail closed before sheet/state access', () => {
  for (const config of [null, '{}', '["bad"]', JSON.stringify([digest('synthetic-A'), digest('synthetic-A')])]) {
    const f = fixture();
    f.configure(config);
    assert.equal(f.run(request()).status, 'not_configured');
    assert.equal(f.calls.length, 0);
    assert.equal(f.state.size, 0);
  }
  const f = fixture();
  f.use('synthetic-intruder');
  assert.deepEqual(f.run(request()), { status: 'caller_not_allowed' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.size, 0);
});

test('identity spoofing, URL/range expansion and arbitrary payloads are rejected before network access', () => {
  const f = fixture();
  for (const input of [
    { ...request(), callerDigest: digest('synthetic-B') },
    { ...request(), sub: 'synthetic-B' },
    { ...request(), range: 'A1:Z999' },
    { ...request(), sheetId: 'https://attacker.invalid/' },
    { ...request(), namespace: '__proto__' },
    { ...request(), marker: 'not a synthetic marker' },
    { ...request(), code: 'MailApp.sendEmail()' }, null,
  ]) assert.deepEqual(f.run(input), { status: 'invalid_input' });
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.size, 0);
});

test('quotas, malformed Google results, locks and exceptions cannot leak or update state', () => {
  const f = fixture();
  f.run(request(sheetA, 'probe-original'));
  for (const [failure, expected] of [['quota', 'quota_exceeded'], ['malformed', 'invalid_google_response'], ['locked', 'busy'], ['throw', 'probe_unavailable']]) {
    f.fail(failure);
    const result = f.run(request(sheetA, 'probe-replacement'));
    assert.equal(result.status, expected);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
    f.fail(null);
    assert.equal(f.run(request()).currentMarker, 'probe-original');
  }
});

test('deployment requests no mail scope and exposes only the probe entry point', () => {
  assert.deepEqual(manifest.oauthScopes, ['openid', 'https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/script.external_request']);
  assert.equal(manifest.executionApi.access, 'ANYONE');
  const functions = [...source.matchAll(/^function (\w+)\(/gm)].map(match => match[1]);
  assert.deepEqual(functions.filter(name => !name.endsWith('_')), ['hpsProbe']);
  assert.doesNotMatch(source, /MailApp|GmailApp|gmail\.googleapis|eval\s*\(|new Function/);
});
