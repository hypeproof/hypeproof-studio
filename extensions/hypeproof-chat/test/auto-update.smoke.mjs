// #3411 — automatic updates without a click. Exercises the pure policy, the staged
// relaunch record, and the real bundled updateChecker (background staging, scheduler
// fallback, idle restart) with only OS processes, network bytes and VS Code UI stubbed.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import {
  idleApplyBlocker, shouldStageInBackground, draftHasContent, autoUpdateNoticeAction, autoUpdateAppliedCopy,
  WindowPresence, IDLE_APPLY_AFTER_MS, PRESENCE_STALE_MS, AUTO_UPDATE_CHECK_INTERVAL_MS, AUTO_UPDATE_NOTICE_KEY,
} from '../src/autoUpdate.ts';
import { StagedUpdate } from '../src/stagedUpdate.ts';
import { compareVersions } from '../src/updateCheckerHelpers.ts';

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-auto-update-'));
const flush = () => new Promise(resolve => setImmediate(resolve));

try {
  // ---- 1. Idle policy. Positive control first: a fully idle, long-unfocused single window applies.
  const idle = {
    autoUpdate: true, staged: true, turnRunning: false, queuedUnsent: false, unsentDraft: false, processRunning: false,
    previewRunning: false, classHeld: false, otherWindows: 0, windowFocused: false, unfocusedMs: IDLE_APPLY_AFTER_MS, chatIdleMs: IDLE_APPLY_AFTER_MS,
  };
  assert.equal(idleApplyBlocker(idle), null, 'positive control: nothing to interrupt → apply');
  const negatives = {
    autoUpdate: [false, 'auto-update-off'], staged: [false, 'nothing-staged'], classHeld: [true, 'class'], turnRunning: [true, 'turn'],
    queuedUnsent: [true, 'queued'], unsentDraft: [true, 'draft'], processRunning: [true, 'process'], previewRunning: [true, 'preview'],
    otherWindows: [1, 'other-window'], windowFocused: [true, 'focused'], unfocusedMs: [IDLE_APPLY_AFTER_MS - 1, 'recently-used'],
    chatIdleMs: [IDLE_APPLY_AFTER_MS - 1, 'recently-used'],
  };
  for (const [key, [value, reason]] of Object.entries(negatives)) {
    assert.equal(idleApplyBlocker({ ...idle, [key]: value }), reason, `${key} blocks the idle restart`);
  }
  // Never mid-turn: a running turn blocks whatever else is true, including hours in the background.
  for (const unfocusedMs of [0, IDLE_APPLY_AFTER_MS, 24 * 3600_000]) for (const windowFocused of [false, true]) {
    assert.notEqual(idleApplyBlocker({ ...idle, turnRunning: true, unfocusedMs, chatIdleMs: unfocusedMs, windowFocused }), null);
  }
  assert.equal(idleApplyBlocker({ ...idle, unfocusedMs: NaN }), 'recently-used', 'an unknown duration never counts as idle');

  assert.equal(shouldStageInBackground({ autoUpdate: true, classHeld: false, available: true, version: '0.1.51', stagedVersion: null }), true);
  assert.equal(shouldStageInBackground({ autoUpdate: false, classHeld: false, available: true, version: '0.1.51', stagedVersion: null }), false);
  assert.equal(shouldStageInBackground({ autoUpdate: true, classHeld: true, available: true, version: '0.1.51', stagedVersion: null }), false, 'class seat downloads nothing');
  assert.equal(shouldStageInBackground({ autoUpdate: true, classHeld: false, available: true, version: '0.1.51', stagedVersion: '0.1.51' }), false, 'already staged');
  assert.equal(shouldStageInBackground({ autoUpdate: true, classHeld: false, available: true, version: '0.1.52', stagedVersion: '0.1.51' }), true, 'a newer release replaces the stage');

  assert.equal(draftHasContent({ text: '', images: [], queued: null }), false);
  assert.equal(draftHasContent({ text: '  \n', images: [], queued: null, toolMode: 'auto' }), false);
  for (const draft of [{ text: '안녕', images: [], queued: null }, { text: '', images: ['data:image/png;base64,AA'], queued: null },
    { text: '', images: [], queued: '다음 질문' }, { text: '', images: [], queued: null, inlineEdit: { messageId: 'm', text: '', images: [] } },
    { text: '', images: [], queued: null, recovered: [{ text: 'x', toolMode: 'auto', images: [] }] }]) {
    assert.equal(draftHasContent(draft), true, JSON.stringify(draft));
  }

  const notice = { version: '2026.1103.0', releaseUrl: 'https://github.com/hypeproof/hypeproof-studio/releases/tag/v2026.1103.0' };
  assert.equal(autoUpdateNoticeAction(undefined, '2026.1103.0', compareVersions), 'none');
  assert.equal(autoUpdateNoticeAction(notice, '2026.1103.0', compareVersions), 'show');
  assert.equal(autoUpdateNoticeAction(notice, '2026.1104.0', compareVersions), 'show');
  assert.equal(autoUpdateNoticeAction(notice, '2026.1102.2', compareVersions), 'keep', 'not applied yet: say nothing');
  assert.equal(autoUpdateNoticeAction({ ...notice, releaseUrl: 'javascript:alert(1)' }, '2026.1103.0', compareVersions), 'drop');
  assert.equal(autoUpdateAppliedCopy('2026.1103.0'), 'Studio를 v2026.1103.0(으)로 자동 업데이트했어요.');
  assert.equal(AUTO_UPDATE_CHECK_INTERVAL_MS, 4 * 3600_000);
  console.log('PASS idle policy (positive control + every blocker, never mid-turn), staging gate, draft content, notice');

  // ---- 2. Window registry: self excluded, fresh counted, stale removed.
  {
    const dir = path.join(root, 'presence');
    const me = new WindowPresence(dir, 'me'), other = new WindowPresence(dir, 'other');
    assert.equal(me.others(1000), 0, 'missing registry: no other window');
    me.beat(1000); other.beat(1000);
    assert.equal(me.others(1000 + 1), 1);
    assert.equal(me.others(1000 + PRESENCE_STALE_MS + 1), 0, 'a crashed window ages out');
    assert.equal(fs.existsSync(path.join(dir, 'other.json')), false);
    fs.writeFileSync(path.join(dir, 'garbled.json'), '{');
    assert.equal(me.others(2000), 1, 'an unreadable record counts as a window');
    fs.rmSync(path.join(dir, 'garbled.json'));
    me.dispose(); assert.equal(fs.existsSync(path.join(dir, 'me.json')), false);
    console.log('PASS window presence registry');
  }

  // ---- 3. Staged record: the idle relaunch script is fingerprinted and chosen only on request.
  {
    const dir = path.join(root, 'stage');
    fs.mkdirSync(dir, { recursive: true });
    const quit = path.join(dir, 'quit.sh'), idleScript = path.join(dir, 'idle.sh'), app = path.join(dir, 'new.app');
    fs.writeFileSync(quit, 'quit'); fs.writeFileSync(idleScript, 'idle'); fs.mkdirSync(app); fs.writeFileSync(path.join(app, 'v'), '1');
    const staged = new StagedUpdate(path.join(dir, 'store'));
    staged.stage('darwin', quit, [app], '0.1.51', idleScript);
    assert.equal(staged.stagedVersion(), '0.1.51');
    const launched = [];
    const launch = async (_p, script) => { launched.push(script); return 2147483647; };
    assert.equal(await staged.install(() => false, () => true, launch, { relaunch: true }), false, 'busy: nothing launched');
    assert.equal(staged.stagedVersion(), '0.1.51', 'busy keeps the stage');
    assert.equal(await staged.install(() => true, () => true, launch, { relaunch: true }), true);
    assert.deepEqual(launched, [idleScript], 'idle restart launches the relaunching installer');
    assert.equal(staged.stagedVersion(), null, 'consumed once');
    // A record without a relaunch script (staged by an older build) stays for the quit hook.
    const legacy = new StagedUpdate(path.join(dir, 'legacy'));
    fs.rmSync(path.join(dir, 'legacy', 'handoff'), { recursive: true, force: true });
    legacy.stage('darwin', quit, [app], '0.1.51');
    assert.equal(await legacy.install(() => true, () => true, launch, { relaunch: true }), false);
    assert.equal(legacy.stagedVersion(), '0.1.51');
    // A changed relaunch script is refused like any other changed artifact.
    const tampered = new StagedUpdate(path.join(dir, 'tampered'));
    tampered.stage('darwin', quit, [app], '0.1.51', idleScript);
    fs.appendFileSync(idleScript, ' changed');
    await assert.rejects(tampered.install(() => true, () => true, launch, { relaunch: true }), /changed/);
    assert.equal(launched.length, 1);
    console.log('PASS staged relaunch record');
  }

  // ---- 4. Real updater bundle: background staging, scheduler fallback, idle restart.
  const bundle = await build({ entryPoints: ['src/updateChecker.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] });
  for (const platform of ['darwin', 'win32']) {
    const dir = path.join(root, platform); fs.mkdirSync(dir, { recursive: true });
    const app = path.join(dir, 'Studio.app');
    const pkg = path.join(app, 'Contents/Resources/app/extensions/hypeproof-chat/package.json');
    fs.mkdirSync(path.dirname(pkg), { recursive: true }); fs.writeFileSync(pkg, JSON.stringify({ version: '0.1.50' }));
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.copyFileSync(pkg, path.join(dir, 'package.json')); // Windows reads <dist>/../package.json
    const state = new Map();
    const context = { globalStorageUri: { fsPath: path.join(dir, 'storage') }, globalState: { get: (k, d) => state.has(k) ? state.get(k) : d, update: async (k, v) => { if (v === undefined) state.delete(k); else state.set(k, v); } } };
    const spawned = [], commands = [], notices = [], opened = [], timers = [];
    let downloaded;
    const bytes = Buffer.from('fixture verified archive bytes');
    const info = { available: true, sizeBytes: bytes.length, version: '0.1.51', releaseUrl: 'https://github.com/hypeproof/hypeproof-studio-releases/releases/tag/v0.1.51', downloadUrl: 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/assets/123', digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') };
    const vscode = {
      ProgressLocation: { Notification: 1 },
      Uri: { parse: s => ({ toString: () => s }) },
      env: { openExternal: async uri => { opened.push(uri.toString()); return true; } },
      workspace: { getConfiguration: () => ({ get: (_k, d) => d }) },
      window: {
        withProgress: async () => { throw new Error('background staging must not show progress'); },
        showWarningMessage: async m => { notices.push(m); },
        showInformationMessage: async (m, ...rest) => { notices.push(m); if (rest[0]?.modal) throw new Error('no modal in automatic updates'); return rest.at(-1); },
      },
      commands: { executeCommand: async c => { commands.push(c); } },
    };
    const cp = {
      execSync: command => {
        if (!command.startsWith('unzip')) return;
        const next = path.join(path.dirname(downloaded), 'new.app'); fs.mkdirSync(next); fs.writeFileSync(path.join(next, 'version'), info.version);
      },
      execFile: () => { throw new Error('No external credentials in tests'); },
      spawn: (exe, args) => {
        spawned.push({ exe, args }); const child = new EventEmitter(); child.unref = () => {}; child.pid = 2147483647;
        queueMicrotask(() => child.emit('spawn')); return child;
      },
    };
    const fsProxy = { ...fs, createWriteStream: (file, ...args) => { downloaded = file; return fs.createWriteStream(file, ...args); } };
    const processStub = { ...process, platform, arch: platform === 'darwin' ? 'arm64' : 'x64', execPath: path.join(app, 'Contents/MacOS/Studio'), env: { HPS_RELEASE_TOKEN: 'fixture' } };
    const vmFetch = { current: async () => new Response(bytes) };
    const module = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, {
      module, exports: module.exports, require: id => id === 'vscode' ? vscode : id === 'child_process' ? cp : ['fs', 'node:fs'].includes(id) ? fsProxy : id === 'os' ? { ...os, homedir: () => dir, tmpdir: () => dir } : require(id),
      __dirname: path.join(dir, 'dist'), process: processStub, console, Buffer, URL, AbortSignal, AbortController, TextEncoder, TextDecoder,
      fetch: (...args) => vmFetch.current(...args),
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 0; }, clearTimeout() {},
      setInterval: (fn, ms) => { timers.push({ fn, ms, interval: true }); return 0; }, clearInterval() {},
    });
    const { stageUpdateInBackground, stagedUpdateVersion, applyStagedUpdateNow, announceAutoUpdate, scheduleIdleApply, scheduleUpdateChecks, installStagedUpdate } = module.exports;

    // 4a. Silent background staging: no progress, no modal, no installer, no quit.
    assert.equal(await stageUpdateInBackground(info, context), true);
    assert.deepEqual(spawned, []); assert.deepEqual(commands, []); assert.deepEqual(notices, [], 'staging says nothing');
    assert.equal(stagedUpdateVersion(context), '0.1.51');
    assert.deepEqual(JSON.parse(JSON.stringify(state.get(AUTO_UPDATE_NOTICE_KEY))), { version: '0.1.51', releaseUrl: info.releaseUrl });

    // 4b. Idle restart through the real scheduler: a running turn never applies, however long idle.
    let now = 1_000_000, focused = false, focusListener;
    const activity = { turnRunning: true, queuedUnsent: false, unsentDraft: false, processRunning: false, previewRunning: false, classHeld: false, chatIdleMs: 0 };
    const presence = new WindowPresence(path.join(dir, 'windows'), 'me');
    const scheduler = scheduleIdleApply({
      context, autoUpdate: () => true, activity: () => ({ ...activity }), windowFocused: () => focused,
      onFocusChange: l => { focusListener = l; return { dispose() {} }; }, presence, now: () => now,
    });
    for (let minute = 0; minute < 6 * 60; minute += 30) {
      now += 30 * 60_000; activity.chatIdleMs += 30 * 60_000;
      assert.equal(await scheduler.tick(), false, 'never mid-turn');
    }
    assert.deepEqual(spawned, [], 'no installer during a turn'); assert.deepEqual(commands, []);
    // The turn ends, but the learner left an unsent draft: still nothing.
    activity.turnRunning = false; activity.unsentDraft = true;
    assert.equal(await scheduler.tick(), false); assert.deepEqual(spawned, []);
    activity.unsentDraft = false;
    // A short visit to the window restarts the background timer.
    focusListener(true); focusListener(false);
    now += IDLE_APPLY_AFTER_MS - 60_000;
    assert.equal(await scheduler.tick(), false, 'focused 29 minutes ago'); assert.deepEqual(spawned, []);
    // Another open window would be quit too: hold.
    const otherWindow = new WindowPresence(path.join(dir, 'windows'), 'other'); otherWindow.beat(now);
    now += 120_000;
    assert.equal(await scheduler.tick(), false, 'another window is open'); otherWindow.dispose();
    // Positive control: everything idle → the relaunching installer starts, then Studio quits.
    assert.equal(await scheduler.tick(), true);
    assert.equal(spawned.length, 1);
    const script = fs.readFileSync(spawned[0].args.at(-1), 'utf8');
    if (platform === 'darwin') {
      assert.equal(spawned[0].exe, '/bin/bash');
      assert.ok(script.includes('open -g "$OLD_APP"'), 'idle restart reopens in the background');
    } else {
      assert.equal(spawned[0].exe, 'powershell.exe');
      assert.ok(script.includes('/mergetasks=runcode') && !script.includes('!runcode'), 'Setup relaunches Studio');
    }
    for (const t of timers.filter(t => !t.interval)) t.fn();
    assert.deepEqual(commands, ['workbench.action.quit']);
    assert.equal(await installStagedUpdate(context, () => true), false, 'the quit hook finds nothing left to install');
    scheduler.dispose();

    // 4c. A turn that starts between the tick and the launch keeps Studio running.
    spawned.length = 0; commands.length = 0; timers.length = 0;
    assert.equal(await stageUpdateInBackground({ ...info, version: '0.1.52' }, context), true);
    // A newer release replaces the staged one and removes the older download folder.
    const updatesRoot = path.join(dir, 'storage/updates');
    const pendingFile = () => path.join(updatesRoot, fs.readdirSync(updatesRoot)[0], 'pending-update.json');
    const olderDir = path.dirname(JSON.parse(fs.readFileSync(pendingFile(), 'utf8')).script);
    assert.ok(fs.existsSync(olderDir));
    assert.equal(await stageUpdateInBackground({ ...info, version: '0.1.53' }, context), true);
    assert.equal(fs.existsSync(olderDir), false, 'replaced download removed');
    assert.equal(stagedUpdateVersion(context), '0.1.53');
    let checks = 0;
    assert.equal(await applyStagedUpdateNow(context, () => ++checks < 2), false, 'late turn refuses the launch');
    for (const t of timers) t.fn();
    assert.deepEqual(spawned, []); assert.deepEqual(commands, []);
    assert.equal(stagedUpdateVersion(context), '0.1.53', 'kept for the next quit or idle moment');
    assert.equal(await installStagedUpdate(context, () => true), true, 'the quit hook still installs it');
    assert.ok(!fs.readFileSync(spawned[0].args.at(-1), 'utf8').includes(platform === 'darwin' ? 'open "$OLD_APP"' : '/mergetasks=runcode'), 'natural quit stays closed');

    // 4d. Announce once after the new version runs (with the release link), never before.
    state.set(AUTO_UPDATE_NOTICE_KEY, { version: '0.1.52', releaseUrl: info.releaseUrl });
    await announceAutoUpdate(context, '0.1.50');
    assert.deepEqual(notices, []); assert.ok(state.has(AUTO_UPDATE_NOTICE_KEY));
    vscode.window.showInformationMessage = async (m, label) => { notices.push(m); return label; };
    await announceAutoUpdate(context, '0.1.52');
    assert.deepEqual(notices, ['Studio를 v0.1.52(으)로 자동 업데이트했어요.']);
    assert.deepEqual(opened, [info.releaseUrl]);
    await announceAutoUpdate(context, '0.1.52');
    assert.equal(notices.length, 1, 'said once');

    // 4e. Scheduler: auto on stages silently (no banner); off, class seat or failed staging fall back to the banner.
    const assetName = platform === 'darwin' ? 'HypeProof-Studio-darwin-arm64.zip' : 'HypeProof.StudioUserSetup-x64-0.1.51.exe';
    const release = { tag_name: 'v0.1.51', html_url: info.releaseUrl, prerelease: false, draft: false, assets: [{ url: info.downloadUrl, name: assetName, size: bytes.length, digest: info.digest, browser_download_url: `https://github.com/hypeproof/hypeproof-studio-releases/releases/download/v0.1.51/${assetName}` }] };
    vmFetch.current = async url => String(url).includes('/assets/') ? new Response(bytes) : Response.json(release);
    const runScheduler = async ({ autoUpdate, classHeld = false, stagedVersion = null, stage }) => {
      const banners = [], staged = [];
      timers.length = 0;
      const sch = scheduleUpdateChecks({
        currentVersion: '0.1.50', context: { ...context, globalState: { get: (_k, d) => d } }, pushUpdateBanner: b => banners.push(b),
        autoUpdate: () => autoUpdate, classHeld: () => classHeld, stagedVersion: () => stagedVersion,
        stage: async i => { staged.push(i.version); return stage(i); },
      });
      assert.equal(timers[0].ms, 30_000);
      timers[0].fn(); for (let i = 0; i < 8; i++) await flush();
      assert.equal(timers.find(t => t.interval)?.ms, 4 * 3600_000, 'checks every 4 hours');
      sch.dispose();
      return { banners, staged };
    };
    const on = await runScheduler({ autoUpdate: true, stage: async () => true });
    assert.deepEqual([...on.staged], ['0.1.51']); assert.deepEqual([...on.banners], [null], 'staged silently: no banner');
    const off = await runScheduler({ autoUpdate: false, stage: async () => true });
    assert.deepEqual(off.staged, []); assert.equal(off.banners.at(-1)?.version, '0.1.51', 'auto off keeps the banner');
    const cls = await runScheduler({ autoUpdate: true, classHeld: true, stage: async () => true });
    assert.deepEqual(cls.staged, [], 'class seat downloads nothing'); assert.equal(cls.banners.at(-1)?.version, '0.1.51');
    const failed = await runScheduler({ autoUpdate: true, stage: async () => { throw new Error('digest mismatch'); } });
    assert.deepEqual(failed.staged, ['0.1.51']); assert.equal(failed.banners.at(-1)?.version, '0.1.51', 'failed staging falls back to the banner');
    const already = await runScheduler({ autoUpdate: true, stagedVersion: '0.1.51', stage: async () => true });
    assert.deepEqual(already.staged, [], 'no second download'); assert.deepEqual(already.banners, [null]);
    console.log(`PASS real updater: background staging, idle restart never mid-turn, late-turn refusal, notice, scheduler fallback: ${platform}`);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
