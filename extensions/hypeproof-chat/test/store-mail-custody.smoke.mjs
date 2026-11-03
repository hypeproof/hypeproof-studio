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
import { runStoreMail, storeMailHostDeps, STORE_MAIL_APPROVE } from '../src/storeMail.ts';
import { storeErrorMessage } from '../src/skillStore.ts';

// The third column of 민지's row holds another address (a manager to copy): it is in the sheet but not a recipient.
const rows = [['이메일', '이름', '서류', '기한', '참조'], ['minji@example.invalid', '민지', '업무 현황', '11월 6일', 'boss@example.invalid'], ['jun@example.invalid', '준', '보고서', '11월 7일', '']];
function fixture() {
  const secrets = new Map([['hps.google.email-automation.v1', JSON.stringify({ accessToken: 'synthetic-token', accountId: 'synthetic-account', expiresAt: Date.now() + 3600000 })]]);
  let ledger = {}; let sends = 0;
  const deps = {
    clientId: 'synthetic-client', maxRecipients: 20, isAllowed: () => true, openBrowser: async () => {},
    secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); } },
    ledger: { load: async () => structuredClone(ledger), save: async (v) => { ledger = structuredClone(v); }, withLock: (fn) => fn() },
    fetchImpl: async (url) => {
      if (String(url).includes('sheets.googleapis.com')) return Response.json({ values: rows.map((r) => r.slice(0, 4)).map((r, i) => [...r, rows[i][4]]) });
      if (String(url).includes('gmail.googleapis.com')) { sends++; return Response.json({ id: 'synthetic-message' }); }
      return new Response('{}', { status: 404 });
    },
  };
  return { runtime: createGoogleAutomationRuntime(deps), secrets, get sends() { return sends; } };
}
const rendered = [
  { to: 'minji@example.invalid', subject: '민지님, 업무 현황 제출 안내', body: '민지님, 업무 현황를 11월 6일까지 제출해 주세요.' },
  { to: 'jun@example.invalid', subject: '준님, 보고서 제출 안내', body: '준님, 보고서를 11월 7일까지 제출해 주세요.' },
];

test('D10/F7: rendered messages become the exact preview; a recipient outside the sheet, a duplicate or an injected header never does', async () => {
  const f = fixture();
  await assert.rejects(f.runtime.previewRendered({ emailColumn: '이메일', messages: rendered }), /시트를 다시 읽어/, 'no preview before the buyer\'s sheet is read');
  await f.runtime.readSheet({ spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21' });
  // Negative controls, each with no send: an address the sheet does not have, a repeated one, a header in the subject.
  await assert.rejects(f.runtime.previewRendered({ emailColumn: '이메일', messages: [...rendered, { to: 'attacker@example.invalid', subject: 's', body: 'b' }] }), /명단에 없는/);
  await assert.rejects(f.runtime.previewRendered({ emailColumn: '이메일', messages: [rendered[0], rendered[0]] }), /중복/);
  await assert.rejects(f.runtime.previewRendered({ emailColumn: '이메일', messages: [{ to: 'boss@example.invalid', subject: 's', body: 'b' }] }), /명단에 없는/, 'an address outside the recipient column is not a recipient');
  await assert.rejects(f.runtime.previewRendered({ emailColumn: '메일', messages: rendered }), /열을 하나만/);
  await assert.rejects(f.runtime.previewRendered({ emailColumn: '이메일', messages: [{ ...rendered[0], subject: 'x\r\nBcc: attacker@example.invalid' }] }));
  assert.equal(f.sends, 0);
  // Positive: exactly the rendered text, frozen, and sent only with the approval of that preview.
  const preview = await f.runtime.previewRendered({ emailColumn: '이메일', messages: rendered });
  assert.deepEqual(preview.messages.map((m) => [m.to, m.subject, m.body]), rendered.map((m) => [m.to, m.subject, m.body]));
  assert.throws(() => { preview.messages[0].to = 'changed@example.invalid'; }, TypeError);
  await assert.rejects(f.runtime.send({ previewId: preview.id, approved: false }), /승인/);
  assert.equal(f.sends, 0);
  // Only the newest preview can be sent: an older one is cleared when a new one is made.
  const newer = await f.runtime.previewRendered({ emailColumn: '이메일', messages: rendered });
  await assert.rejects(f.runtime.send({ previewId: preview.id, approved: true }));
  assert.equal(f.sends, 0);
  const result = await f.runtime.send({ previewId: newer.id, approved: true });
  assert.deepEqual(result.records.map((r) => r.status), ['sent', 'sent']);
  assert.equal(f.sends, 2);
  // A changed Google connection after the read invalidates the sheet: no preview from it.
  f.secrets.set('hps.google.email-automation.v1', JSON.stringify({ accessToken: 'other-token', accountId: 'other-account', expiresAt: Date.now() + 3600000 }));
  await assert.rejects(f.runtime.previewRendered({ emailColumn: '이메일', messages: rendered }), /시트를 다시 읽어/);
});

const SKILL = { title: '서류 제출 요청', params: [{ name: 'email', label: '이메일' }, { name: 'name', label: '이름' }, { name: 'document', label: '서류' }, { name: 'due_date', label: '기한' }] };
function host(patch = {}) {
  const calls = { render: [], sends: 0, confirms: 0 };
  const sheetRows = [['이메일', '이름', '서류', '기한'], ['minji@example.invalid', '민지', '업무 현황', '11월 6일'], ['', '', '', ''], ['jun@example.invalid', '준', '보고서', '11월 7일']];
  const deps = {
    maxRecipients: 20,
    runtime: {
      getConnectionIdentity: async () => 'google-A',
      readSheet: async () => sheetRows,
      previewRendered: async ({ emailColumn, messages }) => { assert.equal(emailColumn, '이메일'); return { id: 'p1', createdAt: 1, messages }; },
      send: async () => { calls.sends++; return { records: [{ status: 'sent' }, { status: 'sent' }] }; },
    },
    sheet: async () => ({ spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21', connection: 'google-A' }),
    confirm: async () => { calls.confirms++; return true; },
    stillAllowed: async () => true,
    ...patch,
  };
  const render = async (r) => { calls.render.push(r); return (patch.rendered ?? ((rr) => rr.map((x) => ({ to: x.to, subject: `${x.values.name}님`, body: 'b' }))))(r); };
  return { run: () => runStoreMail(deps, SKILL, render), calls };
}

test('D10/F7 host run: only roster rows go out; a wrong row, a cancel, another Google account, the cap or a changed activity sends nothing', async () => {
  const ok = host();
  assert.deepEqual(await ok.run(), { sent: 2, failed: 0 });
  // Only the rows (address + parameter cells) leave the device; the blank row is skipped.
  assert.deepEqual(ok.calls.render[0], [
    { to: 'minji@example.invalid', values: { name: '민지', document: '업무 현황', due_date: '11월 6일' } },
    { to: 'jun@example.invalid', values: { name: '준', document: '보고서', due_date: '11월 7일' } },
  ]);
  const cases = [
    ['a rendered message to another address', { rendered: (r) => r.map((x, i) => ({ to: i ? 'attacker@example.invalid' : x.to, subject: 's', body: 'b' })) }, /내 명단과 달라요/],
    ['one message missing', { rendered: (r) => r.slice(1).map((x) => ({ to: x.to, subject: 's', body: 'b' })) }, /내 명단과 달라요/],
    ['a sheet set up under another Google account', { sheet: async () => ({ spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21', connection: 'google-B' }) }, /명단 시트를 연결/],
    ['more rows than the recipient cap', { maxRecipients: 1 }, /1명까지/],
    ['the activity changed after approval', { stillAllowed: async () => false }, /활동이 변경/],
  ];
  for (const [name, patch, error] of cases) {
    const h = host(patch);
    await assert.rejects(h.run(), error, name);
    assert.equal(h.calls.sends, 0, name);
  }
  const cancelled = host({ confirm: async () => false });
  assert.deepEqual(await cancelled.run(), { cancelled: true });
  assert.equal(cancelled.calls.sends, 0);
  // The buyer sees the host's own reason, not the generic store sentence; an internal error stays generic.
  assert.equal(storeErrorMessage(new Error('먼저 내 명단 시트를 연결해 주세요.')), '먼저 내 명단 시트를 연결해 주세요.');
  assert.equal(storeErrorMessage(new Error('TypeError: x is undefined')), '지금은 스토어를 열 수 없어요. 잠시 뒤 다시 시도해 주세요.');
});

test('D10/F7 host wiring: the modal answer is the approval, the activity is checked again, the cap is the activity\'s', async () => {
  const sends = [];
  const runtime = {
    getConnectionIdentity: async () => 'google-A',
    readSheet: async () => [['이메일', '이름', '서류', '기한'], ['minji@example.invalid', '민지', '업무 현황', '11월 6일'], ['jun@example.invalid', '준', '보고서', '11월 7일']],
    previewRendered: async ({ messages }) => ({ id: 'p1', createdAt: 1, messages }),
    send: async () => { sends.push(1); return { records: [{ status: 'sent' }, { status: 'sent' }] }; },
  };
  const render = async (rows) => rows.map((r) => ({ to: r.to, subject: `${r.values.name}님`, body: 'b' }));
  const sheet = async () => ({ spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21', connection: 'google-A' });
  const modals = [];
  const deps = (answer, allowed = true, maxRecipients = 20) => storeMailHostDeps({ runtime, maxRecipients, title: '서류 제출 요청', sheet, reauthorize: async () => allowed,
    showModal: async (message, detail, approve) => { modals.push({ message, detail, approve }); return answer; } });
  // Dismissed, or any other button: nothing is sent.
  assert.deepEqual(await runStoreMail(deps(undefined), SKILL, render), { cancelled: true });
  assert.deepEqual(await runStoreMail(deps('취소'), SKILL, render), { cancelled: true });
  assert.equal(sends.length, 0);
  // The modal lists every recipient, subject and body before the approval.
  assert.equal(modals[0].approve, STORE_MAIL_APPROVE);
  assert.ok(modals[0].message.includes('2명'));
  assert.ok(modals[0].detail.includes('받는 사람: minji@example.invalid') && modals[0].detail.includes('제목: 준님'));
  // Approved but the activity changed: nothing is sent. Over the activity's cap: nothing is rendered or sent.
  await assert.rejects(runStoreMail(deps(STORE_MAIL_APPROVE, false), SKILL, render), /활동이 변경/);
  await assert.rejects(runStoreMail(deps(STORE_MAIL_APPROVE, true, 1), SKILL, render), /1명까지/);
  assert.equal(sends.length, 0);
  assert.deepEqual(await runStoreMail(deps(STORE_MAIL_APPROVE), SKILL, render), { sent: 2, failed: 0 });
  assert.equal(sends.length, 1);
  // Structural: the shipped host wiring passes the activity's own cap and re-authorization, and the store panel
  // routes a mail skill's 실행 to this run before any chat run (these files cannot run without vscode).
  const host = readFileSync(new URL('../src/automationHost.ts', import.meta.url), 'utf8');
  const wiring = host.slice(host.indexOf('return runStoreMail(storeMailHostDeps({'), host.indexOf('}), skill, render);'));
  assert.ok(wiring.includes('maxRecipients: pinned.maxRecipients') && wiring.includes('reauthorize: async () => { await authorize(); return binding === pinned && allowed(); }') && wiring.includes('showModal: (message, detail, approve) => vscode.window.showWarningMessage(message, { modal: true, detail }, approve)'));
  const panel = readFileSync(new URL('../src/skillStorePanel.ts', import.meta.url), 'utf8');
  const runCase = panel.slice(panel.indexOf('case "storeRun":'), panel.indexOf('case "storeOverlayOpen":'));
  assert.ok(runCase.indexOf('includes("mail_draft")') > 0 && runCase.indexOf('deps.runMailSkill(') < runCase.indexOf('deps.runSkill({'));
  assert.ok(readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8').includes('runMailSkill: (skill, render) => automationHost.runStoreMail(skill, render)'));
});

test('D10: the store mail run has no path into the Apps Script generator or the shared runner', () => {
  // The run is storeMail.ts plus the host's wiring. Neither names Apps Script, the shared-runner deployment or the
  // local recipe, so no store template can reach either runner.
  const mod = readFileSync(new URL('../src/storeMail.ts', import.meta.url), 'utf8');
  const src = readFileSync(new URL('../src/automationHost.ts', import.meta.url), 'utf8');
  const start = src.indexOf('async runStoreMail(');
  const wiring = src.slice(start, src.indexOf('\n    },\n', start));
  assert.ok(start > 0 && wiring.includes('runStoreMail(storeMailHostDeps({') && wiring.includes('runtime: active'));
  for (const body of [mod, wiring]) for (const forbidden of ['appsRuntime', 'appsTools', 'sharedDeployment', 'generateAppsScriptEmailProject', 'previewLatestSheet', 'savedDraft']) assert.ok(!body.includes(forbidden), forbidden);
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
