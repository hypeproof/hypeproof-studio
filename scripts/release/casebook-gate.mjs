// Which release casebook cases hold an automatic release, and whether their evidence is in.
// Owner decision 2026-11-18 ("자동 항목만 관문": only automatic items gate). Pure: no GitHub, git or file access.
//
// Every desktop P0 case in docs/operations/release-casebook/cases.yaml carries `gate:`
//   auto           evidence is produced unattended. `gate_evidence` names it:
//                    acceptance:<check>  the rc's unified-acceptance.json, PASS at the candidate on every
//                                        platform the release ships (ACCEPTANCE_CHECKS below)
//                    kit:<sN>            the hps-blackbox-kit/1 record for the candidate, scenario sN PASS
//                    run                 an hps-blackbox-run/1 row for the case at the PR head (a runner's)
//                  An auto case holds the release until its evidence is PASS. Missing evidence waits.
//   after-publish  can only pass on a published stable (the in-app updater reads only published stables).
//   human          needs a person: a real Google account or payment, a class code or account, Windows 11
//                  hardware, a production DB read, or no unattended runner covers it yet.
// after-publish and human cases do not hold the automatic release; release-auto lists them in the
// "v<version> 출시 후 점검" issue after publication. The approval route (a release approver's review) is
// unchanged: every P0 case at the head, or a release manager override.
// A P0 FAIL at the head is never waived, whatever its gate (#3462).
import {SCHEMA, extractRun, validateRun} from './validate-blackbox-run.mjs';
import {KIT_SCHEMA, latestRecord} from './auto-release-record.mjs';

export const GATES = ['auto', 'after-publish', 'human'];
export const CHECKLIST_SCHEMA = 'hps-release-checklist/1';
export const CHECKLIST_SUFFIX = '출시 후 점검';

// Who may post a run result: members and collaborators, or the org's own bots. Studio is public,
// so anyone can comment; a stranger's PASS is not evidence.
export const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];
export const TRUSTED_BOTS = ['hypeproof-agent[bot]', 'hypeproof-org-lab-bot[bot]'];

// What an `acceptance:<check>` names in one platform's receipt (e2e/unified-release, hps-unified-acceptance/1).
export const ACCEPTANCE_CHECKS = {
  // The shipped App enters a per-run code from a session opened on the public Service through the start
  // card (참여 코드가 있어요 → 코드 확인하기 → 이 활동 시작하기), lands in the activity and saves and revises
  // files (e2e/tests/native-public-activity.spec.ts via e2e/unified-release/public.mjs).
  'public-classroom': r => (r.publicService?.activities ?? []).some(a => a.kind === 'classroom' && a.status === 'PASS'),
  'public-trial': r => (r.publicService?.activities ?? []).some(a => a.kind === 'trial' && a.status === 'PASS'),
  // The shipped App against the pinned candidate Service: folder switch, drafts, attachments and a process
  // restart (e2e/tests/native-unified-switch.spec.ts via e2e/unified-release/run.mjs).
  'activity-classroom': r => (r.activities ?? []).some(a => a.kind === 'classroom' && a.result?.status === 'PASS'),
  'activity-trial': r => (r.activities ?? []).some(a => a.kind === 'trial' && a.result?.status === 'PASS'),
};

const EVIDENCE = /^(?:acceptance:([a-z-]+)|kit:(s\d+)|run)$/;

export function parseEvidence(spec) {
  const m = EVIDENCE.exec(String(spec ?? ''));
  if (!m) return null;
  if (m[1] !== undefined) return ACCEPTANCE_CHECKS[m[1]] ? {kind: 'acceptance', check: m[1]} : null;
  if (m[2] !== undefined) return {kind: 'kit', scenario: m[2]};
  return {kind: 'run'};
}

// Structural problems of one case's gate fields (casebook.mjs validateCasebook). `required` is true for a
// desktop P0 case that is not 자동화됨: those must say how they gate.
export function gateProblems(c, required) {
  const at = `case ${c?.id}`;
  const p = [];
  if (c.gate === undefined) {
    if (required) p.push(`${at}: a desktop P0 case needs gate: ${GATES.join('/')}`);
    if (c.gate_evidence !== undefined) p.push(`${at}: gate_evidence without gate`);
    return p;
  }
  if (!GATES.includes(c.gate)) p.push(`${at}: gate must be one of ${GATES.join('/')}`);
  if (c.gate === 'auto') {
    const ev = c.gate_evidence;
    if (!Array.isArray(ev) || ev.length === 0) p.push(`${at}: gate auto needs gate_evidence (acceptance:<check>, kit:<sN> or run)`);
    else for (const e of ev) if (!parseEvidence(e)) p.push(`${at}: unknown gate_evidence "${e}" (acceptance:${Object.keys(ACCEPTANCE_CHECKS).join('|')}, kit:<sN>, run)`);
  } else if (c.gate_evidence !== undefined) p.push(`${at}: gate_evidence is only for gate auto`);
  return p;
}

// The P0 ids of the release (the tag's own casebook) split by the gate the current casebook gives them.
// A P0 id the current casebook does not classify is `unclassified` and holds the release (fail closed).
export function splitByGate(p0 = [], cases = []) {
  const byId = new Map(cases.map(c => [c.id, c]));
  const out = {auto: [], afterPublish: [], human: [], unclassified: []};
  for (const id of p0) {
    const c = byId.get(id);
    if (c?.gate === 'auto') out.auto.push({id, evidence: (c.gate_evidence ?? []).map(parseEvidence).filter(Boolean)});
    else if (c?.gate === 'after-publish') out.afterPublish.push(id);
    else if (c?.gate === 'human') out.human.push(id);
    else out.unclassified.push(id);
  }
  return out;
}

// Latest trusted hps-blackbox-run/1 row per case at the PR head (comments in time order, a later run wins).
//   comments: [{user, association, created_at, body, url}]
export function runRows({number, head, comments = []}) {
  const notes = [];
  const latest = new Map();
  const rcs = new Set();
  const ordered = [...comments].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const c of ordered) {
    if (!String(c.body ?? '').includes(SCHEMA)) continue;
    if (!TRUSTED_ASSOCIATIONS.includes(c.association) && !TRUSTED_BOTS.includes(c.user)) { notes.push(`run by ${c.user} ignored: not a member or org bot`); continue; }
    let run;
    try { run = extractRun(c.body); } catch (error) { notes.push(`run by ${c.user}: ${error.message}`); continue; }
    const problems = validateRun(run);
    if (problems.length) { notes.push(`run by ${c.user} is invalid: ${problems[0]}`); continue; }
    if (run.pr !== number) { notes.push(`run by ${c.user} is for #${run.pr}`); continue; }
    if (head && run.head_sha !== head) { notes.push(`run by ${c.user} tested ${run.head_sha.slice(0, 8)}, not the head ${String(head).slice(0, 8)}`); continue; }
    rcs.add(run.rc_tag);
    for (const row of run.cases) latest.set(row.id, row.result);
  }
  return {latest, rcs, notes};
}

// One evidence item for one auto case: PASS, FAIL (observed failure) or WAIT (not there yet).
function evidenceStatus(e, {row, kit, receipts, platforms, candidate}) {
  if (e.kind === 'run') return row === 'PASS' ? 'PASS' : row === 'FAIL' ? 'FAIL' : 'WAIT';
  if (e.kind === 'kit') {
    if (!kit) return 'WAIT';
    const v = kit.scenarios?.[e.scenario];
    return v === 'PASS' ? 'PASS' : v === undefined ? 'WAIT' : 'FAIL';
  }
  if (!Array.isArray(receipts) || !platforms?.length) return 'WAIT';
  let all = true;
  for (const p of platforms) {
    const r = receipts.find(x => x.platform === p && x.sourceSha === candidate);
    if (!r) { all = false; continue; }
    if (r.status === 'FAIL') return 'FAIL';
    if (r.status !== 'PASS' || !ACCEPTANCE_CHECKS[e.check](r)) all = false;
  }
  return all ? 'PASS' : 'WAIT';
}

const list = xs => xs.slice(0, 8).join(', ') + (xs.length > 8 ? ` (+${xs.length - 8})` : '');

// The automatic route's casebook: PASS when every auto P0 case has its evidence (or a trusted run PASS at the
// head) and no P0 case of any gate FAILed at the head; FAIL on an observed failure; WAIT otherwise.
//   p0: the tag's P0 ids; cases: the current casebook (its gate fields); comments: release PR comments;
//   receipts: unified-acceptance.json receipts or null; platforms: what the release ships; reporters: kit authors
export function autoCasebook({number, head, headDate, candidate, p0, cases, comments = [], receipts = null, platforms = [], reporters = []}) {
  const split = splitByGate(p0, cases);
  const {latest, rcs, notes} = runRows({number, head, comments});
  const record = latestRecord({comments, schema: KIT_SCHEMA, authors: reporters, since: headDate});
  const kit = record && record.candidate === candidate ? record : null;
  const failedRows = p0.filter(id => latest.get(id) === 'FAIL');
  const results = split.auto.map(({id, evidence}) => {
    const row = latest.get(id);
    const statuses = evidence.map(e => evidenceStatus(e, {row, kit, receipts, platforms, candidate}));
    const status = row === 'FAIL' || statuses.includes('FAIL') ? 'FAIL'
      : row === 'PASS' || (statuses.length && statuses.every(s => s === 'PASS')) ? 'PASS' : 'WAIT';
    return {id, status};
  });
  const pass = results.filter(r => r.status === 'PASS').map(r => r.id);
  const fail = [...new Set([...failedRows, ...results.filter(r => r.status === 'FAIL').map(r => r.id)])];
  const wait = [...results.filter(r => r.status === 'WAIT').map(r => r.id), ...split.unclassified];
  const summary = {pr: number, head, p0_total: p0.length, auto: split.auto.map(a => a.id), after_publish: split.afterPublish,
    human: split.human, unclassified: split.unclassified, counts: {pass: pass.length, fail: fail.length, wait: wait.length}, fail_ids: fail};
  const deferred = `${split.afterPublish.length} after-publish and ${split.human.length} human case(s) go to the post-release checklist`;
  const tail = notes.length ? ` [${notes.slice(-3).join('; ')}]` : '';
  if (fail.length) return {ok: false, status: 'FAIL', summary, reasons: [`#${number}: P0 FAIL at the head: ${list(fail)}; never waived${tail}`]};
  if (wait.length) {
    const why = [results.some(r => r.status === 'WAIT') && `no evidence yet for auto ${list(results.filter(r => r.status === 'WAIT').map(r => r.id))}`,
      split.unclassified.length && `no gate in the current casebook for ${list(split.unclassified)}`].filter(Boolean).join('; ');
    return {ok: false, status: 'WAIT', summary, reasons: [`#${number}: ${why}${tail}`]};
  }
  const runs = rcs.size ? ` (runs: ${[...rcs].join(', ')})` : '';
  return {ok: true, status: 'PASS', path: 'auto-evidence', summary,
    reasons: [`casebook: ${pass.length} auto P0 case(s) PASS at ${String(head).slice(0, 8)}; ${deferred}`],
    line: `Release casebook: automatic route; ${pass.length} auto P0 case(s) PASS on #${number}${pass.length ? ` (${pass.join(', ')})` : ''}${runs}; ${deferred}.`};
}

// The post-release checklist issue ("v<version> 출시 후 점검"): the release's after-publish and human P0 cases.
export function checklistTitle(tag) { return `${tag} ${CHECKLIST_SUFFIX}`; }

export function checklistBody({tag, pr, candidate, cases, split, team, runUrl}) {
  const title = id => cases.find(c => c.id === id)?.title ?? '';
  const rows = ids => ids.map(id => `- [ ] ${id} — ${title(id)}`);
  const record = {schema: CHECKLIST_SCHEMA, version: tag, pr, candidate, after_publish: split.afterPublish, human: split.human, run: runUrl};
  return [
    `**${tag} 출시 후 점검** — 자동 출시는 자동으로 확인되는 케이스만 관문으로 써요 (2026-11-18 결정). 아래 P0 케이스는 출시를 막지 않았고, 공개된 ${tag} 에서 확인해요.`,
    '',
    `**공개된 안정 버전에서만 할 수 있는 케이스** (after-publish, ${split.afterPublish.length}건)`,
    ...(split.afterPublish.length ? rows(split.afterPublish) : ['- 없음']),
    '',
    `**사람이 해야 하는 케이스** (human, ${split.human.length}건)`,
    ...(split.human.length ? rows(split.human) : ['- 없음']),
    '',
    `케이스 절차는 \`docs/operations/release-casebook/cases.yaml\`, 결과 형식은 \`hps-blackbox-run/1\` (results-schema.md) 이에요. 결과는 이 이슈에 댓글로 남겨요 (\`pr\` 은 릴리스 PR #${pr}).`,
    'FAIL 이 하나라도 있으면 다음 자동 출시 실행이 이 이슈에 `release-blocker` 라벨을 붙여요. 그러면 다음 출시가 멈춰요. 직접 붙여도 돼요. 고친 뒤 라벨을 떼거나 이슈를 닫아요.',
    '자동으로 도는 출시 후 점검: 아직 없음 (러너가 생기면 같은 형식의 결과 댓글을 남겨요).',
    '',
    `팀 전체에 알려요: ${team.map(t => `@${t}`).join(' ')}`,
    '',
    '```json', JSON.stringify(record, null, 2), '```',
  ].join('\n');
}

// Case ids a trusted hps-blackbox-run/1 comment on the checklist issue reported FAIL (any head: the
// checklist runs on the published release, after the PR head stopped moving).
export function checklistFailures({pr, comments = []}) {
  const {latest} = runRows({number: pr, head: null, comments});
  return [...latest].filter(([, result]) => result === 'FAIL').map(([id]) => id);
}
