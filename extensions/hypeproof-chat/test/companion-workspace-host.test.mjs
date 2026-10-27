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
  const activity = { id: 'synthetic-a', name: 'Synthetic owner scope', workspace: root, ref: 'synthetic-binding-a' };
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
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id),
    process, Buffer, console, fetch: () => { throw Error('Network forbidden in companion preparation'); },
  });
  const { registerCompanionWorkspace, COMPANION_WORKSPACE_COMMAND, readPreparedCompanionWorkspace } = module.exports;
  const readPrepared = () => readPreparedCompanionWorkspace(context, connections);
  const register = () => registerCompanionWorkspace(context, connections);
  const invoke = () => commands.get(COMPANION_WORKSPACE_COMMAND)();
  try { await run({ root, dialogs, saved, context, vscode, connections, register, invoke, readPrepared }); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}

test('production palette adapter selects existing folder, confirms local scope, and restores UNPAIRED', async () => fixture(async f => {
  const before = await readFile(join(f.root, 'index.html'));
  f.register(); assert.equal(f.dialogs.length, 0, 'registration performs no UI work');
  await f.invoke();
  assert.equal(f.dialogs[0].type, 'picker'); assert.equal(f.dialogs[0].options.canSelectFiles, false);
  assert.equal(f.dialogs[0].options.canSelectFolders, true); assert.equal(f.dialogs[0].options.canSelectMany, false);
  const confirm = f.dialogs[1]; assert.equal(confirm.options.modal, true); assert.equal(confirm.action, '준비 정보 저장');
  assert.match(confirm.options.detail, /Synthetic owner scope/); assert.ok(confirm.options.detail.includes(f.root));
  assert.match(f.dialogs.at(-1).message, /^UNPAIRED/); assert.equal(f.saved.size, 1);
  f.dialogs.length = 0; f.register(); await f.invoke();
  assert.equal(f.dialogs.length, 1); assert.match(f.dialogs[0].message, /^UNPAIRED/);
  const prepared = await f.readPrepared();
  assert.equal(prepared.status, 'UNPAIRED'); assert.equal(prepared.preparation.workspace, f.root);
  f.connections.forWorkspace = async () => undefined;
  assert.equal((await f.readPrepared()).status, 'BLOCKED');
  assert.deepEqual(await readFile(join(f.root, 'index.html')), before);
}));

test('host adapter rejects revoked owner binding and service changes without saving', async () => fixture(async f => {
  f.connections.forWorkspace = async () => undefined;
  f.register(); await f.invoke();
  assert.equal(f.saved.size, 0); assert.equal(f.dialogs.length, 1); assert.match(f.dialogs[0].message, /^BLOCKED/);
  f.dialogs.length = 0; f.connections.matchesService = false;
  await f.invoke(); assert.equal(f.saved.size, 0); assert.match(f.dialogs[0].message, /^UNSUPPORTED/);
}));

test('remote, multi-root and trust changes in native dialogs never produce preparation', async () => fixture(async f => {
  f.register();
  f.vscode.env.remoteName = 'ssh-remote'; await f.invoke(); assert.match(f.dialogs.at(-1).message, /^UNSUPPORTED/);
  f.vscode.env.remoteName = undefined;
  f.vscode.workspace.workspaceFolders.push({ uri: { scheme: 'file', fsPath: '/not-selected' } });
  await f.invoke(); assert.match(f.dialogs.at(-1).message, /^UNSUPPORTED/);
  f.vscode.workspace.workspaceFolders.pop();
  const show = f.vscode.window.showInformationMessage;
  f.vscode.window.showInformationMessage = async (...args) => { f.vscode.workspace.isTrusted = false; return show(...args); };
  await f.invoke(); assert.match(f.dialogs.at(-1).message, /^BLOCKED/); assert.equal(f.saved.size, 0);
}));
