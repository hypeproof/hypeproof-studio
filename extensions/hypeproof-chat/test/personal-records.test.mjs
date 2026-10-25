import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundles = await mkdtemp(path.join(os.tmpdir(), 'hps-record-client-tests-'));
await build({ entryPoints: ['src/personalRecords.ts', 'src/personalRecordStore.ts', 'src/personalRecordFixture.ts'], outdir: bundles, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const { PersonalRecords } = await import(pathToFileURL(path.join(bundles, 'personalRecords.mjs')));
const { PersonalRecordStore } = await import(pathToFileURL(path.join(bundles, 'personalRecordStore.mjs')));
const { syntheticRecord, canonicalRecord, recordHash } = await import(pathToFileURL(path.join(bundles, 'personalRecordFixture.mjs')));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'cache-control': 'no-store' } });
const workspace = owner => ({ id: 'w1', kind: 'personal', name: '개인 공간', owner_account_id: owner, created_at: 1 });
const project = { id: 'p1', workspace_id: 'w1', title: '합성 목적지', revision: 1, created_at: 1, updated_at: 1 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(directory) {
  const state = { identity: 'alice', settings: { proxyUrl: 'http://localhost:8793/v1', siteBase: 'http://localhost:3193', preview: true }, calls: [], downloads: [], stages: [], puts: 0, completed: false, loseComplete: false, denied: false, corrupt: false, approved: true, tokenReads: 0, sequence: 0 };
  let body;
  const record = () => ({ id: 'rec_fixture', workspace_id: 'w1', project_id: 'p1', revision: 1, state: state.completed ? 'complete' : 'staging', manifest_sha256: body.manifest_sha256, created_at: 1, completed_at: state.completed ? 2 : null,
    ...(state.completed ? { manifest: body.manifest } : {}), artifacts: body.manifest.artifacts.map(f => ({ ...f, id: 'file_fixture' })) });
  const options = { directory, changed() {}, mutationId: () => 'stable-' + ++state.sequence,
    account: { view: () => state.identity ? { status: 'signedIn', account: { id: state.identity, email: state.identity + '@synthetic.invalid' } } : { status: 'signedOut' }, accessToken: async () => { state.tokenReads++; return 'host-only-synthetic-bearer'; }, matches: () => true },
    settings: () => state.settings, confirm: async preview => { state.confirmed = preview; return state.approved; }, download: async value => { assert.equal(value.current(), true); state.downloads.push(value); return true; },
    fetch: async (url, init) => {
      state.calls.push({ url, init });
      if (state.denied) return json({ error: 'session_revoked' }, 401);
      if (state.wait) await state.wait.promise;
      if (init.method === 'PUT') { state.puts++; return json({ stored: true, bytes: body.manifest.artifacts[0].bytes, sha256: body.manifest.artifacts[0].sha256 }); }
      if (init.method === 'POST' && url.endsWith('/complete')) { state.completed = true; if (state.loseComplete) { state.loseComplete = false; throw Error('lost completion reply after commit'); } return json({ record: record() }); }
      if (init.method === 'POST') { const next = JSON.parse(init.body); state.stages.push(next); if (body) assert.equal(canonicalRecord(next), canonicalRecord(body)); else body = next; return json({ record: record() }); }
      if (url.endsWith('/artifacts/file_fixture')) { const expected = syntheticRecord(true), bytes = Buffer.from(expected.files[0].base64, 'base64'); return new Response(state.corrupt ? Buffer.alloc(bytes.length) : bytes, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''synthetic-result.html", 'content-length': String(bytes.length), 'x-hps-content-sha256': expected.manifest.artifacts[0].sha256, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } }); }
      return url.endsWith('/rec_fixture') ? json({ record: record() }) : json({ records: body && state.completed ? [record()] : [] });
    } };
  return { state, options, client: () => new PersonalRecords(options), scope: () => ({ service: state.settings.proxyUrl, accountId: 'alice', workspaceId: 'w1', projectId: 'p1' }) };
}
async function temporary(work) { const directory = await mkdtemp(path.join(os.tmpdir(), 'hps-records-')); try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); } }

test('local opt-in, exact preview and host-dialog fixture refusal never send or import content', async () => temporary(async directory => {
  const f = fixture(directory);
  for (const settings of [{ ...f.state.settings, preview: false }, { ...f.state.settings, proxyUrl: 'https://api.hypeproof-ai.xyz/v1' }, { ...f.state.settings, siteBase: 'https://hypeproof-ai.xyz' }, { ...f.state.settings, proxyUrl: 'http://user:password@localhost/v1' }]) {
    f.state.settings = settings; const client = f.client(); await client.select(workspace('alice'), project); client.prepare(true); await client.open(); await client.retry(); assert.equal(client.view(), undefined);
  }
  assert.equal(f.state.calls.length, 0); assert.equal(f.state.tokenReads, 0);
  f.state.settings = { proxyUrl: 'http://localhost:8793/v1', siteBase: 'http://localhost:3193', preview: true };
  const client = f.client(); await client.select(workspace('alice'), project);
  client.prepare({ taskId: 'customer-task', path: '/private/customer.html' }); assert.equal(client.view().preview, undefined);
  client.prepare(true); const first = client.view().preview; assert.equal(first.service, f.scope().service); assert.deepEqual(first.manifest, syntheticRecord(true).manifest); assert.equal(f.state.calls.length, 0);
  client.cancel(first.nonce); client.prepare(false); const second = client.view().preview; assert.notEqual(first.digest, second.digest);
  await client.save(first.nonce, first.digest); assert.equal(f.state.calls.length, 0, 'cancelled/changed selection cannot reuse consent');
  f.state.approved = false; await client.save(second.nonce, second.digest); assert.equal(f.state.calls.length, 0); assert.equal(await new PersonalRecordStore(directory).load(f.scope()), undefined);
}));

test('lost completion reply survives host restart with the exact frozen mutation; complete replay skips upload', async () => temporary(async directory => {
  const f = fixture(directory), client = f.client(); await client.select(workspace('alice'), project); client.prepare(true); const preview = client.view().preview;
  f.state.loseComplete = true; await client.save(preview.nonce, preview.digest);
  assert.equal(client.view().failed, true); assert.equal(f.state.puts, 1); assert.equal(f.state.completed, true);
  const pending = await new PersonalRecordStore(directory).load(f.scope()); assert.equal(pending.mutation_id, 'stable-1'); assert.equal(pending.manifest_sha256, preview.digest);
  const directories = await readdir(directory), pendingFile = path.join(directory, directories[0], 'pending.json');
  assert.equal((await stat(pendingFile)).mode & 0o777, 0o600); assert.doesNotMatch(await readFile(pendingFile, 'utf8'), /host-only-synthetic-bearer/);
  const restarted = f.client(); await restarted.select(workspace('alice'), project); assert.equal(restarted.view().pending.mutation_id, pending.mutation_id);
  assert.equal(f.state.calls.length, 3, 'restart only loads local state; no background upload');
  await restarted.retry(); assert.equal(f.state.stages.length, 2); assert.deepEqual(f.state.stages[0], f.state.stages[1]); assert.equal(f.state.puts, 1);
  assert.equal(restarted.view().selected.state, 'complete'); assert.equal(restarted.view().pending, undefined); assert.equal(await new PersonalRecordStore(directory).load(f.scope()), undefined);
  await restarted.open(); await restarted.open('rec_fixture'); await restarted.download('file_fixture');
  assert.deepEqual(restarted.view().selected.manifest.messages, syntheticRecord(true).manifest.messages);
  assert.equal(recordHash(f.state.downloads[0].bytes), syntheticRecord(true).manifest.artifacts[0].sha256);
  f.options.download = async () => { throw Object.assign(Error('destination exists'), { code: 'EEXIST' }); };
  await restarted.download('file_fixture');
  assert.match(restarted.view().message, /같은 이름의 파일이 이미 있어요.*원본은 그대로.*다른 이름이나 위치/);
  assert.equal(restarted.view().selected.id, 'rec_fixture', 'destination refusal keeps the verified record available');
}));

test('account, destination and response fences clear private views; revoked download never reaches the picker', async () => temporary(async directory => {
  const f = fixture(directory), client = f.client(); await client.select(workspace('alice'), project); client.prepare(true);
  const confirmation = deferred(); f.options.confirm = () => confirmation.promise;
  const p = client.view().preview, saving = client.save(p.nonce, p.digest); await client.select(workspace('alice'), { ...project, id: 'p2' }); confirmation.resolve(true); await saving;
  assert.equal(f.state.calls.length, 0); assert.equal(await new PersonalRecordStore(directory).load(f.scope()), undefined);
  await client.select(workspace('alice'), project); f.options.confirm = async () => true; client.prepare(true); const next = client.view().preview; await client.save(next.nonce, next.digest);
  f.state.denied = true; await client.download('file_fixture'); assert.equal(f.state.downloads.length, 0); assert.equal(client.view().authenticationRequired, true); assert.deepEqual(client.view().records, []); assert.equal(client.view().selected, undefined);
  f.state.denied = false; await client.open('rec_fixture'); f.state.wait = deferred(); const opening = client.open(); await new Promise(r => setImmediate(r));
  f.state.identity = 'bob'; client.sync(); f.state.wait.resolve(); await opening;
  assert.deepEqual(client.view().records, []); assert.equal(client.view().selected, undefined); assert.equal(client.view().preview, undefined);
  client.signOut(); assert.equal(client.view(), undefined, 'logout fence applies before remote revocation');
}));

test('corrupt downloads and corrupted local outbox fail closed without replacing originals', async () => temporary(async directory => {
  const f = fixture(directory), client = f.client(); await client.select(workspace('alice'), project); await client.open(); assert.equal(client.view().loaded, true); assert.match(client.view().message, /없어요/);
  client.prepare(true); f.state.loseComplete = true; const p = client.view().preview; await client.save(p.nonce, p.digest);
  const dirs = await readdir(directory), file = path.join(directory, dirs[0], 'pending.json'); const original = await readFile(file, 'utf8');
  await writeFile(file, '{broken'); const failed = f.client(); await failed.select(workspace('alice'), project); const count = f.state.calls.length; await failed.retry(); assert.equal(f.state.calls.length, count); assert.equal(await readFile(file, 'utf8'), '{broken');
  assert.match(failed.view().message, /저장 대기 사본을 확인할 수 없어요/);
  await writeFile(file, original); await failed.retry(); f.state.corrupt = true; await failed.download('file_fixture'); assert.equal(f.state.downloads.length, 0); assert.match(failed.view().message, /내용/);
  const altered = JSON.parse(original); altered.manifest.messages[0].content = 'imported private content'; altered.manifest_sha256 = recordHash(canonicalRecord(altered.manifest)); altered.consent.manifest_sha256 = altered.manifest_sha256;
  await assert.rejects(new PersonalRecordStore(directory).create(altered), /outbox_corrupt/);
}));

test('a mismatched stage receipt cannot upload or acknowledge the frozen intent', async () => temporary(async directory => {
  const f = fixture(directory), original = f.options.fetch;
  f.options.fetch = async (url, init) => { const response = await original(url, init); if (init.method === 'POST' && !url.endsWith('/complete')) { const value = await response.json(); value.record.project_id = 'foreign'; return json(value); } return response; };
  const client = f.client(); await client.select(workspace('alice'), project); client.prepare(true); const p = client.view().preview; await client.save(p.nonce, p.digest);
  assert.equal(f.state.puts, 0); assert.equal(f.state.completed, false); assert.equal(client.view().selected, undefined); assert.equal(client.view().failed, true); assert.ok(await new PersonalRecordStore(directory).load(f.scope()));
}));

process.once('beforeExit', () => { void rm(bundles, { recursive: true, force: true }); });
