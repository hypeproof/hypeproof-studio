// CGP-KNOW-D-020 / DES-KNOW-37 — a refused photo's error renders inside its chip, in the real webview CSS.
// The actual ChatPanel with tokens.css, styles.css and chatDetails.css (the set main.tsx imports), in headless
// Chromium, on the personal surface (task workspace, no lesson) and the classroom surface (lesson fixture),
// dark and light, at 1420 and 800 px (and dark at 380 px). For a refused photo:
//   G1  the chip holds its whole failure block: cause badge, reason and retry are inside the chip and visible
//   G2  no focusable control inside a chip is clipped or hidden (a hidden control must never take keyboard focus)
//   G3  exactly one live region that is not aria-hidden carries the reason (no double announcement)
// HPS_SHOT_DIR=<dir> also saves one screenshot per surface/theme/width.
// Run: node e2e/attachment-error-geometry.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatPanelProps } from '../extensions/hypeproof-chat/test/sx-screen-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(root, 'extensions/hypeproof-chat/webview-ui');
const shots = process.env.HPS_SHOT_DIR;
if (shots) await mkdir(shots, { recursive: true });
const fixtures = {};
for (const surface of ['personal', 'classroom']) {
  const f = chatPanelProps(); f.config.profile.input = { image_files: true }; f.config.profile.classroom_panels = { help_request: false, artifact_approval: false };
  if (surface === 'personal') {
    f.config.activity = { id: 'p1', name: '내 작업', kind: 'personal', workspace: '/w', verified: true }; f.config.profile.lesson = null;
    f.config.taskWorkspace = { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
  }
  fixtures[surface] = f;
}
const temp = await mkdtemp(path.join(os.tmpdir(), 'hps-attachment-geometry-'));
await build({
  stdin: { contents: `import './src/tokens.css';import './src/styles.css';import './src/chatDetails.css';import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel.tsx';const all=${JSON.stringify(fixtures)};const props=all[new URLSearchParams(location.search).get('s')];props.onSend=()=>{};createRoot(document.getElementById('root')).render(<ChatPanel {...props}/>);`, resolveDir: webview, loader: 'tsx' },
  bundle: true, loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
});
const server = createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(await readFile(path.join(temp, u))); return; }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const THEMES = {
  dark: '--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-inputValidation-errorBorder:#be1100;--vscode-input-background:#313131;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;',
  light: '--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-inputValidation-errorBorder:#be1100;--vscode-input-background:#ffffff;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;',
};
const REASON = '사진을 보관하지 못했어요. 권한을 확인한 뒤 다시 시도해 주세요.';
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  // 380 px (dark only) also checks that the grown chip stays inside a narrow column.
  const RUNS = ['personal', 'classroom'].flatMap(surface => [...Object.keys(THEMES).flatMap(theme => [1420, 800].map(width => [surface, theme, width])), [surface, 'dark', 380]]);
  for (const [surface, theme, width] of RUNS) { const vars = THEMES[theme];
    const where = `${surface}/${theme}/${width}`;
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const page = await ctx.newPage();
    await page.addInitScript(({ vars, theme }) => {
      window.acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => undefined, setState: () => {} });
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.setAttribute('style', vars); document.body.setAttribute('style', vars + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-' + theme); });
    }, { vars, theme });
    await page.goto(base + '?s=' + surface);
    await page.locator('.hps-input textarea').waitFor();
    await page.locator('.hps-input textarea').fill('작성 중인 질문은 그대로');
    const post = d => page.evaluate(d => window.dispatchEvent(new MessageEvent('message', { data: d })), d);
    await post({ type: 'imageStagedByHost', stageId: 'ph', name: '사진.png' });
    await post({ type: 'imageStageRefused', stageId: 'ph', reason: REASON });
    await page.locator('.hps-photo-failure').waitFor();
    await page.waitForTimeout(100);
    const m = await page.evaluate(REASON => {
      const failure = document.querySelector('.hps-photo-failure'), chip = failure.closest('.hps-attachment');
      const box = e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; };
      // Every ancestor that clips (overflow other than visible), up to the shell.
      const clippers = el => { const out = []; for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflowX !== 'visible' || s.overflowY !== 'visible') out.push(p); } return out; };
      const inside = (a, b) => a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5 && a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
      const shown = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 && clippers(el).every(c => inside(box(el), box(c))); };
      const parts = { badge: failure.querySelector('[data-testid=attachment-failure-cause]'), reason: failure.querySelector('p'), retry: failure.querySelector('button') };
      const focusables = [...chip.querySelectorAll('button, a[href], input, textarea, select, [tabindex]')].filter(e => !e.disabled && e.getAttribute('tabindex') !== '-1');
      const live = [...document.querySelectorAll('[aria-live], [role=status], [role=alert]')]
        .filter(e => e.textContent.includes(REASON) && !e.closest('[aria-hidden=true]'))
        .map(e => e.getAttribute('data-testid') || e.className);
      return {
        shell: document.querySelector('.hps-shell')?.getAttribute('data-chat-detail') ?? null,
        chip: box(chip), failure: box(failure),
        parts: Object.fromEntries(Object.entries(parts).map(([k, e]) => [k, e ? { shown: shown(e), inChip: inside(box(e), box(chip)) } : null])),
        focusables: focusables.map(e => ({ text: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24), shown: shown(e) })),
        column: box(chip.closest('.hps-input-area') ?? document.querySelector('footer')),
        live, hscroll: document.documentElement.scrollWidth > innerWidth,
      };
    }, REASON);
    results.push({ where, ...m });
    if (shots && width !== 380) await page.screenshot({ path: path.join(shots, `fix1-${surface}-${theme}-${width}.png`) });
    await ctx.close();
    console.log(where, JSON.stringify({ shell: m.shell, chipH: Math.round(m.chip.h), failureH: Math.round(m.failure.h), parts: m.parts, focusables: m.focusables, live: m.live }));
  }
} finally { await browser.close(); server.close(); await rm(temp, { recursive: true, force: true }); }

for (const r of results) {
  assert.equal(r.shell === 'personal', r.where.startsWith('personal'), `${r.where}: fixture reached the intended surface`);
  for (const [name, part] of Object.entries(r.parts)) { assert.ok(part, `${r.where}: ${name} rendered`); assert.ok(part.inChip && part.shown, `${r.where}: ${name} visible inside its chip`); }
  assert.ok(r.failure.top >= r.chip.top - 0.5 && r.failure.bottom <= r.chip.bottom + 0.5, `${r.where}: the chip holds its failure block`);
  assert.ok(r.chip.left >= r.column.left - 0.5 && r.chip.right <= r.column.right + 0.5, `${r.where}: the chip stays inside the composer column`);
  assert.ok(r.focusables.length >= 2, `${r.where}: retry and remove are focusable`);
  for (const f of r.focusables) assert.ok(f.shown, `${r.where}: focusable "${f.text}" is visible, not clipped`);
  assert.deepEqual(r.live, ['attachment-error-summary'], `${r.where}: exactly one live region announces the refused photo`);
  assert.equal(r.hscroll, false, `${r.where}: no page horizontal scroll`);
}
console.log('PASS attachment error geometry: photo chip holds badge, reason and retry; no clipped focusable; one announcement (personal, classroom × dark, light × 1420, 800; dark 380)');
