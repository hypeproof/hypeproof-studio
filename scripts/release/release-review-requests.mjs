// Only active, exact release records may remove provider-attributed automatic CODEOWNER requests.
const require = (ok, reason) => { if (!ok) throw Error(reason); };
const REPO = 'hypeproof/hypeproof-studio';
const QUERY = `query($number:Int!,$endCursor:String) { repository(owner:"hypeproof",name:"hypeproof-studio") { pullRequest(number:$number) {
  repository { nameWithOwner } headRepository { nameWithOwner } baseRefName headRefName headRefOid reviewDecision
  labels(first:100) { totalCount nodes { name } } files(first:2) { totalCount nodes { path } }
  commits(last:1) { nodes { commit { oid message parents(first:2) { totalCount nodes { oid } } } } }
  reviewRequests(first:100,after:$endCursor) { nodes { id asCodeOwner requestedReviewer { __typename ... on User { login } ... on Team { slug } } } pageInfo { hasNextPage endCursor } }
} } }`;
const identity = request => {
  const actor = request.requestedReviewer;
  return actor?.__typename === 'User' && /^[A-Za-z0-9-]+$/.test(actor.login ?? '') ? ['reviewers[]', actor.login.toLowerCase()] :
    actor?.__typename === 'Team' && /^[A-Za-z0-9-]+$/.test(actor.slug ?? '') ? ['team_reviewers[]', actor.slug.toLowerCase()] : null;
};
export function reconcileAutomaticReviews({active, plan, number, head, gh}) {
  if (active !== true) return {status: 'SHADOW', removed: 0};
  require(Number.isSafeInteger(number) && number > 0 && /^[a-f0-9]{40}$/.test(head), 'exact release PR/head required');
  require(plan.schema === 'hps-release-plan/0' && plan.mode === 'create' && plan.trial === false, 'only a non-trial create plan may reconcile reviewers');
  require(/^v\d+\.\d+\.\d+$/.test(plan.version) && typeof plan.rcTag === 'string' && plan.rcTag.startsWith(plan.version + '-rc.') && /^[1-9]\d*$/.test(plan.rcTag.slice((plan.version + '-rc.').length)) && /^[a-f0-9]{40}$/.test(plan.candidate), 'valid immutable release plan required');
  const read = () => {
    const pages = JSON.parse(gh('api', '--hostname', 'github.com', 'graphql', '--paginate', '--slurp', '-f', 'query=' + QUERY, '-F', 'number=' + number));
    require(Array.isArray(pages) && pages.length > 0, 'review request pages required');
    const requests = []; let held = false;
    for (const [i, page] of pages.entries()) {
      require(!page.errors?.length, 'review request query failed');
      const pr = page.data?.repository?.pullRequest, c = pr?.commits?.nodes?.[0]?.commit;
      require(pr?.repository?.nameWithOwner === REPO && pr.headRepository?.nameWithOwner === REPO && pr.baseRefName === 'main' &&
        pr.headRefName === 'release/' + plan.version && plan.branch === pr.headRefName && pr.headRefOid === head && c?.oid === head &&
        c.message.split('\n')[0] === 'release: record ' + plan.rcTag && c.parents.totalCount === 1 && c.parents.nodes[0]?.oid === plan.candidate &&
        pr.files.totalCount === 1 && pr.files.nodes[0]?.path === `releases/${plan.version}.md`, 'review cleanup requires unchanged same-repository release record');
      require(pr.labels?.totalCount === pr.labels?.nodes?.length && pr.labels.nodes.some(row => row.name === 'release'), 'complete current labels required');
      held ||= pr.reviewDecision === 'CHANGES_REQUESTED' || pr.labels.nodes.some(row => ['blocked','hold','do-not-merge','human-needed'].includes(row.name.trim().toLowerCase().replace(/[_\s]+/g, '-')));
      const list = pr.reviewRequests;
      require(Array.isArray(list?.nodes) && list.pageInfo?.hasNextPage === (i < pages.length - 1), 'incomplete review request pagination'); requests.push(...list.nodes);
    }
    return {requests, held};
  };
  const first = read(); if (first.held) return {status: 'HELD', removed: 0};
  let removed = 0;
  for (const request of first.requests) {
    const who = identity(request); if (request.asCodeOwner !== true || !who || typeof request.id !== 'string' || !request.id) continue;
    const current = read(); if (current.held) return {status: 'HELD', removed};
    const same = row => JSON.stringify(identity(row)) === JSON.stringify(who);
    if (!current.requests.some(row => row.id === request.id && row.asCodeOwner === true && same(row)) ||
      current.requests.some(row => same(row) && row.asCodeOwner !== true)) continue;
    gh('api', '--hostname', 'github.com', '--method', 'DELETE', `repos/${REPO}/pulls/${number}/requested_reviewers`, '-f', who[0] + '=' + who[1]); removed++;
  }
  const final = read();
  require(!final.requests.some(row => row.asCodeOwner === true && typeof row.id === 'string' && row.id && identity(row) && !final.requests.some(other => JSON.stringify(identity(other)) === JSON.stringify(identity(row)) && other.asCodeOwner !== true)), 'automatic review requests remain; reconcile before continuing');
  return {status: final.held ? 'HELD' : 'RECONCILED', removed};
}
export function releaseCopy(body, active) {
  if (active !== true) return body;
  require(body.includes('## 8. Approval'), 'known release template required');
  return body.replace('The release manager works through the sections in order.', 'Machine verification records this candidate; human input is requested only for BLOCKED observations.')
    .replace(/These PRs changed[^\n]+/, 'Dependency verification records the exact Service, source and deployment facts; unresolved items become BLOCKED questions.')
    .replace(/New features and user-visible fixes\.[^\n]+/, 'Feature procedures remain below; native observations record PASS, FAIL or BLOCKED against these exact bytes.')
    .replace(/Run on the rc install above\.[^\n]+/, 'Native roles verify these cases on the exact rc. FAIL returns to development; BLOCKED requests attributable human observations.')
    .replace(/## 8\. Approval[\s\S]*$/, '## 8. Machine publication\n\nComplete signed PASS and current policy, CI, freeze and budget gates authorize publication. FAIL returns to development; BLOCKED requests human observations. This automated cut requests no member approval.\n');
}
export const candidateNote = (plan, active) => `New candidate ${plan.rcTag} at ${plan.candidate.slice(0, 8)}. ` + (active
  ? 'Previous evidence does not authorize this candidate. Machine verification repeats; human input is requested only for BLOCKED.'
  : 'Approvals given before this comment were for an earlier candidate; review again.');
