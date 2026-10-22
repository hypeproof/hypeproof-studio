// CGP-ART-R-001: the annotation tray measured on the CASCADE in headless Chromium.
//   node scripts/run-tsx-tests.mjs annotation-layout
//
// The real webview entry (main.tsx: the real stylesheet order and the real ChatPanel markup) is bundled
// and receives a host config plus an `annotations` message with ten hostile annotations. Personal and
// classroom seat, dark and light, 1420 / 800 / 320 px, then forced colours. For every button, input
// and summary in the tray:
//   - rendered, 44px wide and high, computed font-size at least 14px, not cut off
//   - the tray fits the chat column: measured against documentElement.clientWidth, no page scroll
//   - the shared 2px solid focus ring (focusGeometry.css), forced through the DevTools protocol
//   - page text and comments render as text (no script runs, no element is created from them)
//   - element.click() on 빼기 posts annotationAction remove with that number
// PNGs for 1420 / 800 go to ~/.hypeproof/loop/cgp-artr001-in-the-learner-page/.
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
const HOSTILE = '<img src=x onerror="window.__x=1"><script>window.__x=2</script>‮뒤집기';
const annotations = Array.from({ length: 10 }, (_, i) => ({
  number: i + 1, kind: i % 2 ? 'rectangle' : 'element', stale: i === 3,
  comment: i === 0 ? HOSTILE : '버튼 색을 바꾸고 싶어요'.repeat(i % 3 + 1),
  sentText: `표시 #${i + 1}\n> ref: e${i + 1}\n> ${HOSTILE}\n> ${'아주긴단어'.repeat(80)}`, imageDataUrl: null,
}));

const measure = `(() => {
  const vw = document.documentElement.clientWidth;
  const root = document.querySelector('.hps-annotations');
  const out = { vw, docScroll: document.documentElement.scrollWidth, found: !!root, injected: window.__x ?? null, scripts: document.querySelectorAll('.hps-annotations script, .hps-annotations img[onerror]').length };
  if (!root) return out;
  const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, w: r.width, h: r.height }; };
  for (const d of root.querySelectorAll('details')) d.open = true;
  const rb = box(root), pb = box(root.parentElement);
  out.root = { ...rb, parentLeft: pb.left, parentRight: pb.right, scrollW: root.scrollWidth, clientW: root.clientWidth, fontSize: parseFloat(getComputedStyle(root).fontSize) };
  out.items = root.querySelectorAll('.hps-annotation').length;
  out.alerts = root.querySelectorAll('[role="alert"]').length;
  out.controls = [...root.querySelectorAll('button, input, summary')].map((e) => { const b = box(e), s = getComputedStyle(e);
    return { name: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20) || e.localName, w: b.w, h: b.h, left: b.left, right: b.right, fontSize: parseFloat(s.fontSize), display: s.display, textCut: e.localName === 'button' && e.scrollWidth > e.clientWidth + 0.5 }; });
  out.pre = [...root.querySelectorAll('pre')].map((e) => ({ fontSize: parseFloat(getComputedStyle(e).fontSize), right: box(e).right }));
  return out;
})()`;

async function main() {
  const bin = findChromium();
  if (!bin) {
    if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw new Error('annotation-layout: no headless Chromium and FOCUS_REQUIRE_BROWSER=1');
    console.log('annotation-layout NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
    return;
  }
  const extension = process.cwd();
  const require = createRequire(path.join(extension, 'package.json'));
  const { build } = require('esbuild');
  const webview = path.join(extension, 'webview-ui');
  const temp = mkdtempSync(path.join(tmpdir(), 'hps-annotation-layout-'));
  const pngs = path.join(homedir(), '.hypeproof/loop/cgp-artr001-in-the-learner-page');
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
  const RING = ['.hps-annotations-actions button', '.hps-annotation-remove', '.hps-annotation input', '.hps-annotation summary'];
  try {
    const runs = [...['personal', 'classroom'].flatMap((surface) => ['dark', 'light'].flatMap((theme) => [1420, 800, 320].map((width) => ({ surface, theme, width, forced: false })))),
      { surface: 'personal', theme: 'dark', width: 800, forced: true }, { surface: 'classroom', theme: 'light', width: 800, forced: true }];
    for (const { surface, theme, width, forced } of runs) {
      const where = `${surface}/${theme}/${width}${forced ? '/forced' : ''}`;
      await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forced ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: theme }] });
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
        await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'annotations', enabled: true, annotations: ${JSON.stringify(annotations)} } }))`);
        for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-annotations .hps-annotation')`)); i++) await new Promise((r) => setTimeout(r, 100));
        const m = await b.evaluate(measure);
        if (m.found) {
          m.ring = {};
          for (const selector of RING) m.ring[selector] = await b.focusVisibleStyle(selector);
          await b.evaluate(`window.sent.length = 0; document.querySelectorAll('.hps-annotation-remove')[2].click()`);
          m.sent = await b.evaluate(`window.sent.filter((x) => x.type === 'annotationAction')`);
          if (width !== 320 && !forced) {
            await b.evaluate(`document.querySelector('.hps-annotations').scrollIntoView({ block: 'start' })`);
            const shot = await b.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(path.join(pngs, `annotations-${surface}-${width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
          }
        }
        results.push({ where, ...m });
        console.log(where, JSON.stringify({ found: m.found, items: m.items, root: m.root && `${Math.round(m.root.w)}/${m.vw}`, min: m.controls && `${Math.round(Math.min(...m.controls.map((c: any) => c.w)))}x${Math.round(Math.min(...m.controls.map((c: any) => c.h)))}` }));
      } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
    }
  } finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }

  const failures: string[] = [];
  const expect = (ok: unknown, msg: string) => { if (!ok) failures.push(msg); };
  for (const r of results) {
    expect(r.found, `${r.where}: the tray does not render`);
    if (!r.found) continue;
    expect(r.items === 10 && r.alerts === 1, `${r.where}: ${r.items} items, ${r.alerts} stale alerts`);
    expect(r.injected === null && r.scripts === 0, `${r.where}: hostile text became markup (${r.injected}, ${r.scripts})`);
    expect(r.docScroll <= r.vw + 0.5, `${r.where}: the page scrolls horizontally (${r.docScroll} > clientWidth ${r.vw})`);
    expect(r.root.left >= -0.5 && r.root.right <= r.vw + 0.5, `${r.where}: the tray leaves the viewport (${Math.round(r.root.left)}..${Math.round(r.root.right)} of ${r.vw})`);
    expect(r.root.right <= r.root.parentRight + 0.5 && r.root.left >= r.root.parentLeft - 0.5, `${r.where}: the tray is wider than its chat column`);
    expect(r.root.scrollW <= r.root.clientW + 0.5, `${r.where}: the tray's content overflows it (${r.root.scrollW} > ${r.root.clientW})`);
    expect(r.root.fontSize >= 14 && r.pre.every((p: any) => p.fontSize >= 14 && p.right <= r.vw + 0.5), `${r.where}: tray text under 14px or outside the viewport`);
    for (const c of r.controls) {
      expect(c.display !== 'none', `${r.where}: ${c.name} is hidden`);
      expect(c.w >= 43.5 && c.h >= 43.5, `${r.where}: ${c.name} target is ${Math.round(c.w)}x${Math.round(c.h)}px, under 44`);
      expect(c.fontSize >= 14, `${r.where}: ${c.name} text is ${c.fontSize}px, under 14`);
      expect(!c.textCut && c.left >= -0.5 && c.right <= r.vw + 0.5, `${r.where}: ${c.name} is cut off or outside the viewport`);
    }
    for (const [selector, ring] of Object.entries<any>(r.ring)) {
      expect(ring['outline-style'] === 'solid' && ring['outline-width'] === '2px' && Math.abs(parseFloat(ring['outline-offset'])) === 2 && !/rgba\(0, 0, 0, 0\)/.test(ring['outline-color']),
        `${r.where}: ${selector} focus ring is ${ring['outline-style']} ${ring['outline-width']} ${ring['outline-color']} offset ${ring['outline-offset']}`);
    }
    expect(r.sent.length === 1 && r.sent[0].action === 'remove' && r.sent[0].number === 3, `${r.where}: 빼기 posts ${JSON.stringify(r.sent)}`);
  }
  assert.equal(results.length, 14, 'every combination ran');
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('PASS annotation layout computed: 10 hostile annotations, 44px targets, 14px text, shared 2px ring, inside clientWidth, forced colours (personal, classroom x dark, light x 1420, 800, 320)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
