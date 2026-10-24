import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const upstream = resolve(process.env.VSCODE_SOURCE ?? join(repo, 'vscodium-base/vscode'));
const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH ?? require.resolve('typescript', {
  paths: [join(repo, 'e2e'), join(repo, 'extensions/hypeproof-chat/webview-ui'), upstream],
}));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8' });
const original = path => run('git', ['show', `HEAD:${path}`], upstream);
const fixture = mkdtempSync(join(tmpdir(), 'hps-secure-storage-'));
after(() => rmSync(fixture, { recursive: true, force: true }));
const sourcePath = 'src/vs/platform/secrets/common/secrets.ts';
const browserPath = 'src/vs/workbench/services/secrets/browser/secretStorageService.ts';

// Exercise the real staging script in an isolated pipeline tree, then apply its
// output to pristine upstream. Never modify the cached checkout or an app bundle.
mkdirSync(join(fixture, 'scripts/patches/core'), { recursive: true });
cpSync(join(repo, 'scripts/stage-core-patches.sh'), join(fixture, 'scripts/stage-core-patches.sh'));
for (const file of readdirSync(resolve(here, '..')).filter(file => file.endsWith('.patch'))) {
  cpSync(resolve(here, '..', file), join(fixture, 'scripts/patches/core', file));
}
run('bash', ['scripts/stage-core-patches.sh'], fixture);
const staged = join(fixture, 'vscodium-base/patches/user/99-hps-secure-storage.patch');
mkdirSync(dirname(join(fixture, sourcePath)), { recursive: true });
writeFileSync(join(fixture, sourcePath), original(sourcePath));
run('git', ['init', '-q'], fixture);
run('git', ['apply', '--check', staged], fixture);
run('git', ['apply', staged], fixture);
const patched = process.env.TEST_UPSTREAM_BASELINE === '1'
  ? original(sourcePath) : readFileSync(join(fixture, sourcePath), 'utf8');

// Transpile and execute actual upstream modules, including storage, sequencing,
// events, disposables, and BrowserSecretStorageService. Only encryption and log
// services are test doubles; no SecretStorage implementation is duplicated here.
const modules = new Map();
function load(path) {
  if (modules.has(path)) return modules.get(path).exports;
  const source = path === sourcePath ? patched : original(path);
  const module = { exports: {} };
  modules.set(path, module);
  const result = ts.transpileModule(source, { fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true, useDefineForClassFields: false } });
  const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${path}: ${errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`);
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) return require(specifier);
    const absolute = resolve('/', dirname(path), specifier).slice(1).replace(/\.js$/, '.ts');
    return load(absolute);
  };
  vm.runInThisContext(`(function(require,module,exports) {\n${result.outputText}\n})`, { filename: path })(localRequire, module, module.exports);
  return module.exports;
}
const { BaseSecretStorageService } = load(sourcePath);
const { BrowserSecretStorageService } = load(browserPath);
const { InMemoryStorageService, StorageScope, StorageTarget } = load('src/vs/platform/storage/common/storage.ts');
const scope = StorageScope.APPLICATION;
const target = StorageTarget.MACHINE;
const log = { trace() {}, error() {} };
function setup(inMemory = false, Browser = false, provider) {
  // The real upstream in-memory backend simulates the application database;
  // persisted-mode assertions inspect its raw records across service restarts.
  const storage = new InMemoryStorageService();
  const calls = [];
  const encryption = {
    available: true, availabilityError: undefined, decryptError: undefined, encryptError: undefined,
    async isEncryptionAvailable() { calls.push('available'); if (this.availabilityError) throw this.availabilityError; return this.available; },
    async encrypt(value) { calls.push('encrypt'); if (this.encryptError) throw this.encryptError; return `ciphertext:${value}`; },
    async decrypt(value) { calls.push('decrypt'); if (this.decryptError) throw this.decryptError; assert.ok(value.startsWith('ciphertext:')); return value.slice(11); },
  };
  const service = Browser
    ? new BrowserSecretStorageService(storage, encryption, { options: { secretStorageProvider: provider } }, log)
    : new BaseSecretStorageService(inMemory, storage, encryption, log);
  return { service, storage, encryption, calls, dispose() { service.dispose(); storage.dispose(); } };
}

test('generated patch is current and real staging is idempotent', () => {
  run('python3', [join(here, 'build_patch.py'), upstream, '--check'], repo);
  assert.equal(readFileSync(staged, 'utf8'), readFileSync(resolve(here, '../hps-secure-storage.patch'), 'utf8'));
  run('bash', ['scripts/stage-core-patches.sh'], fixture);
  assert.equal(readFileSync(staged, 'utf8'), readFileSync(resolve(here, '../hps-secure-storage.patch'), 'utf8'));
});

test('metadata listing, missing reads and explicit deletion never probe keychain', async () => {
  const f = setup();
  try {
    f.encryption.availabilityError = new Error('keychain access would prompt');
    f.storage.store('unrelated', 'public value', scope, target);
    f.storage.store('secret://saved', 'ciphertext:saved-value', scope, target);
    assert.deepEqual(await f.service.keys(), ['saved']);
    assert.equal(await f.service.get('absent'), undefined);
    await f.service.delete('saved');
    assert.deepEqual(await f.service.keys(), []);
    assert.deepEqual(f.calls, []);
    assert.equal(f.storage.get('unrelated', scope), 'public value');
  } finally { f.dispose(); }
});

test('persisted writes encrypt, restart reads decrypt and same-key operations stay ordered', async () => {
  const f = setup();
  let restarted;
  try {
    const write = f.service.set('token', 'secret-value');
    const read = f.service.get('token');
    await write;
    assert.equal(await read, 'secret-value');
    assert.equal(f.storage.get('secret://token', scope), 'ciphertext:secret-value');
    assert.equal(f.service.type, 'persisted');
    assert.deepEqual(f.calls.filter(call => call !== 'available'), ['encrypt', 'decrypt']);
    f.service.dispose();
    restarted = new BaseSecretStorageService(false, f.storage, f.encryption, log);
    assert.equal(await restarted.get('token'), 'secret-value');
  } finally { restarted?.dispose(); f.dispose(); }
});

test('unavailable or rejected keychain checks fail without fallback or lost data and retry after recovery', async () => {
  const firstAttempt = setup();
  try {
    firstAttempt.storage.store('secret://token', 'ciphertext:saved', scope, target);
    const locked = new Error('keychain initially locked');
    firstAttempt.encryption.availabilityError = locked;
    await assert.rejects(firstAttempt.service.get('token'), error => error === locked);
    firstAttempt.encryption.availabilityError = undefined;
    assert.equal(await firstAttempt.service.get('token'), 'saved');
  } finally { firstAttempt.dispose(); }
  const f = setup();
  try {
    f.storage.store('secret://token', 'ciphertext:original', scope, target);
    f.encryption.available = false;
    await assert.rejects(f.service.get('token'), /encryption is unavailable/);
    await assert.rejects(f.service.set('token', 'replacement'), /encryption is unavailable/);
    await assert.rejects(f.service.set('new', 'new-value'), /encryption is unavailable/);
    assert.equal(f.storage.get('secret://token', scope), 'ciphertext:original');
    assert.equal(f.storage.get('secret://new', scope), undefined);
    assert.equal(f.service.type, 'persisted');
    assert.ok(f.calls.every(call => call === 'available'));
    const denied = new Error('access denied');
    f.encryption.availabilityError = denied;
    await assert.rejects(f.service.set('token', 'replacement'), error => error === denied);
    f.encryption.availabilityError = undefined;
    f.encryption.available = true;
    assert.equal(await f.service.get('token'), 'original');
    await f.service.set('token', 'replacement');
    assert.equal(await f.service.get('token'), 'replacement');
  } finally { f.dispose(); }
});

test('denied/corrupt decryption and failed writes preserve ciphertext, events, and queue recovery', async () => {
  const f = setup();
  const changes = [];
  f.service.onDidChangeSecret(key => changes.push(key));
  try {
    await f.service.set('token', 'original');
    changes.length = 0;
    for (const reason of ['user cancelled keychain prompt', 'ciphertext cannot be decrypted']) {
      const failure = new Error(reason);
      f.encryption.decryptError = failure;
      await assert.rejects(f.service.get('token'), error => error === failure);
      // Drain the same queue: an accidentally enqueued delete would be observed.
      assert.deepEqual(await f.service.keys(), ['token']);
      assert.equal(f.storage.get('secret://token', scope), 'ciphertext:original');
    }
    f.encryption.encryptError = new Error('write denied');
    await assert.rejects(f.service.set('token', 'replacement'), /write denied/);
    assert.equal(f.storage.get('secret://token', scope), 'ciphertext:original');
    assert.deepEqual(changes, []);
    f.encryption.decryptError = undefined;
    f.encryption.encryptError = undefined;
    assert.equal(await f.service.get('token'), 'original');
    await f.service.set('token', 'replacement');
    assert.deepEqual(changes, ['token']);
  } finally { f.dispose(); }
});

test('explicit in-memory mode preserves empty values and data/listeners across reinitialize', async () => {
  const f = setup(true);
  const changes = [];
  f.service.onDidChangeSecret(key => changes.push(key));
  try {
    f.encryption.availabilityError = new Error('must not access OS encryption');
    await f.service.set('empty', '');
    assert.equal(await f.service.get('empty'), '');
    f.service.reinitialize();
    assert.equal(await f.service.get('empty'), '');
    await f.service.set('token', 'memory-only');
    f.service.reinitialize();
    assert.deepEqual(await f.service.keys(), ['empty', 'token']);
    await f.service.delete('token');
    assert.deepEqual(changes, ['empty', 'token', 'token']);
    assert.deepEqual(f.storage.keys(scope, target), []);
    assert.deepEqual(f.calls, []);
    assert.equal(f.service.type, 'in-memory');
  } finally { f.dispose(); }
});

test('persisted event subscription is singular after reinitialize and disposed cleanly', async () => {
  const f = setup();
  const changes = [];
  f.service.onDidChangeSecret(key => changes.push(key));
  try {
    await f.service.keys();
    f.service.reinitialize();
    await f.service.keys();
    f.storage.store('unrelated', 'value', scope, target);
    await f.service.set('token', 'value');
    await f.service.delete('token');
    assert.deepEqual(changes, ['token', 'token']);
    f.service.dispose();
    f.storage.store('secret://after-disposal', 'ciphertext:value', scope, target);
    assert.deepEqual(changes, ['token', 'token']);
  } finally { f.dispose(); }
});

test('actual browser class keeps explicit in-memory mode and embedder provider behavior', async () => {
  const memory = setup(false, true);
  const values = new Map();
  const provider = {
    type: 'persisted',
    async get(key) { return values.get(key); },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async keys() { return [...values.keys()]; },
  };
  const embedded = setup(false, true, provider);
  const changes = [];
  embedded.service.onDidChangeSecret(key => changes.push(key));
  try {
    await memory.service.set('token', 'browser-memory');
    assert.equal(await memory.service.get('token'), 'browser-memory');
    assert.equal(memory.service.type, 'in-memory');
    assert.deepEqual(memory.calls, []);
    await embedded.service.set('token', 'provider-value');
    assert.equal(await embedded.service.get('token'), 'provider-value');
    assert.deepEqual(await embedded.service.keys(), ['token']);
    assert.equal(embedded.service.type, 'persisted');
    await embedded.service.delete('token');
    assert.deepEqual(changes, ['token', 'token']);
    assert.deepEqual(embedded.calls, []);
    assert.deepEqual(embedded.storage.keys(scope, target), []);
    delete provider.keys;
    assert.throws(() => embedded.service.keys(), /does not support keys/);
  } finally { memory.dispose(); embedded.dispose(); }
});
