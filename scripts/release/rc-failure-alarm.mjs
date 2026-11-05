import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PLATFORM} from './platforms.mjs';
import {buildDispatches} from './build-contract.mjs';

const repository = 'hypeproof/hypeproof-studio';
const schema = 'hps-rc-build-alarm-intent/1';
const limit = 64 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0;
const result = (decision, reason) => ({schema, decision, reason});

// This is an intent classifier, not delivery or remote duplicate suppression.
export function classify(input) {
  const run = input?.workflow_run;
  if (!object(input) || !object(input.repository) || !object(run) ||
      !object(run.repository) || !object(run.head_repository) ||
      ![input.repository.full_name, run.repository.full_name, run.head_repository.full_name,
        run.path, run.event, run.head_branch, run.status, run.head_sha, run.html_url].every(string) ||
      typeof run.id !== 'number' || typeof run.run_attempt !== 'number' ||
      !(string(run.conclusion) || (run.conclusion === null && run.status !== 'completed'))) {
    return result('REJECT', 'invalid_input');
  }
  if ([input.repository.full_name, run.repository.full_name, run.head_repository.full_name]
    .some(name => name !== repository)) return result('REJECT', 'repository_mismatch');
  if (!Number.isSafeInteger(run.id) || run.id <= 0 ||
      !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0 ||
      !/^[a-f0-9]{40}$/.test(run.head_sha) ||
      run.html_url !== `https://github.com/${repository}/actions/runs/${run.id}`) {
    return result('REJECT', 'invalid_run_identity');
  }
  const platform = Object.keys(PLATFORM).find(key =>
    run.path === `.github/workflows/${PLATFORM[key].workflow}`);
  if (!platform) return result('IGNORE', 'out_of_scope_workflow');
  if (!['workflow_dispatch', 'push'].includes(run.event)) return result('IGNORE', 'out_of_scope_event');
  if (run.status !== 'completed') return result('IGNORE', 'not_completed');
  const marker = run.head_branch.indexOf('-rc.');
  if (marker === -1) return result('IGNORE', 'not_rc_tag');
  try {
    buildDispatches({candidate: run.head_sha, rcTag: run.head_branch,
      version: run.head_branch.slice(0, marker)}, {platforms: [platform]});
  } catch {
    return result('REJECT', 'invalid_rc_contract');
  }
  if (run.conclusion === 'success') return result('IGNORE', 'successful_build');
  if (run.conclusion !== 'failure') return result('UNDETERMINED', 'unclassified_conclusion');
  return {...result('ALARM', 'rc_build_failure'), repository, platform,
    run: {id: run.id, attempt: run.run_attempt, workflowHeadSha: run.head_sha,
      tag: run.head_branch, url: run.html_url},
    alarm: {title: 'Daily release cut skipped: needs attention',
      dedupeKey: `${repository}:workflow-run:${run.id}:attempt:${run.run_attempt}`}};
}

async function main() {
  let output;
  try {
    const chunks = [];
    let bytes = 0;
    // Drain oversized input to EOF without retaining more than the input cap.
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes <= limit) chunks.push(chunk);
    }
    if (process.argv.length !== 2 || bytes > limit) throw new Error('invalid input');
    const text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
    output = classify(JSON.parse(text));
  } catch {
    output = result('REJECT', 'invalid_input');
  }
  process.exitCode = output.decision === 'REJECT' ? 2 : output.decision === 'UNDETERMINED' ? 3 : 0;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
