#!/usr/bin/env node
// Public native SDK seed on the release (studio-public-sdk-seed, US-01).
//
// The packaged App vendors the Agent SDK JS but never the per-platform native
// `claude` binary: verify-branding.sh fails a bundle that carries one. Members
// get the binary from the installers (scripts/seed-sdk-binary.{sh,ps1}, npm
// registry). A public-zip user has no installer, so every release also carries
// the unmodified npm tarball for each App platform, a sha256 file beside it,
// and one sdk-seed.json manifest. The tarball is byte-identical to the npm one,
// so `seed-sdk-binary.sh --tarball` still verifies it against the pinned sha512.
//
// Pure judges plus a small CLI used by verify-unified-release.yml:
//   sdk-seed-assets.mjs manifest DIR VERSION   write DIR/sdk-seed.json, then check DIR
//   sdk-seed-assets.mjs check DIR VERSION      bytes: every seed, sha256 and manifest agree
//   sdk-seed-assets.mjs list VERSION < JSON    names: `gh release view --json assets` output
//   sdk-seed-assets.mjs app-version MAC_JSON WIN_JSON
//                                              the vendored SDK package.json of both zips agree
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Platforms a release ships an App for (build-mac.yml, build-windows.yml). */
export const SEED_PLATFORMS = Object.freeze(['darwin-arm64', 'win32-x64']);
export const SEED_MANIFEST_NAME = 'sdk-seed.json';
export const SEED_MANIFEST_SCHEMA = 'hps-sdk-seed/1';
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SEED_RE = /^claude-agent-sdk-([a-z0-9]+-[a-z0-9]+)-(\d+\.\d+\.\d+)\.tgz$/;

export function seedAssetName(platform, version) {
  return `claude-agent-sdk-${platform}-${version}.tgz`;
}

/** Every asset name a release must carry for this SDK version. */
export function expectedSeedAssets(version, platforms = SEED_PLATFORMS) {
  return [...platforms.flatMap(p => [seedAssetName(p, version), `${seedAssetName(p, version)}.sha256`]), SEED_MANIFEST_NAME];
}

/**
 * Judges a release asset list. Reports each missing seed asset and any native
 * seed for another SDK version (a stale seed the App would refuse).
 */
export function seedAssetProblems(names, version, platforms = SEED_PLATFORMS) {
  if (!VERSION_RE.test(version ?? '')) return [`not an SDK version: ${version}`];
  const have = new Set(names);
  const problems = expectedSeedAssets(version, platforms).filter(n => !have.has(n)).map(n => `missing ${n}`);
  for (const name of names) {
    const m = name.replace(/\.sha256$/, '').match(SEED_RE);
    if (m && m[2] !== version) problems.push(`${name} is for SDK ${m[2]}, the App ships ${version}`);
  }
  return problems;
}

/** Parses one `<64 hex>  <name>` line (sha256sum format). */
export function parseSha256File(text) {
  const m = /^([a-f0-9]{64}) [ *]?(\S+)\n?$/.exec(text);
  return m ? {sha256: m[1], name: m[2]} : null;
}

function digest(file, algorithm, encoding) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
}

/** The manifest an in-app or Lab fetcher reads; computed from the staged bytes. */
export function buildSeedManifest(dir, version, platforms = SEED_PLATFORMS) {
  return {
    schema: SEED_MANIFEST_SCHEMA,
    sdkVersion: version,
    seeds: platforms.map(platform => {
      const name = seedAssetName(platform, version), file = path.join(dir, name);
      return {
        platform,
        name,
        size: fs.statSync(file).size,
        sha256: digest(file, 'sha256', 'hex'),
        npmIntegrity: `sha512-${digest(file, 'sha512', 'base64')}`,
      };
    }),
  };
}

/** Judges staged bytes: names, sha256 files and the manifest all describe the same tarballs. */
export function checkSeedDirectory(dir, version, platforms = SEED_PLATFORMS) {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const problems = seedAssetProblems(names, version, platforms);
  if (problems.length) return problems;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, SEED_MANIFEST_NAME), 'utf8')); } catch { return [`${SEED_MANIFEST_NAME} is not JSON`]; }
  if (manifest?.schema !== SEED_MANIFEST_SCHEMA) problems.push(`${SEED_MANIFEST_NAME} schema is ${manifest?.schema}`);
  if (manifest?.sdkVersion !== version) problems.push(`${SEED_MANIFEST_NAME} is for SDK ${manifest?.sdkVersion}, the App ships ${version}`);
  for (const platform of platforms) {
    const name = seedAssetName(platform, version), file = path.join(dir, name);
    const actual = digest(file, 'sha256', 'hex');
    const recorded = parseSha256File(fs.readFileSync(`${file}.sha256`, 'utf8'));
    if (!recorded || recorded.name !== name) problems.push(`${name}.sha256 is not a sha256sum line for ${name}`);
    else if (recorded.sha256 !== actual) problems.push(`${name}.sha256 does not match the tarball bytes`);
    const entry = Array.isArray(manifest?.seeds) ? manifest.seeds.find(s => s?.platform === platform) : undefined;
    if (!entry) problems.push(`${SEED_MANIFEST_NAME} has no ${platform} seed`);
    else if (entry.name !== name || entry.sha256 !== actual || entry.size !== fs.statSync(file).size) problems.push(`${SEED_MANIFEST_NAME} ${platform} entry does not match the tarball`);
  }
  return problems;
}

/** The SDK version both shipped zips vendor; they must agree. */
export function vendoredSdkVersion(...packageJsons) {
  const versions = packageJsons.map(text => { try { return JSON.parse(text).version; } catch { return undefined; } });
  if (!versions.length || versions.some(v => typeof v !== 'string' || !VERSION_RE.test(v))) throw Error('A shipped App vendors no readable Agent SDK version');
  if (new Set(versions).size !== 1) throw Error(`Shipped Apps vendor different Agent SDK versions: ${versions.join(', ')}`);
  return versions[0];
}

function fail(problems) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'manifest' && args.length === 2) {
      const [dir, version] = args;
      const pre = seedAssetProblems(fs.readdirSync(dir).concat(SEED_MANIFEST_NAME), version);
      if (pre.length) fail(pre);
      else {
        fs.writeFileSync(path.join(dir, SEED_MANIFEST_NAME), `${JSON.stringify(buildSeedManifest(dir, version), null, 2)}\n`);
        const problems = checkSeedDirectory(dir, version);
        if (problems.length) fail(problems); else console.log(`PASS staged native SDK seed ${version}: ${SEED_PLATFORMS.join(', ')}`);
      }
    } else if (command === 'check' && args.length === 2) {
      const problems = checkSeedDirectory(...args);
      if (problems.length) fail(problems); else console.log(`PASS native SDK seed bytes ${args[1]}`);
    } else if (command === 'list' && args.length === 1) {
      const release = JSON.parse(fs.readFileSync(0, 'utf8'));
      const names = (release.assets ?? []).map(a => (typeof a === 'string' ? a : a?.name));
      const problems = seedAssetProblems(names, args[0]);
      if (problems.length) fail(problems); else console.log(`PASS release lists the native SDK seed ${args[0]}`);
    } else if (command === 'app-version' && args.length >= 1) {
      process.stdout.write(vendoredSdkVersion(...args.map(f => fs.readFileSync(f, 'utf8'))));
    } else {
      console.error('Usage: sdk-seed-assets.mjs manifest DIR VERSION | check DIR VERSION | list VERSION < release.json | app-version PACKAGE_JSON...');
      process.exitCode = 2;
    }
  } catch (error) {
    fail([error.message]);
  }
}
