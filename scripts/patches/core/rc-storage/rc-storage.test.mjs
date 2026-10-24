import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, test} from 'node:test';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const upstream = path.resolve(process.env.VSCODE_SOURCE ?? path.join(repo, 'vscodium-base/vscode'));
const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH ?? require.resolve('typescript', {paths: [path.join(repo, 'e2e'), upstream]}));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-rc-contract-'));
after(() => fs.rmSync(fixture, {recursive: true, force: true}));
const run = (cmd, args, cwd) => execFileSync(cmd, args, {cwd, encoding: 'utf8'});
const original = name => run('git', ['show', `HEAD:${name}`], upstream);
fs.mkdirSync(path.join(fixture, 'src'), {recursive: true});
fs.writeFileSync(path.join(fixture, 'src/main.ts'), original('src/main.ts'));
run('git', ['init', '-q'], fixture);
run('git', ['apply', '--check', path.join(here, '../hps-rc-storage.patch')], fixture);
run('git', ['apply', path.join(here, '../hps-rc-storage.patch')], fixture);
const patchedMain = fs.readFileSync(path.join(fixture, 'src/main.ts'), 'utf8');
function combinedStartup() {
  const combined = fs.mkdtempSync(path.join(fixture, 'combined-'));
  fs.mkdirSync(path.join(combined, 'src'));
  fs.writeFileSync(path.join(combined, 'src/main.ts'), original('src/main.ts'));
  run('git', ['init', '-q'], combined);
  const fork = path.resolve(process.env.VSCODIUM_SOURCE ?? path.dirname(upstream));
  // Read committed patch bytes, never the shared fork's possibly staged/dirty cache.
  const forkPatches = run('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'patches'], fork).trim().split('\n')
    .filter(name => /^patches\/[^/]+\.patch$/.test(name)).sort()
    .map(name => ({name, content: run('git', ['show', `HEAD:${name}`], fork)}));
  const studioPatches = fs.readdirSync(path.join(here, '..')).filter(name => name.endsWith('.patch') && name < 'hps-rc-storage.patch').sort()
    .map(name => ({name: `user/99-${name}`, content: fs.readFileSync(path.join(here, '..', name), 'utf8')}));
  const relevant = [...forkPatches, ...studioPatches].filter(patch => patch.content.includes('+++ b/src/main.ts'));
  assert.ok(relevant.some(patch => patch.name === 'patches/00-settings-user-product.patch'), 'real build import predecessor is exercised');
  assert.ok(studioPatches.some(patch => patch.name === 'user/99-hps-quit-guard.patch'), 'staged Studio order includes quit guard');
  for (const [i, patch] of relevant.entries()) {
    const file = path.join(combined, `preceding-${i}.patch`);
    fs.writeFileSync(file, patch.content.replaceAll('!!APP_NAME!!', 'HypeProof Studio'));
    run('git', ['apply', '--ignore-whitespace', '--include=src/main.ts', file], combined);
  }
  run('git', ['apply', '--check', path.join(here, '../hps-rc-storage.patch')], combined);
  run('git', ['apply', path.join(here, '../hps-rc-storage.patch')], combined);
  const source = fs.readFileSync(path.join(combined, 'src/main.ts'), 'utf8');
  assert.match(source, /import \{ createRequire \} from 'node:module'/, 'VSCodium import survives');
  assert.match(source, /const userLocale = 'ko'/, 'preceding Korean-shell behavior survives');
  return source;
}

function compile(source, filename, context = {}) {
  const module = {exports: {}};
  const result = ts.transpileModule(source, {fileName: filename, reportDiagnostics: true, compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}});
  assert.equal((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, {require, exports: module.exports, module, process, ...context}, {filename});
  return module.exports;
}
const core = compile(fs.readFileSync(path.join(fixture, 'src/hpsRcStorage.ts'), 'utf8'), 'hpsRcStorage.ts');
const version = '2026.1024.0-rc.2';
const source = 'a'.repeat(40);
function setup(embeddedVersion = '2026.1024.0') {
  const home = fs.mkdtempSync(path.join(fixture, 'home-'));
  const kit = path.join(home, 'Applications', `HypeProof-RC-${version}`);
  const app = path.join(kit, 'HypeProof Studio.app');
  const profile = path.join(home, 'Library/Application Support/HPS-RC-Profiles', version);
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), {recursive: true});
  fs.mkdirSync(profile, {recursive: true});
  const marker = ['hps-rc-profile-v1', 'HypeProof Studio RC', version, embeddedVersion, source, app, profile, ''].join('\n');
  for (const dir of [kit, profile]) fs.writeFileSync(path.join(dir, '.hps-rc-profile-v1'), marker);
  const executable = path.join(app, 'Contents/MacOS/Electron');
  const product = {version: embeddedVersion, commit: source};
  return {home, kit, app, profile, marker, executable, product,
    prepare(args = {}, env = {}) { return core.prepareRcStorage(args, product, executable, home, 'darwin', env); }};
}

test('patch regenerates exactly and composes with existing main startup patches', () => {
  run('python3', [path.join(here, 'build_patch.py'), upstream, '--check'], repo);
  run('git', ['apply', '--check', '--include=src/main.ts', path.join(here, '../hps-korean-shell.patch')], fixture);
});

test('RC patch applies after actual VSCodium and preceding staged Studio main.ts patches', () => {
  combinedStartup();
});

// transpileModule does not perform noUnusedLocals analysis. Check actual combined
// main.ts with the semantic compiler, without loading the entire VS Code graph.
function unusedLocalDiagnostics(source) {
  const file = path.join(fixture, 'unused-locals-main.ts');
  const options = {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    noEmit: true, noUnusedLocals: true, noResolve: true, noLib: true, types: []};
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, languageVersion) => name === file ? ts.createSourceFile(name, source, languageVersion, true) : undefined;
  const program = ts.createProgram([file], options, host);
  assert.deepEqual(program.getSyntacticDiagnostics(), [], 'combined startup parses');
  // Unresolved external types are outside this single-file check; unused declarations
  // are still checked by TypeScript, including an injected negative control below.
  return program.getSemanticDiagnostics().filter(diagnostic => [6133, 6192, 6196, 6198, 6199].includes(diagnostic.code))
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

test('combined startup passes TypeScript noUnusedLocals; an unused function is rejected', () => {
  const combined = combinedStartup();
  assert.deepEqual(unusedLocalDiagnostics(combined), [], 'build-stack main.ts has no unused declarations');
  assert.ok(unusedLocalDiagnostics(combined + '\nfunction hpsUnusedDeclarationCanary() { return 1; }\n')
    .some(message => message.includes('hpsUnusedDeclarationCanary')), 'semantic compiler must detect an unused helper');
});

test('launch and restart select the same dedicated persisted profile for both embedded version styles', () => {
  for (const embedded of ['2026.1024.0', version]) {
    const f = setup(embedded);
    const args = {};
    const selected = f.prepare(args);
    assert.equal(args['user-data-dir'], f.profile);
    assert.equal(args['extensions-dir'], path.join(f.profile, 'extensions'));
    core.validateRcUserDataPath(selected, f.profile);
    fs.writeFileSync(path.join(f.profile, 'durable-test-ciphertext'), 'opaque rc ciphertext');
    const restarted = f.prepare({});
    assert.equal(restarted.profilePath, selected.profilePath);
    assert.equal(fs.readFileSync(path.join(restarted.profilePath, 'durable-test-ciphertext'), 'utf8'), 'opaque rc ciphertext');
  }
});

test('legacy/malformed/source/path/namespace markers and symlinks fail before selecting any profile', () => {
  for (const corrupt of ['missing', 'namespace', 'source', 'path', 'symlink']) {
    const f = setup();
    const marker = path.join(f.profile, '.hps-rc-profile-v1');
    if (corrupt === 'missing') fs.unlinkSync(marker);
    if (corrupt === 'namespace') fs.writeFileSync(marker, f.marker.replace('HypeProof Studio RC', 'HypeProof Studio'));
    if (corrupt === 'source') fs.writeFileSync(marker, f.marker.replace(source, 'b'.repeat(40)));
    if (corrupt === 'path') fs.writeFileSync(marker, f.marker.replace(f.profile, path.dirname(f.profile)));
    if (corrupt === 'symlink') {fs.unlinkSync(marker); fs.symlinkSync(path.join(f.kit, '.hps-rc-profile-v1'), marker);}
    const args = {};
    assert.throws(() => f.prepare(args), /RC profile isolation blocked/);
    assert.equal(args['user-data-dir'], undefined);
  }
});

test('CLI/environment/resolved path overrides fail closed and preserve old production ciphertext', () => {
  const f = setup();
  const old = path.join(f.home, 'Library/Application Support', `HPS-${version}`);
  fs.mkdirSync(old, {recursive: true});
  fs.writeFileSync(path.join(old, 'production-ciphertext'), 'preserve exactly');
  for (const args of [{'user-data-dir': old}, {'extensions-dir': old}, {'use-inmemory-secretstorage': true}]) assert.throws(() => f.prepare(args), /RC profile isolation blocked/);
  for (const env of [{VSCODE_PORTABLE: old}, {VSCODE_APPDATA: old}]) assert.throws(() => f.prepare({}, env), /override/);
  assert.throws(() => core.validateRcUserDataPath(f.prepare(), old), /resolved userDataPath mismatch/);
  assert.equal(fs.readFileSync(path.join(old, 'production-ciphertext'), 'utf8'), 'preserve exactly');
  assert.equal(fs.existsSync(path.join(f.profile, 'production-ciphertext')), false);
});

test('the identical promoted app outside RC kit keeps production args and namespace unchanged', () => {
  const f = setup();
  const executable = path.join(f.home, 'Applications/HypeProof Studio.app/Contents/MacOS/Electron');
  const args = {'user-data-dir': '/existing/production-profile'};
  assert.equal(core.prepareRcStorage(args, f.product, executable, f.home, 'darwin', {}), undefined);
  assert.equal(args['user-data-dir'], '/existing/production-profile');
  assert.throws(() => core.prepareRcStorage({'user-data-dir': f.profile}, f.product, executable, f.home, 'darwin', {}), /matching kit app/);
});

test('actual patched startup prelude sets the fixed name only after validation, before app readiness', () => {
  for (const main of [patchedMain, combinedStartup()]) {
    const f = setup();
    const begin = main.indexOf('const args = parseCLIArgs();');
    const end = main.indexOf('// Resolve code cache path');
    assert.ok(begin >= 0 && end > begin);
    const prelude = main.slice(begin, end);
    function start(executable, env = {}, resolveOverride) {
      const events = [];
      const processStub = {execPath: executable, platform: 'darwin', env};
      const userDataModule = compile(original('src/vs/platform/environment/node/userDataPath.ts'), 'userDataPath.ts', {process: {...processStub, cwd: () => f.home}, require: name => name === 'os' ? {homedir: () => f.home} : require(name)});
      const app = {setName: name => events.push(['name', name]), setPath: (key, value) => events.push(['path', key, value]), enableSandbox() {}, commandLine: {hasSwitch: () => false, appendSwitch() {}}};
      vm.runInNewContext(ts.transpileModule(prelude, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, {
        ...core, process: processStub, os: {homedir: () => f.home}, product: f.product, parseCLIArgs: () => ({}),
        configureCommandlineSwitchesSync: () => {events.push(['argv']); return {};},
        getUserDataPath: resolveOverride ?? userDataModule.getUserDataPath, app,
      });
      return events;
    }
    const events = start(f.executable);
    assert.deepEqual(events, [['argv'], ['name', 'HypeProof Studio RC'], ['path', 'userData', f.profile]]);
    const stableEvents = start(path.join(f.home, 'Applications/HypeProof Studio.app/Contents/MacOS/Electron'));
    assert.deepEqual(stableEvents, [['argv'], ['path', 'userData', path.join(f.home, 'Library/Application Support/code-oss-dev')]]);
    assert.throws(() => start(f.executable, {}, () => '/production'), /resolved userDataPath mismatch/);
    assert.throws(() => start(f.executable, {VSCODE_APPDATA: '/production'}), /override/);
  }
});
