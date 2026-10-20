// CONV-FUNNEL-R-007 (Studio half): a sign-in that starts on a free seat sends the free seat's own
// credential as `x-hps-free-credential` on every POST /v1/auth/device/poll, so the Service links that
// free seat to the account (hypeproof-service #176). Real AccountSession, synthetic Service on fetch.
// Controls: no free credential / non-free seat / failing read -> no header and an identical sign-in;
// /auth/device/start never carries it; the value is the grant token, never the account token.
//
// Run: node --experimental-strip-types test/account-signin-free-link.smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AccountSession, FREE_CREDENTIAL_READ_MS } from '../src/accountSession.ts';

const SERVICE = 'http://127.0.0.1:8794/v1', SITE = 'http://localhost:3194';
const GRANT = 'free-grant-token-' + 'g'.repeat(40);
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function harness(freeCredential) {
  const world = { calls: [], store: new Map(), poll: 'pending', logs: [] };
  const secrets = { get: async k => world.store.get(k), store: async (k, v) => { world.store.set(k, v); }, delete: async k => { world.store.delete(k); } };
  const fetch = async (url, init = {}) => {
    const u = new URL(url), h = new Headers(init.headers);
    world.calls.push({ path: u.pathname, free: h.get('x-hps-free-credential'), authorization: h.get('authorization') });
    if (u.pathname.endsWith('/device/start')) return reply(200, { device_code: 'device-code-1', user_code: 'HPDX-4K7Q', verification_uri_complete: SITE + '/studio/connect?code=HPDX-4K7Q', expires_in: 600, interval: 3 });
    if (u.pathname.endsWith('/device/poll')) {
      if (world.poll === 'pending') return reply(202, { status: 'pending' });
      if (world.poll === 'slow') return reply(429, { error: 'slow_down' });
      return reply(200, { access_token: 'account-access-token', refresh_token: 'account-refresh-token', session_id: 'session-one', expires_in: 3600 });
    }
    if (u.pathname.endsWith('/me')) return reply(200, { account: { id: 'account-one', email: 'buyer@example.test', display_name: '테스트 고객' } });
    if (u.pathname.endsWith('/me/passes')) return reply(200, { passes: [] });
    if (u.pathname.endsWith('/auth/logout')) return reply(200, { ok: true });
    throw new Error('Unexpected request ' + u.pathname);
  };
  const client = new AccountSession({ service: SERVICE, site: SITE, secrets, label: 'Test Studio', fetch, now: () => 1_000_000, openBrowser: async () => true, ...(freeCredential ? { freeCredential } : {}) });
  return { world, client };
}
const polls = world => world.calls.filter(c => c.path.endsWith('/auth/device/poll'));
const starts = world => world.calls.filter(c => c.path.endsWith('/auth/device/start'));

async function signIn(freeCredential) {
  const { world, client } = harness(freeCredential);
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(original)) console[k] = (...a) => world.logs.push(a.map(String).join(' '));
  try {
    await client.start(); assert.equal(client.view().status, 'waiting');
    await client.poll();                       // pending
    world.poll = 'slow'; await client.poll();  // slow_down, retried
    world.poll = 'approved'; await client.poll();
  } finally { Object.assign(console, original); }
  assert.equal(client.view().status, 'signedIn', 'the sign-in completes');
  client.dispose();
  return world;
}

// Positive: a free seat sends the grant token on every poll, including the completing one.
{
  let reads = 0;
  const world = await signIn(async () => { reads++; return GRANT; });
  assert.equal(polls(world).length, 3);
  for (const p of polls(world)) assert.equal(p.free, GRANT, 'every device poll carries the free credential');
  assert.equal(reads, 1, 'the free credential is read once, when the sign-in starts');
  // The value is the grant token, never the account token, and no poll carries a bearer.
  for (const p of polls(world)) { assert.notEqual(p.free, 'account-access-token'); assert.equal(p.authorization, null); }
  // Start call unaffected: no free header there.
  assert.equal(starts(world).length, 1); assert.equal(starts(world)[0].free, null, '/auth/device/start carries no free credential');
  // Only device polls carry it: /me and /me/passes (account bearer) do not.
  for (const c of world.calls.filter(c => !c.path.endsWith('/auth/device/poll'))) assert.equal(c.free, null, `${c.path} carries no free credential`);
  assert.ok(!world.logs.some(l => l.includes(GRANT)), 'the free credential is never logged');
  assert.ok(![...world.store.values()].some(v => v.includes(GRANT)), 'the free credential is never stored with the account');
  console.log('PASS free seat: every device poll carries the grant token; start, /me and logs do not');
}

// Negative controls: no option, non-free seat (undefined), empty string, a throwing read.
// The baseline is the free seat itself: the same calls must go out whether or not a header rides on them.
const shape = world => world.calls.map(c => c.path).join(',');
const baseline = await signIn(async () => GRANT);
for (const [name, fc] of [['no runtime option', undefined], ['non-free seat (paid/account/code)', async () => undefined], ['empty token', async () => ''], ['read throws', async () => { throw Error('keychain locked'); }], ['read hangs', () => new Promise(() => {})]]) {
  const world = await signIn(fc);
  for (const c of world.calls) assert.equal(c.free, null, `${name}: ${c.path} carries no free credential`);
  assert.equal(shape(world), shape(baseline), `${name}: the sign-in makes the same calls as without the feature`);
  console.log(`PASS ${name}: no header, sign-in unchanged`);
}

// A cancelled sign-in forgets the credential with the device; a new sign-in reads again.
{
  let seat = GRANT;
  const { world, client } = harness(async () => seat);
  await client.start(); client.cancel(false);
  seat = undefined; // the seat is no longer free when the next sign-in starts
  await client.start(); await client.poll();
  assert.equal(polls(world).at(-1).free, null, 'a new sign-in from a non-free seat sends no header');
  client.dispose();
  console.log('PASS the credential follows the seat a sign-in starts from');
}

// A read that hangs is bounded: the sign-in starts without the header after FREE_CREDENTIAL_READ_MS.
{
  assert.ok(FREE_CREDENTIAL_READ_MS <= 2_000, 'the bound stays short');
  const { world, client } = harness(() => new Promise(() => {}));
  const t0 = Date.now(); await client.start();
  assert.equal(client.view().status, 'waiting'); assert.ok(Date.now() - t0 < FREE_CREDENTIAL_READ_MS + 1_000);
  await client.poll(); assert.equal(polls(world)[0].free, null);
  client.dispose();
  console.log('PASS a hanging read never holds the sign-in');
}

// Cancel while the credential is being read: no /auth/device/start goes out at all.
{
  let release; const { world, client } = harness(() => new Promise(r => { release = r; }));
  const started = client.start(); await new Promise(r => setImmediate(r));
  client.cancel(false); release(GRANT); await started;
  assert.equal(starts(world).length, 0, 'a sign-in cancelled during the read sends no start');
  console.log('PASS cancel during the read sends nothing');
}

// A final poll that lands after cancel revokes the new session; that logout carries no free credential.
{
  const { world, client } = harness(async () => GRANT);
  await client.start(); world.poll = 'approved';
  const p = client.poll(); client.cancel(false); await p;
  const logout = world.calls.filter(c => c.path.endsWith('/auth/logout'));
  assert.equal(logout.length, 1, 'the late session is revoked'); assert.equal(logout[0].free, null, 'the revoking logout carries no free credential');
  assert.equal(polls(world).at(-1).free, GRANT, 'the poll itself was sent before the cancel was known');
  console.log('PASS late-poll revoke carries no free credential');
}

// Wiring: the extension feeds the runtime from the start page's free-seat rule (same as the order header).
{
  const ext = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  assert.match(ext, /freeCredential: \(\): Promise<string \| undefined> => startPage\.freeSignInCredential\(\),/);
  const page = readFileSync(new URL('../src/startPage.ts', import.meta.url), 'utf8');
  assert.match(page, /freeSignInCredential\(\): Promise<string \| undefined> \{ return this\.freeSeatNow \? await this\.currentToken\(\) : undefined; \}/);
  console.log('PASS extension wires freeCredential to StartPage.freeSignInCredential (free seat only)');
}
