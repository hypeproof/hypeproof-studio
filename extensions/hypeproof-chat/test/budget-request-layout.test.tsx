// CGP-SHELL-D-029: the low-allowance request-more form measured on the CASCADE in headless Chromium.
//   node scripts/run-tsx-tests.mjs budget-request-layout
//
// The real webview entry (main.tsx: real stylesheet order, real AccessControl) receives a host config whose
// selected funding choice is nearly spent and may be requested. Personal and classroom seat, dark and light,
// 1420 / 800 / 320 px. For the reason input, the counter and the send button:
//   - the form sits inside the usage panel (.hps-access) and the page never scrolls horizontally
//   - input and button are at least 44px high, the button at least 44px wide
//   - the counter is at least 14px, its own block under the input, with a gap before the button
//   - the shared 2px solid focus ring on input and button
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const THEMES: Record<string, string> = {
  dark: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;',
  light: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = (surface: string) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface, workspace: '/synthetic', verified: true },
  ...(surface === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } }),
});
const choice = { id: 'class-1', label: '수업', source_kind: 'cohort', mode: 'included', active: true, available: true, state: 'ready', ends_at: 1893456000000, can_request: true,
  allowed: { models: [], efforts: [], features: [], runtimes: [] }, resources: [{ meter: 'requests:count', limit: 100, remaining: 5, held: 0, spent: 95, unresolved: 0, overrun: 0, shared: true }] };
const withAccess = (c: any) => ({ ...c, access: { status: 'ready', selected: 'class-1', view: { schema: 'hps-access-view/1', configured: true, as_of: '2026-10-24T00:00:00Z', choices: [choice] } } });

const measure = `(() => {
  const vw = document.documentElement.clientWidth;
  const panel = document.querySelector('.hps-access');
  const out = { vw, docScroll: document.documentElement.scrollWidth, found: !!panel };
  if (!panel) return out;
  panel.open = true;
  const input = panel.querySelector('.hps-budget-request-notice input'), counter = panel.querySelector('.hps-budget-request-notice small'), button = panel.querySelector('.hps-budget-request-notice form button');
  out.found = !!(input && counter && button);
  if (!out.found) return out;
  const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; };
  out.panel = box(panel); out.input = box(input); out.counter = box(counter); out.button = box(button);
  out.counterFont = parseFloat(getComputedStyle(counter).fontSize); out.counterDisplay = getComputedStyle(counter).display;
  out.inputFont = parseFloat(getComputedStyle(input).fontSize);
  return out;
})()`;

async function main() {
  const bin = findChromium();
  if (!bin) {
    if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw new Error('budget-request-layout: no headless Chromium and FOCUS_REQUIRE_BROWSER=1');
    console.log('budget-request-layout NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
    return;
  }
  const extension = process.cwd();
  const require = createRequire(path.join(extension, 'package.json'));
  const { build } = require('esbuild');
  const webview = path.join(extension, 'webview-ui');
  const temp = mkdtempSync(path.join(tmpdir(), 'hps-budget-request-layout-'));
  const pngs = path.join(homedir(), '.hypeproof/loop/cgp-shelld029-fix');
  mkdirSync(pngs, { recursive: true });
  await build({
    entryPoints: [path.join(webview, 'src/main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
    nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
    loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
  });
  const server = createServer((req, res) => {
    const u = (req.url ?? '').split('?')[0];
    if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/`;
  const b: any = await launch(bin);
  const results: any[] = [];
  const RING = ['.hps-budget-request-notice input', '.hps-budget-request-notice form button'];
  try {
    for (const surface of ['personal', 'classroom']) for (const theme of ['dark', 'light']) for (const width of [1420, 800, 320]) {
      const where = `${surface}/${theme}/${width}`;
      await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.sent = [];
        window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
        document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEMES[theme])};
          document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-${theme}'); });` });
      try {
        await b.send('Page.navigate', { url: base });
        for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
        await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(withAccess(config(surface)))} } }))`);
        // Personal chat keeps the usage panel in the settings dialog behind the header chip; classroom renders it inline.
        for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-access, .hps-access-chip')`)); i++) await new Promise((r) => setTimeout(r, 100));
        if (surface === 'personal') { await b.evaluate(`document.querySelector('.hps-access-chip')?.click()`); for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-access')`)); i++) await new Promise((r) => setTimeout(r, 100)); }
        await b.evaluate(`(() => { const d = document.querySelector('.hps-access'); if (d) d.open = true; })()`);
        await new Promise((r) => setTimeout(r, 100));
        const m = await b.evaluate(measure);
        if (m.found) {
          m.ring = {};
          for (const selector of RING) m.ring[selector] = await b.focusVisibleStyle(selector);
          await b.evaluate(`document.querySelector('.hps-budget-request-notice').scrollIntoView({ block: 'center' })`);
          if (width !== 320) {
            const shot = await b.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(path.join(pngs, `budget-form-${surface}-${width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
          }
        }
        results.push({ where, ...m });
        console.log(where, JSON.stringify({ found: m.found, input: m.input && `${Math.round(m.input.w)}x${Math.round(m.input.h)}`, inputRight: m.input && Math.round(m.input.right), panelRight: m.panel && Math.round(m.panel.right), counter: m.counterFont }));
      } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
    }
  } finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }

  const failures: string[] = [];
  const expect = (ok: unknown, msg: string) => { if (!ok) failures.push(msg); };
  for (const r of results) {
    expect(r.found, `${r.where}: the request form does not render`);
    if (!r.found) continue;
    expect(r.docScroll <= r.vw + 0.5, `${r.where}: the page scrolls horizontally (${r.docScroll} > clientWidth ${r.vw})`);
    for (const k of ['input', 'counter', 'button']) {
      expect(r[k].left >= r.panel.left - 0.5 && r[k].right <= r.panel.right + 0.5, `${r.where}: the ${k} leaves the panel (${Math.round(r[k].left)}..${Math.round(r[k].right)} of ${Math.round(r.panel.left)}..${Math.round(r.panel.right)})`);
      expect(r[k].right <= r.vw + 0.5, `${r.where}: the ${k} leaves the viewport (right ${Math.round(r[k].right)} of ${r.vw})`);
    }
    expect(r.input.h >= 43.5, `${r.where}: the reason input is ${Math.round(r.input.h)}px high, under 44`);
    expect(r.button.h >= 43.5 && r.button.w >= 43.5, `${r.where}: the button is ${Math.round(r.button.w)}x${Math.round(r.button.h)}px, under 44`);
    expect(r.counterFont >= 14, `${r.where}: the counter text is ${r.counterFont}px, under 14`);
    expect(r.inputFont >= 14, `${r.where}: the input text is ${r.inputFont}px, under 14`);
    expect(r.counterDisplay === 'block' && r.counter.top >= r.input.bottom - 0.5, `${r.where}: the counter is not a block under the input`);
    expect(r.button.top - r.counter.bottom >= 4, `${r.where}: only ${Math.round(r.button.top - r.counter.bottom)}px between the counter and the button`);
    for (const [selector, ring] of Object.entries<any>(r.ring)) {
      expect(ring['outline-style'] === 'solid' && ring['outline-width'] === '2px' && Math.abs(parseFloat(ring['outline-offset'])) === 2 && !/rgba\(0, 0, 0, 0\)/.test(ring['outline-color']),
        `${r.where}: ${selector} focus ring is ${ring['outline-style']} ${ring['outline-width']} ${ring['outline-color']} offset ${ring['outline-offset']}`);
    }
  }
  assert.equal(results.length, 12, 'every combination ran');
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('PASS budget request layout computed: input inside the panel, 44px input and button, 14px counter block, 2px ring (personal, classroom x dark, light x 1420, 800, 320)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
