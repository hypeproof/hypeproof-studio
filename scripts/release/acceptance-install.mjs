#!/usr/bin/env node
// Release acceptance through the install path users actually take (#4074, hid #3865).
//
// verify-unified-release.yml used to put the native SDK binary on the runner itself, so an installer or
// updater that forgot the SDK still passed. This script instead renders the candidate's own
// install-mac.sh / update-windows.cmd (the same renderers the publish job uses), runs it against the
// candidate's accepted bytes (the installers' HPS_INSTALL_ASSET_DIR test seam; checksums still apply),
// then asserts deterministically that the App is installed at the expected version and that the SDK
// binary the App expects is present, executable and trusted (the App's own verdict, sdk-seed.mjs).
//
//   acceptance-install.mjs install --platform P --tag T --source-sha S --version V --app EXTRACTED_APP
//       --assets DIR --seed-dir DIR --work DIR [--evidence FILE]
//     fresh install of the candidate, then verify. Exit 0 pass, 1 fail.
//   acceptance-install.mjs upgrade ... (same flags) [--repo owner/name]
//     install the previous published stable from its own public install command, verify it, then bring it to
//     the candidate with the candidate's installer and verify the version moved. Exit 3: NOT RUN (the
//     previous stable carries no install command), so the workflow can show it instead of failing.
//
// What this does NOT prove: the in-app updater (it reads only the latest published stable release, never a
// draft or an -rc, so it cannot be pointed at a candidate), BB-028 (background auto-update with no click),
// or a real signed install on a user's machine. Those stay manual (casebook BB-022, BB-028).
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {checkSeededSdk} from '../../e2e/unified-release/sdk-seed.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const PLATFORMS = ['darwin-arm64', 'win32-x64'];
export const NOT_RUN_EXIT = 3;
const APP_STABLE = /^v\d+\.\d+\.\d+$/;
const MAC_APP = 'HypeProof Studio.app';

/** Where the installers put the App for the current user. */
export function installedAppPath(platform, {home = os.homedir(), env = process.env} = {}) {
  if (platform === 'darwin-arm64') return path.join(home, 'Applications', MAC_APP);
  if (platform === 'win32-x64') {
    if (!env.LOCALAPPDATA) throw Error('LOCALAPPDATA is not set');
    return path.join(env.LOCALAPPDATA, 'Programs', 'HypeProof Studio');
  }
  throw Error(`unknown platform ${platform}`);
}

function productJson(platform, app) {
  const file = platform === 'darwin-arm64' ? path.join(app, 'Contents/Resources/app/product.json') : path.join(app, 'resources/app/product.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The deterministic assertion: the installed App is the expected build and the SDK it expects is present,
 * executable and trusted. `sdkVersion` pins the SDK version the candidate vendors, so a stale seed for
 * another version cannot pass. Returns {ok, reasons, evidence}; never throws for a failed assertion.
 */
export function verifyInstalled({platform, app, productVersion, sdkVersion, home = os.homedir(), env = process.env}) {
  const reasons = [];
  const nodePlatform = platform === 'darwin-arm64' ? 'darwin' : 'win32';
  let product;
  try { product = productJson(platform, app); } catch (error) { return {ok: false, reasons: [`no readable product.json in ${app}: ${error.message}`], evidence: {app}}; }
  if (product.version !== productVersion) reasons.push(`installed App is ${product.version}, expected ${productVersion}`);
  let sdk;
  try { sdk = checkSeededSdk(app, {platform: nodePlatform, home, env}); } catch (error) { sdk = {ok: false, reason: error.message}; }
  if (!sdk.ok) reasons.push(`Agent SDK not usable after install: ${sdk.reason} (${sdk.binary ?? 'no path'})`);
  else if (sdkVersion && sdk.version !== sdkVersion) reasons.push(`App expects SDK ${sdk.version}, the release seeds ${sdkVersion}`);
  return {ok: reasons.length === 0, reasons, evidence: {app, productVersion: product.version, sdk: {ok: sdk.ok, version: sdk.version ?? null, binary: sdk.binary ?? null, reason: sdk.reason ?? null}}};
}

/** The published stable App releases, newest first, other than the candidate. */
export function previousStable(releases, candidateTag) {
  return releases
    .filter(r => !r.draft && !r.prerelease && r.tag_name !== candidateTag && APP_STABLE.test(r.tag_name))
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))[0]?.tag_name ?? null;
}

/** How an installer script is run: command, args, env. The outcome ping to the production API is always off. */
export function installerInvocation({platform, script, assetDir, layout = 'app'}) {
  const env = {HPS_NO_INSTALL_PING: '1', ...(assetDir ? {HPS_INSTALL_ASSET_DIR: assetDir} : {})};
  if (platform === 'darwin-arm64') return {command: 'bash', args: [script, '--layout', layout], env};
  if (platform === 'win32-x64') return {command: 'cmd.exe', args: ['/c', script], env: {...env, HPS_NO_PAUSE: '1'}};
  throw Error(`unknown platform ${platform}`);
}

const copy = (from, to) => fs.copyFileSync(from, to);

/** Renders the candidate's installer from the accepted bytes into `work`; returns {script, assetDir}. */
export function renderCandidateInstaller({platform, tag, sourceSha, productVersion, assets, seedDir, sdkVersion, work, exec = execFileSync}) {
  const out = path.join(work, 'render');
  const assetDir = path.join(work, 'assets');
  fs.mkdirSync(out, {recursive: true});
  fs.mkdirSync(assetDir, {recursive: true});
  const sha = file => exec(process.execPath, ['-e', "const c=require('node:crypto'),f=require('node:fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))", file], {encoding: 'utf8'});
  const seedName = `claude-agent-sdk-${platform}-${sdkVersion}.tgz`;
  const seed = path.join(seedDir, seedName);
  if (!fs.existsSync(seed)) throw Error(`SDK seed ${seedName} is missing from ${seedDir}`);
  copy(seed, path.join(assetDir, seedName));
  const kit = path.join(HERE, 'install-kit.mjs');
  if (platform === 'darwin-arm64') {
    const zip = path.join(assets, 'HypeProof-Studio-darwin-arm64.zip');
    const seederSource = path.join(ROOT, 'scripts/seed-sdk-binary.sh');
    exec(process.execPath, [kit, 'render', '--tag', tag, '--source-sha', sourceSha, '--product-version', productVersion, '--mac-zip', zip, '--zip-sha256', sha(zip),
      '--seed-name', seedName, '--seed-sha256', sha(seed), '--seeder-sha256', sha(seederSource), '--out', out], {stdio: 'inherit'});
    copy(zip, path.join(assetDir, 'HypeProof-Studio-darwin-arm64.zip'));
    copy(seederSource, path.join(assetDir, 'seed-sdk-binary.sh'));
    return {script: path.join(out, 'install-mac.sh'), assetDir};
  }
  const exes = fs.readdirSync(assets).filter(n => /^HypeProof\.StudioUserSetup-x64-.+\.exe$/.test(n));
  if (exes.length !== 1) throw Error(`expected one per-user installer in ${assets}, found ${exes.length}`);
  const seeder = path.join(ROOT, 'scripts/seed-sdk-binary.ps1');
  copy(seeder, path.join(out, 'seed-sdk-binary.ps1'));
  exec(process.execPath, [kit, 'render-windows', '--tag', tag, '--user-setup', path.join(assets, exes[0]), '--seed-tarball', seed, '--seeder', seeder, '--out', out], {stdio: 'inherit'});
  copy(path.join(assets, exes[0]), path.join(assetDir, exes[0]));
  copy(seeder, path.join(assetDir, 'seed-sdk-binary.ps1'));
  return {script: path.join(out, 'update-windows.cmd'), assetDir};
}

/** Runs an installer; a nonzero exit is a failure. A zero exit proves nothing about the SDK (install-mac.sh only warns). */
export function runInstaller(invocation, {run = spawnSync, cwd} = {}) {
  const r = run(invocation.command, invocation.args, {stdio: 'inherit', cwd, env: {...process.env, ...invocation.env}});
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(`installer exited ${r.status}`);
}

export function freshInstall(opts, deps = {}) {
  const render = deps.render ?? renderCandidateInstaller;
  const run = deps.run ?? runInstaller;
  const {script, assetDir} = render(opts);
  run(installerInvocation({platform: opts.platform, script, assetDir}), {cwd: opts.work});
  return verifyInstalled({platform: opts.platform, app: installedAppPath(opts.platform, deps.paths), productVersion: opts.productVersion, sdkVersion: opts.sdkVersion, ...(deps.paths ?? {})});
}

/**
 * previous stable (its own public install command) -> candidate (the candidate's installer).
 * Returns {state: 'NOT_RUN', reason} when the previous stable has no install command asset.
 */
export function upgradeInstall(opts, deps = {}) {
  const run = deps.run ?? runInstaller;
  const find = deps.previous ?? (() => previousStable(JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${opts.repo}/releases?per_page=100`], {encoding: 'utf8', maxBuffer: 64 << 20})).flat(), opts.tag));
  const download = deps.download ?? ((tag, name, dir) => {
    try { execFileSync('gh', ['release', 'download', tag, '--repo', opts.repo, '--pattern', name, '--dir', dir], {stdio: 'pipe'}); return fs.existsSync(path.join(dir, name)); } catch { return false; }
  });
  const previous = find();
  if (!previous) return {state: 'NOT_RUN', reason: 'no earlier published stable release'};
  const name = opts.platform === 'darwin-arm64' ? 'install-mac.sh' : 'update-windows.cmd';
  const dir = path.join(opts.work, 'previous');
  fs.mkdirSync(dir, {recursive: true});
  if (!download(previous, name, dir)) return {state: 'NOT_RUN', reason: `${previous} carries no ${name}`};
  const previousVersion = previous.replace(/^v/, '');
  // Its own public command, from its own release URL (no asset-dir seam): what a user runs to get that version.
  run(installerInvocation({platform: opts.platform, script: path.join(dir, name)}), {cwd: opts.work});
  const before = verifyInstalled({platform: opts.platform, app: installedAppPath(opts.platform, deps.paths), productVersion: previousVersion, ...(deps.paths ?? {})});
  if (!before.ok) return {state: 'FAIL', stage: `previous ${previous}`, previous, previousVersion, reasons: before.reasons, evidence: {previous: before.evidence}};
  const after = freshInstall(opts, deps);
  if (after.ok && after.evidence.productVersion === previousVersion) after.reasons.push('version did not move'), after.ok = false;
  return {state: after.ok ? 'PASS' : 'FAIL', stage: `candidate over ${previous}`, previous, previousVersion, reasons: after.reasons, evidence: {previous: before.evidence, candidate: after.evidence}};
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const {values: v} = parseArgs({args: rest, options: {platform: {type: 'string'}, tag: {type: 'string'}, 'source-sha': {type: 'string'}, version: {type: 'string'}, app: {type: 'string'},
    assets: {type: 'string'}, 'seed-dir': {type: 'string'}, work: {type: 'string'}, evidence: {type: 'string'}, repo: {type: 'string', default: 'hypeproof/hypeproof-studio'}}, strict: true});
  for (const f of ['platform', 'tag', 'source-sha', 'version', 'app', 'assets', 'seed-dir', 'work']) if (!v[f]) { console.error(`acceptance-install: --${f} is required`); process.exit(2); }
  if (!['install', 'upgrade'].includes(mode) || !PLATFORMS.includes(v.platform)) { console.error('usage: acceptance-install.mjs install|upgrade --platform darwin-arm64|win32-x64 ...'); process.exit(2); }
  const sdkVersion = JSON.parse(fs.readFileSync(path.join(v.platform === 'darwin-arm64' ? path.join(v.app, 'Contents/Resources/app') : path.join(v.app, 'resources/app'),
    'extensions/hypeproof-chat/dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')).version;
  const opts = {platform: v.platform, tag: v.tag, sourceSha: v['source-sha'], productVersion: v.version, assets: v.assets, seedDir: v['seed-dir'], sdkVersion, work: v.work, repo: v.repo};
  const result = mode === 'install'
    ? (r => ({state: r.ok ? 'PASS' : 'FAIL', stage: 'fresh install', reasons: r.reasons, evidence: r.evidence}))(freshInstall(opts))
    : upgradeInstall(opts);
  const record = {schema: 'hps-acceptance-install/1', mode, platform: v.platform, tag: v.tag, ...result};
  if (v.evidence) { fs.mkdirSync(path.dirname(path.resolve(v.evidence)), {recursive: true}); fs.writeFileSync(v.evidence, `${JSON.stringify(record, null, 2)}\n`); }
  console.log(JSON.stringify(record, null, 2));
  if (result.state === 'NOT_RUN') { console.error(`NOT RUN: ${result.reason}`); process.exit(NOT_RUN_EXIT); }
  if (result.state !== 'PASS') { console.error(`FAIL (${result.stage}): ${result.reasons.join('; ')}`); process.exit(1); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
