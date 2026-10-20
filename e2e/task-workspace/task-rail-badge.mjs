// Real layout of the task rail in headless Chromium (CGP-AGENT-D-019).
// Bundles the real TaskWorkspace + tokens.css + styles.css; no host, Service or model is involved.
// Fails when the run-state badge starves the task title in the fixed 204px rail.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../extensions/hypeproof-chat/webview-ui');
const bundle = await build({
  stdin: {
    resolveDir: root, sourcefile: 'task-rail-entry.tsx', loader: 'tsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import './src/tokens.css';
      import './src/styles.css';
      import { TaskWorkspace } from './src/TaskWorkspace';
      (window as any).acquireVsCodeApi = () => ({ postMessage() {}, getState() {}, setState() {} });
      const q = new URLSearchParams(location.search);
      const t = (id: string, title: string, n: number) => ({ id, title, createdAt: 1760000000000, updatedAt: 1760000000000 + n, messageCount: n });
      const state = q.get('state') as any;
      const view: any = { scope: 's', revision: 1, activeTaskId: 'a', sourceSelection: null, tasks: [
        t('a', q.get('title') || '발표 자료 만들기', 12), t('b', '다른 작업', 2) ] };
      createRoot(document.getElementById('root')!).render(<TaskWorkspace view={view} messages={[]} busy={['preparing','running','approval'].includes(state)} error={null} runState={state} onDismissError={() => {}}><p>대화 영역</p></TaskWorkspace>);
    `,
  },
  bundle: true, write: false, outdir: 'out', format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
});
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? '';
const theme = ':root{--vscode-sideBar-background:#252526;--vscode-editor-background:#1e1e1e;--vscode-panel-border:#80808059;--vscode-descriptionForeground:#ccccccb3;--vscode-foreground:#ccc;--vscode-focusBorder:#007fd4;--vscode-list-inactiveSelectionBackground:#37373d;--vscode-input-background:#3c3c3c}body{margin:0;height:100vh;background:#1e1e1e;color:#ccc;font-family:system-ui,"Apple SD Gothic Neo","Noto Sans CJK KR",sans-serif;font-size:13px}#root{height:100vh}';
const html = `<!doctype html><meta charset="utf-8"><style>${theme}${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script>`;

const output = resolve(process.env.HPS_TASK_EVIDENCE ?? 'e2e/test-results/task-rail-badge');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const states = ['preparing', 'running', 'approval', 'stopped', 'error', 'done'];
const shortTitle = '발표 자료 만들기', longTitle = '아주 긴 이름의 작업입니다 발표 자료를 만들고 검토하고 다시 고치는 중';
const checks = [];
try {
  for (const width of [1420, 800]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    await page.route('http://rail.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
    page.on('pageerror', e => errors.push(e.message));
    for (const [title, label] of [[shortTitle, 'short'], [longTitle, 'long']]) {
      for (const state of states) {
        await page.goto(`http://rail.test/?state=${state}&title=${encodeURIComponent(title)}`);
        await page.waitForSelector('.tw-task-state');
        const m = await page.evaluate(() => {
          const r = e => e.getBoundingClientRect();
          const rail = r(document.querySelector('.tw-rail')), row = document.querySelector('.tw-task');
          const rr = r(row), cs = getComputedStyle(row), b = row.querySelector('.tw-task-state'), ti = row.querySelector('.tw-task-title');
          const br = r(b), tr = r(ti), mr = r(row.querySelector('.tw-task-meta'));
          const content = { left: rr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), right: rr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) };
          const fontPx = parseFloat(getComputedStyle(b).fontSize);
          return { rail: rail.width, fontPx, meta: { top: mr.top, h: mr.height }, rowH: rr.height, rowOverflow: row.scrollWidth - row.clientWidth, content,
            badge: { left: br.left, right: br.right, top: br.top, h: br.height, text: b.textContent },
            title: { left: tr.left, right: tr.right, bottom: tr.bottom, w: tr.width, clipped: ti.scrollWidth > ti.clientWidth },
            pageOverflow: document.documentElement.scrollWidth - innerWidth };
        });
        const id = `${label}/${state}/${width}`;
        assert.equal(m.rail, 204, id + ' rail stays 204px');
        assert.ok(m.title.w >= m.content.right - m.content.left - 1, `${id} title keeps the whole row width (${m.title.w})`);
        if (title === shortTitle) assert.equal(m.title.clipped, false, `${id} short title is not truncated by the badge`);
        assert.ok(m.badge.top >= m.title.bottom - 0.5, `${id} badge is on its own line below the title`);
        assert.ok(Math.abs(m.content.right - m.badge.right) <= 1, `${id} badge is right-aligned (gap ${m.content.right - m.badge.right})`);
        assert.ok(m.badge.left >= m.content.left - 0.5, `${id} badge stays inside the row`);
        assert.ok(m.meta.h > 0 && m.meta.top >= m.badge.top + m.badge.h - 0.5, `${id} count/date line stays visible below the badge`);
        assert.ok(m.fontPx >= 14, `${id} badge text is at least 14px (${m.fontPx})`);
        assert.ok(m.rowH >= 44, `${id} row is at least 44px (${m.rowH})`);
        assert.ok(m.rowOverflow <= 0 && m.pageOverflow <= 0, `${id} no horizontal overflow`);
        if (title === shortTitle && (state === 'approval' || state === 'running')) await page.screenshot({ path: resolve(output, `rail-${label}-${state}-${width}.png`), clip: { x: 0, y: 0, width: 420, height: 440 } });
        checks.push(id);
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`task rail badge geometry PASS (${checks.length} layouts)`);
} finally { await browser.close(); }
