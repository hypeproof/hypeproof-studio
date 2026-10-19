// Shared Studio test launcher. Every test or harness launch of the Studio app
// (Playwright `_electron.launch`, a raw spawn of the app binary, a shell or
// Python harness through scripts/studio-launch.mjs) goes through this module.
//
// What it guarantees, per launch ("run"):
//   - background: on macOS the app runs from a bundle marked LSUIElement (no Dock
//     icon, no activation at launch); Playwright launches are also moved
//     off-screen, made non-focusable and hidden. A focus watcher polls the
//     frontmost app and fails the run if one of its processes ever becomes
//     frontmost — the check, not an assumption.
//   - isolation: a run id, a run directory under a stable root outside
//     /private/tmp, and a temp user-data-dir/extensions-dir there unless the
//     caller passes its own.
//   - explicit secret storage: `secretStorage: 'inmemory' | 'os'` is required.
//     In-memory secrets are lost whenever the window reloads or reopens (for
//     example into a workspace folder), which makes the app claim again and looks
//     like a product bug. Use 'os' for any flow that reloads or reopens a window.
//   - cleanup on normal exit, failure, SIGINT, SIGTERM and SIGHUP: kills only the
//     processes it started — descendants of its own pids and processes whose
//     command line carries its user-data-dir or run directory — never by name. A
//     same-named app (the person's own Studio, another session's Dev app) has a
//     different user-data-dir and survives.
//   - a manifest (pids, dirs, ports, servers) so `sweep` can clean a crashed run
//     whose owner process is dead, and a leftover check that fails the run.
//
// Rule source: Jay 2026-10-19 ("테스트할때는 백그라운드로해주고, studio를 연다면 꼭
// 리소스 정리도하고"). Agent rule: AGENTS.md "Studio test launches".
import { spawn as spawnChild, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'hps-studio-launch/1';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET_SWITCHES = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const INMEMORY_FLAG = '--use-inmemory-secretstorage';

/** Stable root outside /private/tmp: a reboot or a scratchpad wipe must not orphan a manifest. */
export function launchRoot(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.HPS_LAUNCH_ROOT) return path.resolve(env.HPS_LAUNCH_ROOT);
  if (platform === 'darwin') return path.join(home, 'Library/Caches/hps-test-launches');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData/Local'), 'hps-test-launches');
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'hps-test-launches');
}

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quietEnabled = (env = process.env) => env.HPS_QUIET !== '0';

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Start time of a pid, used with the pid to tell a live owner from a reused pid. */
export function processStart(pid) {
  if (process.platform === 'win32' || !isAlive(pid)) return null;
  try { return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}

export function ownerAlive(owner) {
  if (!owner || !isAlive(owner.pid)) return false;
  if (!owner.start) return true;
  const now = processStart(owner.pid);
  return now === null || now === owner.start;
}

/** Process table snapshot: [{pid, ppid, command}]. Empty on Windows (pids only there). */
export function processTable() {
  if (process.platform === 'win32') return [];
  const out = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return out.split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map(m => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
}

function ancestorsOf(pid, table) {
  const byPid = new Map(table.map(p => [p.pid, p]));
  const out = new Set();
  for (let p = byPid.get(pid); p && !out.has(p.pid); p = byPid.get(p.ppid)) out.add(p.pid);
  return out;
}

/**
 * The processes a run owns: descendants of its recorded pids (while still
 * parented) plus any process whose command line carries the run's user-data-dir
 * or run directory (helpers reparented to launchd after the main process died).
 * Never matched by executable name. The calling process and its ancestors are
 * never included.
 */
export function ownedProcesses(manifest, table = processTable()) {
  const roots = new Set((manifest.pids || []).filter(Number.isInteger));
  const markers = [manifest.userDataDir, manifest.dir].filter(Boolean);
  const protectedPids = ancestorsOf(process.pid, table);
  const children = new Map();
  for (const p of table) { if (!children.has(p.ppid)) children.set(p.ppid, []); children.get(p.ppid).push(p); }
  const found = new Map();
  const visit = p => {
    if (found.has(p.pid) || protectedPids.has(p.pid)) return;
    found.set(p.pid, p);
    for (const c of children.get(p.pid) || []) visit(c);
  };
  const recordedCommandOk = p => {
    // A recorded pid is only trusted while it still runs the recorded executable
    // or carries a run marker; otherwise the pid was reused by something else.
    const exe = manifest.executable;
    return (exe && p.command.includes(exe)) || markers.some(m => p.command.includes(m)) || manifest.trustRecordedPids === true;
  };
  for (const p of table) {
    if (roots.has(p.pid) && recordedCommandOk(p)) visit(p);
    else if (markers.some(m => carriesMarker(p.command, m))) visit(p);
  }
  return [...found.values()];
}

function carriesMarker(command, marker) {
  // The marker must appear as a whole path, not as the prefix of a longer sibling
  // (e.g. "/x/run-1" must not match "/x/run-10").
  let i = command.indexOf(marker);
  while (i >= 0) {
    const next = command[i + marker.length];
    if (next === undefined || next === ' ' || next === '/' || next === '"' || next === "'" || next === '\\') return true;
    i = command.indexOf(marker, i + 1);
  }
  return false;
}

function killPids(pids, signal) {
  for (const pid of pids) { try { process.kill(pid, signal); } catch { /* gone */ } }
}

function windowsKillTree(pids) {
  for (const pid of pids) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
}

/** Kill everything a manifest owns: SIGTERM, wait, SIGKILL. Synchronous (safe in an exit hook). */
export function killOwnedSync(manifest, { graceMs = 3000, table } = {}) {
  if (process.platform === 'win32') { windowsKillTree((manifest.pids || []).filter(isAlive)); return []; }
  let owned = ownedProcesses(manifest, table || processTable()).map(p => p.pid);
  if (owned.length === 0) return [];
  killPids(owned, 'SIGTERM');
  const end = Date.now() + graceMs;
  while (Date.now() < end && owned.some(isAlive)) sleepSync(100);
  killPids(owned.filter(isAlive), 'SIGKILL');
  sleepSync(100);
  // Children forked during the grace period carry the markers too.
  const late = ownedProcesses(manifest).map(p => p.pid);
  killPids(late, 'SIGKILL');
  return owned;
}

export async function killOwned(manifest, { graceMs = 5000 } = {}) {
  if (process.platform === 'win32') { windowsKillTree((manifest.pids || []).filter(isAlive)); return; }
  const owned = ownedProcesses(manifest).map(p => p.pid);
  if (owned.length === 0) return;
  killPids(owned, 'SIGTERM');
  const end = Date.now() + graceMs;
  while (Date.now() < end && owned.some(isAlive)) await sleep(100);
  killPids(owned.filter(isAlive), 'SIGKILL');
  await sleep(100);
  killPids(ownedProcesses(manifest).map(p => p.pid), 'SIGKILL');
}

/** What a finished run left behind: live owned processes and directories that should be gone. */
export function leftovers(manifest) {
  const pids = process.platform === 'win32'
    ? (manifest.pids || []).filter(isAlive)
    : ownedProcesses(manifest).map(p => p.pid);
  const dirs = (manifest.ownedDirs || []).filter(d => fs.existsSync(d));
  return { pids, dirs };
}

// ── macOS: run from a background (LSUIElement) bundle ─────────────────────────

/** `/x/Foo.app/Contents/MacOS/Foo` → `/x/Foo.app`, else null. */
export function bundleOf(executable) {
  const i = executable.indexOf('.app/Contents/MacOS/');
  return i < 0 ? null : executable.slice(0, i + 4);
}

function plistFlag(bundle) {
  try { return execFileSync('plutil', ['-extract', 'LSUIElement', 'raw', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true'; } catch { return false; }
}

const PROTECTED_PROFILE_PARTS = ['/trial-localtest-', '/.codex-worktrees/'];
const PROTECTED_BUNDLE_PARTS = ['/Applications/', '/vscodium-base/', '/HypeProof Studio Development/', '/trial-localtest-', '/.codex-worktrees/'];

/**
 * Returns an executable that launches without activation. A bundle already marked
 * LSUIElement is used as is. A disposable copy (under the launch root or the temp
 * dir) is marked in place. Anything else — the installed app, the in-tree build,
 * a studio-dev state, Jay's Dev kit, a Codex worktree — is never modified: a
 * cached marked copy under the launch root is used instead.
 */
export function backgroundExecutable(executable, { root = launchRoot(), log = () => {} } = {}) {
  const bundle = bundleOf(executable);
  if (process.platform !== 'darwin' || !bundle) return executable;
  if (plistFlag(bundle)) return executable;
  const real = fs.realpathSync(bundle);
  const disposable = [root, fs.realpathSync(os.tmpdir()), '/private/tmp/'].some(base => real.startsWith(fs.existsSync(base) ? fs.realpathSync(base) : base));
  const inPlaceOk = disposable && !PROTECTED_BUNDLE_PARTS.some(p => (real + '/').includes(p));
  let target = real;
  if (!inPlaceOk) {
    // Keyed by what the app would run (shell + injected extension), so a re-prepared
    // source never runs a stale copy. APFS clones (`cp -c`) cost no extra disk.
    const key = createKey(real + '\0' + bundleFingerprint(real));
    target = path.join(root, 'apps', key, path.basename(real));
    if (!fs.existsSync(path.join(target, 'Contents/Info.plist')) || !plistFlag(target)) {
      log(`studio-launch: preparing a background (LSUIElement) copy of ${real}; the original is never modified`);
      const apps = path.join(root, 'apps');
      // One cached copy per source: drop copies of earlier builds of the same source.
      if (fs.existsSync(apps)) for (const k of fs.readdirSync(apps)) {
        const src = (() => { try { return JSON.parse(fs.readFileSync(path.join(apps, k, 'source.json'), 'utf8')).source; } catch { return null; } })();
        if (src === real && k !== key && !processTable().some(p => p.command.includes(path.join(apps, k)))) fs.rmSync(path.join(apps, k), { recursive: true, force: true });
      }
      fs.rmSync(path.dirname(target), { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { execFileSync('cp', ['-cR', real, target]); } catch { fs.rmSync(target, { recursive: true, force: true }); execFileSync('ditto', [real, target]); }
      fs.writeFileSync(path.join(path.dirname(target), 'source.json'), JSON.stringify({ source: real, preparedAt: new Date().toISOString() }));
    }
  }
  if (!plistFlag(target)) {
    execFileSync('plutil', ['-replace', 'LSUIElement', '-bool', 'true', path.join(target, 'Contents/Info.plist')]);
    try { execFileSync('codesign', ['--force', '--deep', '--sign', '-', target], { stdio: 'ignore' }); } catch { log('studio-launch: ad-hoc re-sign failed; the app may refuse to launch'); }
  }
  return path.join(target, executable.slice(bundle.length));
}

/** Stat fingerprint of what a launch runs: Info.plist, product.json, the main executable and the bundled extension. */
function bundleFingerprint(bundle) {
  const parts = [];
  const add = file => { try { const st = fs.statSync(file); parts.push(`${path.relative(bundle, file)}:${st.size}:${st.mtimeMs}`); } catch { /* absent */ } };
  const walk = dir => { let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of entries) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else add(f); } };
  add(path.join(bundle, 'Contents/Info.plist'));
  add(path.join(bundle, 'Contents/Resources/app/product.json'));
  add(path.join(bundle, 'Contents/Resources/app/package.json'));
  try { for (const e of fs.readdirSync(path.join(bundle, 'Contents/MacOS'))) add(path.join(bundle, 'Contents/MacOS', e)); } catch { /* not a bundle */ }
  walk(path.join(bundle, 'Contents/Resources/app/extensions/hypeproof-chat'));
  return parts.sort().join('\n');
}

const createKey = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

// ── focus watcher ─────────────────────────────────────────────────────────────

/** Pid of the frontmost macOS app, or null when unknown. */
export function frontmostPid() {
  if (process.platform !== 'darwin') return null;
  try {
    const asn = execFileSync('lsappinfo', ['front'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!asn) return null;
    const info = execFileSync('lsappinfo', ['info', '-only', 'pid', asn], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /"pid"\s*=\s*(\d+)/.exec(info);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

/**
 * Polls the frontmost app and records a violation when it is one of the run's
 * processes. `probe` and `owns` are injectable for the control tests.
 */
export function watchFocus({ probe = frontmostPid, owns, onViolation, fastMs = 100, fastFor = 30000, slowMs = 1000 }) {
  const started = Date.now();
  let stopped = false, timer = null;
  const tick = () => {
    if (stopped) return;
    const pid = probe();
    if (pid !== null && owns(pid)) onViolation({ pid, at: new Date().toISOString() });
    timer = setTimeout(tick, Date.now() - started < fastFor ? fastMs : slowMs);
    timer.unref?.();
  };
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/**
 * Best effort: hide the app that took focus so macOS returns it to the previous
 * app. NSRunningApplication.hide needs no Accessibility or Automation grant.
 */
export function handBackFocus(pid) {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('python3', ['-c', 'import sys,AppKit;a=AppKit.NSRunningApplication.runningApplicationWithProcessIdentifier_(int(sys.argv[1]));a and a.hide()', String(pid)], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch { return false; }
}

// ── quiet main-process hook (macOS) ──────────────────────────────────────────
//
// Measured 2026-10-19 on a real Dev app: quiet mode applied after launch lost the
// race with VS Code's first window in 4 of 9 launches (the app stayed frontmost),
// and every launch briefly activated the app ~70 ms after its first BrowserWindow
// was created, before any show()/focus() call. The packaged shell ignores a `-r`
// preload (Playwright's own loader never runs there). What works: start the main
// process paused (`--inspect-brk` on a loopback port), set the activation policy to
// 'prohibited' and patch show/focus before VS Code's code runs, then resume. A
// prohibited app cannot become active; its renderer still loads and CDP still
// captures it.

const QUIET_HOOK = (closeInspector) => `(() => {
  const { app, BrowserWindow } = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
  app.setActivationPolicy('prohibited');
  const p = BrowserWindow.prototype, showInactive = p.showInactive;
  p.show = function () { showInactive.call(this); };
  p.focus = function () {};
  p.moveTop = function () {};
  app.focus = () => {};
  app.__hpsQuietActivationHooked = true;
  app.on('did-become-active', () => { if (!globalThis.__hpsQuietReveal) { try { app.hide(); } catch {} } });
  ${closeInspector ? "setTimeout(() => { try { process.getBuiltinModule('inspector').close(); } catch {} }, 3000);" : ''}
  return 'hps-quiet-hooked';
})()`;

/** A free loopback port, synchronously (spawnStudio is synchronous). */
export function freePortSync() {
  return Number(execFileSync(process.execPath, ['-e', "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
}

/**
 * Connect to a main process started with --inspect-brk=PORT, install the quiet
 * hook before any app code runs, and resume it. Throws if it cannot; the caller
 * then kills the run (a paused app would otherwise wait forever).
 */
export async function installQuietHook(port, { closeInspector = false, timeoutMs = 30000 } = {}) {
  const end = Date.now() + timeoutMs;
  let url = null;
  while (!url && Date.now() < end) {
    try { url = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0]?.webSocketDebuggerUrl ?? null; } catch { /* not listening yet */ }
    if (!url) await sleep(50);
  }
  if (!url) throw new Error(`studio-launch: no inspector on 127.0.0.1:${port} within ${timeoutMs} ms`);
  const sock = new WebSocket(url);
  await new Promise((resolve, reject) => { sock.onopen = resolve; sock.onerror = () => reject(new Error('studio-launch: inspector connection failed')); });
  let id = 0, onPaused = null;
  const pending = new Map();
  sock.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === 'Debugger.paused') onPaused?.(d.params);
  };
  const send = (method, params = {}) => new Promise(resolve => { const i = ++id; pending.set(i, resolve); sock.send(JSON.stringify({ id: i, method, params })); });
  try {
    const paused = new Promise(resolve => { onPaused = resolve; });
    await send('Debugger.enable');
    send('Runtime.runIfWaitingForDebugger');
    const frame = await Promise.race([paused, sleep(Math.max(1000, end - Date.now())).then(() => null)]);
    if (!frame) throw new Error('studio-launch: the app did not pause at start');
    const result = await send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrames[0].callFrameId, expression: QUIET_HOOK(closeInspector) });
    const value = result.result?.result?.value;
    await send('Debugger.resume');
    await send('Debugger.disable');
    if (value !== 'hps-quiet-hooked') throw new Error(`studio-launch: quiet hook failed: ${JSON.stringify(result).slice(0, 300)}`);
  } finally {
    sock.close();
  }
}

// ── runs ──────────────────────────────────────────────────────────────────────

const active = new Set();
let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on('exit', code => {
    const failed = cleanupAllSync();
    if (failed && code === 0) process.exitCode = 1;
  });
  for (const [signal, n] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) {
    const handler = () => {
      cleanupAllSync();
      // Leave the exit to the program when it handles the signal itself.
      if (process.listenerCount(signal) <= 1) process.exit(128 + n);
    };
    process.on(signal, handler);
  }
}

/** Synchronous cleanup of every active run; returns true when anything was left behind. */
export function cleanupAllSync() {
  let failed = false;
  for (const run of [...active]) {
    try { run.cleanupSync(); } catch (e) { failed = true; process.stderr.write(`studio-launch: ${e.message}\n`); }
  }
  return failed;
}

function argValue(args, flag) {
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === flag) return { index: i, value: String(args[i + 1]), form: 'pair' };
    if (a.startsWith(flag + '=')) return { index: i, value: a.slice(flag.length + 1), form: 'eq' };
  }
  return null;
}

function realDataFolders(home = os.homedir()) {
  return [path.join(home, 'Library/Application Support/HypeProof Studio'), path.join(home, 'Library/Application Support/HypeProof-Studio'), path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), 'HypeProof Studio')];
}

export class StudioRun {
  constructor({ label = 'studio', secretStorage, quiet = 'offscreen', foreground = false, foregroundOptIn = false, interactive = false, root = launchRoot(), session = process.env.HPS_LAUNCH_SESSION || null, focusCheck = process.env.HPS_LAUNCH_FOCUS_CHECK !== '0', log = m => process.stderr.write(m + '\n') } = {}) {
    if (secretStorage !== 'inmemory' && secretStorage !== 'os') {
      throw new Error("studio-launch: secretStorage must be 'inmemory' or 'os'. In-memory secrets are lost when the window reloads or reopens; use 'os' for those flows.");
    }
    if (!['offscreen', 'caller'].includes(quiet)) throw new Error("studio-launch: quiet must be 'offscreen' or 'caller'");
    // interactive: a person works in this window (a dev host). It is visible and
    // focusable by design, but still tracked and cleaned up.
    if (interactive) foreground = true;
    // foregroundOptIn: the caller already demanded an explicit operator opt-in
    // (e.g. feedback-native's --allow-foreground for a dedicated UI slot).
    else if (foreground && !(foregroundOptIn || process.env.HPS_LAUNCH_ALLOW_FOREGROUND === '1' || process.env.CI === 'true')) {
      throw new Error('studio-launch: this launch needs real window focus. Run it only while nobody is using the machine, with HPS_LAUNCH_ALLOW_FOREGROUND=1 (or in CI).');
    }
    const safeLabel = String(label).replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 24) || 'studio';
    this.id = `${safeLabel}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    this.root = root;
    fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
    this.dir = path.join(fs.realpathSync(path.join(root, 'runs')), this.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.log = log;
    this.focusCheck = focusCheck && !foreground && process.platform === 'darwin';
    // The pre-start hook (see installQuietHook); HPS_LAUNCH_QUIET_HOOK=0 opts out.
    // Enabled by executable() once the target is known to be an app bundle (Electron).
    this.quietHookAllowed = process.platform === 'darwin' && quietEnabled() && !foreground && quiet === 'offscreen' && process.env.HPS_LAUNCH_QUIET_HOOK !== '0';
    this.quietHook = false;
    this.inspectPort = null;
    this.stopFocus = null;
    this.servers = [];
    this.closed = false;
    this.manifest = {
      format: FORMAT, id: this.id, label: safeLabel, session, dir: this.dir,
      owner: { pid: process.pid, start: processStart(process.pid), argv: process.argv.slice(1, 3) },
      createdAt: new Date().toISOString(), secretStorage, quiet, foreground: !!foreground, interactive: !!interactive,
      executable: null, userDataDir: null, extensionsDir: null, ownedDirs: [this.dir], callerDirs: [],
      pids: [], ports: [], servers: [], focus: { checked: this.focusCheck, violations: [] }, status: 'running',
    };
    this.save();
    active.add(this);
    installHooks();
  }

  get manifestPath() { return path.join(this.dir, 'manifest.json'); }
  save() { if (fs.existsSync(this.dir)) fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2)); }

  /** Executable to launch: the background bundle on macOS unless the run needs focus. */
  executable(executable) {
    const exe = this.manifest.foreground ? executable : backgroundExecutable(executable, { root: this.root, log: this.log });
    this.manifest.executable = bundleOf(exe) || exe;
    this.quietHook = this.quietHookAllowed && !!bundleOf(exe);
    this.save();
    return exe;
  }

  /** Inject isolation, secret-storage and quiet switches into a Studio argv. */
  args(input = []) {
    const args = [...input].map(String);
    const real = realDataFolders();
    const ud = argValue(args, '--user-data-dir');
    if (ud) {
      const dir = path.resolve(ud.value);
      if (real.some(r => dir === r)) throw new Error(`studio-launch: refusing the real Studio data folder ${dir}`);
      if (PROTECTED_PROFILE_PARTS.some(p => (dir + '/').includes(p))) throw new Error(`studio-launch: refusing a protected profile ${dir} (Jay's Dev kit or a Codex worktree)`);
      const table = processTable(), mine = ancestorsOf(process.pid, table);
      const ours = new Set([...active].flatMap(r => ownedProcesses(r.manifest, table).map(p => p.pid)));
      const users = table.filter(p => carriesMarker(p.command, dir) && !mine.has(p.pid) && !ours.has(p.pid));
      if (users.length) throw new Error(`studio-launch: profile ${dir} is in use by pid ${users.map(p => p.pid).join(',')}, which this run did not start. Quit it or use another profile.`);
      this.manifest.userDataDir = dir;
      this.manifest.callerDirs.push(dir);
    } else {
      this.manifest.userDataDir = path.join(this.dir, 'user-data');
      fs.mkdirSync(this.manifest.userDataDir, { recursive: true });
      args.unshift('--user-data-dir=' + this.manifest.userDataDir);
    }
    const ed = argValue(args, '--extensions-dir');
    if (ed) { this.manifest.extensionsDir = path.resolve(ed.value); this.manifest.callerDirs.push(this.manifest.extensionsDir); }
    else {
      this.manifest.extensionsDir = path.join(this.dir, 'extensions');
      fs.mkdirSync(this.manifest.extensionsDir, { recursive: true });
      args.splice(1, 0, '--extensions-dir=' + this.manifest.extensionsDir);
    }
    const hasInMemory = args.includes(INMEMORY_FLAG);
    if (this.manifest.secretStorage === 'os' && hasInMemory) throw new Error(`studio-launch: secretStorage 'os' but ${INMEMORY_FLAG} was passed`);
    if (this.manifest.secretStorage === 'inmemory' && !hasInMemory) args.splice(2, 0, INMEMORY_FLAG);
    if (quietEnabled() && !this.manifest.foreground) for (const s of QUIET_SWITCHES) if (!args.includes(s)) args.splice(2, 0, s);
    if (this.quietHook && !args.some(a => /^--inspect(?:-brk)?(?:=|$)|^--inspect-port/.test(a))) {
      this.inspectPort = freePortSync();
      args.unshift('--inspect-brk=' + this.inspectPort);
    }
    for (const a of args) { const m = /^--(?:remote-debugging-port|inspect-brk)=(\d+)$/.exec(a); if (m && m[1] !== '0') this.manifest.ports.push(Number(m[1])); }
    this.save();
    return args;
  }

  addPid(pid) {
    if (Number.isInteger(pid) && !this.manifest.pids.includes(pid)) { this.manifest.pids.push(pid); this.save(); this.startFocusWatch(); }
  }

  /** Register a server the run started: a pid, a ChildProcess, or an object with close(). */
  addServer(server, name = 'server') {
    this.servers.push(server);
    const pid = typeof server === 'number' ? server : server?.pid;
    this.manifest.servers.push({ name, pid: Number.isInteger(pid) ? pid : null });
    if (Number.isInteger(pid)) this.manifest.pids.push(pid);
    this.save();
  }

  /** A directory the run should remove at cleanup. */
  addDir(dir) { this.manifest.ownedDirs.push(path.resolve(dir)); this.save(); }

  owns(pid) {
    if (this.manifest.pids.includes(pid)) return true;
    if (this.notOwned?.has(pid)) return false;
    let owned = false;
    try { owned = ownedProcesses(this.manifest).some(p => p.pid === pid); } catch { /* unknown */ }
    // A foreign frontmost app (the person's browser) stays foreign; skip the ps scan next time.
    if (!owned) (this.notOwned ??= new Set()).add(pid);
    return owned;
  }

  startFocusWatch() {
    if (!this.focusCheck || this.stopFocus) return;
    this.stopFocus = watchFocus({
      owns: pid => this.owns(pid),
      onViolation: v => {
        handBackFocus(v.pid);
        if (this.manifest.focus.violations.length < 20) this.manifest.focus.violations.push(v);
        this.save();
        this.log(`studio-launch: run ${this.id} took focus (pid ${v.pid})`);
      },
    });
  }

  async stopServers() {
    for (const s of this.servers) {
      try {
        if (typeof s?.close === 'function') await s.close();
        else if (typeof s?.kill === 'function') s.kill('SIGTERM');
        else if (Number.isInteger(s)) process.kill(s, 'SIGTERM');
      } catch { /* already gone */ }
    }
  }

  finish() {
    this.stopFocus?.();
    this.stopFocus = null;
    const left = leftovers(this.manifest);
    for (const d of this.manifest.ownedDirs) if (!left.pids.length) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* reported below */ } }
    const after = leftovers(this.manifest);
    const violations = this.manifest.focus.violations;
    active.delete(this);
    this.closed = true;
    if (after.pids.length || after.dirs.length || violations.length) {
      this.manifest.status = 'leftover';
      this.manifest.leftovers = after;
      fs.mkdirSync(this.dir, { recursive: true });
      this.save();
      const parts = [];
      if (after.pids.length) parts.push(`live pids ${after.pids.join(',')}`);
      if (after.dirs.length) parts.push(`dirs ${after.dirs.join(', ')}`);
      if (violations.length) parts.push(`took focus ${violations.length}x (pid ${violations[0].pid})`);
      throw new Error(`studio-launch: run ${this.id} left resources behind or stole focus: ${parts.join('; ')}. Manifest: ${this.manifestPath}`);
    }
  }

  /** Stop servers, kill the run's process tree, remove its dirs, verify. Throws on leftovers. */
  async cleanup() {
    if (this.closed) return;
    await this.stopServers();
    await killOwned(this.manifest);
    this.finish();
  }

  cleanupSync() {
    if (this.closed) return;
    for (const s of this.servers) {
      try { if (typeof s?.kill === 'function') s.kill('SIGKILL'); else if (Number.isInteger(s)) process.kill(s, 'SIGKILL'); } catch { /* gone */ }
    }
    killOwnedSync(this.manifest);
    this.finish();
  }
}

export function createStudioRun(meta) { return new StudioRun(meta); }

// ── Playwright Electron ───────────────────────────────────────────────────────

const STARTUP_EVALUATION_ATTEMPTS = 4;

async function evaluateDuringStartup(evaluate) {
  for (let attempt = 1; ; attempt++) {
    try { return await evaluate(); } catch (error) {
      if (!(error instanceof Error && /Execution context was destroyed/i.test(error.message)) || attempt >= STARTUP_EVALUATION_ATTEMPTS) throw error;
      await sleep(100 * attempt);
    }
  }
}

/**
 * Quiet mode in the Electron main process: no Dock icon, every window
 * off-screen, non-focusable and shown inactive, re-applied on `show` /
 * `ready-to-show` because VS Code re-centers its window after creation.
 * The window stays shown, so the renderer is not occlusion-throttled.
 */
export async function applyQuietMode(app) {
  if (!quietEnabled()) return;
  await evaluateDuringStartup(() => app.evaluate(({ app: electronApp, BrowserWindow }) => {
    // Fallback when the pre-start hook (installQuietHook) is off: it runs after
    // launch, so VS Code may already have activated the app; the focus watcher
    // reports that. With the hook the app is already 'prohibited' and this block is
    // skipped: dock.hide() or an 'accessory' policy would make it activatable again
    // (measured: a ~100 ms activation right after such a call).
    if (!electronApp.__hpsQuietActivationHooked) {
      electronApp.__hpsQuietActivationHooked = true;
      const proto = BrowserWindow.prototype;
      const showInactive = proto.showInactive;
      proto.show = function () { showInactive.call(this); };
      proto.focus = function () { /* quiet mode: never activate */ };
      proto.moveTop = function () { /* quiet mode: never raise */ };
      electronApp.focus = () => { /* quiet mode: never steal focus */ };
      try { electronApp.dock?.hide(); } catch { /* non-macOS */ }
      try { electronApp.setActivationPolicy?.('accessory'); } catch { /* non-macOS */ }
      electronApp.on('did-become-active', () => { if (!globalThis.__hpsQuietReveal) { try { electronApp.hide?.(); } catch { /* ignore */ } } });
      // The packaged shell ignores Playwright's `-r` loader, so VS Code may already
      // have activated the app before this runs: hand focus back now.
      try { electronApp.hide?.(); } catch { /* non-macOS */ }
    }
    // macOS clamps -4000 to keep a sliver of the window on a display, so the
    // window is also fully transparent and click-through. CDP drives and
    // captures the renderer directly; neither needs an opaque OS window.
    const stash = w => { try { w.setFocusable(false); w.setPosition(-4000, -4000); w.setOpacity?.(0); w.setIgnoreMouseEvents?.(true); w.showInactive?.(); } catch { /* torn down */ } };
    const wire = w => {
      stash(w);
      if (w.__hpsQuietModeWired) return;
      try { w.once?.('ready-to-show', () => stash(w)); w.on?.('show', () => stash(w)); w.__hpsQuietModeWired = true; } catch { /* ignore */ }
    };
    for (const w of BrowserWindow.getAllWindows()) wire(w);
    if (!electronApp.__hpsQuietModeHooked) { electronApp.on('browser-window-created', (_e, w) => wire(w)); electronApp.__hpsQuietModeHooked = true; }
  }));
}

/** After the workbench is ready: hide the app so macOS keeps focus where it was. */
export async function hideStudioApp(app) {
  if (!quietEnabled() || process.env.HPS_QUIET_NO_HIDE === '1') return;
  await app.evaluate(({ app: electronApp }) => { try { electronApp.hide?.(); } catch { /* non-macOS */ } });
}

/**
 * Drop-in for `electron.launch(options)`: `launchStudio(electron, options, meta)`.
 * `app.close()` also cleans the run up; the run is `app.hpsRun`.
 */
export async function launchStudio(electron, options, meta) {
  const run = createStudioRun(meta);
  let app;
  try {
    const executablePath = run.executable(options.executablePath);
    const args = run.args(options.args || []);
    run.startFocusWatch();
    const launching = electron.launch({ ...options, executablePath, args });
    if (run.inspectPort) {
      // The main process waits paused until the hook resumes it; Playwright's launch resolves after that.
      const hooked = installQuietHook(run.inspectPort);
      launching.catch(() => {});
      await hooked;
    }
    app = await launching;
    run.addPid(app.process()?.pid);
    if (run.manifest.quiet === 'offscreen' && !run.manifest.foreground) await applyQuietMode(app);
  } catch (error) {
    try { if (app) await app.close(); } catch { /* cleaning up below */ }
    try { await run.cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], `${error.message}; ${cleanupError.message}`); }
    throw error;
  }
  const close = app.close.bind(app);
  app.close = async () => {
    try { await close(); } finally { await run.cleanup(); }
  };
  Object.defineProperty(app, 'hpsRun', { value: run });
  return app;
}

/**
 * Drop-in for `spawn(binary, args, options)`: `spawnStudio(binary, args, options, meta)`.
 * The run outlives the child (tests relaunch on the same profile); it is cleaned
 * up by `child.hpsRun.cleanup()` or at process exit / signal.
 */
export function spawnStudio(binary, args, options = {}, meta) {
  const run = meta instanceof StudioRun ? meta : createStudioRun(meta);
  const exe = run.executable(binary);
  const argv = run.args(args);
  run.startFocusWatch();
  const child = spawnChild(exe, argv, options);
  run.addPid(child.pid);
  Object.defineProperty(child, 'hpsRun', { value: run });
  // Resolves once the app runs with the quiet hook (immediately without one).
  const quiet = run.inspectPort
    ? installQuietHook(run.inspectPort, { closeInspector: true }).catch(error => {
      run.log(`${error.message}; stopping run ${run.id}`);
      run.cleanupSync();
      throw error;
    })
    : Promise.resolve();
  quiet.catch(() => {});
  Object.defineProperty(child, 'hpsQuiet', { value: quiet });
  return child;
}

// ── owned directories (for fixtures that seed a profile before launch) ───────

/** A directory under the launch root with an owner sidecar, so `sweep` can remove it after a crash. */
export function createOwnedDir(prefix = 'hps-e2e-', root = launchRoot()) {
  const base = path.join(root, 'dirs');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(base, prefix)));
  fs.writeFileSync(dir + '.owner.json', JSON.stringify({ format: FORMAT, dir, session: process.env.HPS_LAUNCH_SESSION || null, owner: { pid: process.pid, start: processStart(process.pid) } }));
  return dir;
}

export function ownedDirRoot(root = launchRoot()) { return path.join(root, 'dirs'); }

export function removeOwnedDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir + '.owner.json', { force: true });
}

// ── sweep and session check ───────────────────────────────────────────────────

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

export function listRuns(root = launchRoot()) {
  const runs = path.join(root, 'runs');
  if (!fs.existsSync(runs)) return [];
  return fs.readdirSync(runs).map(id => ({ id, dir: path.join(runs, id), manifest: readJson(path.join(runs, id, 'manifest.json')) }));
}

/**
 * Clean runs whose owner process is dead (or every run owned by a process in
 * `ownerTree`). Runs with a live owner are never touched. A run directory
 * without a manifest is removed once no process carries its path and it is
 * older than `orphanAgeMs`. `apps: true` also removes unused cached background copies.
 */
export function sweep({ root = launchRoot(), dryRun = false, ownerTree = null, orphanAgeMs = 3600_000, apps = false, log = () => {} } = {}) {
  const table = processTable();
  const tree = ownerTree ? descendantsOf(ownerTree, table) : null;
  const report = { cleaned: [], skipped: [], failed: [], dirs: [], apps: [] };
  // Cached background copies are reused across runs; remove them only on request and only when unused.
  if (apps && fs.existsSync(path.join(root, 'apps'))) for (const key of fs.readdirSync(path.join(root, 'apps'))) {
    const dir = path.join(root, 'apps', key);
    if (table.some(p => p.command.includes(dir))) { report.skipped.push({ id: dir, reason: 'app copy in use' }); continue; }
    if (!dryRun) fs.rmSync(dir, { recursive: true, force: true });
    report.apps.push(dir);
  }
  for (const { id, dir, manifest } of listRuns(root)) {
    if (!manifest) {
      const age = Date.now() - fs.statSync(dir).mtimeMs;
      const used = table.some(p => carriesMarker(p.command, dir));
      if (age > orphanAgeMs && !used) { if (!dryRun) fs.rmSync(dir, { recursive: true, force: true }); report.cleaned.push({ id, orphan: true }); }
      else report.skipped.push({ id, reason: 'no manifest yet' });
      continue;
    }
    const forced = tree && tree.has(manifest.owner?.pid);
    if (!forced && ownerAlive(manifest.owner)) { report.skipped.push({ id, reason: `owner ${manifest.owner.pid} alive` }); continue; }
    const owned = ownedProcesses(manifest, table).map(p => p.pid);
    log(`sweep ${id}: ${owned.length} process(es), dirs ${manifest.ownedDirs.join(', ')}`);
    if (dryRun) { report.cleaned.push({ id, pids: owned, dryRun: true }); continue; }
    killOwnedSync(manifest, { table });
    for (const d of manifest.ownedDirs || []) fs.rmSync(d, { recursive: true, force: true });
    const left = leftovers(manifest);
    if (left.pids.length || left.dirs.length) report.failed.push({ id, ...left });
    else report.cleaned.push({ id, pids: owned, session: manifest.session });
  }
  const dirs = ownedDirRoot(root);
  if (fs.existsSync(dirs)) for (const name of fs.readdirSync(dirs).filter(n => n.endsWith('.owner.json'))) {
    const side = readJson(path.join(dirs, name));
    const dir = path.join(dirs, name.slice(0, -'.owner.json'.length));
    if (side && ownerAlive(side.owner) && !(tree && tree.has(side.owner.pid))) continue;
    if (table.some(p => carriesMarker(p.command, dir))) { report.failed.push({ id: dir, reason: 'still in use' }); continue; }
    if (!dryRun) removeOwnedDir(dir);
    report.dirs.push({ dir, session: side?.session ?? null });
  }
  return report;
}

function descendantsOf(pid, table) {
  const out = new Set([pid]);
  let grew = true;
  while (grew) { grew = false; for (const p of table) if (out.has(p.ppid) && !out.has(p.pid)) { out.add(p.pid); grew = true; } }
  return out;
}

/**
 * End-of-suite check: every run and owned dir of `session` must already be gone.
 * Anything still there is swept and reported; the caller fails the suite.
 */
export function verifySession(session, { root = launchRoot() } = {}) {
  const problems = [];
  for (const { id, manifest } of listRuns(root)) {
    if (manifest?.session !== session) continue;
    const left = leftovers(manifest);
    problems.push(`${id}: status ${manifest.status}${left.pids.length ? ', live pids ' + left.pids.join(',') : ''}${manifest.focus?.violations?.length ? ', took focus' : ''}`);
  }
  const dirs = ownedDirRoot(root);
  if (fs.existsSync(dirs)) for (const name of fs.readdirSync(dirs).filter(n => n.endsWith('.owner.json'))) {
    const side = readJson(path.join(dirs, name));
    if (side?.session === session) problems.push(`owned dir not removed: ${side.dir}`);
  }
  if (problems.length) {
    // Owners are finished by now: clean what they left, then report it.
    for (const { manifest } of listRuns(root)) if (manifest?.session === session) { killOwnedSync(manifest); for (const d of manifest.ownedDirs || []) fs.rmSync(d, { recursive: true, force: true }); }
    if (fs.existsSync(dirs)) for (const name of fs.readdirSync(dirs).filter(n => n.endsWith('.owner.json'))) {
      const side = readJson(path.join(dirs, name));
      if (side?.session === session) removeOwnedDir(path.join(dirs, name.slice(0, -'.owner.json'.length)));
    }
  }
  return problems;
}

export function newSessionId() { return `s-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`; }

export const _internal = { carriesMarker, argValue, REPO };
