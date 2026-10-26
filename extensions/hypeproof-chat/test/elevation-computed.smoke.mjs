// CGP-DS-R-012 / REQ-CGP-DS-13 / DES-CGP-DS-13: elevation measured on the computed cascade in headless
// Chromium. The webview's whole bundled stylesheet (esbuild from main.tsx), the four VS Code default
// themes plus forced colors, and every elevated Studio surface in the markup shape its component
// renders (class names and nesting from ChatPanel/ChatPreferences/MyQuestions/TaskWorkspace/StartPage).
//
// - Dark+: every surface casts a shadow with alpha >= .2; across all surfaces at most two distinct shadows
//   (raised, overlay), so with "none" at most three named levels.
// - Light+: the same geometry with a lower alpha (theme-specific), except the forest-only start card.
// - HC Dark / HC Light: no shadow; a 1px solid border, >= 3:1 against what is around it, drawn in the
//   theme's contrastBorder on menus, popovers, dialogs and drawers.
// - Forced colors: no shadow, the 1px border remains.
// Without a browser it prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('elevation-computed: Chromium required (FOCUS_REQUIRE_BROWSER=1)');
  console.log('NOT RUN elevation-computed: no headless Chromium');
  process.exit(0);
}
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
// ELEVATION_CSS_FILE swaps in a mutated stylesheet (mutation runs prove the assertions bite).
const css = process.env.ELEVATION_CSS_FILE ? readFileSync(process.env.ELEVATION_CSS_FILE, 'utf8') : (await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'esm', outdir: 'elevation-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.css')).text;

// VS Code's registered contrastBorder (baseColors.ts): only the high-contrast themes define it.
const CONTRAST_BORDER = { 'HC Dark': '#6FC3DF', 'HC Light': '#0F4A85' };
const THEME_RUNS = [
  { name: 'Dark+', body: 'vscode-dark', dark: true },
  { name: 'Light+', body: 'vscode-light', dark: false },
  { name: 'HC Dark', body: 'vscode-high-contrast', dark: true },
  { name: 'HC Light', body: 'vscode-high-contrast vscode-high-contrast-light', dark: false },
  { name: 'Dark+', label: 'forced colors', body: 'vscode-dark', dark: true, forcedColors: true },
  // A user high-contrast theme whose contrastBorder differs from its panel.border: the edge must follow contrastBorder.
  { name: 'HC Dark', label: 'HC custom', body: 'vscode-high-contrast', dark: true, contrastBorder: '#FFD700' },
];
// id → [edge to measure, kind]. Controls keep the fixed control boundary; the start card is forest-only.
const SURFACES = {
  composer: ['top', 'control'], catchup: ['top', 'control'], tools: ['top', 'overlay'], prefs: ['top', 'overlay'],
  myq: ['top', 'overlay'], chatmenu: ['top', 'overlay'], sources: ['left', 'overlay'], connect: ['top', 'forest'],
};
const fixture = (vars, body) => `<!doctype html><html style="${vars}"><head><style>${css}</style></head><body class="${body}">
<div class="tw-workspace" data-sources-open="true" style="position:relative;display:block;height:720px">
  <div class="hps-shell" data-chat-detail="personal">
    <header class="hps-header"><div class="hps-myq"><button class="hps-myq-toggle" type="button">내 질문</button><div class="hps-myq-panel" id="myq" role="dialog" aria-label="내 질문"><ol class="hps-myq-list"><li><button class="hps-myq-item" type="button">첫 질문</button></li></ol></div></div>
      <div style="position:relative;margin-left:auto"><div class="tw-chat-menu-panel" id="chatmenu" role="menu" aria-label="대화 메뉴"><button role="menuitem" type="button">기록</button></div></div></header>
    <div class="hps-catchup"><button id="catchup" type="button">새 답 보기</button></div>
    <div class="hps-input-area" style="margin-top:260px"><div class="hps-input" id="composer"><div style="position:relative"><div class="hps-tools-menu" id="tools" role="menu"><button role="menuitem" type="button">파일 첨부</button></div></div><textarea aria-label="메시지"></textarea></div></div>
  </div>
  <aside class="tw-sources" id="sources" aria-label="작업 자료"><header><h2>작업 자료</h2></header></aside>
</div>
<dialog class="hps-preferences hp-modal" id="prefs" aria-label="설정"><div class="hps-preferences-body">설정</div></dialog>
<div class="studio-start" style="padding:24px"><section class="studio-connect" id="connect"><h2>연결</h2></section></div>
</body></html>`;

const probe = `(() => {
  const rgba = (c) => { const m = c.match(/[\\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
  const lum = (c) => { const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const out = {};
  for (const [id, [edge]] of Object.entries(${JSON.stringify(SURFACES)})) {
    const el = document.getElementById(id); const s = getComputedStyle(el);
    // What the border is seen against: the painted backgrounds of the ancestors (outside the surface).
    let around = [255, 255, 255]; const chain = []; for (let n = el.parentElement; n; n = n.parentElement) chain.unshift(n);
    for (const n of chain) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) around = over(c, around); }
    const Edge = edge[0].toUpperCase() + edge.slice(1);
    const color = rgba(s['border' + Edge + 'Color']);
    out[id] = { shadow: s.boxShadow, width: parseFloat(s['border' + Edge + 'Width']), style: s['border' + Edge + 'Style'], color: s['border' + Edge + 'Color'],
      text: s.color, vsAround: ratio(over(color, around), around), visible: el.getBoundingClientRect().width > 0 };
  }
  return out;
})()`;
const alphaOf = (shadow) => { const m = /rgba?\(([^)]*)\)/.exec(shadow); if (!m) return 0; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
const geometryOf = (shadow) => shadow.replace(/rgba?\([^)]*\)/, '').trim();
const hex = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;

const evidence = process.env.ELEVATION_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const results = {};
try {
  for (const run of THEME_RUNS) {
    const border = run.contrastBorder ?? CONTRAST_BORDER[run.name];
    const theme = { ...THEMES[run.name], ...(border ? { contrastBorder: border } : {}) };
    const vars = Object.entries(theme).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    // 1000px: the sources panel is the overlay drawer below 1050px (taskWorkspace.css).
    await b.load(fixture(vars, run.body), { width: 1000, height: 1100, dark: run.dark, forcedColors: !!run.forcedColors });
    await b.evaluate(`document.getElementById('prefs').show(); 0`);
    const m = await b.evaluate(probe);
    results[run.label ?? run.name] = m;
    for (const [id, v] of Object.entries(m)) assert.ok(v.visible, `${run.label ?? run.name}: fixture ${id} must render`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/elevation-${(run.label ?? run.name).replace(/\W+/g, '-').toLowerCase()}.png`, Buffer.from(shot.data, 'base64')); }
  }
} finally { await b.close(); }

const dark = results['Dark+'], light = results['Light+'];
for (const [id, v] of Object.entries(dark)) assert.ok(v.shadow !== 'none' && alphaOf(v.shadow) >= 0.2, `Dark+: ${id} shadow must be visible (alpha >= .2): ${v.shadow}`);
// A level is its geometry; its alpha is the theme's (the forest start card keeps the dark one everywhere).
const levels = new Set(Object.values(dark).map((v) => geometryOf(v.shadow)));
assert.ok(levels.size <= 2, `Dark+: at most two shadow levels besides none, got ${[...levels].join(' | ')}`);
const lightLevels = new Set(Object.values(light).map((v) => geometryOf(v.shadow)));
assert.ok(lightLevels.size <= 2, `Light+: at most two shadow levels besides none, got ${[...lightLevels].join(' | ')}`);
for (const [id, v] of Object.entries(light)) {
  assert.equal(geometryOf(v.shadow), geometryOf(dark[id].shadow), `${id}: one level keeps its geometry across themes`);
  if (SURFACES[id][1] === 'forest') assert.equal(v.shadow, dark[id].shadow, `${id}: the forest-only start card keeps the dark alpha on a light host`);
  else assert.ok(alphaOf(v.shadow) > 0 && alphaOf(v.shadow) < alphaOf(dark[id].shadow), `Light+: ${id} alpha must be lighter than dark (${v.shadow} vs ${dark[id].shadow})`);
}
CONTRAST_BORDER['HC custom'] = '#FFD700';
for (const name of ['HC Dark', 'HC Light', 'HC custom']) {
  for (const [id, v] of Object.entries(results[name])) {
    const kind = SURFACES[id][1];
    assert.equal(v.shadow, 'none', `${name}: ${id} must drop its shadow`);
    assert.ok(v.width >= 1 && v.style === 'solid', `${name}: ${id} needs a 1px solid border (${v.width}px ${v.style})`);
    assert.ok(v.vsAround >= 3, `${name}: ${id} border must be >= 3:1 against its surroundings (${v.vsAround.toFixed(2)}:1, ${v.color})`);
    if (kind === 'overlay') assert.equal(v.color, hex(CONTRAST_BORDER[name]), `${name}: ${id} border is the theme's contrastBorder`);
    if (kind === 'forest') assert.equal(v.color, v.text, `${name}: the forest start card border is its own text colour`);
  }
}
for (const [id, v] of Object.entries(results['forced colors'])) {
  assert.equal(v.shadow, 'none', `forced colors: ${id} has no shadow`);
  assert.ok(v.width >= 1 && v.style === 'solid', `forced colors: ${id} keeps a 1px solid border (${v.width}px ${v.style})`);
}
console.log(`PASS elevation-computed: ${Object.keys(SURFACES).length} surfaces; Dark+ levels ${[...levels].join(' | ')}; Light+ ${[...lightLevels].join(' | ')}; HC Dark/Light/custom flat with 1px contrastBorder edges; forced colors flat`);
