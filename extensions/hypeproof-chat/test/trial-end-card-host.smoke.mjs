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
  for (const [err, title] of [[EXHAUSTED, '무료 체험을 모두 사용했습니다'], [EXPIRED, '무료 체험 시간이 끝났습니다']]) {
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
  assert.deepEqual(r.requests, []);
  // A bought pass is never offered the trial card.
  r = await present(EXHAUSTED, { ...openTrial, pass: { request_limit: 200, requests_used: 200 } });
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.requests, []);
  // No catalogue: no facts to show, so no card and no made-up price; the turn ends as today.
  r = await present(EXHAUSTED, openTrial, { products: 404 });
  assert.deepEqual(r.posts, await baseline(EXHAUSTED));
  assert.equal(r.posts[0].trialEndCard, undefined);
  assert.deepEqual(r.commands, []);
});
