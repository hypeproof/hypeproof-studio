// #1670 / REQ-L12 / REQ-M15 — an Agent SDK api_retry 401 has no error body.
// The real SDK event path must stop after that one event, then the host may make
// one bounded GET /profile with the same saved code. Paid-pass copy is allowed
// only when that authenticated read returns the exact revoked/expired code.
// No model, payment, production Service, clock substitution or VS Code window.
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

let ChatPanelProvider, runSdkCoach, SdkGatewayAuthError, errorBannerPresentation;
test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: [
        "export {ChatPanelProvider} from './src/chatPanelProvider';",
        "export {runSdkCoach,SdkGatewayAuthError} from './src/sdkCoach';",
        "export {errorBannerPresentation} from './webview-ui/src/errorBannerPresentation';",
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
  ({ ChatPanelProvider, runSdkCoach, SdkGatewayAuthError, errorBannerPresentation } = module.exports);
});

const token = 'paid-test-code';
const paidProfile = { pass: { request_limit: 8, requests_used: 4, expires_at: 2_000_000_000 } };
const trialProfile = {};
const apiRetry401 = {
  type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10,
  retry_delay_ms: 500, error_status: 401, error: 'authentication_failed',
};
const lateAnswer = { type: 'assistant', message: { id: 'late', content: [{ type: 'text', text: '늦은 답' }] } };

async function actualSdk401() {
  const pulled = [];
  const sdk = { query: () => (async function* () {
    for (const event of [apiRetry401, lateAnswer]) { pulled.push(event); yield event; }
  })() };
  const error = await runSdkCoach({
    sdk,
    binaryResolution: { available: true, reasons: [] },
    gatewayUrl: 'http://127.0.0.1:1/v1',
    token,
    model: 'test-model',
    profile: paidProfile,
    systemPrompt: '',
    history: [],
    userText: 'test',
    signal: new AbortController().signal,
    stallTimeoutMs: 0,
    onDelta: () => assert.fail('a rejected SDK turn must not emit the late answer'),
    onCitations: () => {},
    onAssetScore: () => {},
    requestApproval: async () => false,
  }).then(() => null, (err) => err);
  assert.ok(error instanceof SdkGatewayAuthError, 'the real api_retry path carries a recheckable marker');
  assert.equal(error.message, '참여 코드를 확인하지 못했습니다. 다시 입력해 보고, 문제가 계속되면 코드 발급 담당자에게 문의해 주세요.');
  assert.equal(error.kind, 'missing', 'status-only 401 remains non-destructive before profile proof');
  assert.equal(error.status, 401);
  assert.equal(pulled.length, 1, 'the SDK retry loop stops after the first 401 event');
  return error;
}

async function fixture(response) {
  const requests = [];
  let markArrived;
  const arrived = new Promise((resolve) => { markArrived = resolve; });
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    markArrived();
    if (response === 'network') { req.socket.destroy(); return; }
    const reply = 'wait' in response ? (await response.wait, response.reply) : response;
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    proxyUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    arrived,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

function host() {
  const posts = [];
  const secrets = { reads: 0, deletes: 0 };
  return {
    posts,
    secrets,
    value: {
      context: { secrets: {
        get: async () => { secrets.reads++; return token; },
        delete: async () => { secrets.deletes++; },
      } },
      post: async (message) => { posts.push(message); },
      lastRequestId: null,
    },
  };
}

async function present(error, profile, response) {
  const f = await fixture(response);
  const h = host();
  commandCalls.length = 0;
  try {
    await ChatPanelProvider.prototype.handleSendError.call(
      h.value,
      error,
      'stream-1',
      { profile, proxyUrl: f.proxyUrl, token },
    );
    return { ...h, requests: f.requests, commands: structuredClone(commandCalls) };
  } finally {
    await f.close();
  }
}

test('actual SDK 401 + authoritative paid revocation shows recovery without credential deletion', async () => {
  const error = await actualSdk401();
  const r = await present(error, paidProfile, {
    status: 401,
    body: { error: { code: 'trial_revoked_or_reissued', message: '환불했거나 새 코드로 바뀐 이용권입니다. 만든 파일과 대화는 그대로 남아 있습니다.' } },
  });
  assert.deepEqual(r.requests, [{ method: 'GET', url: '/v1/profile', authorization: `Bearer ${token}` }]);
  assert.match(r.posts[0].error, /환불.*이용권/);
  assert.match(r.posts[0].error, /파일과 대화는 그대로/);
  assert.deepEqual(
    structuredClone(errorBannerPresentation(r.posts[0].error)),
    { icon: '🎟️', title: '이용권을 더 쓸 수 없어요' },
    'the candidate webview renders confirmed paid-pass copy as account-state recovery',
  );
  assert.deepEqual(r.commands, [], 'a confirmed ended pass does not reopen generic code entry');
  assert.equal(r.secrets.deletes, 0, 'the saved code is not deleted or replaced');
});

test('actual SDK 401 + authoritative paid expiry shows paid recovery', async () => {
  const error = await actualSdk401();
  const r = await present(error, paidProfile, {
    status: 403,
    body: { error: { code: 'trial_expired', message: '이용권 기간이 끝났습니다. 만든 파일과 대화는 그대로 보존됩니다.' } },
  });
  assert.match(r.posts[0].error, /이용권 기간이 끝/);
  assert.equal(errorBannerPresentation(r.posts[0].error).title, '이용권을 더 쓸 수 없어요');
  assert.deepEqual(r.commands, []);
  assert.equal(r.secrets.deletes, 0);
});

test('Stop during the authoritative lookup suppresses every late recovery message', async () => {
  const error = await actualSdk401();
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const f = await fixture({
    wait,
    reply: {
      status: 401,
      body: { error: { code: 'trial_revoked_or_reissued', message: '환불한 이용권입니다.' } },
    },
  });
  const h = host();
  const ctrl = new AbortController();
  commandCalls.length = 0;
  try {
    const handling = ChatPanelProvider.prototype.handleSendError.call(
      h.value,
      error,
      'stream-cancelled',
      { profile: paidProfile, proxyUrl: f.proxyUrl, token, signal: ctrl.signal },
    );
    await f.arrived;
    ctrl.abort();
    let timeout;
    await Promise.race([
      handling,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('cancelled lookup did not finish')), 250); }),
    ]).finally(() => clearTimeout(timeout));
    assert.deepEqual(h.posts, [], 'Stop remains the final webview state');
    assert.deepEqual(commandCalls, [], 'Stop does not reopen generic code entry');
    assert.equal(h.secrets.deletes, 0);
    assert.equal(f.requests.length, 1, 'the already-started proof read is not retried');
  } finally {
    release();
    await f.close();
  }
});

test('valid, invalid, network and non-paid controls keep generic authentication recovery', async () => {
  const error = await actualSdk401();
  const cases = [
    ['valid paid profile', paidProfile, { status: 200, body: paidProfile }, 1],
    ['different 401 code', paidProfile, { status: 401, body: { error: { code: 'signature', message: 'rejected' } } }, 1],
    ['profile network failure', paidProfile, 'network', 1],
    ['non-paid profile', trialProfile, { status: 401, body: { error: { code: 'trial_revoked_or_reissued', message: 'ended' } } }, 0],
  ];
  for (const [label, profile, response, expectedReads] of cases) {
    const r = await present(error, profile, response);
    assert.equal(r.requests.length, expectedReads, `${label}: paid proof lookup count`);
    assert.equal(r.posts[0].error, error.friendly, `${label}: no refund claim`);
    assert.equal(errorBannerPresentation(r.posts[0].error).title, '잠시 멈춰요', `${label}: generic UI remains`);
    assert.deepEqual(r.commands, [], `${label}: recovery is an explicit status-screen action`);
    assert.equal(r.posts[0].activityUnavailable.cause, 'auth', `${label}: bare 401 never implies expiry`);
    assert.equal(r.secrets.deletes, 0, `${label}: status-only 401 never deletes the code`);
  }
});
