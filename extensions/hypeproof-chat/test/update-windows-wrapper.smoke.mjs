import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderWindowsUpdateWrapper } from '../src/updateCheckerHelpers.ts';

// Windows CI runs Windows PowerShell; elsewhere PowerShell 7 (pwsh) runs the same script
// when it is installed. Without either, print NOT RUN.
const shell = process.platform === 'win32' ? 'powershell.exe'
  : spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { timeout: 30_000 }).status === 0 ? 'pwsh' : undefined;
if (!shell) {
  console.log('NOT RUN: Windows PowerShell wrapper execution requires PowerShell (Windows CI runner or pwsh)');
} else {
  const root = mkdtempSync(join(tmpdir(), 'hps-update-'));
  try {
    for (const running of [false, true]) {
      const script = join(root, `wrapper-${running}.ps1`);
      const output = join(root, `result-${running}.json`);
      const installerPath = join(root, "한글 사용자's app", 'Setup.exe');
      // The wrapper refuses an installer that does not exist, so stage a placeholder (never executed: Start-Process is mocked).
      mkdirSync(dirname(installerPath), { recursive: true }); writeFileSync(installerPath, 'placeholder');
      // Keep the actual wrapper control flow/encoding; mock OS process lookup and
      // the installer launch so CI never installs or closes a real application.
      const prelude = `\uFEFFfunction Get-Process { param($Name, $ErrorAction) ${running ? "return @{Name='Studio'}" : 'return $null'} }\r\nfunction Start-Sleep {}\r\nfunction Start-Process { param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru) $r = @{path=$FilePath;args=$ArgumentList;wait=$Wait.IsPresent;waited=$false}; $r | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $env:HPS_UPDATE_TEST_OUTPUT; if ($PassThru) { $p = [pscustomobject]@{}; $p | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { $r.waited = $true; $r | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $env:HPS_UPDATE_TEST_OUTPUT }.GetNewClosure(); return $p } }\r\n`;
      const wrapper = renderWindowsUpdateWrapper({ appProcessName: 'Studio', installerPath, installerArgs: ['/silent', '/mergetasks=runcode', '/LOG="C:\\한글 사용자\\update.log"'], maxWaitMs: 0 });
      writeFileSync(script, prelude + wrapper.slice(1), 'utf8');
      // 30s, not 10s: PowerShell startup on a loaded GitHub Windows runner has
      // exceeded 10s repeatedly (2026-09-08, twice on one docs-only PR). The
      // wrapper itself cannot be slow here — Start-Sleep is mocked away in the
      // prelude — so a timeout was measuring the runner, not the code.
      const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, HPS_UPDATE_TEST_OUTPUT: output }, encoding: 'utf8', timeout: 30_000 });
      // spawnSync reports a timeout as status null with the reason on `error`, and
      // stderr is empty then — which produced a bare "null !== 0" that read like a
      // wrapper regression. Say which of the two it is.
      assert.notEqual(result.status, null,
        `PowerShell did not exit on its own (${result.error?.code ?? 'no error code'}); this is the harness or the runner, not the wrapper's exit code`);
      assert.equal(result.status, running ? 1 : 0, result.stderr);
      if (!running) {
        const recorded = JSON.parse(readFileSync(output, 'utf8').replace(/^\uFEFF/, ''));
        assert.equal(recorded.path, installerPath);
        // CGP-SHELL-R-002: the lease (this wrapper's pid) lasts as long as Setup itself.
        // -Wait also waits for descendants, and Setup relaunches Studio after an explicit
        // restart, so -Wait would hold the lease for the whole relaunched session.
        assert.equal(recorded.wait, false, 'wrapper does not wait for the relaunched Studio');
        assert.equal(recorded.waited, true, 'wrapper retains its handoff lease until Setup exits');
      }
      else assert.throws(() => readFileSync(output), { code: 'ENOENT' });
      console.log(`PASS Windows PowerShell wrapper: running=${running}; no actual installer launched`);
    }
    if (process.platform !== 'win32') {
      // Real processes, no mocks except the installer: a fake Setup that starts a long-lived
      // child (the relaunched Studio) and exits. The wrapper must exit with Setup.
      const marker = join(root, 'relaunched.pid');
      const setup = join(root, 'fake-setup.exe'); // the wrapper only starts a staged *.exe
      writeFileSync(setup, `#!/bin/sh\nsleep 30 </dev/null >/dev/null 2>&1 &\necho $! > '${marker}'\nexit 0\n`);
      chmodSync(setup, 0o755);
      const script = join(root, 'wrapper-real.ps1');
      writeFileSync(script, renderWindowsUpdateWrapper({ appProcessName: 'hps-no-such-process-for-test', installerPath: setup, installerArgs: ['/silent'], maxWaitMs: 0 }), 'utf8');
      const started = Date.now();
      const result = spawnSync(shell, ['-NoProfile', '-File', script], { encoding: 'utf8', timeout: 25_000 });
      const relaunched = existsSync(marker) ? Number(readFileSync(marker, 'utf8')) : 0;
      let alive = false;
      try { if (relaunched) { process.kill(relaunched, 0); alive = true; } } catch { /* gone */ }
      try { if (relaunched) process.kill(relaunched); } catch { /* gone */ }
      assert.equal(result.status, 0, result.stderr || String(result.error));
      assert.ok(relaunched > 0, 'fake Setup ran');
      assert.equal(alive, true, 'the relaunched child was still running when the wrapper exited');
      assert.ok(Date.now() - started < 20_000, 'wrapper exited with Setup, not with its child');
      console.log('PASS Windows PowerShell wrapper: exits with Setup while the relaunched app keeps running');
    }
    // Failure safety (#4298): Studio has already quit when the wrapper runs, so when Setup cannot be started
    // it must say why and bring the existing app back instead of leaving the learner with nothing.
    // Mocked Start-Process records every launch: Setup's (never expected here) and the app's.
    const failureCase = (label, { installer, setupExit = 0, expectInstaller = false }) => {
      const script = join(root, `fail-${label}.ps1`); const output = join(root, `fail-${label}.json`); const log = join(root, `fail-${label}.log`);
      const appExePath = join(root, 'Studio app', 'Studio.exe');
      const prelude = `\uFEFFfunction Get-Process { param($Name, $ErrorAction) return $null }\r\nfunction Start-Sleep {}\r\n$global:launches = @()\r\nfunction Start-Process { param($FilePath, $ArgumentList, [switch]$PassThru) $global:launches += $FilePath; ConvertTo-Json -InputObject @($global:launches) | Set-Content -Encoding UTF8 -LiteralPath $env:HPS_UPDATE_TEST_OUTPUT; if ($PassThru) { $p = [pscustomobject]@{ ExitCode = ${setupExit} }; $p | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {}; return $p } }\r\n`;
      const wrapper = renderWindowsUpdateWrapper({ appProcessName: 'Studio', installerPath: installer, installerArgs: ['/silent'], maxWaitMs: 0, appExePath, failureLogPath: log });
      mkdirSync(dirname(appExePath), { recursive: true }); writeFileSync(appExePath, 'placeholder');
      writeFileSync(script, prelude + wrapper.slice(1), 'utf8');
      const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, HPS_UPDATE_TEST_OUTPUT: output }, encoding: 'utf8', timeout: 30_000 });
      assert.notEqual(result.status, null, `PowerShell did not exit on its own (${result.error?.code ?? 'no error code'})`);
      assert.equal(result.status, 1, `${label}: the wrapper reports the failed update (${result.stderr})`);
      const launches = JSON.parse(readFileSync(output, 'utf8').replace(/^\uFEFF/, ''));
      assert.deepEqual(launches.filter(p => p === installer), expectInstaller ? [installer] : [], `${label}: installer launched or not`);
      assert.equal(launches.at(-1), appExePath, `${label}: the existing app is relaunched last`);
      const recorded = readFileSync(log, 'utf8');
      assert.match(recorded, /update failed, installer not completed/);
      assert.match(recorded, /relaunched existing app/);
      return recorded;
    };
    const bare = join(root, '749161648'); writeFileSync(bare, 'placeholder'); // the pre-fix staged name: numeric id, no .exe
    assert.match(failureCase('no-extension', { installer: bare }), /does not end in \.exe/);
    assert.match(failureCase('missing', { installer: join(root, 'gone', 'Setup.exe') }), /installer file is missing/);
    const real = join(root, 'Real Setup.exe'); writeFileSync(real, 'placeholder');
    assert.match(failureCase('exit-code', { installer: real, setupExit: 5, expectInstaller: true }), /installer exited with code 5/);
    console.log('PASS Windows PowerShell wrapper: bad, missing or failing installer is recorded and the app is relaunched');

    if (process.platform === 'win32') {
      // Real Windows PowerShell 5.1 and real executables: whoami.exe stands in for Setup and for the app
      // (harmless, prints help for /? and exits 0, non-zero for an unknown switch). Never a real installer.
      // whoami.exe runs from System32 (a copy would lose its resource files). Its staged name is the system one, so the
      // test of the staged *name* is the extensionless placeholder below, which the wrapper must refuse.
      const stubSetup = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe');
      const stubApp = stubSetup;
      const run = (installerPath, args, log) => {
        const script = join(root, `real-${Math.random().toString(36).slice(2)}.ps1`);
        writeFileSync(script, renderWindowsUpdateWrapper({ appProcessName: 'hps-no-such-process-for-ci', installerPath, installerArgs: args, maxWaitMs: 0, appExePath: stubApp, failureLogPath: log }), 'utf8');
        return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { encoding: 'utf8', timeout: 60_000 });
      };
      const okLog = join(root, 'ok.log');
      const ok = run(stubSetup, ['/?'], okLog);
      assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
      assert.ok(stubSetup.endsWith('.exe') && !existsSync(okLog), 'a staged .exe starts and a successful run records no failure');
      const badLog = join(root, 'bad.log');
      assert.equal(run(stubSetup, ['/no-such-switch'], badLog).status, 1);
      assert.match(readFileSync(badLog, 'utf8'), /installer exited with code [1-9]/);
      const bareLog = join(root, 'bare.log');
      assert.equal(run(bare, ['/?'], bareLog).status, 1);
      assert.match(readFileSync(bareLog, 'utf8'), /does not end in \.exe[\s\S]*relaunched existing app/);
      console.log('PASS Windows PowerShell 5.1 wrapper with real stub executables: starts a staged .exe; refuses the extensionless name and relaunches the app');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}
