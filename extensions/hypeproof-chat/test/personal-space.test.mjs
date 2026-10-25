import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PersonalSpace } from '../src/personalSpace.ts';

const workspace = account => ({ id: `w-${account}`, kind: 'personal', name: '개인 공간', owner_account_id: account, created_at: 10 });
const project = (w, title = '첫 프로젝트') => ({ id: `p-${w}`, workspace_id: w, title, revision: 1, created_at: 20, updated_at: 20 });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
function fixture() {
  let account = 'alice', stored, loseReply = false, forbidden = false, calls = [], mutations = new Map(), mutationSequence = 0;
  const options = {
    account: { view: () => account ? { status: 'signedIn', account: { id: account } } : { status: 'signedOut' }, accessToken: async () => `token-${account}`, matches: () => true },
    settings: () => ({ proxyUrl: 'http://localhost/v1', siteBase: 'http://localhost' }), changed() {}, mutationId: () => 'stable-mutation-' + ++mutationSequence,
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      if (forbidden) return response({ error: 'invalid_token' }, 401);
      if (url.endsWith('/me/workspaces')) {
        if (init.method === 'POST') stored ??= workspace(account);
        return response(init.method === 'POST' ? { workspace: stored } : { workspaces: stored ? [stored] : [] });
      }
      if (init.method === 'POST') {
        const body = JSON.parse(init.body);
        if (!mutations.has(body.mutation_id)) mutations.set(body.mutation_id, project(stored.id, body.title));
        if (loseReply) { loseReply = false; throw Error('reply lost after commit'); }
        return response({ project: mutations.get(body.mutation_id) });
      }
      return response({ projects: [...mutations.values()] });
    },
  };
  return { options, calls, mutations, change: value => { account = value; }, lose: () => { loseReply = true; }, deny: () => { forbidden = true; }, allow: () => { forbidden = false; } };
}

test('explicit creation, naming and a new client reopen persistent metadata only', async () => {
  const f = fixture(), client = new PersonalSpace(f.options);
  await client.open(); assert.equal(client.view().workspace, undefined); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
  await client.ensure(); await client.create('  첫 프로젝트  ');
  assert.equal(client.view().selected.title, '첫 프로젝트');
  const reopened = new PersonalSpace(f.options); await reopened.open(client.view().selected.id);
  assert.equal(reopened.view().selected.title, '첫 프로젝트');
  assert.deepEqual([...f.mutations.keys()], ['stable-mutation-1']);
  for (const call of f.calls) { assert.match(call.url, /\/v1\/me\/workspaces/); assert.equal(call.headers.authorization, 'Bearer token-alice'); assert.equal(call.redirect, 'error'); }
  assert.doesNotMatch(JSON.stringify(reopened.view()), /token-|mutation_id/);
});

test('a lost create reply retries the exact mutation and cannot rename that request', async () => {
  const f = fixture(), client = new PersonalSpace(f.options); await client.ensure();
  f.lose(); await client.create('원래 이름'); assert.equal(client.view().pendingTitle, '원래 이름'); assert.equal(client.view().failed, true);
  const requests = f.calls.length; await client.create('바뀐 이름'); assert.equal(f.calls.length, requests);
  await client.create('원래 이름'); assert.equal(client.view().pendingTitle, undefined); assert.equal(f.mutations.size, 1);
  const writes = f.calls.filter(c => c.body && JSON.parse(c.body).mutation_id);
  assert.equal(writes.length, 2); assert.equal(writes[0].body, writes[1].body);
});

test('logout/account change clears records and fences a late response and pending token', async () => {
  const f = fixture(), client = new PersonalSpace(f.options); await client.ensure(); await client.create('개인 기록');
  let release; const late = new Promise(resolve => { release = resolve; });
  f.options.fetch = async () => late;
  const request = client.open(); await new Promise(resolve => setImmediate(resolve));
  f.change('bob'); client.sync(); assert.deepEqual(client.view(), { opened: false, projects: [] });
  release(response({ workspaces: [workspace('alice')] })); await request; assert.deepEqual(client.view(), { opened: false, projects: [] });
  let token; f.options.account.accessToken = () => new Promise(resolve => { token = resolve; });
  let fetched = false; f.options.fetch = async () => { fetched = true; return response({}); };
  const beforeToken = client.open(); client.signOut(); token('secret'); await beforeToken;
  assert.equal(fetched, false); assert.deepEqual(client.view(), { opened: false, projects: [] });
  f.change(undefined); client.sync(); f.change('alice'); client.sync(); assert.equal(client.view().opened, false);
});

test('auth refusal, invalid metadata and inaccessible project remain recoverable without AI or payment', async () => {
  const f = fixture(), client = new PersonalSpace(f.options); f.deny(); await client.open();
  assert.equal(client.view().failed, true); assert.match(client.view().message, /로그인/); assert.equal(client.view().authenticationRequired, true); assert.equal(client.view().busy, false);
  const next = fixture(), other = new PersonalSpace(next.options); await other.ensure(); await other.open('foreign-project');
  assert.equal(other.view().selected, undefined); assert.match(other.view().message, /찾지 못/);
  next.options.fetch = async () => response({ workspaces: [{ ...workspace('alice'), owner_account_id: 'bob', access_token: 'never-display' }] });
  await other.open(); assert.equal(other.view().failed, true); assert.doesNotMatch(JSON.stringify(other.view()), /never-display|bob/);
});

test('invalid titles and concurrent clicks cannot create extra mutations', async () => {
  const f = fixture(), client = new PersonalSpace(f.options); await client.ensure();
  const count = f.calls.length; await client.create('  '); await client.create('a'.repeat(161)); await client.create('\0'); await client.create('x\0'); assert.equal(f.calls.length, count);
  await Promise.all([client.create('선택한 이름'), client.create('다른 이름')]); assert.equal(f.mutations.size, 1); assert.equal(client.view().selected.title, '선택한 이름');
});


test('revoked session clears previously displayed records and keeps uncertain retry private until recovery', async () => {
  const f = fixture(), client = new PersonalSpace(f.options); await client.ensure(); await client.create('개인 이름');
  assert.equal(client.view().projects.length, 1); assert.ok(client.view().selected);
  f.deny(); await client.open();
  assert.deepEqual(client.view().projects, []); assert.equal(client.view().workspace, undefined); assert.equal(client.view().selected, undefined);
  assert.equal(client.view().authenticationRequired, true); assert.doesNotMatch(JSON.stringify(client.view()), /개인 이름|w-alice|p-w-alice/);
  f.allow(); await client.open(); assert.equal(client.view().projects.length, 1);
  f.lose(); await client.create('개인 이름'); assert.equal(client.view().pendingTitle, '개인 이름');
  f.deny(); await client.create('개인 이름'); assert.equal(client.view().pendingTitle, undefined);
  assert.doesNotMatch(JSON.stringify(client.view()), /개인 이름/);
  f.allow(); await client.open(); assert.equal(client.view().pendingTitle, '개인 이름');
  await client.create('개인 이름'); assert.equal(client.view().pendingTitle, undefined); assert.equal(f.mutations.size, 2);
});
