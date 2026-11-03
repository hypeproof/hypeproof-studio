// REQ-STUDIO-FORCED-COLORS - CGP-DS-D-013 (DES-CGP-DS-17): forced colors measured on the CASCADE in headless
// Chromium, not read from declarations (forced-colors.smoke.mjs parses the CSS; a later or more specific
// rule can still undo it).
//   node --experimental-strip-types test/forced-colors-computed.smoke.mjs
//
// The real webview entry (main.tsx: real stylesheet order, real ChatPanel markup) is bundled and rendered with
// `forced-colors: active` emulated, personal and classroom seat, dark and light, 1420 and 800 px, with a user and
// an assistant message. Then:
//   - every visible button, select, textarea, summary, text input and control role has a 1px+ border on all four
//     sides in ButtonText (Highlight when it is the selected/current one, GrayText when disabled); the one
//     exception is the personal composer textarea, whose bordered wrapper (.hps-input) is the boundary
//   - the user bubble has a CanvasText border (both seats); the classroom assistant bubble too (the personal
//     assistant is unboxed prose by design, DES-CGP-DS-22)
//   - the focus ring on a button and on the composer is 2px solid in Highlight (personal composer: the wrapper)
// Self-test: the same matrix is rerun with an injected later stylesheet (border: 0 !important on controls, the
// bubble and the composer, outline: none !important); each must be caught. Without a headless Chromium this
// prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('forced-colors-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('forced-colors-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = path.join(webview, 'src');
const temp = mkdtempSync(path.join(tmpdir(), 'hps-forced-computed-'));
await build({
  entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const THEMES = {
  dark: '--vscode-font-size:13px;--vscode-font-family:sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;',
  light: '--vscode-font-size:13px;--vscode-font-family:sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-button-background:#005fb8;--vscode-button-foreground:#ffffff;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = (surface) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true }, fileAttach: true, materials: true,
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface, workspace: '/synthetic', verified: true },
  ...(surface === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } }),
});
const MESSAGES = [
  { id: 'm1', role: 'user', content: '안녕하세요 도와주세요', createdAt: 1 },
  { id: 'm2', role: 'assistant', content: '네, 도와드릴게요.\n\n```js\nconst a = 1;\n```', createdAt: 2 },
];

const measure = `(() => {
  const sys = (n) => { const p = document.createElement('span'); p.style.color = n; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const C = { ButtonText: sys('ButtonText'), CanvasText: sys('CanvasText'), Highlight: sys('Highlight'), GrayText: sys('GrayText') };
  const shows = (e) => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return e.getClientRects().length > 0; };
  const sel = 'button, select, textarea, summary, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), [role=button], [role=menuitem], [role=menuitemcheckbox], [role=radio]';
  const edge = (s, x) => ({ w: parseFloat(s.getPropertyValue('border-' + x + '-width')), st: s.getPropertyValue('border-' + x + '-style'), c: s.getPropertyValue('border-' + x + '-color') });
  const out = { C, controls: [], bubbles: [], composer: null };
  for (const e of document.querySelectorAll(sel)) {
    if (!shows(e)) continue;
    const s = getComputedStyle(e);
    out.controls.push({ name: e.localName + '.' + String(e.className).split(' ')[0] + ':' + (e.getAttribute('aria-label') || e.textContent || '').slice(0, 16), disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true',
      inWrapper: e.localName === 'textarea' && !!e.closest('.hps-input'), edges: ['top', 'right', 'bottom', 'left'].map((x) => edge(s, x)) });
  }
  for (const e of document.querySelectorAll('.hps-msg-user .hps-msg-body, .hps-msg-assistant .hps-msg-body')) {
    if (!shows(e)) continue;
    out.bubbles.push({ who: e.closest('.hps-msg-user') ? 'user' : 'assistant', edges: ['top', 'right', 'bottom', 'left'].map((x) => edge(getComputedStyle(e), x)) });
  }
  const w = document.querySelector('.hps-input');
  if (w) out.composer = { edges: ['top', 'right', 'bottom', 'left'].map((x) => edge(getComputedStyle(w), x)) };
  return out; })()`;
const lines = (edges) => edges.every((e) => e.w >= 1 && e.st !== 'none' && e.st !== 'hidden');
const all = (edges, c) => edges.every((e) => e.c === c);

async function run(b, extraCss) {
  const bad = []; let seen = 0;
  for (const surface of ['personal', 'classroom']) for (const theme of ['dark', 'light']) for (const width of [1420, 800]) {
    const where = `${surface}/${theme}/${width}`;
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: theme }] });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.sent = [];
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
      document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEMES[theme])};
        document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-${theme}'); });` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(config(surface))} } }))`);
      await new Promise((r) => setTimeout(r, 300));
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'history', messages: ${JSON.stringify(MESSAGES)} } }))`);
      for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-msg-user')`)); i++) await new Promise((r) => setTimeout(r, 100));
      if (extraCss) await b.evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(extraCss)}; document.head.append(s); })()`);
      await new Promise((r) => setTimeout(r, 50));
      const m = await b.evaluate(measure);
      const { ButtonText, CanvasText, Highlight, GrayText } = m.C;
      assert.ok(new Set([ButtonText, CanvasText, Highlight, GrayText]).size >= 3, `${where}: forced colors is not active (system colours did not resolve)`);
      if (m.controls.length < 8) bad.push(`${where}: only ${m.controls.length} controls rendered; the matrix is not reading the app`);
      seen += m.controls.length;
      for (const c of m.controls) {
        if (c.inWrapper) continue; // the composer wrapper is the boundary; checked below
        const want = c.disabled ? [GrayText, ButtonText] : [ButtonText, Highlight]; // Highlight: the selected/current one
        if (!lines(c.edges) || !c.edges.every((e) => want.includes(e.c))) bad.push(`${where}: ${c.name} border ${JSON.stringify(c.edges[0])} is not 1px+ ${c.disabled ? 'GrayText' : 'ButtonText/Highlight'}`);
      }
      const users = m.bubbles.filter((x) => x.who === 'user'), assistants = m.bubbles.filter((x) => x.who === 'assistant');
      if (!users.length || !assistants.length) bad.push(`${where}: bubbles not rendered`);
      for (const x of users) if (!lines(x.edges) || !all(x.edges, CanvasText)) bad.push(`${where}: user bubble border ${JSON.stringify(x.edges[0])} is not CanvasText`);
      if (surface === 'classroom') for (const x of assistants) if (!lines(x.edges) || !all(x.edges, CanvasText)) bad.push(`${where}: classroom assistant bubble border ${JSON.stringify(x.edges[0])} is not CanvasText`);
      if (!m.composer || !lines(m.composer.edges) || !all(m.composer.edges, ButtonText)) bad.push(`${where}: composer boundary ${JSON.stringify(m.composer?.edges?.[0])} is not ButtonText`);
      const rings = [['a button', 'button:not([disabled])', []]];
      rings.push(surface === 'personal' ? ['the composer wrapper', '.hps-input', ['focus-within']] : ['the composer textarea', 'textarea', []]);
      for (const [name, selector, states] of rings) {
        const r = await b.focusVisibleStyle(selector, ['outline-width', 'outline-style', 'outline-color'], states, !states.length).catch((e) => ({ missing: e.message }));
        if (r.missing || !(parseFloat(r['outline-width']) >= 2 && r['outline-style'] === 'solid' && r['outline-color'] === Highlight)) bad.push(`${where}: focus ring on ${name} is ${JSON.stringify(r)}, not 2px solid Highlight (${Highlight})`);
      }
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
  return { bad, seen };
}

const b = await launch(bin);
try {
  const clean = await run(b, '');
  assert.deepEqual(clean.bad, [], `forced colors (computed):\n${clean.bad.join('\n')}`);
  // Negative controls: a later, more specific or !important rule must be caught by the computed matrix.
  const expectCaught = async (css, re, label) => {
    const r = await run(b, css);
    assert.ok(r.bad.some((p) => re.test(p)), `negative control not caught: ${label}\n${r.bad.slice(0, 5).join('\n')}`);
  };
  await expectCaught('@media (forced-colors: active) { button { border: 0 !important; } }', /border .* is not 1px\+/, 'a later border: 0 !important on buttons');
  await expectCaught('.hps-msg-user .hps-msg-body { border: 0 !important; }', /user bubble border/, 'the user bubble loses its outline');
  await expectCaught('.hps-input { border: 0 !important; }', /composer boundary/, 'the composer wrapper loses its boundary');
  await expectCaught(':focus-visible, .hps-input:focus-within, textarea:focus-visible { outline: none !important; }', /focus ring/, 'focus outline removed');
  await expectCaught('@media (forced-colors: active) { button { border-color: Canvas !important; } }', /is not 1px\+ ButtonText/, 'control border painted in the wrong system colour');
  console.log(`forced-colors computed smoke OK (${clean.seen} control measurements, 8 matrix cells, 5 negative controls)`);
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
