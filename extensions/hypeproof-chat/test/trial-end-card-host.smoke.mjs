// TUX-COND-07 / REQ-L12 ① — the host side of the inline end-of-trial card
// (ChatPanelProvider.handleSendError → src/trialEndCard.ts). A local synthetic Service
// serves the public catalogue; no model, payment, production Service or VS Code window.
//
// Run: node --experimental-strip-types test/trial-end-card-host.smoke.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const commandCalls = [];
const vscode = {
  commands: { executeCommand: async (...args) => { commandCalls.push(args); } },
  workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
  window: {},
  Uri: { file: (p) => ({ fsPath: p }) },
};

let ChatPanelProvider;
let FunnelReporter;
test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: [
        "export {ChatPanelProvider} from './src/chatPanelProvider';",
        "export {FunnelReporter} from './src/funnelEvents';",
      ].join(''),
      resolveDir: new URL('..', import.meta.url).pathname,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode', '@anthropic-ai/claude-agent-sdk', 'zod'],
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'unrelated-host-dependency-stubs',
      setup(b) {
        b.onResolve({ filter: /^@hypeproof\/measurement\/adapters$/ }, () => ({ path: 'measurement-adapters', namespace: 'stub' }));
        b.onResolve({ filter: /^qrcode-generator$/ }, () => ({ path: 'qrcode-generator', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents: args.path === 'qrcode-generator'
            ? 'export default function(){throw new Error("QR path is outside this test")}'
            : [
                'export class FileRecordStorage {}',
                'export const LOCAL_RECORD_DIR = "unused";',
                'export const recentLocalSessions = () => [];',
                'export const parseLocalTranscriptFile = () => null;',
                'export const parseLocalTranscript = () => null;',
                'export const manualInterpretation = () => null;',
              ].join(''),
          loader: 'js',
        }));
      },
    }],
  });
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (id) => id === 'vscode' ? vscode : require(id),
    process,
    console,
    URL,
    Buffer,
    fetch,
    crypto: globalThis.crypto,
    AbortController,
    AbortSignal,
    DOMException,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
  });
  ({ ChatPanelProvider, FunnelReporter } = module.exports);
});

const token = 'trial-test-code';
const catalogue = { products: [
  { id: 'pass-lite', label: '라이트', amount: 30000, currency: 'KRW', duration_hours: 720, request_limit: 200, recommended: true },
  { id: 'pass-basic', label: '기본', amount: 55000, currency: 'KRW', duration_hours: 720, request_limit: 350 },
] };
const openTrial = { activity_kind: 'trial', profile_id: 'studio-open-trial' };
const EXHAUSTED = new Error('Claude Code returned an error result: API Error: Request rejected (429) · 개인 체험의 총 요청 한도에 도달했습니다.');
const EXPIRED = new Error('Failed to authenticate. API Error: 403 개인 체험 시간이 끝났습니다. 작업 파일은 그대로 남아 있습니다.');
const MID_WORK = new Error('연결이 끊겼습니다. 다시 보내 주세요.');

async function present(error, profile, { products = 200 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null });
    const ok = req.url === '/v1/purchase/products' && products === 200;
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? catalogue : { error: 'not_found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const posts = [];
  const secrets = { deletes: 0 };
  const self = {
    context: { secrets: { get: async () => token, delete: async () => { secrets.deletes++; } } },
    post: async (message) => { posts.push(message); },
    lastRequestId: null,
  };
  commandCalls.length = 0;
  try {
    await ChatPanelProvider.prototype.handleSendError.call(self, error, 'stream-1', { profile, proxyUrl: `http://127.0.0.1:${server.address().port}/v1`, token });
    return { posts, requests, secrets, commands: structuredClone(commandCalls) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('an open-trial seat that ran out ends in one card built from the Service catalogue', async () => {
  for (const [err, title] of [[EXHAUSTED, '무료 사용량을 모두 썼습니다'], [EXPIRED, '무료 사용 시간이 끝났습니다']]) {
    const r = await present(err, openTrial);
    assert.equal(r.posts.length, 1);
    const [post] = r.posts;
    assert.equal(post.type, 'streamError');
    assert.equal(post.trialEndCard.title, title);
    assert.equal(post.trialEndCard.productId, 'pass-lite');
    assert.match(post.trialEndCard.facts[1], /라이트 이용권은 30일 동안 AI 요청 200번이고 30,000원입니다/);
    assert.doesNotMatch(post.error, /API Error|Claude Code|429|403/, 'no raw SDK text reaches the person');
    // Only the public catalogue is read: no credential is sent, no order is created.
    assert.deepEqual(r.requests, [{ method: 'GET', url: '/v1/purchase/products', authorization: null }]);
    // Nothing opens by itself and the saved code stays.
    assert.deepEqual(r.commands, []);
    assert.equal(r.secrets.deletes, 0);
  }
});

// The card path reads nothing on these seats. The only read allowed is REQ-L12 ⑬'s trial-end notice (merged
// alongside this card), which checks once, without a credential, whether passes are sold before it names
// '이용권으로 시작하기'; it fires on the Service's trial sentence whatever the seat.
function onlyNoticeCatalogueRead(requests) {
  assert.ok(requests.length <= 1, JSON.stringify(requests));
  for (const q of requests) assert.deepEqual(q, { method: 'GET', url: '/v1/purchase/products', authorization: null });
}

test('negative controls: no card mid-work, on a code-issued trial, on a pass, or without a catalogue', async () => {
  // Baseline: what the host posts today for each error (a code-issued trial seat). The errors come from
  // another realm than the bundled host, so the baseline is measured, not assumed.
  const baseline = async (err) => (await present(err, { activity_kind: 'trial', profile_id: 'studio-native-trial' })).posts;
  // Mid-work failure on an open-trial seat: identical to today, and not even a catalogue read.
  let r = await present(MID_WORK, openTrial);
  assert.deepEqual(r.posts, await baseline(MID_WORK));
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.requests, []);
  // Flag off (HPS_OPEN_TRIAL off: only code-issued trial seats exist): the turn ends exactly as before, without a catalogue read.
  r = await present(EXHAUSTED, { activity_kind: 'trial', profile_id: 'studio-native-trial' });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.posts, await baseline(EXHAUSTED));
  onlyNoticeCatalogueRead(r.requests);
  // A bought pass is never offered the trial card.
  r = await present(EXHAUSTED, { ...openTrial, pass: { request_limit: 200, requests_used: 200 } });
  assert.equal(r.posts[0].trialEndCard, undefined);
  onlyNoticeCatalogueRead(r.requests);
  // No catalogue: no facts to show, so no card and no made-up price; the turn ends as today.
  r = await present(EXHAUSTED, openTrial, { products: 404 });
  // Baseline under the same catalogue outage: REQ-L12 ⑬'s notice drops its pass pointer when nothing is sold.
  // Free start (SPEC iteration 4 §2.4): the open-trial seat is the free allowance, so its notice says 무료,
  // while the code-issued trial keeps its 체험 sentence byte for byte (negative control).
  const nativePosts = (await present(EXHAUSTED, { activity_kind: 'trial', profile_id: 'studio-native-trial' }, { products: 404 })).posts;
  assert.equal(nativePosts[0].error, '체험에서 쓸 수 있는 AI 요청을 모두 썼어요. 만든 파일과 대화는 그대로 있어요.');
  assert.equal(JSON.stringify(r.posts), JSON.stringify(nativePosts.map(p => ({ ...p, error: '무료로 쓸 수 있는 AI 요청을 모두 썼어요. 만든 파일과 대화는 그대로 있어요.' }))));
  assert.ok(!r.posts[0].error.includes('체험'));
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.commands, []);
});

// CONV-FUNNEL-R-002 / REQ-STUDIO-NATIVE-FUNNEL-EVENTS — the end card is counted as
// `offer_viewed {surface: end_card}` on the Service's grant-scoped route, after the real
// probe (refreshFunnelTarget) turned the funnel on. The synthetic Service records every
// POST body, so the test sees exactly what would reach the Service.
const grantToken = `${Buffer.from(JSON.stringify({ native_trial: true })).toString('base64url')}.sig`;
const FUNNEL_PROBE_ON = { schema: 'hps-trial-funnel/1', events: ['trial_entry', 'trial_tool_result', 'offer_viewed', 'offer_clicked', 'offer_dismissed'] };

async function presentWithFunnel(error, profile, { products = 200, probe = 'on', shows = 1 } = {}) {
  const funnelPosts = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.url === '/v1/purchase/products') return products === 200 ? json(200, catalogue) : json(404, { error: 'not_found' });
      if (req.url === '/v1/trial/events' && req.method === 'GET') return probe === 'on' ? json(200, FUNNEL_PROBE_ON) : json(404, { error: { message: 'not found', type: 'not_found' } });
      if (req.url === '/v1/trial/events' && req.method === 'POST') {
        funnelPosts.push({ authorization: req.headers.authorization ?? null, body: JSON.parse(raw) });
        return json(202, { ok: true });
      }
      json(404, { error: 'not_found' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxyUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const posts = [];
  const self = {
    context: { secrets: { get: async () => grantToken, delete: async () => {} }, extension: { packageJSON: { version: '2026.1020.0' } } },
    post: async (message) => { posts.push(message); },
    lastRequestId: null,
    funnelProbedToken: null,
    funnelStartupToken: grantToken,
    funnelClaimHint: null,
    stopLiveness() {},
    // The provider's own sender shape: one JSON POST with the grant's bearer token.
    funnel: new FunnelReporter({
      send: async (url, tok, body) => (await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status,
    }),
  };
  try {
    await ChatPanelProvider.prototype.refreshFunnelTarget.call(self, profile, grantToken, proxyUrl);
    for (let i = 0; i < shows; i++) await ChatPanelProvider.prototype.handleSendError.call(self, error, `stream-${i}`, { profile, proxyUrl, token: grantToken });
    // Fire-and-forget delivery: wait until the POST count stops moving.
    let seen = -1;
    for (let i = 0; i < 40 && seen !== funnelPosts.length; i++) { seen = funnelPosts.length; await new Promise((r) => setTimeout(r, 25)); }
    return { posts, funnelPosts, offerViewed: funnelPosts.filter((p) => p.body.type === 'offer_viewed') };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('CONV-FUNNEL-R-002: a shown end card sends exactly one offer_viewed {surface: end_card}', async () => {
  for (const err of [EXHAUSTED, EXPIRED]) {
    const r = await presentWithFunnel(err, openTrial);
    assert.equal(r.posts.length, 1);
    assert.ok(r.posts[0].trialEndCard, 'the card is drawn');
    // The funnel was really on: the probe's own trial_entry went out first.
    assert.ok(r.funnelPosts.some((p) => p.body.type === 'trial_entry'), JSON.stringify(r.funnelPosts));
    assert.equal(r.offerViewed.length, 1, JSON.stringify(r.funnelPosts));
    // Exactly the Service body: no id, path, text or count rides along.
    assert.deepEqual(r.offerViewed[0], { authorization: `Bearer ${grantToken}`, body: { type: 'offer_viewed', fields: { surface: 'end_card' } } });
    // A free seat still shows no remaining count on the card.
    assert.doesNotMatch(r.posts[0].trialEndCard.title, /\d/);
    assert.doesNotMatch(r.posts[0].trialEndCard.text, /남은|남았/);
  }
  // The card drawn again on the same grant (another refused send) stays one view: first view once per grant.
  const again = await presentWithFunnel(EXHAUSTED, openTrial, { shows: 2 });
  assert.equal(again.posts.filter((p) => p.trialEndCard).length, 2);
  assert.equal(again.offerViewed.length, 1);
});

test('CONV-FUNNEL-R-002 negative controls: no end_card view without a card or with the funnel off', async () => {
  // Probe off (Service flag HPS_OPEN_TRIAL off → 404): the card still shows, nothing is sent at all.
  let r = await presentWithFunnel(EXHAUSTED, openTrial, { probe: 'off' });
  assert.ok(r.posts[0].trialEndCard);
  assert.deepEqual(r.funnelPosts, []);
  // Catalogue unreadable: the turn falls back to the banner and no offer was viewed.
  r = await presentWithFunnel(EXHAUSTED, openTrial, { products: 404 });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.offerViewed, []);
  // Code-issued trial and bought pass: no card, no offer view (funnel on in both).
  r = await presentWithFunnel(EXHAUSTED, { activity_kind: 'trial', profile_id: 'studio-native-trial' });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.ok(r.funnelPosts.some((p) => p.body.type === 'trial_entry'), 'funnel was on');
  assert.deepEqual(r.offerViewed, []);
  r = await presentWithFunnel(EXHAUSTED, { ...openTrial, pass: { request_limit: 200, requests_used: 200 } });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.offerViewed, []);
  // Mid-work failure on an open-trial seat: no card, no offer view.
  r = await presentWithFunnel(MID_WORK, openTrial);
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.offerViewed, []);
});
