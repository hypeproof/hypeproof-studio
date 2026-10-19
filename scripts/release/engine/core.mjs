// Local, provider-independent release decisions. This module performs no network effects.
import {createHash, createPublicKey, verify} from 'node:crypto';

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const VERDICTS = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
const CHANNELS = new Set(['canary', 'stable']);
const channelFor = (item, channel = item.input.channel) => { require(CHANNELS.has(channel), 'unknown release channel'); return channel; };
const approvalFor = (item, channel) => own(item.approvals ?? {}, channel) ?? (item.approval?.body.channel === channel ? item.approval : undefined);
const FAILURE_KINDS = new Set(['product', 'test-contract', 'environment', 'quota', 'infrastructure']);
const own = (table, key) => Object.hasOwn(table, key) ? table[key] : undefined;
const require = (condition, message) => { if (!condition) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const validTime = value => Number.isFinite(time(value));

// Remote adapters must fetch bytes before entering this synchronous decision.
function verifiedFile(checkFile, file) {
  require(typeof checkFile === 'function', 'file verifier required');
  const result = checkFile(file);
  require(result !== false, 'file verification failed');
  if (result && typeof result.then === 'function') {
    // Refusal stays synchronous, but a rejected verifier must not crash the host.
    // Handling rejection never turns its eventual result into byte verification.
    Promise.resolve(result).catch(() => {});
    throw new Error('file verifier must be synchronous');
  }
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  require(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)), 'non-JSON value');
  return JSON.stringify(value);
}

export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
// Signatures authorize the body. Transport wrappers and base64 spelling must not
// create a second approval identity or change the evidence an approval binds.
export const signedPayloadDigest = envelope => {
  require(envelope?.body && typeof envelope.body === 'object' && !Array.isArray(envelope.body), 'signed body required');
  return digest(envelope.body);
};
export const initialState = () => ({schema: 'hps-release-ledger/1', revision: 0, candidates: {}, quotas: {}, reservations: {}, failures: {}, events: {}, promotions: {}});

function uniqueIds(items, name) {
  require(Array.isArray(items) && items.length > 0, `${name} must not be empty`);
  require(items.every(item => ID.test(item.id)), `${name} has an invalid id`);
  require(new Set(items.map(item => item.id)).size === items.length, `${name} has duplicate ids`);
}

function publicKey(pem) {
  const key = createPublicKey(pem);
  require(key.asymmetricKeyType === 'ed25519', 'only Ed25519 keys are supported');
  return key;
}

export function validatePolicy(policy) {
  require(policy?.schema === 'hps-release-policy/1' && text(policy.revision), 'invalid policy schema/revision');
  uniqueIds(policy.requiredArtifacts, 'requiredArtifacts');
  require(policy.requiredArtifacts.every(a => text(a.target)), 'artifact target is required');
  uniqueIds(policy.requiredTests, 'requiredTests');
  uniqueIds(policy.requiredWork, 'requiredWork');
  require(policy.requiredWork.every(w => ID.test(w.resourceId)) && ID.test(policy.fixResourceId), 'work resources must be explicit');
  uniqueIds(policy.reporters, 'reporters');
  for (const reporter of policy.reporters) publicKey(reporter.publicKey);
  for (const check of policy.requiredTests) {
    require(policy.requiredArtifacts.some(a => a.id === check.artifactId), `unknown artifact for ${check.id}`);
    require(text(check.requirementId) && text(check.expected) && check.environment === 'installed-app', `black-box contract missing for ${check.id}`);
    require(Array.isArray(check.reporterIds) && check.reporterIds.length > 0 && check.reporterIds.every(id => policy.reporters.some(r => r.id === id)), `unknown reporter for ${check.id}`);
  }
  require(Number.isSafeInteger(policy.quotaMaxAgeSeconds) && policy.quotaMaxAgeSeconds > 0 && policy.quotaMaxAgeSeconds <= 86400, 'invalid quota freshness limit');
  require(Number.isSafeInteger(policy.maxAttemptsPerStage) && policy.maxAttemptsPerStage >= 1 && policy.maxAttemptsPerStage <= 3, 'work attempts must be bounded to 1..3');
  require(Number.isSafeInteger(policy.maxFixAttempts) && policy.maxFixAttempts >= 0 && policy.maxFixAttempts <= 1, 'fix attempts must be bounded to 0..1');
  require(text(policy.managerRoster?.revision) && Array.isArray(policy.managerRoster.terms), 'manager roster required');
  for (const term of policy.managerRoster.terms) {
    require(ID.test(term.actor) && validTime(term.startsAt) && validTime(term.endsAt) && time(term.startsAt) < time(term.endsAt), 'invalid manager term');
    publicKey(term.publicKey);
  }
  const terms = [...policy.managerRoster.terms].sort((a, b) => time(a.startsAt) - time(b.startsAt));
  for (let i = 1; i < terms.length; i++) require(time(terms[i - 1].endsAt) <= time(terms[i].startsAt), 'manager terms overlap');
  return policy;
}

export function policyDigest(policy) {
  const {managerRoster: _roster, ...contract} = policy;
  return digest(contract);
}

function signed(envelope, key) {
  require(envelope?.body && typeof envelope.signature === 'string', 'signed envelope required');
  require(Object.keys(envelope).length === 2 && Object.hasOwn(envelope, 'body') && Object.hasOwn(envelope, 'signature'), 'unsigned envelope fields are not allowed');
  require(/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature), 'invalid Ed25519 signature encoding');
  const signature = Buffer.from(envelope.signature, 'base64');
  require(signature.toString('base64') === envelope.signature, 'noncanonical Ed25519 signature encoding');
  require(verify(null, Buffer.from(canonical(envelope.body)), publicKey(key), signature), 'signature verification failed');
}

function manager(policy, now) {
  return policy.managerRoster.terms.find(term => time(term.startsAt) <= now && now < time(term.endsAt));
}

function candidate(state, id) {
  const item = own(state.candidates, id);
  require(item, `unknown candidate ${id}`);
  return item;
}

export function manifestFor(item, policy) {
  require(item.policyDigest === policyDigest(policy), 'release policy changed; cut a new candidate');
  const artifacts = policy.requiredArtifacts.map(required => {
    const artifact = own(item.artifacts, required.id);
    require(artifact, `artifact ${required.id} NOT_RUN`);
    return {id: required.id, target: required.target, sha256: artifact.sha256, size: artifact.size};
  });
  return {schema: 'hps-release-manifest/1', ...item.input, candidateId: item.id, policyDigest: item.policyDigest,
    requiredTests: policy.requiredTests, artifacts};
}

function evidenceFor(item, policy, manifest) {
  return policy.requiredTests.map(check => {
    const envelope = own(item.evidence, check.id);
    require(envelope, `${check.id} NOT_RUN`);
    const report = envelope.body;
    const reporter = policy.reporters.find(r => r.id === report.reporterId && check.reporterIds.includes(r.id));
    require(reporter, `untrusted reporter for ${check.id}`);
    signed(envelope, reporter.publicKey);
    require(report.manifestDigest === digest(manifest), `${check.id} belongs to a different manifest`);
    require(report.verdict === 'PASS', `${check.id} ${report.verdict}`);
    return envelope;
  });
}

function budgetGate(state, item, policy, now) {
  const reservations = Object.values(state.reservations).filter(r => r.candidateId === item.id);
  require(reservations.length > 0, 'QUOTA_BLOCKED: no recorded work budget');
  for (const work of policy.requiredWork) require(reservations.some(r => r.stage === work.id && r.resourceId === work.resourceId && r.status === 'settled' && r.outcome === 'success'), `QUOTA_BLOCKED: ${work.id} has no successful settled budget`);
  require(reservations.every(r => r.status === 'settled' && r.incrementalCost === 0 && r.actualUnits <= r.units), 'QUOTA_BLOCKED: unsettled or over-budget work');
  for (const reservation of reservations) {
    const quota = own(state.quotas, reservation.resourceId);
    require(quota && quota.periodId === reservation.periodId && quota.status === 'confirmed' && !quota.overrun && !quota.underfunded &&
      time(quota.observedAt) <= now && now - time(quota.observedAt) <= policy.quotaMaxAgeSeconds * 1000 && now < time(quota.endsAt),
    'QUOTA_BLOCKED: missing, stale, expired or unconfirmed quota');
  }
}

export function readiness(state, candidateId, policy, now = Date.now(), checkFile = () => { throw new Error('file verifier required'); }) {
  try {
    validatePolicy(policy);
    const item = candidate(state, candidateId);
    require(!Object.values(state.failures).some(f => ['product', 'test-contract'].includes(f.kind) && f.observations.some(o => o.candidateId === item.id)), 'recorded failure requires investigation and a new candidate');
    const manifest = manifestFor(item, policy);
    for (const artifact of Object.values(item.artifacts)) verifiedFile(checkFile, artifact);
    const evidence = evidenceFor(item, policy, manifest);
    for (const report of evidence) verifiedFile(checkFile, report.body.file);
    budgetGate(state, item, policy, now);
    return {status: 'AWAITING_APPROVAL', manifest, manifestDigest: digest(manifest), evidenceDigest: digest(evidence.map(envelope => envelope.body))};
  } catch (error) {
    return {status: 'BLOCKED', reason: error.message};
  }
}

export function approvalRequest(state, candidateId, policy, expiresAt, now, checkFile, {channel} = {}) {
  channel = channelFor(candidate(state, candidateId), channel);
  const ready = readiness(state, candidateId, policy, now, checkFile);
  require(ready.status === 'AWAITING_APPROVAL', ready.reason);
  const term = manager(policy, now);
  require(term, 'no release manager on duty');
  require(validTime(expiresAt) && time(expiresAt) > now && time(expiresAt) <= time(term.endsAt), 'approval must expire within the manager term');
  return {schema: 'hps-release-approval/1', candidateId, channel, manifestDigest: ready.manifestDigest, evidenceDigest: ready.evidenceDigest,
    actor: term.actor, roleRevision: policy.managerRoster.revision, approvedAt: new Date(now).toISOString(), expiresAt};
}

function approvalGate(state, item, policy, now, checkFile, channel = item.input.channel) {
  channelFor(item, channel);
  const ready = readiness(state, item.id, policy, now, checkFile);
  require(ready.status === 'AWAITING_APPROVAL', ready.reason);
  const term = manager(policy, now);
  const approval = approvalFor(item, channel);
  require(approval, 'approval missing or revoked');
  require(term && approval.body.actor === term.actor && approval.body.roleRevision === policy.managerRoster.revision, 'release manager changed');
  signed(approval, term.publicKey);
  // Keep pre-fix local revocations effective too. Canonical envelope validation
  // above prevents rewrapping or alternate padding from changing this legacy ID.
  require(!item.revokedApprovalDigests.includes(signedPayloadDigest(approval)) && !item.revokedApprovalDigests.includes(digest(approval)), 'approval missing or revoked');
  require(approval.body.schema === 'hps-release-approval/1' && approval.body.channel === channel && approval.body.candidateId === item.id &&
    approval.body.manifestDigest === ready.manifestDigest && approval.body.evidenceDigest === ready.evidenceDigest, 'approval does not bind current candidate/evidence');
  require(validTime(approval.body.approvedAt) && time(approval.body.approvedAt) <= now && validTime(approval.body.expiresAt) &&
    now < time(approval.body.expiresAt) && time(approval.body.expiresAt) <= time(term.endsAt) && time(approval.body.approvedAt) >= time(term.startsAt), 'approval expired or outside manager term');
  return ready;
}

function transition(state, event, policy, now, checkFile) {
  const data = event.data;
  require(data && typeof data === 'object', 'event data required');
  if (event.type === 'candidate.requested') {
    const {plan, inputs} = data;
    require(plan?.schema === 'hps-release-plan/0' && !plan.trial && SHA.test(plan.candidate) && /^v\d+\.[1-9]\d*\.\d+$/.test(plan.version), 'invalid release-cut plan');
    require(typeof plan.rcTag === 'string' && plan.rcTag.startsWith(`${plan.version}-rc.`) && /^[1-9]\d*$/.test(plan.rcTag.slice(`${plan.version}-rc.`.length)), 'candidate rc tag required');
    require(inputs && SHA.test(inputs.serviceSha) && SHA.test(inputs.testRevision) && SHA.test(inputs.rubricRevision), 'pinned dependency/test/rubric revisions required');
    require(typeof inputs.sequence === 'number' && Number.isSafeInteger(inputs.sequence) && inputs.sequence > 0, 'monotonic channel sequence required');
    const input = {repository: 'hypeproof/hypeproof-studio', candidate: plan.candidate, version: plan.version, rcTag: plan.rcTag,
      channel: channelFor({input: {channel: 'stable'}}, inputs.channel), serviceSha: inputs.serviceSha, testRevision: inputs.testRevision, rubricRevision: inputs.rubricRevision, sequence: inputs.sequence};
    // A new delivery/run id cannot reset the attempt allowance for the same inputs.
    const {version: _version, rcTag: _tag, sequence: _sequence, ...identity} = input;
    // Channel promotion cannot create a second candidate or reset build attempts.
    // Normalize to the historical stable identity so existing stable IDs survive.
    const id = `candidate-${digest({identity: {...identity, channel: 'stable'}, policyDigest: policyDigest(policy)})}`;
    const existing = own(state.candidates, id);
    require(!existing || digest(existing.input) === digest(input), 'candidate inputs already pinned; do not reset version/sequence/attempts');
    if (!existing) state.candidates[id] = {id, input, policyDigest: policyDigest(policy), artifacts: {}, evidence: {}, approval: null, revokedApprovalDigests: [], createdAt: new Date(now).toISOString()};
    return {status: 'CANDIDATE_PINNED', candidateId: id};
  }
  if (event.type === 'quota.observed') {
    require(ID.test(data.resourceId) && ID.test(data.periodId), 'quota resource/period required');
    require(validTime(data.observedAt) && time(data.observedAt) <= now && validTime(data.startsAt) && validTime(data.endsAt) && time(data.startsAt) <= time(data.observedAt) && now < time(data.endsAt), 'invalid quota observation period');
    require(Number.isFinite(data.remainingUnits) && data.remainingUnits >= 0 && Number.isFinite(data.protectedUnits) && data.protectedUnits >= 0, 'quota units must be nonnegative');
    require(data.status === 'confirmed' && data.incrementalUnitCost === 0 && data.paidFallback === false && text(data.evidenceUri), 'QUOTA_BLOCKED: verified zero-incremental-cost allowance required');
    const previous = own(state.quotas, data.resourceId);
    require(!previous || time(data.observedAt) >= time(previous.observedAt), 'quota observation moved backwards');
    require(!previous || previous.periodId !== data.periodId || (previous.startsAt === data.startsAt && previous.endsAt === data.endsAt), 'quota period bounds changed');
    const pendingUnits = Object.values(state.reservations)
      .filter(r => r.resourceId === data.resourceId && r.periodId === data.periodId && r.status === 'reserved')
      .reduce((total, r) => total + r.units, 0);
    // A provider snapshot does not prove that uncompleted local work has been
    // charged already. Keep its full commitment in addition to the protected pool.
    const freeUnits = Math.max(0, data.remainingUnits - data.protectedUnits);
    const available = Math.max(0, freeUnits - pendingUnits);
    if (previous && previous.periodId !== data.periodId) {
      require(time(previous.endsAt) <= time(data.startsAt), 'quota periods overlap');
      require(!Object.values(state.reservations).some(r => r.resourceId === data.resourceId && r.status === 'reserved'), 'unsettled prior-period work');
    }
    state.quotas[data.resourceId] = {...data, pendingUnitsAtObservation: pendingUnits, underfunded: pendingUnits > freeUnits,
      availableUnits: previous?.periodId === data.periodId ? Math.min(previous.availableUnits, available) : available,
      overrun: previous?.periodId === data.periodId && previous.overrun === true};
    return {status: 'QUOTA_RECORDED', availableUnits: state.quotas[data.resourceId].availableUnits};
  }
  const item = candidate(state, data.candidateId);
  require(item.policyDigest === policyDigest(policy), 'release policy changed; cut a new candidate');
  if (event.type === 'artifact.recorded') {
    const required = policy.requiredArtifacts.find(a => a.id === data.artifact?.id);
    require(required, 'artifact is not in required policy');
    require(data.artifact.target === required.target, 'artifact target mismatch');
    verifiedFile(checkFile, data.artifact);
    item.artifacts[required.id] = data.artifact;
    return {status: 'ARTIFACT_RECORDED', artifactId: required.id};
  }
  if (event.type === 'evidence.recorded') {
    const report = data.envelope?.body;
    const check = policy.requiredTests.find(c => c.id === report?.testId);
    require(check, 'test is not required by policy');
    const manifest = manifestFor(item, policy);
    const reporter = policy.reporters.find(r => r.id === report.reporterId && check.reporterIds.includes(r.id));
    require(reporter, 'reporter is not allowed for this test');
    signed(data.envelope, reporter.publicKey);
    require(report.schema === 'hps-black-box-evidence/1' && report.candidateId === item.id && report.manifestDigest === digest(manifest), 'evidence candidate/manifest mismatch');
    require(report.artifactDigest === item.artifacts[check.artifactId].sha256 && report.serviceSha === item.input.serviceSha && report.testRevision === item.input.testRevision && report.rubricRevision === item.input.rubricRevision, 'evidence artifact/service/test/rubric mismatch');
    require(report.requirementId === check.requirementId && report.expected === check.expected && text(report.observed), 'evidence contract missing or changed');
    require(VERDICTS.has(report.verdict) && report.environment?.kind === check.environment && report.environment.target === item.artifacts[check.artifactId].target && text(report.environment.runnerId), 'installed-app environment required');
    // A real App using the existing synthetic acceptance cohort is valid execution;
    // mocked/replayed test evidence is not. Test data and execution scope are distinct.
    require(report.execution === 'observed' && report.fixture !== true, 'fixture results cannot authorize a release');
    require(validTime(report.startedAt) && validTime(report.endedAt) && time(report.startedAt) <= time(report.endedAt) && time(report.endedAt) <= now && time(report.startedAt) >= time(item.createdAt), 'invalid evidence execution time');
    const previous = own(item.evidence, check.id);
    require(!previous || time(report.endedAt) > time(previous.body.endedAt) || digest(previous) === digest(data.envelope), 'older/conflicting evidence cannot replace the latest result');
    verifiedFile(checkFile, report.file);
    item.evidence[check.id] = data.envelope;
    return {status: 'EVIDENCE_RECORDED', testId: check.id, verdict: report.verdict};
  }
  if (event.type === 'work.reserved') {
    require(ID.test(data.stage) && ID.test(data.resourceId) && Number.isSafeInteger(data.attempt) && data.attempt > 0 && data.attempt <= policy.maxAttemptsPerStage, 'invalid or exhausted work attempt');
    const work = policy.requiredWork.find(w => w.id === data.stage);
    const fix = data.stage.startsWith('fix:') && own(state.failures, data.stage.slice(4));
    require(work ? work.resourceId === data.resourceId : fix && fix.kind === 'product' && fix.observations.some(o => o.candidateId === item.id) && data.resourceId === policy.fixResourceId,
      'work stage/resource is not authorized by policy');
    require(Number.isFinite(data.units) && data.units > 0, 'positive work reservation required');
    const reservationId = `reservation-${digest({candidateId: item.id, stage: data.stage, attempt: data.attempt})}`;
    const previous = own(state.reservations, reservationId);
    if (previous) {
      require(previous.resourceId === data.resourceId && previous.units === data.units, 'conflicting reservation retry');
      return {status: 'WORK_RESERVED', reservationId, duplicate: true};
    }
    const prior = Object.values(state.reservations).filter(r => r.candidateId === item.id && r.stage === data.stage);
    require(data.attempt === prior.length + 1 && prior.every(r => r.status === 'settled'), 'previous attempt must be settled before retry');
    const quota = own(state.quotas, data.resourceId);
    require(quota?.status === 'confirmed' && !quota.overrun && !quota.underfunded && time(quota.observedAt) <= now && now < time(quota.endsAt) && now - time(quota.observedAt) <= policy.quotaMaxAgeSeconds * 1000 && quota.availableUnits >= data.units,
      'QUOTA_BLOCKED: insufficient, stale or unknown free allowance');
    quota.availableUnits -= data.units;
    state.reservations[reservationId] = {...data, reservationId, periodId: quota.periodId, status: 'reserved', reservedAt: new Date(now).toISOString()};
    return {status: 'WORK_RESERVED', reservationId};
  }
  if (event.type === 'work.settled') {
    const reservation = own(state.reservations, data.reservationId);
    require(reservation?.candidateId === item.id, 'unknown reservation');
    require(Number.isFinite(data.actualUnits) && data.actualUnits >= 0 && Number.isFinite(data.incrementalCost) && data.incrementalCost >= 0 && ['success', 'failed', 'cancelled', 'timeout'].includes(data.outcome), 'invalid settlement');
    if (reservation.status === 'settled') {
      require(reservation.actualUnits === data.actualUnits && reservation.incrementalCost === data.incrementalCost && reservation.outcome === data.outcome, 'conflicting settlement');
      return {status: 'WORK_SETTLED', reservationId: reservation.reservationId, duplicate: true};
    }
    Object.assign(reservation, {status: 'settled', actualUnits: data.actualUnits, incrementalCost: data.incrementalCost, outcome: data.outcome, settledAt: new Date(now).toISOString()});
    const exceeded = data.actualUnits > reservation.units || data.incrementalCost > 0;
    if (exceeded) state.quotas[reservation.resourceId].overrun = true;
    // Do not refund uncertain usage. Reconciliation may only reduce availability in this period.
    return {status: exceeded ? 'QUOTA_BLOCKED' : 'WORK_SETTLED', reservationId: reservation.reservationId};
  }
  if (event.type === 'approval.recorded') {
    const channel = channelFor(item, data.envelope?.body.channel);
    require(data.envelope?.body.channel === channel, 'signed approval channel required');
    item.approvals ??= {};
    item.approvals[channel] = data.envelope;
    item.approval = data.envelope;
    approvalGate(state, item, policy, now, checkFile, channel);
    return {status: 'APPROVED', approvalDigest: signedPayloadDigest(item.approval)};
  }
  if (event.type === 'approval.revoked') {
    const term = manager(policy, now);
    require(term && data.envelope?.body.actor === term.actor, 'only the current manager can revoke');
    signed(data.envelope, term.publicKey);
    const body = data.envelope.body;
    require(body.schema === 'hps-release-revocation/1' && body.candidateId === item.id && body.roleRevision === policy.managerRoster.revision && HASH.test(body.approvalDigest), 'invalid revocation');
    require(validTime(body.revokedAt) && time(body.revokedAt) <= now && time(body.revokedAt) >= time(term.startsAt), 'invalid revocation time');
    // Normalize a pre-fix request referencing the current canonical envelope.
    const revokedDigest = item.approval && body.approvalDigest === digest(item.approval)
      ? signedPayloadDigest(item.approval) : body.approvalDigest;
    if (!item.revokedApprovalDigests.includes(revokedDigest)) item.revokedApprovalDigests.push(revokedDigest);
    return {status: 'APPROVAL_REVOKED'};
  }
  if (event.type === 'failure.observed') {
    require(FAILURE_KINDS.has(data.kind) && ID.test(data.checkId) && text(data.signature) && text(data.evidenceUri), 'classified failure with evidence required');
    const key = `failure-${digest({repository: item.input.repository, testRevision: item.input.testRevision, kind: data.kind, checkId: data.checkId, signature: data.signature})}`;
    const failure = own(state.failures, key) ?? {id: key, kind: data.kind, checkId: data.checkId, signature: data.signature, observations: [], fixAttempts: 0};
    failure.observations.push({candidateId: item.id, eventId: event.id, evidenceUri: data.evidenceUri, at: new Date(now).toISOString()});
    state.failures[key] = failure;
    return {status: 'TICKET_INTENT', failureId: key, kind: failure.kind, observations: failure.observations.length};
  }
  if (event.type === 'fix.requested') {
    const failure = own(state.failures, data.failureId);
    require(failure?.observations.some(o => o.candidateId === item.id) && failure.kind === 'product', 'only product failures permit an automatic fix attempt');
    require(failure.fixAttempts < policy.maxFixAttempts, 'automatic fix attempt limit reached');
    const reservation = own(state.reservations, data.reservationId);
    require(reservation?.candidateId === item.id && reservation.stage === `fix:${failure.id}` && reservation.status === 'reserved', 'a bounded fix budget reservation is required');
    failure.fixAttempts++;
    return {status: 'FIX_INTENT', failureId: failure.id, attempt: failure.fixAttempts, reservationId: reservation.reservationId};
  }
  if (event.type === 'promotion.requested') {
    const channel = channelFor(item, data.channel);
    const ready = approvalGate(state, item, policy, now, checkFile, channel);
    const stable = own(state.promotions, 'stable');
    require(channel !== 'canary' || !stable || stable.sequence < item.input.sequence, 'stable channel already reached this or a newer sequence');
    const previous = own(state.promotions, channel);
    require(!previous || previous.sequence <= item.input.sequence, 'newer channel intent already exists');
    require(!previous || previous.sequence !== item.input.sequence || previous.manifestDigest === ready.manifestDigest, 'channel sequence already belongs to another manifest');
    const intent = {schema: 'hps-promotion-intent/1', status: 'READY_FOR_PUBLISHER', ...item.input, channel, candidateId: item.id,
      manifestDigest: ready.manifestDigest, evidenceDigest: ready.evidenceDigest, manifest: ready.manifest,
      approval: approvalFor(item, channel), createdAt: new Date(now).toISOString()};
    state.promotions[channel] = intent;
    return {status: 'PROMOTION_INTENT', intent};
  }
  throw new Error(`unknown event type ${event.type}`);
}

export function applyEvent(state, event, policy, {now = Date.now(), checkFile} = {}) {
  validatePolicy(policy);
  require(state?.schema === 'hps-release-ledger/1', 'invalid ledger schema');
  require(ID.test(event?.id) && typeof event.type === 'string', 'invalid event id/type');
  const fingerprint = digest(event);
  const previous = own(state.events, event.id);
  if (previous) {
    require(previous.fingerprint === fingerprint, 'event id reused with different payload');
    // An old promotion result is never authority to publish: revalidate it against current state.
    if (event.type === 'promotion.requested') {
      try { validateIntent(state, previous.result.intent, policy, now, checkFile); }
      catch (error) { return {state, result: {status: 'BLOCKED', reason: error.message}}; }
    }
    if (event.type === 'approval.recorded' && previous.result.status === 'APPROVED') {
      try {
        const item = candidate(state, event.data.candidateId);
        const channel = channelFor(item, event.data.envelope?.body.channel);
        require(signedPayloadDigest(approvalFor(item, channel)) === signedPayloadDigest(event.data.envelope), 'approval has been superseded');
        approvalGate(state, item, policy, now, checkFile, channel);
      } catch (error) { return {state, result: {status: 'BLOCKED', reason: error.message}}; }
    }
    return {state, result: {...previous.result, duplicate: true}};
  }
  let next = structuredClone(state);
  let result;
  try { result = transition(next, event, policy, now, checkFile); }
  catch (error) { next = structuredClone(state); result = {status: 'BLOCKED', reason: error.message}; }
  next.events[event.id] = {fingerprint, type: event.type, at: new Date(now).toISOString(), result};
  next.revision++;
  return {state: next, result};
}

// Run immediately before handing an intent to the existing tag/PR publisher gate.
// This is read-only and is not an authorization token for a later unattended publish.
export function validateIntent(state, intent, policy, now = Date.now(), checkFile) {
  require(intent?.schema === 'hps-promotion-intent/1', 'promotion intent required');
  validatePolicy(policy);
  const item = candidate(state, intent.candidateId);
  require(CHANNELS.has(intent.channel), 'intent channel required');
  const channel = channelFor(item, intent.channel);
  const stable = own(state.promotions, 'stable');
  require(channel !== 'canary' || !stable || stable.sequence < item.input.sequence, 'stable channel already reached this or a newer sequence');
  const ready = approvalGate(state, item, policy, now, checkFile, channel);
  signed(intent.approval, manager(policy, now).publicKey);
  require(signedPayloadDigest(intent.approval) === signedPayloadDigest(approvalFor(item, channel)), 'intent approval has been superseded');
  require(digest(intent.manifest) === ready.manifestDigest && intent.manifestDigest === ready.manifestDigest && intent.evidenceDigest === ready.evidenceDigest, 'intent is stale');
  require(intent.candidate === item.input.candidate && intent.version === item.input.version && intent.rcTag === item.input.rcTag && intent.sequence === item.input.sequence, 'intent source/version mismatch');
  const latest = own(state.promotions, channel);
  require(latest && digest(latest) === digest(intent), 'intent is no longer the latest channel intent');
  return {status: 'READY_FOR_PUBLISHER', candidate: item.input.candidate, tag: item.input.version, manifestDigest: ready.manifestDigest};
}
