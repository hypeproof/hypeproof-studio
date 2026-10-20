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
let StartPage;
test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: [
        "export {ChatPanelProvider} from './src/chatPanelProvider';",
        "export {FunnelReporter} from './src/funnelEvents';",
        "export {StartPage} from './src/startPage';",
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
  ({ ChatPanelProvider, FunnelReporter, StartPage } = module.exports);
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

// CONV-ENDCARD-R-005 — `products` is the catalogue's answer to every read, or a list of answers, one
// per read in order (the last one repeats): 200, 404 (purchase not configured), 503, 'hang' (never answers)
// or 'bad' (200 with a body that is not a catalogue).
function catalogueAnswer(products) {
  const queue = Array.isArray(products) ? [...products] : null;
  return () => (queue ? (queue.length > 1 ? queue.shift() : queue[0]) : products);
}
function answerCatalogue(res, mode) {
  if (mode === 'hang') return;
  const status = mode === 'bad' ? 200 : mode;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(mode === 200 ? catalogue : mode === 'bad' ? { products: 'soon' } : { error: status === 404 ? 'not_found' : 'unavailable' }));
}
function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}

async function present(error, profile, { products = 200 } = {}) {
  const requests = [];
  const next = catalogueAnswer(products);
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null });
    if (req.url === '/v1/purchase/products') return answerCatalogue(res, next());
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
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
    await closeServer(server);
  }
}

test('an open-trial seat that ran out ends in one card built from the Service catalogue', async () => {
  for (const [err, ended] of [[EXHAUSTED, '무료로 쓸 수 있는 AI 요청은 모두 썼어요.'], [EXPIRED, '무료 사용 시간은 끝났어요.']]) {
    const r = await present(err, openTrial);
    assert.equal(r.posts.length, 1);
    const [post] = r.posts;
    assert.equal(post.type, 'streamError');
    // CONV-ENDCARD-R-002: continuity first, then the recommended pass, the ending last.
    assert.equal(post.trialEndCard.title, '만든 작업을 그대로 이어서 할 수 있어요');
    assert.equal(post.trialEndCard.facts.at(-1), ended);
    assert.equal(post.trialEndCard.productId, 'pass-lite');
    assert.equal(post.trialEndCard.facts[1], '라이트 이용권은 30일 동안 쓸 수 있고 30,000원이에요. AI 요청 200번이 들어 있어요.');
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
  // No catalogue because the Service sells no passes (404: purchase not configured): no facts to show, so no
  // card and no made-up price; the turn ends as today. CONV-ENDCARD-R-005: this is the only banner fallback.
  r = await present(EXHAUSTED, openTrial, { products: 404 });
  assert.equal(r.requests.filter((q) => q.url === '/v1/purchase/products').length, 2, 'one card read (not retried) and one notice read');
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

async function presentWithFunnel(error, profile, { products = 200, probe = 'on', shows = 1, presses = [], beforePress } = {}) {
  const funnelPosts = [];
  const nextCatalogue = catalogueAnswer(products);
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/purchase/products') return answerCatalogue(res, nextCatalogue());
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
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
    emitEndCardOffer: ChatPanelProvider.prototype.emitEndCardOffer,
    // The provider's own sender shape: one JSON POST with the grant's bearer token.
    funnel: new FunnelReporter({
      send: async (url, tok, body) => (await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status,
    }),
  };
  try {
    await ChatPanelProvider.prototype.refreshFunnelTarget.call(self, profile, grantToken, proxyUrl);
    for (let i = 0; i < shows; i++) await ChatPanelProvider.prototype.handleSendError.call(self, error, `stream-${i}`, { profile, proxyUrl, token: grantToken });
    // CONV-FUNNEL-R-003 — the card's buttons arrive as webview messages through the real handler.
    beforePress?.(self);
    commandCalls.length = 0;
    for (const press of presses) await ChatPanelProvider.prototype.handleMessage.call(self, typeof press === 'string' ? { type: press } : press);
    // Fire-and-forget delivery: wait until the POST count stops moving.
    let seen = -1;
    for (let i = 0; i < 40 && seen !== funnelPosts.length; i++) { seen = funnelPosts.length; await new Promise((r) => setTimeout(r, 25)); }
    const offers = (type) => funnelPosts.filter((p) => p.body.type === type);
    return { posts, funnelPosts, offerViewed: offers('offer_viewed'), offerClicked: offers('offer_clicked'), offerDismissed: offers('offer_dismissed'), commands: structuredClone(commandCalls) };
  } finally {
    await closeServer(server);
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
  // No passes sold (404): the turn falls back to the banner and no offer was viewed.
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

// CONV-FUNNEL-R-003 / REQ-STUDIO-NATIVE-FUNNEL-EVENTS — the card's two buttons. `이용권 살펴보기`
// arrives as `trialEndCardPasses` and `오늘은 여기까지` as `trialEndCardDismiss`; each press sends
// one event with surface end_card on the grant-scoped route. On base the Primary only ran the
// showPasses command (StartPage.showPurchase → handlePurchase), which never emits, and the escape
// never reached the host.
test('CONV-FUNNEL-R-003: each press on the end card sends one event with surface end_card', async () => {
  const body = (type) => ({ authorization: `Bearer ${grantToken}`, body: { type, fields: { surface: 'end_card' } } });
  let r = await presentWithFunnel(EXHAUSTED, openTrial, { presses: ['trialEndCardPasses'] });
  assert.ok(r.posts[0].trialEndCard, 'the card is drawn');
  assert.deepEqual(r.offerClicked, [body('offer_clicked')], JSON.stringify(r.funnelPosts));
  assert.deepEqual(r.offerDismissed, []);
  // The Primary still opens the pass list exactly as before.
  assert.deepEqual(r.commands, [['hypeproof-chat.showPasses', 'end_card']]);
  // No press is ever counted as the start page's offer.
  assert.ok(r.funnelPosts.every((p) => p.body.fields?.surface !== 'start_page'), JSON.stringify(r.funnelPosts));

  r = await presentWithFunnel(EXPIRED, openTrial, { presses: ['trialEndCardDismiss'] });
  assert.ok(r.posts[0].trialEndCard);
  assert.deepEqual(r.offerDismissed, [body('offer_dismissed')], JSON.stringify(r.funnelPosts));
  assert.deepEqual(r.offerClicked, []);
  assert.deepEqual(r.commands, [], 'the escape opens nothing');

  // One event per press: dismiss, then (later) the Primary, then the Primary again.
  r = await presentWithFunnel(EXHAUSTED, openTrial, { presses: ['trialEndCardDismiss', 'trialEndCardPasses', 'trialEndCardPasses'] });
  assert.equal(r.offerDismissed.length, 1);
  assert.equal(r.offerClicked.length, 2);
  assert.equal(r.offerViewed.length, 1, 'presses do not add views');
});

// CONV-FUNNEL-R-006 — the pass list the Primary opens is counted on the StartPage as pass_list_viewed;
// the chat names the surface in the showPasses argument. The header link (CONV-ENDCARD-R-003) posts the
// same message with `surface: "header_menu"`; any other value is the end card's.
test('CONV-FUNNEL-R-006: the chat names the pass-list surface for showPasses', async () => {
  let r = await presentWithFunnel(EXHAUSTED, openTrial, { presses: [{ type: 'trialEndCardPasses', surface: 'header_menu' }] });
  assert.deepEqual(r.commands, [['hypeproof-chat.showPasses', 'header_menu']]);
  r = await presentWithFunnel(EXHAUSTED, openTrial, { presses: [{ type: 'trialEndCardPasses', surface: 'start_page' }, { type: 'trialEndCardPasses', surface: { x: 1 } }] });
  assert.deepEqual(r.commands, [['hypeproof-chat.showPasses', 'end_card'], ['hypeproof-chat.showPasses', 'end_card']], 'only header_menu is taken from the message');
  // The chat itself sends no purchase-path event: the start page owns them.
  assert.ok(r.funnelPosts.every((p) => !['pass_list_viewed', 'checkout_opened', 'sign_in_started', 'sign_in_completed'].includes(p.body.type)), JSON.stringify(r.funnelPosts));
});

test('CONV-FUNNEL-R-003 negative controls: no card, another seat, or the funnel off sends nothing', async () => {
  const presses = ['trialEndCardPasses', 'trialEndCardDismiss'];
  // Probe off (Service flag off): the card shows and both buttons work, nothing at all is sent.
  let r = await presentWithFunnel(EXHAUSTED, openTrial, { probe: 'off', presses });
  assert.ok(r.posts[0].trialEndCard);
  assert.deepEqual(r.funnelPosts, []);
  assert.deepEqual(r.commands, [['hypeproof-chat.showPasses', 'end_card']]);
  // Code-issued trial (funnel on): no card was drawn, so a stray press is not an end-card offer.
  r = await presentWithFunnel(EXHAUSTED, { activity_kind: 'trial', profile_id: 'studio-native-trial' }, { presses });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.ok(r.funnelPosts.some((p) => p.body.type === 'trial_entry'), 'funnel was on');
  assert.deepEqual([...r.offerClicked, ...r.offerDismissed], []);
  // Bought pass: same.
  r = await presentWithFunnel(EXHAUSTED, { ...openTrial, pass: { request_limit: 200, requests_used: 200 } }, { presses });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual([...r.offerClicked, ...r.offerDismissed], []);
  // Banner fallback (no passes sold): no card, no offer.
  r = await presentWithFunnel(EXHAUSTED, openTrial, { products: 404, presses });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual([...r.offerClicked, ...r.offerDismissed], []);
  // The card was drawn for this grant, but the seat changed since (another token probed): nothing.
  r = await presentWithFunnel(EXHAUSTED, openTrial, { presses, beforePress: (self) => { self.funnelProbedToken = 'another-seat'; } });
  assert.ok(r.posts[0].trialEndCard);
  assert.deepEqual([...r.offerClicked, ...r.offerDismissed], []);
});

// The start page keeps its own surface: its purchaseOpen/purchaseHide still count as start_page,
// while the card's route into the same pass list (showPurchase) adds no start_page click.
test('CONV-FUNNEL-R-003: the start page path keeps surface start_page; showPurchase adds none', async () => {
  const emitted = [];
  const self = {
    // The host builds these objects in the vm realm; copy them into this one to compare.
    chat: { funnelEmit: (ev) => emitted.push(structuredClone(ev)) },
    order: undefined,
    handlePurchase: async () => {},
    show: async () => {},
    refresh: async () => {},
  };
  await StartPage.prototype.handle.call(self, { type: 'purchaseOpen' });
  await StartPage.prototype.handle.call(self, { type: 'purchaseHide' });
  assert.deepEqual(emitted, [{ type: 'offer_clicked', surface: 'start_page' }, { type: 'offer_dismissed', surface: 'start_page' }]);
  emitted.length = 0;
  await StartPage.prototype.showPurchase.call(self);
  assert.deepEqual(emitted, []);
});

// CONV-ENDCARD-R-005 — the free path never dead-ends a newcomer. When the catalogue cannot be read as
// the seat ends (a timeout, a network failure, a 5xx, a malformed body), Studio reads it once more and,
// if it still cannot, draws a minimal card: the continuity title and line, the ending, the same Primary
// and escape, and no pass fact. On base the turn fell back to the error banner.
const MINIMAL_FACTS = {
  exhausted: ['만든 파일은 작업 폴더에, 대화는 이 채팅에 그대로 있어요. 이용권이 있으면 이 작업을 이어서 할 수 있어요.', '무료로 쓸 수 있는 AI 요청은 모두 썼어요.'],
  expired: ['만든 파일은 작업 폴더에, 대화는 이 채팅에 그대로 있어요. 이용권이 있으면 이 작업을 이어서 할 수 있어요.', '무료 사용 시간은 끝났어요.'],
};
const PRESSURE = /지금\s*(?:바로|만)|오늘만|까지만|마감|임박|마지막|놓치|서두르|서둘러|한정|할인|특가|남았|남은/;
const catalogueReads = (requests) => requests.filter((q) => q.url === '/v1/purchase/products');

function assertMinimal(card, ending) {
  assert.ok(card, 'a card is drawn, not the banner');
  assert.equal(card.ending, ending);
  assert.equal(card.title, '만든 작업을 그대로 이어서 할 수 있어요');
  assert.deepEqual([...card.facts], MINIMAL_FACTS[ending]);
  assert.equal(card.primary, '이용권 살펴보기');
  assert.equal(card.escape, '오늘은 여기까지');
  assert.equal(card.productId, undefined, 'no pass was read, so none is named');
  // No numbers (no price, period, request count or remaining count) and no pressure words.
  for (const line of [card.title, ...card.facts, card.primary, card.escape, card.text]) {
    assert.doesNotMatch(line, /\d/, line);
    assert.doesNotMatch(line, PRESSURE, line);
  }
  // 해요체, like the full card after #2182.
  for (const line of card.facts) assert.match(line, /요\.$/, line);
}

test('CONV-ENDCARD-R-005: an unreadable catalogue is retried once, then the minimal card is drawn', async () => {
  for (const [err, ending] of [[EXHAUSTED, 'exhausted'], [EXPIRED, 'expired']]) {
    for (const failure of [503, 'bad']) {
      const r = await present(err, openTrial, { products: [failure, failure] });
      assert.equal(r.posts.length, 1);
      assert.equal(r.posts[0].type, 'streamError');
      assertMinimal(r.posts[0].trialEndCard, ending);
      assert.equal(r.posts[0].error, r.posts[0].trialEndCard.text);
      // Exactly one retry, both without a credential; nothing opens and the saved code stays.
      assert.deepEqual(catalogueReads(r.requests), [
        { method: 'GET', url: '/v1/purchase/products', authorization: null },
        { method: 'GET', url: '/v1/purchase/products', authorization: null },
      ]);
      assert.deepEqual(r.commands, []);
      assert.equal(r.secrets.deletes, 0);
    }
  }
});

test('CONV-ENDCARD-R-005: a catalogue that times out twice still ends in the minimal card', async () => {
  const t0 = Date.now();
  const r = await present(EXHAUSTED, openTrial, { products: ['hang', 'hang'] });
  assertMinimal(r.posts[0].trialEndCard, 'exhausted');
  assert.equal(catalogueReads(r.requests).length, 2);
  // Two bounded reads (3 s each), never an open-ended wait.
  assert.ok(Date.now() - t0 < 9000, `took ${Date.now() - t0} ms`);
});

test('CONV-ENDCARD-R-005 controls: the retry that reads the catalogue draws the full card', async () => {
  // A first read that fails or times out, then a good one: the full card, exactly as when the first read works.
  const full = (await present(EXHAUSTED, openTrial)).posts[0].trialEndCard;
  for (const first of [503, 'hang']) {
    const r = await present(EXHAUSTED, openTrial, { products: [first, 200] });
    assert.equal(catalogueReads(r.requests).length, 2);
    assert.equal(JSON.stringify(r.posts[0].trialEndCard), JSON.stringify(full));
    assert.equal(r.posts[0].trialEndCard.productId, 'pass-lite');
  }
  // A catalogue that works the first time is read once and is the full card (no retry).
  const once = await present(EXHAUSTED, openTrial);
  assert.equal(catalogueReads(once.requests).length, 1);
  assert.equal(once.posts[0].trialEndCard.facts.length, 4);
});

test('CONV-ENDCARD-R-005 controls: a code-issued trial, a pass and mid-work are unchanged by a failing catalogue', async () => {
  const native = { activity_kind: 'trial', profile_id: 'studio-native-trial' };
  for (const profile of [native, { ...openTrial, pass: { request_limit: 200, requests_used: 200 } }]) {
    const failing = await present(EXHAUSTED, profile, { products: [503, 503] });
    const unsold = await present(EXHAUSTED, profile, { products: 404 });
    assert.equal(failing.posts[0].trialEndCard, undefined);
    // Same banner as when nothing is sold, and only the notice's single read: no card retry on these seats.
    assert.equal(JSON.stringify(failing.posts), JSON.stringify(unsold.posts));
    assert.ok(catalogueReads(failing.requests).length <= 1, JSON.stringify(failing.requests));
  }
  const mid = await present(MID_WORK, openTrial, { products: [503, 503] });
  assert.equal(mid.posts[0].trialEndCard, undefined);
  assert.deepEqual(mid.requests, []);
});

test('CONV-ENDCARD-R-005: the minimal card still counts offer_viewed, offer_clicked and offer_dismissed', async () => {
  const body = (type) => ({ authorization: `Bearer ${grantToken}`, body: { type, fields: { surface: 'end_card' } } });
  let r = await presentWithFunnel(EXHAUSTED, openTrial, { products: [503, 503], presses: ['trialEndCardPasses'] });
  assertMinimal(r.posts[0].trialEndCard, 'exhausted');
  assert.deepEqual(r.offerViewed, [body('offer_viewed')], JSON.stringify(r.funnelPosts));
  assert.deepEqual(r.offerClicked, [body('offer_clicked')]);
  assert.deepEqual(r.offerDismissed, []);
  // The Primary opens the pass list, which reads the catalogue again there.
  assert.deepEqual(r.commands, [['hypeproof-chat.showPasses', 'end_card']]);
  r = await presentWithFunnel(EXPIRED, openTrial, { products: [503, 503], presses: ['trialEndCardDismiss'] });
  assertMinimal(r.posts[0].trialEndCard, 'expired');
  assert.deepEqual(r.offerViewed, [body('offer_viewed')]);
  assert.deepEqual(r.offerDismissed, [body('offer_dismissed')]);
  assert.deepEqual(r.offerClicked, []);
  assert.deepEqual(r.commands, []);
});
