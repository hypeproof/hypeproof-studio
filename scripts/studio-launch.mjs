#!/usr/bin/env node
// Thin CLI over scripts/lib/studio-launcher.mjs for shell and Python harnesses.
//
//   node scripts/studio-launch.mjs run --label NAME --secret-storage inmemory|os [--quiet offscreen|caller] [--foreground] -- <app binary> [args...]
//       Launch in the background, wait for the app to exit (or for SIGINT/SIGTERM),
//       then kill the run's process tree, remove its dirs and verify. Exit 1 on leftovers.
//   node scripts/studio-launch.mjs sweep [--dry-run] [--owner-tree PID] [--apps] [--json]
//       Clean runs whose owner process is dead. --owner-tree also cleans runs owned
//       by PID or its descendants (a suite being aborted). Never touches other runs.
//       --apps also removes cached LSUIElement app copies that no process uses.
//   node scripts/studio-launch.mjs check --session ID
//       Fail (exit 1) when a run or owned dir of the session is still there; it is swept.
//   node scripts/studio-launch.mjs list [--json]
//   node scripts/studio-launch.mjs root
import { createStudioRun, launchRoot, listRuns, ownerAlive, spawnStudio, sweep, verifySession } from './lib/studio-launcher.mjs';

const argv = process.argv.slice(2);
const command = argv.shift();
const flag = name => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const bool = name => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const fail = message => { process.stderr.write(`studio-launch: ${message}\n`); process.exit(2); };

if (command === 'run') {
  const sep = argv.indexOf('--');
  if (sep < 0 || sep === argv.length - 1) fail('usage: run --label NAME --secret-storage inmemory|os -- <app binary> [args...]');
  const app = argv.splice(sep).slice(1);
  const label = flag('--label') || 'cli';
  const secretStorage = flag('--secret-storage');
  const quiet = flag('--quiet') || 'offscreen';
  const foreground = bool('--foreground');
  const run = createStudioRun({ label, secretStorage, quiet, foreground });
  const child = spawnStudio(app[0], app.slice(1), { stdio: 'inherit' }, run);
  process.stderr.write(`studio-launch: run ${run.id} pid ${child.pid} (manifest ${run.manifestPath})\n`);
  const stop = () => { try { child.kill('SIGTERM'); } catch { /* gone */ } };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const code = await new Promise(resolve => child.on('exit', (c, s) => resolve(c ?? (s ? 1 : 0))));
  try { await run.cleanup(); } catch (error) { process.stderr.write(error.message + '\n'); process.exit(1); }
  process.exit(code);
} else if (command === 'sweep') {
  const ownerTree = flag('--owner-tree');
  const report = sweep({ apps: bool('--apps'), dryRun: bool('--dry-run'), ownerTree: ownerTree ? Number(ownerTree) : null, log: m => process.stderr.write(m + '\n') });
  if (bool('--json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else process.stdout.write(`swept ${report.cleaned.length} run(s), ${report.dirs.length} dir(s), ${report.apps.length} app copy(ies); skipped ${report.skipped.length}; failed ${report.failed.length}\n`);
  process.exit(report.failed.length ? 1 : 0);
} else if (command === 'check') {
  const session = flag('--session') || process.env.HPS_LAUNCH_SESSION;
  if (!session) fail('check needs --session ID or HPS_LAUNCH_SESSION');
  const problems = verifySession(session);
  for (const p of problems) process.stderr.write(`studio-launch: leftover ${p}\n`);
  process.exit(problems.length ? 1 : 0);
} else if (command === 'list') {
  const runs = listRuns().map(({ id, manifest }) => ({ id, status: manifest?.status ?? 'no manifest', owner: manifest?.owner?.pid ?? null, ownerAlive: manifest ? ownerAlive(manifest.owner) : null, pids: manifest?.pids ?? [], ports: manifest?.ports ?? [] }));
  if (bool('--json')) process.stdout.write(JSON.stringify(runs, null, 2) + '\n');
  else for (const r of runs) process.stdout.write(`${r.id}\t${r.status}\towner ${r.owner}${r.ownerAlive ? ' (alive)' : ''}\tpids ${r.pids.join(',')}\n`);
} else if (command === 'root') {
  process.stdout.write(launchRoot() + '\n');
} else {
  fail('commands: run, sweep, check, list, root');
}
