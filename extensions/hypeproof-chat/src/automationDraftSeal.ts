// The creator's local automation draft, sealed at rest (Epic #3418 custody design v1 D7).
//
// The draft lives in `globalState` (a plain database file). It is stored as AES-256-GCM ciphertext under a
// per-device key kept in SecretStorage (Electron safeStorage → macOS Keychain / Windows DPAPI), the same
// pattern as activityTrash.ts. A copy of the database file alone opens nothing on another device. The AAD
// binds a sealed value to its namespace, so a value cannot be moved to another activity's slot.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const DRAFT_KEY_SECRET = 'hps.automation.draft-key.v1';
const SCHEMA = 'hps-sealed-automation-draft/1';
export interface DraftKeyring { get(name: string): PromiseLike<string | undefined>; store(name: string, value: string): PromiseLike<void> }
export interface SealedDraft { schema: typeof SCHEMA; iv: string; data: string; tag: string }

const aad = (namespace: string) => Buffer.from(`${SCHEMA}\u0000${namespace}`);

/** This device's draft key, created on first use. Kept only in SecretStorage; callers hold it in memory. */
export async function deviceDraftKey(keyring: DraftKeyring): Promise<Buffer> {
  const stored = await keyring.get(DRAFT_KEY_SECRET);
  if (stored) {
    const key = Buffer.from(stored, 'base64');
    if (key.length === 32) return key;
    throw new Error('이 기기의 자동화 보관 키를 확인할 수 없어요.');
  }
  const key = randomBytes(32);
  await keyring.store(DRAFT_KEY_SECRET, key.toString('base64'));
  return key;
}

export const isSealedDraft = (value: unknown): value is SealedDraft =>
  !!value && typeof value === 'object' && (value as SealedDraft).schema === SCHEMA;

export function sealDraft(key: Buffer, namespace: string, value: unknown): SealedDraft {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(namespace));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { schema: SCHEMA, iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

/** The stored value as plaintext: a sealed draft is opened; anything else is a legacy plaintext draft, returned as is. */
export function openDraft(key: Buffer, namespace: string, stored: unknown): unknown {
  if (!isSealedDraft(stored)) return stored;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
  decipher.setAAD(aad(namespace));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf8'));
}
