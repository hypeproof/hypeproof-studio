// DEC-24 (Jay, 2026-11-12) for CGP-SHELL-R-034: Chalk reads the latest published formal Studio release from the public
// release (the anonymous source Studio's update checker reads) and serves it at GET /studio/latest-release for /manage.
// Planted answers, no network: only a plain x.y.z, non-draft, non-prerelease tag becomes the floor; every failure is
// null (unknown → nobody flagged); no credential leaves; a good answer is reused for 10 minutes, a failure for 1 minute.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import {
  LATEST_RELEASE_API, LATEST_RELEASE_RETRY_MS, LATEST_RELEASE_TTL_MS,
  formalReleaseVersion, latestFormalRelease, resetLatestReleaseMemo,
} from '../src/lib/latest-release.ts';

const release = (tag, extra = {}) => ({tag_name: tag, draft: false, prerelease: false, html_url: 'https://github.com/x', ...extra});

test('only a plain x.y.z formal release is a floor', () => {
  assert.equal(formalReleaseVersion(release('v2026.1109.0')), '2026.1109.0');
  assert.equal(formalReleaseVersion(release('2026.1111.0')), '2026.1111.0', 'a tag without v');
  assert.equal(formalReleaseVersion(release('v2026.1111.0-rc.1')), null, 'an rc tag is never the floor, even if not marked');
  assert.equal(formalReleaseVersion(release('v2026.1111.0', {prerelease: true})), null, 'a prerelease');
  assert.equal(formalReleaseVersion(release('v2026.1111.0', {draft: true})), null, 'a draft');
  assert.equal(formalReleaseVersion(release('v2026.1111.0', {prerelease: undefined})), null, 'a body without the flags');
  for (const junk of [null, undefined, 'v2026.1109.0', [], {}, release(42), release('latest'), release('v1.2'), release('v99999.1.1')])
    assert.equal(formalReleaseVersion(junk), null, JSON.stringify(junk));
});

test('reads the public release anonymously, bounded, and caches the answer', async () => {
  resetLatestReleaseMemo();
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({url, init}); return Response.json(release('v2026.1109.0')); };
  const t0 = Date.UTC(2026, 10, 12, 9, 0, 0);
  const first = await latestFormalRelease(t0, fetchImpl);
  assert.deepEqual(first, {version: '2026.1109.0', checked_at: new Date(t0).toISOString()});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, LATEST_RELEASE_API);
  assert.equal(LATEST_RELEASE_API, 'https://api.github.com/repos/hypeproof/hypeproof-studio/releases/latest');
  const headers = calls[0].init.headers;
  assert.deepEqual(Object.keys(headers).sort(), ['accept', 'user-agent'], 'no authorization, no cookie: nothing but accept and a user agent');
  assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.redirect, 'error'); assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(calls[0].init.cf, {cacheTtl: LATEST_RELEASE_TTL_MS / 1000, cacheEverything: true});
  // Within 10 minutes the answer is reused; after, the source is read again.
  assert.deepEqual(await latestFormalRelease(t0 + LATEST_RELEASE_TTL_MS - 1, fetchImpl), first);
  assert.equal(calls.length, 1);
  await latestFormalRelease(t0 + LATEST_RELEASE_TTL_MS, fetchImpl);
  assert.equal(calls.length, 2);
});

test('every failure is unknown (null), retried after a minute, and never keeps an old floor', async () => {
  const t0 = Date.UTC(2026, 10, 12, 9, 0, 0);
  const failures = {
    'rate limit 403': async () => Response.json({message: 'API rate limit exceeded'}, {status: 403, headers: {'x-ratelimit-remaining': '0'}}),
    '429': async () => new Response('', {status: 429}),
    '404 (repository gone)': async () => new Response('', {status: 404}),
    '503': async () => new Response('', {status: 503}),
    'network error': async () => { throw new TypeError('fetch failed'); },
    'timeout': async () => { throw new DOMException('timed out', 'TimeoutError'); },
    'not json': async () => new Response('<html>', {status: 200, headers: {'content-type': 'text/html'}}),
    'latest is an rc': async () => Response.json(release('v2026.1111.0-rc.1', {prerelease: true})),
  };
  for (const [name, fail] of Object.entries(failures)) {
    resetLatestReleaseMemo();
    let reads = 0;
    const good = async () => { reads++; return Response.json(release('v2026.1109.0')); };
    assert.equal((await latestFormalRelease(t0, good)).version, '2026.1109.0');
    // The good answer expires, then the source fails: the floor becomes unknown, not the old value.
    const failing = async (...a) => { reads++; return fail(...a); };
    assert.equal((await latestFormalRelease(t0 + LATEST_RELEASE_TTL_MS, failing)).version, null, name + ': unknown, not the old floor');
    assert.equal((await latestFormalRelease(t0 + LATEST_RELEASE_TTL_MS + LATEST_RELEASE_RETRY_MS - 1, good)).version, null, name + ': a failure is reused for a minute');
    assert.equal((await latestFormalRelease(t0 + LATEST_RELEASE_TTL_MS + LATEST_RELEASE_RETRY_MS, good)).version, '2026.1109.0', name + ': then read again');
    assert.equal(reads, 3, name + ': three reads');
  }
});

test('GET /studio/latest-release serves the floor or null, with no instructor connection', async () => {
  const {default: app} = await import('../src/index.ts');
  const previous = globalThis.fetch;
  try {
    for (const [answer, want] of [[() => Response.json(release('v2026.1109.0')), '2026.1109.0'], [() => new Response('', {status: 503}), null]]) {
      resetLatestReleaseMemo();
      globalThis.fetch = async (url) => { assert.equal(String(url), LATEST_RELEASE_API); return answer(); };
      const response = await app.fetch(new Request('https://chalk.test/studio/latest-release'), {ENVIRONMENT: 'production'});
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ['checked_at', 'source', 'version']);
      assert.equal(body.version, want);
    }
  } finally { globalThis.fetch = previous; resetLatestReleaseMemo(); }
});
