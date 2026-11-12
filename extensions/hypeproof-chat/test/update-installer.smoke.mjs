import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderInstallerScript } from '../src/updateCheckerHelpers.ts';

// Run the shipped bash installer on disposable directories. Apple security tools
// are stubbed at the command boundary; this is not signed-app/device acceptance.
{
  const root = mkdtempSync(join(tmpdir(), 'hps-installer-'));
  try {
    for (const scenario of ['success', 'quit-success', 'quit-install-fails', 'running', 'backup-fails', 'install-fails', 'stage-fails', 'wrong-bundle', 'unsigned', 'wrong-team', 'wrong-signing-id', 'bad-notarization', 'non-notarized', 'assessment-disabled', 'spoofed-authority', 'stage-tampered']) {
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
        // #3210: record what the relaunch would inherit from the extension host.
        open: 'printf "%s|%s|%s|%s\\n" "$1" "${ELECTRON_RUN_AS_NODE-unset}" "${VSCODE_PID-unset}" "${VSCODE_ESM_ENTRYPOINT-unset}" >> "$OPEN_LOG"',
        xattr: 'echo unexpected-quarantine-bypass >> "$OPEN_LOG"; exit 1',
        PlistBuddy: `exec python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1], "rb"))["CFBundleIdentifier"])' "$3"`,
        codesign: `
app="\${!#}"
printf '%s\\n' "$*" >> "$VERIFY_LOG"
[[ "$*" == *'--verify'* && "$*" == *'--strict'* && "$*" == *'--all-architectures'* ]] || exit 20
[[ "$SCENARIO" != unsigned ]] || exit 1
[[ "$(cat "$app/marker")" != tampered ]] || exit 1
if [[ "$*" == *'-R='* ]]; then
  [[ "$*" == *'identifier "ai.hypeproof.studio"'* && "$*" == *'anchor apple generic'* && "$*" == *'certificate 1[field.1.2.840.113635.100.6.2.6] exists'* && "$*" == *'certificate leaf[field.1.2.840.113635.100.6.1.13] exists'* && "$*" == *'certificate leaf[subject.OU] = "RZBNT9ZB67"'* ]] || exit 21
  [[ "$SCENARIO" != wrong-team && "$SCENARIO" != wrong-signing-id ]] || exit 1
fi`,
        spctl: `
printf '%s\\n' "$*" >> "$VERIFY_LOG"
[[ "$SCENARIO" != bad-notarization ]] || exit 1
case "$SCENARIO" in non-notarized) echo 'source=Developer ID';; assessment-disabled) echo 'assessments disabled';; spoofed-authority) printf 'source=Notarized Developer ID\\nsource=Developer ID\\n';; *) echo 'source=Notarized Developer ID';; esac`,
        ditto: '[ "$SCENARIO" != stage-fails ] || exit 1\ncp -a "$1" "$2" || exit 1\nif [[ "$SCENARIO" = stage-tampered ]]; then echo tampered > "$2/marker"; fi',
        mv: '[ "$SCENARIO" != backup-fails ] || [ "$1" != "$OLD_TARGET" ] || exit 1\nif [[ "$SCENARIO" = *install-fails ]]; then case "$1" in */next.app) exit 1;; esac; fi\nexec /bin/mv "$@"',
      };
      for (const [name, body] of Object.entries(commands)) writeFileSync(join(bin, name), '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
      const script = join(dir, 'installer.sh');
      const rendered = renderInstallerScript({ newAppPath, oldAppPath, expectedBundleId: 'ai.hypeproof.studio', newVersion: '0.1.51', oldVersion: '0.1.50', logPath: join(dir, 'update.log'), relaunch: !scenario.startsWith('quit-') });
      assert.ok(!rendered.includes('xattr'), 'no production quarantine bypass');
      // Replace only absolute Apple tool paths in this test copy; shipped code has no override.
      writeFileSync(script, rendered.replaceAll('/usr/libexec/PlistBuddy', join(bin, 'PlistBuddy')).replaceAll('/usr/bin/codesign', join(bin, 'codesign')).replaceAll('/usr/sbin/spctl', join(bin, 'spctl')));
      // The extension host's own variables, as runningboardd showed them on the failed relaunch (#3210).
      const hostEnv = { ELECTRON_RUN_AS_NODE: '1', VSCODE_PID: '4242', VSCODE_IPC_HOOK: '/tmp/x.sock', VSCODE_ESM_ENTRYPOINT: 'vs/workbench/api/node/extensionHostProcess', VSCODE_CRASH_REPORTER_PROCESS_TYPE: 'extensionHost' };
      const env = { ...process.env, ...hostEnv, PATH: `${bin}:${process.env.PATH}`, SCENARIO: scenario, OLD_TARGET: oldAppPath, OPEN_LOG: join(dir, 'open.log'), VERIFY_LOG: join(dir, 'verify.log') };
      const run = spawnSync('/bin/bash', [script], { env, encoding: 'utf8', timeout: 10_000 });
      assert.equal(run.status, ['success', 'quit-success'].includes(scenario) ? 0 : 1, readFileSync(join(dir, 'update.log'), 'utf8'));
      assert.equal(readFileSync(join(oldAppPath, 'marker'), 'utf8'), ['success', 'quit-success'].includes(scenario) ? 'new' : 'old', scenario);
      const versionPath = join(oldAppPath, 'Contents', 'Resources', 'app', 'extensions', 'hypeproof-chat', 'package.json');
      assert.equal(JSON.parse(readFileSync(versionPath, 'utf8')).version, ['success', 'quit-success'].includes(scenario) ? '0.1.51' : '0.1.50', 'next launch reads replaced manifest version, failures keep old version');
      if (['success', 'quit-success'].includes(scenario)) {
        const stage = readdirSync(dir).find(n => n.startsWith('.hps-update.'));
        assert.equal(readFileSync(join(dir, stage, 'previous.app', 'marker'), 'utf8'), 'old');
        assert.equal(existsSync(env.OPEN_LOG), scenario === 'success');
        if (scenario === 'success') assert.equal(readFileSync(env.OPEN_LOG, 'utf8'), `${oldAppPath}|unset|unset|unset\n`, '#3210: the relaunch inherits no ELECTRON_*/VSCODE_* variable');
      }
      if (scenario === 'running' || scenario.startsWith('quit-')) assert.equal(existsSync(env.OPEN_LOG), false);
      console.log(`PASS bash swap/rollback fixture with mocked Apple tools: ${scenario}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}
