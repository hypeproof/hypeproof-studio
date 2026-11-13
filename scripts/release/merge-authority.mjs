// Read-only canonical delegation guard. It cannot authorize source changes or bypass product gates.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {digest} from './engine/core.mjs';
const require = (ok, reason) => { if (!ok) throw Error(reason); };
export const MERGE_POLICY_REPOSITORY = 'hypeproof/hypeproof-harness';
export const MERGE_POLICY_INDEX = 'policy/repos.yaml';
export const MERGE_POLICY_PATH = 'policy/release-merge-authority.json';
export const MERGE_POLICY_SHA256 = '35d6c936a246cf478a99a1d50216245caf28299c254e4da575f2d240a4082a80';
const KNOWN_RULE = {
  schema: 'hps-release-merge-authority/1', repository: 'hypeproof/hypeproof-studio', authority: 'trusted-machine-publisher',
  workflow: '.github/workflows/release-promote.yml', defaultBranch: 'main', headPrefix: 'release/',
  recordTemplate: 'releases/<version>.md', commitTitleTemplate: 'release: record <version>-rc.<number>',
  enrollment: {path: 'config/release-automation.json', mode: 'active'},
  requiredGates: ['exact-head-single-parent-record-only', 'current-accepted-rc-and-package-bytes', 'complete-signed-machine-pass',
    'current-live-cas-and-policy', 'current-required-checks', 'no-holds-or-changes-requested', 'current-freeze-and-budget'],
  genericMerge: 'refuse-delegate-to-publisher', sourcePullRequests: 'unchanged-canonical-non-author-review',
};
export function validateMergeAuthority(bytes) {
  require(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 32768, 'bounded canonical merge rule bytes required');
  require(createHash('sha256').update(bytes).digest('hex') === MERGE_POLICY_SHA256, 'canonical merge authority changed or revoked');
  const rule = JSON.parse(bytes.toString('utf8'));
  require(rule.schema === 'hps-release-merge-authority/1' && digest(rule) === digest(KNOWN_RULE), 'unknown canonical merge authority rule');
  return rule;
}
// Deliberately supports the canonical registry's current block layout only; unknown YAML fails closed.
export function validateMergeIndex(bytes) {
  require(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 128 * 1024, 'bounded canonical repository index required');
  const lines = bytes.toString('utf8').replace(/\r\n/g, '\n').split('\n').filter(line => line.trim() && !line.trimStart().startsWith('#'));
  require(lines.shift() === 'version: 1' && lines.shift() === 'repositories:', 'unsupported canonical repository index format');
  const entries = []; let entry, currentField;
  for (const line of lines) {
    require(!line.includes('\t'), 'unsupported canonical repository index indentation');
    const header = /^  - owner: ([A-Za-z0-9-]+)$/.exec(line);
    if (header) { entry = {owner: header[1]}; currentField = 'owner'; entries.push(entry); continue; }
    require(entry && /^ {4}/.test(line), 'unsupported canonical repository block');
    if (/^ {6}/.test(line)) {
      require(!['owner','name','profile','lifecycle','default_branch','release_record_merge_policy'].includes(currentField), 'nested canonical authority scalar refused');
      if (currentField === 'required_status_checks' && entry.owner === 'hypeproof' && entry.name === 'hypeproof-studio') {
        const item = /^      - ([A-Za-z0-9][A-Za-z0-9 ._()/+-]*)$/.exec(line);
        require(item, 'unsupported canonical required check name'); entry.required_status_checks.push(item[1]);
      }
      continue;
    }
    const field = /^    ([A-Za-z_][A-Za-z0-9_-]*):(?: (.*))?$/.exec(line);
    require(field && !Object.hasOwn(entry, field[1]), 'duplicate or unsupported repository scalar field');
    currentField = field[1];
    if (currentField === 'required_status_checks' && entry.owner === 'hypeproof' && entry.name === 'hypeproof-studio') {
      require(!field[2], 'canonical required checks must be a block list'); entry[currentField] = [];
    } else entry[currentField] = field[2] ?? '';
  }
  require(entries.length > 0 && entries.every(row => /^[A-Za-z0-9._-]+$/.test(row.name ?? '')), 'canonical plain repository names required');
  const studio = entries.filter(row => row.owner === 'hypeproof' && row.name === 'hypeproof-studio');
  require(studio.length === 1 && studio[0].release_record_merge_policy === MERGE_POLICY_PATH && studio[0].lifecycle === 'product' &&
    studio[0].default_branch === 'main' && studio[0].profile === 'public-product', 'canonical Studio merge delegation unlinked or retired');
  const checks = studio[0].required_status_checks;
  require(Array.isArray(checks) && checks.length > 0 && new Set(checks).size === checks.length, 'canonical required checks missing or duplicated');
  return studio[0];
}
function policyGet(endpoint, token) {
  const env = {...process.env, GH_TOKEN: token};
  for (const name of ['GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[name];
  return JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', '--method', 'GET', endpoint], {
    env, encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'pipe']}));
}
export function readCanonicalMergeAuthority({token = process.env.HPS_MERGE_POLICY_READ_TOKEN, get = policyGet} = {}) {
  require(typeof token === 'string' && token.trim().length > 0, 'separate Harness merge-policy contents-read capability required');
  const ref = get(`repos/${MERGE_POLICY_REPOSITORY}/git/ref/heads/main`, token);
  require(ref.ref === 'refs/heads/main' && ref.object?.type === 'commit' && /^[a-f0-9]{40}$/.test(ref.object.sha), 'current canonical policy main commit required');
  const commit = ref.object.sha;
  const read = name => {
    const file = get(`repos/${MERGE_POLICY_REPOSITORY}/contents/${name}?ref=${commit}`, token);
    require(file.type === 'file' && file.path === name && file.encoding === 'base64' && typeof file.content === 'string', 'exact canonical merge authority file required');
    return Buffer.from(file.content, 'base64');
  };
  const index = read(MERGE_POLICY_INDEX), studio = validateMergeIndex(index);
  const rule = validateMergeAuthority(read(MERGE_POLICY_PATH));
  return {repository: MERGE_POLICY_REPOSITORY, path: MERGE_POLICY_PATH, commit, sha256: MERGE_POLICY_SHA256,
    indexSha256: createHash('sha256').update(index).digest('hex'), requiredChecks: studio.required_status_checks, rule};
}
const CHECK_QUERY = `query($number:Int!,$endCursor:String) {
  repository(owner:"hypeproof",name:"hypeproof-studio") { pullRequest(number:$number) {
    headRefOid isDraft reviewDecision commits(last:1) { nodes { commit { oid statusCheckRollup {
      contexts(first:100,after:$endCursor) { nodes {
        __typename ... on CheckRun { databaseId name status conclusion startedAt completedAt checkSuite { app { id } workflowRun { id databaseId createdAt runNumber runAttempt workflow { id name } } } }
        ... on StatusContext { context state createdAt }
      } pageInfo { hasNextPage endCursor } }
    } } } }
  } }
}`;
function checkPages(number) {
  return JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', 'graphql', '--paginate', '--slurp',
    '-f', 'query=' + CHECK_QUERY, '-F', 'number=' + number], {encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024}));
}
export function readMachineCheckSnapshot({number, repository, head, get = checkPages}) {
  require(repository === 'hypeproof/hypeproof-studio' && Number.isSafeInteger(number) && number > 0, 'fixed Studio check scope required');
  const pages = get(number); require(Array.isArray(pages) && pages.length > 0, 'paginated current checks unavailable');
  const snapshot = {headRefOid: head, isDraft: false, reviewDecision: '', statusCheckRollup: []}; let cursor;
  for (const [index, page] of pages.entries()) {
    require(!Object.hasOwn(page, 'errors') || Array.isArray(page.errors) && page.errors.length === 0, 'partial check query refused');
    const pr = page.data?.repository?.pullRequest, commits = pr?.commits?.nodes;
    require(pr?.headRefOid === head && pr.isDraft === false && Array.isArray(commits) && commits.length === 1 && commits[0].commit?.oid === head, 'current check head changed or unreadable');
    if (pr.reviewDecision === 'CHANGES_REQUESTED') snapshot.reviewDecision = pr.reviewDecision;
    const contexts = commits[0].commit.statusCheckRollup?.contexts, info = contexts?.pageInfo;
    require(Array.isArray(contexts?.nodes) && info?.hasNextPage === (index < pages.length - 1), 'incomplete check pagination');
    if (info.hasNextPage) { require(typeof info.endCursor === 'string' && info.endCursor && info.endCursor !== cursor, 'invalid check cursor'); cursor = info.endCursor; }
    for (const check of contexts.nodes) snapshot.statusCheckRollup.push({...check, workflowName: check.checkSuite?.workflowRun?.workflow?.name ?? ''});
  }
  return snapshot;
}
export function machineReviewHolds(pr) {
  require(Array.isArray(pr.labels) && Array.isArray(pr.reviews), 'current labels and reviews required');
  if (pr.headRepository !== 'hypeproof/hypeproof-studio' || pr.baseRepository !== 'hypeproof/hypeproof-studio') return ['Machine release record must remain in the same Studio repository'];
  const holds = new Set(['blocked', 'hold', 'do-not-merge', 'human-needed']);
  const labels = pr.labels.filter(label => holds.has(String(label).trim().toLowerCase().replace(/[_\s]+/g, '-')));
  if (labels.length) return ['Machine publication held by labels: ' + labels.join(', ')];
  const current = new Map();
  const reviews = pr.reviews.map((review, index) => ({...review, index})).filter(review => ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state));
  if (reviews.every(review => Number.isFinite(Date.parse(review.submittedAt)))) reviews.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a.index - b.index);
  for (const review of reviews) current.set(review.user ?? `unattributed-${review.index}`, review.state);
  const requested = [...current].filter(([, state]) => state === 'CHANGES_REQUESTED').map(([user]) => user);
  return requested.length ? ['Machine publication held by current changes-requested review: ' + requested.join(', ')] : [];
}

// Completion time is not execution chronology: a slow old success must not hide a newer pending/red run.
function creationTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value ?? '');
  if (!match) return null;
  const seconds = Date.parse(match[1] + 'Z');
  if (!Number.isFinite(seconds) || new Date(seconds).toISOString().slice(0, 19) !== match[1]) return null;
  return BigInt(seconds) * 1000000n + BigInt((match[2] ?? '').padEnd(9, '0'));
}
function newerCheck(a, b) {
  const isRun = check => check.__typename === 'CheckRun' || Object.hasOwn(check, 'conclusion');
  if (!isRun(a) && !isRun(b)) {
    const at = creationTime(a.createdAt), bt = creationTime(b.createdAt);
    return at !== null && bt !== null && at > bt;
  }
  if (!a.checkSuite?.app?.id || a.checkSuite.app.id !== b.checkSuite?.app?.id) return false;
  const ar = a.checkSuite?.workflowRun, br = b.checkSuite?.workflowRun;
  if (!ar?.workflow?.id || ar.workflow.id !== br?.workflow?.id) return false;
  const positive = n => Number.isSafeInteger(n) && n > 0;
  const at = creationTime(ar.createdAt), bt = creationTime(br.createdAt);
  if (at === null || bt === null || !positive(ar.runNumber) || !positive(br.runNumber)) return false;
  const nodeIds = typeof ar.id === 'string' && ar.id && typeof br.id === 'string' && br.id;
  const databaseIds = positive(ar.databaseId) && positive(br.databaseId);
  if (!nodeIds && !databaseIds) return false;
  if (nodeIds && databaseIds && (ar.id === br.id) !== (ar.databaseId === br.databaseId)) return false;
  const differentRun = nodeIds ? ar.id !== br.id : ar.databaseId !== br.databaseId;
  // Display names may belong to parallel jobs. Check IDs and mutable runAttempt cannot prove
  // that one same-run job supersedes another; retain every same-run result.
  return differentRun && ar.runNumber > br.runNumber && at >= bt;
}

export function validateMachineChecks(snapshot, head, requiredChecks) {
  require(snapshot?.headRefOid === head && /^[a-f0-9]{40}$/.test(head), 'current check head changed or unreadable');
  require(snapshot.isDraft === false && snapshot.reviewDecision !== 'CHANGES_REQUESTED', 'draft or current changes-requested review blocks machine publication');
  require(Array.isArray(requiredChecks) && requiredChecks.length > 0 && Array.isArray(snapshot.statusCheckRollup) && snapshot.statusCheckRollup.length > 0, 'current required checks unavailable');
  const isRun = check => check?.__typename === 'CheckRun' || Object.hasOwn(check ?? {}, 'conclusion');
  const groups = new Map(), latest = [];
  for (const check of snapshot.statusCheckRollup) {
    require(check && typeof check === 'object' && !Array.isArray(check), 'unknown current check');
    if (isRun(check)) {
      require(typeof check.name === 'string' && check.name.length > 0, 'current check name missing');
      const key = JSON.stringify(['run', check.workflowName ?? '', check.name]);
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(check);
    } else {
      require((check.__typename === 'StatusContext' || Object.hasOwn(check, 'state')) && typeof check.context === 'string' && check.context.length > 0, 'unknown current check');
      const key = JSON.stringify(['status', check.context]);
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(check);
    }
  }
  for (const runs of groups.values()) {
    // Unknown or contradictory metadata cannot supersede a result; keep every incomparable record.
    latest.push(...runs.filter(run => !runs.some(other => newerCheck(other, run))));
  }
  const gates = latest.filter(check => isRun(check) && check.name === 'control-plane (human gate)');
  require(gates.every(gate => gate.conclusion === 'SUCCESS'), 'latest control-plane human gate is not green');
  const green = check => isRun(check) ? ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(check.conclusion) : check.state === 'SUCCESS';
  require(latest.every(green), 'current checks pending, failed or unknown');
  for (const name of requiredChecks) require(latest.some(check => (check.name || check.context) === name), 'required check missing: ' + name);
  return {status: 'CURRENT_CHECKS_PASS', head, requiredChecks};
}
