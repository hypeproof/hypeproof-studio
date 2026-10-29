// #3212 — Studio must not open VS Code's release notes after an update. Offline controls: the
// product.json filters the packaging steps actually run (stamp-mac-app.sh for the full build and the
// repack, the packaged-app stamp in build-windows.yml) are executed with jq on a product.json that
// carries the upstream releaseNotesUrl; verify-branding.sh refuses a build that still has it; the
// extension defaults `update.showReleaseNotes` to false. Fixture bytes, not a built app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = p => fs.readFileSync(root + p, 'utf8');
const upstream = {version: '1.116.0', commit: 'c'.repeat(40), nameShort: 'HypeProof Studio', releaseNotesUrl: 'https://go.microsoft.com/fwlink/?LinkID=533483#vscode', checksums: {'out/vs/x.js': 'h'}};
const jq = (filter, args) => JSON.parse(execFileSync('jq', [...args, filter], {input: JSON.stringify(upstream), encoding: 'utf8'}));

test('stamp-mac-app.sh (full build and repack) drops releaseNotesUrl in both branches', () => {
  const filters = [...read('scripts/stamp-mac-app.sh').matchAll(/jq (--arg [^']+)'([^']+)' "\$PJSON"/g)].map(m => m[2]);
  assert.equal(filters.length, 2, 'the with-commit and without-commit stamps');
  for (const f of filters) {
    const out = jq(f, ['--arg', 'v', '2026.1030.0', '--arg', 'c', 'd'.repeat(40)]);
    assert.equal(out.releaseNotesUrl, undefined, `releaseNotesUrl survives: ${f}`);
    assert.equal(out.version, '2026.1030.0'); assert.deepEqual(out.checksums, upstream.checksums, 'checksums untouched');
    assert.equal(out.nameShort, 'HypeProof Studio');
  }
});

test('build-windows.yml packaged-app stamp drops releaseNotesUrl', () => {
  const m = /jq --arg v "\$HPS_VER" '([^']+)' "\$PKG_PRODUCT"/.exec(read('.github/workflows/build-windows.yml'));
  assert.ok(m, 'the Windows packaged product.json stamp exists');
  const out = jq(m[1], ['--arg', 'v', '2026.1030.0']);
  assert.equal(out.releaseNotesUrl, undefined); assert.equal(out.version, '2026.1030.0');
});

test('verify-branding.sh fails a build that still carries releaseNotesUrl', () => {
  const src = read('scripts/verify-branding.sh');
  assert.match(src, /jq -r '\.releaseNotesUrl \/\/ ""'/);
  assert.match(src, /bad "product\.json\.releaseNotesUrl is set/);
});

test('the extension turns the VS Code after-update release notes off by default', () => {
  const pkg = JSON.parse(read('extensions/hypeproof-chat/package.json'));
  assert.equal(pkg.contributes.configurationDefaults['update.showReleaseNotes'], false);
});
