// Controls for scripts/lib/studio-launcher.mjs with fake app processes (no Studio,
// no window). Each case runs an "owner" Node process that launches a fake app
// through the launcher, then checks from outside what was left behind.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { StudioRun, isAlive, sweep, watchFocus, verifySession, createOwnedDir } from '../lib/studio-launcher.mjs';

const LAUNCHER = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/studio-launcher.mjs')).href;
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hps-launcher-test-')));
const ROOT = path.join(work, 'root');
process.env.HPS_LAUNCH_ROOT = ROOT;
process.env.HPS_LAUNCH_FOCUS_CHECK = '0';
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

// A fake "app": stays up, forks one plain child (found as a descendant) and one
// detached helper carrying the user-data-dir (found by marker after reparenting).
const FAKE = path.join(work, 'HypeProof Studio');
fs.writeFileSync(FAKE, `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const ud = process.argv.find(a => a.startsWith('--user-data-dir=')) || '';
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
const helper = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '--', ud], { detached: true, stdio: 'ignore' });
helper.unref();
console.log(JSON.stringify({ app: process.pid, child: child.pid, helper: helper.pid }));
setInterval(() => {}, 1000);
`);
fs.chmodSync(FAKE, 0o755);
fs.writeFileSync(path.join(work, 'package.json'), '{"type":"commonjs"}');

function owner(body, env = {}) {
  const script = `import { createStudioRun, spawnStudio } from ${JSON.stringify(LAUNCHER)};
const FAKE = ${JSON.stringify(FAKE)};
const ready = child => new Promise(r => { let b=''; child.stdout.on('data', d => { b += d; if (b.includes('\\n')) r(JSON.parse(b)); }); });
${body}`;
  const file = path.join(work, `owner-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, script);
  return spawn(process.execPath, [file], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

function collect(child) {
  return new Promise(resolve => {
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('exit', (code, signal) => resolve({ code, signal, out, err }));
  });
}

const firstLine = async child => new Promise(r => { let b = ''; child.stdout.on('data', d => { b += d; const i = b.indexOf('\n'); if (i >= 0) r(JSON.parse(b.slice(0, i))); }); });
const waitDead = async (pids, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end && pids.some(isAlive)) await new Promise(r => setTimeout(r, 50)); return pids.filter(isAlive); };
const REPORT = `const p = await ready(app); console.log(JSON.stringify({ ...p, dir: run.dir, ud: run.manifest.userDataDir }));`;

test('cleanup on success kills the whole tree, removes dirs and the manifest, and spares a same-named foreign app', async () => {
  // Control: a foreign process with the same executable name and its own profile.
  const foreignDir = path.join(work, 'foreign-profile');
  const foreign = spawn(FAKE, ['--user-data-dir=' + foreignDir], { stdio: ['ignore', 'pipe', 'ignore'] });
  const foreignPids = await firstLine(foreign);
  try {
    const o = owner(`const run = createStudioRun({ label: 'ok', secretStorage: 'inmemory' });
const app = spawnStudio(FAKE, [], { stdio: ['ignore', 'pipe', 'inherit'] }, run);
${REPORT}
await run.cleanup();`);
    const r = await collect(o);
    assert.equal(r.code, 0, r.err);
    const p = JSON.parse(r.out.trim().split('\n').at(-1));
    assert.deepEqual(await waitDead([p.app, p.child, p.helper]), []);
    assert.equal(fs.existsSync(p.dir), false, 'run dir (manifest, temp user-data, extensions) removed');
    assert.ok(p.ud.startsWith(ROOT), 'temp user-data-dir lives under the launch root');
    for (const pid of [foreignPids.app, foreignPids.child, foreignPids.helper]) assert.ok(isAlive(pid), `foreign same-named pid ${pid} survived`);
  } finally {
    for (const pid of [foreignPids.app, foreignPids.child, foreignPids.helper]) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
});

test('cleanup on failure: an uncaught error still kills the tree and removes dirs', async () => {
  const o = owner(`const run = createStudioRun({ label: 'fail', secretStorage: 'os' });
const app = spawnStudio(FAKE, [], { stdio: ['ignore', 'pipe', 'inherit'] }, run);
${REPORT}
throw new Error('test failed on purpose');`);
  const r = await collect(o);
  assert.notEqual(r.code, 0);
  const p = JSON.parse(r.out.trim().split('\n').at(-1));
  assert.deepEqual(await waitDead([p.app, p.child, p.helper]), []);
  assert.equal(fs.existsSync(p.dir), false);
});

test('cleanup on SIGTERM and SIGINT', async () => {
  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    const o = owner(`const run = createStudioRun({ label: 'sig', secretStorage: 'inmemory' });
const app = spawnStudio(FAKE, [], { stdio: ['ignore', 'pipe', 'inherit'] }, run);
${REPORT}
setInterval(() => {}, 1000);`);
    const done = collect(o);
    const p = await firstLine(o);
    o.kill(signal);
    const r = await done;
    assert.equal(r.code, code, `${signal}: ${r.err}`);
    assert.deepEqual(await waitDead([p.app, p.child, p.helper]), [], signal);
    assert.equal(fs.existsSync(p.dir), false, signal);
  }
});

test('leftover control: a directory cleanup cannot remove fails the run (and the process exit code)', async () => {
  const locked = path.join(work, 'locked');
  fs.mkdirSync(path.join(locked, 'kept'), { recursive: true });
  fs.chmodSync(locked, 0o500);
  try {
    const run = new StudioRun({ label: 'left', secretStorage: 'os' });
    run.addDir(path.join(locked, 'kept'));
    await assert.rejects(run.cleanup(), /left resources behind/);
    assert.equal(JSON.parse(fs.readFileSync(run.manifestPath, 'utf8')).status, 'leftover');
    // Same, but discovered by the exit hook of a program that never called cleanup.
    const o = owner(`const run = createStudioRun({ label: 'left-exit', secretStorage: 'os' }); run.addDir(${JSON.stringify(path.join(locked, 'kept'))});`);
    const r = await collect(o);
    assert.equal(r.code, 1, 'exit hook turns a leftover into a failing exit code');
    assert.match(r.err, /left resources behind/);
  } finally { fs.chmodSync(locked, 0o700); }
});

test('sweep cleans a crashed run (owner SIGKILLed) and never touches a run whose owner is alive', async () => {
  const crashed = owner(`const run = createStudioRun({ label: 'crash', secretStorage: 'inmemory' });
const app = spawnStudio(FAKE, [], { stdio: ['ignore', 'pipe', 'inherit'], detached: true }, run);
${REPORT}
setInterval(() => {}, 1000);`);
  const live = owner(`const run = createStudioRun({ label: 'live', secretStorage: 'inmemory' });
const app = spawnStudio(FAKE, [], { stdio: ['ignore', 'pipe', 'inherit'] }, run);
${REPORT}
setInterval(() => {}, 1000);`);
  const c = await firstLine(crashed), l = await firstLine(live);
  const liveDone = collect(live);
  crashed.kill('SIGKILL');
  await new Promise(r => crashed.on('exit', r));
  assert.ok(isAlive(c.app), 'the crashed owner left its app behind (no hook ran)');
  const report = sweep({ root: ROOT });
  assert.deepEqual(await waitDead([c.app, c.child, c.helper]), []);
  assert.equal(fs.existsSync(c.dir), false);
  assert.ok(report.cleaned.some(x => c.dir.endsWith(x.id)));
  assert.ok(report.skipped.some(x => l.dir.endsWith(x.id)), 'live owner skipped');
  assert.ok([l.app, l.child, l.helper].every(isAlive), 'live run untouched');
  live.kill('SIGTERM');
  await liveDone;
  assert.deepEqual(await waitDead([l.app, l.child, l.helper]), []);
});

test('sweep still works when the run directory root was wiped (nothing to do, no throw)', () => {
  const report = sweep({ root: path.join(work, 'missing-root') });
  assert.deepEqual(report.cleaned, []);
});

test('secret storage is explicit and consistent with the argv', () => {
  assert.throws(() => new StudioRun({ label: 'x' }), /secretStorage must be/);
  const os1 = new StudioRun({ label: 'x', secretStorage: 'os' });
  assert.throws(() => os1.args(['--use-inmemory-secretstorage']), /secretStorage 'os'/);
  os1.cleanupSync();
  const mem = new StudioRun({ label: 'x', secretStorage: 'inmemory' });
  const args = mem.args(['/ws']);
  assert.ok(args.includes('--use-inmemory-secretstorage'));
  assert.ok(args.some(a => a.startsWith('--user-data-dir=' + mem.dir)));
  assert.ok(args.some(a => a.startsWith('--extensions-dir=' + mem.dir)));
  assert.equal(args.at(-1), '/ws', 'positional folder stays last');
  mem.cleanupSync();
});

test('protected and foreign-in-use profiles are refused', async () => {
  const r = new StudioRun({ label: 'p', secretStorage: 'os' });
  assert.throws(() => r.args(['--user-data-dir=/Users/x/Library/Application Support/HypeProof Studio Development/trial-localtest-1/user-data']), /protected profile/);
  assert.throws(() => r.args(['--user-data-dir=/Users/x/CodeWorkspace/hypeproof-studio/.codex-worktrees/a/user-data']), /protected profile/);
  const busy = path.join(work, 'busy-profile');
  const foreign = spawn(FAKE, ['--user-data-dir=' + busy], { stdio: ['ignore', 'pipe', 'ignore'] });
  const pids = await firstLine(foreign);
  try { assert.throws(() => r.args(['--user-data-dir=' + busy]), /in use by pid/); }
  finally { for (const pid of Object.values(pids)) { try { process.kill(pid, 'SIGKILL'); } catch {} } }
  r.cleanupSync();
});

test('focus watcher: positive and negative controls', async () => {
  const seen = [];
  const stopA = watchFocus({ probe: () => 4242, owns: pid => pid === 4242, onViolation: v => seen.push(v), fastMs: 5, fastFor: 50 });
  await new Promise(r => setTimeout(r, 30)); stopA();
  assert.ok(seen.length > 0, 'negative control: our pid frontmost is a violation');
  const clean = [];
  const stopB = watchFocus({ probe: () => 1, owns: pid => pid === 4242, onViolation: v => clean.push(v), fastMs: 5, fastFor: 50 });
  await new Promise(r => setTimeout(r, 30)); stopB();
  assert.deepEqual(clean, [], 'positive control: another app frontmost is fine');
  const run = new StudioRun({ label: 'focus', secretStorage: 'os' });
  run.manifest.focus.violations.push({ pid: 1, at: 'now' });
  await assert.rejects(run.cleanup(), /stole focus|took focus/);
});

test('session check reports and sweeps owned dirs a suite forgot', () => {
  process.env.HPS_LAUNCH_SESSION = 'sess-test';
  const dir = createOwnedDir('hps-e2e-');
  delete process.env.HPS_LAUNCH_SESSION;
  assert.ok(dir.startsWith(ROOT));
  const problems = verifySession('sess-test', { root: ROOT });
  assert.equal(problems.length, 1);
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(verifySession('sess-test', { root: ROOT }), []);
});

test('CLI run: launches, waits, cleans up', () => {
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../studio-launch.mjs');
  const quick = path.join(work, 'quick-app');
  fs.writeFileSync(quick, '#!/usr/bin/env node\nsetTimeout(() => process.exit(0), 200);\n');
  fs.chmodSync(quick, 0o755);
  const r = spawnSync(process.execPath, [cli, 'run', '--label', 'cli', '--secret-storage', 'os', '--', quick], { encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stderr);
  const s = spawnSync(process.execPath, [cli, 'run', '--label', 'cli', '--', quick], { encoding: 'utf8', env: process.env });
  assert.notEqual(s.status, 0, 'secret storage must be explicit on the CLI too');
});
