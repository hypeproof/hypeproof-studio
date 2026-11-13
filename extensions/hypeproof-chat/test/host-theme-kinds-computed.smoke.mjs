// CGP-DS-R-004 / REQ-CGP-DS-03 (REQ-STUDIO-HOST-THEME-KINDS): every webview this extension creates
// follows the host theme kind, measured on the computed cascade in headless Chromium.
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/host-theme-kinds-computed.smoke.mjs
//   HOST_THEME_KINDS_EVIDENCE=<dir> also writes one screenshot per surface, kind and width.
//
// The extension creates one webview view (the chat) and twelve webview panels. Five of them (the start
// page, automation, local review, skill store and the chat itself) load the same bundled stylesheet, so
// the chat and the start page stand for that bundle. The other seven draw their own inline HTML and are
// each loaded here from the function the host calls: artifact history, the image-edit comparison,
// personal continuation, slide studio, visitor preview, work takeaway and the preview shell.
//
// Each page is loaded the way VS Code hands it to a webview: the theme colours as --vscode-* on <html>,
// the kind class on <body> (HC Light carries both high-contrast classes), VS Code's default webview
// style (body colour and font from the theme) and the surface the webview sits on (the side bar for the
// chat view, the editor for a panel). Kinds: Dark+, Light+, HC Dark and HC Light, plus the HypeProof
// Studio theme, which is the default look. Widths: 320, 390 and 1280px.
//
// A. Token set per kind (bundle): on the chat the key roles resolve to the theme's own colours (text to
//    foreground, app surface to editor.background, ring to focusBorder), elevation is light on light, dark
//    on dark and flat in both high-contrast kinds, and the four kinds give four different token sets.
//    Under the HypeProof Studio theme the roles equal the forest palette. The branded start screen stays
//    forest in every kind.
// B. Inline panels follow the kind: the painted page background is the theme's editor.background.
// C. Text: every visible element with its own text is >= 4.5:1 against the backgrounds painted under it,
//    with the alpha of its colour and the opacity of every ancestor applied. Colours only: no glyph is
//    sampled, so the result does not depend on the fonts installed (CI and snts differ).
// D. High contrast edges: in both high-contrast kinds no element casts an outer shadow unless it also
//    draws a visible (>= 1px, solid, opaque) border on every side.
//
// Not measured, listed so nothing is silently skipped: disabled controls (WCAG 1.4.3 exempts them), text
// that is only emoji or symbols (a coloured glyph has no single ink colour), screen-reader-only text (a
// 1px clipped box), text over a background image (the image-edit checkerboard), and frame contents (the
// learner's own page). Pointer and focus states are measured in text-contrast-computed and
// focus-ring tests; forced colors in forced-colors-computed.
//
// Negative controls: the same probe runs on mutated pages (a fixed dark page background, a faded label,
// a high-contrast shadow without a border, a kind that loses its token binding); each must fail.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { KIND_CLASS, THEMES as DEFAULT_THEMES } from './lib/vscode-default-themes.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw new Error('host-theme-kinds-computed: Chromium required (FOCUS_REQUIRE_BROWSER=1)');
  console.log('NOT RUN host-theme-kinds-computed: no headless Chromium');
  process.exit(0);
}

// ─── themes as a webview receives them ───────────────────────────────────────────────────────────
// test/lib/vscode-default-themes.mjs holds the keys the theme files set. The inline panels also read
// keys the four themes leave to the colour registry (src/vs/platform/theme/common/colors/*.ts); those
// registry defaults are added per kind. null = the registry has no value, the variable is absent.
const REGISTRY = {
  dark: { 'button.secondaryBackground': '#3A3D41', 'button.secondaryForeground': '#FFFFFF', 'button.border': null, contrastBorder: null, 'widget.border': null, 'input.border': null, 'input.foreground': '#CCCCCC', 'diffEditor.insertedTextBackground': '#9CCC2C33', 'diffEditor.removedTextBackground': '#FF000033' },
  light: { 'button.secondaryBackground': '#5F6A79', 'button.secondaryForeground': '#FFFFFF', 'button.border': null, contrastBorder: null, 'widget.border': null, 'input.border': null, 'input.foreground': '#616161', 'diffEditor.insertedTextBackground': '#9BB95533', 'diffEditor.removedTextBackground': '#FF000033' },
  hcDark: { 'button.secondaryBackground': null, 'button.secondaryForeground': '#FFFFFF', 'button.border': '#6FC3DF', contrastBorder: '#6FC3DF', 'widget.border': '#6FC3DF', 'input.border': '#6FC3DF', 'input.foreground': '#FFFFFF', 'diffEditor.insertedTextBackground': '#33FF3333', 'diffEditor.removedTextBackground': '#FF000033' },
  hcLight: { 'button.secondaryBackground': '#FFFFFF', 'button.secondaryForeground': '#292929', 'button.border': '#0F4A85', contrastBorder: '#0F4A85', 'widget.border': '#0F4A85', 'input.border': '#0F4A85', 'input.foreground': '#292929', 'diffEditor.insertedTextBackground': '#74B97433', 'diffEditor.removedTextBackground': '#FF000033' },
};
const hpTheme = JSON.parse(readFileSync(join(root, 'media/hypeproof-theme.json'), 'utf8')).colors;
const KINDS = {
  'Dark+': { kind: 'dark', colors: { ...REGISTRY.dark, ...DEFAULT_THEMES['Dark+'] } },
  'Light+': { kind: 'light', colors: { ...REGISTRY.light, ...DEFAULT_THEMES['Light+'] } },
  'HC Dark': { kind: 'hcDark', colors: { ...REGISTRY.hcDark, ...DEFAULT_THEMES['HC Dark'] } },
  'HC Light': { kind: 'hcLight', colors: { ...REGISTRY.hcLight, ...DEFAULT_THEMES['HC Light'] } },
  'HypeProof Studio': { kind: 'dark', colors: { ...REGISTRY.dark, ...hpTheme } },
};
const FOUR = ['Dark+', 'Light+', 'HC Dark', 'HC Light'];
const WIDTHS = [320, 390, 1280];
const bodyClass = (kind) => (kind === 'hcLight' ? 'vscode-high-contrast vscode-high-contrast-light' : KIND_CLASS[kind]);
// A generic family on purpose: nothing here depends on which fonts the machine has.
const varsOf = (colors) => Object.entries({ ...colors, 'font.family': 'sans-serif' })
  .filter(([k, v]) => !['kind', 'file'].includes(k) && typeof v === 'string' && v)
  .map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');

/** A page as VS Code serves it: vars on <html>, the kind class on <body>, the default webview style and
 *  the surface behind the webview (`under`: the side bar for the chat view, the editor for a panel). */
function asWebview(html, theme, under) {
  const t = KINDS[theme];
  const defaults = `<style id="vscode-default">html{background:${under === 'sideBar' ? 'var(--vscode-sideBar-background)' : 'var(--vscode-editor-background)'}}body{color:var(--vscode-foreground);font-family:var(--vscode-font-family)}</style>`;
  let out = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '');
  out = /<html\b[^>]*\bstyle="/.test(out) ? out.replace(/(<html\b[^>]*\bstyle=")/, `$1${varsOf(t.colors)};`) : out.replace(/<html\b/i, `<html style="${varsOf(t.colors)}"`);
  // The default style goes first in <head> so a page's own rules win, as in VS Code.
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}${defaults}`) : out.replace(/(<html\b[^>]*>)/i, `$1<head>${defaults}</head>`);
  const id = theme === 'HypeProof Studio' ? 'hypeproof-studio' : `Default ${theme}`;
  out = /<body\b[^>]*\bclass="/i.test(out)
    ? out.replace(/<body\b([^>]*)\bclass="/i, `<body$1data-vscode-theme-kind="${bodyClass(t.kind).split(' ').at(-1)}" data-vscode-theme-id="${id}" class="${bodyClass(t.kind)} `)
    : out.replace(/<body\b/i, `<body class="${bodyClass(t.kind)}" data-vscode-theme-kind="${bodyClass(t.kind).split(' ').at(-1)}" data-vscode-theme-id="${id}"`);
  return out;
}

// ─── the surfaces ────────────────────────────────────────────────────────────────────────────────
const SHIM = `<script>window.acquireVsCodeApi=()=>({postMessage(){},setState(){},getState(){return undefined}});</script>`;
const withShim = (html) => html.replace(/<head[^>]*>/i, (m) => `${m}${SHIM}`); // the shim runs before any page script
const bundleNode = async (entry, stub = {}) => {
  const built = await build({ entryPoints: [join(root, entry)], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  vm.runInNewContext(built.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === 'vscode' ? stub : require(id)), process, Buffer, console, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout, setInterval, clearInterval });
  return mod.exports;
};

// The bundle: the shipped stylesheet (esbuild from main.tsx) and the real ChatPanel and StartPage markup.
const CSS = process.env.HOST_THEME_KINDS_CSS_FILE
  ? readFileSync(process.env.HOST_THEME_KINDS_CSS_FILE, 'utf8')
  : (await build({ entryPoints: [join(root, 'webview-ui/src/main.tsx')], bundle: true, platform: 'browser', format: 'esm', outdir: 'host-theme-kinds-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.css')).text;
const markup = {};
{
  const dir = mkdtempSync(join(tmpdir(), 'host-theme-kinds-'));
  try {
    const out = join(dir, 'render.cjs');
    await build({ stdin: { contents: 'export { ChatPanel } from "./webview-ui/src/ChatPanel"; export { StartPage } from "./webview-ui/src/StartPage"; export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react";', resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', loader: { '.css': 'empty', '.svg': 'empty' }, alias: { react: join(root, 'webview-ui/node_modules/react'), 'react-dom': join(root, 'webview-ui/node_modules/react-dom') }, banner: { js: 'globalThis.window = { innerWidth: 1280, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };' }, logLevel: 'error' });
    const { ChatPanel, StartPage, renderToStaticMarkup, createElement } = require(out);
    const originalError = console.error;
    console.error = (...args) => { if (!/useLayoutEffect does nothing on the server/.test(String(args[0]))) originalError(...args); };
    const noop = () => {};
    const ux = { coach: { naming_mode: 'fixed', fallback_name: 'HypeProof' }, suggestions: { initial: ['첫 질문 예시'], follow_up: [] }, hints: { short_input: { enabled: true }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } };
    const at = 1_700_000_000_000;
    const messages = [{ id: 'u1', role: 'user', content: '안녕하세요', createdAt: at }, { id: 'a1', role: 'assistant', content: '무엇을 만들어 볼까요?\n\n- 첫째 단계\n- 둘째 단계', createdAt: at + 1 }];
    markup.chat = renderToStaticMarkup(createElement(ChatPanel, { messages, streaming: false, config: { hasToken: true, profile: { ux, welcome: { greeting_md: '' }, profile_id: 'studio-native-trial', activity_kind: 'trial', lesson: null }, activity: { id: 'a1', verified: true, workspace: '/tmp/synthetic' }, coach: { name: 'HypeProof', configured: true } }, onSend: noop, onCancel: noop, onSettings: noop, onSetToken: noop }));
    markup.start = `<div class="studio-start">${renderToStaticMarkup(createElement(StartPage))}</div>`;
    console.error = originalError;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
for (const [k, v] of Object.entries(markup)) assert.ok(v.length > 200, `${k} rendered`);
const bundlePage = (body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="root">${body}</div></body></html>`;

// The inline panels, each from the function its host calls.
const { artifactHistoryHtml } = await bundleNode('src/artifactHistoryPanel.ts');
const { imageEditComparisonHtml } = await import('../src/imageEditAssets.ts');
const { personalContinuationHtml } = await import('../src/personalContinuationView.ts');
const studio = await import('../src/slideStudio.ts');
const { visitorPreviewHtml } = await import('../src/visitorPreview.ts');
const { workTakeawayHtml } = await bundleNode('src/workTakeawayPanel.ts');
const { SERVICE_CONTRACT_FIXTURES } = await import('./fixtures/service-contracts/index.mjs');

let previewShell;
{
  let panel;
  const stub = {
    EventEmitter: class { constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; } fire(v) { for (const f of this.l) f(v); } },
    ViewColumn: { Beside: 2 }, Uri: { joinPath: (u) => u },
    workspace: { workspaceFolders: [], onDidSaveTextDocument: () => ({ dispose() {} }), fs: { readFile: async () => Buffer.from('') } },
    window: { createWebviewPanel: () => (panel = { reveal() {}, onDidDispose: () => {}, webview: { cspSource: 'https://test.invalid', html: '', asWebviewUri: (u) => u.fsPath, onDidReceiveMessage: () => {}, postMessage: () => {} } }) },
  };
  const { PreviewProvider } = await bundleNode('src/previewProvider.ts', stub);
  await new PreviewProvider({}).show('<p>page</p>');
  previewShell = panel.webview.html;
}
const point = (id, turnId, createdAt) => ({ id, turnId, createdAt, files: [{ rel: 'a.html', sha256: id.repeat(8), size: 1 }] });
const PLAN = SERVICE_CONTRACT_FIXTURES.plan;
const deckState = {
  team: '길잡이팀', sessions: [1, 2], dropped: [], H: [], D: [{ id: 'D-1', therefore: '다음 버튼을 52px로 키운다', ai_choice: '' }],
  E: [{ id: 'E-1', state: 'real', text: '할아버지가 다음 버튼이 작다고 하심', provenance: '' }],
  deck: {
    1: { headline: '어르신은 다음에 어디서 꺾는지 몰라 가족에게 전화한다', visual: { type: 'statement', value: '어르신이 길을 헷갈린다' }, support: ['직접 들음'], notes: '', refs: ['E-1'], gaps: [], session: 1 },
    2: { headline: '다음 버튼은 바로 통했다', visual: { type: 'quote', value: '다음 버튼이 작다', label: '할아버지' }, support: ['직접 보여 드림'], notes: '', refs: ['E-1'], gaps: [], session: 2 },
  },
};
const NONCE = 'hostthemekinds-nonce1';
const SURFACES = {
  // [html, surface behind the webview, inline?]
  chat: [bundlePage(markup.chat), 'sideBar', false],
  start: [bundlePage(markup.start), 'editor', false],
  'preview shell': [previewShell, 'editor', true],
  'artifact history': [artifactHistoryHtml([point('c', 'artifact-unknown', 3000), point('b', 'artifact-learner', 2000), point('a', 'artifact-ai', 1000)], 'c', 'a.html', NONCE, ''), 'editor', true],
  'image comparison': [imageEditComparisonHtml({ originalUri: 'data:image/png;base64,', editedUri: 'data:image/png;base64,', originalPath: 'images/a.png', editedPath: 'images/a-edit.png', nonce: NONCE, source: 'vscode-webview:' }), 'editor', true],
  'personal continuation': [personalContinuationHtml(NONCE, { projectLabel: '내 정원 페이지', draft: '정원 페이지를 이어서 만들고 싶어요.', historyCount: 3 }), 'editor', true],
  'slide studio': [studio.slideStudioHtml(studio.slideStudioView(deckState, PLAN.deck, PLAN, 1, ''), NONCE), 'editor', true],
  'visitor preview': [visitorPreviewHtml({ entry: 'index.html', audience: '인터넷의 누구나 · gallery.invalid', files: [{ path: 'index.html', data: Buffer.from('<h1>정원</h1>') }] }, 'http://127.0.0.1:9/index.html', NONCE, 60_000), 'editor', true],
  'work takeaway': [workTakeawayHtml({ destination: '/사본/정원', items: [{ label: 'index.html', category: '파일', reason: '선택한 파일의 사본이에요.' }, { label: '강사 메모', category: '남는 것', reason: '활동에 남겨요.' }] }, NONCE), 'editor', true],
};
for (const [k, [html]] of Object.entries(SURFACES)) assert.ok(typeof html === 'string' && html.length > 300, `${k} rendered`);

// ─── the probe (runs in the page) ────────────────────────────────────────────────────────────────
const PROBE = `(() => {
  // Any CSS colour to 8-bit RGBA through a canvas: Chromium serialises color-mix() results as
  // color(srgb 0.4 0.4 0.4), which a digit regex would misread as black.
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { if (!c || c === 'transparent') return [0, 0, 0, 0]; ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#00000000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
  const lum = (c) => { const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  const chain = (el) => { const c = []; for (let n = el; n; n = n.parentElement) c.unshift(n); return c; };
  const page = (() => { let p = [255, 255, 255]; for (const n of [document.documentElement, document.body]) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) p = over(c, p); } return hex(p); })();
  const text = [], skipped = [], shadows = [];
  for (const el of document.body.querySelectorAll('*')) {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    if (!shown) continue;
    if (s.boxShadow && s.boxShadow !== 'none') {
      const outer = s.boxShadow.split(/,(?![^(]*\\))/).some((x) => !/inset/.test(x) && !/rgba\\([^)]*,\\s*0\\)/.test(x));
      if (outer) {
        const sides = ['Top', 'Right', 'Bottom', 'Left'].map((e) => ({ w: parseFloat(s['border' + e + 'Width']), st: s['border' + e + 'Style'], a: rgba(s['border' + e + 'Color'])[3] }));
        shadows.push({ el: name(el), shadow: s.boxShadow, edged: sides.every((x) => x.w >= 1 && x.st === 'solid' && x.a >= 0.99) });
      }
    }
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) continue;
    if (el.closest('[disabled],[aria-disabled="true"]') || el.matches(':disabled')) { skipped.push(['disabled', name(el)]); continue; }
    if (/^[\\p{Extended_Pictographic}\\p{S}\\s\\uFE0F\\u200D]+$/u.test(own)) { skipped.push(['symbol', name(el)]); continue; }
    if (r.width <= 1 || r.height <= 1) { skipped.push(['sr-only', name(el)]); continue; }
    // The backgrounds the text can sit on: every layer composited from the root down. A gradient adds
    // each of its colour stops as a possible background (the text may sit on any part of it); the
    // darkest and the lightest are kept. A raster image cannot be reduced to colours and is skipped.
    let bgs = [[255, 255, 255]], image = false, fade = 1;
    for (const n of chain(el)) {
      const ns = getComputedStyle(n);
      fade *= Number(ns.opacity);
      const c = rgba(ns.backgroundColor); if (c[3] > 0) bgs = bgs.map((b) => over(c, b));
      const bi = ns.backgroundImage;
      if (bi && bi !== 'none') {
        if (/url\\(/.test(bi) && !/^url\\("?data:image\\/svg/.test(bi)) image = true;
        const stops = (bi.match(/(?:rgba?|color|oklab|oklch|lab|lch|hsla?)\\([^)]*\\)/g) ?? []).map(rgba);
        const all = [...bgs, ...stops.flatMap((st) => bgs.map((b) => over(st, b)))].sort((a, b) => lum(a) - lum(b));
        bgs = all.length > 2 ? [all[0], all.at(-1)] : all;
      }
    }
    if (image) { skipped.push(['image background', name(el)]); continue; }
    const c = rgba(s.color);
    const worst = bgs.map((bg) => { const ink = over([c[0], c[1], c[2], c[3] * fade], bg); return { ink, bg, r: ratio(ink, bg) }; }).sort((a, b) => a.r - b.r)[0];
    text.push({ el: name(el), text: own.slice(0, 24), ink: hex(worst.ink), bg: hex(worst.bg), ratio: Math.round(worst.r * 100) / 100 });
  }
  const tokens = {};
  const host = document.querySelector('.hps-shell') ?? document.querySelector('.studio-start') ?? document.body;
  const forest = document.querySelector('.studio-start');
  const hs = getComputedStyle(host), fs = forest ? getComputedStyle(forest) : null;
  const probeColor = (scope, v) => { const d = document.createElement('i'); d.style.color = v; scope.append(d); const out = hex(rgba(getComputedStyle(d).color)); d.remove(); return out; };
  for (const k of ['--hp-text-primary-default', '--hp-text-muted-default', '--hp-text-accent-default', '--hp-bg-app-default', '--hp-bg-panel-default', '--hp-bg-accent-default', '--hp-ring-focus-default', '--hp-border-control-default']) {
    if (hs.getPropertyValue(k).trim()) tokens[k] = probeColor(host, 'var(' + k + ')');
    if (fs) tokens['start ' + k] = probeColor(forest, 'var(' + k + ')');
  }
  tokens['--hp-elevation-raised'] = hs.getPropertyValue('--hp-elevation-raised').trim();
  return { page, text, skipped, shadows, tokens, scrollWidth: document.documentElement.scrollWidth };
})()`;

const up = (h) => (h ? h.slice(0, 7).toUpperCase() : h);
const forestPalette = { '--hp-text-primary-default': hpTheme.foreground, '--hp-bg-app-default': hpTheme['editor.background'], '--hp-ring-focus-default': hpTheme.focusBorder, '--hp-text-accent-default': hpTheme['textLink.foreground'] };

/** Every failure for one measured page. */
function judge(surface, theme, m, inline) {
  const bad = [];
  const c = KINDS[theme].colors;
  for (const t of m.text) if (t.ratio < 4.5) bad.push(`${surface} ${theme}: "${t.text}" ${t.el} ${t.ink} on ${t.bg} is ${t.ratio}:1 < 4.5:1`);
  if (KINDS[theme].kind.startsWith('hc')) for (const s of m.shadows) if (!s.edged) bad.push(`${surface} ${theme}: ${s.el} casts ${s.shadow} with no visible 1px border`);
  if (inline && m.page !== up(c['editor.background'])) bad.push(`${surface} ${theme}: page background ${m.page} is not the theme's editor.background ${up(c['editor.background'])}`);
  if (surface === 'chat') {
    const want = { '--hp-text-primary-default': c.foreground, '--hp-bg-app-default': c['editor.background'], '--hp-ring-focus-default': c.focusBorder, '--hp-bg-accent-default': c['button.background'] };
    for (const [k, v] of Object.entries(want)) if (m.tokens[k] !== up(v)) bad.push(`${surface} ${theme}: ${k} is ${m.tokens[k]}, not the theme's ${up(v)}`);
    const e = m.tokens['--hp-elevation-raised'];
    const kind = KINDS[theme].kind;
    // Chromium serialises the substituted value, e.g. "0 1px 2px rgb(0 0 0 / 30%)".
    const alpha = /\/\s*([\d.]+)%\s*\)/.exec(e)?.[1] ?? (/rgba\([^)]*,\s*([\d.]+)\)/.exec(e)?.[1] * 100);
    const ok = kind.startsWith('hc') ? !/rgba?\(/.test(e) || Number(alpha) === 0 : kind === 'light' ? Number(alpha) === 10 : Number(alpha) === 30;
    if (!ok) bad.push(`${surface} ${theme}: --hp-elevation-raised is "${e}", not the ${kind} level`);
  }
  if (surface === 'start') for (const [k, v] of Object.entries(forestPalette)) if (m.tokens[`start ${k}`] !== up(v)) bad.push(`start ${theme}: ${k} is ${m.tokens[`start ${k}`]}, not the forest ${up(v)} (the branded screen follows the host)`);
  if (surface === 'chat' && theme === 'HypeProof Studio') for (const [k, v] of Object.entries(forestPalette)) if (m.tokens[k] !== up(v)) bad.push(`chat HypeProof Studio: ${k} is ${m.tokens[k]}, not the HP palette ${up(v)}`);
  return bad;
}
/** The chat token sets of the four kinds must be four different sets. */
function distinct(byKind) {
  const keys = ['--hp-text-primary-default', '--hp-text-muted-default', '--hp-bg-app-default', '--hp-bg-panel-default', '--hp-ring-focus-default', '--hp-border-control-default', '--hp-elevation-raised'];
  const sig = Object.fromEntries(Object.entries(byKind).map(([k, t]) => [k, keys.map((x) => t[x]).join('|')]));
  const bad = [];
  const names = Object.keys(sig);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (sig[names[i]] === sig[names[j]]) bad.push(`chat: ${names[i]} and ${names[j]} resolve to the same token set`);
  return bad;
}

// ─── run ─────────────────────────────────────────────────────────────────────────────────────────
const evidence = process.env.HOST_THEME_KINDS_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const browser = await launch(bin);
const failures = [];
let pages = 0, texts = 0, shots = 0;
const skippedKinds = new Map();
// States a page reaches only on a host message, shown here by the same DOM change its script makes.
const SETUP = {
  // The review bar with a notice (renderReview in the shell; its host message is trusted only from a parent frame).
  'preview shell': `(() => { for (const id of ['review-strip', 'review-bar', 'review-notice']) document.getElementById(id).hidden = false; document.getElementById('review-title').textContent = 'AI가 파일 3개를 바꿨어요'; document.getElementById('review-notice').textContent = '진행 중인 작업이 끝난 뒤에 되돌릴 수 있어요.'; return true; })()`,
};
const measure = async (html, theme, width, surface) => {
  await browser.load(withShim(html), { width, height: 900, dark: !['light', 'hcLight'].includes(KINDS[theme].kind) });
  await new Promise((r) => setTimeout(r, 60));
  if (SETUP[surface]) await browser.evaluate(SETUP[surface]);
  return browser.evaluate(PROBE);
};
try {
  const chatTokens = {};
  for (const [surface, [html, under, inline]] of Object.entries(SURFACES)) {
    for (const theme of [...FOUR, 'HypeProof Studio']) for (const width of WIDTHS) {
      if (theme === 'HypeProof Studio' && width !== 390) continue;
      const m = await measure(asWebview(html, theme, under), theme, width, surface);
      pages++; texts += m.text.length;
      for (const [why] of m.skipped) skippedKinds.set(why, (skippedKinds.get(why) ?? 0) + 1);
      if (!m.text.length) failures.push(`${surface} ${theme} ${width}: no text measured (the page did not render)`);
      failures.push(...judge(surface, theme, m, inline).map((b) => `${b} @${width}px`));
      if (surface === 'chat' && width === 390 && FOUR.includes(theme)) chatTokens[theme] = m.tokens;
      if (FOUR.includes(theme)) {
        const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        assert.ok(shot.data.length > 1000, `${surface} ${theme} ${width}: screenshot captured`);
        shots++;
        if (evidence) writeFileSync(join(evidence, `${surface.replace(/\W+/g, '-')}-${theme.replace('+', ' plus').replace(/\W+/g, '-').toLowerCase()}-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
  }
  failures.push(...distinct(chatTokens));
  for (const [k, t] of Object.entries(chatTokens)) console.log(`    chat ${k.padEnd(9)} text ${t['--hp-text-primary-default']} muted ${t['--hp-text-muted-default']} app ${t['--hp-bg-app-default']} panel ${t['--hp-bg-panel-default']} ring ${t['--hp-ring-focus-default']} boundary ${t['--hp-border-control-default']} raised "${t['--hp-elevation-raised']}"`);
  const unique = [...new Set(failures)];
  console.log(`  measured ${pages} pages, ${texts} text elements, ${shots} screenshots${evidence ? ` in ${evidence}` : ''}; not measured: ${[...skippedKinds].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  if (unique.length) { console.error(`  FAIL host theme kinds:\n    - ${unique.slice(0, 60).join('\n    - ')}${unique.length > 60 ? `\n    - … ${unique.length - 60} more` : ''}`); }
  else console.log('  ok   every surface follows Dark+, Light+, HC Dark and HC Light; text >= 4.5:1; HC shadows carry a border; four chat token sets');

  // ─── negative controls: each mutated page must fail ────────────────────────────────────────────
  const inject = (html, css) => html.replace(/<\/head>/i, `<style>${css}</style></head>`);
  const NEGATIVE = [
    ['a panel painted a fixed dark page in Light+', 'work takeaway', 'Light+', (h) => inject(h, 'html,body{background:#1b1b2a !important}'), /page background/],
    ['a faded secondary label (opacity .5) in Light+', 'artifact history', 'Light+', (h) => inject(h, 'h1{opacity:.5}'), /< 4\.5:1/],
    ['an HC shadow with no border', 'personal continuation', 'HC Dark', (h) => inject(h, 'main{box-shadow:0 4px 8px rgba(0,0,0,.5);border:0}'), /no visible 1px border/],
    ['the chat text role pinned to the forest value in Light+', 'chat', 'Light+', (h) => inject(h, 'body.vscode-light .hps-shell{--hp-text-primary-default:#F2F4E8}'), /--hp-text-primary-default is/],
    ['the start screen following the host', 'start', 'HC Light', (h) => inject(h, '.studio-start{--hp-bg-app-default:var(--vscode-editor-background)}'), /branded screen follows the host/],
    ['the HC elevation left dark', 'chat', 'HC Dark', (h) => inject(h, 'body.vscode-high-contrast{--hp-elevation-raised:0 1px 2px rgba(0,0,0,.3)}'), /elevation-raised/],
  ];
  let controls = 0;
  for (const [label, surface, theme, edit, expect] of NEGATIVE) {
    const [html, under, inline] = SURFACES[surface];
    const mutated = edit(asWebview(html, theme, under));
    if (mutated === asWebview(html, theme, under)) { unique.push(`negative control "${label}": the mutation did not apply`); continue; }
    const bad = judge(surface, theme, await measure(mutated, theme, 390, surface), inline);
    if (bad.some((b) => expect.test(b))) { controls++; console.log(`  ok   negative control: ${label} -> ${bad.find((b) => expect.test(b)).slice(0, 110)}`); }
    else unique.push(`negative control "${label}" still passes`);
  }
  {
    const same = distinct({ 'Dark+': chatTokens['Dark+'], 'Dark+ copy': chatTokens['Dark+'] });
    if (same.length) { controls++; console.log(`  ok   negative control: two kinds with one token set -> ${same[0]}`); }
    else unique.push('negative control "two kinds with one token set" still passes');
  }
  console.log(`host-theme-kinds-computed: ${pages} pages, ${controls} negative controls, ${unique.length} failures`);
  if (unique.length) process.exitCode = 1;
} finally {
  await browser.close();
}
