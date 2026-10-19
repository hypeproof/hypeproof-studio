#!/usr/bin/env node
// Explicit local events only: no timers, gh, model calls, build dispatch or publication.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest, validatePolicy, readiness, approvalRequest, manifestFor, validateIntent} from './core.mjs';
import {inspectFile, checkFile, ingest, transact, atomicWrite} from './store.mjs';

const usage = `Release coordinator (local, no network effects)
  node scripts/release/engine/cli.mjs <command> --store DIR --policy FILE [options]

  init             --plan release-cut/plan.json --inputs pinned-inputs.json
  artifact         --candidate ID --artifact ID --file PATH --event ID
  ingest           --event-file FILE (quota, signed evidence, settlement, approval, failure)
  manifest         --candidate ID
  status           --candidate ID
  approval-request --candidate ID --expires ISO_TIME [--channel canary|stable]
  promote-intent   --candidate ID --event ID [--channel canary|stable]
  check-intent     --intent FILE --tag VERSION --sha CANDIDATE_SHA

Use --out FILE to save the result (exclusive managed output path).
All BLOCKED results exit 2. Intent is not publication or durable remote authority.
See docs/dev/release-engine.md for schemas, trust boundaries and examples.`;

export function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { console.log(usage); return 0; }
  const command = args[0];
  const flag = (name, optional = false) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) {
      if (optional) return undefined;
      throw new Error(`--${name} required`);
    }
    return args[i + 1];
  };
  const json = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
  const directory = path.resolve(flag('store'));
  const policy = validatePolicy(json(flag('policy')));
  const now = Date.now();
  let result;
  if (command === 'init') {
    const plan = json(flag('plan'));
    const inputs = json(flag('inputs'));
    const event = {id: `cut-${digest({plan, inputs})}`, type: 'candidate.requested', data: {plan, inputs}};
    result = ingest(directory, event, policy, {now});
  } else if (command === 'artifact') {
    const artifactId = flag('artifact');
    const target = policy.requiredArtifacts.find(a => a.id === artifactId)?.target;
    result = ingest(directory, {id: flag('event'), type: 'artifact.recorded', data: {candidateId: flag('candidate'), artifact: {id: artifactId, target, ...inspectFile(flag('file'))}}}, policy, {now});
  } else if (command === 'ingest') {
    result = ingest(directory, json(flag('event-file')), policy, {now});
  } else if (command === 'promote-intent') {
    result = ingest(directory, {id: flag('event'), type: 'promotion.requested', data: {candidateId: flag('candidate'), ...(flag('channel', true) ? {channel: flag('channel')} : {})}}, policy, {now});
  } else if (command === 'check-intent') {
    const value = json(flag('intent'));
    const intent = value.intent ?? value;
    if (intent.version !== flag('tag') || intent.candidate !== flag('sha')) throw new Error('publisher tag/SHA does not match intent');
    result = transact(directory, state => ({state, result: validateIntent(state, intent, policy, now, checkFile)}));
  } else if (['manifest', 'status', 'approval-request'].includes(command)) {
    // Keep the snapshot and file revalidation under the same single-host lock.
    result = transact(directory, state => {
      const candidateId = flag('candidate');
      let output;
      if (command === 'status') output = readiness(state, candidateId, policy, now, checkFile);
      if (command === 'approval-request') output = approvalRequest(state, candidateId, policy, flag('expires'), now, checkFile, {channel: flag('channel', true)});
      if (command === 'manifest') {
        const item = Object.hasOwn(state.candidates, candidateId) && state.candidates[candidateId];
        if (!item) throw new Error('unknown candidate');
        const manifest = manifestFor(item, policy);
        output = {manifest, manifestDigest: digest(manifest)};
      }
      return {state, result: output};
    });
  } else throw new Error(`unknown command ${command}`);
  const output = flag('out', true);
  if (output) {
    if (fs.existsSync(output)) throw new Error('--out must not overwrite an existing file');
    atomicWrite(path.resolve(output), result);
  }
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'BLOCKED' || result.status === 'QUOTA_BLOCKED' ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(JSON.stringify({status: 'BLOCKED', reason: error.message})); process.exitCode = 2; }
}
