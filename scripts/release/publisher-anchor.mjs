// Cross-language transport guard over the complete product CAS view, not an approval engine.
import {digest} from './engine/core.mjs';
const require = (ok, reason) => { if (!ok) throw Error(reason); };
const text = value => {
  require(typeof value === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), 'non-JSON/unpaired-surrogate string');
  return value;
};
export function typedTree(value) {
  if (value === null) return ['z'];
  if (typeof value === 'boolean') return ['b', value];
  if (typeof value === 'string') return ['s', text(value)];
  if (typeof value === 'number') {
    require(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)), 'non-finite or unsafe JSON number');
    const bytes = Buffer.alloc(8); bytes.writeDoubleBE(value); return ['n', bytes.toString('hex')];
  }
  if (Array.isArray(value)) return ['a', value.map(typedTree)];
  require(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'non-JSON value');
  return ['o', Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(text(a)), Buffer.from(text(b)))).map(key => [key, typedTree(value[key])])];
}
export const typedDigest = value => digest(typedTree(value));
export function publisherView(state, registry, operationId) {
  const S = structuredClone(state), R = structuredClone(registry);
  delete S.revision; delete R.revision;
  const operation = S.operations?.[operationId];
  if (operation) for (const key of ['status', 'result', 'finishedAt']) delete operation[key];
  return {state: S, registry: R};
}
export const viewDigest = (state, registry, operationId) => typedDigest(publisherView(state, registry, operationId));
export const stateBranch = (repository, tag) => 'ops/release-state/' + digest({repository, tag}).slice(0, 32);

export function validateAnchor(anchor, state, registry, contract, receipt) {
  require(anchor?.schema === 'hps-publisher-anchor/1' && anchor.algorithm === 'typed-double-v1' && anchor.status === 'READY', 'ready publisher anchor required');
  require(anchor.repository === contract.repository && anchor.candidateDigest === state.candidateDigest && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(anchor.operationId), 'publisher anchor scope mismatch');
  require(anchor.candidateBranch === stateBranch(contract.repository, contract.rcTag) && anchor.registryBranch === stateBranch(contract.repository, 'release-result-routing-v1'), 'publisher anchor branch mismatch');
  require(viewDigest(state, registry, anchor.operationId) === anchor.viewDigest, 'live publisher CAS changed; old PASS is no longer authoritative');
  const operation = state.operations?.[anchor.operationId], request = operation?.request;
  require(operation?.kind === 'publish-pass' && ['UNKNOWN', 'DONE'].includes(operation.status), 'reserved publish-pass operation required');
  require(request?.repository === contract.repository && request.releasePr === contract.releasePr && request.releaseHead === contract.releaseHead && request.candidateSha === contract.candidate && request.rcTag === contract.rcTag && request.contractDigest === digest(contract), 'publication request differs from current release');
  require(/^[a-f0-9]{64}$/.test(receipt.bundleDigest) && /^[a-f0-9]{40}$/.test(receipt.evidenceCommit) && /^[a-f0-9]{64}$/.test(receipt.dispatchKey) &&
    operation.result?.bundleDigest === receipt.bundleDigest && operation.result?.evidenceCommit === receipt.evidenceCommit &&
    operation.result?.dispatchKey === receipt.dispatchKey && request.dispatchKey === receipt.dispatchKey,
    'prepared publication receipt differs from private bundle/commit/dispatch key');
  const quote = operation.quote, started = Date.parse(operation.startedAt), reserved = Number(operation.reservedUsd), upper = Number(quote?.upperBoundUsd);
  require(quote?.status === 'CONFIRMED' && quote.kind === 'publish-pass' && quote.candidateDigest === state.candidateDigest &&
    quote.requestDigest === operation.requestDigest && operation.requestDigest === digest({kind: 'publish-pass', request}) &&
    quote.paidFallback === false && typeof quote.evidence === 'string' && quote.evidence.length > 0 &&
    Date.parse(quote.observedAt) <= started && started < Date.parse(quote.expiresAt) &&
    Number.isFinite(reserved) && Number.isFinite(upper) && upper >= 0 && reserved >= upper,
    'publication quote/reservation binding differs');
  require(/^[a-f0-9]{40}$/.test(request.workflowHead) && request.workflow === 'release-promote.yml' &&
    /^[a-f0-9]{64}$/.test(request.readinessDigest) && request.readinessDigest === anchor.readinessDigest, 'publication workflow/readiness scope differs');
  return operation;
}
export function readLiveAnchor(anchor, contract, receipt, get) {
  require(anchor?.schema === 'hps-publisher-anchor/1' && anchor.status === 'READY', 'ready publisher anchor required');
  require(contract.repository === 'hypeproof/hypeproof-studio', 'fixed Studio product scope required');
  const repository = contract.repository;
  const read = branch => {
    const ref = get(`repos/${repository}/git/ref/heads/${branch}`);
    require(ref.object?.type === 'commit' && /^[a-f0-9]{40}$/.test(ref.object.sha), 'live CAS commit required');
    const file = get(`repos/${repository}/contents/state.json?ref=${ref.object.sha}`);
    require(file.encoding === 'base64' && typeof file.content === 'string', 'live CAS state bytes required');
    return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  };
  // Branches are derived from the current product contract, never caller URLs/refs.
  const state = read(stateBranch(repository, contract.rcTag));
  const registry = read(stateBranch(repository, 'release-result-routing-v1'));
  validateAnchor(anchor, state, registry, contract, receipt);
  return {state, registry};
}
