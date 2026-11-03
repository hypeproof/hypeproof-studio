// S5. The candidate commit's check-runs on main, including the macOS legs that only run after merge (#1599).
// PASS: every check-run completed and none failed. Still running → NOT_RUN. Read-only (gh api).
// On Actions the release-cut run's own job is a check-run on the same commit; it is left out by its run id.
// Earlier release-cut runs on the same commit are not candidate CI either; they are left out by workflow id (#1845).
// GitHub's dynamic runs (Dependabot updates, which attach to main's head) do not test the candidate's code;
// a failed Dependabot update stopped the 2026-10-29 cut, so they are left out by event.
import {execFileSync} from 'node:child_process';

const BAD = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

export function judge(all, runId, ownWorkflowId) {
  const own = runId ? `/actions/runs/${runId}/` : null;
  const eligible = all.filter(r => !(own && r.url.includes(own)) && !(ownWorkflowId && r.workflowId === ownWorkflowId) && r.event !== 'dynamic');
  const latest = new Map();
  for (const run of eligible) {
    // Only supersede with evidence of the same workflow and job. Names alone
    // collide across workflows; unknown/external checks remain independent.
    const key = run.workflowId ? `${run.workflowId}:${run.name}` : Symbol();
    const previous = latest.get(key);
    if (!previous || run.runNumber > previous.runNumber ||
        (run.runNumber === previous.runNumber && run.runAttempt > previous.runAttempt) ||
        (run.runNumber === previous.runNumber && run.runAttempt === previous.runAttempt && run.id > previous.id)) latest.set(key, run);
  }
  const runs = [...latest.values()];
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
    const raw = execFileSync('gh', ['api', '--paginate', `repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`,
      '--jq', '.check_runs[] | [.id, .name, .status, (.conclusion // ""), (.details_url // "")] | @tsv'], {encoding: 'utf8'});
    const metadata = new Map();
    const ownWorkflowId = env.GITHUB_RUN_ID
      ? JSON.parse(execFileSync('gh', ['api', `repos/${repo}/actions/runs/${env.GITHUB_RUN_ID}`], {encoding: 'utf8'})).workflow_id
      : undefined;
    const runs = raw.trim().split('\n').filter(Boolean).map(line => {
      const [id, name, status, conclusion, url] = line.split('\t');
      const match = url.match(/\/actions\/runs\/(\d+)\//);
      let info = {};
      if (match && match[1] !== env.GITHUB_RUN_ID) {
        if (!metadata.has(match[1])) {
          const action = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/actions/runs/${match[1]}`], {encoding: 'utf8'}));
          if (action.head_sha !== sha || !action.workflow_id || !action.run_number || !action.run_attempt) throw Error('Candidate CI run identity is incomplete or mismatched');
          metadata.set(match[1], {workflowId: action.workflow_id, runNumber: action.run_number, runAttempt: action.run_attempt, event: action.event});
        }
        info = metadata.get(match[1]);
      }
      return {id: Number(id), name, status, conclusion, url, ...info};
    });
    return judge(runs, env.GITHUB_RUN_ID, ownWorkflowId);
  },
};
