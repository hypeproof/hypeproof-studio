import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderInstallerScript } from '../src/updateCheckerHelpers.ts';

if (process.platform !== 'darwin') {
  console.log('NOT RUN: macOS installer execution requires macOS and PlistBuddy');
} else {
  const root = mkdtempSync(join(tmpdir(), 'hps-installer-'));
  try {
    for (const scenario of ['success', 'quit-success', 'quit-install-fails', 'running', 'backup-fails', 'install-fails', 'stage-fails', 'wrong-bundle']) {
      const dir = join(root, scenario);
      const bin = join(dir, 'bin');
      mkdirSync(bin, { recursive: true });
      const oldAppPath = join(dir, "Studio 한글 ' $test.app");
      const newAppPath = join(dir, 'download.app');
      for (const [app, marker] of [[oldAppPath, 'old'], [newAppPath, 'new']]) {
        mkdirSync(join(app, 'Contents'), { recursive: true });
        const id = scenario === 'wrong-bundle' && marker === 'new' ? 'wrong.id' : 'ai.hypeproof.studio';
        writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`);
        writeFileSync(join(app, 'marker'), marker);
        const packageDir = join(app, 'Contents', 'Resources', 'app', 'extensions', 'hypeproof-chat');
        mkdirSync(packageDir, { recursive: true });
        writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ version: marker === 'old' ? '0.1.50' : '0.1.51' }));
      }
      const commands = {
        pgrep: '[ "$SCENARIO" = running ]',
        sleep: 'exit 0',
        open: 'printf "%s\\n" "$1" >> "$OPEN_LOG"',
        xattr: 'exit 0',
        ditto: '[ "$SCENARIO" != stage-fails ] || exit 1\nexec /usr/bin/ditto "$@"',
        mv: '[ "$SCENARIO" != backup-fails ] || [ "$1" != "$OLD_TARGET" ] || exit 1\nif [[ "$SCENARIO" = *install-fails ]]; then case "$1" in */next.app) exit 1;; esac; fi\nexec /bin/mv "$@"',
      };
      for (const [name, body] of Object.entries(commands)) writeFileSync(join(bin, name), '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
      const script = join(dir, 'installer.sh');
      writeFileSync(script, renderInstallerScript({ newAppPath, oldAppPath, expectedBundleId: 'ai.hypeproof.studio', newVersion: '0.1.51', oldVersion: '0.1.50', logPath: join(dir, 'update.log'), relaunch: !scenario.startsWith('quit-') }));
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SCENARIO: scenario, OLD_TARGET: oldAppPath, OPEN_LOG: join(dir, 'open.log') };
      const run = spawnSync('/bin/bash', [script], { env, encoding: 'utf8', timeout: 10_000 });
      assert.equal(run.status, ['success', 'quit-success'].includes(scenario) ? 0 : 1, readFileSync(join(dir, 'update.log'), 'utf8'));
      assert.equal(readFileSync(join(oldAppPath, 'marker'), 'utf8'), ['success', 'quit-success'].includes(scenario) ? 'new' : 'old', scenario);
      const versionPath = join(oldAppPath, 'Contents', 'Resources', 'app', 'extensions', 'hypeproof-chat', 'package.json');
      assert.equal(JSON.parse(readFileSync(versionPath, 'utf8')).version, ['success', 'quit-success'].includes(scenario) ? '0.1.51' : '0.1.50', 'next launch reads replaced manifest version, failures keep old version');
      if (['success', 'quit-success'].includes(scenario)) {
        const stage = readdirSync(dir).find(n => n.startsWith('.hps-update.'));
        assert.equal(readFileSync(join(dir, stage, 'previous.app', 'marker'), 'utf8'), 'old');
        assert.equal(existsSync(env.OPEN_LOG), scenario === 'success');
      }
      if (scenario === 'running' || scenario.startsWith('quit-')) assert.equal(existsSync(env.OPEN_LOG), false);
      console.log(`PASS real bash installer fixture: ${scenario}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}
