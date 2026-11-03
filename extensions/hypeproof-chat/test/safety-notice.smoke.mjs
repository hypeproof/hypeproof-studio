// REQ-CGP-LEARN-13 / DES-CGP-LEARN-13 — the learner side of a safety block.
//   1. src/safetyNotice.ts: reading the Service's moderation_block (both route shapes), hostile text,
//      and the help-line gate (self_harm AND profile.safety_help_lines === true).
//   2. proxyChat against a local synthetic Service: a 400 moderation_block throws ModerationBlockError,
//      any other 400 stays the generic transport error.
//   3. ChatPanelProvider.handleSendError: one calm streamError carrying safetyNotice, no retry, no VS Code
//      notification (no sound), for the proxy error and the agent-sdk CLI error alike.
// No model, no production Service, no VS Code window.
//   node --experimental-strip-types test/safety-notice.smoke.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shown = [];
const notify = (kind) => (...args) => { shown.push([kind, ...args]); return Promise.resolve(undefined); };
const vscode = {
  commands: { executeCommand: async () => {} },
  workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
  window: { showErrorMessage: notify('error'), showWarningMessage: notify('warning'), showInformationMessage: notify('info') },
  Uri: { file: (p) => ({ fsPath: p }) },
};

let M;
test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: [
        "export {ChatPanelProvider} from './src/chatPanelProvider';",
        "export {proxyChat, ProxyTransportError} from './src/proxyClient';",
        "export * from './src/safetyNotice';",
      ].join(''),
      resolveDir: new URL('..', import.meta.url).pathname,
    },
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
    external: ['vscode', '@anthropic-ai/claude-agent-sdk', 'zod'],
    plugins: [{
      name: 'unrelated-host-dependency-stubs',
      setup(b) {
        b.onResolve({ filter: /^@hypeproof\/measurement\/adapters$/ }, () => ({ path: 'measurement-adapters', namespace: 'stub' }));
        b.onResolve({ filter: /^qrcode-generator$/ }, () => ({ path: 'qrcode-generator', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents: args.path === 'qrcode-generator'
            ? 'export default function(){throw new Error("QR path is outside this test")}'
            : 'export class FileRecordStorage {}export const LOCAL_RECORD_DIR = "unused";export const recentLocalSessions = () => [];export const parseLocalTranscriptFile = () => null;export const parseLocalTranscript = () => null;export const manualInterpretation = () => null;',
          loader: 'js',
        }));
      },
    }],
  });
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: (id) => id === 'vscode' ? vscode : require(id),
    process, console, URL, Buffer, fetch, crypto: globalThis.crypto, AbortController, AbortSignal, DOMException,
    TextEncoder, TextDecoder, setTimeout, clearTimeout,
  });
  M = module.exports;
});

/** Values from the bundle live in another realm; compare them as plain data. */
const plain = (x) => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));
const SERVICE_SENTENCE = '앗, 이 이야기는 우리 워크숍에서 함께 다룰 수 없는 내용이에요. 대신 만들고 싶은 게임이나 궁금한 것을 물어봐 줄래요? 걱정되는 일이나 도움이 필요한 일이 있으면 옆에 계신 선생님께 꼭 이야기해 주세요.';
const chatBody = (category, message = SERVICE_SENTENCE) => JSON.stringify({ error: { message, type: 'moderation_block', ...(category === undefined ? {} : { category }), request_id: 'req-1' } });
const messagesBody = JSON.stringify({ type: 'error', error: { type: 'moderation_block', message: SERVICE_SENTENCE }, request_id: 'req-2' });

test('parseModerationBlock reads both Service shapes and nothing else', () => {
  assert.deepEqual(plain(M.parseModerationBlock(400, chatBody('self_harm'))), { message: SERVICE_SENTENCE, category: 'self_harm' });
  assert.deepEqual(plain(M.parseModerationBlock(400, messagesBody)), { message: SERVICE_SENTENCE });
  // Negative controls: other statuses, other types, malformed bodies.
  for (const [status, body] of [
    [401, chatBody('self_harm')], [403, chatBody('self_harm')], [200, chatBody('self_harm')], [undefined, chatBody('self_harm')],
    [400, JSON.stringify({ error: { type: 'invalid_request', message: SERVICE_SENTENCE } })],
    [400, 'moderation_block'], [400, ''], [400, '{"error":"moderation_block"}'], [400, 'x'.repeat(20000)],
  ]) assert.equal(M.parseModerationBlock(status, body), null, `${status} ${String(body).slice(0, 40)}`);
});

test('unknown categories are dropped; hostile or foreign text falls back to calm Korean copy', () => {
  for (const c of ['SELF_HARM', 'toString', '__proto__', 'self-harm', 7, null]) assert.equal(M.parseModerationBlock(400, chatBody(c)).category, undefined, String(c));
  for (const c of ['sexual_content', 'graphic_violence', 'pii_solicitation']) assert.equal(M.parseModerationBlock(400, chatBody(c)).category, c);
  const cleaned = M.parseModerationBlock(400, chatBody('self_harm', '잠깐\u202e멈춰요\u2028다시\u0007 해요\u200b')).message;
  assert.equal(cleaned, '잠깐 멈춰요 다시 해요');
  for (const bad of ['blocked by policy', '<b>잠깐</b>', '{"x":"잠깐"}', '가'.repeat(401), '', 42]) {
    assert.equal(M.parseModerationBlock(400, chatBody('self_harm', bad)).message, M.MODERATION_BLOCK_FALLBACK, String(bad).slice(0, 20));
  }
});

test('help lines appear only for self_harm on a seat whose profile turned them on', () => {
  const block = { message: SERVICE_SENTENCE, category: 'self_harm' };
  const on = M.safetyNoticeView(block, { helpLines: true, audience: 'classroom' });
  assert.equal(on.title, '잠깐 멈췄어요');
  assert.equal(on.message, SERVICE_SENTENCE);
  assert.deepEqual(plain(on.help.lines), [{ label: '자살예방상담전화', number: '109' }, { label: '청소년상담', number: '1388' }]);
  assert.equal(on.help.adultLine, '선생님께 바로 이야기해도 괜찮아요.');
  assert.equal(M.safetyNoticeView(block, { helpLines: true, audience: 'solo' }).help.adultLine, '가까운 어른께 바로 이야기해도 괜찮아요.');
  // Negative controls: flag off, another category, no category.
  assert.equal(M.safetyNoticeView(block, { helpLines: false, audience: 'classroom' }).help, undefined);
  for (const category of ['sexual_content', 'graphic_violence', 'pii_solicitation', undefined]) {
    assert.equal(M.safetyNoticeView({ message: SERVICE_SENTENCE, category }, { helpLines: true, audience: 'classroom' }).help, undefined, String(category));
  }
  // Only the literal true turns the flag on.
  assert.equal(M.helpLinesEnabled({ safety_help_lines: true }), true);
  for (const v of ['true', 1, {}, undefined, null]) assert.equal(M.helpLinesEnabled({ safety_help_lines: v }), false, String(v));
  assert.equal(M.helpLinesEnabled(null), false);
});

test('moderationBlockOf: the proxy error, the agent-sdk CLI error line, and nothing the model wrote', () => {
  const proxy = new M.ModerationBlockError({ message: SERVICE_SENTENCE, category: 'self_harm' }, 'req-1');
  assert.deepEqual(plain(M.moderationBlockOf(proxy)), { message: SERVICE_SENTENCE, category: 'self_harm' });
  const sdk = new Error(`Claude Code returned an error result: API Error: 400 ${messagesBody}`);
  assert.deepEqual(plain(M.moderationBlockOf(sdk)), { message: SERVICE_SENTENCE });
  const line = new Error('generic');
  Object.defineProperty(line, 'sdkErrorLine', { value: `API Error: 400 ${messagesBody}` });
  assert.deepEqual(plain(M.moderationBlockOf(line)), { message: SERVICE_SENTENCE });
  // Negative controls: no CLI marker, another status, plain errors.
  assert.equal(M.moderationBlockOf(new Error(`the model said ${messagesBody}`)), null);
  assert.equal(M.moderationBlockOf(new Error(`API Error: 401 ${messagesBody}`)), null);
  const stated = new Error(`API Error: 400 ${messagesBody}`); stated.status = 429;
  assert.equal(M.moderationBlockOf(stated), null, 'an explicit non-400 status wins');
  assert.equal(M.moderationBlockOf(new Error('연결이 끊겼습니다.')), null);
  assert.equal(M.moderationBlockOf('API Error: 400 ' + messagesBody), null);
});

async function serve(status, body) {
  const server = http.createServer((req, res) => { req.resume(); res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'rid-77' }); res.end(body); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const chat = (proxyUrl) => M.proxyChat({ proxyUrl, model: 'm', token: 't', history: [], userText: '질문', onDelta() {}, signal: new AbortController().signal });

test('proxyChat: a 400 moderation_block throws ModerationBlockError with the request id', async () => {
  const s = await serve(400, chatBody('self_harm'));
  try {
    const err = await chat(s.url).then(() => null, (e) => e);
    assert.ok(err instanceof M.ModerationBlockError, err?.constructor?.name);
    assert.deepEqual(plain(err.block), { message: SERVICE_SENTENCE, category: 'self_harm' });
    assert.equal(err.requestId, 'rid-77');
  } finally { await s.close(); }
  const other = await serve(400, JSON.stringify({ error: { type: 'invalid_request', message: '잘못된 요청' } }));
  try {
    const err = await chat(other.url).then(() => null, (e) => e);
    assert.ok(err instanceof M.ProxyTransportError && !(err instanceof M.ModerationBlockError), 'another 400 stays a transport error');
  } finally { await other.close(); }
});

async function present(err, profile) {
  const posts = [];
  const self = { context: { secrets: { get: async () => 't', delete: async () => {} } }, post: async (m) => { posts.push(m); }, lastRequestId: null, cachedProfile: null };
  shown.length = 0;
  await M.ChatPanelProvider.prototype.handleSendError.call(self, err, 'stream-9', { profile, proxyUrl: 'http://127.0.0.1:9/v1', token: 't' });
  return { posts, self, shown: [...shown] };
}
const classroomOn = { activity_kind: 'classroom', safety_help_lines: true };
const classroomOff = { activity_kind: 'classroom' };

test('host: one calm streamError with the help lines when the profile allows them, no retry, no notification', async () => {
  const r = await present(new M.ModerationBlockError({ message: SERVICE_SENTENCE, category: 'self_harm' }, 'rid-77'), classroomOn);
  assert.equal(r.posts.length, 1);
  const [p] = r.posts;
  assert.equal(p.type, 'streamError');
  assert.equal(p.streamId, 'stream-9');
  assert.equal(p.error, SERVICE_SENTENCE);
  assert.equal(p.retry, false, 'no 다시 보내기');
  assert.equal(p.activityUnavailable, undefined, 'not an access ending');
  assert.equal(p.requestId, 'rid-77');
  assert.equal(r.self.lastRequestId, 'rid-77');
  assert.deepEqual(plain(p.safetyNotice.help.lines.map((l) => l.number)), ['109', '1388']);
  assert.equal(p.safetyNotice.help.adultLine, '선생님께 바로 이야기해도 괜찮아요.');
  assert.deepEqual(r.shown, [], 'no VS Code notification (and so no sound)');
});

test('host: flag off or no category → the calm notice without help lines', async () => {
  let r = await present(new M.ModerationBlockError({ message: SERVICE_SENTENCE, category: 'self_harm' }), classroomOff);
  assert.equal(r.posts.length, 1);
  assert.ok(r.posts[0].safetyNotice, 'still the calm notice');
  assert.equal(r.posts[0].safetyNotice.help, undefined);
  r = await present(new M.ModerationBlockError({ message: SERVICE_SENTENCE, category: 'sexual_content' }), classroomOn);
  assert.equal(r.posts[0].safetyNotice.help, undefined);
  // agent-sdk: the CLI error carries the Service body without a category.
  r = await present(new Error(`Claude Code returned an error result: API Error: 400 ${messagesBody}`), classroomOn);
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0].error, SERVICE_SENTENCE);
  assert.equal(r.posts[0].retry, false);
  assert.ok(r.posts[0].safetyNotice && r.posts[0].safetyNotice.help === undefined);
  assert.deepEqual(r.shown, []);
});

test('host negative control: any other failure has no safetyNotice', async () => {
  for (const err of [new M.ProxyTransportError('문제가 발생했습니다.', 'rid-1'), new Error('연결이 끊겼습니다.'), new Error(`Claude Code returned an error result: API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"bad"}}`)]) {
    const r = await present(err, classroomOn);
    assert.ok(r.posts.length >= 1);
    for (const p of r.posts) assert.equal(p.safetyNotice, undefined, err.message);
  }
});
