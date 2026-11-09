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
