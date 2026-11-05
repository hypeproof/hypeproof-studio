// #3553: the residual "codium" rule (REQ-J4) used to run only in build-mac on a release tag, so #3484's
// `vscodium-base` method comment merged green and broke v2026.1105.0-rc.2 a day later. The rule now lives
// in scripts/check-residual-branding.sh; verify-branding.sh (build-mac) and studio-pr-ci's
// "extension / shipped branding" job both run it. These controls plant known answers in fixture trees.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHECK = path.join(ROOT, 'scripts/check-residual-branding.sh');
const VERIFY = path.join(ROOT, 'scripts/verify-branding.sh');

// The shipped shape of the bundled extension: what inject-builtin-extensions.sh copies.
function shippedExtension(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-residual-'));
  const all = {
    'package.json': JSON.stringify({name: 'hypeproof-chat', version: '1.0.0'}),
    'dist/extension.js': '"use strict";\nclass ChatPanelProvider {\n  /** Opens a learner link. */\n  async openLearnerLink(raw) {}\n}\n',
    'webview-ui/dist/index.html': '<!doctype html><title>HypeProof Studio</title>',
    'media/icon.svg': '<svg/>',
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true});
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const check = (...args) => spawnSync('bash', [CHECK, ...args], {encoding: 'utf8'});
const shippedRoots = dir => ['package.json', 'dist', 'media', 'webview-ui/dist'].map(p => path.join(dir, p));

// The comment #3484 shipped, as esbuild kept it on the class member (reverted by #3552).
const COMMENT_3484 = '  /**\n   * Opens a learner link. The persist:hp-safe core patch is not\n   * in the pinned vscodium-base, so this host check is the only allowlist enforcement.\n   */\n';

test('positive control: a clean shipped extension passes', () => {
  const dir = shippedExtension();
  try {
    const r = check(...shippedRoots(dir));
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('negative control: the #3484 `vscodium-base` method comment in dist/extension.js fails and is named', () => {
  const dir = shippedExtension({
    'dist/extension.js': `"use strict";\nclass ChatPanelProvider {\n${COMMENT_3484}  async openLearnerLink(raw) {}\n}\n`,
  });
  try {
    const r = check(...shippedRoots(dir));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /Residual 'codium' found in:/);
    assert.match(r.stdout, /dist\/extension\.js/);
    assert.match(r.stdout, /pinned vscodium-base/, 'the offending context is printed');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('negative controls: "VSCodium" in the webview bundle or the extension manifest fails', () => {
  for (const [rel, body] of [
    ['webview-ui/dist/assets/index-abc.js', 'const t="Welcome to VSCodium";'],
    ['package.json', JSON.stringify({displayName: 'Codium Chat'})],
  ]) {
    const dir = shippedExtension({[rel]: body});
    try {
      const r = check(...shippedRoots(dir));
      assert.equal(r.status, 1, `${rel}: ${r.stdout}`);
      assert.match(r.stdout, new RegExp(rel.replace(/[.]/g, '\\.')));
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  }
});

test('legal attribution, excluded paths and benign contexts pass (positive controls, same rule as build-mac)', () => {
  const dir = shippedExtension({
    'dist/THIRD-PARTY-NOTICES.txt': 'Portions from VSCodium (MIT).',
    'dist/LICENSE': 'VSCodium',
    'dist/vendor/node_modules/x/index.js': 'detect("vscodium")',
    'webview-ui/dist/node_modules/y.js': 'codium',
    'dist/a.js': '//# sourceMappingURL=https://github.com/VSCodium/sourcemaps/x.map',
    'dist/b.js': 'require("@vscodium/policy-watcher")',
    'dist/c.js': '{"author":{"name":"VSCodium"}}',
    'dist/d.js': 'i("VSCodium",this.productName)',
    'media/upstream.json': '{"author":"VSCodium"}',
  });
  try {
    const r = check('--exclude-file', path.join(dir, 'media/upstream.json'), ...shippedRoots(dir));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const unexcluded = check(...shippedRoots(dir));
    assert.equal(unexcluded.status, 1, '--exclude-file is what lets media/upstream.json through');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the #356 reload toast warns but does not fail; a usage error is exit 2', () => {
  const dir = shippedExtension({'dist/toast.js': 'msg("Please reload VSCodium to enable this extension.")'});
  try {
    const r = check(...shippedRoots(dir));
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /Known reload-toast leak/);
    assert.equal(check().status, 2);
    assert.equal(check(path.join(dir, 'missing')).status, 2);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// build-mac runs verify-branding.sh; its check 5 must be this script, and its last lines must name what failed.
function syntheticApp(dir, extJs) {
  const app = path.join(dir, 'HypeProof Studio.app');
  const ext = path.join(app, 'Contents/Resources/app/extensions/hypeproof-chat');
  fs.mkdirSync(path.join(ext, 'dist'), {recursive: true});
  fs.writeFileSync(path.join(ext, 'dist/extension.js'), extJs);
  fs.writeFileSync(path.join(ext, 'package.json'), JSON.stringify({version: '1.0.0'}));
  fs.writeFileSync(path.join(app, 'Contents/Resources/app/package.json'), '{"author":"VSCodium"}');
  return app;
}
const verify = (app, env = {}) => {
  const r = spawnSync('bash', [VERIFY, app], {encoding: 'utf8', env: {...process.env, HOME: path.dirname(app), GITHUB_ACTIONS: '', ...env}});
  return {...r, out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '')};
};

test('verify-branding.sh check 5 runs the shared script on the app (red with the #3484 comment, green without)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-verify-'));
  try {
    const red = verify(syntheticApp(path.join(dir, 'red'), `class A {\n${COMMENT_3484}  m() {}\n}\n`));
    assert.match(red.out, /✗ Residual 'codium' found/);
    assert.match(red.out, /pinned vscodium-base/);
    const green = verify(syntheticApp(path.join(dir, 'green'), 'class A {\n  /** pinned fork base */\n  m() {}\n}\n'));
    assert.match(green.out, /✓ No residual branding in Resources\//, 'Resources/app/package.json stays excluded');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('verify-branding.sh ends with the failed items, and one ::error annotation on Actions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-verify-'));
  try {
    const app = syntheticApp(dir, `class A {\n${COMMENT_3484}  m() {}\n}\n`);
    const r = verify(app, {GITHUB_ACTIONS: 'true'});
    assert.equal(r.status, 1);
    const tail = r.out.slice(r.out.lastIndexOf('Result:'));
    assert.match(tail, /verify-branding FAILED items:/);
    assert.match(tail, /  - Residual 'codium' found/);
    assert.match(tail, /  - product\.json not found inside \.app/);
    assert.match(tail, /::error title=verify-branding\.sh failed \(\d+ item\(s\)\)::.*Residual 'codium' found/);
    assert.doesNotMatch(verify(app).out, /::error/, 'no annotation outside Actions');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('studio-pr-ci runs the shared script on the bundled extension and webview', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-ci.yml'), 'utf8');
  const job = wf.slice(wf.indexOf('extension-branding:'), wf.indexOf('\n  extension-test-shard:'));
  assert.match(job, /name: extension \/ shipped branding/);
  assert.match(job, /npm run build:extension/);
  assert.match(job, /working-directory: extensions\/hypeproof-chat\/webview-ui\n\s+run: npm run build/);
  assert.match(job, /bash scripts\/check-residual-branding\.sh/);
  for (const p of ['package.json', 'dist', 'media', 'webview-ui/dist']) {
    assert.ok(job.includes(`extensions/hypeproof-chat/${p}`), `scans ${p}`);
  }
  assert.match(job, /node --test scripts\/test\/residual-branding\.test\.mjs/);
});
