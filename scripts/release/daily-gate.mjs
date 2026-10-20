#!/usr/bin/env node
// Daily release-cut gate (REQ-STUDIO-RELEASE-CASEBOOK; docs/operations/release-casebook/README.md).
//
// release-cut.yml runs on a 17:00 KST schedule. This decides what that run does:
//   - a manual dispatch keeps its own inputs (mode defaults to dry-run, as before);
//   - a scheduled run is skipped when RELEASE_CUT_DAILY=off (the pause switch), when no app path
//     changed since the last stable v tag, or when the live-class freeze blocks;
//   - otherwise it cuts with mode=create, or mode=dry-run when RELEASE_CUT_DAILY=dry-run.
// Missing inputs never turn into create: an unknown event or an unrecognised switch value is a dry run
// or a skip.
//
//   node scripts/release/daily-gate.mjs --event schedule --switch "$RELEASE_CUT_DAILY" --live proceed
//   # writes run=true|false, mode=dry-run|create, reason=... to $GITHUB_OUTPUT when set
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {lastStableTag} from './select-cases.mjs';

// Paths whose change reaches an installed Studio. Worker, Chalk, docs, e2e and workflow changes
// ship through their own channels and do not need a new app.
export const APP_PATHS = [
  /^extensions\//,
  /^vscodium-base$/,
  /^assets\/brand\//,
  /^hypeproof-studio\.env\.example$/,
  /^scripts\/(apply-product-overrides|install-brand-assets|run-build|inject-builtin-extensions|seed-sdk-binary)\.sh$/,
  /^scripts\/release\/templates\//,
  /^config\/release-platforms\.json$/,
];

export const appChanged = files => files.filter(f => APP_PATHS.some(re => re.test(f)));

export function decide({event, inputMode, dailySwitch, appFiles, live}) {
  if (event !== 'schedule') {
    const mode = inputMode === 'create' ? 'create' : 'dry-run';
    return {run: true, mode, reason: `${event || 'manual'} run, mode ${mode}`};
  }
  const sw = (dailySwitch ?? '').trim().toLowerCase();
  if (sw === 'off') return {run: false, mode: 'dry-run', reason: 'paused: repository variable RELEASE_CUT_DAILY=off'};
  if (sw !== '' && sw !== 'create' && sw !== 'dry-run') {
    return {run: false, mode: 'dry-run', reason: `paused: RELEASE_CUT_DAILY="${dailySwitch}" is not off, dry-run or create`};
  }
  if (!appFiles || appFiles.length === 0) return {run: false, mode: 'dry-run', reason: 'no app change since the last stable tag'};
  if (live !== 'proceed') return {run: false, mode: 'dry-run', reason: `live-class freeze: ${live || 'not checked'}`};
  const mode = sw === 'dry-run' ? 'dry-run' : 'create';
  return {run: true, mode, reason: `scheduled cut, ${appFiles.length} app file(s) changed, no live class, mode ${mode}`};
}

function main() {
  const args = process.argv.slice(2);
  const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const git = (...a) => execFileSync('git', ['-C', root, ...a], {encoding: 'utf8'}).trim();
  const event = arg('--event') ?? '';
  let appFiles = [];
  if (event === 'schedule') {
    const base = lastStableTag(git);
    appFiles = base ? appChanged(git('diff', '--name-only', `${base}..${arg('--candidate') ?? 'origin/main'}`).split('\n').filter(Boolean)) : [];
    console.log(`app files changed since ${base}: ${appFiles.length}`);
  }
  const d = decide({event, inputMode: arg('--mode'), dailySwitch: arg('--switch'), appFiles, live: arg('--live')});
  console.log(`${d.run ? 'run' : 'skip'}: ${d.reason}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${d.run}\nmode=${d.mode}\nreason=${d.reason}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Release cut gate\n\n${d.run ? 'Run' : 'Skip'}: ${d.reason}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
