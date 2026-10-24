// REQ-L13 ⑧ (CGP-SHELL-R-022, DES-SHELL-21): the sign-in 링크 복사 measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/signin-copy-link-computed.smoke.mjs
// The real AccountEntry markup is mounted with the same stylesheet order as main.tsx (tokens, focus geometry,
// start.css, styles.css, chatDetails.css, koreanProse.css). Dark and light, 1420 / 800 / 320 px, forced colors.
// Measured: the button's box is at least 44px high and shows, text is at least 14px (button, hint, status, link),
// nothing is cut or leaves the viewport, the page does not scroll sideways, the focus ring is 2px solid,
// forced colors draw a real border, and a click posts accountCopyLink only.
// Slipped past the declaration-only test before: a later @media override, display:none, a smaller min-height elsewhere.
// HPS_WEBVIEW_SRC=<dir> measures another copy of webview-ui/src (next to a copy of ../../src), to prove mutations.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('signin-copy-link-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('signin-copy-link-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = process.env.HPS_WEBVIEW_SRC ? path.resolve(process.env.HPS_WEBVIEW_SRC) : path.join(webview, 'src');
const temp = mkdtempSync(path.join(tmpdir(), 'hps-signin-copy-'));
const LINK = 'https://hypeproof-ai.xyz/studio/connect?code=HPDX-4K7Q-WITH-A-LONG-TAIL-THAT-MUST-WRAP-INSIDE-THE-CARD';
const entry = `
import "./tokens.css"; import "./focusGeometry.css"; import "./start.css"; import "./styles.css"; import "./chatDetails.css"; import "./koreanProse.css";
import { createRoot } from "react-dom/client";
import { AccountEntry } from "./AccountEntry";
const sent = (window.sent = []);
const base = { status: "waiting", userCode: "HPDX-4K7Q", expiresAt: 0, message: "" };
const views = { ready: { ...base, link: "ready" }, copied: { ...base, link: "copied" }, failed: { ...base, link: "failed", linkText: ${JSON.stringify(LINK)} } };
window.mount = (name) => { createRoot(document.getElementById("root")).render(<main style={{ padding: 16, boxSizing: "border-box" }}><AccountEntry account={views[name]} checking={false} post={(m) => sent.push(m)} /></main>); };
`;
await build({
  stdin: { contents: entry, resolveDir: src, sourcefile: 'entry.tsx', loader: 'tsx' }, bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
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
const measure = `(() => {
  const vw = document.documentElement.clientWidth;
  const shows = (e) => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || parseFloat(s.opacity) === 0) return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const one = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { sel, w: r.width, h: r.height, left: r.left, right: r.right, shows: shows(e), fontSize: parseFloat(s.fontSize), cut: e.scrollWidth > e.clientWidth + 0.5, borderW: parseFloat(s.borderTopWidth), borderStyle: s.borderTopStyle, borderColor: s.borderTopColor, text: e.textContent }; };
  return { vw, docScroll: document.documentElement.scrollWidth, button: one('.studio-signin-copy'), hint: one('.studio-signin-copy-hint'), status: one('.studio-signin-copy-status'), link: one('.studio-signin-copy-link'), reopen: one('.studio-account .studio-choice') };
})()`;
const results = [];
const b = await launch(bin);
try {
  for (const theme of ['dark', 'light']) for (const forced of [false, true]) for (const width of [1420, 800, 320]) for (const view of ['ready', 'copied', 'failed']) {
    if (forced && (theme === 'light' || width !== 800)) continue;
    const where = `${view}/${theme}${forced ? '/forced-colors' : ''}/${width}`;
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forced ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: theme }] });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEMES[theme])};
        document.documentElement.setAttribute('style', v); document.documentElement.dataset.surface = 'start';
        document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-${theme}'); });` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !(await b.evaluate(`typeof window.mount === 'function'`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`window.mount(${JSON.stringify(view)})`);
      for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.studio-signin-copy')`)); i++) await new Promise((r) => setTimeout(r, 100));
      const m = await b.evaluate(measure);
      if (m.button) {
        m.ring = await b.focusVisibleStyle('.studio-signin-copy');
        // element.click() is a DOM call inside the page, not an OS event.
        await b.evaluate(`window.sent.length = 0; document.querySelector('.studio-signin-copy').click()`);
        m.sent = await b.evaluate(`window.sent`);
      }
      results.push({ where, view, forced, width, ...m });
      console.log(where, JSON.stringify({ button: m.button && `${Math.round(m.button.w)}x${Math.round(m.button.h)}@${m.button.fontSize}`, doc: `${m.docScroll}/${m.vw}` }));
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }

const failures = [];
const expect = (ok, msg) => { if (!ok) failures.push(msg); };
for (const r of results) {
  expect(r.button, `${r.where}: 링크 복사 does not render`);
  if (!r.button) continue;
  expect(r.button.shows, `${r.where}: the button is hidden (display / visibility / opacity)`);
  expect(r.button.h >= 43.5, `${r.where}: button is ${r.button.h}px high, needs 44`);
  expect(r.button.w >= 43.5, `${r.where}: button is ${r.button.w}px wide, needs 44`);
  expect(r.button.fontSize >= 14, `${r.where}: button text is ${r.button.fontSize}px, needs 14`);
  expect(r.button.left >= -0.5 && r.button.right <= r.vw + 0.5, `${r.where}: the button leaves the viewport`);
  expect(!r.button.cut, `${r.where}: the button label is cut`);
  expect(r.docScroll <= r.vw + 0.5, `${r.where}: the page scrolls sideways (${r.docScroll} > ${r.vw})`);
  expect(r.hint?.shows && r.hint.fontSize >= 14, `${r.where}: the sharing warning is hidden or under 14px`);
  expect(r.hint && r.hint.right <= r.vw + 0.5, `${r.where}: the sharing warning leaves the viewport`);
  expect(r.button.borderStyle === 'solid' && r.button.borderW >= 1, `${r.where}: the button has no real border (${r.button.borderW} ${r.button.borderStyle})`);
  if (r.forced) expect(r.button.borderColor !== 'rgba(0, 0, 0, 0)' && r.button.borderColor !== 'transparent', `${r.where}: forced colors draw a transparent border`);
  expect(r.ring['outline-style'] === 'solid' && parseFloat(r.ring['outline-width']) >= 2, `${r.where}: focus ring is ${r.ring['outline-width']} ${r.ring['outline-style']}, needs 2px solid`);
  expect(r.sent.length === 1 && r.sent[0].type === 'accountCopyLink' && Object.keys(r.sent[0]).length === 1, `${r.where}: the press must post only { type: 'accountCopyLink' }, got ${JSON.stringify(r.sent)}`);
  if (r.view === 'copied') expect(r.status?.shows && r.status.text.includes('복사했어요') && r.status.fontSize >= 14, `${r.where}: the confirmation is missing, hidden or under 14px`);
  if (r.view === 'failed') {
    expect(r.link?.text === LINK, `${r.where}: the fallback link text is not the full link`);
    expect(r.link?.shows && r.link.fontSize >= 14, `${r.where}: the fallback link is missing, hidden or under 14px`);
    expect(r.link && r.link.left >= -0.5 && r.link.right <= r.vw + 0.5, `${r.where}: the fallback link leaves the viewport`);
    expect(r.link && !r.link.cut, `${r.where}: the fallback link runs past its box instead of wrapping`);
    expect(r.status?.shows && r.status.fontSize >= 14, `${r.where}: the failure line is hidden or under 14px`);
  }
  if (r.view === 'ready') expect(!r.status?.text, `${r.where}: a result is shown before the press`);
}
if (failures.length) { console.error(`signin-copy-link-computed: ${failures.length} failure(s)`); for (const f of failures) console.error('  FAIL ' + f); process.exit(1); }
console.log(`signin-copy-link-computed ok: ${results.length} states measured`);
