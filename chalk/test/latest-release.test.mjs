// DEC-24 (Jay, 2026-11-12) for CGP-SHELL-R-034: Chalk reads the latest published formal Studio release from the public
// release (the anonymous source Studio's update checker reads) and serves it at GET /studio/latest-release for /manage.
// Planted answers, no network: only a plain x.y.z, non-draft, non-prerelease tag becomes the floor; every failure is
// null (unknown → nobody flagged; a 403/429 rate limit too, retried after a minute, so refreshes do not hammer GitHub); no
// credential leaves; a good answer is reused for 10 minutes. Outside production HPS_STUDIO_LATEST_RELEASE answers instead, and
// the e2e harness sets it off, so CI never reads GitHub.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import {
  LATEST_RELEASE_API, LATEST_RELEASE_RETRY_MS, LATEST_RELEASE_TTL_MS,
  formalReleaseVersion, latestFormalRelease, resetLatestReleaseMemo,
  SECURITY_CRITICAL_MARKER, isSecurityCriticalRelease,
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
  assert.deepEqual(first, {version: '2026.1109.0', checked_at: new Date(t0).toISOString(), security_critical: false});
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
      assert.deepEqual(Object.keys(body).sort(), ['checked_at', 'security_critical', 'source', 'version']);
      assert.equal(body.security_critical, false);
      assert.equal(body.version, want);
    }
  } finally { globalThis.fetch = previous; resetLatestReleaseMemo(); }
});

test('outside production HPS_STUDIO_LATEST_RELEASE answers without GitHub; the e2e harness sets it off', async () => {
  const {default: app} = await import('../src/index.ts');
  const {withHeaderConnection, withBearerAsConnection} = await import('./harness/connect.mjs');
  const previous = globalThis.fetch;
  const read = async (fetcher, env) => (await (await fetcher.fetch(new Request('https://chalk.test/studio/latest-release'), env)).json());
  try {
    resetLatestReleaseMemo();
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('GitHub must not be read here'); };
    assert.deepEqual(await read(app, {ENVIRONMENT: 'test', HPS_STUDIO_LATEST_RELEASE: 'off'}), {version: null, checked_at: null, security_critical: false, source: 'HPS_STUDIO_LATEST_RELEASE'});
    assert.equal((await read(app, {ENVIRONMENT: 'test', HPS_STUDIO_LATEST_RELEASE: '2026.1111.0'})).version, '2026.1111.0');
    assert.equal((await read(app, {ENVIRONMENT: 'dev', HPS_STUDIO_LATEST_RELEASE: '2026.1111.0-rc.1'})).version, null, 'an rc is never a floor, here either');
    // Both browser-test wrappers default it to off, so no CI run that opens /manage reads GitHub.
    for (const wrapper of [withHeaderConnection, withBearerAsConnection]) {
      assert.equal((await read(wrapper(app), {})).source, 'HPS_STUDIO_LATEST_RELEASE', wrapper.name);
      assert.equal((await read(wrapper(app), {HPS_STUDIO_LATEST_RELEASE: '2026.1109.0'})).version, '2026.1109.0', wrapper.name + ' keeps a named floor');
    }
    assert.equal(calls, 0, 'no GitHub read outside production with the override');
    // Production ignores the override and reads the public release.
    globalThis.fetch = async (url) => { calls++; assert.equal(String(url), LATEST_RELEASE_API); return Response.json(release('v2026.1109.0')); };
    const prod = await read(app, {ENVIRONMENT: 'production', HPS_STUDIO_LATEST_RELEASE: '2026.1999.0'});
    assert.equal(prod.version, '2026.1109.0'); assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; resetLatestReleaseMemo(); }
});

// CGP-SHELL-R-003 — a security-critical release (its notes carry the marker line) is labelled so in Chalk; the cohort
// freeze does not hold it in Studio. The same line Studio's update checker reads.
test('a security-critical release is read from its notes, only on a formal release, and never on a failure', async () => {
  assert.equal(SECURITY_CRITICAL_MARKER, '<!-- hps-update: security-critical -->');
  const marked = release('v2026.1112.0', {body: 'Fixes\n\n' + SECURITY_CRITICAL_MARKER + '\n'});
  assert.equal(isSecurityCriticalRelease(marked), true);
  assert.equal(isSecurityCriticalRelease(release('v2026.1112.0', {body: 'see ' + SECURITY_CRITICAL_MARKER + ' inline'})), false, 'the line on its own only');
  assert.equal(isSecurityCriticalRelease(release('v2026.1112.0', {body: 'security fix'})), false, 'words are not the marker');
  for (const junk of [null, 'x', [], {}, release('v2026.1112.0')]) assert.equal(isSecurityCriticalRelease(junk), false);
  const t0 = Date.UTC(2026, 10, 12, 9, 0, 0);
  resetLatestReleaseMemo();
  const latest = await latestFormalRelease(t0, async () => Response.json(marked));
  assert.deepEqual(latest, {version: '2026.1112.0', checked_at: new Date(t0).toISOString(), security_critical: true});
  assert.equal((await latestFormalRelease(t0 + 1, async () => { throw new Error('cached'); })).security_critical, true, 'reused with the version');
  resetLatestReleaseMemo();
  assert.equal((await latestFormalRelease(t0, async () => Response.json({...marked, prerelease: true}))).security_critical, false, 'an rc is not labelled');
  resetLatestReleaseMemo();
  const {default: app} = await import('../src/index.ts');
  const read = async env => (await (await app.fetch(new Request('https://chalk.test/studio/latest-release'), env)).json());
  assert.equal((await read({ENVIRONMENT: 'test', HPS_STUDIO_LATEST_RELEASE: '2026.1112.0', HPS_STUDIO_LATEST_RELEASE_SECURITY: '1'})).security_critical, true);
  assert.equal((await read({ENVIRONMENT: 'test', HPS_STUDIO_LATEST_RELEASE: 'off', HPS_STUDIO_LATEST_RELEASE_SECURITY: '1'})).security_critical, false, 'unknown release: no label');
  resetLatestReleaseMemo();
});
