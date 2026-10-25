// #2641 (REQ-STUDIO-ACTIVITY-MATERIALS, DES-KNOW-04): a file dragged over the open 자료 card, measured on the
// CASCADE in headless Chromium with real DragEvents and a real DataTransfer.
//   node --experimental-strip-types test/materials-drop-computed.smoke.mjs
//
// The real webview entry (main.tsx) is bundled and gets a host config with the `materials` flag and the shell's
// photo drop on. Dark and light, forced colours off and on:
//   - while a file is over the open card, the card's own border is 2px solid in the focus-ring colour (Highlight in
//     forced colours), its padding gives the extra 1px back so the card does not move or resize, and the shell's
//     own drop overlay is not shown
//   - when the file leaves the card the border is back to its resting 1px divider
//   - a drop sends exactly one materialAddDrop with the file's bytes, and nothing is staged on the composer
// Self-test: the same matrix is rerun with injected later stylesheets; each must be caught. Without a headless
// Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('materials-drop-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('materials-drop-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const temp = mkdtempSync(path.join(tmpdir(), 'hps-materials-drop-'));
await build({
  entryPoints: [path.join(webview, 'src', 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
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
  dark: '--vscode-font-size:13px;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;',
  light: '--vscode-font-size:13px;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const CONFIG = { proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true }, fileAttach: true, materials: true,
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: 'classroom', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX, input: { image_paste: true, image_files: true } },
  activity: { id: 'a-classroom', name: '3반 웹페이지 만들기', kind: 'classroom', workspace: '/synthetic', verified: true } };
const VIEW = { scope: '["a1","t1"]', maxSelected: 3, items: [{ id: 'me:aaaaaaaaaaaa', kind: 'file', title: '계획.md', detail: '자료/계획.md', selected: false, removable: true, origin: 'learner', originLabel: '나' }] };

// React renders a dragover's state update at continuous priority, after the event returns, so every
// measurement waits for the attribute it expects instead of reading right after dispatch.
const page = `window.__drop = {
  card: () => document.querySelector('.hp-materials'),
  file: () => { const dt = new DataTransfer(); dt.items.add(new File(['# 메모\\n'], '메모.md', { type: 'text/markdown' })); return dt; },
  fire: (type, extra = {}) => __drop.card().dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: __drop.file(), ...extra })),
  style: () => { const c = __drop.card(), s = getComputedStyle(c), b = c.getBoundingClientRect();
    return { width: s.borderTopWidth, style: s.borderTopStyle, color: s.borderTopColor, box: [b.left, b.top, b.width, b.height].map(Math.round).join(',') }; },
  colour: (value) => { const e = document.createElement('span'); e.style.color = value; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; },
}`;
async function until(b, expression, tries = 40) {
  for (let i = 0; i < tries; i++) { if (await b.evaluate(expression)) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
}
async function probe(b) {
  await b.evaluate(page);
  const out = await b.evaluate(`({ ring: __drop.colour('var(--hp-ring-focus-default)'), highlight: __drop.colour('Highlight'), before: __drop.style() })`);
  await b.evaluate(`__drop.fire('dragover')`);
  out.marked = await until(b, `__drop.card().hasAttribute('data-drop-active')`);
  Object.assign(out, await b.evaluate(`({ over: __drop.style(), shellDrag: document.querySelector('.hps-shell').classList.contains('hps-shell-drag') })`));
  await b.evaluate(`__drop.fire('dragleave', { relatedTarget: document.body })`);
  await until(b, `!__drop.card().hasAttribute('data-drop-active')`);
  out.left = await b.evaluate(`__drop.style()`);
  await b.evaluate(`(__drop.fire('dragover'), __drop.fire('drop'))`);
  return out;
}

async function runMatrix(b, extraCss) {
  const results = [];
  for (const theme of ['dark', 'light']) for (const forced of [false, true]) {
    const where = `${theme}/${forced ? 'forced' : 'normal'}`;
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1420, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forced ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: theme }] });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.sent = [];
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
      document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEMES[theme])};
        document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-${theme}'); });` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(CONFIG)} } }))`);
      for (let i = 0; i < 50 && !(await b.evaluate(`window.sent.some((m) => m.type === 'materialsRequest')`)); i++) await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'materialsState', view: ${JSON.stringify(VIEW)} } }))`);
      for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hp-materials')`)); i++) await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`(() => { document.querySelector('.hp-materials').open = true;
        ${extraCss ? `const s = document.createElement('style'); s.textContent = ${JSON.stringify(extraCss)}; document.head.append(s);` : ''} })()`);
      await new Promise((r) => setTimeout(r, 50));
      const m = await probe(b);
      for (let i = 0; i < 30 && !(await b.evaluate(`window.sent.some((m) => m.type === 'materialAddDrop')`)); i++) await new Promise((r) => setTimeout(r, 50));
      m.sent = await b.evaluate(`window.sent.filter((m) => m.type === 'materialAddDrop' || m.type === 'stageImage').map((m) => m.type === 'stageImage' ? { type: m.type } : { type: m.type, name: m.name, size: m.size, text: new TextDecoder().decode(Uint8Array.from(atob(m.base64), (c) => c.charCodeAt(0))) })`);
      results.push({ where, forced, ...m });
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
  return results;
}

function check(results) {
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push(msg); };
  for (const r of results) {
    const want = r.forced ? r.highlight : r.ring;
    expect(r.marked && !r.shellDrag, `${r.where}: over the card the card is marked (${r.marked}) and the shell overlay is off (${!r.shellDrag})`);
    expect(r.over.style === 'solid' && r.over.width === '2px', `${r.where}: the drop border is ${r.over.style} ${r.over.width}, not 2px solid`);
    expect(r.over.color === want, `${r.where}: the drop border colour ${r.over.color} is not ${r.forced ? 'Highlight' : 'the ring token'} ${want}`);
    expect(r.over.box === r.before.box, `${r.where}: the card moved or resized while a file was over it (${r.before.box} -> ${r.over.box})`);
    for (const [when, st] of [['before', r.before], ['after leaving', r.left]]) expect(st.width === '1px' && st.color !== want, `${r.where}: ${when} the drag the border is ${st.width} ${st.color}, not the resting 1px divider`);
    expect(JSON.stringify(r.sent) === JSON.stringify([{ type: 'materialAddDrop', name: '메모.md', size: 9, text: '# 메모\n' }]), `${r.where}: the drop sent ${JSON.stringify(r.sent)}`);
  }
  expect(results.length === 4, `ran ${results.length} of 4 combinations`);
  return failures;
}

const MUTANTS = {
  'the border keeps the resting divider colour': '.hp-materials[data-drop-active] { border-color: var(--hp-border-divider-default) !important; }',
  'a later rule paints the border another colour': '.hp-materials[data-drop-active] { border-color: rgb(255, 0, 255) !important; }',
  'forced colours lose Highlight': '@media (forced-colors: active) { .hp-materials[data-drop-active] { border-color: CanvasText !important; } }',
  'the padding is not given back, so the card grows': '.hp-materials[data-drop-active] { padding: var(--ds-c-studio-styles-space-1) !important; }',
};

const b = await launch(bin);
let failures = [];
try {
  const results = await runMatrix(b, '');
  for (const r of results) console.log(r.where, JSON.stringify({ over: r.over, before: r.before.width, sent: r.sent.length }));
  failures = check(results);
  for (const [label, css] of Object.entries(MUTANTS)) {
    const caught = check(await runMatrix(b, css));
    if (caught.length === 0) failures.push(`self-test: "${label}" was not caught`);
    else console.log(`  self-test caught: ${label} (${caught.length}: ${caught[0]})`);
  }
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
if (failures.length) { console.error(failures.map((f) => '  FAIL ' + f).join('\n')); console.error(`materials-drop-computed: ${failures.length} failed`); process.exit(1); }
console.log('PASS materials drop computed: the open card border is the 2px ring while a file is over it (Highlight in forced colours) and the card does not move, back to the 1px divider when it leaves, one materialAddDrop with the bytes, no composer photo; dark and light; four injected overrides caught');
