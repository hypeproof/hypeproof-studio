import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailTestR2Download } from '../email-test-r2-download.mjs';

const bytes = Uint8Array.from([1, 2, 3, 4]);
const artifacts = ['app.zip', 'sdk.zip'].map(name => ({ name, path: `/install/files/${name}`, sha256: 'a'.repeat(64), bytes: bytes.length }));
const config = { build: 'e3ab008b', expiresAt: 2000, artifacts };
const request = (path = '/install/files/app.zip', options) => new Request('https://test.example' + path, options);
function fixture() {
  const calls = [];
  const state = { status: 200, now: 1000, manifest: { schema: 1, ...config }, objectSize: bytes.length, missing: false, cancelled: false };
  const bucket = {
    async get(key) {
      calls.push(['get', key]);
      if (key.endsWith('manifest.json')) {
        if (state.manifest === null) return null;
        const text = typeof state.manifest === 'string' ? state.manifest : JSON.stringify(state.manifest);
        return { size: text.length, text: async () => text };
      }
      if (state.missing) return null;
      const body = new ReadableStream({ start(c) { c.enqueue(bytes); }, pull(c) { c.close(); }, cancel() { state.cancelled = true; } });
      state.body = body;
      return { size: state.objectSize, body, checksums: state.checksums, arrayBuffer() { throw Error('Worker must not buffer ZIP'); } };
    },
    async head(key) { calls.push(['head', key]); return state.missing ? null : { size: state.objectSize }; },
  };
  const env = { HPS_INSTALL_BUCKET: bucket };
  const handle = createEmailTestR2Download(config, async () => state.status, () => state.now);
  return { calls, state, env, handle };
}
test('current identity denial or Service failure never reads storage', async () => {
  for (const status of [401, 403, 503]) {
    const f = fixture(); f.state.status = status;
    const r = await f.handle(request(), f.env);
    assert.equal(r.status, status === 401 ? 401 : 503); assert.deepEqual(f.calls, []);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
});
test('expired and partial requests fail before storage; unknown paths never become object keys', async () => {
  const f = fixture(); f.state.now = config.expiresAt;
  assert.equal((await f.handle(request(), f.env)).status, 410); assert.deepEqual(f.calls, []);
  f.state.now = 1000;
  assert.equal((await f.handle(request(undefined, { headers: { Range: 'bytes=0-1' } }), f.env)).status, 416);
  for (const path of ['/install/files/private.env', '/install/files/%2e%2e%2fsecret', '/install/objects']) assert.equal(await f.handle(request(path), f.env), null);
  assert.equal((await f.handle(request(undefined, { method: 'POST' }), f.env)).status, 405);
  assert.deepEqual(f.calls, []);
});
test('absent, malformed or mismatched publication marker never opens an archive', async () => {
  for (const manifest of [null, '{', {}, { schema: 1, ...config, expiresAt: 9999 }, { schema: 1, ...config, artifacts: [...artifacts].reverse() }]) {
    const f = fixture(); f.state.manifest = manifest;
    assert.equal((await f.handle(request(), f.env)).status, 410);
    assert.ok(f.calls.every(([, key]) => key.endsWith('manifest.json')));
  }
});
test('manifest exposes only pinned public fields, with no cache or CORS bypass', async () => {
  const f = fixture();
  const input = structuredClone(config);
  input.artifacts[0].operatorNote = 'private metadata';
  const handle = createEmailTestR2Download(input, async () => 200, () => 1000);
  input.artifacts[0].sha256 = 'b'.repeat(64);
  const r = await handle(request('/install/manifest.json'), f.env);
  assert.deepEqual(await r.json(), { schema: 1, build: config.build, artifacts });
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
});
test('HEAD reads only artifact metadata and never its body', async () => {
  const f = fixture(), r = await f.handle(request(undefined, { method: 'HEAD' }), f.env);
  assert.equal(r.status, 200); assert.equal(await r.text(), '');
  assert.deepEqual(f.calls.map(([method]) => method), ['get', 'head']);
  assert.equal(r.headers.get('content-length'), '4');
});
test('GET forwards the exact R2 stream, pins length/hash, and propagates cancellation', async () => {
  const f = fixture(), r = await f.handle(request(), f.env);
  assert.equal(r.status, 200); assert.equal(r.body, f.state.body);
  assert.equal(r.headers.get('x-content-sha256'), artifacts[0].sha256);
  assert.equal(f.calls[1][1], `install/${config.build}/${artifacts[0].sha256}/app.zip`);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
  const g = fixture(), cancelled = await g.handle(request(), g.env);
  await cancelled.body.cancel(); assert.equal(g.state.cancelled, true);
});
test('missing or wrong-sized/checksummed objects fail closed; provider errors never leak', async () => {
  for (const mutate of [s => { s.missing = true; }, s => { s.objectSize = 3; }, s => { s.checksums = { sha256: new Uint8Array(32).buffer }; }]) {
    const f = fixture(); mutate(f.state); assert.equal((await f.handle(request(), f.env)).status, 503);
  }
  const f = fixture(); f.env.HPS_INSTALL_BUCKET.get = async () => { throw Error('private-provider-detail'); };
  const r = await f.handle(request(), f.env); assert.equal(r.status, 503); assert.ok(!(await r.text()).includes('private'));
});
test('invalid pins are rejected before any request is handled', () => {
  for (const change of [{ build: '../secret' }, { expiresAt: NaN }, { artifacts: [null, artifacts[1]] }, { artifacts: [artifacts[0], artifacts[0]] }, { artifacts: [{ ...artifacts[0], sha256: 'bad' }, artifacts[1]] }]) {
    assert.throws(() => createEmailTestR2Download({ ...config, ...change }), /pins/);
  }
});

test('default authorization checks the allowlist and current pinned Service grant before R2', async () => {
  const f = fixture();
  const handle = createEmailTestR2Download(config, undefined, () => 1000);
  let grantStatus = 200, marker = 'accepted-test-build', accessCalls = 0;
  Object.assign(f.env, {
    HPS_EMAIL_TEST_PARTICIPANTS: JSON.stringify(['synthetic-participant']),
    HPS_EMAIL_VERSION: '11111111-1111-1111-1111-111111111111',
    HPS_EMAIL_EXPECTED_BUILD: 'accepted-test-build',
    EXISTING_AI: { async fetch(url, options) {
      accessCalls++;
      assert.equal(url, 'https://api.hypeproof-ai.xyz/v1/access');
      assert.equal(options.headers.authorization, 'Bearer synthetic-participant');
      assert.equal(options.headers['Cloudflare-Workers-Version-Overrides'], 'hypeproof-studio-api="11111111-1111-1111-1111-111111111111"');
      assert.equal(options.redirect, 'manual');
      return new Response('', { status: grantStatus, headers: { 'x-hps-email-test': marker } });
    } },
  });
  assert.equal((await handle(request(), f.env)).status, 401);
  assert.equal(accessCalls, 0); assert.deepEqual(f.calls, []);
  const authorized = () => request('/install/manifest.json', { headers: { Authorization: 'Bearer synthetic-participant' } });
  for (const status of [401, 403, 500]) {
    grantStatus = status;
    assert.equal((await handle(authorized(), f.env)).status, status === 500 ? 503 : 401);
    assert.deepEqual(f.calls, []);
  }
  grantStatus = 200; marker = 'wrong-build';
  assert.equal((await handle(authorized(), f.env)).status, 503); assert.deepEqual(f.calls, []);
  marker = 'accepted-test-build';
  assert.equal((await handle(authorized(), f.env)).status, 200);
  assert.equal(f.calls.length, 1);
  grantStatus = 403;
  assert.equal((await handle(authorized(), f.env)).status, 401);
  assert.equal(f.calls.length, 1, 'a previously valid download must not cache access');
});
