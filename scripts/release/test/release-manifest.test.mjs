// Controls for the release manifests that the Harness release-deps engine reads
// (hypeproof-harness scripts/release-deps/). Each manifest must resolve, from this
// checkout alone, to the contract line the shipped artifact was built against.
//   node --test scripts/release/test/release-manifest.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// Must match the product ids in hypeproof-harness config/release-deps.json.
const MANIFESTS = [
  {file: 'release.json', product: 'studio'},
  {file: 'chalk/release.json', product: 'chalk'},
];

// npm pack names @scope/name as scope-name-X.Y.Z.tgz.
const tarballName = pkg => pkg.replace(/^@/, '').replace('/', '-');

// The engine's consumer form: the version of `pkg` pinned in that package.json.
function pinnedVersion(manifestPath, pkg, json = readJson(manifestPath)) {
  const specs = [json.dependencies?.[pkg], json.devDependencies?.[pkg]].filter(spec => spec !== undefined);
  if (!specs.length) return {error: `${manifestPath} does not depend on ${pkg}`};
  const pins = specs.map(spec => {
    if (typeof spec !== 'string') return {error: 'package pin must be a string'};
    if (!spec.startsWith('file:')) return /^\d+\.\d+\.\d+$/.test(spec) ? {version: spec} : {error: `not an exact version: ${spec}`};
    const asset = path.basename(spec), prefix = tarballName(pkg) + '-';
    const version = asset.startsWith(prefix) && asset.endsWith('.tgz') ? asset.slice(prefix.length, -4) : '';
    return /^\d+\.\d+\.\d+$/.test(version) ? {version, asset} : {error: `cannot read a version from ${spec}`};
  });
  const invalid = pins.find(pin => pin.error);
  if (invalid) return invalid;
  if (new Set(pins.map(pin => pin.version)).size !== 1) return {error: `${pkg}: mixed dependency/devDependency pins`};
  return pins.find(pin => pin.asset) ?? pins[0];
}

function serviceRequirements(manifest, product) {
  const requirements = manifest.requires;
  assert.ok(requirements && typeof requirements === 'object' && !Array.isArray(requirements));
  if (product === 'studio') {
    assert.deepEqual(requirements['studio-api'], {
      package: '@hypeproof/service-contracts', manifest: 'extensions/hypeproof-chat/package.json', surface: 'studio-api',
    }, 'studio-api must retain its package, manifest and surface pin');
    assert.deepEqual(requirements['account-api'], {line: '3'}, 'synthetic records require exactly account-api@3');
  }
  for (const [contract, entry] of Object.entries(requirements)) {
    if (product === 'studio' && contract === 'account-api') continue; // Exact literal form was checked above.
    assert.deepEqual(Object.keys(entry).sort(), ['manifest', 'package', 'surface'], `${contract}: package surface form required`);
    assert.equal(entry.surface, contract, `${contract}: surface must equal the contract name`);
  }
}

for (const {file, product} of MANIFESTS) {
  test(`${file} declares ${product} with schema hype-release-manifest/1`, () => {
    const m = readJson(file);
    assert.equal(m.schema, 'hype-release-manifest/1');
    assert.equal(m.product, product);
    assert.equal(typeof m.provides, 'object');
    assert.ok(Object.keys(m.requires ?? {}).length > 0, 'a product with no requirements is never checked');
  });

  test(`${file}: requirements preserve package surfaces and the exact personal-record account line`, () => {
    serviceRequirements(readJson(file), product);
  });

  test(`${file}: every package requirement resolves to a released Service package`, () => {
    const released = new Set(readJson('config/service-packages.json').packages.map(p => p.asset));
    for (const [contract, entry] of Object.entries(readJson(file).requires)) {
      if (!entry.package) continue;
      const pin = pinnedVersion(entry.manifest, entry.package);
      assert.ok(pin.version, `${contract}: ${pin.error}`);
      // A tarball the bootstrap does not download is not what CI or the release built.
      if (pin.asset) assert.ok(released.has(pin.asset), `${contract}: ${pin.asset} is not in config/service-packages.json`);
    }
  });
}

test('negative control: a requirement on a package the manifest does not pin fails', () => {
  assert.match(pinnedVersion('chalk/package.json', '@hypeproof/not-a-package').error, /does not depend/);
});


test('negative controls: missing or downgraded personal-record account requirement fails', () => {
  for (const account of [undefined, {line: '1'}, {line: '2'}, {line: 3}]) {
    const manifest = structuredClone(readJson('release.json'));
    if (account === undefined) delete manifest.requires['account-api'];
    else manifest.requires['account-api'] = account;
    assert.throws(() => serviceRequirements(manifest, 'studio'), /exactly account-api@3/);
  }
});

test('negative controls: mixed account pins and unknown literal requirements fail', () => {
  for (const extra of [{surface: 'account-api'}, {package: '@hypeproof/service-contracts'}, {also: ['1']}]) {
    const manifest = structuredClone(readJson('release.json'));
    Object.assign(manifest.requires['account-api'], extra);
    assert.throws(() => serviceRequirements(manifest, 'studio'), /exactly account-api@3/);
  }
  const manifest = structuredClone(readJson('release.json'));
  manifest.requires['unknown-api'] = {line: '2'};
  assert.throws(() => serviceRequirements(manifest, 'studio'), /package surface form required/);
});

test('negative controls: metadata literal never substitutes for original package surface pins', () => {
  for (const replacement of [undefined, {line: '2'}, {package: '@hypeproof/service-contracts', manifest: 'extensions/hypeproof-chat/package.json', surface: 'account-api'}]) {
    const manifest = structuredClone(readJson('release.json'));
    if (replacement === undefined) delete manifest.requires['studio-api'];
    else manifest.requires['studio-api'] = replacement;
    assert.throws(() => serviceRequirements(manifest, 'studio'), /studio-api must retain/);
  }
  const chalk = structuredClone(readJson('chalk/release.json'));
  chalk.requires['chalk-admin'].surface = 'account-api';
  assert.throws(() => serviceRequirements(chalk, 'chalk'), /surface must equal/);
});

test('negative control: differing dependency and devDependency package pins fail', () => {
  const pkg = '@hypeproof/service-contracts';
  const mixed = {dependencies: {[pkg]: '0.1.0'}, devDependencies: {[pkg]: 'file:cache/hypeproof-service-contracts-0.2.0.tgz'}};
  assert.match(pinnedVersion('fixture/package.json', pkg, mixed).error, /mixed dependency\/devDependency pins/);
  mixed.devDependencies[pkg] = 'file:cache/hypeproof-service-contracts-0.1.0.tgz';
  assert.equal(pinnedVersion('fixture/package.json', pkg, mixed).version, '0.1.0', 'equivalent exact pins remain supported');
});
