// CGP-SHELL-R-027 / CGP-SHELL-D-026 — "계정과 데이터 삭제 요청" in the chat settings dialog.
// Pure helpers, the Service calls with a fake fetch, the row rendered with react-dom/server + jsdom,
// and the host / dialog wiring read from source. Font-independent: words, roles and attributes only.
//
// Positive: each status draws a chip with icon + word and the request date; 보류 shows the reason
// inline; the confirm step names that local files stay and focuses nothing destructive by default.
// Negative controls: no advertisement (absent, false, malformed) → no row; a malformed Service
// view is refused; markup in a hold reason is text; an open request offers no second request.
import React from 'react';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
import { DataDeletionView, DeletionStatusRow } from '../webview-ui/src/DataDeletionRequest';
import {
  DATA_DELETION_COPY, DELETION_STATUS_LABEL, canRequestAgain, dataDeletionOffered, deletionDate,
  parseDeletionRequest, readDeletionRequest, sendDeletionRequest, type DataDeletionState,
} from '../src/dataDeletionRequest';

let fail = 0;
const queue: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => { queue.push([label, fn]); };
const ID = 'ddr_' + '0123456789abcdef'.repeat(2);
const view = (status: string, extra: Record<string, unknown> = {}) => ({
  id: ID, status, scope: 'account_and_data', created_at: '2026-11-12T15:30:00.000Z', updated_at: '2026-11-14T01:00:00.000Z', ...extra,
});
const noop = () => {};
const doc = (el: React.ReactElement) => new JSDOM(renderToStaticMarkup(el)).window.document as Document;
const row = (host: DataDeletionState, stage: 'idle' | 'confirm' | 'sending' = 'idle') =>
  doc(<DataDeletionView host={host} stage={stage} onOpen={noop} onConfirm={noop} onCancel={noop} />);

t('the row is offered only for exactly data_deletion.available === true', () => {
  assert.equal(dataDeletionOffered({ data_deletion: { available: true } }), true);
  for (const p of [null, undefined, {}, { data_deletion: null }, { data_deletion: { available: false } }, { data_deletion: { available: 'true' } }, { data_deletion: true }])
    assert.equal(dataDeletionOffered(p as never), false, JSON.stringify(p));
});

t('parse: the Service view is kept, unknown keys and malformed values are refused', () => {
  const v = parseDeletionRequest({ ...view('received'), user_id: 'synthetic-seat', cohort_id: 'synthetic-cohort' });
  assert.deepEqual(v, { id: ID, status: 'received', createdAt: '2026-11-12T15:30:00.000Z', updatedAt: '2026-11-14T01:00:00.000Z' });
  assert.equal(parseDeletionRequest(view('held', { reason: '확인 중이에요' }))?.reason, '확인 중이에요');
  assert.equal(parseDeletionRequest(view('processing', { reason: 'not shown' }))?.reason, undefined, 'a reason only while held');
  for (const bad of [null, [], view('deleted'), view('received', { id: 'x' }), view('received', { created_at: 'soon' }), view('received', { updated_at: undefined })])
    assert.equal(parseDeletionRequest(bad), null, JSON.stringify(bad));
});

t('dates are Korea calendar days', () => {
  assert.equal(deletionDate('2026-11-12T15:30:00.000Z'), '2026년 11월 13일');
  assert.equal(deletionDate('nope'), '');
});

t('each status: a chip with icon + word, never colour alone', () => {
  const expected = { received: ['접수', 'flag'], processing: ['처리 중', 'clock'], done: ['완료', 'check'], held: ['보류', 'alert'] } as const;
  for (const [status, [word, icon]] of Object.entries(expected)) {
    assert.deepEqual(DELETION_STATUS_LABEL[status as keyof typeof expected], { word, icon });
    const d = doc(<DeletionStatusRow request={parseDeletionRequest(view(status, status === 'held' ? { reason: '이유' } : {}))!} />);
    const chip = d.querySelector('.hps-deletion-chip')!;
    assert.equal(chip.textContent, word, status);
    assert.equal(chip.querySelector('svg')?.getAttribute('data-icon'), icon, status);
    assert.equal(chip.querySelector('svg')?.getAttribute('aria-hidden'), 'true', 'the word carries the meaning');
    assert.ok(d.body.textContent!.includes('요청한 날 2026년 11월 13일'), status + ': date shown');
  }
});

t('보류 shows the reason inline; markup in the reason is text', () => {
  const d = doc(<DeletionStatusRow request={parseDeletionRequest(view('held', { reason: '<img src=x onerror=alert(1)> 결제 기록은 5년 보관해요' }))!} />);
  assert.equal(d.querySelector('img'), null);
  assert.equal(d.querySelector('.hps-deletion-reason')!.textContent, '<img src=x onerror=alert(1)> 결제 기록은 5년 보관해요');
  assert.ok(d.body.textContent!.includes('바뀐 날 2026년 11월 14일'));
  const r = doc(<DeletionStatusRow request={parseDeletionRequest(view('received'))!} />);
  assert.equal(r.querySelector('.hps-deletion-reason'), null);
  assert.ok(!r.body.textContent!.includes('바뀐 날'), 'received shows the request date only');
});

t('no request yet: the explanation, the local-files promise and one button', () => {
  const d = row({ state: 'ready', request: null });
  assert.equal(d.querySelector('h3')!.textContent, '계정과 데이터 삭제 요청');
  assert.ok(d.body.textContent!.includes('이 컴퓨터의 작업 폴더와 파일은 지우지 않아요.'));
  const buttons = [...d.querySelectorAll('button')];
  assert.deepEqual(buttons.map(b => b.textContent), ['삭제 요청하기']);
  assert.equal(buttons[0].getAttribute('type'), 'button');
});

t('the confirm step: two buttons, 취소 first, the local-files promise repeated', () => {
  const d = row({ state: 'ready', request: null }, 'confirm');
  const group = d.querySelector('[role="group"]')!;
  assert.equal(d.getElementById(group.getAttribute('aria-labelledby')!)!.textContent, '정말 삭제를 요청할까요?');
  assert.deepEqual([...group.querySelectorAll('button')].map(b => b.textContent), ['취소', '요청 보내기']);
  assert.ok(group.textContent!.includes(DATA_DELETION_COPY.localFiles));
  const sending = row({ state: 'ready', request: null }, 'sending');
  assert.ok([...sending.querySelectorAll('.hps-deletion-confirm button')].every(b => (b as HTMLButtonElement).disabled), 'no second press while sending');
  assert.ok(sending.querySelector('[role="status"]')!.textContent!.includes('요청을 보내는 중이에요'));
});

t('an open request offers no second request; a done one offers 다시 요청하기', () => {
  for (const status of ['received', 'processing', 'held']) {
    const d = row({ state: 'ready', request: parseDeletionRequest(view(status, status === 'held' ? { reason: '이유' } : {})) });
    assert.equal(d.querySelectorAll('button').length, 0, status);
    assert.equal(canRequestAgain(parseDeletionRequest(view(status))), false, status);
  }
  const done = row({ state: 'ready', request: parseDeletionRequest(view('done')) });
  assert.deepEqual([...done.querySelectorAll('button')].map(b => b.textContent), ['다시 요청하기']);
});

t('loading and error states', () => {
  const l = row({ state: 'loading' });
  assert.ok(l.querySelector('[role="status"]')!.textContent!.includes('요청 상태를 확인하는 중이에요'));
  assert.equal(l.querySelectorAll('button').length, 0, 'nothing to press before the status is known');
  const e = row({ state: 'error', message: '잠시 뒤 다시 시도해 주세요.', request: parseDeletionRequest(view('processing')) });
  assert.equal(e.querySelector('[role="alert"]')!.textContent, '잠시 뒤 다시 시도해 주세요.');
  assert.equal(e.querySelector('.hps-deletion-chip')!.textContent, '처리 중', 'a failed refresh keeps the known status');
});

t('Service calls: the seat credential, the exact body, no redirect, the Service sentence on refusal', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (status: number, body: unknown) => (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const sent = await sendDeletionRequest('https://service.test/v1/', 'synthetic-token', fake(201, { request: view('received'), created: true }));
  assert.deepEqual(sent, { ok: true, request: parseDeletionRequest(view('received')) });
  assert.equal(calls[0].url, 'https://service.test/v1/data-deletion/requests');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"scope":"account_and_data"}');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer synthetic-token');
  assert.deepEqual(await readDeletionRequest('https://service.test/v1', 't', fake(200, { request: null })), { ok: true, request: null });
  assert.equal(calls[1].init.method, 'GET');
  assert.deepEqual(await readDeletionRequest('https://service.test/v1', 't', fake(429, { error: { message: '잠시 뒤 다시 시도해 주세요.' } })), { ok: false, message: '잠시 뒤 다시 시도해 주세요.' });
  assert.deepEqual(await readDeletionRequest('https://service.test/v1', 't', fake(404, { error: { message: 'not found' } })), { ok: false, message: DATA_DELETION_COPY.failed }, 'English is never shown');
  assert.deepEqual(await readDeletionRequest('https://service.test/v1', 't', fake(200, { request: view('gone') })), { ok: false, message: DATA_DELETION_COPY.failed });
  const thrown = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.deepEqual(await sendDeletionRequest('https://service.test/v1', 't', thrown), { ok: false, message: DATA_DELETION_COPY.failed });
});

// ── Wiring (src): the gates sit on the real paths ──────────────────────────────────────────────
const provider = readFileSync('src/chatPanelProvider.ts', 'utf8');
const panel = readFileSync('webview-ui/src/ChatPanel.tsx', 'utf8');
const css = readFileSync('webview-ui/src/chatDetails.css', 'utf8');
t('host: the row flag follows the profile; the handler re-checks it and never deletes anything', () => {
  assert.ok(provider.includes('...(!local && !isInstructor && dataDeletionOffered(profile) ? { dataDeletion: true as const } : {}),'), 'config gate');
  const handler = provider.slice(provider.indexOf('private async handleDataDeletion'), provider.indexOf('TUX-COND-08 — submit'));
  assert.ok(handler.includes('dataDeletionOffered(this.cachedProfile)'), 'handler re-checks the advertisement');
  assert.ok(!/\b(rm|unlink|rmdir|delete\(|fs\.|workspace\.fs)/.test(handler), 'the handler touches no file');
  assert.ok(!/console\.|log\(/.test(handler), 'nothing logged');
});
t('dialog: mounted in both settings dialogs, only when advertised and while open', () => {
  assert.equal(panel.split('{config.dataDeletion && preferencesOpen && <DataDeletionRequest />}').length - 1, 2);
});
t('style floors: 44px controls, the caption step (>=14px), logical properties, forced colours', () => {
  const rule = (sel: string) => css.slice(css.indexOf(sel)).split('}')[0];
  assert.ok(rule('.hps-deletion-actions button {').includes('min-block-size: var(--ds-c-studio-chatdetails-size-8)'), '44px');
  for (const sel of ['.hps-data-deletion {', '.hps-deletion-actions button {', '.hps-preferences .hps-deletion-open {'])
    assert.ok(rule(sel).includes('font-size: var(--hp-font-caption)'), sel);
  assert.ok(/forced-colors: active\) \{\n  \.hps-deletion-chip/.test(css), 'forced colours');
});

void (async () => {
  for (const [label, fn] of queue) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  if (fail) { console.error(`data deletion request: ${fail} failed`); process.exit(1); }
  console.log('data deletion request OK');
})();
