// Controls for scripts/check-studio-launches.mjs: launcher calls pass, raw
// launches fail, and the repository itself is clean.
import assert from 'node:assert/strict';
import test from 'node:test';

import { scanRepo, scanText } from '../check-studio-launches.mjs';

const POSITIVE = {
  'e2e/x/launcher.mjs': `import { _electron as electron } from '@playwright/test';
import { launchStudio, spawnStudio } from '../../scripts/lib/studio-launcher.mjs';
const bin = path.join(copy, 'Contents/MacOS/HypeProof Studio');
const app = await launchStudio(electron, { executablePath: bin, args: [] }, { label: 'x', secretStorage: 'os' });
const child = spawnStudio(bin, ['--new-window', ws], { stdio: 'ignore' }, { label: 'x', secretStorage: 'inmemory' });
const browser = await chromium.launch({ headless: true });
execFileSync('/usr/bin/open', [approval.return_uri]);`,
  'scripts/x.sh': `node scripts/studio-launch.mjs run --label x --secret-storage os -- "$APP/Contents/MacOS/HypeProof Studio"
echo "studio-dev.py run done"
# open -a "HypeProof Studio"   (a comment describes, it does not launch)`,
  'scripts/x.py': `argv = ['studio-dev.py', 'run', '--provider', 'service']
subprocess.run(['node', 'scripts/studio-launch.mjs', 'sweep'])`,
  'scripts/heredoc.sh': `cat <<EOF
  1. Open the app:
       open "$ROOT/vscodium-base/VSCode-darwin-arm64/HypeProof Studio.app"
EOF`,
  'scripts/interactive.sh': `# studio-launch: interactive -- the developer works in this Dev app
python3 scripts/studio-dev.py run`,
};

const NEGATIVE = {
  'e2e/x/raw-electron.mjs': [`const app = await electron.launch({ executablePath: APP_BINARY, args: [] });`, /electron\.launch/],
  'e2e/x/raw-underscore.ts': [`const app = await _electron.launch({ executablePath: bin });`, /electron\.launch/],
  'e2e/x/raw-spawn-literal.mjs': [`const app = spawn(path.join(copy, 'Contents/MacOS/HypeProof Studio'), args, {});`, /raw spawn/],
  'e2e/x/raw-spawn-var.mjs': [`const bin = path.join(copy, 'Contents/MacOS/HypeProof Studio');\nconst p = spawn(bin, appArgs(ws), { stdio: 'ignore' });`, /raw spawn/],
  'e2e/x/raw-exe.mjs': [`execFileSync('C:/x/HypeProof Studio.exe', ['--new-window']);`, /raw spawn/],
  'scripts/raw-open.sh': [`open -a "HypeProof Studio" --args --remote-debugging-port=9222`, /open -a/],
  'scripts/raw-open-g.sh': [`open -g -n -a "$APP" --args --user-data-dir=/tmp/x`, /open -a/],
  'scripts/raw-open-bundle.sh': [`open "/tmp/hps/HypeProof Studio.app"`, /open <app bundle>/],
  'scripts/raw-dev.sh': [`python3 "$ROOT/scripts/studio-dev.py" --state-dir "$STATE" --provider service run --service local`, /studio-dev\.py run/],
  'e2e/x/raw-dev.mjs': [`run('python3', ['scripts/studio-dev.py', 'run', '--provider', 'service']);`, /studio-dev\.py run/],
  'scripts/raw-popen.py': [`exe = app / 'Contents/MacOS/HypeProof Studio'\nprocess = subprocess.Popen([str(exe)], env=env)`, /Popen/],
  'scripts/after-heredoc.sh': [`cat <<EOF\nhello\nEOF\nopen "/tmp/HypeProof Studio.app"`, /open <app bundle>/],
  'scripts/marker-without-reason.sh': [`# studio-launch: interactive\nopen -a "HypeProof Studio"`, /open -a/],
};

test('positive controls: launcher calls and non-launch lines pass', () => {
  for (const [file, text] of Object.entries(POSITIVE)) assert.deepEqual(scanText(text, file), [], file);
});

test('negative controls: every raw launch form fails', () => {
  for (const [file, [text, rule]] of Object.entries(NEGATIVE)) {
    const found = scanText(text, file);
    assert.ok(found.length >= 1, `${file} should be flagged`);
    assert.ok(found.some(v => rule.test(v.rule)), `${file}: ${JSON.stringify(found)}`);
  }
});

test('the repository launches Studio only through the launcher', () => {
  const found = scanRepo();
  assert.deepEqual(found.map(v => `${v.file}:${v.line} ${v.rule}`), []);
});
