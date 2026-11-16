// Release acceptance gives the shipped App's public release read the CI job token
// (updateTransport.ts acceptanceCheckToken), so a hosted runner's shared IP and its
// 60/h anonymous budget cannot decide the check. Everywhere else the read stays
// anonymous (D19). No network: fetch is stubbed and every request is recorded.
//
//   negative controls: no env, token without the flag, flag without the token, a
//                      flag other than exactly "1", a blank token -> no credential;
//                      with the flag and token, a public asset download and the
//                      private mirror never receive the acceptance token
//   positive:          flag "1" + token -> one public read with `Bearer <token>`
//
// Run: node --experimental-strip-types test/update-acceptance-token.smoke.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceCheckToken, fetchPublicLatestRelease, fetchLatestRelease, downloadVerifiedUpdate, PUBLIC_RELEASES_API } from '../src/updateTransport.ts';

const KEYS = ['HPS_UPDATE_CHECK_ACCEPTANCE', 'HPS_UPDATE_CHECK_TOKEN', 'HPS_RELEASE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'];
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
const originalFetch = globalThis.fetch;
const TOKEN = 'acceptance-job-token';
const requests = [];
const auth = (init) => (init?.headers ?? {}).authorization ?? null;
const setEnv = (vars) => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, vars); };
const root = await mkdtemp(join(tmpdir(), 'hps-acceptance-token-'));

try {
  // The pure gate.
  assert.equal(acceptanceCheckToken({}), null);
  assert.equal(acceptanceCheckToken({ HPS_UPDATE_CHECK_TOKEN: TOKEN }), null, 'token without the flag');
  assert.equal(acceptanceCheckToken({ HPS_UPDATE_CHECK_ACCEPTANCE: '1' }), null, 'flag without the token');
  for (const flag of ['true', 'yes', '0', ' 1', '']) assert.equal(acceptanceCheckToken({ HPS_UPDATE_CHECK_ACCEPTANCE: flag, HPS_UPDATE_CHECK_TOKEN: TOKEN }), null, `flag ${JSON.stringify(flag)}`);
  assert.equal(acceptanceCheckToken({ HPS_UPDATE_CHECK_ACCEPTANCE: '1', HPS_UPDATE_CHECK_TOKEN: '   ' }), null, 'blank token');
  assert.equal(acceptanceCheckToken({ HPS_UPDATE_CHECK_ACCEPTANCE: '1', HPS_UPDATE_CHECK_TOKEN: ` ${TOKEN} ` }), TOKEN);
  // The general-purpose tokens never count as the acceptance token.
  assert.equal(acceptanceCheckToken({ HPS_UPDATE_CHECK_ACCEPTANCE: '1', GITHUB_TOKEN: TOKEN, GH_TOKEN: TOKEN }), null);

  // The real public read, as a launch sees it.
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), auth: auth(init) }); return new Response(JSON.stringify({ tag_name: 'v1' }), { status: 200 }); };
  for (const vars of [{}, { HPS_UPDATE_CHECK_TOKEN: TOKEN }, { HPS_UPDATE_CHECK_ACCEPTANCE: '1' }, { HPS_UPDATE_CHECK_ACCEPTANCE: 'true', HPS_UPDATE_CHECK_TOKEN: TOKEN }, { GITHUB_TOKEN: TOKEN }]) {
    setEnv(vars);
    requests.length = 0;
    await fetchPublicLatestRelease();
    assert.deepEqual(requests, [{ url: PUBLIC_RELEASES_API, auth: null }], `anonymous with ${JSON.stringify(Object.keys(vars))}`);
  }
  setEnv({ HPS_UPDATE_CHECK_ACCEPTANCE: '1', HPS_UPDATE_CHECK_TOKEN: TOKEN });
  requests.length = 0;
  await fetchPublicLatestRelease();
  assert.deepEqual(requests, [{ url: PUBLIC_RELEASES_API, auth: `Bearer ${TOKEN}` }], 'acceptance read carries the job token');

  // With the acceptance env set, the private mirror still uses only the member credential...
  setEnv({ HPS_UPDATE_CHECK_ACCEPTANCE: '1', HPS_UPDATE_CHECK_TOKEN: TOKEN, HPS_RELEASE_TOKEN: 'member-token' });
  requests.length = 0;
  await fetchLatestRelease();
  assert.deepEqual(requests.map(r => r.auth), ['Bearer member-token'], 'mirror never gets the acceptance token');

  // ...and a public asset download stays anonymous.
  const data = Buffer.from('public bytes');
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), auth: auth(init) }); return new Response(data, { status: 200 }); };
  setEnv({ HPS_UPDATE_CHECK_ACCEPTANCE: '1', HPS_UPDATE_CHECK_TOKEN: TOKEN });
  requests.length = 0;
  await downloadVerifiedUpdate({ downloadUrl: 'https://api.github.com/repos/hypeproof/hypeproof-studio/releases/assets/456', sizeBytes: data.length,
    digest: `sha256:${createHash('sha256').update(data).digest('hex')}` }, join(root, 'asset'));
  assert.ok(requests.length >= 1 && requests.every(r => r.auth === null), `asset download is anonymous: ${JSON.stringify(requests)}`);

  console.log('PASS update acceptance token: ignored without exactly HPS_UPDATE_CHECK_ACCEPTANCE=1 and a token; public read only; mirror and asset download untouched');
} finally {
  globalThis.fetch = originalFetch;
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await rm(root, { recursive: true, force: true });
}
