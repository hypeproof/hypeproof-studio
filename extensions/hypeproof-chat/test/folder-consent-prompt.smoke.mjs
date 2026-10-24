import assert from 'node:assert/strict';
import { FolderConsentRequest } from '../src/folderConsentPrompt.ts';

let scope = 'activity-one/folder-one', serial = 0, shown = [], visible = true;
const request = new FolderConsentRequest({ id: () => String(++serial), scope: () => scope, present: async prompt => { shown.push(prompt); return visible; } });
for (const level of ['full', 'read', 'none']) {
  const pending = request.ask('/synthetic/folder');
  const prompt = shown.at(-1);
  assert.equal(prompt.folder, '/synthetic/folder');
  request.respond('wrong-id', 'full');
  assert.equal(await request.ask('/other'), undefined, 'concurrent request is refused');
  request.respond(prompt.id, level);
  assert.equal(await pending, level);
  request.respond(prompt.id, 'full');
  assert.equal(shown.at(-1), null, 'answered prompt is cleared');
}
for (const change of ['scope', 'malformed', 'cancel']) {
  const pending = request.ask('/synthetic/folder'), id = shown.at(-1).id;
  if (change === 'scope') { scope = 'different-activity'; request.invalidateIfScopeChanged(); }
  else if (change === 'malformed') request.respond(id, { level: 'full' });
  else request.cancel();
  assert.equal(await pending, undefined, change);
}
const stale = request.ask('/synthetic/folder'), staleId = shown.at(-1).id;
scope = 'another-folder'; request.respond(staleId, 'full');
assert.equal(await stale, undefined, 'scope is checked at the answer even without an intervening event');
visible = false;
assert.equal(await request.ask('/hidden'), undefined, 'hidden panel cannot grant permission');
const throwing = new FolderConsentRequest({ id: () => 'throw', scope: () => scope, present: async () => { throw Error('closed'); } });
assert.equal(await throwing.ask('/closed'), undefined);
const expiring = new FolderConsentRequest({ id: () => 'expire', scope: () => scope, present: async () => true }, 5);
assert.equal(await expiring.ask('/timeout'), undefined);
console.log('PASS folder consent request: exact IDs, three choices, single flight, scope changes, malformed responses, cancellation, hidden/error/timeout refusal');
