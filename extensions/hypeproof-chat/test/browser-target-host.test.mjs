// REQ-E3 / CGP-AGENT-R-006 — a browser-open approval names the destination host on its own line and says whether
// it is the learner's own preview (내 미리보기) or anything else (인터넷). Pure module first, then the real
// chatPanelProvider bundled with a scripted `vscode` (as task-run-state.smoke.mjs does) to capture the modal text.
//
// .claude/rules/verification.md §2: every lookalike is a negative control for 내 미리보기; the real loopback preview
// is the positive control. Run: node --experimental-strip-types --test test/browser-target-host.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';

const { browserTarget, browserTargetDetail, BROWSER_TARGET_LABELS } = await import('../src/browserTargetHost.ts');
const { isLoopbackPreview } = await import('../src/previewRecovery.ts');

const LOOKALIKES = [
  'http://localhost.evil.com/',
  'http://localhost.evil.com:3000/index.html',
  'http://127.0.0.1.nip.io:8080/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::1]/',
  'http://2130706433/',
  'http://2130706433:3000/',
  'http://0x7f000001/',
  'http://0x7f.0.0.1/',
  'http://0177.0.0.1/',
  'http://127.1/',
  'http://localhost@evil.com/',
  'http://127.0.0.1:3000@evil.com/',
  'http://user:pw@localhost.evil.com/',
  'http://localhost./',
  'https://evil.com/?next=http://localhost:3000/',
  'https://evil.com/http://127.0.0.1:3000/',
  'file:///Users/kid/index.html',
  'not a url',
  '',
];

test('isLoopbackPreview stays strict: every lookalike is false (negative controls)', () => {
  for (const url of LOOKALIKES) assert.equal(isLoopbackPreview(url), false, url);
});

test('every lookalike reads 인터넷, never 내 미리보기', () => {
  for (const url of LOOKALIKES) {
    const t = browserTarget(url);
    assert.equal(t.label, '인터넷', url);
    assert.equal(t.place, 'internet', url);
  }
});

test('a real loopback preview reads 내 미리보기 (positive controls)', () => {
  for (const url of ['http://127.0.0.1:51884/', 'http://localhost:3000/index.html', 'http://127.0.0.1:5500/about.html?x=1', 'HTTP://LOCALHOST:3000/']) {
    const t = browserTarget(url);
    assert.equal(t.label, '내 미리보기', url);
    assert.equal(t.place, 'preview', url);
  }
  assert.equal(browserTarget('http://127.0.0.1:51884/').host, '127.0.0.1');
  assert.equal(browserTarget('HTTP://LOCALHOST:3000/').host, 'localhost');
});

test('query, fragment, path, port and userinfo never reach the display', () => {
  const cases = [
    ['https://user:secret@dental.example/admin/login?token=abc123#frag', 'dental.example'],
    ['https://dental.example:8443/a/b?session=XYZ', 'dental.example'],
    ['http://Example.COM/Path?Q=1', 'example.com'],
    ['http://user:pw@localhost.evil.com/', 'localhost.evil.com'],
    ['http://localhost@evil.com/', 'evil.com'],
  ];
  for (const [url, host] of cases) {
    const t = browserTarget(url);
    assert.equal(t.host, host, url);
    const detail = browserTargetDetail(url);
    for (const secret of ['token', 'abc123', 'secret', 'session', 'XYZ', 'admin', 'frag', 'user', 'pw@', '8443', '?', '#', '/']) {
      assert.ok(!detail.includes(secret), `${url}: detail leaks ${secret}: ${detail}`);
    }
  }
});

test('IDN hosts show as punycode (ASCII), so a lookalike cannot pass as a known site', () => {
  assert.equal(browserTarget('https://аррӏе.com/').host, 'xn--80ak6aa92e.com');
  assert.equal(browserTarget('https://xn--80ak6aa92e.com/').host, 'xn--80ak6aa92e.com');
  assert.equal(browserTarget('https://치과.example/').host, 'xn--vb0bp64d.example');
  for (const url of ['https://аррӏе.com/', 'https://치과.example/']) assert.match(browserTarget(url).host, /^[\x21-\x7e]+$/, url);
});

test('numeric loopback spellings are shown as written, not as 127.0.0.1', () => {
  assert.equal(browserTarget('http://2130706433:3000/').host, '2130706433');
  assert.equal(browserTarget('http://0x7f000001/').host, '0x7f000001');
  assert.equal(browserTarget('http://127.1/').host, '127.1');
  assert.equal(browserTarget('http://[::ffff:127.0.0.1]/').host, '[::ffff:7f00:1]');
});

test('host is on its own line, the label on the next; blank and unknown targets', () => {
  assert.equal(browserTargetDetail('https://dental.example/about?x=1'), 'dental.example\n인터넷');
  assert.equal(browserTargetDetail('http://127.0.0.1:51884/'), '127.0.0.1\n내 미리보기');
  assert.equal(browserTargetDetail('about:blank'), '빈 브라우저');
  assert.equal(browserTargetDetail(''), '알 수 없는 주소\n인터넷');
  assert.equal(browserTargetDetail('file:///Users/kid/secret.html'), '알 수 없는 주소\n인터넷');
  assert.deepEqual(BROWSER_TARGET_LABELS, { preview: '내 미리보기', internet: '인터넷' });
});

// ── The real approval modal (chatPanelProvider + scripted vscode) ──
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL('../src/chatPanelProvider.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' });
const modals = [];
const vscode = {
  window: { showWarningMessage: async (message, options, ...buttons) => { modals.push({ message, options, buttons }); return undefined; } },
  workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
};
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, AbortSignal, URL, TextEncoder, TextDecoder });
const P = mod.exports.ChatPanelProvider.prototype;
const host = { approvedCommandSignatures: new Set(), approvedBrowserOrigins: new Set(), coachDisplayName: () => '코치', sitePublisher: () => ({ allowed: () => false }) };
const ask = async (url) => {
  modals.length = 0;
  const approved = await P.resolveActionApproval.call(host, { requestId: 'r', kind: 'openBrowser', description: `브라우저 열기: ${url}`, payload: { url } });
  assert.equal(approved, false, 'dismissed modal must not approve');
  assert.equal(modals.length, 1, `exactly one modal for ${url}`);
  return modals[0];
};
const captured = [];

test('the approval modal text carries the host line and the label, never the full URL', async () => {
  const internet = await ask('https://user:secret@dental.example/admin?token=abc123');
  assert.equal(internet.message, '코치가 브라우저를 열려고 해요:\n\ndental.example\n인터넷');
  assert.ok(!/token|abc123|secret|admin|user/.test(internet.message + internet.buttons.join(' ')), internet.message);
  assert.equal(internet.options.modal, true);
  captured.push(internet);

  const preview = await ask('http://127.0.0.1:51884/index.html?x=1');
  assert.equal(preview.message, '코치가 브라우저를 열려고 해요:\n\n127.0.0.1\n내 미리보기');
  captured.push(preview);

  for (const url of ['http://localhost.evil.com/', 'http://127.0.0.1.nip.io/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://0x7f000001/']) {
    const m = await ask(url);
    assert.match(m.message, /\n인터넷$/, url);
    assert.ok(!m.message.includes('내 미리보기'), url);
    captured.push(m);
  }

  const idn = await ask('https://аррӏе.com/login');
  assert.equal(idn.message, '코치가 브라우저를 열려고 해요:\n\nxn--80ak6aa92e.com\n인터넷');
  captured.push(idn);

  const out = process.env.HOST_LABEL_CAPTURE;
  if (out) {
    mkdirSync(new URL('.', `file://${out}`).pathname, { recursive: true });
    writeFileSync(out, captured.map((m) => `--- modal (buttons: ${m.buttons.join(' | ')})\n${m.message}\n`).join('\n'));
  }
});
