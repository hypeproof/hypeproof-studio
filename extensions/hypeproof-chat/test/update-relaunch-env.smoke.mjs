// #3210 — the auto-update relaunch must not inherit the extension host's environment. With
// ELECTRON_RUN_AS_NODE=1 the relaunched Studio runs as plain Node and exits with no window
// (Jay 2026-10-29). Checks: the spawn env helper (positive and negative keys), every installer
// spawn in updateChecker.ts passes it, and both generated scripts clear the variables themselves.
// The real bash run with a stubbed `open` is in update-installer.smoke.mjs.
//
// Run: node --experimental-strip-types test/update-relaunch-env.smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installerEnv, renderInstallerScript, renderWindowsUpdateWrapper } from '../src/updateCheckerHelpers.ts';

const host = {
  PATH: '/usr/bin:/bin', HOME: '/Users/learner', LANG: 'ko_KR.UTF-8', TMPDIR: '/tmp/',
  ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1', VSCODE_PID: '4242', VSCODE_IPC_HOOK: '/tmp/x.sock',
  VSCODE_ESM_ENTRYPOINT: 'vs/workbench/api/node/extensionHostProcess', VSCODE_CRASH_REPORTER_PROCESS_TYPE: 'extensionHost',
  vscode_lowercase: 'x', UNDEF: undefined,
};
const clean = installerEnv(host);
assert.deepEqual(Object.keys(clean).sort(), ['HOME', 'LANG', 'PATH', 'TMPDIR'], 'only ordinary variables survive');
assert.equal(clean.PATH, host.PATH, 'PATH is kept (the installer needs pgrep, ditto, open)');
assert.equal(installerEnv({}).ELECTRON_RUN_AS_NODE, undefined);
assert.equal(host.ELECTRON_RUN_AS_NODE, '1', 'the host env object is not mutated');

// Every installer spawn passes the cleaned env (a new spawn without it fails here).
const src = readFileSync(new URL('../src/updateChecker.ts', import.meta.url), 'utf8');
const starts = [...src.matchAll(/cp\.spawn\(/g)].map(m => m.index);
const spawns = starts.map((at, i) => src.slice(at, Math.min(starts[i + 1] ?? Infinity, at + 400)));
assert.equal(spawns.length, 4, 'the four installer spawns (staged mac/win, explicit mac/win)');
for (const call of spawns) assert.match(call, /env:\s*installerEnv\(process\.env\)/, `spawn without the cleaned env: ${call.slice(0, 80)}`);

// Second guard: the scripts clear the variables before relaunching.
const mac = renderInstallerScript({ newAppPath: '/tmp/n.app', oldAppPath: '/Applications/HypeProof Studio.app', expectedBundleId: 'ai.hypeproof.studio', newVersion: '2026.1029.0', oldVersion: '2026.1020.2', logPath: '/tmp/u.log' });
const clearAt = mac.indexOf('ELECTRON_*|VSCODE_*) unset'), openAt = mac.indexOf('open "$OLD_APP"');
assert.ok(clearAt > 0 && openAt > clearAt, 'mac installer clears ELECTRON_*/VSCODE_* before `open`');
const win = renderWindowsUpdateWrapper({ appProcessName: 'HypeProof Studio', installerPath: 'C:\\t\\Setup.exe', installerArgs: ['/silent'] });
const winClear = win.indexOf("'^(ELECTRON_|VSCODE_)'"), winStart = win.indexOf('Start-Process');
assert.ok(winClear > 0 && winStart > winClear, 'windows wrapper clears ELECTRON_*/VSCODE_* before Setup (which relaunches Studio)');
assert.ok(win.startsWith('\uFEFF'), 'the wrapper keeps its UTF-8 BOM (REQ-I10)');

console.log('PASS update relaunch env (#3210): spawn env helper, all 4 installer spawns, mac/win scripts clear host variables before relaunch');
