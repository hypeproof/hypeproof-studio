import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companionState, companionKey, inspectCompanionWorkspace } from '../src/companionWorkspace.ts';
import { CompanionWorkspaceController } from '../src/companionWorkspaceController.ts';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'studio-companion-'));
  const folder = join(root, 'existing');
  await mkdir(folder);
  await writeFile(join(folder, 'index.html'), '<h1>existing synthetic work</h1>');
  const scope = { activityId: 'activity-a', workspace: await realpath(folder), activityLabel: 'Synthetic activity', hostId: 'host-a', hostLabel: 'Synthetic host', trusted: true, local: true };
  const saved = new Map(), shown = [], confirmations = [];
  let selected = folder, current = scope, permitted = true, writes = 0;
  const host = {
    scope: () => current, verify: async () => permitted,
    get: key => saved.get(key), update: async (key, value) => { writes++; saved.set(key, value); },
    selectFolder: async () => selected, confirm: async detail => { confirmations.push(detail); return true; },
    show: async (state, detail) => shown.push({ state, detail }), now: () => 123,
  };
  try { await run({ root, folder, scope, host, saved, shown, confirmations, select: value => { selected = value; }, scopeAs: value => { current = value; }, permit: value => { permitted = value; }, writes: () => writes }); }
  finally { await chmod(folder, 0o700); await rm(root, { recursive: true, force: true }); }
}

test('selected existing workspace survives a fresh controller without changing files or pairing', async () => fixture(async f => {
  const before = await readFile(join(f.folder, 'index.html'));
  await new CompanionWorkspaceController(f.host).run();
  assert.equal(f.writes(), 1);
  assert.equal(f.shown.at(-1).state.status, 'UNPAIRED');
  assert.equal(f.shown.at(-1).state.preparation.workspace, f.scope.workspace);
  assert.match(f.confirmations[0], /로컬 저장/);
  assert.match(f.confirmations[0], /현재 활동: Synthetic activity/);
  assert.ok(!f.confirmations[0].includes(f.scope.activityId), 'activity ID is not customer-facing');
  assert.ok(!f.confirmations[0].includes(f.scope.hostId), 'host digest is not customer-facing');
  assert.ok(!f.confirmations[0].includes(f.shown.at(-1).state.preparation.projectId), 'project hash stays internal');
  assert.doesNotMatch(f.confirmations[0], /소유/);
  assert.match(f.confirmations[0], /Synthetic host/);
  const persisted = JSON.parse(JSON.stringify([...f.saved]));
  f.saved.clear(); persisted.forEach(([key, value]) => f.saved.set(key, value));
  f.host.selectFolder = async () => { throw Error('restored metadata must not reselect'); };
  await new CompanionWorkspaceController(f.host).run();
  assert.equal(f.writes(), 1);
  assert.equal(f.shown.at(-1).state.status, 'UNPAIRED');
  assert.deepEqual(await readdir(f.folder), ['index.html']);
  assert.deepEqual(await readFile(join(f.folder, 'index.html')), before);
  assert.deepEqual(Object.keys(f.saved.values().next().value).sort(), ['version', 'scope', 'workspace', 'projectId', 'activityId', 'hostId', 'preparedAt'].sort());
}));

test('wrong folder, read-only, unsupported remote and untrusted contexts fail closed', async () => fixture(async f => {
  const other = join(f.root, 'foreign'); await mkdir(other);
  f.select(other); await new CompanionWorkspaceController(f.host).run();
  assert.equal(f.shown.at(-1).state.status, 'BLOCKED'); assert.equal(f.writes(), 0);
  await chmod(f.folder, 0o500);
  assert.equal((await companionState(f.scope, undefined)).status, 'BLOCKED');
  await chmod(f.folder, 0o700);
  assert.equal((await companionState({ ...f.scope, trusted: false }, undefined)).status, 'BLOCKED');
  assert.equal((await companionState({ ...f.scope, local: false }, undefined)).status, 'UNSUPPORTED');
  assert.equal((await companionState(undefined, undefined)).status, 'UNSUPPORTED');
  const link = join(f.root, 'link'); await symlink(f.folder, link);
  assert.equal(await inspectCompanionWorkspace(link, f.scope), f.scope.workspace, 'canonical alias stays in same scope');
  await assert.rejects(inspectCompanionWorkspace(join(f.folder, 'index.html'), f.scope));
}));

test('corrupt/cross-host metadata is preserved and never reported prepared', async () => fixture(async f => {
  await new CompanionWorkspaceController(f.host).run();
  const key = companionKey(f.scope), valid = f.saved.get(key);
  for (const bad of [null, 'broken', { ...valid, hostId: 'other-host' }, { ...valid, activityId: 'other-activity' }, { ...valid, deviceGrant: true }]) {
    f.saved.set(key, bad); await new CompanionWorkspaceController(f.host).run();
    assert.equal(f.shown.at(-1).state.status, 'BLOCKED');
    assert.equal(f.shown.at(-1).state.preparation, undefined); assert.equal(f.saved.get(key), bad);
  }
  assert.equal(f.writes(), 1);
}));

test('scope or owner changes during approval and failed persistence cannot claim preparation', async () => fixture(async f => {
  f.host.confirm = async () => { f.scopeAs({ ...f.scope, activityId: 'b' }); return true; };
  await new CompanionWorkspaceController(f.host).run();
  assert.equal(f.writes(), 0); assert.equal(f.shown.at(-1).state.status, 'BLOCKED');
  f.scopeAs(f.scope); f.host.confirm = async () => { f.permit(false); return true; };
  await new CompanionWorkspaceController(f.host).run(); assert.equal(f.writes(), 0);
  f.permit(true); f.host.confirm = async () => true;
  f.host.update = async () => { throw Error('disk full'); };
  await new CompanionWorkspaceController(f.host).run();
  assert.equal(f.shown.at(-1).state.status, 'BLOCKED'); assert.equal(f.saved.size, 0);
}));

test('cancel, duplicate click and metadata changed under modal preserve prior state', async () => fixture(async f => {
  f.select(undefined); await new CompanionWorkspaceController(f.host).run(); assert.equal(f.writes(), 0);
  f.select(f.folder); f.host.confirm = async () => false;
  await new CompanionWorkspaceController(f.host).run(); assert.equal(f.writes(), 0);
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  f.host.confirm = async () => { await pending; return true; };
  const controller = new CompanionWorkspaceController(f.host), first = controller.run();
  await controller.run();
  f.saved.set(companionKey(f.scope), 'concurrent corrupt metadata'); finish(); await first;
  assert.equal(f.writes(), 0); assert.equal(f.shown.at(-1).state.status, 'BLOCKED');
  assert.equal(f.saved.get(companionKey(f.scope)), 'concurrent corrupt metadata');
}));
