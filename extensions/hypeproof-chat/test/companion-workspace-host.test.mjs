// Production native command adapter; only VS Code and the activity binding are fixtures.
// Native dialog rendering, keyboard/a11y, and installed-host restart remain separate acceptance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/companionWorkspaceHost.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });

async function fixture(run) {
  const temporary = await mkdtemp(join(tmpdir(), 'studio-companion-host-'));
  const root = await realpath(temporary), dialogs = [], commands = new Map(), saved = new Map();
  await writeFile(join(root, 'index.html'), 'synthetic native host fixture');
  const activity = { id: 'synthetic-a', name: 'Synthetic activity', workspace: root, ref: 'synthetic-binding-a' };
  const connections = { current: activity, matchesService: true, forWorkspace: async folder => folder === root ? activity : undefined };
  const vscode = {
    env: { machineId: 'synthetic-machine', remoteName: undefined },
    workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: root } }], isTrusted: true },
    commands: { registerCommand: (command, callback) => { commands.set(command, callback); return { dispose() {} }; } },
    window: {
      showOpenDialog: async options => { dialogs.push({ type: 'picker', options }); return [{ scheme: 'file', fsPath: root }]; },
      showInformationMessage: async (message, options, action) => { dialogs.push({ type: 'information', message, options, action }); return action; },
      showWarningMessage: async (message, options, action) => { dialogs.push({ type: 'warning', message, options, action }); return action; },
    },
  };
  const context = { subscriptions: [], globalState: { get: key => saved.get(key), update: async (key, value) => saved.set(key, value) } };
  const inspection = { afterAccess: undefined };
  const filesystem = require('node:fs/promises');
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: id => {
      if (id === 'vscode') return vscode;
      if (id === 'node:fs/promises') return { ...filesystem, access: async (...args) => {
        await filesystem.access(...args);
        await inspection.afterAccess?.();
      } };
      return require(id);
    },
    process, Buffer, console, fetch: () => { throw Error('Network forbidden in companion preparation'); },
  });
  const { registerCompanionWorkspace, COMPANION_WORKSPACE_COMMAND, readPreparedCompanionWorkspace } = module.exports;
  const readPrepared = () => readPreparedCompanionWorkspace(context, connections);
  const register = () => registerCompanionWorkspace(context, connections);
  const invoke = () => commands.get(COMPANION_WORKSPACE_COMMAND)();
  try { await run({ root, dialogs, saved, context, vscode, connections, inspection, register, invoke, readPrepared }); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}

test('production palette adapter selects existing folder, confirms local scope, and restores UNPAIRED', async () => fixture(async f => {
  const before = await readFile(join(f.root, 'index.html'));
  f.register(); assert.equal(f.dialogs.length, 0, 'registration performs no UI work');
  await f.invoke();
  assert.equal(f.dialogs[0].type, 'picker'); assert.equal(f.dialogs[0].options.canSelectFiles, false);
  assert.equal(f.dialogs[0].options.canSelectFolders, true); assert.equal(f.dialogs[0].options.canSelectMany, false);
  const confirm = f.dialogs[1]; assert.equal(confirm.options.modal, true); assert.equal(confirm.action, '준비 정보 저장');
  assert.match(confirm.options.detail, /Synthetic activity/); assert.ok(confirm.options.detail.includes(f.root));
  assert.equal(f.dialogs.at(-1).message, '이 컴퓨터에 준비 정보가 저장됐어요. 연결된 휴대폰은 없어요.'); assert.equal(f.saved.size, 1);
  assert.match(confirm.options.detail, /현재 활동: Synthetic activity/);
  const stored = f.saved.values().next().value;
  for (const value of [stored.activityId, stored.hostId, stored.hostId.slice(0, 12), stored.projectId])
    assert.ok(!confirm.options.detail.includes(value), 'internal scope IDs stay out of the confirmation');
  assert.doesNotMatch(confirm.options.detail, /소유/);
  f.dialogs.length = 0; f.register(); await f.invoke();
  assert.equal(f.dialogs.length, 1); assert.equal(f.dialogs[0].message, '이 컴퓨터에 준비 정보가 저장됐어요. 연결된 휴대폰은 없어요.');
  const prepared = await f.readPrepared();
  assert.equal(prepared.status, 'UNPAIRED'); assert.equal(prepared.preparation.workspace, f.root);
  f.connections.forWorkspace = async () => undefined;
  assert.equal((await f.readPrepared()).status, 'BLOCKED');
  assert.deepEqual(await readFile(join(f.root, 'index.html')), before);
}));

test('host adapter rejects revoked activity binding and service changes without saving', async () => fixture(async f => {
  f.connections.forWorkspace = async () => undefined;
  f.register(); await f.invoke();
  assert.equal(f.saved.size, 0); assert.equal(f.dialogs.length, 1); assert.equal(f.dialogs[0].message, '준비 정보를 저장하거나 확인하지 못했어요. 원본 파일과 기존 기록은 보존돼요.');
  f.dialogs.length = 0; f.connections.matchesService = false;
  await f.invoke(); assert.equal(f.saved.size, 0); assert.equal(f.dialogs[0].message, '로컬 컴퓨터에서 기존 활동과 작업 폴더를 먼저 열어 주세요.');
}));

test('remote, multi-root and trust changes in native dialogs never produce preparation', async () => fixture(async f => {
  f.register();
  f.vscode.env.remoteName = 'ssh-remote'; await f.invoke(); assert.equal(f.dialogs.at(-1).message, '로컬 컴퓨터에서 기존 활동과 작업 폴더를 먼저 열어 주세요.');
  f.vscode.env.remoteName = undefined;
  f.vscode.workspace.workspaceFolders.push({ uri: { scheme: 'file', fsPath: '/not-selected' } });
  await f.invoke(); assert.equal(f.dialogs.at(-1).message, '로컬 컴퓨터에서 기존 활동과 작업 폴더를 먼저 열어 주세요.');
  f.vscode.workspace.workspaceFolders.pop();
  const show = f.vscode.window.showInformationMessage;
  f.vscode.window.showInformationMessage = async (...args) => { f.vscode.workspace.isTrusted = false; return show(...args); };
  await f.invoke(); assert.equal(f.dialogs.at(-1).message, '준비 정보를 저장하거나 확인하지 못했어요. 원본 파일과 기존 기록은 보존돼요.'); assert.equal(f.saved.size, 0);
}));

test('scope changes during validation cannot show stale review or persist an approved old activity', async t => {
  for (const validation of ['binding', 'filesystem']) {
    for (const transition of ['before-review', 'before-save']) {
      await t.test(`${validation} ${transition}`, () => fixture(async f => {
        const before = await readFile(join(f.root, 'index.html'));
        let phase = 'initial', switched = false;
        const picker = f.vscode.window.showOpenDialog;
        f.vscode.window.showOpenDialog = async (...args) => {
          const selected = await picker(...args);
          phase = 'before-review';
          return selected;
        };
        const information = f.vscode.window.showInformationMessage;
        f.vscode.window.showInformationMessage = async (...args) => {
          const answer = await information(...args);
          if (args[2] === '준비 정보 저장') phase = 'before-save';
          return answer;
        };
        const switchActivity = async () => {
          if (phase !== transition || switched) return;
          switched = true;
          f.connections.current = { ...f.connections.current, id: 'synthetic-b', name: 'Other activity', ref: 'synthetic-binding-b' };
        };
        if (validation === 'binding') {
          const binding = f.connections.forWorkspace;
          f.connections.forWorkspace = async folder => {
            const result = await binding(folder);
            await switchActivity();
            return result;
          };
        } else f.inspection.afterAccess = switchActivity;
        f.register(); await f.invoke();
        const control = `${validation} ${transition}`;
        assert.ok(switched, `${control}: control reached its scope transition`);
        assert.equal(f.saved.size, 0, `${control}: no preparation may be written for the old activity`);
        assert.equal(f.dialogs.filter(dialog => dialog.action === '준비 정보 저장').length,
          transition === 'before-review' ? 0 : 1, `${control}: no review may open after the activity changes`);
        assert.equal(f.dialogs.at(-1).type, 'warning', `${control}: scope switch is blocked`);
        assert.equal(f.dialogs.at(-1).message, '준비 정보를 저장하거나 확인하지 못했어요. 원본 파일과 기존 기록은 보존돼요.');
        assert.ok(!f.dialogs.at(-1).options.detail.includes(f.root), `${control}: blocked detail does not expose the old folder`);
        assert.deepEqual(await readFile(join(f.root, 'index.html')), before);
      }));
    }
  }
});
