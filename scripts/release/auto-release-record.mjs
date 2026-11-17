// The automatic release authority record (hps-auto-release/1) and the evidence records it reads.
// Pure: no GitHub, git or file access. Shared by auto-release.mjs (writes the record after every gate
// passed), publish-gate.mjs and promote.mjs (accept the record in place of a human approval).
//
// Policy: config/release-auto.json. Decision: hypeprooflab docs/decisions/2026-11-16-studio-auto-release.md.

export const AUTO_SCHEMA = 'hps-auto-release/1';
export const KIT_SCHEMA = 'hps-blackbox-kit/1';
export const DEPS_SCHEMA = 'hps-release-deps/1';

// Every gate the pipeline checks on the exact candidate. A record that lacks one, or reports anything but
// PASS for one, grants nothing.
export const REQUIRED_GATES = [
  'kill-switch', 'release-pr', 'required-ci', 'acceptance', 'notarization', 'blockers',
  'blackbox-kit', 'casebook', 'holds', 'release-deps', 'freeze',
];

const SHA = /^[0-9a-f]{40}$/;

// The JSON block of a comment that declares `schema`, or null.
export function jsonBlock(body, schema) {
  for (const m of String(body ?? '').matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
    if (!m[1].includes(schema)) continue;
    try { const v = JSON.parse(m[1]); if (v?.schema === schema) return v; } catch { /* not this block */ }
  }
  return null;
}

// Latest comment by one of `authors` declaring `schema` and posted at or after `since` (the head commit
// date), parsed; or null. Ordering is by created_at so an older result cannot mask a newer one.
export function latestRecord({comments = [], schema, authors, since}) {
  const ordered = [...comments].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const c of ordered) {
    if (!authors.includes(c.user)) continue;
    if (since && String(c.created_at) < String(since)) continue;
    const record = jsonBlock(c.body, schema);
    if (record) return {...record, _url: c.url, _at: c.created_at};
  }
  return null;
}

// Did the pipeline record that every gate passed on this PR head and candidate?
//   pr: {number, head, headDate, comments}; candidate: the rc commit (tag commit); pipeline: [login]
export function autoAuthority({pr, candidate, pipeline}) {
  const record = latestRecord({comments: pr.comments, schema: AUTO_SCHEMA, authors: pipeline, since: pr.headDate});
  if (!record) return {ok: false, reason: `#${pr.number}: no ${AUTO_SCHEMA} record from ${pipeline.join(' or ')} at the head`};
  if (record.pr !== pr.number) return {ok: false, reason: `#${pr.number}: ${AUTO_SCHEMA} record is for #${record.pr}`};
  if (record.head_sha !== pr.head) return {ok: false, reason: `#${pr.number}: ${AUTO_SCHEMA} record is for head ${String(record.head_sha).slice(0, 8)}, not ${String(pr.head).slice(0, 8)}`};
  if (!SHA.test(record.candidate ?? '') || record.candidate !== candidate) return {ok: false, reason: `#${pr.number}: ${AUTO_SCHEMA} record is for candidate ${String(record.candidate).slice(0, 8)}, not ${String(candidate).slice(0, 8)}`};
  const byId = new Map((record.gates ?? []).map(g => [g.id, g.status]));
  const missing = REQUIRED_GATES.filter(id => byId.get(id) !== 'PASS');
  if (missing.length) return {ok: false, reason: `#${pr.number}: ${AUTO_SCHEMA} record does not pass ${missing.join(', ')}`};
  return {ok: true, record, reason: `#${pr.number}: automatic release, every gate PASS (${record._url})`};
}

// The black-box kit result (Harness tests/blackbox/studio-continuation) for this candidate.
//   PASS when the latest trusted record names the candidate and every required scenario is PASS.
export function kitEvidence({pr, candidate, reporters, required}) {
  const r = latestRecord({comments: pr.comments, schema: KIT_SCHEMA, authors: reporters, since: pr.headDate});
  if (!r) return {status: 'WAIT', detail: `no ${KIT_SCHEMA} result from ${reporters.join(' or ')} since the head commit`};
  if (r.candidate !== candidate) return {status: 'WAIT', detail: `latest ${KIT_SCHEMA} result is for ${String(r.candidate).slice(0, 8)}, not ${candidate.slice(0, 8)}`};
  const results = new Map(Object.entries(r.scenarios ?? {}));
  const failed = [...results].filter(([, v]) => v !== 'PASS').map(([k]) => k);
  if (failed.length) return {status: 'FAIL', detail: `black-box kit FAIL: ${failed.join(', ')} (${r._url})`};
  const missing = required.filter(s => results.get(s) !== 'PASS');
  if (missing.length) return {status: 'WAIT', detail: `black-box kit result lacks ${missing.join(', ')}`};
  return {status: 'PASS', detail: `black-box kit ${required.length} scenario(s) PASS (service ${String(r.service).slice(0, 8)}, lab ${String(r.lab).slice(0, 8)})`};
}

// The Harness release dependency check (release_deps.py check) for this candidate.
export function depsEvidence({pr, candidate, reporters}) {
  const r = latestRecord({comments: pr.comments, schema: DEPS_SCHEMA, authors: reporters, since: pr.headDate});
  if (!r) return {status: 'WAIT', detail: `no ${DEPS_SCHEMA} result from ${reporters.join(' or ')} since the head commit`};
  if (r.candidate !== candidate) return {status: 'WAIT', detail: `latest ${DEPS_SCHEMA} result is for ${String(r.candidate).slice(0, 8)}`};
  if (r.verdict === 'PASS') return {status: 'PASS', detail: `release-deps PASS (registry ${String(r.registry_digest ?? '').slice(0, 12)})`};
  if (r.verdict === 'FAIL') return {status: 'FAIL', detail: `release-deps FAIL (${r._url})`};
  return {status: 'WAIT', detail: `release-deps ${r.verdict ?? 'unknown'} (${r._url})`};
}

// Evidence records are read by their own gates, not as warnings.
const EVIDENCE = [AUTO_SCHEMA, KIT_SCHEMA, DEPS_SCHEMA, 'hps-blackbox-run/1'];
const isEvidence = body => EVIDENCE.some(schema => jsonBlock(body, schema));

// Unresolved comments on the release PR. Only people hold a release: comments and reviews by the release
// and agent machinery (config/release-auto.json `machinery`: the pipeline, github-actions and the agent
// bot, whose diagnosis notes held rc.3 in #4304) never do. Every other comment that is not an evidence
// record is a hold until it is hidden on GitHub (any "Hide" reason, e.g. Resolved or Outdated). A review
// asking for changes is a hold until it is dismissed or superseded by the same reviewer.
//   comments: [{user, body, url, minimized}]; reviews: [{user, state}] in order
export function holds({comments = [], reviews = []}, exempt) {
  const open = comments.filter(c => !exempt.includes(c.user) && !c.minimized && !isEvidence(c.body));
  const latest = new Map();
  for (const r of reviews) if (r.state !== 'COMMENTED' && !exempt.includes(r.user)) latest.set(r.user, r.state);
  const changes = [...latest].filter(([, s]) => s === 'CHANGES_REQUESTED').map(([u]) => u);
  return {open, changes};
}
