// Real updater orchestration; isolate only OS processes, network bytes and VS Code UI.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: ['src/updateChecker.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-update-host-'));
try {
  for (const platform of ['darwin', 'win32']) {
    for (const scenario of ['later', 'cancel', 'running', 'class', 'bad-digest', 'tampered', 'restart', 'newer-installed', 'same-installed', 'wrong-platform', 'other-installation', 'spawn-error', 'late-running', 'restart-busy', 'stale-lease']) {
      const dir = path.join(root, platform, scenario); fs.mkdirSync(dir, { recursive: true });
      const app = path.join(dir, 'Studio.app');
      const pkg = path.join(app, 'Contents/Resources/app/extensions/hypeproof-chat/package.json');
      fs.mkdirSync(path.dirname(pkg), { recursive: true }); fs.writeFileSync(pkg, JSON.stringify({ version: '0.1.50' }));
      const context = { globalStorageUri: { fsPath: path.join(dir, 'storage') } };
      const spawned = [], commands = [], timers = [], notices = [];
      let allowed = true, downloaded, verified = false, installChecks = 0;
      const bytes = Buffer.from('fixture verified archive bytes');
      const info = { available: true, sizeBytes: bytes.length, version: '0.1.51', downloadUrl: 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/assets/123', digest: 'sha256:' + createHash('sha256').update(scenario === 'bad-digest' ? 'wrong' : bytes).digest('hex') };
      const vscode = {
        ProgressLocation: { Notification: 1 },
        window: {
          withProgress: async (_options, callback) => callback({ report() {} }),
          showWarningMessage: async () => {},
          showInformationMessage: async (message, options) => {
            notices.push(message);
            if (!options?.modal) return;
            assert.equal(verified, true, 'confirmation only after download');
            if (scenario === 'running' || scenario === 'class') allowed = false;
            return ['late-running', 'restart', 'restart-busy', 'stale-lease'].includes(scenario) || scenario === 'running' || scenario === 'class' ? '재시작하고 업데이트' : scenario === 'cancel' ? undefined : '나중에';
          },
        },
        commands: { executeCommand: async command => commands.push(command) },
      };
      const cp = {
        execSync: command => {
          if (!command.startsWith('unzip')) return;
          const work = path.dirname(downloaded);
          const next = path.join(work, 'new.app'); fs.mkdirSync(next); fs.writeFileSync(path.join(next, 'version'), info.version);
        },
        execFile: () => { throw new Error('No external credentials in tests'); },
        spawn: (exe, args) => {
          spawned.push({ exe, args }); const child = new EventEmitter(); child.unref = () => {}; child.pid = scenario === 'restart' ? process.pid : 2147483647;
          queueMicrotask(() => scenario === 'spawn-error' ? child.emit('error', new Error('spawn failed')) : child.emit('spawn')); return child;
        },
      };
      // Capture actual transport output path via fs, but keep verification real.
      const fsProxy = { ...fs, createWriteStream: (file, ...args) => { downloaded = file; return fs.createWriteStream(file, ...args); } };
      const processStub = { ...process, platform, arch: platform === 'darwin' ? 'arm64' : 'x64', execPath: path.join(app, 'Contents/MacOS/Studio'), env: { HPS_RELEASE_TOKEN: 'fixture' } };
      const module = { exports: {} };
      vm.runInNewContext(bundle.outputFiles[0].text, {
        module, exports: module.exports, require: id => id === 'vscode' ? vscode : id === 'child_process' ? cp : ['fs', 'node:fs'].includes(id) ? fsProxy : id === 'os' ? { ...os, homedir: () => dir, tmpdir: () => dir } : require(id),
        __dirname: path.join(dir, 'dist'), process: processStub, console, Buffer, URL, AbortSignal, AbortController, TextEncoder, TextDecoder,
        fetch: async () => { verified = true; return new Response(bytes); },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 0; }, clearTimeout() {},
      });
      const { runUpdate, installStagedUpdate, refusedRestartNotice } = module.exports;
      // The handoff lease lives in the per-installation stage directory.
      const leaseDir = path.join(dir, 'storage/updates', createHash('sha256').update(app).digest('hex'), 'handoff');
      if (scenario === 'restart-busy' || scenario === 'stale-lease') {
        // restart-busy: a live installer launched a minute ago. stale-lease: the same live
        // pid (as after pid reuse) but recorded past the lease bound.
        fs.mkdirSync(leaseDir, { recursive: true });
        fs.writeFileSync(path.join(leaseDir, 'installer-pid.json'), JSON.stringify({ pid: process.pid, nonce: '00000000-0000-4000-8000-000000000000', startedAt: Date.now() - (scenario === 'stale-lease' ? 11 : 1) * 60_000 }));
      }
      if (scenario === 'bad-digest') {
        await assert.rejects(runUpdate(info, { context, canInstall: () => allowed }));
        assert.equal(await installStagedUpdate(context, () => true), false);
        assert.equal(spawned.length, 0); continue;
      }
      await runUpdate(info, { context, canInstall: () => { if (scenario === 'late-running' && ++installChecks > 1) allowed = false; return allowed; } });
      if (scenario === 'late-running' || scenario === 'restart-busy') {
        // Refused explicit restart: no installer, no quit queued, and an honest notice.
        assert.equal(spawned.length, 0);
        for (const timer of timers) timer.fn();
        assert.deepEqual(commands, [], 'Studio does not quit without a scheduled installer');
        assert.equal(notices.at(-1), refusedRestartNotice(scenario === 'restart-busy' ? 'busy' : 'held'));
        assert.match(notices.at(-1), /지금은 재시작하지 않았어요/);
        if (scenario === 'restart-busy') {
          assert.equal(await installStagedUpdate(context, () => true), false, 'busy lease also holds the quit install');
          fs.rmSync(path.join(leaseDir, 'installer-pid.json'));
          assert.equal(await installStagedUpdate(context, () => true), true, 'prepared update kept for the next quit');
          console.log(`PASS refused explicit restart (busy lease): ${platform}`); continue;
        }
      }
      if (scenario === 'stale-lease') {
        assert.equal(spawned.length, 1, 'an expired lease on a reused pid does not block the restart');
        for (const timer of timers) timer.fn();
        assert.deepEqual(commands, ['workbench.action.quit']);
        const lease = JSON.parse(fs.readFileSync(path.join(leaseDir, 'installer-pid.json'), 'utf8'));
        assert.equal(lease.pid, 2147483647); assert.match(lease.nonce, /^[0-9a-f-]{36}$/); assert.ok(Date.now() - lease.startedAt < 60_000);
        console.log(`PASS expired lease on a reused pid does not block: ${platform}`); continue;
      }
      if (scenario === 'restart') {
        assert.equal(spawned.length, 1, 'explicit restart uses existing installer');
        const stagedRoot = path.join(dir, 'storage/updates');
        const stagedIdentity = fs.readdirSync(stagedRoot)[0];
        assert.equal(fs.existsSync(path.join(stagedRoot, stagedIdentity, 'pending-update.json')), false, 'immediate handoff clears its own stage after the action');
        // Another window downloads while this explicit restart is already scheduled.
        await runUpdate({ ...info, version: '0.1.52' }, { context, canInstall: () => false });
        assert.equal(await installStagedUpdate(context, () => true), false, 'native quit cannot start the newer installer concurrently');
        assert.equal(spawned.length, 1);
        for (const timer of timers) timer.fn();
        assert.deepEqual(commands, ['workbench.action.quit']);
        assert.equal(await installStagedUpdate(context, () => true), false); continue;
      }
      assert.equal(spawned.length, 0, 'download/later/cancel cannot launch installer');
      assert.deepEqual(commands, [], 'staging cannot quit');
      if (scenario === 'running' || scenario === 'class' || scenario === 'late-running') {
        assert.equal(await installStagedUpdate(context, () => allowed), false);
        assert.equal(spawned.length, 0); allowed = true;
      }
      if (scenario === 'tampered') {
        const work = fs.readdirSync(dir).find(f => f.startsWith('hps-update-'));
        const artifact = platform === 'darwin' ? path.join(dir, work, 'new.app/version') : downloaded;
        fs.appendFileSync(artifact, 'tampered');
        await assert.rejects(installStagedUpdate(context, () => true), /changed/);
        assert.equal(spawned.length, 0); continue;
      }
      if (scenario === 'newer-installed' || scenario === 'same-installed') {
        fs.writeFileSync(pkg, JSON.stringify({ version: scenario === 'same-installed' ? '0.1.51' : '0.1.52' }));
        assert.equal(await installStagedUpdate(context, () => true), false);
        assert.equal(spawned.length, 0); continue;
      }
      if (scenario === 'wrong-platform') {
        const storage = path.join(dir, 'storage/updates');
        const recordPath = path.join(storage, fs.readdirSync(storage)[0], 'pending-update.json');
        const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
        record.platform = platform === 'darwin' ? 'win32' : 'darwin';
        fs.writeFileSync(recordPath, JSON.stringify(record));
        await assert.rejects(installStagedUpdate(context, () => true), /platform mismatch/);
        assert.equal(spawned.length, 0); continue;
      }
      if (scenario === 'other-installation') {
        const original = processStub.execPath; processStub.execPath = path.join(dir, 'Other.app/Contents/MacOS/Studio');
        assert.equal(await installStagedUpdate(context, () => true), false, 'another installed copy cannot consume this stage');
        assert.equal(spawned.length, 0); processStub.execPath = original;
      }
      if (scenario === 'spawn-error') {
        await assert.rejects(installStagedUpdate(context, () => true), /spawn failed/);
        assert.equal(JSON.parse(fs.readFileSync(pkg, 'utf8')).version, '0.1.50');
        continue;
      }
      assert.equal(await installStagedUpdate(context, () => true), true);
      assert.equal(spawned.length, 1); assert.deepEqual(commands, []);
      const call = spawned[0], script = fs.readFileSync(call.args.at(-1), 'utf8');
      assert.equal(call.exe, platform === 'darwin' ? '/bin/bash' : 'powershell.exe');
      if (platform === 'win32') {
        assert.ok(script.startsWith('\uFEFF')); assert.ok(script.includes('Start-Process -PassThru ')); assert.ok(script.includes('$setup.WaitForExit()')); assert.ok(!script.includes('-Wait ')); assert.ok(script.includes('/mergetasks=!runcode')); assert.ok(script.includes('/norestart'));
      } else assert.ok(!script.includes('open "$OLD_APP"'), 'natural quit stays closed on success and rollback');
      assert.equal(await installStagedUpdate(context, () => true), false);
      console.log(`PASS actual updater stage/handoff: ${platform} ${scenario}`);
    }
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
