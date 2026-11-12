import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleAutomationRuntime } from '../src/googleAutomation.ts';
import { createAppsScriptRuntime } from '../src/appsScriptRuntime.ts';

for (const [name, create] of [['Gmail', createGoogleAutomationRuntime], ['Apps Script', createAppsScriptRuntime]]) {
 test(`${name}: Stop closes an OAuth wait, preserves old credentials and permits a fresh connection`, async () => {
  let closed = 0, opened = 0, rejectWait, listenerReady, releaseListener;
  let delayListener = false;
  const secrets = new Map([['existing-credential', 'synthetic-preserved']]);
  const runtime = create({ clientId: 'synthetic-client', isAllowed: () => true,
   secrets: { get: async k => secrets.get(k), store: async () => assert.fail('cancelled OAuth must not store credentials'), delete: async () => assert.fail('Stop must not disconnect an existing account') },
   ledger: { load: async () => ({}), save: async () => assert.fail('no email side effects') },
   fetchImpl: async () => assert.fail('cancelled callback must not exchange tokens or call Google'),
   openBrowser: async () => { opened++; },
   listenOAuth: async () => {
    const wait = new Promise((_, reject) => { rejectWait = reject; }); void wait.catch(() => {});
    const listener = { redirectUri: 'http://127.0.0.1:43210/oauth/callback', wait, close() { closed++; rejectWait(new Error('synthetic closed callback')); } };
    listenerReady = true;
    if (delayListener) await new Promise(resolve => { releaseListener = resolve; });
    return listener;
   },
  });
  for (const delayed of [false, true, false]) {
   delayListener = delayed; listenerReady = false;
   const result = runtime.connect().then(() => ({ succeeded: true }), error => ({ error }));
   while (!listenerReady || (!delayed && opened === 0)) await new Promise(resolve => setImmediate(resolve));
   if (!delayed) await new Promise(resolve => setImmediate(resolve));
   assert.equal(runtime.cancelConnect(), true);
   if (delayed) releaseListener();
   assert.ok((await result).error, 'cancelled wait must settle without success');
   assert.equal(runtime.cancelConnect(), false, 'the finished attempt releases its cancellation handle');
   assert.deepEqual([...secrets], [['existing-credential', 'synthetic-preserved']]);
  }
  assert.equal(opened, 2, 'cancel before listener setup does not open the browser');
  assert.ok(closed >= 3, 'every listener is closed');
 });
}
