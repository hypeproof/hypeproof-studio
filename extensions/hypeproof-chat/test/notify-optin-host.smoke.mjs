// TUX-COND-08 — the optional "이메일로 소식 받기" on a free seat's end card (Jay 2026-10-19).
// Host side: the card's notify section (ChatPanelProvider.handleSendError → trialEndCard.ts) and the
// submit / withdraw handler (handleNotifyOptin → notifyOptin.ts) against a local synthetic Service.
// No model, payment, production Service or VS Code window. example.com addresses only.
//
// Positive: the section is on a free end card when the Service advertises it; submit and withdraw
// reach the Service with the seat credential and keep only a submitted flag.
// Negative controls: not advertised, available:false, a code-issued trial, a pass, mid-work; an
// invalid address or a profile without the offer never calls the Service; the address is never
// persisted (globalState, secrets, settings, logs).
//
// Run: node --experimental-strip-types test/notify-optin-host.smoke.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const commandCalls = [];
const config = {};
const vscode = {
  commands: { executeCommand: async (...args) => { commandCalls.push(args); } },
  workspace: { getConfiguration: () => ({ get: (key, fallback) => (key in config ? config[key] : fallback) }) },
  window: {},
  Uri: { file: (p) => ({ fsPath: p }) },
};

let ChatPanelProvider;
test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: [
        "export {ChatPanelProvider} from './src/chatPanelProvider';",
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
  ({ ChatPanelProvider } = module.exports);
});


// The host runs in another realm (vm): compare plain JSON values, not prototypes.
const eq = (a, b, m) => assert.deepEqual(a === undefined ? a : JSON.parse(JSON.stringify(a)), b, m);
const token = 'free-seat-synthetic-credential';
const catalogue = { products: [
  { id: 'pass-lite', label: '라이트', amount: 30000, currency: 'KRW', duration_hours: 720, request_limit: 200, recommended: true },
] };
const CONSENT = 'free-notify-2026-10-19';
const freeSeat = (extra = {}) => ({ activity_kind: 'trial', profile_id: 'studio-open-trial', notify_optin: { available: true, consent_version: CONSENT }, ...extra });
const EXHAUSTED = new Error('API Error: Request rejected (429) · 무료로 쓸 수 있는 AI 요청을 모두 썼습니다. 만든 파일과 대화는 그대로 남아 있습니다.');
const EXPIRED = new Error('Failed to authenticate. API Error: 403 개인 체험 시간이 끝났습니다. 작업 파일은 그대로 남아 있습니다.');
const MID_WORK = new Error('연결이 끊겼습니다. 다시 보내 주세요.');
const EMAIL = 'learner.synthetic@example.com';

function memento(initial = {}) {
  const data = { ...initial };
  return { data, get: (k) => data[k], update: async (k, v) => { data[k] = v; }, keys: () => Object.keys(data) };
}

async function service(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null, body: raw });
      const [status, json] = handler(req, raw);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((r) => server.close(r)) };
}
const defaultService = (req) => {
  if (req.url === '/v1/purchase/products') return [200, catalogue];
  if (req.url === '/v1/free/notify-optin') return [200, { ok: true, subscribed: req.method === 'POST' }];
  return [404, { error: 'not_found' }];
};

function host({ profile = freeSeat(), globalState = memento(), svcUrl }) {
  const posts = [];
  const secretWrites = [];
  const self = {
    context: { globalState, secrets: { get: async () => token, store: async (...a) => { secretWrites.push(a); }, delete: async () => {} } },
    cachedProfile: profile,
    post: async (m) => { posts.push(m); },
    lastRequestId: null,
  };
  config.proxyUrl = svcUrl;
  return { self, posts, secretWrites, globalState };
}

async function endCard(err, profile, globalState = memento()) {
  const svc = await service(defaultService);
  try {
    const h = host({ profile, globalState, svcUrl: svc.url });
    await ChatPanelProvider.prototype.handleSendError.call(h.self, err, 'stream-1', { profile, proxyUrl: svc.url, token });
    return { posts: h.posts, requests: svc.requests };
  } finally { await svc.close(); }
}

const logged = [];
const quiet = { log: console.log, error: console.error, warn: console.warn, info: console.info };
test.beforeEach(() => { logged.length = 0; for (const k of Object.keys(quiet)) console[k] = (...a) => { logged.push(a.map(String).join(' ')); }; });
test.afterEach(() => { Object.assign(console, quiet); });

test('positive: a free seat whose Service advertises it gets the optional section below the pass offer', async () => {
  for (const err of [EXHAUSTED, EXPIRED]) {
    const r = await endCard(err, freeSeat());
    assert.equal(r.posts.length, 1);
    const card = r.posts[0].trialEndCard;
    assert.ok(card, 'the end card itself is drawn');
    assert.equal(card.primary, '이용권 살펴보기', 'the pass offer stays the Primary');
    assert.equal(card.notify.consentVersion, CONSENT);
    assert.equal(card.notify.submitted, false);
    assert.equal(card.notify.prompt, '새 기능과 할인 소식을 이메일로 받아 볼래요? (선택)');
    assert.equal(card.notify.button, '받기');
    assert.match(card.notify.consent, /수집 항목: 이메일 · 목적: 서비스·할인 소식 안내 · 보관: 수신 거부 또는 1년 뒤 삭제/);
    assert.ok(!card.text.includes(card.notify.prompt), 'the banner text stays the pass facts only');
    // Drawing the card sends nothing to the opt-in route.
    assert.ok(r.requests.every((q) => q.url === '/v1/purchase/products'));
  }
  // A seat that already submitted gets the done line, not the empty form.
  const flagged = memento();
  const svc = await service(defaultService);
  try {
    const h = host({ globalState: flagged, svcUrl: svc.url });
    await ChatPanelProvider.prototype.handleNotifyOptin.call(h.self, EMAIL);
  } finally { await svc.close(); }
  const again = await endCard(EXHAUSTED, freeSeat(), flagged);
  assert.equal(again.posts[0].trialEndCard.notify.submitted, true);
});

test('negative controls: not advertised, available:false, code-issued trial, pass seat, mid-work', async () => {
  const cases = [
    ['not advertised', EXHAUSTED, { activity_kind: 'trial', profile_id: 'studio-open-trial' }],
    ['available false', EXHAUSTED, freeSeat({ notify_optin: { available: false, consent_version: CONSENT } })],
    ['malformed version', EXHAUSTED, freeSeat({ notify_optin: { available: true, consent_version: 'x y <script>' } })],
    ['code-issued trial', EXHAUSTED, freeSeat({ profile_id: 'studio-native-trial' })],
    ['pass seat', EXHAUSTED, freeSeat({ pass: { request_limit: 200, requests_used: 200 } })],
    ['before the end (mid-work)', MID_WORK, freeSeat()],
  ];
  for (const [what, err, profile] of cases) {
    const r = await endCard(err, profile);
    assert.equal(r.posts.length, 1, what);
    assert.equal(r.posts[0].trialEndCard?.notify, undefined, what);
    assert.ok(!JSON.stringify(r.posts).includes('이메일로 받아'), what);
    assert.ok(r.requests.every((q) => q.url !== '/v1/free/notify-optin'), what);
  }
});

test('submit: webview → host → Service only, with the seat credential; only a submitted flag is kept', async () => {
  const svc = await service(defaultService);
  try {
    const h = host({ svcUrl: svc.url });
    await ChatPanelProvider.prototype.handleNotifyOptin.call(h.self, `  ${EMAIL} `);
    eq(h.posts, [{ type: 'notifyOptinResult', state: 'subscribed' }]);
    assert.equal(svc.requests.length, 1);
    const [q] = svc.requests;
    assert.equal(q.method, 'POST');
    assert.equal(q.url, '/v1/free/notify-optin');
    assert.equal(q.authorization, 'Bearer ' + token);
    eq(JSON.parse(q.body), { email: EMAIL, consent: true, consent_version: CONSENT });
    // Never persisted: globalState holds one opaque seat key → true; secrets and settings untouched.
    const stored = JSON.stringify(h.globalState.data);
    assert.ok(!stored.includes('example.com') && !stored.includes('learner'), stored);
    assert.ok(!stored.includes(token), 'not even the credential: a one-way key');
    eq(Object.values(h.globalState.data['hypeproofChat.freeNotifySubmitted']), [true]);
    eq(h.secretWrites, []);
    assert.ok(!('email' in config) && !JSON.stringify(config).includes('example.com'), 'no setting written');
    assert.ok(!logged.join('\n').includes('example.com'), 'never logged');
    assert.ok(!JSON.stringify(h.posts).includes('example.com'), 'the result never echoes the address');
    // Withdraw: DELETE with the same credential; the flag is removed.
    await ChatPanelProvider.prototype.handleNotifyOptin.call(h.self, null);
    eq(h.posts.at(-1), { type: 'notifyOptinResult', state: 'withdrawn' });
    eq(svc.requests.at(-1).method, 'DELETE');
    assert.equal(svc.requests.at(-1).authorization, 'Bearer ' + token);
    assert.equal(svc.requests.at(-1).body, '');
    eq(h.globalState.data['hypeproofChat.freeNotifySubmitted'], {});
  } finally { await svc.close(); }
});

test('submit negative controls: invalid address, no offer on the profile, a Service refusal, a Service outage', async () => {
  const svc = await service((req, raw) => {
    if (req.url === '/v1/free/notify-optin' && JSON.parse(raw || '{}').email === 'refused@example.com')
      return [400, { error: { code: 'invalid_email', message: '이메일 주소를 다시 확인해 주세요.' } }];
    return defaultService(req);
  });
  try {
    let h = host({ svcUrl: svc.url });
    for (const bad of ['', '   ', 'not-an-address', 'a@b', 'x'.repeat(250) + '@example.com']) {
      await ChatPanelProvider.prototype.handleNotifyOptin.call(h.self, bad);
      assert.equal(h.posts.at(-1).state, 'error', bad);
    }
    assert.equal(svc.requests.length, 0, 'an invalid address never leaves the host');
    h = host({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial' }, svcUrl: svc.url });
    await ChatPanelProvider.prototype.handleNotifyOptin.call(h.self, EMAIL);
    assert.equal(h.posts.at(-1).state, 'error');
    assert.equal(svc.requests.length, 0, 'not advertised: no call');
    h = host({ profile: freeSeat({ pass: { request_limit: 1, requests_used: 0 } }), svcUrl: svc.url });
    await ChatPanelProvider.prototype.handleNotifyOptin.call(h.self, EMAIL);
    assert.equal(svc.requests.length, 0, 'pass seat: no call');
    h = host({ svcUrl: svc.url });
    await ChatPanelProvider.prototype.handleNotifyOptin.call(h.self, 'refused@example.com');
    eq(h.posts.at(-1), { type: 'notifyOptinResult', state: 'error', message: '이메일 주소를 다시 확인해 주세요.' });
    assert.equal(h.globalState.data['hypeproofChat.freeNotifySubmitted'], undefined, 'a refusal sets no flag');
  } finally { await svc.close(); }
  const h = host({ svcUrl: 'http://127.0.0.1:9/v1' });
  await ChatPanelProvider.prototype.handleNotifyOptin.call(h.self, EMAIL);
  assert.equal(h.posts.at(-1).state, 'error');
  assert.match(h.posts.at(-1).message, /잠시 뒤 다시 시도해 주세요/);
});
