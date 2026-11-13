// Real Windows PowerShell control flow; synthetic setup/seeder, no real App installation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {writeWindowsUpdater} from '../install-kit.mjs';
if (process.platform !== 'win32') {
  console.log('NOT RUN: generated installer execution requires Windows PowerShell 5.1');
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-delivery-'));
  try {
    for (const scenario of ['success', 'corrupt-exe', 'corrupt-seed', 'corrupt-seeder', 'missing-seed', 'setup-failure', 'seed-failure', 'app-running']) {
      const dir = path.join(root, scenario); fs.mkdirSync(dir);
      const userSetup = path.join(dir, 'HypeProof.StudioUserSetup-x64-1.116.0.exe');
      const seedTarball = path.join(dir, 'claude-agent-sdk-win32-x64-0.3.299.tgz');
      const seeder = path.join(dir, 'seed-sdk-binary.ps1');
      const setupLog = path.join(dir, 'setup.json'), seedLog = path.join(dir, 'seed.json');
      fs.writeFileSync(userSetup, 'synthetic setup'); fs.writeFileSync(seedTarball, 'synthetic SDK');
      fs.writeFileSync(seeder, `param($Version, $Platform, $Tarball)\n@{version=$Version;platform=$Platform;tarball=$Tarball;exists=(Test-Path -LiteralPath $Tarball)} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $env:HPS_TEST_SEED_LOG\nexit ${scenario === 'seed-failure' ? 7 : 0}\n`);
      writeWindowsUpdater({tag: 'v2026.1113.0', userSetup, seedTarball, seeder}, dir);
      if (scenario.startsWith('corrupt-')) fs.appendFileSync({'corrupt-exe': userSetup, 'corrupt-seed': seedTarball, 'corrupt-seeder': seeder}[scenario], 'changed');
      if (scenario === 'missing-seed') fs.unlinkSync(seedTarball);
      const body = fs.readFileSync(path.join(dir, 'update-windows.cmd'), 'utf8').split(/\r?\n#PS#\r?\n/)[1];
      const prelude = `function Get-Process { ${scenario === 'app-running' ? "[pscustomobject]@{Path=(Join-Path $env:LOCALAPPDATA 'Programs\\HypeProof Studio\\HypeProof Studio.exe')}" : ''} }\nfunction Start-Process { param($FilePath,$ArgumentList,[switch]$Wait,[switch]$PassThru) @{file=$FilePath;args=$ArgumentList} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $env:HPS_TEST_SETUP_LOG; [pscustomobject]@{ExitCode=${scenario === 'setup-failure' ? 5 : 0}} }\n`;
      const script = path.join(dir, 'run.ps1'); fs.writeFileSync(script, '\uFEFF' + prelude + body);
      const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {encoding: 'utf8', timeout: 60_000,
        env: {...process.env, HPS_INSTALL_ASSET_DIR: dir, HPS_INSTALL_DRY_RUN: '', HPS_TEST_SETUP_LOG: setupLog, HPS_TEST_SEED_LOG: seedLog}});
      assert.equal(result.status, scenario === 'success' ? 0 : 1, `${scenario}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
      const installed = ['success', 'setup-failure', 'seed-failure'].includes(scenario);
      assert.equal(fs.existsSync(setupLog), installed, `${scenario}: setup execution`);
      assert.equal(fs.existsSync(seedLog), ['success', 'seed-failure'].includes(scenario), `${scenario}: seeder execution`);
      if (installed) {
        const log = JSON.parse(fs.readFileSync(setupLog, 'utf8').replace(/^\uFEFF/, ''));
        assert.ok(log.args.includes('/MERGETASKS=!runcode'));
        assert.equal(fs.existsSync(path.dirname(log.file)), false, 'only the owned temp directory was cleaned');
      }
      if (scenario === 'success') {
        const log = JSON.parse(fs.readFileSync(seedLog, 'utf8').replace(/^\uFEFF/, ''));
        assert.equal(log.version, '0.3.299'); assert.equal(log.platform, 'win32-x64'); assert.equal(log.exists, true);
        assert.match(result.stdout, /설치 완료:/);
      } else assert.doesNotMatch(result.stdout, /설치 완료:/);
      assert.ok(fs.existsSync(userSetup), 'original release assets preserved');
      console.log(`PASS Windows generated delivery: ${scenario} (synthetic setup/SDK)`);
    }
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}
