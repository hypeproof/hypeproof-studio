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
  const result = ts.transpileModule(source, {fileName: filename, reportDiagnostics: true, compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true}});
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
    prepare(args = {}, env = {}, argv = [executable]) { return core.prepareRcStorage(args, product, executable, home, 'darwin', env, argv); }};
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
  assert.equal(core.prepareRcStorage(args, f.product, executable, f.home, 'darwin', {}, [executable]), undefined);
  assert.equal(args['user-data-dir'], '/existing/production-profile');
  assert.throws(() => core.prepareRcStorage({'user-data-dir': f.profile}, f.product, executable, f.home, 'darwin', {}, [executable]), /matching kit app/);
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
      const processStub = {execPath: executable, argv: [executable], platform: 'darwin', env};
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

function reparseStartup(f, argv, executable = f.executable) {
  const minimist = require(process.env.MINIMIST_PATH ?? require.resolve('minimist', {paths: [upstream, path.join(repo, 'e2e')]}));
  const proc = {argv, execPath: executable, platform: 'darwin', env: {}, cwd: () => f.home};
  const osStub = {homedir: () => f.home, tmpdir: () => fixture};
  const baseRequire = name => name === 'minimist' ? {default: minimist} : name === 'assert' ? {default: assert} : name.endsWith('/platform.js') ? {isWindows: false} : name.endsWith('/nls.js') ? {localize: (_key, text) => text} : name.endsWith('/path.js') ? path : name === 'os' ? osStub : require(name);
  const argvModule = compile(original('src/vs/platform/environment/node/argv.ts'), 'argv.ts', {process: proc, require: baseRequire});
  const parser = compile(original('src/vs/platform/environment/node/argvHelper.ts'), 'argvHelper.ts', {process: proc, require: name => name === './argv.js' ? argvModule : baseRequire(name)});
  const userData = compile(original('src/vs/platform/environment/node/userDataPath.ts'), 'userDataPath.ts', {process: proc, require: baseRequire});
  const main = patchedMain;
  const tree = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
  const earlyParser = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'parseCLIArgs');
  assert.ok(earlyParser, 'execute actual early parser');
  const prelude = main.slice(main.indexOf('const args = parseCLIArgs();'), main.indexOf('// Resolve code cache path'));
  let electronPath, name;
  vm.runInNewContext(ts.transpileModule(earlyParser.getText(tree) + '\n' + prelude, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, {
    ...core, process: proc, minimist, os: osStub, product: {...f.product, nameShort: 'HypeProof Studio'},
    configureCommandlineSwitchesSync: () => ({}), getUserDataPath: userData.getUserDataPath,
    app: {setName: value => {name = value;}, setPath: (_key, value) => {electronPath = value;}, enableSandbox() {}, commandLine: {hasSwitch: () => false, appendSwitch() {}}},
  });
  const laterArgs = parser.parseMainProcessArgv(proc.argv);
  const uri = value => ({fsPath: value, with() {return this;}});
  const environmentSource = original('src/vs/platform/environment/common/environmentService.ts');
  const environment = compile(environmentSource, 'environmentService.ts', {require: name =>
    name.endsWith('/decorators.js') ? {memoize: (_target, _key, descriptor) => descriptor} :
    name.endsWith('/date.js') ? {toLocalISOString: () => '2026-10-24T00:00:00.000Z'} :
    name.endsWith('/network.js') ? {Schemas: {vscodeUserData: 'vscode-userdata'}} :
    name.endsWith('/process.js') ? {env: {}} :
    name.endsWith('/resources.js') ? {joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts))} :
    name.endsWith('/uri.js') ? {URI: {file: uri}} : baseRequire(name)});
  const native = compile(original('src/vs/platform/environment/node/environmentService.ts'), 'nativeEnvironmentService.ts', {require: name =>
    name === '../common/environmentService.js' ? environment : name === './userDataPath.js' ? userData : baseRequire(name)});
  const service = new native.NativeEnvironmentService(laterArgs, {...f.product, nameShort: 'HypeProof Studio'});
  return {electronPath, name, service, argv: proc.argv, laterArgs};
}

test('Finder bootstrap and later actual CLI/environment parsing select the same RC profile', () => {
  const f = setup();
  const argv = [f.executable, '--new-window', '--', 'notes.txt'];
  const result = reparseStartup(f, argv);
  assert.equal(result.electronPath, f.profile);
  assert.equal(result.service.userDataPath, f.profile, 'later VS Code environment must not reopen production storage');
  assert.equal(result.service.extensionsPath, path.join(f.profile, 'extensions'));
  assert.ok(result.service.logsHome.fsPath.startsWith(path.join(f.profile, 'logs') + path.sep));
  assert.equal(result.service.stateResource.fsPath, path.join(f.profile, 'User/globalStorage/storage.json'));
  assert.equal(result.service.workspaceStorageHome.fsPath, path.join(f.profile, 'User/workspaceStorage'));
  assert.deepEqual(Array.from(result.laterArgs._), ['notes.txt']);
  const once = [...argv];
  reparseStartup(f, argv);
  assert.deepEqual(argv, once, 'validated canonical flags are idempotent');
});

test('real START launcher arguments agree with both parsers and preserve stable launch', async () => {
  const {renderStart} = await import('../../../release/install-kit.mjs');
  const f = setup();
  const capture = path.join(f.home, 'argv.json');
  fs.writeFileSync(f.executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(1)));\n`, {mode: 0o755});
  const launcher = path.join(f.home, 'START.command');
  // Only the native plist executable lookup is stubbed. The real marker checks,
  // environment cleanup, and final exec line run against our disposable app.
  const start = renderStart('v' + version, source, '2026.1024.0');
  const lookup = 'EXE=$(/usr/libexec/PlistBuddy -c \'Print CFBundleExecutable\' "$APP/Contents/Info.plist")';
  assert.ok(start.includes(lookup));
  fs.writeFileSync(launcher, start.replace(lookup, 'EXE=Electron'));
  execFileSync('bash', [launcher], {env: {PATH: '/usr/bin:/bin', HOME: f.home, VSCODE_APPDATA: '/synthetic-conflict'}});
  const argv = JSON.parse(fs.readFileSync(capture, 'utf8'));
  const result = reparseStartup(f, argv);
  assert.equal(result.electronPath, f.profile);
  assert.equal(result.service.userDataPath, f.profile);
  assert.equal(result.service.extensionsPath, path.join(f.profile, 'extensions'));
  const stableExecutable = path.join(f.home, 'Applications/HypeProof Studio.app/Contents/MacOS/Electron');
  const stableArgv = [stableExecutable, '--new-window'];
  const stable = reparseStartup(f, stableArgv, stableExecutable);
  assert.equal(stable.service.userDataPath, path.join(f.home, 'Library/Application Support/HypeProof Studio'));
  assert.equal(stable.name, undefined);
  assert.deepEqual(stableArgv, [stableExecutable, '--new-window']);
});

test('RC argv propagation rejects conflicting, duplicate, empty and negated options without mutation', () => {
  const f = setup();
  const own = '--user-data-dir=' + f.profile;
  for (const tail of [
    ['--user-data-dir=/synthetic-production'], ['--user-data-dir', '/synthetic-production'],
    ['--user-data-dir='], ['--user-data-dir'], ['--no-user-data-dir'],
    [own, own], [own, '--user-data-dir=/synthetic-production'],
    ['--extensions-dir=/synthetic-production'], ['--extensions-dir='], ['--extensions-dir'], ['--no-extensions-dir'],
    ['--extensions-dir=' + path.join(f.profile, 'extensions'), '--extensions-dir=' + path.join(f.profile, 'extensions')],
  ]) {
    const argv = [f.executable, ...tail];
    const before = [...argv];
    assert.throws(() => reparseStartup(f, argv), /RC profile isolation blocked/, JSON.stringify(tail));
    assert.deepEqual(argv, before, 'failed validation must not rewrite raw CLI');
  }
  const argv = [f.executable, '--user-data-dir', f.profile, '--extensions-dir', path.join(f.profile, 'extensions'), '--new-window', '--', '--user-data-dir=literal-filename'];
  const result = reparseStartup(f, argv);
  assert.equal(result.service.userDataPath, f.profile);
  assert.deepEqual(Array.from(result.laterArgs._), ['--user-data-dir=literal-filename']);
  assert.equal(argv.filter(arg => arg === '--user-data-dir=' + f.profile).length, 1);
  assert.ok(argv.indexOf('--user-data-dir=' + f.profile) < argv.indexOf('--'));
});
