// REQ-STUDIO-ACTIVITY-TRASH: a trashed file is out of reach of every coach file tool.
// The bytes live in the extension storage, outside the work folder, so the same containment
// gate that keeps the coach inside the folder keeps it out of the trash. An auto-allowed
// shell has no path confinement (#2157) and can find the store; it then reads ciphertext
// under opaque names only, because the key is in SecretStorage, not on disk.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ActivityTrash, activityTrashKeyName } from '../src/activityTrash.ts';
import { evaluateSdkToolUse } from '../src/sdkCoachHelpers.ts';
import { workspaceTools } from '../src/localRuntime/tools.ts';
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trash-reach-')));
// The shipped layout: the extension's global storage under the learner's home.
const home = path.join(top, 'home');
const root = path.join(top, 'activity'), base = path.join(home, 'Library', 'Application Support', 'HypeProof Studio', 'User', 'globalStorage', 'hypeproof.hypeproof-chat');
fs.mkdirSync(root); fs.mkdirSync(base, { recursive: true });
const SECRET = 'learner-deleted-diary-7f3a';
const NAMES = ['diary-7f3a', 'native-7f3a'];
const secrets = new Map();
const keyring = { get: async k => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async k => { secrets.delete(k); } };
try {
  fs.writeFileSync(path.join(root, 'keep.txt'), 'still here');
  fs.writeFileSync(path.join(root, 'diary-7f3a.txt'), SECRET);
  fs.writeFileSync(path.join(root, 'native-7f3a.md'), SECRET + '-native');
  const trash = new ActivityTrash(root, base, keyring);
  const entry = await trash.delete('diary-7f3a.txt');
  await trash.prepareNativeDelete(['native-7f3a.md']); fs.unlinkSync(path.join(root, 'native-7f3a.md'));
  const stored = fs.readdirSync(path.join(trash.store, 'items')).map(n => path.join(trash.store, 'items', n));
  const blobs = stored.filter(n => n.endsWith('.blob'));
  assert.equal(blobs.length, 2);
  assert.equal(stored.length, 4, 'one sealed copy and one sealed metadata file per entry');

  // Shell discovery (verify R1): the auto-allowed commands that found the plaintext before now find
  // only ciphertext under opaque names. No original name, extension or byte, and no key, on disk.
  const key = secrets.get(activityTrashKeyName(trash.store));
  assert.ok(key, 'control: the key exists, in SecretStorage only');
  const probe = [
    "find ~ -name '*.data'", "find ~ -name '*.txt' -o -name '*.md'", "find ~ -path '*activity-trash*' -type f",
    "ls -laR ~/Library/Application\\ Support/HypeProof\\ Studio/User/globalStorage",
    "find ~/Library -path '*activity-trash*' -type f -exec cat {} +", "grep -ra learner ~ ; grep -ra diary ~ ; grep -ra 7f3a ~",
    "find ~ -type f -exec strings {} +",
  ].join(' ; ');
  const shell = execFileSync('/bin/sh', ['-c', `${probe} 2>/dev/null; true`], { cwd: root, env: { ...process.env, HOME: home }, encoding: 'latin1', maxBuffer: 64 << 20 });
  assert.ok(shell.includes('activity-trash'), 'control: the shell did find the store');
  for (const needle of [SECRET, ...NAMES, '.txt', '.md', '.data', key, Buffer.from(key, 'base64').toString('hex'), Buffer.from(key, 'base64').toString('latin1')]) assert.equal(shell.includes(needle), false, `shell output contains ${JSON.stringify(needle)}`);
  const all = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? all(path.join(dir, d.name)) : [path.join(dir, d.name)]);
  for (const file of all(home)) {
    const raw = fs.readFileSync(file);
    for (const needle of [SECRET, ...NAMES, key]) assert.equal(raw.includes(needle), false, `${file} contains ${needle}`);
    assert.equal(raw.includes(Buffer.from(key, 'base64')), false, `${file} contains the raw key`);
    assert.ok(!NAMES.some(n => file.includes(n)) && !/\.(txt|md|data)$/.test(file), file);
  }

  // No byte of a trashed file is left anywhere in the work folder.
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
  for (const file of walk(root)) assert.equal(fs.readFileSync(file, 'utf8').includes(SECRET), false, file);

  // SDK runtime: Read, Glob and Grep on the store are refused by workspace containment.
  const canonicalize = p => { try { return fs.realpathSync(p); } catch { return p; } };
  const sdk = (toolName, input) => evaluateSdkToolUse({ toolName, input, permittedTools: ['Read', 'Glob', 'Grep', 'Bash'], workspaceRoot: root, canonicalize });
  for (const blob of blobs) assert.equal(sdk('Read', { file_path: blob }).decision, 'deny', blob);
  assert.equal(sdk('Read', { file_path: path.join(root, '..', 'home', 'Library', 'Application Support', 'HypeProof Studio', 'User', 'globalStorage', 'hypeproof.hypeproof-chat', 'activity-trash') }).decision, 'deny');
  assert.equal(sdk('Glob', { pattern: '**/*', path: trash.store }).decision, 'deny');
  assert.equal(sdk('Glob', { pattern: `${base}/**/*.blob` }).decision, 'deny');
  assert.equal(sdk('Grep', { pattern: SECRET, path: trash.store }).decision, 'deny');
  assert.equal(sdk('Grep', { pattern: SECRET, path: base }).decision, 'deny');
  // Control: the same gate allows the folder's own file, so the denials above are about the store.
  assert.equal(sdk('Read', { file_path: path.join(root, 'keep.txt') }).decision, 'allow');

  // SDK Bash: the commands a coach uses on its work folder find nothing of the trash.
  const out = execFileSync('/bin/sh', ['-c', 'cat .hypeproof/trash/* 2>/dev/null; cat ./* 2>/dev/null; grep -ra "" . 2>/dev/null; find . -type f -exec cat {} + 2>/dev/null; ls -laR .'], { cwd: root, encoding: 'utf8' });
  assert.equal(out.includes(SECRET), false);
  assert.ok(out.includes('still here'), 'control: the shell did read the work folder');

  // Local runtime: its Read goes through the same containment, for the store path and a relative escape.
  const tools = workspaceTools({ cwd: root, profile: { sdk_tools: { read: true, write: true }, tools: { web_search: false } }, signal: new AbortController().signal, approve: async () => true });
  for (const blob of blobs) await assert.rejects(tools.call('Read', { file_path: blob }), /밖/);
  await assert.rejects(tools.call('Read', { file_path: path.relative(root, blobs[0]) }), /밖/);
  await assert.rejects(tools.call('Read', { file_path: '.hypeproof/trash/' + path.basename(blobs[0]) }));
  await assert.rejects(tools.call('Write', { file_path: path.join(trash.store, 'items', 'x.json'), content: '{}' }), /밖/);
  assert.equal(await tools.call('Read', { file_path: 'keep.txt' }), 'still here');

  // And the learner still gets the bytes back.
  await trash.restore(entry.id);
  assert.equal(fs.readFileSync(path.join(root, 'diary-7f3a.txt'), 'utf8'), SECRET);
  console.log('activity trash reach: a shell that finds the store reads only ciphertext under opaque names; SDK Read/Glob/Grep, Bash in the work folder and the local runtime cannot reach trashed bytes PASS');
} finally { fs.rmSync(top, { recursive: true, force: true }); }
