// CGP-CHAT-R-006: the answer-attempt pager measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/answer-attempts-computed.smoke.mjs
//
// The real webview entry (main.tsx, so the real stylesheet order and the real ChatPanel markup, with its own
// CSS imports) is bundled and receives a host config and a three-attempt history. Personal and classroom
// seat, dark and light, 1420 / 800 / 320 px. For the pager's two arrows and the "이걸 쓸래요" button:
//   - they render (display, visibility, opacity, a real box), whole inside the pager and the viewport,
//     never clipped by the pager or any ancestor that clips horizontally
//   - 44px targets (width and height), computed font-size at least 14px (also the "n/m" count)
//   - 2px solid focus ring, 2px outside or inset (the shared focus geometry insets it inside the scrolling chat), forced through the DevTools protocol (no synthetic input)
//   - the pager fits the chat column: measured against documentElement.clientWidth, no page scroll
//   - element.click() posts selectAnswerAttempt with the root, the attempt and the choose flag
//   - keyboard focus on a button shows the history note (data-hp-tooltip on the pager)
// Slipped past the declaration-only guard before: a later @media override, display:none, height+overflow,
// an override in chatDetails.css, and the CSS import removed from ChatPanel.tsx. HPS_WEBVIEW_SRC=<dir> measures
// another copy of webview-ui/src (it must sit next to a copy of ../../src), used to prove those are caught.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('answer-attempts-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('answer-attempts-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = process.env.HPS_WEBVIEW_SRC ? path.resolve(process.env.HPS_WEBVIEW_SRC) : path.join(webview, 'src');
const note = readFileSync(path.join(extension, 'src/answerAttempts.ts'), 'utf8').match(/ATTEMPT_HISTORY_NOTE = '([^']+)'/)?.[1];
assert.ok(note, 'ATTEMPT_HISTORY_NOTE found');

const temp = mkdtempSync(path.join(tmpdir(), 'hps-answer-attempts-'));
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
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface, workspace: '/synthetic', verified: true },
  ...(surface === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } }),
});
const history = [
  { id: 'u1', role: 'user', content: '질문입니다', createdAt: 1 }, { id: 'a1', role: 'assistant', content: '첫 번째 답변', createdAt: 2 },
  { id: 'u2', role: 'user', content: '질문입니다', createdAt: 3, retryOf: 'u1' }, { id: 'a2', role: 'assistant', content: '두 번째 답변', createdAt: 4 },
  { id: 'u3', role: 'user', content: '질문입니다', createdAt: 5, retryOf: 'u1' }, { id: 'a3', role: 'assistant', content: '세 번째 답변', createdAt: 6 },
];

const measure = `(() => {
  const vw = document.documentElement.clientWidth;
  const root = document.querySelector('.hps-answer-attempts');
  const out = { vw, docScroll: document.documentElement.scrollWidth, found: !!root };
  if (!root) return out;
  const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; };
  const shows = (e) => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.opacity === '0') return false; } return e.getClientRects().length > 0; };
  const pager = root.querySelector('.hps-version-pager');
  const controls = [['previous', pager.querySelectorAll('button')[0]], ['next', pager.querySelectorAll('button')[1]], ['choose', root.querySelector('.hps-attempt-choose')]];
  const count = pager.querySelector('span[aria-live]');
  const rb = box(root), cb = box(root.parentElement);
  out.root = { ...rb, shows: shows(root), fontSize: parseFloat(getComputedStyle(root).fontSize), scrollW: root.scrollWidth, clientW: root.clientWidth, parentRight: cb.right, parentLeft: cb.left };
  out.pager = { shows: shows(pager), fontSize: parseFloat(getComputedStyle(pager).fontSize), tooltip: pager.getAttribute('data-hp-tooltip') };
  out.count = count ? { text: count.textContent, shows: shows(count), fontSize: parseFloat(getComputedStyle(count).fontSize) } : null;
  out.controls = controls.map(([name, e]) => {
    if (!e) return { name, missing: true };
    e.scrollIntoView({ block: 'center', inline: 'nearest' });
    const b = box(e), s = getComputedStyle(e), clippedBy = [];
    for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ps = getComputedStyle(p), pb = box(p);
      const x = ps.overflowX !== 'visible', y = ps.overflowY !== 'visible' && (p === root || p === pager);
      if ((x && (b.left < pb.left - 0.5 || b.right > pb.right + 0.5)) || (y && (b.top < pb.top - 0.5 || b.bottom > pb.bottom + 0.5))) clippedBy.push(p.className || p.localName);
      if (ps.clipPath !== 'none') clippedBy.push((p.className || p.localName) + ' clip-path');
    }
    if (s.clipPath !== 'none') clippedBy.push('self clip-path');
    return { name, w: b.w, h: b.h, left: b.left, right: b.right, shows: shows(e), fontSize: parseFloat(s.fontSize), clippedBy,
      textCut: e.scrollWidth > e.clientWidth + 0.5, outsideViewport: b.left < -0.5 || b.right > vw + 0.5, text: e.textContent, disabled: e.disabled };
  });
  return out;
})()`;

const b = await launch(bin);
const results = [];
try {
  for (const surface of ['personal', 'classroom']) for (const theme of ['dark', 'light']) for (const width of [1420, 800, 320]) {
    const where = `${surface}/${theme}/${width}`;
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
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
      await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'history', messages: ${JSON.stringify(history)} } }))`);
      for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-answer-attempts .hps-attempt-choose')`)); i++) await new Promise((r) => setTimeout(r, 100));
      const m = await b.evaluate(measure);
      if (m.found) {
        const ring = {};
        for (const [name, selector] of [['arrow', '.hps-answer-attempts .hps-version-pager button'], ['choose', '.hps-answer-attempts .hps-attempt-choose']])
          ring[name] = await b.focusVisibleStyle(selector);
        m.ring = ring;
        // element.click() is a DOM call inside the page, not an OS event.
        await b.evaluate(`window.sent.length = 0; document.querySelector('.hps-answer-attempts .hps-version-pager button').click(); document.querySelector('.hps-answer-attempts .hps-attempt-choose').click()`);
        m.sent = await b.evaluate(`window.sent.filter((x) => x.type === 'selectAnswerAttempt')`);
        await b.evaluate(`document.querySelectorAll('.hps-answer-attempts .hps-version-pager button')[0].focus({ focusVisible: true })`);
        await new Promise((r) => setTimeout(r, 400));
        m.noteShown = await b.evaluate(`document.body.innerText.includes(${JSON.stringify(note)})`);
      }
      results.push({ where, surface, width, ...m });
      console.log(where, JSON.stringify({ found: m.found, controls: m.controls?.map((c) => `${c.name}=${Math.round(c.w)}x${Math.round(c.h)}@${c.fontSize}${c.clippedBy?.length ? 'C' : ''}`).join(' '), root: m.root && `${Math.round(m.root.w)}/${Math.round(m.vw)}` }));
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }

const failures = [];
const expect = (ok, msg) => { if (!ok) failures.push(msg); };
for (const r of results) {
  expect(r.found, `${r.where}: the attempt pager does not render`);
  if (!r.found) continue;
  expect(r.root.shows && r.pager.shows, `${r.where}: the pager is hidden (display / visibility / opacity)`);
  expect(r.docScroll <= r.vw + 0.5, `${r.where}: the page scrolls horizontally (${r.docScroll} > clientWidth ${r.vw})`);
  expect(r.root.left >= -0.5 && r.root.right <= r.vw + 0.5, `${r.where}: the pager leaves the viewport (${Math.round(r.root.left)}..${Math.round(r.root.right)} of ${r.vw})`);
  expect(r.root.right <= r.root.parentRight + 0.5 && r.root.left >= r.root.parentLeft - 0.5, `${r.where}: the pager is wider than its chat column`);
  expect(r.root.scrollW <= r.root.clientW + 0.5, `${r.where}: the pager's content overflows it (${r.root.scrollW} > ${r.root.clientW})`);
  expect(r.root.fontSize >= 14 && r.pager.fontSize >= 14, `${r.where}: pager text is ${r.root.fontSize}/${r.pager.fontSize}px, under 14px`);
  expect(r.count?.shows && r.count.fontSize >= 14 && /^\d+\/\d+$/.test(r.count.text), `${r.where}: the "n/m" count is missing, hidden or under 14px (${r.count?.fontSize}px)`);
  expect(r.pager.tooltip === note, `${r.where}: the pager does not carry the history note in data-hp-tooltip`);
  expect(r.noteShown === true, `${r.where}: focusing a pager button does not show the history note`);
  for (const c of r.controls) {
    expect(!c.missing, `${r.where}: ${c.name} control is missing`);
    if (c.missing) continue;
    expect(c.shows, `${r.where}: ${c.name} is not displayed`);
    expect(c.w >= 43.5 && c.h >= 43.5, `${r.where}: ${c.name} target is ${Math.round(c.w)}x${Math.round(c.h)}px, under 44`);
    expect(c.fontSize >= 14, `${r.where}: ${c.name} text is ${c.fontSize}px, under 14`);
    expect(c.clippedBy.length === 0, `${r.where}: ${c.name} is clipped by ${c.clippedBy.join(', ')}`);
    expect(!c.textCut && !c.outsideViewport, `${r.where}: ${c.name} is cut off or outside the viewport`);
  }
  for (const [name, ring] of Object.entries(r.ring ?? {})) {
    expect(ring['outline-style'] === 'solid' && parseFloat(ring['outline-width']) >= 2 && Math.abs(parseFloat(ring['outline-offset'])) >= 2, `${r.where}: ${name} focus ring is ${ring['outline-style']} ${ring['outline-width']} offset ${ring['outline-offset']}`);
  }
  expect(r.sent.length === 2 && r.sent[0].choose === false && r.sent[1].choose === true && r.sent.every((x) => x.rootId === 'u1' && /^u[123]$/.test(x.attemptId)) &&
    (r.surface === 'personal' ? r.sent.every((x) => x.taskId === 't1') : true), `${r.where}: clicks post ${JSON.stringify(r.sent)}`);
}
expect(results.length === 12, `ran ${results.length} of 12 combinations`);
if (failures.length) { console.error(failures.map((f) => '  FAIL ' + f).join('\n')); console.error(`answer-attempts-computed: ${failures.length} failed`); process.exit(1); }
console.log('PASS answer attempts computed geometry: pager and "이걸 쓸래요" are rendered whole, 44px targets, 14px text, 2px focus ring, inside the chat column, history note on focus (personal, classroom x dark, light x 1420, 800, 320)');
