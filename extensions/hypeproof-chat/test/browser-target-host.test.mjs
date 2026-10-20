// REQ-E3 / CGP-AGENT-R-006 — a browser-open approval names the destination host on its own line and says whether
// it is the learner's own preview (내 미리보기), a file on their computer (내 컴퓨터 파일) or anything else (인터넷).
// The line, the label, the "항상 허용" button, the request description and the detailed tool line all come from
// the same WHATWG-normalized host. Pure module first, then the real chatPanelProvider bundled with a scripted
// `vscode` (as task-run-state.smoke.mjs does) to capture the modal text.
//
// .claude/rules/verification.md §2: every lookalike is a negative control for 내 미리보기; the real loopback preview
// is the positive control. Run: node --experimental-strip-types --test test/browser-target-host.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const { browserTarget, browserTargetDetail, browserTargetInline, browserRememberLabel, BROWSER_TARGET_LABELS } = await import('../src/browserTargetHost.ts');
const { isLoopbackPreview } = await import('../src/previewRecovery.ts');
const { sdkToolToActionRequest, summarizeToolInput } = await import('../src/sdkCoachHelpers.ts');

// [url, the normalized host every surface must show]
const LOOKALIKES = [
  ['http://localhost.evil.com/', 'localhost.evil.com'],
  ['http://localhost.evil.com:3000/index.html', 'localhost.evil.com'],
  ['http://127.0.0.1.nip.io:8080/', '127.0.0.1.nip.io'],
  ['http://[::ffff:127.0.0.1]/', '[::ffff:7f00:1]'],
  ['http://[::1]:3000/', '[::1]'],
  ['http://2130706433/', '127.0.0.1'],
  ['http://2130706433:3000/', '127.0.0.1'],
  ['http://0x7f000001/', '127.0.0.1'],
  ['http://0x7f.0.0.1:5500/', '127.0.0.1'],
  ['http://0177.0.0.1/', '127.0.0.1'],
  ['http://017700000001/', '127.0.0.1'],
  ['http://127.1/', '127.0.0.1'],
  ['http://localhost@evil.com/', 'evil.com'],
  ['http://127.0.0.1:3000@evil.com/', 'evil.com'],
  ['http://user:pw@localhost.evil.com/', 'localhost.evil.com'],
  ['http://localhost./', 'localhost.'],
  ['https://evil.com/?next=http://localhost:3000/', 'evil.com'],
  ['https://evil.com/http://127.0.0.1:3000/', 'evil.com'],
];
const NOT_WEB = ['not a url', '', 'javascript:alert(1)'];

test('isLoopbackPreview stays strict: every lookalike is false (negative controls)', () => {
  for (const [url] of LOOKALIKES) assert.equal(isLoopbackPreview(url), false, url);
});

test('every lookalike reads 인터넷 with its WHATWG-normalized host, never 내 미리보기', () => {
  for (const [url, host] of LOOKALIKES) {
    const t = browserTarget(url);
    assert.equal(t.label, '인터넷', url);
    assert.equal(t.place, 'internet', url);
    assert.equal(t.host, host, url);
    assert.equal(t.host, new URL(url).hostname, `${url}: same normalization as URL.hostname`);
  }
  for (const url of NOT_WEB) assert.equal(browserTarget(url).label, '인터넷', url);
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
    assert.equal(browserTarget(url).host, host, url);
    for (const text of [browserTargetDetail(url), browserTargetInline(url), browserRememberLabel(url)]) {
      for (const secret of ['token', 'abc123', 'secret', 'session', 'XYZ', 'admin', 'frag', 'user', 'pw@', '8443', '?', '#', '/']) {
        assert.ok(!text.includes(secret), `${url}: "${text}" leaks ${secret}`);
      }
    }
  }
});

test('IDN hosts show as punycode (ASCII), so a lookalike cannot pass as a known site', () => {
  assert.equal(browserTarget('https://аррӏе.com/').host, 'xn--80ak6aa92e.com');
  assert.equal(browserTarget('https://xn--80ak6aa92e.com/').host, 'xn--80ak6aa92e.com');
  assert.equal(browserTarget('https://치과.example/').host, 'xn--vb0bp64d.example');
  for (const url of ['https://аррӏе.com/', 'https://치과.example/']) assert.match(browserTarget(url).host, /^[\x21-\x7e]+$/, url);
  assert.equal(browserRememberLabel('https://аррӏе.com/x'), '이 사이트는 항상 허용 (xn--80ak6aa92e.com)');
});

test('file: URLs read 내 컴퓨터 파일 and show the file name only', () => {
  const t = browserTarget('file:///Users/kid/secret-folder/My%20Page.html?x=1#y');
  assert.equal(t.label, '내 컴퓨터 파일');
  assert.equal(t.place, 'file');
  assert.equal(t.host, 'My Page.html');
  assert.equal(browserTargetDetail('file:///Users/kid/secret-folder/index.html'), 'index.html\n내 컴퓨터 파일');
  assert.ok(!browserTargetDetail('file:///Users/kid/secret-folder/index.html').includes('kid'));
  assert.equal(browserTarget('file:///Users/kid/').host, 'kid'); // a folder: its own name, never the parents
  assert.equal(browserTarget('file:///').host, '이름 없는 파일');
  // a bidi override cannot reorder the name on screen
  assert.equal(browserTarget('file:///tmp/%E2%80%AEgpj.exe').host, 'gpj.exe');
  assert.equal(browserRememberLabel('file:///Users/kid/index.html'), null, 'no site-wide allow for a file');
});

test('host is on its own line, the label on the next; blank and unknown targets', () => {
  assert.equal(browserTargetDetail('https://dental.example/about?x=1'), 'dental.example\n인터넷');
  assert.equal(browserTargetDetail('http://127.0.0.1:51884/'), '127.0.0.1\n내 미리보기');
  assert.equal(browserTargetDetail('about:blank'), '빈 브라우저');
  assert.equal(browserTargetDetail(''), '알 수 없는 주소\n인터넷');
  assert.equal(browserTargetInline('https://dental.example/about?x=1'), 'dental.example · 인터넷');
  assert.deepEqual(BROWSER_TARGET_LABELS, { preview: '내 미리보기', internet: '인터넷', file: '내 컴퓨터 파일' });
});

test('the request description carries the host only (sdkToolToActionRequest)', () => {
  const req = sdkToolToActionRequest({ toolName: 'mcp__hypeproof__browser_open', input: { url: 'https://user:pw@dental.example/a?token=abc' } });
  assert.equal(req.kind, 'openBrowser');
  assert.equal(req.description, '브라우저 열기: dental.example · 인터넷');
  assert.equal(req.payload.url, 'https://user:pw@dental.example/a?token=abc', 'the payload keeps the real URL for the browser');
  assert.equal(sdkToolToActionRequest({ toolName: 'mcp__hypeproof__browser_open', input: {} }).description, '브라우저 열기: 빈 브라우저');
  assert.equal(sdkToolToActionRequest({ toolName: 'mcp__hypeproof__browser_open', input: { url: 'javascript:alert(1)' } }).description, '브라우저 열기: 알 수 없는 주소');
});

test('the learner-facing tool line shows host · label; the internal default keeps the URL', () => {
  const input = { url: 'https://dental.example/admin?token=abc123' };
  assert.equal(summarizeToolInput('mcp__hypeproof__browser_open', input, 60, undefined, { urlHostOnly: true }), 'dental.example · 인터넷');
  assert.equal(summarizeToolInput('WebFetch', { url: 'https://user:pw@docs.example/x?k=1' }, 60, undefined, { urlHostOnly: true }), 'docs.example · 인터넷');
  assert.equal(summarizeToolInput('mcp__hypeproof__browser_open', { url: 'http://127.0.0.1:5500/' }, 60, undefined, { urlHostOnly: true }), '127.0.0.1 · 내 미리보기');
  // other keys are untouched by the option
  assert.equal(summarizeToolInput('Bash', { command: 'ls' }, 60, undefined, { urlHostOnly: true }), 'ls');
  // the internal observation call (no option) is unchanged
  assert.equal(summarizeToolInput('mcp__hypeproof__browser_open', input, 300), 'https://dental.example/admin?token=abc123');
});

// ── The real approval modal (chatPanelProvider + scripted vscode) ──
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL('../src/chatPanelProvider.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' });
const source = bundle.outputFiles[0].text;
const modals = [];
const vscode = {
  window: { showWarningMessage: async (message, options, ...buttons) => { modals.push({ message, options, buttons }); return undefined; } },
  workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
};
const mod = { exports: {} };
vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (id) => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, AbortSignal, URL, TextEncoder, TextDecoder });
const P = mod.exports.ChatPanelProvider.prototype;
const WORK = '/Users/kid/work';
const host = { approvedCommandSignatures: new Set(), approvedBrowserOrigins: new Set(), coachDisplayName: () => '코치', sitePublisher: () => ({ allowed: () => false }), resolveCoachCwd: () => WORK };
const ask = async (url) => {
  modals.length = 0;
  const approved = await P.resolveActionApproval.call(host, { requestId: 'r', kind: 'openBrowser', description: `브라우저 열기: ${url}`, payload: { url } });
  assert.equal(approved, false, 'dismissed modal must not approve');
  assert.equal(modals.length, 1, `exactly one modal for ${url}`);
  return { url, ...modals[0] };
};
const captured = [];

test('the approval modal: host line, label and 항상 허용 button name the same normalized host', async () => {
  const internet = await ask('https://user:secret@dental.example/admin?token=abc123');
  assert.equal(internet.message, '코치가 브라우저를 열려고 해요:\n\ndental.example\n인터넷');
  assert.deepEqual(internet.buttons, ['열기', '이 사이트는 항상 허용 (dental.example)']);
  assert.ok(!/token|abc123|secret|admin|user/.test(internet.message + internet.buttons.join(' ')), internet.message);
  assert.equal(internet.options.modal, true);
  captured.push(internet);

  const preview = await ask('http://127.0.0.1:51884/index.html?x=1');
  assert.equal(preview.message, '코치가 브라우저를 열려고 해요:\n\n127.0.0.1\n내 미리보기');
  assert.deepEqual(preview.buttons, ['열기', '이 사이트는 항상 허용 (127.0.0.1)']);
  captured.push(preview);

  for (const [url, normalized] of LOOKALIKES) {
    const m = await ask(url);
    assert.equal(m.message, `코치가 브라우저를 열려고 해요:\n\n${normalized}\n인터넷`, url);
    assert.deepEqual(m.buttons, ['열기', `이 사이트는 항상 허용 (${normalized})`], `${url}: button and line agree`);
    captured.push(m);
  }

  const idn = await ask('https://аррӏе.com/login');
  assert.equal(idn.message, '코치가 브라우저를 열려고 해요:\n\nxn--80ak6aa92e.com\n인터넷');
  assert.deepEqual(idn.buttons, ['열기', '이 사이트는 항상 허용 (xn--80ak6aa92e.com)']);
  captured.push(idn);

  const file = await ask('file:///Users/kid/secret-folder/index.html');
  assert.equal(file.message, '코치가 브라우저를 열려고 해요:\n\n작업 폴더 밖 · index.html\n내 컴퓨터 파일');
  assert.deepEqual(file.buttons, ['열기'], 'no "항상 허용 (null)" for a file');
  captured.push(file);

  const inside = await ask('file:///Users/kid/work/notes/a.txt');
  assert.equal(inside.message, '코치가 브라우저를 열려고 해요:\n\n작업 폴더/notes/a.txt\n내 컴퓨터 파일');
  captured.push(inside);

  const remote = await ask('file://evil.com/share/x.html');
  assert.equal(remote.message, '코치가 브라우저를 열려고 해요:\n\nevil.com\n인터넷');
  captured.push(remote);

  // A file name cannot fake extra lines: the body is always title, blank line, target, label.
  const forged = await ask('file:///x/a%E2%80%A8%E2%80%A8127.0.0.1%E2%80%A8%EB%82%B4%20%EB%AF%B8%EB%A6%AC%EB%B3%B4%EA%B8%B0%E2%80%A8x.html');
  assert.equal(forged.message.split(/[\n\r\u0085\u2028\u2029]/).length, 4, JSON.stringify(forged.message));
  assert.match(forged.message, /\n내 컴퓨터 파일$/);
  captured.push(forged);

  const out = process.env.HOST_LABEL_CAPTURE;
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, captured.map((m) => `--- input: ${m.url}\n--- buttons: ${m.buttons.join(' | ')}\n${m.message}\n`).join('\n'));
  }
});

test('the detailed tool line is built with the host-only option (wiring)', () => {
  // The learner-facing label passes { urlHostOnly: true }; the observation call keeps the raw URL for research.
  assert.match(source, /summarizeToolInput\(a\.name, a\.input, 60, this\.resolveCoachCwd\(\), \{ urlHostOnly: true \}\)/);
});

test('file names lose every character that could fake a line or reorder text', () => {
  const cases = [
    ['file:///x/a%E2%80%A8b.html', 'ab.html'],          // U+2028 line separator
    ['file:///x/a%E2%80%A9b.html', 'ab.html'],          // U+2029 paragraph separator
    ['file:///x/a%C2%85b.html', 'ab.html'],             // U+0085 NEL (C1)
    ['file:///x/a%C2%9Bb.html', 'ab.html'],             // U+009B CSI (C1)
    ['file:///x/a%0Ab%0Dc.html', 'abc.html'],           // LF, CR (C0)
    ['file:///x/%E2%81%A6evil%E2%81%A9.html', 'evil.html'], // LRI..PDI
    ['file:///x/%D8%9Cname.html', 'name.html'],         // U+061C ALM
  ];
  for (const [url, name] of cases) {
    assert.equal(browserTarget(url).host, name, url);
    assert.equal(browserTargetDetail(url).split(/[\n\r\u0085\u2028\u2029]/).length, 2, url);
  }
});

test('file: inside the work folder shows 작업 폴더/<relative path>; outside shows 작업 폴더 밖 · <name>', () => {
  const opts = { workspaceRoot: '/Users/kid/work' };
  assert.equal(browserTarget('file:///Users/kid/work/notes/a.txt', opts).host, '작업 폴더/notes/a.txt');
  assert.equal(browserTarget('file:///Users/kid/work/index.html', opts).host, '작업 폴더/index.html');
  assert.equal(browserTarget('file://localhost/Users/kid/work/a.html', opts).host, '작업 폴더/a.html');
  assert.equal(browserTarget('file:///Users/kid/work/My%20Notes/a%20b.txt', opts).host, '작업 폴더/My Notes/a b.txt');
  // outside: a sibling with the same prefix, a parent, a traversal, the folder itself, another place
  assert.equal(browserTarget('file:///Users/kid/.ssh/id_rsa', opts).host, '작업 폴더 밖 · id_rsa');
  assert.equal(browserTarget('file:///Users/kid/work2/a.txt', opts).host, '작업 폴더 밖 · a.txt');
  assert.equal(browserTarget('file:///Users/kid/work/../.ssh/id_rsa', opts).host, '작업 폴더 밖 · id_rsa');
  assert.equal(browserTarget('file:///Users/kid/work', opts).host, '작업 폴더 밖 · work');
  assert.equal(browserTarget('file:///etc/passwd', opts).host, '작업 폴더 밖 · passwd');
  // no work folder open → everything is outside
  assert.equal(browserTarget('file:///Users/kid/work/a.txt', { workspaceRoot: null }).host, '작업 폴더 밖 · a.txt');
  // the label stays 내 컴퓨터 파일 either way, and the full path never shows
  for (const url of ['file:///Users/kid/work/notes/a.txt', 'file:///Users/kid/.ssh/id_rsa']) {
    assert.equal(browserTarget(url, opts).label, '내 컴퓨터 파일');
    assert.ok(!browserTargetDetail(url, opts).includes('/Users'), url);
  }
  // the learner-facing tool line uses the same rule
  assert.equal(summarizeToolInput('mcp__hypeproof__browser_open', { url: 'file:///Users/kid/.ssh/id_rsa' }, 60, '/Users/kid/work', { urlHostOnly: true }), '작업 폴더 밖 · id_rsa · 내 컴퓨터 파일');
  assert.equal(summarizeToolInput('mcp__hypeproof__browser_open', { url: 'file:///Users/kid/work/a.html' }, 60, '/Users/kid/work', { urlHostOnly: true }), '작업 폴더/a.html · 내 컴퓨터 파일');
});

test('file:// with a remote host is 인터넷 with that host', () => {
  for (const [url, h] of [['file://evil.com/share/x.html', 'evil.com'], ['file://FILESERVER/share/a.txt', 'fileserver'], ['file://192.168.0.5/c/x', '192.168.0.5']]) {
    const t = browserTarget(url, { workspaceRoot: '/Users/kid/work' });
    assert.equal(t.label, '인터넷', url);
    assert.equal(t.host, h, url);
    assert.equal(browserRememberLabel(url), null, url);
  }
  assert.equal(browserTarget('file://localhost/Users/kid/a.txt').label, '내 컴퓨터 파일');
});
