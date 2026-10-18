// REQ-L12 (13) / CU-13 / CU-14 — the real ChatPanelProvider.handleSendError on the exact
// errors a real Agent SDK run threw for a spent and an expired free trial (2026-10-18
// diagnosis, sdk-exhausted.json / sdk-expired.json, SDK 0.3.299: a plain Error with a
// status and this message). The Service is a local stand-in that answers only the public
// pass catalogue. No model, payment, production Service or VS Code window.
//
// Run: node --test test/sdk-trial-end-notice.test.mjs
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

let ChatPanelProvider, errorBannerPresentation, P;
test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: [
        "export {ChatPanelProvider} from './src/chatPanelProvider';",
        "export {errorBannerPresentation} from './webview-ui/src/errorBannerPresentation';",
        "export * as P from './src/passPurchase';",
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
    module, exports: module.exports,
    require: (id) => id === 'vscode' ? vscode : require(id),
    // The same Error as the test, so the host's `instanceof Error` sees the observed errors as errors.
    Error, process, console, URL, Buffer, fetch, crypto: globalThis.crypto,
    AbortController, AbortSignal, DOMException, TextEncoder, TextDecoder, setTimeout, clearTimeout,
  });
  ({ ChatPanelProvider, errorBannerPresentation, P } = module.exports);
});

const token = 'trial-test-code';
const trialProfile = {};
const observed = (status, message) => Object.assign(new Error(message), { status });
const SDK_EXHAUSTED = observed(429, 'Claude Code returned an error result: API Error: Request rejected (429) · 개인 체험의 총 요청 한도에 도달했습니다.');
const SDK_EXPIRED = observed(403, 'Claude Code returned an error result: Failed to authenticate. API Error: 403 개인 체험 시간이 끝났습니다. 작업 파일은 그대로 보존됩니다.');
const CLASSROOM_429 = observed(429, 'Claude Code returned an error result: API Error: Request rejected (429) · 실행 중인 작업이 있거나 이 수업의 요청 한도에 도달했습니다.');
const catalogue = { products: [{ id: 'pass-basic', label: '기본', recommended: true, amount: 55000, currency: 'KRW', duration_hours: 720, request_limit: 350 }] };

async function service(products) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null });
    if (req.method === 'GET' && req.url === '/v1/purchase/products' && products) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(products)); return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { proxyUrl: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => new Promise((r) => server.close(r)) };
}

async function present(error, products, profile = trialProfile) {
  const s = await service(products);
  const posts = [];
  const secrets = { deletes: 0 };
  const h = {
    context: { secrets: { get: async () => token, delete: async () => { secrets.deletes++; } } },
    post: async (message) => { posts.push(message); },
    lastRequestId: null,
  };
  commandCalls.length = 0;
  try {
    await ChatPanelProvider.prototype.handleSendError.call(h, error, 'stream-1', { profile, proxyUrl: s.proxyUrl, token });
    return { posts, secrets, requests: s.requests, commands: structuredClone(commandCalls) };
  } finally { await s.close(); }
}

for (const [label, error, ending] of [['exhausted', SDK_EXHAUSTED, 'exhausted'], ['expired', SDK_EXPIRED, 'expired']]) {
  test(`observed SDK ${label} text with passes on sale names kept files and '이용권으로 시작하기'`, async () => {
    const r = await present(error, catalogue);
    assert.equal(r.posts.length, 1);
    assert.deepEqual(structuredClone(r.posts[0]), { type: 'streamError', streamId: 'stream-1', error: P.trialEndNotice(ending, true) });
    assert.match(r.posts[0].error, /만든 파일과 대화는 그대로 있어요/);
    assert.match(r.posts[0].error, /'이용권으로 시작하기'/);
    assert.doesNotMatch(r.posts[0].error, /API Error|코드 발급 담당자|다시 시도/);
    assert.deepEqual(structuredClone(errorBannerPresentation(r.posts[0].error)), { icon: '⏳', title: '체험이 끝났어요' });
    // Never opened for the person: no command (no purchase screen, no code box), no order, no credential touched.
    assert.deepEqual(r.commands, []);
    assert.deepEqual(r.requests, [{ method: 'GET', url: '/v1/purchase/products', authorization: null }], 'one public catalogue read, without the code');
    assert.equal(r.secrets.deletes, 0);
  });
  test(`observed SDK ${label} text with no passes on sale names no pass`, async () => {
    const r = await present(error, null);
    assert.equal(r.posts[0].error, P.trialEndNotice(ending, false));
    assert.doesNotMatch(r.posts[0].error, /이용권/);
    assert.deepEqual(r.commands, []);
  });
}

test('classroom 429 is not a trial ending: no catalogue read, unchanged generic notice', async () => {
  const r = await present(CLASSROOM_429, catalogue);
  assert.deepEqual(r.requests, []);
  assert.equal(r.posts[0].error, CLASSROOM_429.message);
  assert.doesNotMatch(r.posts[0].error, /체험이 끝|이용권으로 시작하기/);
  assert.deepEqual(r.commands, []);
});

test('a bought pass that is spent keeps the pass notice', async () => {
  const spent = observed(429, 'Claude Code returned an error result: API Error: Request rejected (429) · 이용권의 AI 요청 횟수를 모두 썼습니다. 만든 파일과 대화는 그대로 남아 있습니다.');
  const r = await present(spent, catalogue, { pass: { request_limit: 8, requests_used: 8, expires_at: 2_000_000_000 } });
  assert.equal(r.posts[0].error, P.PASS_SPENT_FRIENDLY);
  assert.deepEqual(r.requests, []);
});
