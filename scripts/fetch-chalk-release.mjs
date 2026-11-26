#!/usr/bin/env node
// Acquire the pinned Chalk release vsix (config/chalk-release.json) for a Studio macOS build.
//
// ship=false: nothing is downloaded or read beyond the manifest itself. The build
// installs no Chalk (scripts/install-chalk-extension.sh removes any leftover copy).
// ship=true: the asset is fetched with an authenticated `gh release download`, checked
// against the pinned size, sha256 and the version inside the vsix, and only then kept
// in the ignored cache. Nothing unverified is ever installed.
//
// This is a copy of the acquisition pattern in bootstrap-service-packages.mjs, kept
// separate on purpose so the Service pin path does not change (C-4 decision B).
//
// CLI:
//   node scripts/fetch-chalk-release.mjs --print-ship   prints true|false (manifest only)
//   node scripts/fetch-chalk-release.mjs --print-version prints the pinned version (manifest only)
//   node scripts/fetch-chalk-release.mjs --print-vsix   fetches if needed, prints the verified path (ship=true only)
//   node scripts/fetch-chalk-release.mjs                fetches if needed and logs
// Env (tests and overrides): CHALK_RELEASE_MANIFEST, CHALK_CACHE_DIR.
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const repository = 'hypeproof/hypeproof-chalk';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const tagPattern = /^chalk-v(\d+\.\d+\.\d+)$/;
const assetPattern = /^hypeproof-chalk-(\d+\.\d+\.\d+)\.vsix$/;

export function invalidManifest() {
  return new Error('Invalid Chalk release manifest');
}

export async function loadManifest(manifestPath) {
  const pins = JSON.parse(await readFile(manifestPath, 'utf8'));
  const release = pins?.release;
  if (pins?.version !== 1 || pins.repository !== repository || typeof pins.ship !== 'boolean' || !release || typeof release !== 'object') throw invalidManifest();
  const tag = tagPattern.exec(release.tag ?? '');
  const asset = assetPattern.exec(release.asset ?? '');
  if (!tag || !asset || !/^\d+\.\d+\.\d+$/.test(release.version ?? '')) throw invalidManifest();
  if (tag[1] !== release.version || asset[1] !== release.version) throw invalidManifest();
  if (!/^[a-f0-9]{64}$/.test(release.sha256 ?? '') || !Number.isSafeInteger(release.size) || release.size <= 0) throw invalidManifest();
  return { ship: pins.ship, repository, ...release };
}

async function versionInVsix(file) {
  let text;
  try {
    ({ stdout: text } = await run('unzip', ['-p', file, 'extension/package.json'], { maxBuffer: 1024 * 1024 }));
  } catch { throw new Error('Chalk vsix has no extension/package.json'); }
  return JSON.parse(text).version;
}

async function verifiedFile(file, release) {
  let stat;
  try {
    stat = await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Chalk release artifact was not downloaded');
    throw error;
  }
  if (!stat.isFile()) throw new Error('Chalk release artifact must be a regular file');
  const bytes = await readFile(file);
  if (bytes.length !== release.size) throw new Error('Chalk release artifact size mismatch');
  if (digest(bytes) !== release.sha256) throw new Error('Chalk release artifact SHA256 mismatch');
  if ((await versionInVsix(file)) !== release.version) throw new Error('Chalk release artifact version mismatch');
  return file;
}

async function ensureCacheDir(cacheDir) {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  if (!(await lstat(cacheDir)).isDirectory()) throw new Error('Chalk release cache must be a regular directory');
}

export async function authenticatedDownload({ tag, asset, dir }) {
  try {
    await run('gh', ['release', 'download', tag, '--repo', repository, '--pattern', asset, '--dir', dir], { timeout: 120000, maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error('Chalk release download failed. Authenticate gh with read access to hypeproof/hypeproof-chalk.');
  }
}

// Returns { ship: false } without any I/O beyond the manifest, or { ship: true, vsixPath }.
export async function fetchChalkRelease({
  manifestPath = join(repositoryRoot, 'config/chalk-release.json'),
  cacheDir = join(repositoryRoot, '.private-chalk-cache'),
  download = authenticatedDownload,
} = {}) {
  const release = await loadManifest(manifestPath);
  if (!release.ship) return { ship: false };
  await ensureCacheDir(cacheDir);
  const target = join(cacheDir, release.asset);
  let cached = false;
  try {
    await lstat(target);
    cached = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (cached) return { ship: true, vsixPath: await verifiedFile(target, release) };

  const staging = await mkdtemp(join(cacheDir, '.download-'));
  try {
    try {
      await download({ repository, tag: release.tag, asset: release.asset, dir: staging });
    } catch {
      throw new Error('Chalk release download failed. Authenticate gh with read access to hypeproof/hypeproof-chalk.');
    }
    const staged = join(staging, release.asset);
    await verifiedFile(staged, release);
    await rename(staged, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { ship: true, vsixPath: target };
}

async function main(argv) {
  const manifestPath = process.env.CHALK_RELEASE_MANIFEST || join(repositoryRoot, 'config/chalk-release.json');
  const cacheDir = process.env.CHALK_CACHE_DIR || join(repositoryRoot, '.private-chalk-cache');
  if (argv.includes('--print-ship')) {
    process.stdout.write(`${(await loadManifest(manifestPath)).ship}\n`);
    return;
  }
  if (argv.includes('--print-version')) {
    process.stdout.write(`${(await loadManifest(manifestPath)).version}\n`);
    return;
  }
  const result = await fetchChalkRelease({ manifestPath, cacheDir });
  if (argv.includes('--print-vsix')) {
    if (result.ship) process.stdout.write(`${result.vsixPath}\n`);
    return;
  }
  console.error(result.ship ? `Chalk release verified: ${result.vsixPath}` : 'Chalk release not shipped (ship=false); nothing fetched.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
