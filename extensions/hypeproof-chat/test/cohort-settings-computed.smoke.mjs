// CGP-SHELL-R-015: settings fixed by the cohort/class (model, effort) measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/cohort-settings-computed.smoke.mjs
//
// The real webview entry (main.tsx) is bundled and receives a host config. Classroom composer and personal
// settings dialog, managed (cohortSettings) and unmanaged seat, dark and light, 1420 / 800 / 320 px, and
// forced colours. For a managed seat, each of the model and effort rows must show:
//   - the reason "선생님이 정한 설정이에요": rendered (display, visibility, opacity, a real box, topmost at its
//     centre), whole inside its row and every clipping ancestor, computed font-size >= 14px, text contrast >= 4.5:1
//   - the lock icon: rendered, >= 16px, contrast >= 3:1 (not in forced colours, where the system sets it)
//   - the select: disabled, value readable (real width, opaque, contrast >= 4.5:1), and its disabled state is not
//     colour-only (dashed border, differing from the unmanaged seat; in forced colours GrayText as well)
//   - no page scroll (documentElement.clientWidth)
// An unmanaged seat has no reason, no lock and enabled selects.
// Declaration-only and SSR/JSDOM tests cannot see: display:none, tiny font, colour == background, opacity:0,
// a collapsed select, a clipped row, a 2px icon. HPS_WEBVIEW_SRC=<dir> measures another copy of webview-ui/src.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('cohort-settings-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('cohort-settings-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = process.env.HPS_WEBVIEW_SRC ? path.resolve(process.env.HPS_WEBVIEW_SRC) : path.join(webview, 'src');
const REASON = '선생님이 정한 설정이에요';

const temp = mkdtempSync(path.join(tmpdir(), 'hps-cohort-settings-'));
await build({
  entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(readFileSync(path.join(temp, u))); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const THEMES = {
  dark: '--vscode-font-size:13px;--vscode-font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;',
  light: '--vscode-font-size:13px;--vscode-font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const choice = (alias, label, allowed) => ({ alias, id: alias, label, effort: { default: allowed[allowed.length - 1], allowed } });
const config = (surface, managed) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'fixed', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: 'classroom', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' },
    model_selection: { revision: 'x', source: 'profile', runtime: 'proxy', provider: 'anthropic', default: 'fixed', choices: managed ? [choice('fixed', '수업 모델', ['high'])] : [choice('fixed', '수업 모델', ['low', 'high']), choice('b', '다른 모델', ['high'])] }, ux: UX },
  activity: { id: 'a-' + surface, name: '3반', kind: 'classroom', workspace: '/synthetic', verified: true },
  effort: { value: 'high', allowed: managed ? ['high'] : ['low', 'high'] },
  cohortSettings: managed ? { model: true, effort: true } : undefined,
  ...(surface === 'personal' ? { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } } : {}),
});

// One in-page measurement: everything is the computed result, nothing is read from source.
const measure = `(() => {
  const vw = document.documentElement.clientWidth;
  const rgba = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat([1]);
  const bgOf = (e) => { const stack = []; for (let n = e; n; n = n.parentElement) stack.push(rgba(getComputedStyle(n).backgroundColor)); let c = [255, 255, 255, 1]; for (let i = stack.length - 1; i >= 0; i--) c = over(stack[i], c); return c; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const effOpacity = (e) => { let o = 1; for (let n = e; n && n !== document.documentElement; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const why = (e) => { const o = []; for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 1) o.push((n.className || n.tagName) + ':' + s.display + '/' + s.visibility + '/' + s.opacity); } return o; };
  const shows = (e) => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return e.getClientRects().length > 0 && effOpacity(e) > 0.99; };
  const inside = (r, o, t = 1) => r.left >= o.left - t && r.right <= o.right + t && r.top >= o.top - t && r.bottom <= o.bottom + t;
  const clips = (v) => v === 'hidden' || v === 'clip';
  const clippedBy = (e) => { const r = e.getBoundingClientRect(); const bad = []; for (let n = e.parentElement; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); const o = n.getBoundingClientRect(); const x = clips(s.overflowX) && (r.left < o.left - 1 || r.right > o.right + 1); const y = clips(s.overflowY) && (r.top < o.top - 1 || r.bottom > o.bottom + 1); if (x || y) bad.push(n.className || n.tagName); if (n.matches('dialog[open]')) break; } return bad; };
  const rows = [...document.querySelectorAll('.hps-model-selection, .hps-effort')].filter((r) => r.querySelector('select'));
  return { vw, docScroll: document.documentElement.scrollWidth, rows: rows.map((row) => {
    const sel = row.querySelector('select'); const sr = sel.getBoundingClientRect(); const scs = getComputedStyle(sel);
    const id = sel.getAttribute('aria-describedby'); const reason = id ? document.getElementById(id) : null;
    const rr = row.getBoundingClientRect();
    const o = { row: row.className.split(' ')[0], label: sel.getAttribute('aria-label'), disabled: sel.disabled, ariaDisabled: sel.getAttribute('aria-disabled'), value: sel.selectedOptions[0]?.textContent ?? '',
      select: { why: why(sel), shows: shows(sel), w: sr.width, h: sr.height, fg: contrast(rgba(scs.color), bgOf(sel)), borderStyle: scs.borderTopStyle, color: scs.color, clipped: clippedBy(sel), inRow: inside(sr, rr, 1) } };
    if (reason) {
      const r = reason.getBoundingClientRect(); const cs = getComputedStyle(reason);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const top = document.elementFromPoint(cx, cy);
      const ic = reason.querySelector('svg'); const ir = ic && ic.getBoundingClientRect();
      o.reason = { text: reason.textContent.trim(), shows: shows(reason), w: r.width, h: r.height, fs: parseFloat(cs.fontSize), contrast: contrast(rgba(cs.color), bgOf(reason)), inRow: inside(r, rr, 1), clipped: clippedBy(reason),
        topmost: !!top && reason.contains(top), inViewport: r.left >= -1 && r.right <= vw + 1,
        icon: ic && { shows: shows(ic), w: ir.width, h: ir.height, contrast: contrast(rgba(getComputedStyle(ic).stroke), bgOf(ic)), clipped: clippedBy(ic) } };
    }
    return o; }) };
})()`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch(bin);
const unmanaged = {}; const managed = {}; let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
try {
  for (const surface of ['classroom', 'personal']) for (const isManaged of [true, false]) for (const theme of ['dark', 'light']) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1420, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-color-scheme', value: theme }] });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.sent=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.sent.push(m),getState:()=>undefined,setState:()=>{}});document.addEventListener('DOMContentLoaded',()=>{const v=${JSON.stringify(THEMES[theme])};document.documentElement.setAttribute('style',v);document.body.setAttribute('style',v+'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)');document.body.classList.add('vscode-${theme}');});` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent&&window.sent.some(m=>m.type==='ready')`).catch(() => false)); i++) await wait(100);
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config(surface, isManaged))}}}))`);
      await wait(300);
      if (surface === 'personal') {
        await b.evaluate(`(()=>{const t=document.querySelector('.tw-chat-menu button[aria-haspopup]'); if(t) t.click();})()`); await wait(300);
        await b.evaluate(`(()=>{const m=[...document.querySelectorAll('button[role=menuitem]')].find(x=>x.textContent.trim()==='설정'); if(m) m.click();})()`); await wait(400);
        await b.evaluate(`(()=>{const d=document.querySelector('.hps-advanced-response'); if(d) d.open=true;})()`); await wait(200);
        ok(await b.evaluate(`!!document.querySelector('.hps-preferences')`), `${surface}: the real settings dialog opened`);
      }
      for (const forced of [false, true]) for (const width of [1420, 800, 320]) {
        const where = `${surface}/${isManaged ? 'managed' : 'unmanaged'}/${theme}/${width}${forced ? '/forced-colors' : ''}`;
        await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forced ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: theme }] });
        await wait(120);
        const m = await b.evaluate(measure);
        ok(m.docScroll <= m.vw, `${where}: no page scroll (${m.docScroll} > ${m.vw})`);
        const labels = m.rows.map((r) => r.label).sort();
        ok(labels.length === 2 && labels[0] === 'Effort' || labels.includes('생각 깊이') || surface === 'personal', `${where}: model and effort rows rendered (${labels})`);
        ok(m.rows.length === 2, `${where}: model and effort rows rendered (${labels})`);
        for (const r of m.rows) {
          const w = `${where}/${r.row}`;
          ok(r.select.shows && r.select.w >= 40 && r.select.h >= 16, `${w}: select rendered with a readable width (${r.select.w}x${r.select.h} ${JSON.stringify(r.select.why)} rects)`);
          ok(r.value.trim().length > 0, `${w}: current value readable`);
          ok(forced || r.select.fg >= 4.5, `${w}: select value contrast ${r.select.fg.toFixed(2)} >= 4.5`);
          ok(r.select.clipped.length === 0 && r.select.inRow, `${w}: select not clipped (${r.select.clipped})`);
          if (isManaged) {
            ok(r.disabled && r.ariaDisabled === 'true', `${w}: select is disabled`);
            ok(r.reason, `${w}: reason present`);
            const q = r.reason;
            ok(q.text.includes(REASON), `${w}: reason text "${q.text}"`);
            ok(q.shows && q.w > 0 && q.h > 0, `${w}: reason rendered`);
            ok(q.topmost, `${w}: reason is the topmost element at its centre`);
            ok(q.fs >= 14, `${w}: reason font-size ${q.fs} >= 14`);
            ok(q.contrast >= 4.5, `${w}: reason contrast ${q.contrast.toFixed(2)} >= 4.5`);
            ok(q.inRow && q.clipped.length === 0 && q.inViewport, `${w}: reason whole inside its row, ancestors and viewport (${q.clipped})`);
            ok(q.icon && q.icon.shows && q.icon.w >= 16 && q.icon.h >= 16, `${w}: lock icon visible and >= 16px (${q.icon && q.icon.w}x${q.icon && q.icon.h})`);
            ok(q.icon.clipped.length === 0, `${w}: lock icon not clipped`);
            ok(forced || q.icon.contrast >= 3, `${w}: lock icon contrast ${q.icon.contrast.toFixed(2)} >= 3`);
            ok(r.select.borderStyle === 'dashed', `${w}: disabled managed select has a non-colour cue (border ${r.select.borderStyle})`);
            managed[`${where}/${r.row}`] = r.select;
          } else {
            ok(!r.reason, `${w}: unmanaged seat has no reason or lock`);
            ok(r.select.borderStyle !== 'dashed', `${w}: unmanaged select keeps its solid border`);
            unmanaged[`${where}/${r.row}`] = r.select;
          }
        }
      }
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
  // Disabled is not colour-only: the managed select differs from the unmanaged one in border style, and in
  // forced colours also in colour.
  for (const [k, s] of Object.entries(managed)) {
    const u = unmanaged[k.replace('/managed/', '/unmanaged/')];
    ok(u && u.borderStyle !== s.borderStyle, `${k}: managed border style differs from unmanaged`);
    if (k.includes('forced-colors')) ok(u.color !== s.color, `${k}: managed select colour differs from unmanaged in forced colours`);
  }
  console.log(`cohort-settings-computed: ${checks} computed checks passed (classroom + personal, managed + unmanaged, dark/light, 1420/800/320, forced colours)`);
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
