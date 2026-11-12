// TUX-COND-07 / REQ-L12 ① — the host side of the end of a free trial (ChatPanelProvider.handleSendError).
// The end-of-trial card was a pass offer. No pass is sold and the app has no purchase view since
// 2026-11-13 (REQ-L12 ①–④ removed), so the host no longer reads the catalogue or draws the card: the turn
// ends in the calm notice. A local synthetic Service still serves a catalogue, to prove it is never read.
// No model, payment, production Service or VS Code window.
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
  env: { appName: 'HypeProof Studio', clipboard: { writeText: async () => {} } },
  ViewColumn: { Beside: 2 },
  commands: { executeCommand: async (...args) => { commandCalls.push(args); } },
  workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
  window: {},
  Uri: { file: (p) => ({ fsPath: p }) },
};

test('personal continuation entry rechecks the actual host seat, active task and offer credential', async () => {
  let panels = 0;
  vscode.window.createWebviewPanel = () => {
    panels++;
    let close;
    return { webview: { html: '', postMessage: async () => true, onDidReceiveMessage: () => ({ dispose() {} }) }, onDidDispose: fn => { close = fn; return { dispose() {} }; }, dispose() { close?.(); close = undefined; } };
  };
  const make = (overrides = {}) => ({
    context: { subscriptions: [], secrets: { get: async () => 'current-offer' } },
    cachedProfile: { activity_kind: 'trial', profile_id: 'studio-open-trial' },
    _instructorMode: { isInstructor: false }, activeStreams: new Map(), profileGeneration: 1,
    endCardOfferToken: 'current-offer', resolveCoachCwd: () => '/synthetic/project',
    currentTaskStore: () => ({ getView: () => ({ activeTaskId: 'current-task' }) }),
    getHistory: () => [], retryMessages: () => [], ...overrides,
  });
  const eligible = make();
  await ChatPanelProvider.prototype.openPersonalClaude.call(eligible, 'Unsent draft');
  assert.equal(panels, 1, 'positive control opens the real handoff panel');
  eligible.personalContinuationPane.dispose();
  for (const overrides of [
    { cachedProfile: { activity_kind: 'trial', profile_id: 'studio-native-trial' } },
    { cachedProfile: { activity_kind: 'trial', profile_id: 'studio-open-trial', minor_cohort: true } },
    { cachedProfile: { activity_kind: 'trial', profile_id: 'studio-open-trial', pass: { request_limit: 1 } } },
    { cachedProfile: { activity_kind: 'trial', profile_id: 'studio-open-trial', lesson: {} } },
    { _instructorMode: { isInstructor: true } }, { taskChanging: true }, { connectionChanging: true },
    { activeStreams: new Map([['active', {}]]) }, { endCardOfferToken: null },
    { currentTaskStore: () => ({ getView: () => ({ activeTaskId: null }) }) },
    { context: { subscriptions: [], secrets: { get: async () => 'another-seat-token' } } },
  ]) await ChatPanelProvider.prototype.openPersonalClaude.call(make(overrides), 'Unsent draft');
  assert.equal(panels, 1, 'no ineligible or stale entry opens a panel');
  const changed = make();
  changed.context.secrets.get = async () => { changed.profileGeneration++; return 'current-offer'; };
  await ChatPanelProvider.prototype.openPersonalClaude.call(changed, 'Unsent draft');
  assert.equal(panels, 1, 'seat change while checking credential invalidates entry');
  for (const mutate of [self => { self.cachedProfile = { ...self.cachedProfile, lesson: {} }; }, self => { self.activeStreams.set('new-turn', {}); }]) {
    const racing = make();
    racing.context.secrets.get = async () => { mutate(racing); return 'current-offer'; };
    await ChatPanelProvider.prototype.openPersonalClaude.call(racing, 'Unsent draft');
    assert.equal(panels, 1, 'lesson or active turn arriving during credential lookup prevents entry');
  }
});

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

const FREE_EXHAUSTED = '무료로 쓸 수 있는 AI 요청을 모두 썼어요. 만든 파일과 대화는 그대로 있어요.';
const FREE_EXPIRED = '무료 사용 시간이 끝났어요. 만든 파일과 대화는 그대로 있어요.';

test('an open-trial seat that ran out ends in the calm notice: no pass card, no catalogue read', async () => {
  for (const [err, said] of [[EXHAUSTED, FREE_EXHAUSTED], [EXPIRED, FREE_EXPIRED]]) {
    // Whatever the catalogue would answer (sold, unconfigured, failing, hanging), it is never asked.
    for (const products of [200, 404, 503, 'hang']) {
      const r = await present(err, openTrial, { products });
      assert.equal(r.posts.length, 1);
      const [post] = r.posts;
      assert.equal(post.type, 'streamError');
      assert.equal(post.trialEndCard, undefined, 'no end-of-trial pass card');
      assert.equal(post.error, said);
      assert.doesNotMatch(post.error, /이용권|API Error|Claude Code|429|403/);
      assert.deepEqual(r.requests, [], 'the catalogue is never read');
      assert.deepEqual(r.commands, [], 'nothing opens by itself');
      assert.equal(r.secrets.deletes, 0, 'the saved code stays');
    }
  }
});

test('negative controls: mid-work, a code-issued trial and a pass end exactly as before', async () => {
  let r = await present(MID_WORK, openTrial);
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.requests, []);
  r = await present(EXHAUSTED, { activity_kind: 'trial', profile_id: 'studio-native-trial' });
  assert.equal(r.posts[0].error, '체험에서 쓸 수 있는 AI 요청을 모두 썼어요. 만든 파일과 대화는 그대로 있어요.');
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.requests, []);
  r = await present(EXHAUSTED, { ...openTrial, pass: { request_limit: 200, requests_used: 200 } });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.requests, []);
});

test('no pass offer is counted, and the old "이용권 살펴보기" message opens nothing', async () => {
  const r = await presentWithFunnel(EXHAUSTED, openTrial, { presses: ['trialEndCardPasses', { type: 'trialEndCardPasses', surface: 'header_menu' }] });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.equal(r.offerViewed.length, 0, 'no offer_viewed end_card');
  assert.equal(r.offerClicked.length, 0, 'no offer_clicked end_card');
  assert.deepEqual(r.commands, [], 'no hypeproof-chat.showPasses (the command is gone)');
  assert.equal(typeof StartPage.prototype.showPurchase, 'undefined');
});
