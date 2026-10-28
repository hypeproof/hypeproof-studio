#!/usr/bin/env node
// Acquire pinned private Service packages without copying their IP into Studio Git.
// Tokens are consumed only by authenticated gh; no credential enters URLs or locks.
import { createHash } from 'node:crypto';
import { readFile, mkdir, lstat, mkdtemp, rename, rm, appendFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const run = promisify(execFile);
const repo = 'hypeproof/hypeproof-service';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safeAsset = /^hypeproof-(measurement-core|measurement|service-contracts|service-testkit|companion-client)-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/;

async function authenticatedDownload(spec, destination) {
  try {
    await run('gh', ['release', 'download', spec.tag, '--repo', repo, '--pattern', spec.asset, '--dir', destination], { timeout: 120000, maxBuffer: 1024 * 1024 });
  } catch { throw new Error('Private Service package download failed. Authenticate gh with read access to hypeproof/hypeproof-service; CI requires HYPEPROOF_READ_TOKEN.'); }
}

export async function bootstrapServicePackages({ root = repositoryRoot, manifest, download = authenticatedDownload } = {}) {
  const pins = manifest ?? JSON.parse(await readFile(join(root, 'config/service-packages.json'), 'utf8'));
  if (pins.version !== 1 || pins.repository !== repo || !Array.isArray(pins.packages) || pins.packages.length !== (pins.packages.some(spec => /^hypeproof-companion-client-/.test(spec?.asset ?? '')) ? 6 : 5)) throw new Error('Invalid private Service package manifest');
  const assets = new Set();
  for (const spec of pins.packages) {
    if (!spec || !safeAsset.test(spec.asset) || !/^[a-f0-9]{64}$/.test(spec.sha256) || typeof spec.tag !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,100}$/.test(spec.tag) || assets.has(spec.asset)) throw new Error('Invalid private Service package pin');
    assets.add(spec.asset);
  }
  const cache = join(root, '.private-service-cache');
  await mkdir(cache, { recursive: true, mode: 0o700 });
  if (!(await lstat(cache)).isDirectory()) throw new Error('Private Service cache must be a regular directory');
  for (const spec of pins.packages) {
    const target = join(cache, spec.asset);
    let exists = false;
    try {
      const stat = await lstat(target);
      if (!stat.isFile()) throw new Error('Private Service cached artifact must be a regular file');
      exists = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      if (digest(await readFile(target)) !== spec.sha256) throw new Error('Private Service cached artifact SHA256 mismatch; remove the cache entry and bootstrap again.');
      continue;
    }
    const staging = await mkdtemp(join(cache, '.download-'));
    try {
      try { await download(spec, staging); }
      catch { throw new Error('Private Service package download failed. Authenticate gh with Service read access.'); }
      const staged = join(staging, spec.asset);
      if (!(await lstat(staged)).isFile() || digest(await readFile(staged)) !== spec.sha256) throw new Error('Private Service downloaded artifact SHA256 mismatch');
      await rename(staged, target);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  return pins.packages.length;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    // setup-node caches the default npm directory. Keep private tarball bytes in
    // this job's ephemeral cache instead of persisting them in Studio Actions cache.
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_ENV && process.env.RUNNER_TEMP) {
      const ephemeral = join(process.env.RUNNER_TEMP, 'hypeproof-private-npm-cache');
      if (/[\r\n]/.test(ephemeral)) throw new Error('Invalid runner temporary directory');
      await appendFile(process.env.GITHUB_ENV, `NPM_CONFIG_CACHE=${ephemeral}\n`);
    }
    console.log(`Verified ${await bootstrapServicePackages()} pinned private Service packages in ignored local cache.`);
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
