// #3221 — macOS asks "HypeProof Studio이(가) … 폴더에 접근하려고 합니다" with no reason, because the base Info.plist
// has no privacy usage descriptions. stamp-mac-usage.py adds Korean ones at packaging (stamp-mac-app.sh, full build
// and repack, before signing), and verify-branding.sh refuses a build without them. Fixture plist, not a built app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const script = path.join(root, 'scripts/stamp-mac-usage.py');
const KEYS = ['NSDocumentsFolderUsageDescription', 'NSDownloadsFolderUsageDescription', 'NSDesktopFolderUsageDescription', 'NSRemovableVolumesUsageDescription', 'NSNetworkVolumesUsageDescription'];
const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], {encoding: 'utf8'});
const writePlist = (file, obj, fmt = 'FMT_BINARY') => py(`import plistlib,sys,json;plistlib.dump(json.loads(sys.argv[2]),open(sys.argv[1],'wb'),fmt=plistlib.${fmt})`, file, JSON.stringify(obj));
const readPlist = file => JSON.parse(py('import plistlib,sys,json;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', file));
const run = (...args) => spawnSync('python3', ['-I', script, ...args], {encoding: 'utf8'});
const fixture = (fmt) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-usage-'));
  const file = path.join(dir, 'Info.plist');
  writePlist(file, {CFBundleIdentifier: 'ai.hypeproof.studio', CFBundleShortVersionString: '2026.1030.0', CFBundleVersion: '1.116.06953'}, fmt);
  return file;
};

test('stamps every folder usage description in Korean and keeps the rest of the plist', () => {
  for (const fmt of ['FMT_BINARY', 'FMT_XML']) {
    const file = fixture(fmt);
    assert.equal(run('--check', file).status, 1, 'negative control: the base plist has none');
    const r = run(file); assert.equal(r.status, 0, r.stderr);
    const out = readPlist(file);
    for (const k of KEYS) {
      assert.match(out[k], /^HypeProof Studio는 .*[가-힣].*접근해요\.$/, `${k}: ${out[k]}`);
      assert.ok(!/VSCodium|Visual Studio Code|Code Helper/.test(out[k]));
    }
    assert.equal(out.CFBundleShortVersionString, '2026.1030.0'); assert.equal(out.CFBundleVersion, '1.116.06953'); assert.equal(out.CFBundleIdentifier, 'ai.hypeproof.studio');
    assert.equal(run('--check', file).status, 0, 'positive control: a stamped plist passes');
    const before = fs.readFileSync(file); assert.equal(run(file).status, 0); assert.deepEqual(fs.readFileSync(file), before, 'idempotent');
  }
});

test('--check refuses a stale sentence, and a missing plist fails the stamp', () => {
  const file = fixture('FMT_XML'); assert.equal(run(file).status, 0);
  const stale = readPlist(file); stale.NSDownloadsFolderUsageDescription = 'old'; writePlist(file, stale, 'FMT_XML');
  const r = run('--check', file); assert.equal(r.status, 1); assert.match(r.stdout, /NSDownloadsFolderUsageDescription/);
  assert.equal(run('/nonexistent/Info.plist').status, 1);
});

test('stamp-mac-app.sh runs it on the bundle Info.plist before signing; verify-branding.sh checks it', () => {
  const stamp = fs.readFileSync(path.join(root, 'scripts/stamp-mac-app.sh'), 'utf8');
  assert.match(stamp, /python3 "\$REPO_ROOT\/scripts\/stamp-mac-usage\.py" "\$PLIST"/);
  assert.ok(stamp.indexOf('stamp-mac-usage.py') < stamp.indexOf('korean/install.mjs'), 'stamped with the other pre-sign steps');
  const verify = fs.readFileSync(path.join(root, 'scripts/verify-branding.sh'), 'utf8');
  assert.match(verify, /stamp-mac-usage\.py" --check "\$APP\/Contents\/Info\.plist"/);
  assert.match(verify, /bad "Info\.plist: privacy usage descriptions missing or stale/);
});
