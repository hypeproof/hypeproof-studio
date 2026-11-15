// Web-to-app sign-in handoff: the strict link shape, the real AccountSession exchange, the
// "switch account?" decision, and the extension wiring. No Service, Lab or VS Code runtime.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountHandoffTicket } from '../src/accountHandoffUri.ts';
import { AccountSession, ACCOUNT_SECRET_KEY, HANDOFF_KEPT_MESSAGE, HANDOFF_REFUSED_MESSAGE, HANDOFF_SAME_ACCOUNT_MESSAGE } from '../src/accountSession.ts';

const root = new URL('../', import.meta.url).pathname;
const SCHEME = 'hypeproof-studio', TICKET = 'a1'.repeat(32);
const uri = (over = {}) => ({ scheme: SCHEME, authority: 'hypeproof.hypeproof-chat', path: '/account-handoff', query: `ticket=${TICKET}`, fragment: '', ...over });

// ── Link shape ──
{
  assert.equal(accountHandoffTicket(uri(), SCHEME), TICKET, 'positive control: the exact Lab link');
  assert.equal(accountHandoffTicket(uri({ scheme: 'hypeproof-studio-dev-x' }), 'hypeproof-studio-dev-x'), TICKET, 'a dev build accepts its own scheme');
  const bad = {
    'other scheme': uri({ scheme: 'https' }),
    'other authority': uri({ authority: 'evil.example' }),
    'other path': uri({ path: '/account-return' }),
    'trailing slash': uri({ path: '/account-handoff/' }),
    fragment: uri({ fragment: 'x' }),
    'no query': uri({ query: '' }),
    'upper-case ticket': uri({ query: `ticket=${TICKET.toUpperCase()}` }),
    'short ticket': uri({ query: 'ticket=abc' }),
    'long ticket': uri({ query: `ticket=${TICKET}00` }),
    'two tickets': uri({ query: `ticket=${TICKET}&ticket=${TICKET}` }),
    'extra key': uri({ query: `ticket=${TICKET}&windowId=1` }),
    'other key': uri({ query: `state=${TICKET}` }),
    'encoded ticket': uri({ query: `ticket=${encodeURIComponent(' ' + TICKET)}` }),
  };
  for (const [name, value] of Object.entries(bad)) assert.equal(accountHandoffTicket(value, SCHEME), undefined, name);
  assert.equal(accountHandoffTicket(uri(), ''), undefined, 'no scheme: refused');
  assert.equal(accountHandoffTicket(uri(), 'hypeproof-studio-other'), undefined, 'scheme must be this build');
  console.log('PASS link shape: exact /account-handoff?ticket=<64 hex> only');
}

// ── AccountSession.handoff ──
const SERVICE = 'http://127.0.0.1:8793/v1', SITE = 'http://localhost:3193';
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ALICE = { id: 'acc_alice', email: 'alice@example.test', display_name: '앨리스' };
const BOB = { id: 'acc_bob', email: 'bob@example.test', display_name: '밥' };
function harness({ exchange = 'ok', target = ALICE, signedIn, meFails = false, freeCredential } = {}) {
  const world = { now: 1_000_000, store: new Map(), calls: [], invalidated: [], asked: [] };
  const secrets = { get: async k => world.store.get(k), store: async (k, v) => { world.store.set(k, v); }, delete: async k => { world.store.delete(k); } };
  if (signedIn) world.store.set(ACCOUNT_SECRET_KEY, JSON.stringify({ service: SERVICE, accessToken: 'old-access', refreshToken: 'old-refresh', sessionId: 'ses_old', expiresAt: world.now + 3_600_000 }));
  const fetch = async (url, init = {}) => {
    const u = new URL(url), body = init.body ? JSON.parse(init.body) : undefined, headers = new Headers(init.headers);
    world.calls.push({ path: u.pathname, body, authorization: headers.get('authorization'), free: headers.get('x-hps-free-credential') });
    if (u.pathname.endsWith('/auth/handoff/exchange')) {
      if (exchange === 'refused') return reply(400, { error: 'invalid_handoff_ticket' });
      if (exchange === 'offline') throw new Error('offline');
      if (exchange === 'no-account') return reply(200, { access_token: 'new-access', refresh_token: 'new-refresh', session_id: 'ses_new', expires_in: 3600 });
      return reply(200, { access_token: 'new-access', refresh_token: 'new-refresh', session_id: 'ses_new', expires_in: 3600, account: { ...target, status: 'active' } });
    }
    if (u.pathname.endsWith('/auth/logout')) return reply(200, { ok: true });
    const token = headers.get('authorization');
    if (u.pathname.endsWith('/me')) {
      if (token === 'Bearer old-access') return meFails ? reply(503, { error: 'account_unavailable' }) : reply(200, { account: { ...signedIn, status: 'active' }, session_id: 'ses_old' });
      if (token === 'Bearer new-access') return reply(200, { account: { ...target, status: 'active' }, session_id: 'ses_new' });
    }
    if (u.pathname.endsWith('/me/passes')) return reply(200, { passes: [] });
    throw new Error('Unexpected request ' + u.pathname);
  };
  const client = new AccountSession({ service: SERVICE, site: SITE, secrets, label: 'Mac · Studio test', fetch, now: () => world.now, openBrowser: async () => true, invalidated: async id => { world.invalidated.push(id); }, ...(freeCredential ? { freeCredential: async () => freeCredential } : {}) });
  const stored = () => { const raw = world.store.get(ACCOUNT_SECRET_KEY); return raw ? JSON.parse(raw) : undefined; };
  const confirm = answer => async (t, c) => { world.asked.push([t.id, c?.id]); return answer; };
  return { world, client, stored, confirm };
}
const logouts = world => world.calls.filter(c => c.path.endsWith('/auth/logout')).map(c => c.authorization);

{ // Signed out: one exchange signs the app in as the web account, nobody is asked.
  const { world, client, stored, confirm } = harness({ freeCredential: 'free-seat-credential' });
  assert.equal(await client.handoff(TICKET, confirm(false)), 'signedIn');
  const exchange = world.calls.find(c => c.path.endsWith('/auth/handoff/exchange'));
  assert.deepEqual(exchange.body, { ticket: TICKET, label: 'Mac · Studio test' }, 'ticket and device label only');
  assert.equal(exchange.authorization, null, 'exchange carries no account credential');
  assert.equal(exchange.free, 'free-seat-credential', 'free seat credential follows the sign-in, as on the device poll');
  assert.equal(stored().sessionId, 'ses_new');
  assert.equal(JSON.stringify(stored()).includes(TICKET), false, 'the ticket is never stored');
  assert.deepEqual(world.asked, [], 'nobody signed in: no question');
  assert.equal(client.view().status, 'signedIn');
  assert.equal(client.view().account.id, ALICE.id);
  assert.equal(client.view().busy, false);
  assert.equal(JSON.stringify(client.view()).includes('new-access'), false, 'view has no credential');
  console.log('PASS signed out → signed in as the web account');
}
{ // Refused ticket: one message, nothing stored, existing sign-in untouched.
  const { world, client, stored, confirm } = harness({ exchange: 'refused', signedIn: BOB });
  assert.equal(await client.handoff(TICKET, confirm(true)), 'refused');
  assert.equal(client.view().message, HANDOFF_REFUSED_MESSAGE);
  assert.equal(stored().sessionId, 'ses_old', 'existing session kept');
  assert.deepEqual(logouts(world), [], 'nothing revoked');
  assert.deepEqual(world.asked, []);
  console.log('PASS used/expired ticket → one message, nothing changes');
}
{ // Offline and malformed answers fail closed; a session without an account is revoked.
  const offline = harness({ exchange: 'offline' });
  assert.equal(await offline.client.handoff(TICKET, offline.confirm(true)), 'refused');
  assert.equal(offline.stored(), undefined);
  const odd = harness({ exchange: 'no-account' });
  assert.equal(await odd.client.handoff(TICKET, odd.confirm(true)), 'refused');
  assert.equal(odd.stored(), undefined, 'no account in the answer: nothing stored');
  assert.deepEqual(logouts(odd.world), ['Bearer new-access'], 'the unusable new session is revoked');
  const malformed = harness();
  assert.equal(await malformed.client.handoff('not-a-ticket', malformed.confirm(true)), 'refused');
  assert.equal(malformed.world.calls.length, 0, 'a malformed ticket is never sent');
  console.log('PASS offline / malformed answer / malformed ticket fail closed');
}
{ // Different account signed in, person declines: the new session is revoked, the old one stays.
  const { world, client, stored, confirm } = harness({ signedIn: BOB });
  assert.equal(await client.handoff(TICKET, confirm(false)), 'kept');
  assert.deepEqual(world.asked, [[ALICE.id, BOB.id]], 'asked once, naming both accounts');
  assert.equal(stored().sessionId, 'ses_old');
  assert.deepEqual(logouts(world), ['Bearer new-access']);
  assert.deepEqual(world.invalidated, []);
  assert.equal(client.view().message, HANDOFF_KEPT_MESSAGE);
  console.log('PASS different account + "no" → current account kept, new session revoked');
}
{ // Different account signed in, person accepts: switch, old session revoked and its binding ended.
  const { world, client, stored, confirm } = harness({ signedIn: BOB });
  assert.equal(await client.handoff(TICKET, confirm(true)), 'signedIn');
  assert.equal(stored().sessionId, 'ses_new');
  assert.deepEqual(logouts(world), ['Bearer old-access'], 'replaced session revoked on the server');
  assert.deepEqual(world.invalidated, ['ses_old'], 'replaced session binding ended');
  assert.equal(client.view().account.id, ALICE.id);
  console.log('PASS different account + "바꾸기" → switched');
}
{ // Current account unknown (/me failed): still asked, never replaced silently.
  const { world, client, stored, confirm } = harness({ signedIn: BOB, meFails: true });
  assert.equal(await client.handoff(TICKET, confirm(false)), 'kept');
  assert.deepEqual(world.asked, [[ALICE.id, undefined]]);
  assert.equal(stored().sessionId, 'ses_old');
  console.log('PASS unknown current account → asked, kept on "no"');
}
{ // Same account already signed in: keep it, revoke the extra session, no question.
  const { world, client, stored, confirm } = harness({ signedIn: ALICE });
  assert.equal(await client.handoff(TICKET, confirm(true)), 'kept');
  assert.deepEqual(world.asked, []);
  assert.equal(stored().sessionId, 'ses_old');
  assert.deepEqual(logouts(world), ['Bearer new-access']);
  assert.equal(client.view().message, HANDOFF_SAME_ACCOUNT_MESSAGE);
  console.log('PASS same account → kept, no question');
}
{ // Two deliveries of the same link at once: one exchange.
  const { world, client, confirm } = harness();
  const [a, b] = await Promise.all([client.handoff(TICKET, confirm(true)), client.handoff(TICKET, confirm(true))]);
  assert.deepEqual([a, b], ['signedIn', 'signedIn']);
  assert.equal(world.calls.filter(c => c.path.endsWith('/auth/handoff/exchange')).length, 1, 'one exchange');
  console.log('PASS duplicate delivery → one exchange');
}

// ── Wiring: one URI handler, handoff after the account check, /account-return unchanged ──
{
  const src = readFileSync(`${root}src/extension.ts`, 'utf8');
  const start = src.indexOf('registerUriHandler(');
  const handler = src.slice(start, start + 1600);
  const iAccounts = handler.indexOf('if (!accounts) return;'), iHandoff = handler.indexOf('openAccountHandoff(accounts, uri)'), iReturn = handler.indexOf("uri.path !== '/account-return'");
  assert.ok(iAccounts > 0 && iHandoff > iAccounts && iReturn > iHandoff, 'handoff is handled with the account runtime, before /account-return');
  const fn = src.slice(src.indexOf('const openAccountHandoff'), start);
  assert.ok(fn.includes('accountHandoffTicket(uri, vscode.env.uriScheme)'), 'strict shape check on this build\'s scheme');
  assert.ok(fn.includes('계정으로 바꿀까요?') && fn.includes('modal: true'), 'a different account is confirmed in a modal');
  assert.ok(fn.includes("outcome === 'signedIn'") && fn.includes('startPage.accountHandedOff()'), 'signed in → start page continues');
  console.log('PASS wiring');
}
