// Controls for the release platform switch (config/release-platforms.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import {ALL_PLATFORMS, parsePlatforms, releasePlatforms, checkoutPlatforms, missingAssets} from '../platforms.mjs';

const config = platforms => JSON.stringify({version: 1, platforms});
const mac = 'HypeProof-Studio-darwin-arm64.zip';
const win = ['HypeProof.StudioUserSetup-x64-1.116.1.exe', 'HypeProof.StudioSetup-x64-1.116.1.exe', 'HypeProof.Studio-win32-x64-1.116.1.zip'];

test('a commit without the file, or an unreadable one, requires both platforms (fail closed)', () => {
  assert.deepEqual(releasePlatforms('v0', () => { throw Error('fatal: path does not exist'); }), ALL_PLATFORMS);
});

test('Mac-only config yields Mac only; order is canonical', () => {
  assert.deepEqual(releasePlatforms('x', () => config(['darwin-arm64'])), ['darwin-arm64']);
  assert.deepEqual(parsePlatforms(config(['win32-x64', 'darwin-arm64'])), ALL_PLATFORMS);
});

test('malformed config throws instead of silently narrowing the gate', () => {
  for (const bad of ['{', config([]), config(['linux-x64']), config(['darwin-arm64', 'darwin-arm64']), JSON.stringify({platforms: ['darwin-arm64']})]) {
    assert.throws(() => releasePlatforms('x', () => bad));
  }
});

test('missing package labels follow the platform set', () => {
  assert.deepEqual(missingAssets(['darwin-arm64'], [mac, 'install.sh']), []);
  assert.deepEqual(missingAssets(['darwin-arm64'], ['install.sh']), ['macOS zip']);
  assert.deepEqual(missingAssets(ALL_PLATFORMS, [mac]), ['Windows UserSetup exe', 'Windows Setup exe', 'Windows zip']);
  assert.deepEqual(missingAssets(ALL_PLATFORMS, [mac, ...win]), []);
});

test('this checkout ships Mac and Windows (2026-10-20 decision)', () => {
  assert.deepEqual(checkoutPlatforms(), ['darwin-arm64', 'win32-x64']);
});
