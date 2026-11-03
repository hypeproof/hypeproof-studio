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
function pinnedVersion(manifestPath, pkg) {
  const json = readJson(manifestPath);
  const spec = json.dependencies?.[pkg] ?? json.devDependencies?.[pkg];
  if (!spec) return {error: `${manifestPath} does not depend on ${pkg}`};
  if (spec.startsWith('file:')) {
    const m = path.basename(spec).match(new RegExp(`^${tarballName(pkg)}-(\\d+\\.\\d+\\.\\d+)\\.tgz$`));
    return m ? {version: m[1], asset: path.basename(spec)} : {error: `cannot read a version from ${spec}`};
  }
  return /^\d+\.\d+\.\d+$/.test(spec) ? {version: spec} : {error: `not an exact version: ${spec}`};
}

for (const {file, product} of MANIFESTS) {
  test(`${file} declares ${product} with schema hype-release-manifest/1`, () => {
    const m = readJson(file);
    assert.equal(m.schema, 'hype-release-manifest/1');
    assert.equal(m.product, product);
    assert.equal(typeof m.provides, 'object');
    assert.ok(Object.keys(m.requires ?? {}).length > 0, 'a product with no requirements is never checked');
  });

  test(`${file}: every requirement names its Service surface (hypeproof-service#148)`, () => {
    for (const [contract, entry] of Object.entries(readJson(file).requires)) {
      assert.equal(entry.surface, contract, `${contract}: surface must equal the contract name`);
    }
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
