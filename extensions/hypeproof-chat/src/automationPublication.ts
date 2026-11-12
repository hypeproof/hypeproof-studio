import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createAutomationLedger } from './automationLedger.ts';
import { AutomationPublicationWithdrawnError, type AutomationStoreClient } from './automationStoreClient.ts';
import type { AutomationRecipe } from './automationProtocol';

// Persist only content digests and request IDs, separately from recipes, Google
// credentials and the send ledger. Lost responses must reuse the same intent.
export async function publishAutomationRecipe(deps: {
  storageRoot: string; namespace: string; store: AutomationStoreClient;
  authorize(): Promise<void>;
}, recipe: AutomationRecipe, parentId?: string, sourceId?: string) {
  if (parentId && sourceId) throw new Error('새 버전과 새 출처를 함께 지정할 수 없어요.');
  const ledger = createAutomationLedger(deps.storageRoot, deps.namespace);
  return ledger.withLock(async () => {
    const hash = createHash('sha256').update(parentId ? JSON.stringify({ recipe, parentId }) : sourceId ? JSON.stringify({ recipe, sourceId }) : JSON.stringify(recipe)).digest('hex');
    const file = join(deps.storageRoot, 'email-automation', deps.namespace, 'publications.json');
    let requests: Record<string, string> = {};
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.entries(value).some(([key, id]) => !/^[a-f0-9]{64}$/.test(key) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(id))) throw new Error('Invalid journal');
      requests = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('게시 요청 기록을 확인할 수 없어요. 새로 게시하기 전에 기록을 확인해 주세요.');
    }
    const save = async () => {
      const temporary = `${file}.${randomUUID()}.tmp`;
      let handle: fs.FileHandle | undefined;
      try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(requests)); await handle.sync();
        await handle.close(); handle = undefined;
        await fs.rename(temporary, file);
      } finally { await handle?.close(); await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    };
    await deps.authorize();
    const requestId = requests[hash] ?? `skill-${hash}`;
    try { return await deps.store.publish(recipe, requestId, parentId, sourceId); }
    catch (error) {
      if (error instanceof AutomationPublicationWithdrawnError) {
        // Never replay a withdrawn intent as a new publication automatically.
        // Prepare a durable replacement; the next call needs fresh UI approval.
        await deps.authorize();
        requests[hash] = `skill-${randomUUID()}`;
        await save();
      }
      throw error;
    }
  });
}
