// Epic #3418 policy v2 (#3761): the store panel host registers the seller's partner/instructor choice once,
// right before the first publication, and sends the payout account straight to the Service without keeping it.
// The real skillStorePanel.ts is bundled with a `vscode` stand-in; the Service is a fetch stub.
//
// Run: node --experimental-strip-types test/skill-store-panel.smoke.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const dir = mkdtempSync(join(tmpdir(), 'hps-store-panel-'));
const out = join(dir, 'panel.cjs');
// The stand-in lives on globalThis so the test can drive the commands and panels it records.
const commands = new Map(); const panels = [];
globalThis.__vscodeStub = {
  __commands: commands, __panels: panels,
  ViewColumn: { Active: -1 },
  Uri: { joinPath: (...p) => ({ path: p.map(String).join('/') }), parse: (s) => ({ toString: () => s }) },
  env: { machineId: 'machine-1', opened: [], async openExternal(u) { this.opened.push(String(u)); return true; } },
  workspace: { getConfiguration: () => ({ get: (_k, d) => 'https://service.test/v1' }) },
  commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: async () => {} },
  window: {
    showInformationMessage: async () => undefined, showWarningMessage: async () => undefined,
    createWebviewPanel: () => {
      const p = { posted: [], handler: null, webview: { html: '', postMessage: async (m) => { p.posted.push(JSON.parse(JSON.stringify(m))); return true; }, onDidReceiveMessage: (h) => { p.handler = h; } },
        reveal() {}, onDidChangeViewState() {}, onDidDispose(h) { p.disposeHandler = h; } };
      panels.push(p); return p;
    },
  },
};
const STUB = 'module.exports = globalThis.__vscodeStub;';
await build({
  entryPoints: [fileURLToPath(new URL('../src/skillStorePanel.ts', import.meta.url))], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'vscode-stub', setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: STUB, loader: 'js' })); } }],
});
const mod = createRequire(import.meta.url)(out);
const stubModule = globalThis.__vscodeStub;

let undecided = true;
let failPublish = 1;
let identityPolls = 0;
let sellerUnverified = false;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname.replace('/v1/store', '');
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method: init.method ?? 'GET', path, body });
  const reply = (status, json) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  if (path === '/items' && (init.method ?? 'GET') === 'GET') return reply(200, { items: [] });
  if (path === '/me') return reply(200, { age_group: 'adult', installs: [], can_buy_paid: true });
  if (path === '/seller') return reply(200, { tier: sellerUnverified ? 'none' : 'new', cap_krw: sellerUnverified ? 0 : 100000, identity_verified: true, attribution: { decided: !undecided, partner: null, instructor: null, source: undecided ? null : 'seller', seller_editable: false, consent_version: 'store-referral-2026-11-12', consent_given: null }, items: [], sales: [], totals: { refund_window: 0, payout_hold: 0, payable: 15456, refunded: 0, pending: 0, rolls_over: false, payout_min_krw: 10000 }, payout_account: { state: 'due', prompt_at_krw: 10000, holder: 'self', linked_adult_required: false }, payout: 'not_started', policy_version: 'v2' });
  if (path === '/attribution/resolve') return reply(200, { partner: { name: '세바시' }, instructor: { name: '김강사', partner_name: '세바시' } });
  if (path === '/attribution') { if (!undecided) return reply(409, { error: 'attribution_already_set' }); undecided = false; return reply(200, { decided: true, partner: { name: '세바시' }, instructor: { name: '김강사' }, source: 'seller', seller_editable: false }); }
  if (path === '/items' && init.method === 'POST') { if (failPublish-- > 0) return reply(503, { error: 'unavailable' }); return reply(201, { id: 'ski_' + 'a'.repeat(32), status: 'listed', tier: 'new', cap_krw: 100000 }); }
  if (path === '/identity/start') return reply(201, { session_id: 'idv_' + 'd'.repeat(32), verify_url: 'https://service.test/v1/store/identity/verify?session=idv_' + 'd'.repeat(32), sandbox: true });
  if (path.startsWith('/identity/idv_')) { identityPolls++; if (identityPolls >= 2) sellerUnverified = false; return reply(200, { state: identityPolls >= 2 ? 'verified' : 'pending' }); }
  if (path === '/seller/payout-account') return reply(200, { masked: '국민은행 ****9012', holder: 'self', holder_check: 'sandbox_matched', linked_adult_required: false, updated_at: 1 });
  return reply(404, { error: 'not_found' });
};

const context = { extensionUri: { path: '/ext' }, subscriptions: [] };
mod.registerSkillStore(context, {
  render: () => '<html></html>',
  accountToken: async () => 'acct-token',
  seat: async () => 'personal',
  questOffer: () => ({ draft: { title: '서류 제출 요청', summary: '안내 메일', steps: [] }, pkg: (meta) => ({ ...meta, tools: [], outputs: ['mail_draft'], steps: [] }) }),
});
const settle = () => new Promise((r) => setTimeout(r, 20));
await stubModule.__commands.get('hypeproof-chat.skillStore.publishQuest')();
await settle();
const panel = stubModule.__panels[0];
// The webview asks for its first state when it mounts.
await panel.handler({ type: 'storeLoad' });
await settle();
const last = () => panel.posted.filter((m) => m.type === 'storeState').at(-1).state;
assert.equal(last().seller.attribution.decided, false);

// Check the codes: names come back, nothing is registered yet.
await panel.handler({ type: 'storeResolveCodes', partnerCode: '', instructorCode: 'I-ABCDE-FGHJK' });
await settle();
assert.deepEqual(last().attributionPreview, { partnerCode: '', instructorCode: 'I-ABCDE-FGHJK', partner: { name: '세바시' }, instructor: { name: '김강사', partner_name: '세바시' } });
assert.equal(calls.some((c) => c.path === '/attribution'), false);

// Publish: the choice is registered first, then the item. The publish fails once (Service hiccup).
const ATTR = { instructor_code: 'I-ABCDE-FGHJK', consent: { version: 'store-referral-2026-11-12', granted: true } };
await panel.handler({ type: 'storePublishQuest', title: '서류 제출 요청', summary: '안내 메일', price_krw: 5000, attribution: ATTR });
await settle();
const writes = () => calls.filter((c) => c.method !== 'GET' && c.path !== '/attribution/resolve').map((c) => c.path);
assert.deepEqual(writes(), ['/attribution', '/items']);
assert.deepEqual(calls.find((c) => c.path === '/attribution').body, ATTR, 'the consent goes with the codes');
assert.ok(last().error, 'the failed publish is shown');
// The retry publishes without registering a second time.
await panel.handler({ type: 'storePublishQuest', title: '서류 제출 요청', summary: '안내 메일', price_krw: 5000, attribution: ATTR });
await settle();
assert.deepEqual(writes(), ['/attribution', '/items', '/items']);
assert.equal(last().notice, '스토어에 올렸어요.');
assert.equal(last().attributionPreview, undefined);
console.log('PASS first publication registers the choice once, then publishes');

// The payout account goes to the Service as typed and never into the panel state.
await panel.handler({ type: 'storeSavePayoutAccount', bankCode: '004', accountNumber: '123456789012', holderName: '홍길동' });
await settle();
const put = calls.find((c) => c.method === 'PUT');
assert.deepEqual([put.path, put.body], ['/seller/payout-account', { bank_code: '004', account_number: '123456789012', holder_name: '홍길동' }]);
assert.equal(last().notice, '지급 계좌를 저장했어요.');
assert.equal(/123456789012|홍길동/.test(JSON.stringify(panel.posted)), false, 'no posted state carries the account');
console.log('PASS payout account sent once, not kept in panel state');
// #3770: the verification opens the Service's page in the browser and waits for the Service's outcome.
sellerUnverified = true; // an unverified seller: tier none, cap 0
await panel.handler({ type: 'storeLoad', tab: 'sell' });
await settle();
assert.equal(last().seller.cap_krw, 0);
await panel.handler({ type: 'storeVerifyIdentity' });
await settle();
assert.equal(stubModule.env.opened.at(-1), 'https://service.test/v1/store/identity/verify?session=idv_' + 'd'.repeat(32));
assert.equal(last().identity.sessionId, 'idv_' + 'd'.repeat(32));
// The seller moves to another tab while waiting: the notice still names the new cap from a fresh seller view.
await panel.handler({ type: 'storeLoad', tab: 'browse' });
await new Promise((r) => setTimeout(r, 6600));
assert.equal(identityPolls, 2, 'polled until verified');
assert.equal(last().tab, 'browse', 'the tab the seller is on stays');
assert.equal(last().identity, undefined);
assert.match(last().notice, /^본인인증을 마쳤어요\. 이제 한 개당 최대 100,000원까지 올릴 수 있어요\.$/);
console.log('PASS identity verification opened, polled, reflected');

// hype-verify 1673a021: a double start opens the browser once; closing the panel stops waiting for good.
identityPolls = 0;
const before = stubModule.env.opened.length;
let slow = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { if (slow && String(url).includes('/identity/idv_')) await new Promise((r) => setTimeout(r, 1500)); return realFetch(url, init); };
await Promise.all([panel.handler({ type: 'storeVerifyIdentity' }), panel.handler({ type: 'storeVerifyIdentity' })]);
await settle();
assert.equal(stubModule.env.opened.length - before, 1, 'one browser tab for a double start');
slow = true;
await new Promise((r) => setTimeout(r, 3200)); // a poll is now in flight
const disposed = panel.disposeHandler;
disposed();
const pollsAtClose = identityPolls;
await new Promise((r) => setTimeout(r, 7000));
assert.ok(identityPolls <= pollsAtClose + 1, `no polling after close (${identityPolls - pollsAtClose} more)`);
globalThis.fetch = realFetch;
console.log('PASS identity: one start at a time, no polling after the panel closes');
rmSync(dir, { recursive: true, force: true });
