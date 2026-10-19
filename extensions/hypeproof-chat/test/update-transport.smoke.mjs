import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadVerifiedUpdate, trustedUpdateUrl, fetchLatestRelease } from '../src/updateTransport.ts';

const root = await mkdtemp(join(tmpdir(), 'hps-update-transport-'));
const originalFetch = globalThis.fetch;
const originalToken = process.env.HPS_RELEASE_TOKEN;
process.env.HPS_RELEASE_TOKEN = "test-private-release-token";
const data = Buffer.from('verified release bytes');
const asset = {
  downloadUrl: 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/assets/123',
  sizeBytes: data.length,
  digest: `sha256:${createHash('sha256').update(data).digest('hex')}`,
};
let count = 0;
async function fails(overrides, response, pattern, options) {
  const dest = join(root, `failed-${count++}`);
  globalThis.fetch = response;
  await assert.rejects(downloadVerifiedUpdate({ ...asset, ...overrides }, dest, options), pattern);
  await assert.rejects(readFile(dest), { code: 'ENOENT' });
}
try {
  for (const url of ['http://github.com/x', 'https://github.com.evil.test/x', 'https://github.com/other/repo/releases/download/x', 'https://user@github.com/hypeproof/hypeproof-studio-releases/releases/download/x']) {
    assert.equal(trustedUpdateUrl(url), false);
  }
  assert.equal(trustedUpdateUrl(asset.downloadUrl), true);
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    if (++calls === 1) {
      assert.equal(url, asset.downloadUrl);
      assert.equal(options.headers.authorization, 'Bearer test-private-release-token');
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset?signed=fixture' } });
    }
    assert.equal(options.headers, undefined, 'token must not reach asset CDN');
    assert.equal(options.redirect, 'error');
    return new Response(data);
  };
  const dest = join(root, 'good');
  await downloadVerifiedUpdate(asset, dest);
  assert.deepEqual(await readFile(dest), data);
  globalThis.fetch = async () => new Response(data);
  await assert.rejects(downloadVerifiedUpdate(asset, dest), /EEXIST/);
  assert.deepEqual(await readFile(dest), data, 'never delete a pre-existing destination');
  await fails({}, async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/asset' } }), /Untrusted update redirect/);
  await fails({}, async () => new Response(null, { status: 302, headers: { location: 'https://user@release-assets.githubusercontent.com/asset' } }), /Untrusted update redirect/);
  await fails({ digest: undefined }, () => { throw Error('must not fetch'); }, /digest/);
  await fails({ downloadUrl: 'https://evil.test/app.zip' }, () => { throw Error('must not fetch'); }, /Untrusted/);
  await fails({ digest: 'sha256:' + '0'.repeat(64) }, async () => new Response(data), /mismatch/);
  await fails({}, async () => new Response(data.subarray(0, 3)), /Incomplete/);
  await fails({}, async () => new Response(Buffer.concat([data, data])), /exceeds/);
  await fails({}, async () => new Response('', { status: 503 }), /503/);
  await fails({}, async () => new Response(new ReadableStream({ start(c) { c.enqueue(data.subarray(0, 3)); c.error(new Error('connection lost')); } })), /connection lost/);
  await fails({}, async () => new Response(new ReadableStream({ start(c) { c.enqueue(data.subarray(0, 3)); } })), /abort/i, { idleTimeoutMs: 30 });
  await fails({}, (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))), /timed out/, { idleTimeoutMs: 30 });
  globalThis.fetch = async () => new Response('', { status: 429 });
  await assert.rejects(fetchLatestRelease(), /429/);
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer test-private-release-token');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal, 'release check must be bounded');
    return Response.json({ tag_name: 'v0.1.51', assets: [] });
  };
  assert.equal((await fetchLatestRelease()).tag_name, 'v0.1.51');
  console.log('PASS update transport: verified bytes, corruption/truncation/HTTP/timeout failures, cleanup, origin and existing-file guards');
} finally {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.HPS_RELEASE_TOKEN; else process.env.HPS_RELEASE_TOKEN = originalToken;
  await rm(root, { recursive: true, force: true });
}
