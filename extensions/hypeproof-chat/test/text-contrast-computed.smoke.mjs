// CGP-DS-D-028 (DES-CGP-DS-42, CGP-DS-R-034, REQ-STUDIO-TEXT-CONTRAST-TABLE) — the contrast table, MEASURED:
// computed colours in headless Chromium, never declarations.
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/text-contrast-computed.smoke.mjs
//
// test/text-contrast-table.smoke.mjs models the cascade from the CSS text, so a later override slips past it
// (`body { --hp-text-muted-default: #757575 }`, a mid-grey surface token, `filter: opacity(.5)`,
// `-webkit-text-fill-color`). This test loads the shipped stylesheets in main.tsx order into a real page,
// puts the theme's --vscode-* variables on <html>, and reads what the browser paints:
//   A. Rule probe. For every style rule that declares color, opacity, filter or -webkit-text-fill-color, an
//      element matching each of its selectors is built (ancestors included), placed on each surface of its
//      scope, and the painted text colour is composited over the stacked ancestor backgrounds, faded by
//      the opacity() of every ancestor and by filter: opacity(). Text below 4.5:1 fails.
//   B. Real markup. ChatPanel (classroom and personal seat, with messages) and StartPage are rendered with
//      react-dom/server into the same page, and every element with its own text is measured the same way.
// Themes: HypeProof Studio (dark, as media/hypeproof-theme.json), no theme at all (every CSS fallback
// literal), and VS Code Dark+, Dark Modern, Light+, Light Modern, High Contrast, High Contrast Light,
// 2026 Dark, 2026 Light.
// Scopes: chat (app, panel, sideBar, editor, widget surfaces), personal (.tw-workspace canvas and panel),
// branded (.studio-start forest app and panel), paper ([data-surface="growth"]).
//
// The eight VS Code default themes ship only the 19 keys of test/lib/vscode-default-themes.mjs (the rest of
// the registry is approximated below), so for them the rule probe measures the rules that read a muted,
// descriptionForeground or placeholder colour, and the real-markup pass measures everything it renders; the
// HypeProof Studio theme and the no-theme pass measure every rule.
//
// Not measured, listed so nothing is silently skipped:
//   - disabled controls (selector has :disabled, [disabled] or [aria-disabled="true"]): WCAG 1.4.3 exempts them;
//   - icons (last compound is svg, .hps-icon, *-icon, .hps-tool-mark): graphics, 3:1 under WCAG 1.4.11,
//     checked in text-contrast-table.smoke.mjs;
//   - fully transparent text (alpha 0: animation start frames) and screen-reader-only text (a 1px clipped box,
//     e.g. .hps-composer-hint in the personal seat);
//   - pointer and keyboard states (:hover, :active, :focus-visible), forced-colors rules and @keyframes:
//     the declaration table covers states, forced-colors.smoke.mjs the system palette;
//   - filter functions other than opacity() (blur, drop-shadow do not change the text colour).
// Self-test: the matrix is run again with injected overrides (a muted token set to #757575, a 3.2:1 muted
// token, a mid-grey app/panel surface, filter: opacity(.5), -webkit-text-fill-color, an opacity fade on a
// muted label); each must produce new failing rows, or this test fails.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { KIND_CLASS, THEMES as DEFAULT_THEMES } from './lib/vscode-default-themes.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = resolve(root, 'webview-ui/src');
const TEXT = 4.5;

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('text-contrast-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('text-contrast-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}

// ---------- the stylesheets as shipped: main.tsx import order, @import expanded in place, one <style> per file ----------
// Stylesheet order is ES module evaluation order: walk main.tsx's imports depth-first, emit each .css when met.
const order = [];
const visited = new Set();
const visit = (file) => {
  if (visited.has(file)) return;
  visited.add(file);
  const path = ['', '.tsx', '.ts'].map((x) => join(SRC, file + x)).find((p) => { try { return readFileSync(p, 'utf8') && /\.(tsx?|css)$/.test(p); } catch { return false; } });
  if (!path || path.endsWith('.css')) return;
  for (const m of readFileSync(path, 'utf8').matchAll(/^(?:import|export)\s+(?:[^'"\n]*?from\s+)?["']\.\/([^"']+)["'];?/gm)) {
    if (m[1].endsWith('.css')) { if (!order.includes(m[1])) order.push(m[1]); } else visit(m[1]);
  }
};
visit('main.tsx');
const entryCss = order, componentCss = [];
const seen = new Set();
const sheets = []; // [file, text]
const emit = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  const text = readFileSync(join(SRC, file), 'utf8');
  let buf = '';
  for (const part of text.split(/(@import\s+[^;]+;)/)) {
    const imp = /^@import\s+(?:url\()?["']\.\/([\w.-]+\.css)["']\)?/.exec(part);
    if (imp) { if (buf.trim()) sheets.push([file, buf]); buf = ''; emit(imp[1]); } else buf += part;
  }
  if (buf.trim()) sheets.push([file, buf]);
};
for (const f of entryCss) emit(f);
assert.ok(sheets.length >= 8, `stylesheets found: ${sheets.length}`);
assert.ok(sheets.some(([f]) => f === 'tokens.css') && sheets.some(([f]) => f === 'designTokens.css') && sheets.some(([f]) => f === 'styles.css'), 'tokens.css, designTokens.css and styles.css are in the bundle');

// ---------- the real markup (ChatPanel both seats, StartPage) ----------
const markup = {};
{
  const dir = mkdtempSync(join(tmpdir(), 'text-contrast-computed-'));
  try {
    const out = join(dir, 'render.cjs');
    await build({ stdin: { contents: 'export { ChatPanel } from "./webview-ui/src/ChatPanel"; export { StartPage } from "./webview-ui/src/StartPage"; export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react";', resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', loader: { '.css': 'empty', '.svg': 'empty' }, alias: { react: join(root, 'webview-ui/node_modules/react'), 'react-dom': join(root, 'webview-ui/node_modules/react-dom') }, banner: { js: 'globalThis.window = { innerWidth: 1420, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };' }, logLevel: 'error' });
    const { ChatPanel, StartPage, renderToStaticMarkup, createElement } = createRequire(import.meta.url)(out);
    const originalError = console.error;
    console.error = (...args) => { if (!/useLayoutEffect does nothing on the server/.test(String(args[0]))) originalError(...args); };
    const noop = () => {};
    const ux = { coach: { naming_mode: 'fixed', fallback_name: 'HypeProof' }, suggestions: { initial: ['첫 질문 예시'], follow_up: [] }, hints: { short_input: { enabled: true }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } };
    const at = 1_700_000_000_000;
    const messages = [{ id: 'u1', role: 'user', content: '안녕하세요', createdAt: at }, { id: 'a1', role: 'assistant', content: '무엇을 만들어 볼까요?', createdAt: at + 1 }];
    for (const seat of ['classroom', 'personal']) {
      // The personal seat's ChatPanel is the child of TaskWorkspace (.tw-workspace > .tw-conversation).
      const wrap = (h) => (seat === 'personal' ? `<div class="tw-workspace"><div class="tw-conversation">${h}</div></div>` : h);
      markup[`ChatPanel/${seat}`] = wrap(renderToStaticMarkup(createElement(ChatPanel, { messages, streaming: false, config: { hasToken: true, profile: { ux, welcome: { greeting_md: '' }, profile_id: 'studio-native-trial', activity_kind: 'trial', lesson: null }, activity: { id: 'a1', verified: true, workspace: '/tmp/synthetic' }, coach: { name: 'HypeProof', configured: true }, taskWorkspace: seat === 'personal' ? { tasks: [], sources: [] } : undefined }, onSend: noop, onCancel: noop, onSettings: noop, onSetToken: noop })));
    }
    markup['StartPage'] = `<div class="studio-start">${renderToStaticMarkup(createElement(StartPage))}</div>`;
    console.error = originalError;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
for (const [k, v] of Object.entries(markup)) assert.ok(v.length > 200, `${k} rendered`);

// ---------- themes ----------
const hp = JSON.parse(readFileSync(resolve(root, 'media/hypeproof-theme.json'), 'utf8')).colors;
// input.foreground defaults to foreground in the registry.
const vars = (colors) => Object.fromEntries(Object.entries({ 'input.foreground': colors.foreground, ...colors }).filter(([k, v]) => !['kind', 'file'].includes(k) && v).map(([k, v]) => [`--vscode-${k.replace(/\./g, '-')}`, v]));
// VS Code writes the colour registry's default for every key a theme leaves out, by theme kind
// (src/vs/platform/theme/common/colors/*.ts). test/lib/vscode-default-themes.mjs lists only the keys the
// theme files set, so the registry defaults the component CSS reads are added here; without them a light
// theme would fall through to the CSS's dark fallback literal, which VS Code never lets happen.
const REGISTRY = {
  dark: { errorForeground: '#F48771', 'charts.green': '#89D185', 'charts.red': '#F14C4C', 'editorInfo.foreground': '#59A4F9', 'editorWidget.background': '#252526', 'editorWidget.foreground': '#CCCCCC', 'list.inactiveSelectionBackground': '#37373D', 'textBlockQuote.background': '#222222', 'textCodeBlock.background': '#0A0A0A66', 'diffEditor.insertedTextBackground': '#9CCC2C33', 'diffEditor.removedTextBackground': '#FF000033', 'toolbar.activeBackground': '#63666750' },
  light: { errorForeground: '#A1260D', 'charts.green': '#388A34', 'charts.red': '#E51400', 'editorInfo.foreground': '#1A85FF', 'editorWidget.background': '#F3F3F3', 'editorWidget.foreground': '#616161', 'list.inactiveSelectionBackground': '#E4E6F1', 'textBlockQuote.background': '#F2F2F2', 'textCodeBlock.background': '#DCDCDC66', 'diffEditor.insertedTextBackground': '#9BB95533', 'diffEditor.removedTextBackground': '#FF000033', 'toolbar.activeBackground': '#A6A6A650' },
  hcDark: { errorForeground: '#F48771', 'charts.green': '#89D185', 'charts.red': '#F48771', 'editorInfo.foreground': '#3794FF', 'editorWidget.background': '#0C141F', 'editorWidget.foreground': '#FFFFFF', 'list.inactiveSelectionBackground': '#00000000', 'textBlockQuote.background': '#00000000', 'textCodeBlock.background': '#00000000', 'diffEditor.insertedTextBackground': '#33FF3333', 'diffEditor.removedTextBackground': '#FF000033', 'toolbar.activeBackground': '#00000000' },
  hcLight: { errorForeground: '#B5200D', 'charts.green': '#374E06', 'charts.red': '#B5200D', 'editorInfo.foreground': '#1A85FF', 'editorWidget.background': '#FFFFFF', 'editorWidget.foreground': '#292929', 'list.inactiveSelectionBackground': '#00000000', 'textBlockQuote.background': '#00000000', 'textCodeBlock.background': '#00000000', 'diffEditor.insertedTextBackground': '#74B97433', 'diffEditor.removedTextBackground': '#FF000033', 'toolbar.activeBackground': '#00000000' },
};
const THEMES = { 'HypeProof Studio': { cls: 'vscode-dark', vars: vars({ ...REGISTRY.dark, ...hp }) }, 'no theme': { cls: 'vscode-dark', vars: {} } };
for (const n of ['Dark+', 'Dark Modern', 'Light+', 'Light Modern', 'HC Dark', 'HC Light', '2026 Dark', '2026 Light']) {
  assert.ok(DEFAULT_THEMES[n], `theme ${n}`);
  // VS Code writes the active theme's id on <body data-vscode-theme-id>; tokens.css keys the 2026 pair on it.
  THEMES[n] = { onlyMuted: true, id: { '2026 Dark': 'Dark 2026', '2026 Light': 'Light 2026' }[n] ?? `Default ${n}`, cls: KIND_CLASS[DEFAULT_THEMES[n].kind], vars: vars({ ...REGISTRY[DEFAULT_THEMES[n].kind], ...DEFAULT_THEMES[n] }) };
}
const isLight = (cls) => /light/.test(cls);

// ---------- in the page ----------
// Defined once as source text; evaluated inside the page with a config object.
const PAGE = `(cfg) => {
  const K = document.createElement('canvas'); K.width = K.height = 1; const X = K.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { X.clearRect(0, 0, 1, 1); X.fillStyle = '#000'; X.fillStyle = c; X.fillRect(0, 0, 1, 1); const d = X.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, under) => [top[0] * top[3] + under[0] * (1 - top[3]), top[1] * top[3] + under[1] * (1 - top[3]), top[2] * top[3] + under[2] * (1 - top[3]), 1];
  const filterAlpha = (f) => { let a = 1; for (const m of String(f || '').matchAll(/opacity\\(\\s*([\\d.]+)(%?)\\s*\\)/g)) a *= m[2] ? Number(m[1]) / 100 : Number(m[1]); return a; };
  // Painted text colour of an element (or one of its pseudo-elements) over the stacked backgrounds of its ancestors.
  const measure = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo || undefined);
    const fill = cs.getPropertyValue('-webkit-text-fill-color');
    const fg0 = rgba(fill && fill !== 'currentcolor' ? fill : cs.color);
    let alpha = filterAlpha(cs.filter) * (pseudo ? Number(cs.opacity) : 1);
    const chain = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) chain.push(e);
    for (const e of chain) { const s = getComputedStyle(e); alpha *= (e === el && pseudo ? 1 : Number(s.opacity)) * (e === el ? 1 : filterAlpha(s.filter)); }
    if (!pseudo) alpha *= filterAlpha(getComputedStyle(el).filter);
    let bg = [0, 0, 0, 1];
    for (const e of chain.slice().reverse()) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) bg = over(c, bg); }
    const f = over([fg0[0], fg0[1], fg0[2], fg0[3] * alpha], bg);
    return { ratio: ratio(f, bg), alpha: fg0[3] * alpha, fg: f.slice(0, 3).map(Math.round).join(','), bg: bg.slice(0, 3).map(Math.round).join(',') };
  };
  const out = { rows: [], unmatched: [], rules: 0 };
  if (cfg.mode === 'markup') {
    for (const el of document.getElementById('root').querySelectorAll('*')) {
      if (el.closest('svg') || ['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const field = ['INPUT', 'TEXTAREA'].includes(el.tagName) && !el.value && (el.getAttribute('placeholder') || '').trim();
      if (!own && !field) continue;
      const r = el.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2 || getComputedStyle(el).visibility !== 'visible') continue; // 1px clipped = screen-reader-only text
      const m = measure(el, field ? '::placeholder' : null);
      const sel = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + (field ? '::placeholder' : '');
      out.rows.push({ sel, surface: cfg.name, disabled: !!el.closest(':disabled, [aria-disabled="true"]'), ...m });
    }
    return out;
  }
  const rules = [];
  const walk = (list, file) => {
    for (const r of list) {
      if (r.type === 1) rules.push([r, file]);
      else if (r.type === 4) { if (matchMedia(r.conditionText).matches && !/forced-colors/.test(r.conditionText)) walk(r.cssRules, file); }
      else if (r.type === 12) { if (CSS.supports(r.conditionText)) walk(r.cssRules, file); }
      else if (r.cssRules && !/keyframes|font-face|property/i.test(r.constructor.name + r.cssText.slice(0, 12))) walk(r.cssRules, file);
    }
  };
  for (const s of document.styleSheets) walk(s.cssRules, s.ownerNode.dataset.file || 'extra');
  out.rules = rules.length;
  const holder = document.getElementById('root');
  const WATCH = /(^|;|\\{|\\s)(color|opacity|filter|-webkit-text-fill-color)\\s*:/;
  const DISABLED = /:disabled|\\[disabled\\]|\\[aria-disabled=["']?true["']?\\]/;
  const ICON = /(^|[\\s>])(svg|\\.hps-icon|\\.[\\w-]+-icon|\\.hps-tool-mark)(:[\\w-]+)*$/;
  const seen = new Set();
  const compound = (p) => {
    const tag = /^[a-zA-Z][\\w-]*/.exec(p)?.[0];
    const el = document.createElement(tag && !['body', 'html'].includes(tag) ? tag : 'div');
    if (el.tagName === 'DIV' && /^(input|textarea)/.test(p)) return el;
    for (const t of p.matchAll(/\\.([\\w-]+)|#([\\w-]+)|\\[([\\w-]+)(?:([~|^$*]?=)["']?([^\\]"']*)["']?)?\\]/g)) { if (t[1]) el.classList.add(t[1]); else if (t[2]) el.id = t[2]; else el.setAttribute(t[3], t[5] ?? ''); }
    return el;
  };
  for (const [r, file] of rules) {
    const css = r.cssText;
    if (!WATCH.test(css.slice(css.indexOf('{')))) continue;
    if (cfg.onlyMuted && !/muted|descriptionForeground|placeholder/i.test(css)) continue;
    for (const raw of r.selectorText.split(/,(?![^(]*\\))/)) {
      const sel = raw.trim().replace(/\\s+/g, ' ');
      if (DISABLED.test(sel)) continue;
      const pm = /::(before|after|placeholder|marker)$/.exec(sel);
      const pseudo = pm ? '::' + pm[1] : null;
      let s = sel.replace(/::?(before|after|placeholder|marker|selection|first-line|first-letter|-webkit-[\\w-]+|-moz-[\\w-]+)/g, '')
        .replace(/:(hover|active|focus|focus-visible|focus-within|visited|link|checked|first-child|last-child|nth-child\\([^)]*\\)|nth-of-type\\([^)]*\\)|first-of-type|last-of-type|only-child|empty|root|target|read-only|placeholder-shown|indeterminate)/g, '')
        .replace(/:(not|is|where|has)\\((?:[^()]|\\([^()]*\\))*\\)/g, '').trim();
      if (!s || /&/.test(s)) continue;
      const last = s.split(/\\s*[>+~]\\s*|\\s+/).filter(Boolean).at(-1);
      if (ICON.test(last)) continue;
      const scope = cfg.scopeOf(file, sel, css);
      for (const [sname, sbg] of cfg.surfaces[scope]) {
        const key = [s, pseudo, sname, scope].join('|'); if (seen.has(key)) continue; seen.add(key);
        const wrap = document.createElement('div');
        wrap.style.cssText = 'background:' + sbg + ';isolation:isolate;position:relative';
        if (scope === 'personal') wrap.className = 'tw-workspace';
        if (scope === 'branded') wrap.className = 'studio-start';
        if (scope === 'paper') wrap.setAttribute('data-surface', 'growth');
        const parts = s.split(/\\s*[>+~]\\s*|\\s+/).filter(Boolean);
        const bodyCls = [];
        let cur = wrap, leaf = null;
        for (const p of parts) {
          if (p === '*') continue;
          if (/^(body|html|:root)/.test(p)) { for (const c of p.matchAll(/\\.([\\w-]+)/g)) if (!document.body.classList.contains(c[1])) { document.body.classList.add(c[1]); bodyCls.push(c[1]); } continue; }
          const el = compound(p); cur.appendChild(el); cur = el; leaf = el;
        }
        if (!leaf) { bodyCls.forEach((c) => document.body.classList.remove(c)); continue; }
        if (/^(input|textarea)/.test(parts.at(-1))) { const t = document.createElement(/^textarea/.test(parts.at(-1)) ? 'textarea' : 'input'); for (const c of leaf.classList) t.classList.add(c); if (leaf.id) t.id = leaf.id; leaf.replaceWith(t); leaf = t; }
        holder.appendChild(wrap);
        let ok = false; try { ok = leaf.matches(s); } catch { /* unparseable here */ }
        if (ok) {
          if (pseudo === '::placeholder') leaf.setAttribute('placeholder', 'x'); else leaf.textContent = 'x';
          const content = pseudo === '::before' || pseudo === '::after' ? getComputedStyle(leaf, pseudo).content : 'x';
          if (pseudo && pseudo !== '::placeholder' && (!content || content === 'none' || content === 'normal' || content === '""')) { /* no generated text */ }
          else if (getComputedStyle(leaf).display !== 'none') {
            const m = measure(leaf, pseudo);
            if (m.alpha > 0.02) out.rows.push({ sel: sel, surface: scope + '/' + sname, disabled: false, ...m });
          }
        } else out.unmatched.push(s);
        wrap.remove(); bodyCls.forEach((c) => document.body.classList.remove(c));
      }
    }
  }
  out.unmatched = [...new Set(out.unmatched)];
  return out;
}`;

// Scope of a rule: where its text can sit (same reasoning as text-contrast-table.smoke.mjs scopeOf).
const scopeOf = (file, selector, css) => {
  if (/data-surface="growth"|\.hp-reflection\b/.test(selector)) return 'paper';
  if (file === 'start.css' || /\.studio-(start|disconnected)\b/.test(selector)) return 'branded';
  if (file === 'taskWorkspace.css' || file === 'citationPreview.css' || /data-chat-detail="personal"|\.tw-/.test(selector) || /var\(--tw-/.test(css)) return 'personal';
  return 'chat';
};
const SURFACES = {
  chat: [['app', 'var(--hp-bg-app-default)'], ['panel', 'var(--hp-bg-panel-default)'], ['sideBar', 'var(--vscode-sideBar-background, var(--hp-bg-app-default))'], ['editor', 'var(--vscode-editor-background, #1e1e1e)'], ['widget', 'var(--vscode-quickInput-background, var(--vscode-editorWidget-background, #252526))']],
  personal: [['canvas', 'var(--tw-canvas)'], ['panel', 'var(--tw-panel)']],
  branded: [['app', 'var(--hp-bg-app-default)'], ['panel', 'var(--hp-bg-panel-default)']],
  paper: [['app', 'var(--hp-bg-app-default)'], ['panel', 'var(--hp-bg-panel-default)']],
};

const b = await launch(bin);
const runTheme = async (name, th, extra = '') => {
  const varCss = Object.entries(th.vars).map(([k, v]) => `${k}:${v}`).join(';');
  const styles = sheets.map(([f, t]) => `<style data-file="${f}">${t}</style>`).join('\n') + (extra ? `<style data-file="extra">${extra}</style>` : '');
  const page = (inner) => `<!doctype html><html style="${varCss}"><head><meta charset="utf-8">${styles}</head><body class="${th.cls}" data-vscode-theme-id="${th.id ?? 'HypeProof Studio'}" style="background:var(--vscode-sideBar-background, var(--hp-bg-app-default));margin:0"><div id="root">${inner}</div></body></html>`;
  const rows = [];
  await b.load(page(''), { width: 1420, height: 900, dark: !isLight(th.cls) });
  const probe = await b.evaluate(`(${PAGE})(Object.assign(${JSON.stringify({ mode: 'rules', surfaces: SURFACES, onlyMuted: !!th.onlyMuted })}, { scopeOf: ${scopeOf.toString()} }))`);
  rows.push(...probe.rows.map((r) => ({ theme: name, kind: 'rule', ...r })));
  for (const [k, html] of Object.entries(markup)) {
    await b.load(page(html), { width: 1420, height: 900, dark: !isLight(th.cls) });
    const m = await b.evaluate(`(${PAGE})({ mode: 'markup', name: ${JSON.stringify(k)} })`);
    rows.push(...m.rows.map((r) => ({ theme: name, kind: 'markup', ...r })));
  }
  return { rows, rules: probe.rules, unmatched: probe.unmatched };
};
const failing = (rows) => rows.filter((r) => !r.disabled && r.ratio < TEXT - 1e-9);
const keyOf = (r) => `${r.theme}|${r.kind}|${r.surface}|${r.sel}`;

let exit = 0;
try {
  // 1. The shipped stylesheets: no text below 4.5:1 in any theme, scope or real surface.
  const table = [];
  let total = 0, rulesSeen = 0, unmatchedMax = 0;
  const base = new Map();
  for (const [name, th] of Object.entries(THEMES)) {
    const r = await runTheme(name, th);
    table.push(...r.rows);
    total += r.rows.length; rulesSeen = r.rules; unmatchedMax = Math.max(unmatchedMax, r.unmatched.length);
    for (const row of failing(r.rows)) base.set(keyOf(row), row);
  }
  console.log(`  ${Object.keys(THEMES).length} themes, ${rulesSeen} style rules, ${total} measured text rows (${table.filter((r) => r.kind === 'markup').length} on real markup), ${unmatchedMax} selectors could not be built`);
  assert.ok(total > 5000, `the probe measured ${total} rows; the stylesheets or selectors did not load`);
  assert.ok(table.some((r) => r.kind === 'markup' && /hps-msg|hps-input|studio/.test(r.sel)), 'real ChatPanel/StartPage elements were measured');
  const lows = [...base.values()].sort((p, q) => p.ratio - q.ratio);
  if (lows.length) {
    const distinct = new Map(lows.map((r) => [`${r.kind} ${r.sel}`, r]));
    console.error(`  FAIL ${lows.length} measured text rows below ${TEXT}:1 (${distinct.size} distinct):`);
    for (const r of [...distinct.values()].slice(0, 40)) console.error(`    ${r.ratio.toFixed(2)}:1  ${r.theme} · ${r.kind} · ${r.surface} · ${r.sel}  (text ${r.fg} on ${r.bg})`);
    exit = 1;
  } else console.log(`  ok   no text below ${TEXT}:1 in the computed table`);
  if (process.env.HPS_CONTRAST_COMPUTED_TABLE) {
    writeFileSync(process.env.HPS_CONTRAST_COMPUTED_TABLE, ['# Studio computed contrast table (CGP-DS-D-028)', '', '| Theme | Kind | Surface | Selector | Text | Background | Ratio |', '|---|---|---|---|---|---|---|', ...table.map((r) => `| ${r.theme} | ${r.kind} | ${r.surface} | \`${r.sel.replace(/\|/g, '\\|')}\` | ${r.fg} | ${r.bg} | ${r.ratio.toFixed(2)}${r.disabled ? ' (disabled)' : ''} |`)].join('\n') + '\n');
  }

  // 2. Self-test: each injected override must add failing rows that the shipped stylesheets do not have.
  const MUTATIONS = {
    'muted token set to #757575 (body override)': 'body { --hp-text-muted-default: #757575; }',
    'muted token set to the 3.2:1 tertiary #616E65': 'body { --hp-text-muted-default: #616E65; }',
    'mid-grey app and panel surfaces': 'body { --hp-bg-panel-default: #5a6a60; --hp-bg-app-default: #5a6a60; }',
    'filter: opacity(.5) on muted text': '.hps-hint, .hps-msg-role { filter: opacity(.5); }',
    '-webkit-text-fill-color override': '.hps-hint, .hps-msg-role { -webkit-text-fill-color: #666; }',
    'opacity fade on a muted label': '.hps-msg-role { opacity: .5; }',
    'ancestor opacity': '.hps-msg { opacity: .5; }',
  };
  for (const [what, css] of Object.entries(MUTATIONS)) {
    const caught = new Set();
    for (const name of ['HypeProof Studio', 'Light+']) {
      const r = await runTheme(name, THEMES[name], css);
      for (const row of failing(r.rows)) if (!base.has(keyOf(row))) caught.add(row.sel);
    }
    if (caught.size) console.log(`  ok   caught: ${what} (${caught.size} new failing selectors, e.g. ${[...caught][0]})`);
    else { console.error(`  FAIL not caught: ${what}`); exit = 1; }
  }
} finally { await b.close(); }
if (exit) process.exit(exit);
console.log('text-contrast-computed: ok');
