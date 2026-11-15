// Kit scenario: web-to-app sign-in handoff across the real Service router (@hypeproof/service-testkit, local
// workerd/D1) and the real app client (AccountSession). The Lab's part is played exactly as the Lab server calls it:
// POST /v1/me/handoff with the bridge key AND the person's web session (hypeprooflab web/src/app/api/studio-account/
// handoff/route.ts). No Google, no Lab server, no Electron.
//
// Run: node --experimental-strip-types e2e/accounts/handoff-kit.mjs
// Needs a testkit that carries the handoff routes (hypeproof-service #542, migration 0095).
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createMiniflare } from '@hypeproof/service-testkit/test/harness/miniflare.mjs';
import { createMockEnv, bootApp, makeCtx } from '@hypeproof/service-testkit/test/harness/index.mjs';
import { AccountSession, ACCOUNT_SECRET_KEY, HANDOFF_REFUSED_MESSAGE } from '../../extensions/hypeproof-chat/src/accountSession.ts';
import { accountHandoffTicket } from '../../extensions/hypeproof-chat/src/accountHandoffUri.ts';

const kit = dirname(createRequire(import.meta.url).resolve('@hypeproof/service-testkit/package.json'));
const sql = file => join(kit, 'dist/worker', file);
if (!existsSync(sql('migrations/0095-account-handoff-tickets.sql'))) {
  console.log(JSON.stringify({ scenario: 'account-handoff-kit', result: 'NOT_RUN', reason: 'installed service-testkit has no migration 0095 (needs a testkit release carrying hypeproof-service #542)' }));
  process.exit(2);
}
const SERVICE = 'https://service.synthetic.invalid/v1', SITE = 'https://lab.synthetic.invalid', BRIDGE = 'synthetic-handoff-kit-lab-bridge-key';
const mf = createMiniflare({ modules: true, script: 'export default {fetch(){return new Response("kit")}}', compatibilityDate: '2026-05-15', d1Databases: ['HPS_DB'] });
let checks = 0, calls = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; console.log('PASS', label); };
try {
  const db = await mf.getD1Database('HPS_DB');
  for (const file of ['schema.sql', 'migrations/0004-native-trials.sql', 'migrations/0007-access-contracts.sql', 'migrations/0043-purchase-orders.sql', 'migrations/0047-personal-accounts.sql', 'migrations/0048-account-operations.sql', 'migrations/0049-native-grant-purpose.sql', 'migrations/0065-account-super-access.sql', 'migrations/0074-studio-invites.sql', 'migrations/0076-studio-invite-email.sql', 'migrations/0095-account-handoff-tickets.sql'])
  {
    // Triggers contain ';' inside BEGIN ... END: run them whole, after the plain statements (as Service's tests do).
    const text = readFileSync(sql(file), 'utf8').replace(/--[^\n]*/g, ''), triggers = [...text.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map(m => m[0]);
    for (const statement of [...text.replace(/CREATE TRIGGER[\s\S]*?END;/g, '').split(';').filter(s => s.trim()), ...triggers]) await db.prepare(statement).run();
  }
  const env = createMockEnv({ env: { HPS_DB: db, HPS_ACCOUNTS: 'enabled', HPS_ACCOUNT_LAB_KEY: BRIDGE, HPS_ACCOUNT_LAB_ORIGIN: SITE } });
  const app = await bootApp();
  // Every request of the app client and of the "Lab server" goes to the real router.
  const fetch = async (url, init = {}) => app.fetch(new Request(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), 'cf-connecting-ip': 'kit-' + (++calls) } }), env, makeCtx());
  const service = async (path, { body, headers = {} } = {}) => { const r = await fetch(SERVICE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) }); return { status: r.status, json: await r.json() }; };
  const signUp = subject => service('/internal/accounts/upsert', { headers: { 'x-hps-account-key': BRIDGE }, body: { provider: 'google', subject, email: subject + '@example.invalid', email_verified: true, display_name: subject, age_band: '14+', consents: ['terms', 'privacy', 'overseas_transfer'].map(kind => ({ kind, version: '2026-11-12', granted: true })) } });
  // The Lab server's mint: both headers.
  const labMint = web => service('/me/handoff', { headers: { 'x-hps-account-key': BRIDGE, authorization: 'Bearer ' + web.access_token } });
  const store = new Map();
  const studio = new AccountSession({ service: SERVICE, site: SITE, label: 'Kit Mac · Studio', fetch, openBrowser: async () => true,
    secrets: { get: async k => store.get(k), store: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); } } });
  const ticketOf = uri => accountHandoffTicket({ scheme: 'hypeproof-studio', authority: 'hypeproof.hypeproof-chat', path: new URL(uri).pathname, query: new URL(uri).search.slice(1), fragment: '' }, 'hypeproof-studio');
  const linkFor = ticket => `hypeproof-studio://hypeproof.hypeproof-chat/account-handoff?ticket=${ticket}`;

  const web = (await signUp('kit-friend')).json;
  eq(typeof web.access_token, 'string', 'Lab sign-in made a web session');
  eq((await service('/me/handoff', { headers: { 'x-hps-account-key': BRIDGE } })).status, 401, 'bridge key alone cannot mint');
  eq((await service('/me/handoff', { headers: { authorization: 'Bearer ' + web.access_token } })).status, 401, 'web session alone (a browser) cannot mint');

  // mint -> exchange -> session
  const minted = await labMint(web);
  eq(minted.status, 200, 'Lab mints with both headers');
  const ticket = ticketOf(linkFor(minted.json.ticket));
  eq(ticket, minted.json.ticket, 'the deep link the Lab opens passes the app\'s strict shape check');
  eq(await studio.handoff(ticket, async () => false), 'signedIn', 'app exchanges the ticket and signs in');
  eq(studio.view().status, 'signedIn', 'app view is signed in');
  eq(studio.view().account?.id, web.account.id, 'as the same account as the web session');
  const bundle = JSON.parse(store.get(ACCOUNT_SECRET_KEY));
  const me = await fetch(SERVICE + '/me', { headers: { authorization: 'Bearer ' + bundle.accessToken } });
  eq([me.status, (await me.json()).account.id], [200, web.account.id], 'the stored app session authenticates /v1/me');
  eq((await db.prepare('SELECT kind FROM account_sessions WHERE id=?').bind(bundle.sessionId).first()).kind, 'studio', 'a studio session, not the web one');

  // reuse refused
  const fresh = () => new AccountSession({ service: SERVICE, site: SITE, label: 'Kit second Mac', fetch, openBrowser: async () => true, secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} } });
  const second = fresh();
  eq(await second.handoff(ticket, async () => true), 'refused', 'a used ticket is refused');
  eq(second.view().message, HANDOFF_REFUSED_MESSAGE, 'with the one refusal message');

  // expiry refused
  const late = (await labMint(web)).json.ticket;
  await db.prepare('UPDATE account_handoff_tickets SET expires_at=? WHERE consumed_at IS NULL').bind(Math.floor(Date.now() / 1000)).run();
  const third = fresh();
  eq(await third.handoff(late, async () => true), 'refused', 'an expired ticket is refused');

  // a stale web session must sign in again (the Lab then re-runs Google sign-in or makes a fresh web session)
  await db.prepare('UPDATE account_sessions SET created_at=created_at-601 WHERE id=?').bind(web.session_id).run();
  const stale = await labMint(web);
  eq([stale.status, stale.json.error], [403, 'handoff_reauth_required'], 'a web session older than 10 minutes cannot mint');
  const again = (await signUp('kit-friend')).json;
  eq((await labMint(again)).status, 200, 'a fresh web session for the same account mints again');

  console.log(JSON.stringify({ scenario: 'account-handoff-kit', checks, result: 'PASS', runtime: 'service-testkit router + local workerd/D1 + real AccountSession', live: 'NOT_RUN' }));
} finally { await mf.dispose(); }
