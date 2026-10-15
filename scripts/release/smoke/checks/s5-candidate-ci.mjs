// S5. The candidate commit's check-runs on main, including the macOS legs that only run after merge (#1599).
// PASS: every check-run completed and none failed. Still running → NOT_RUN. Read-only (gh api).
// On Actions the release-cut run's own job is a check-run on the same commit; it is left out by its run id.
import {execFileSync} from 'node:child_process';

const BAD = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

export function judge(all, runId) {
  const own = runId ? `/actions/runs/${runId}/` : null;
  const runs = own ? all.filter(r => !r.url.includes(own)) : all;
  if (runs.length === 0) return {result: 'NOT_RUN', detail: 'no check-runs'};
  const failed = runs.filter(r => BAD.has(r.conclusion));
  const pending = runs.filter(r => r.status !== 'completed');
  const macos = runs.filter(r => /mac/i.test(r.name)).length;
  if (failed.length) return {result: 'FAIL', detail: `${failed.length} failed: ${failed.map(r => r.name).join(', ')}`};
  if (pending.length) return {result: 'NOT_RUN', detail: `${pending.length} running: ${pending.map(r => r.name).join(', ')}`};
  return {result: 'PASS', detail: `${runs.length} check-runs passed (${macos} macOS)`};
}

export default {
  id: 'S5',
  name: 'Candidate CI',
  async run({repo, sha, env = process.env}) {
    const raw = execFileSync('gh', ['api', '--paginate', `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
      '--jq', '.check_runs[] | [.name, .status, (.conclusion // ""), (.details_url // "")] | @tsv'], {encoding: 'utf8'});
    const runs = raw.trim().split('\n').filter(Boolean).map(line => {
      const [name, status, conclusion, url] = line.split('\t');
      return {name, status, conclusion, url};
    });
    return judge(runs, env.GITHUB_RUN_ID);
  },
};
