// Ask the whole team, or tell them it shipped (Jay 2026-11-16: "all gates pass → release with no human;
// otherwise ask everyone"). Pure renderers and decisions; auto-release.mjs does the I/O.
//
// hps-release-ask/1        posted by the pipeline on the release PR when a gate failed, evidence stayed
//                          missing past askAfterHours, or RELEASE_AUTO is off. One per head. It @mentions the
//                          whole team (GitHub then emails each person) and requests reviews from the release
//                          approvers. Harness scripts/notify/stakeholders.py (launchd xyz.hypeproof.notify-tick)
//                          reads it and sends the same ask by Discord (#team card mentioning everyone, DMs),
//                          email when enabled, and the approval inbox.
// hps-release-published/1  posted by the pipeline on the merged release PR after the stable release is
//                          public and its post-publish checks ran ("출시됨 vX" when they passed).
// The answer is a GitHub review on the PR's current head by a release approver: Approve releases (through
// release-promote), Request changes holds. The first such answer wins; an answer on an older head is void.
// Studio is public: records hold gate names, logins, versions and SHAs only.

export const ASK_SCHEMA = 'hps-release-ask/1';
export const PUBLISHED_SCHEMA = 'hps-release-published/1';

// Should the pipeline ask people now? null when not.
//   verdict: PASS | WAIT | FAIL | OFF; headDate: ISO; now: ms; askAfterHours: number
export function askReason({verdict, headDate, now, askAfterHours}) {
  if (verdict === 'FAIL') return 'fail';
  if (verdict === 'OFF') return 'auto_off';
  if (verdict === 'WAIT' && headDate && now - Date.parse(headDate) >= askAfterHours * 3600 * 1000) return 'uncertain';
  return null;
}

const REASON_KO = {
  fail: '자동 출시 검사 중 실패한 항목이 있어요.',
  uncertain: '검사 결과가 오래 확정되지 않았어요.',
  auto_off: '자동 출시가 꺼져 있어요 (RELEASE_AUTO).',
};

export function askBody({pr, candidate, rcTag, version, reason, gates, approvers, team, runUrl}) {
  const open = gates.filter(g => g.status !== 'PASS');
  const record = {schema: ASK_SCHEMA, pr: pr.number, head_sha: pr.head, candidate, rc_tag: rcTag, version, reason,
    gates: gates.map(({id, status}) => ({id, status})), approvers, team, run: runUrl};
  return [
    `**${version} 출시 결정이 필요해요** (${rcTag}, \`${candidate.slice(0, 8)}\`). ${REASON_KO[reason]}`,
    '',
    ...open.map(g => `- \`${g.id}\` ${g.status}: ${g.detail}`),
    '',
    `출시 승인자 ${approvers.map(a => `@${a}`).join(' ')}: 지금 이 PR의 최신 커밋에서 **Approve**하면 출시되고, **Request changes**면 보류돼요. 먼저 답한 한 분의 결정이 적용되고, 커밋이 바뀌면 이전 답은 무효예요.`,
    'Release-blocker 이슈가 열려 있으면 승인해도 출시되지 않아요. 고친 뒤 이슈를 닫거나, 그대로 내보낼 이유를 남기고 닫아 주세요.',
    '',
    `팀 전체에 알려요: ${team.map(t => `@${t}`).join(' ')}`,
    '',
    '```json', JSON.stringify(record, null, 2), '```',
  ].join('\n');
}

// Has the pipeline already asked about this exact head?
export function alreadyAsked(comments, pipeline, head) {
  return comments.some(c => pipeline.includes(c.user) && String(c.body).includes(ASK_SCHEMA) && String(c.body).includes(`"head_sha": "${head}"`));
}

// Post-publish checks on a public stable release (the RC app requests the SDK seed from the final tag,
// so it is 404 until promotion; black-box s16).
//   seedStatus: HTTP status of releases/download/<tag>/sdk-seed.json; seed: its JSON or null
//   assets: [{name, size}] of the published release
export function publishChecks({tag, seedStatus, seed, assets}) {
  const problems = [];
  if (seedStatus !== 200) problems.push(`releases/download/${tag}/sdk-seed.json answered HTTP ${seedStatus}`);
  else if (seed?.schema !== 'hps-sdk-seed/1' || !Array.isArray(seed.seeds) || !seed.seeds.length) problems.push('sdk-seed.json is not an hps-sdk-seed/1 list');
  else {
    for (const s of seed.seeds) {
      const a = assets.find(x => x.name === s.name);
      if (!a) problems.push(`sdk-seed.json lists ${s.name}, which the release does not carry`);
      else if (a.size !== s.size) problems.push(`${s.name} is ${a.size} bytes, sdk-seed.json says ${s.size}`);
    }
  }
  return {ok: problems.length === 0, problems};
}

export function publishedBody({tag, pr, ok, problems, team, runUrl}) {
  const record = {schema: PUBLISHED_SCHEMA, version: tag, pr, verdict: ok ? 'PASS' : 'FAIL', problems, run: runUrl};
  const head = ok
    ? `**출시됨 ${tag}** — 이제 설치된 앱이 업데이트를 받아요. https://github.com/hypeproof/hypeproof-studio/releases/tag/${tag}`
    : `**${tag} 공개 후 확인에 실패했어요.** Release-blocker 이슈를 열었어요.`;
  return [head, '', ...problems.map(p => `- ${p}`), problems.length ? '' : null, `팀 전체에 알려요: ${team.map(t => `@${t}`).join(' ')}`, '',
    '```json', JSON.stringify(record, null, 2), '```'].filter(l => l !== null).join('\n');
}
