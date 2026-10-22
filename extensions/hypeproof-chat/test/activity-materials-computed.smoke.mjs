// CGP-KNOW-R-003 (REQ-STUDIO-ACTIVITY-MATERIALS): the 자료 card and the "함께 보낼 자료" line measured on the
// CASCADE in headless Chromium.
//   node --experimental-strip-types test/activity-materials-computed.smoke.mjs
//
// The real webview entry (main.tsx: the real stylesheet order and the real ChatPanel markup) is bundled, gets a
// host config with the `materials` flag and a 자료 list (a 190-character unbroken file name, an address, an
// instructor card, two selected items and one selected item that is gone). Personal and classroom seat, dark
// and light, 1420 and 800 px. On the open card and the composer line:
//   - every button, input and the card's summary is a 44px target (width and height of its real box)
//   - every element that draws text has a computed font-size of at least 14px
//   - nothing is wider than its card or the viewport (measured against documentElement.clientWidth); no page scroll
//   - the focus ring, forced through the DevTools protocol (no synthetic input), is 2px solid in the ring colour at
//     the offset the shared focus geometry gives that control (CGP-DS-D-014: -2px inside the coach rail's scroll
//     scope, +2px outside one), never a ring of this row's own
// Self-test: the same matrix is rerun with an injected later stylesheet (a more specific rule, an @media rule,
// `outline: none !important`); each must be caught. Without a headless Chromium this prints NOT RUN;
// FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('activity-materials-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('activity-materials-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = path.join(webview, 'src');

const temp = mkdtempSync(path.join(tmpdir(), 'hps-materials-computed-'));
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
  dark: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;',
  light: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = (surface) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true }, fileAttach: true, materials: true,
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface, workspace: '/synthetic', verified: true },
  ...(surface === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } }),
});
const LONG = '가'.repeat(95) + 'a'.repeat(91) + '.md'; // 189 characters, no break opportunity but anywhere
const row = (over) => ({ kind: 'file', detail: '', selected: false, removable: true, origin: 'learner', originLabel: '나', ...over });
const VIEW = {
  scope: '["a1","t1"]', maxSelected: 3,
  items: [
    row({ id: 'inbox:obj-12345678:1', kind: 'note', title: '강사 읽기 자료', detail: '강사가 보낸 글', origin: 'instructor', originLabel: '강사', removable: false, selected: true }),
    row({ id: 'me:aaaaaaaaaaaa', title: LONG, detail: `자료/${LONG}`, selected: true }),
    row({ id: 'me:bbbbbbbbbbbb', kind: 'url', title: 'example.com', detail: 'https://example.com/' + 'b'.repeat(120) }),
    row({ id: 'ai:자료/요약.md', title: '요약.md', detail: '자료/요약.md', origin: 'ai', originLabel: 'AI' }),
  ],
  unavailable: [{ id: 'me:cccccccccccc', title: '지운 계획.md', reason: '찾을 수 없어요. 지워졌거나 이름이 바뀌었어요.' }],
};

const ROOTS = ['.hp-materials', '.hp-materials-chips'];
const measure = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = { vw, docScroll: document.documentElement.scrollWidth, roots: {}, controls: [], texts: [], overflow: [] };
  const shows = (e) => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return e.getClientRects().length > 0; };
  for (const sel of ${JSON.stringify(ROOTS)}) {
    const root = document.querySelector(sel);
    out.roots[sel] = !!root && shows(root);
    if (!root) continue;
    root.scrollIntoView({ block: 'center' });
    const rb = root.getBoundingClientRect();
    if (root.scrollWidth > root.clientWidth + 0.5) out.overflow.push(sel + ' scrollWidth ' + root.scrollWidth + ' > ' + root.clientWidth);
    if (rb.right > vw + 0.5 || rb.left < -0.5) out.overflow.push(sel + ' outside the viewport ' + Math.round(rb.left) + '..' + Math.round(rb.right) + ' of ' + vw);
    for (const e of root.querySelectorAll('*')) {
      if (!shows(e)) continue;
      const b = e.getBoundingClientRect(), s = getComputedStyle(e);
      if (b.right > Math.min(rb.right, vw) + 0.5 || b.left < rb.left - 0.5) out.overflow.push(sel + ' ' + e.localName + '.' + e.className + ' ' + Math.round(b.left) + '..' + Math.round(b.right) + ' outside ' + Math.round(rb.left) + '..' + Math.round(rb.right));
      if (['button', 'input', 'summary'].includes(e.localName)) out.controls.push({ sel, name: e.localName + ':' + (e.getAttribute('aria-label') || e.textContent).slice(0, 40), w: b.width, h: b.height });
      if ([...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) || e.localName === 'input') out.texts.push({ sel, name: e.localName + '.' + e.className + ':' + e.textContent.slice(0, 20), size: parseFloat(s.fontSize) });
    }
  }
  const probe = document.createElement('span'); probe.style.color = 'var(--hp-ring-focus-default)'; document.body.append(probe);
  out.ringColor = getComputedStyle(probe).color; probe.remove();
  return out;
})()`;
const FOCUS = [
  ['rail select', '.hp-materials .hp-materials-actions button', true],
  ['rail add file', '.hp-materials [data-material-add-file]', true],
  ['rail address', '.hp-materials-url input', true],
  ['chip take out', '.hp-materials-chips button', false],
];

async function runMatrix(b, extraCss) {
  const results = [];
  for (const surface of ['personal', 'classroom']) for (const theme of ['dark', 'light']) for (const width of [1420, 800]) {
    const where = `${surface}/${theme}/${width}`;
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-color-scheme', value: theme }] });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.sent = [];
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
      document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEMES[theme])};
        document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-${theme}'); });` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(config(surface))} } }))`);
      for (let i = 0; i < 50 && !(await b.evaluate(`window.sent.some((m) => m.type === 'materialsRequest')`)); i++) await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'materialsState', view: ${JSON.stringify(VIEW)} } }))`);
      for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hp-materials') && !!document.querySelector('.hp-materials-chips')`)); i++) await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`(() => { const d = document.querySelector('.hp-materials'); if (d) d.open = true;
        ${extraCss ? `const s = document.createElement('style'); s.textContent = ${JSON.stringify(extraCss)}; document.head.append(s);` : ''} })()`);
      await new Promise((r) => setTimeout(r, 50));
      const m = await b.evaluate(measure);
      m.ring = {};
      for (const [name, selector] of FOCUS) {
        try { m.ring[name] = await b.focusVisibleStyle(selector, ['outline-width', 'outline-style', 'outline-color', 'outline-offset', '--hp-focus-offset', '--ds-c-focus-offset', '--ds-c-focus-inset']); }
        catch (e) { m.ring[name] = { missing: String(e.message) }; }
      }
      results.push({ where, ...m });
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
  return results;
}

function check(results) {
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push(msg); };
  for (const r of results) {
    for (const sel of ROOTS) expect(r.roots[sel], `${r.where}: ${sel} does not render`);
    expect(r.docScroll <= r.vw + 0.5, `${r.where}: the page scrolls horizontally (${r.docScroll} > clientWidth ${r.vw})`);
    for (const o of r.overflow) expect(false, `${r.where}: ${o}`);
    expect(r.controls.length >= 10, `${r.where}: only ${r.controls.length} controls measured`);
    for (const c of r.controls) expect(c.w >= 43.5 && c.h >= 43.5, `${r.where}: ${c.name} target is ${Math.round(c.w)}x${Math.round(c.h)}px, under 44`);
    expect(r.texts.length >= 10, `${r.where}: only ${r.texts.length} text elements measured`);
    for (const t of r.texts) expect(t.size >= 14, `${r.where}: ${t.name} text is ${t.size}px, under 14`);
    for (const [name, , inRail] of FOCUS) {
      const ring = r.ring[name];
      if (ring.missing) { expect(false, `${r.where}: ${name}: ${ring.missing}`); continue; }
      // The shared geometry decides where the ring sits: the inherited --hp-focus-offset, else the default offset.
      const want = parseFloat((ring['--hp-focus-offset'] || '').trim() || ring['--ds-c-focus-offset']);
      expect(ring['outline-style'] === 'solid' && ring['outline-width'] === '2px', `${r.where}: ${name} focus ring is ${ring['outline-style']} ${ring['outline-width']}`);
      expect(ring['outline-color'] === r.ringColor, `${r.where}: ${name} focus ring colour ${ring['outline-color']} is not the ring token ${r.ringColor}`);
      expect(parseFloat(ring['outline-offset']) === want, `${r.where}: ${name} ring offset ${ring['outline-offset']} is not the shared geometry's ${want}px`);
      if (inRail) expect(parseFloat(ring['outline-offset']) === parseFloat(ring['--ds-c-focus-inset']) && want < 0, `${r.where}: ${name} sits in the rail's scroll scope, so its ring is inset (got ${ring['outline-offset']})`);
    }
  }
  expect(results.length === 8, `ran ${results.length} of 8 combinations`);
  return failures;
}

// Each must break a check: a more specific later rule, an @media rule, a ring removed.
const MUTANTS = {
  'a more specific rule shrinks the targets and text': '.hp-materials .hp-cta-quiet, .hp-materials-chips .hp-cta-quiet { min-height: 24px !important; min-width: 24px !important; height: 24px !important; padding: 0 !important; font-size: 11px !important; }',
  'an @media rule shrinks the input and the meta text': '@media (max-width: 2000px) { .hp-materials button, .hp-materials input, .hp-materials-url input { min-height: 20px !important; height: 20px !important; padding: 0 !important; } .hp-materials-meta { font-size: 10px !important; } }',
  'outline: none !important removes the ring': 'html body .hp-materials button:focus-visible, html body .hp-materials-chips button:focus-visible { outline: none !important; }',
  'a title that stops wrapping overflows the card': '.hp-materials-title, .hp-materials-chip span { white-space: nowrap !important; overflow-wrap: normal !important; word-break: normal !important; }',
};

const b = await launch(bin);
let failures = [];
try {
  const results = await runMatrix(b, '');
  for (const r of results) console.log(r.where, JSON.stringify({ controls: r.controls.length, minTarget: Math.round(Math.min(...r.controls.map((c) => Math.min(c.w, c.h)))), minText: Math.min(...r.texts.map((t) => t.size)),
    rings: Object.fromEntries(Object.entries(r.ring).map(([k, v]) => [k, `${v['outline-style']} ${v['outline-width']} ${v['outline-offset']}`])) }));
  failures = check(results);
  for (const [label, css] of Object.entries(MUTANTS)) {
    const caught = check(await runMatrix(b, css));
    if (caught.length === 0) failures.push(`self-test: "${label}" was not caught`);
    else console.log(`  self-test caught: ${label} (${caught.length}: ${caught[0]})`);
  }
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
assert.ok(Array.isArray(failures));
if (failures.length) { console.error(failures.map((f) => '  FAIL ' + f).join('\n')); console.error(`activity-materials-computed: ${failures.length} failed`); process.exit(1); }
console.log('PASS activity materials computed: 44px targets, 14px text, wrapping inside the card and the viewport, the shared 2px focus ring (inset in the rail), personal and classroom x dark and light x 1420 and 800; four injected overrides caught');
