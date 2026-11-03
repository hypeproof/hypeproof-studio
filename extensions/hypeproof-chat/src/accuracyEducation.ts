/** CGP-SHELL-R-023: local education only; no assessment or outbound event. */
export const ACCURACY_COPY = 'AI도 틀릴 수 있어요. 결과를 직접 눌러 확인해 봐요.';
export interface AccuracyOffer { scope: string; messageId: string }
export interface AccuracyStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}
const key = (owner: string, suffix: string) => `hps.accuracyEducation.v1.${owner}.${suffix}`;
export function accuracyOffer(store: AccuracyStore, owner: string, scope: string): AccuracyOffer | null {
  if (store.get(key(owner, 'dismissed')) === true) return null;
  const offer = store.get<AccuracyOffer>(key(owner, 'offer'));
  return offer?.scope === scope && typeof offer.messageId === 'string' ? offer : null;
}
export async function offerAccuracy(store: AccuracyStore, owner: string, offer: AccuracyOffer,
  result: { status: string; text: string; instructor: boolean }): Promise<void> {
  if (result.instructor || result.status !== 'ok' || !result.text.trim()) return;
  if (store.get(key(owner, 'dismissed')) === true || store.get(key(owner, 'offer'))) return;
  await store.update(key(owner, 'offer'), offer);
}
export async function dismissAccuracy(store: AccuracyStore, owner: string, scope: string, messageId: string): Promise<boolean> {
  if (accuracyOffer(store, owner, scope)?.messageId !== messageId) return false;
  // Separate monotonic flag: a late offer from another window cannot undo dismissal.
  await store.update(key(owner, 'dismissed'), true);
  return true;
}
