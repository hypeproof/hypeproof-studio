#!/usr/bin/env node
// Which platforms a Studio release ships (config/release-platforms.json).
//
// Read at the release's OWN commit, never from the checkout running the gate:
// a release cut before the Mac-only switch (2026-10-19) still requires both OS
// packages and both acceptance receipts. A commit without the file, or one git
// cannot read (shallow clone, unknown sha), resolves to BOTH platforms, the
// stricter answer, so a gate can only fail closed.
//
// CLI (all read-only):
//   platforms.mjs list REV        JSON array of platforms
//   platforms.mjs matrix REV      JSON {include:[{os,platform}]} for a job matrix
//   platforms.mjs missing REV     asset names on stdin; prints each missing package
//                                 label on its own line (nothing = complete). Exits 0
//                                 either way; a nonzero exit is an error, never "complete".
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const ALL_PLATFORMS = ['darwin-arm64', 'win32-x64'];
const CONFIG = 'config/release-platforms.json';
const repository = fileURLToPath(new URL('../../', import.meta.url));

export const PLATFORM = {
  'darwin-arm64': {os: 'macos-15', workflow: 'build-mac.yml',
    assets: [['macOS zip', /^HypeProof-Studio-darwin-arm64\.zip$/]]},
  'win32-x64': {os: 'windows-latest', workflow: 'build-windows.yml',
    assets: [['Windows UserSetup exe', /^HypeProof\.StudioUserSetup-x64-.*\.exe$/],
      ['Windows Setup exe', /^HypeProof\.StudioSetup-x64-.*\.exe$/],
      ['Windows zip', /^HypeProof\.Studio-win32-x64-.*\.zip$/]]},
};

export function parsePlatforms(text) {
  const data = JSON.parse(text);
  const list = data?.platforms;
  if (data?.version !== 1 || !Array.isArray(list) || list.length === 0) throw Error('invalid release platform config');
  if (list.some(p => !ALL_PLATFORMS.includes(p)) || new Set(list).size !== list.length) throw Error('unknown or duplicate release platform');
  return ALL_PLATFORMS.filter(p => list.includes(p));
}

const gitRead = rev => execFileSync('git', ['show', `${rev}:${CONFIG}`],
  {cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});

/** Platforms at REV; BOTH when the file is absent or unreadable. A malformed file throws. */
export function releasePlatforms(rev, read = gitRead) {
  let text;
  try { text = read(rev); } catch { return [...ALL_PLATFORMS]; }
  return parsePlatforms(text);
}

/** Platforms in this checkout; used where the candidate is the checkout (release-cut). */
export function checkoutPlatforms(root = repository) {
  const file = path.join(root, CONFIG);
  return fs.existsSync(file) ? parsePlatforms(fs.readFileSync(file, 'utf8')) : [...ALL_PLATFORMS];
}

export function missingAssets(platforms, names) {
  return platforms.flatMap(p => PLATFORM[p].assets.filter(([, re]) => !names.some(n => re.test(n))).map(([label]) => label));
}

function main() {
  const [command, rev] = process.argv.slice(2);
  if (!rev || !['list', 'matrix', 'missing'].includes(command)) {
    console.error('usage: platforms.mjs list|matrix|missing REV');
    process.exit(2);
  }
  const platforms = releasePlatforms(rev);
  if (command === 'list') console.log(JSON.stringify(platforms));
  else if (command === 'matrix') console.log(JSON.stringify({include: platforms.map(platform => ({os: PLATFORM[platform].os, platform}))}));
  else {
    const names = fs.readFileSync(0, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    const missing = missingAssets(platforms, names);
    if (missing.length) console.log(missing.join('\n'));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main();
