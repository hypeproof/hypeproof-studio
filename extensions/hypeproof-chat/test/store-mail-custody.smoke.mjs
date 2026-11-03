// Epic #3418 custody on the buyer's and the creator's device (design v1 D7, D10, F7).
// - D10/F7: a store mail skill is previewed and sent from Service-rendered messages only; every recipient must be
//   an address in the buyer's own sheet as last read, once each, and a send still needs the exact-preview approval.
// - D7: the creator's draft in globalState is AES-256-GCM ciphertext under a per-device key; a copied value does not
//   open in another namespace or with another device's key, and a legacy plaintext draft opens as it is.
//
// Run: node --experimental-strip-types --test test/store-mail-custody.smoke.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGoogleAutomationRuntime } from '../src/googleAutomation.ts';
import { DRAFT_KEY_SECRET, deviceDraftKey, isSealedDraft, openDraft, sealDraft } from '../src/automationDraftSeal.ts';

const rows = [['이메일', '이름', '서류', '기한'], ['minji@example.invalid', '민지', '업무 현황', '11월 6일'], ['jun@example.invalid', '준', '보고서', '11월 7일']];
function fixture() {
  const secrets = new Map([['hps.google.email-automation.v1', JSON.stringify({ accessToken: 'synthetic-token', accountId: 'synthetic-account', expiresAt: Date.now() + 3600000 })]]);
  let ledger = {}; let sends = 0;
  const deps = {
    clientId: 'synthetic-client', maxRecipients: 20, isAllowed: () => true, openBrowser: async () => {},
    secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); } },
    ledger: { load: async () => structuredClone(ledger), save: async (v) => { ledger = structuredClone(v); }, withLock: (fn) => fn() },
    fetchImpl: async (url) => {
      if (String(url).includes('sheets.googleapis.com')) return Response.json({ values: rows });
      if (String(url).includes('gmail.googleapis.com')) { sends++; return Response.json({ id: 'synthetic-message' }); }
      return new Response('{}', { status: 404 });
    },
  };
  return { runtime: createGoogleAutomationRuntime(deps), get sends() { return sends; } };
}
const rendered = [
  { to: 'minji@example.invalid', subject: '민지님, 업무 현황 제출 안내', body: '민지님, 업무 현황를 11월 6일까지 제출해 주세요.' },
  { to: 'jun@example.invalid', subject: '준님, 보고서 제출 안내', body: '준님, 보고서를 11월 7일까지 제출해 주세요.' },
];

test('D10/F7: rendered messages become the exact preview; a recipient outside the sheet, a duplicate or an injected header never does', async () => {
  const f = fixture();
  await assert.rejects(f.runtime.previewRendered({ messages: rendered }), /시트를 다시 읽어/, 'no preview before the buyer\'s sheet is read');
  await f.runtime.readSheet({ spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21' });
  // Negative controls, each with no send: an address the sheet does not have, a repeated one, a header in the subject.
  await assert.rejects(f.runtime.previewRendered({ messages: [...rendered, { to: 'attacker@example.invalid', subject: 's', body: 'b' }] }), /명단에 없는/);
  await assert.rejects(f.runtime.previewRendered({ messages: [rendered[0], rendered[0]] }), /중복/);
  await assert.rejects(f.runtime.previewRendered({ messages: [{ ...rendered[0], subject: 'x\r\nBcc: attacker@example.invalid' }] }));
  assert.equal(f.sends, 0);
  // Positive: exactly the rendered text, frozen, and sent only with the approval of that preview.
  const preview = await f.runtime.previewRendered({ messages: rendered });
  assert.deepEqual(preview.messages.map((m) => [m.to, m.subject, m.body]), rendered.map((m) => [m.to, m.subject, m.body]));
  assert.throws(() => { preview.messages[0].to = 'changed@example.invalid'; }, TypeError);
  await assert.rejects(f.runtime.send({ previewId: preview.id, approved: false }), /승인/);
  assert.equal(f.sends, 0);
  const result = await f.runtime.send({ previewId: preview.id, approved: true });
  assert.deepEqual(result.records.map((r) => r.status), ['sent', 'sent']);
  assert.equal(f.sends, 2);
});

test('D10: the store mail run has no path into the Apps Script generator or the shared runner', () => {
  // The run reads the sheet, renders through the Service and sends through the Gmail runtime only. Structural:
  // the function body names neither Apps Script nor the shared-runner deployment, so no recipe can reach either.
  const src = readFileSync(new URL('../src/automationHost.ts', import.meta.url), 'utf8');
  const start = src.indexOf('async runStoreMail(');
  const body = src.slice(start, src.indexOf('\n    },\n', start));
  assert.ok(start > 0 && body.includes('active.previewRendered(') && body.includes('active.send('));
  for (const forbidden of ['appsRuntime', 'appsTools', 'sharedDeployment', 'generateAppsScriptEmailProject', 'previewLatestSheet', 'savedDraft']) assert.ok(!body.includes(forbidden), forbidden);
});

test('D7: the creator\'s draft is sealed per device and namespace; a legacy plaintext draft still opens', async () => {
  const store = new Map();
  const keyring = { get: async (k) => store.get(k), store: async (k, v) => { store.set(k, v); } };
  const key = await deviceDraftKey(keyring);
  assert.equal((await deviceDraftKey(keyring)).equals(key), true, 'one key per device, reused');
  assert.ok(store.has(DRAFT_KEY_SECRET));
  const draft = { schema: 'hps-email-automation/1', title: '서류 제출 요청', subjectTemplate: 'SECRET-SUBJECT {{name}}', bodyTemplate: 'SECRET-BODY' };
  const sealed = sealDraft(key, 'ns-a', draft);
  assert.ok(isSealedDraft(sealed));
  assert.ok(!JSON.stringify(sealed).includes('SECRET'), 'no template text at rest');
  assert.deepEqual(openDraft(key, 'ns-a', sealed), draft);
  // Negative controls: another activity's slot, another device's key, a tampered ciphertext.
  assert.throws(() => openDraft(key, 'ns-b', sealed));
  const other = await deviceDraftKey({ get: async () => undefined, store: async () => {} });
  assert.throws(() => openDraft(other, 'ns-a', sealed));
  assert.throws(() => openDraft(key, 'ns-a', { ...sealed, data: Buffer.from('x' + Buffer.from(sealed.data, 'base64').toString('latin1'), 'latin1').toString('base64') }));
  assert.deepEqual(openDraft(key, 'ns-a', draft), draft, 'a legacy plaintext draft opens as it is (and is re-sealed by the host)');
});
