// Guards that the activity-trash behaviour tests did not pin down: GCM nonce freshness, the folder-identity
// check on a stale handle, no data loss on an in-place edit during verification, the in-process queue,
// cancellation inside a native batch, and the outside-the-activity-folder guard of the native delete hook.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ActivityTrash } from '../src/activityTrash.ts';
const require = createRequire(import.meta.url);
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'activity-trash-guards-')));
const keyring = () => { const map = new Map(); return { map, get: async k => map.get(k), store: async (k, v) => { map.set(k, v); }, delete: async k => { map.delete(k); } }; };
let n = 0;
const env = () => { const root = path.join(top, `r${++n}`), base = path.join(top, `b${n}`); fs.mkdirSync(root); fs.mkdirSync(base); return { root, base, keys: keyring() }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iv = file => fs.readFileSync(file).subarray(4, 16).toString('hex');
try {
  // N1 / N2: every sealed file (blob copy and metadata) carries its own nonce, also after a metadata rewrite.
  {
    const { root, base, keys } = env();
    const trash = new ActivityTrash(root, base, keys);
    const items = path.join(trash.store, 'items');
    for (const i of [0, 1, 2]) { fs.writeFileSync(path.join(root, `same${i}.txt`), 'same plaintext'); await trash.delete(`same${i}.txt`); }
    const sealed = () => fs.readdirSync(items).map(f => path.join(items, f));
    assert.equal(sealed().length, 6);
    assert.equal(new Set(sealed().map(iv)).size, 6, 'six sealed files, six distinct nonces');
    const blobs = fs.readdirSync(items).filter(f => f.endsWith('.blob')).map(f => fs.readFileSync(path.join(items, f)).subarray(16));
    assert.equal(new Set(blobs.map(b => b.toString('hex'))).size, 3, 'the same plaintext seals to different ciphertext');
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, `p${i}.txt`), 'x');
    const pending = (await trash.prepareNativeDelete(Array.from({ length: 5 }, (_, i) => `p${i}.txt`))).ids;
    assert.equal(pending.length, 5);
    const metaBefore = new Map(pending.map(id => [id, iv(path.join(items, `${id}.meta`))]));
    for (let i = 0; i < 5; i++) fs.unlinkSync(path.join(root, `p${i}.txt`));
    await trash.list(); // confirms the pending entries and rewrites their metadata
    for (const [id, before] of metaBefore) assert.notEqual(iv(path.join(items, `${id}.meta`)), before, 'a rewritten metadata file gets a fresh nonce');
    assert.equal(new Set(sealed().map(iv)).size, sealed().length, 'all nonces stay distinct after the rewrite');
  }

  // N5: a handle taken before the folder was deleted and recreated must not trash into the old store.
  {
    const { root, base, keys } = env();
    const stale = new ActivityTrash(root, base, keys);
    fs.rmSync(root, { recursive: true }); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'new-owner.txt'), 'B');
    await assert.rejects(stale.delete('new-owner.txt'), /activity_changed/);
    assert.equal(fs.readFileSync(path.join(root, 'new-owner.txt'), 'utf8'), 'B', 'the new folder keeps its file');
    assert.equal((await new ActivityTrash(root, base, keys).list()).entries.length, 0);
  }

  // V15: an edit in place while the sealed copy is verified keeps the source and creates no entry.
  {
    const { root, base, keys } = env();
    const file = path.join(root, 'doc.txt');
    fs.writeFileSync(file, 'v1');
    const trash = new ActivityTrash(root, base, keys, { blobWritten: () => fs.appendFileSync(file, ' + newer edit') });
    await assert.rejects(trash.delete('doc.txt'), /file_changed/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'v1 + newer edit', 'the newer edit is not unlinked');
    assert.equal((await new ActivityTrash(root, base, keys).list()).entries.length, 0);
  }

  // V12: a list() in the same process waits behind a copy that outlasts the 3 s lock wait instead of failing.
  {
    const { root, base, keys } = env();
    fs.writeFileSync(path.join(root, 'slow.bin'), Buffer.alloc(300 * 1024));
    const slow = new ActivityTrash(root, base, keys, { sourceRead: () => sleep(4000) });
    const copying = slow.prepareNativeDelete(['slow.bin']);
    await sleep(100);
    const listing = await new ActivityTrash(root, base, keys).list();
    assert.equal(listing.damaged, 0);
    await copying;
  }

  // V19: cancellation inside a native batch stops the copies that have not started.
  {
    const { root, base, keys } = env();
    for (const f of ['a', 'b', 'c']) fs.writeFileSync(path.join(root, f), f);
    let reads = 0;
    const token = { get isCancellationRequested() { return ++reads > 1; } };
    const result = await new ActivityTrash(root, base, keys).prepareNativeDelete(['a', 'b', 'c'], token);
    assert.deepEqual({ ids: result.ids.length, failed: result.failed }, { ids: 1, failed: 2 });
  }

  // V20: an Explorer delete of a workspace file outside the activity folder is silent.
  {
    const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/activityTrashCommands.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
    const ws = path.join(top, 'ws'), root = path.join(ws, 'task'), base = path.join(top, 'gs20');
    fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(base);
    let willDelete; const warnings = [];
    const vscode = { commands: { registerCommand: () => ({}) }, workspace: { onWillDeleteFiles: fn => { willDelete = fn; return {}; }, onDidDeleteFiles: () => ({}), workspaceFolders: [{ uri: { scheme: 'file', fsPath: ws } }], textDocuments: [], getConfiguration: () => ({ get: () => true }) }, window: { showWarningMessage: async t => { warnings.push(t); }, showInformationMessage: async () => {}, showQuickPick: async () => undefined } };
    const module = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console: { ...console, warn() {} }, Buffer, setTimeout, process });
    const secrets = keyring();
    module.exports.registerActivityTrash({ subscriptions: [], globalStorageUri: { fsPath: base }, secrets }, { active: () => true, refusal: () => null, binding: () => ({ root, scope: 's' }) });
    fs.writeFileSync(path.join(ws, 'outside.txt'), 'o');
    const waits = [];
    willDelete({ files: [{ scheme: 'file', fsPath: path.join(ws, 'outside.txt') }], token: { isCancellationRequested: false }, waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    assert.deepEqual(warnings, [], 'no warning for a file the trash never owned');
  }
  console.log('activity trash guards: nonce freshness, stale folder handle, edit during verification, in-process queue, cancellation in a batch and outside-folder delete PASS');
} finally { fs.rmSync(top, { recursive: true, force: true }); }
