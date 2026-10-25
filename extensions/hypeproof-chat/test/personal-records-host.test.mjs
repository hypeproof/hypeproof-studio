import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const [pageBundle, hostBundle] = await Promise.all(['src/startPage.ts', 'src/personalRecordHost.ts'].map(entry => build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' })));
const root = await mkdtemp(path.join(os.tmpdir(), 'hps-record-host-'));
const json = value => new Response(JSON.stringify(value));
try {
  for (const scenario of [{ mode: 1, flag: true, local: true }, { mode: 2, flag: false, local: true }, { mode: 3, flag: true, local: false }, { mode: 2, flag: true, local: true }]) {
    const directory = path.join(root, String(scenario.mode) + String(scenario.flag) + String(scenario.local));
    const calls = [], states = [], confirmations = [], commands = [];
    let account = 'alice', approved = false, saved, complete = false, revoke;
    const workspace = { id: 'w1', owner_account_id: 'alice', kind: 'personal', name: '개인 공간', created_at: 1 }, project = { id: 'p1', workspace_id: 'w1', title: '호스트 테스트', revision: 1, created_at: 1, updated_at: 1 };
    const receipt = () => ({ id: 'rec1', workspace_id: 'w1', project_id: 'p1', revision: 1, state: complete ? 'complete' : 'staging', manifest_sha256: saved.manifest_sha256, created_at: 1, completed_at: complete ? 2 : null,
      ...(complete ? { manifest: saved.manifest } : {}), artifacts: saved.manifest.artifacts.map(f => ({ ...f, id: 'file1' })) });
    const accounts = { view: () => account ? { status: 'signedIn', account: { id: account, email: 'alice@synthetic.invalid' } } : { status: 'signedOut' }, accessToken: async () => 'host-only-record-token', matches: () => true,
      signOut: async () => { await new Promise(resolve => { revoke = resolve; }); account = undefined; page.accountChanged(); } };
    const vscode = { ExtensionMode: { Production: 1, Development: 2, Test: 3 }, workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'personalRecordsPreview' ? scenario.flag : key === 'proxyUrl' ? (scenario.local ? 'http://localhost:8793/v1' : 'https://api.hypeproof-ai.xyz/v1') : key === 'siteBase' ? 'http://localhost:3193' : fallback }) },
      commands: { executeCommand: async value => commands.push(value) }, window: { showWarningMessage: async (...args) => { confirmations.push(args); return approved ? '확인하고 저장' : undefined; } } };
    const fetch = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/me/workspaces')) return json({ workspaces: [workspace] });
      if (url.endsWith('/projects')) return json({ projects: [project] });
      if (url.endsWith('/complete')) { complete = true; return json({ record: receipt() }); }
      if (init.method === 'PUT') return json({ stored: true, bytes: saved.manifest.artifacts[0].bytes, sha256: saved.manifest.artifacts[0].sha256 });
      if (init.method === 'POST') { saved = JSON.parse(init.body); return json({ record: receipt() }); }
      return json({ records: complete ? [receipt()] : [] });
    };
    const module = { exports: {} };
    vm.runInNewContext(pageBundle.outputFiles[0].text, { module, exports: module.exports, require: name => name === 'vscode' ? vscode : require(name), console, Buffer, AbortSignal, URL, process, TextEncoder, fetch, structuredClone, setTimeout, clearTimeout });
    const page = new module.exports.StartPage({ globalStorageUri: { fsPath: directory }, extensionMode: scenario.mode, workspaceState: { keys: () => [] }, extension: { packageJSON: { version: 'synthetic' } } }, { ensureProfile: async () => null, profileFailure: () => null }, async () => { throw Error('must never start an activity'); }, undefined, accounts);
    page.panel = { webview: { postMessage: async message => states.push(message) } };
    await page.handle({ type: 'personalProjectOpen', accountId: 'alice', projectId: 'p1' });
    const before = calls.length;
    await page.handle({ type: 'personalRecordPrepare', accountId: 'wrong-account', projectId: 'p1', includeFile: true });
    await page.handle({ type: 'personalRecordPrepare', accountId: 'alice', projectId: 'wrong-project', includeFile: true });
    await page.handle({ type: 'personalRecordPrepare', accountId: 'alice', projectId: 'p1', includeFile: true });
    assert.equal(calls.length, before, 'preview cannot issue a record request');
    const enabled = scenario.mode === 2 && scenario.flag && scenario.local;
    const view = states.at(-1).state.personalRecords;
    if (!enabled) { assert.equal(view, undefined); await page.handle({ type: 'personalRecordRetry', accountId: 'alice', projectId: 'p1' }); assert.equal(calls.length, before); continue; }
    assert.equal(view.preview.service, 'http://localhost:8793/v1');
    await page.handle({ type: 'personalRecordSave', accountId: 'alice', projectId: 'p1', nonce: view.preview.nonce, digest: view.preview.digest });
    assert.equal(calls.length, before, 'VS Code dialog fixture cancellation sends nothing');
    assert.match(confirmations[0][1].detail, /http:\/\/localhost:8793\/v1/); assert.match(confirmations[0][1].detail, /alice@synthetic.invalid/); assert.match(confirmations[0][1].detail, /호스트 테스트/);
    approved = true; await page.handle({ type: 'personalRecordPrepare', accountId: 'alice', projectId: 'p1', includeFile: true });
    const preview = states.at(-1).state.personalRecords.preview;
    await page.handle({ type: 'personalRecordSave', accountId: 'alice', projectId: 'p1', nonce: preview.nonce, digest: preview.digest });
    assert.equal(states.at(-1).state.personalRecords.selected.state, 'complete'); assert.equal(calls.filter(c => c.init.method === 'PUT').length, 1);
    assert.ok(!JSON.stringify(states).includes('host-only-record-token')); assert.deepEqual(commands, []);
    const leaving = page.handle({ type: 'accountSignOut' }); await new Promise(r => setImmediate(r));
    assert.equal(states.at(-1).state.personalRecords, undefined, 'private records clear before remote logout resolves');
    revoke(); await leaving;
  }
  // Actual picker/write adapter: never replace an existing file; never write after the picker changes identity.
  let target = path.join(root, 'download.html'), current = true;
  const vscode = { Uri: { file: fsPath => ({ scheme: 'file', fsPath }) }, window: { showSaveDialog: async () => ({ scheme: 'file', fsPath: target }) } };
  const module = { exports: {} };
  vm.runInNewContext(hostBundle.outputFiles[0].text, { module, exports: module.exports, require: name => name === 'vscode' ? vscode : require(name), console, Buffer, process });
  await writeFile(target, 'existing original');
  await assert.rejects(module.exports.downloadPersonalRecord({ name: 'fixture.html', bytes: Buffer.from('synthetic copy'), current: () => current }), { code: 'EEXIST' });
  assert.equal(await readFile(target, 'utf8'), 'existing original');
  target = path.join(root, 'new-copy.html'); await module.exports.downloadPersonalRecord({ name: 'fixture.html', bytes: Buffer.from('synthetic copy'), current: () => current }); assert.equal(await readFile(target, 'utf8'), 'synthetic copy');
  target = path.join(root, 'cancelled.html'); vscode.window.showSaveDialog = async () => { current = false; return { scheme: 'file', fsPath: target }; };
  assert.equal(await module.exports.downloadPersonalRecord({ name: 'fixture.html', bytes: Buffer.from('synthetic copy'), current: () => current }), false);
  await assert.rejects(readFile(target), { code: 'ENOENT' });
  console.log('PASS actual StartPage logic with VS Code dialog fixture: mode/opt-in/localhost/account/project gates, storage confirmation, save, token privacy, logout; download picker fixture cancellation and filesystem no-overwrite writes. Native/installed App NOT RUN.');
} finally { await rm(root, { recursive: true, force: true }); }
