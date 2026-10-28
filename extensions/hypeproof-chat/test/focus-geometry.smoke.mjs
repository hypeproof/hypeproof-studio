// CGP-DS-D-014: shared Studio/Chalk keyboard focus geometry, measured on the CASCADE.
//   node --experimental-strip-types test/focus-geometry.smoke.mjs
//
// 1. Cascade (headless Chromium, computed styles with :focus-visible forced over CDP): a normal control
//    gets `2px solid` and a +2px offset, a control inside a scroll container (and the container itself)
//    gets -2px, Chalk's legacy 3px page rules are overridden, Chalk's responsive scrollers inset only
//    below their breakpoint; forced colors keep the inset and normalize selected controls to Canvas. The previous declaration-only guard passed while the base rule out-ranked
//    every scroll rule, so none of this is read from rule text.
// 2. Contrast: the ring is >=3:1 against the surface (app and panel) for every focusable control, and
//    against the fill for the accent-filled control, in the HypeProof Studio theme, VS Code Dark/Light
//    Modern, High Contrast dark and light, and the Paper reading surface.
// 3. Inventory: every `overflow: auto|scroll` selector in Studio and Chalk CSS is covered by a scroll scope,
//    the stylesheet order puts the geometry after the role tokens, Chalk serves the same bytes.
// Without a headless Chromium (HEADLESS_CHROMIUM or the Playwright cache) section 1-2 print NOT RUN;
// set FOCUS_REQUIRE_BROWSER=1 to make that a failure.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticTokens } from './lib/expand-design-tokens.mjs';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const postcss = require('postcss');
const root = process.env.FOCUS_TEST_ROOT || fileURLToPath(new URL('../../../', import.meta.url));
const SRC = resolve(root, 'extensions/hypeproof-chat/webview-ui/src');

// ---------- the stylesheets as shipped ----------
// Studio: main.tsx order (tokens.css, then the geometry, then components), bundled by esbuild.
const cssFiles = readdirSync(SRC).filter((f) => f.endsWith('.css') && !['tokens.css', 'designTokens.css', 'focusGeometry.css', 'styles.css', 'chatDetails.css'].includes(f)).sort();
const order = ['tokens.css', ...(existsSync(resolve(SRC, 'focusGeometry.css')) ? ['focusGeometry.css'] : []), ...cssFiles, 'styles.css', 'chatDetails.css'];
const bundled = await build({
  stdin: { contents: order.map((f) => `@import "./${f}";`).join('\n'), resolveDir: SRC, loader: 'css' },
  bundle: true, write: false, outdir: 'out', logLevel: 'silent',
  plugins: [{ name: 'external', setup(b) { b.onResolve({ filter: /\.(svg|png|jpe?g|gif|webp|woff2?)$/ }, (a) => ({ path: a.path, external: true })); } }],
});
const studioCss = bundled.outputFiles.find((o) => o.path.endsWith('.css')).text;
// Chalk: the transport it serves, as a <style data-design-tokens> before the page's own rules.
const transportText = readFileSync(resolve(root, 'chalk/src/lib/design-tokens.ts'), 'utf8');
const chalkTokens = JSON.parse(transportText.split('\n').find((l) => l.startsWith('export const DESIGN_TOKENS = ')).slice('export const DESIGN_TOKENS = '.length, -1));
// Same entry rule as withDesignTokens(): <head>, else <html>.
const chalkPage = (name) => {
  const html = readFileSync(resolve(root, 'chalk/src/ui', name), 'utf8');
  const entry = /<head\b[^>]*>/i.test(html) ? /<head\b[^>]*>/i : /<html\b[^>]*>/i;
  return html.replace(entry, (h) => `${h}<style data-design-tokens>${chalkTokens}</style>`);
};

// ---------- colour maths ----------
const parse = (c) => { const m = c.match(/-?[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (top, under) => top.a >= 1 ? top.rgb : top.rgb.map((v, i) => v * top.a + under[i] * (1 - top.a));

// ---------- section 3 first: it needs no browser ----------
const failures = [];
const check = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 6).join(' | ')}`); } };

let browser = null;
const bin = findChromium();
if (bin && !process.env.FOCUS_STATIC_ONLY) browser = await launch(bin);
else if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('focus-geometry: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
else console.log('  NOT RUN  browser cascade/contrast (FOCUS_STATIC_ONLY or no Chromium); token-pair checks still run');

const THEMES = {
  'HypeProof Studio': { cls: 'vscode-dark', id: 'HypeProof Studio', v: { focusBorder: '#D5F279', 'button-background': '#D5F279', 'button-foreground': '#18231C', 'editor-background': '#151D19', 'quickInput-background': '#202C24', foreground: '#F2F4E8' } },
  'Dark Modern': { cls: 'vscode-dark', id: 'Dark Modern', v: { focusBorder: '#0078d4', 'button-background': '#0078d4', 'button-foreground': '#ffffff', 'editor-background': '#1f1f1f', 'quickInput-background': '#222222', foreground: '#cccccc' } },
  'Light Modern': { cls: 'vscode-light', id: 'Light Modern', v: { focusBorder: '#005fb8', 'button-background': '#005fb8', 'button-foreground': '#ffffff', 'editor-background': '#ffffff', 'quickInput-background': '#f8f8f8', foreground: '#3b3b3b' } },
  'High Contrast': { cls: 'vscode-high-contrast', id: 'Default High Contrast', v: { focusBorder: '#f38518', 'button-background': '#000000', 'button-foreground': '#ffffff', 'editor-background': '#000000', 'quickInput-background': '#000000', foreground: '#ffffff' } },
  'High Contrast Light': { cls: 'vscode-high-contrast vscode-high-contrast-light', id: 'Default High Contrast Light', v: { focusBorder: '#006BBD', 'button-background': '#0f4a85', 'button-foreground': '#ffffff', 'editor-background': '#ffffff', 'quickInput-background': '#ffffff', foreground: '#292929' } },
  'No host theme (fallbacks)': { cls: '', id: '', v: {} },
};
const studioPage = (t) => `<!doctype html><html><head><style>:root{${Object.entries(t.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';')}}${studioCss}</style></head>
<body class="${t.cls}" ${t.id ? `data-vscode-theme-id="${t.id}"` : ''} style="background:var(--hp-bg-app-default);color:var(--hp-text-primary-default)">
<div class="hps-shell"><button id="plain" style="background:transparent">Plain</button><input id="field"><textarea id="area"></textarea>
<button class="hp-cta-primary" id="cta">Go</button>
<div class="hps-input"><button class="hps-btn-send" id="send">보내기</button></div>
<div class="hps-edit-actions"><button class="hps-edit-save" id="save">저장</button></div>
<button class="hps-msg-run" id="run">실행</button><button class="hps-error-banner-retry" id="retry">다시 시도</button>
<div style="background:var(--hp-bg-panel-default)" id="panel"><button id="panelbtn" style="background:transparent">Panel</button></div>
<div class="hps-messages" id="scroller" tabindex="0" style="overflow:auto;height:80px;background:var(--hp-bg-panel-default)"><button id="inscroll" style="background:transparent">In</button><button id="sel" aria-selected="true" style="background:transparent"><span>선택됨</span><svg aria-hidden="true"><path stroke="currentColor" d="M0 0L1 1"/></svg></button><a href="#x" id="link">l</a><button class="hp-cta-primary" id="scoped-cta">Go</button><div class="hps-input"><button class="hps-btn-send" id="scoped-send">보내기</button></div></div>
<div data-surface="growth" style="background:var(--hp-bg-app-default)"><button class="hp-cta-primary" id="paper-cta">Go</button><button id="paper-plain" style="background:transparent">P</button></div>
<span id="p-hl" style="color:Highlight">h</span><span id="p-hlt" style="color:HighlightText">h</span></div></body></html>`;
const BASE_PROPS = ['outline-width', 'outline-style', 'outline-color', 'outline-offset', 'background-color', 'color', 'descendant-colors'];

if (browser) {
  try {
    // ---- 1. geometry, dark theme, wide ----
    await browser.load(studioPage(THEMES['HypeProof Studio']), { width: 1420 });
    const g = async (sel) => browser.focusVisibleStyle(sel, BASE_PROPS);

    const plain = await g('#plain'), inscroll = await g('#inscroll'), scroller = await g('#scroller'), link = await g('#link'), field = await g('#field');
    check('normal control: 2px solid, offset +2px', () => { assert.equal(plain['outline-width'], '2px'); assert.equal(plain['outline-style'], 'solid'); assert.equal(plain['outline-offset'], '2px'); });
    check('a field gets the same ring', () => { assert.equal(field['outline-width'], '2px'); assert.equal(field['outline-offset'], '2px'); });
    check('control inside a scroll container: offset -2px (computed)', () => { assert.equal(inscroll['outline-offset'], '-2px'); assert.equal(inscroll['outline-width'], '2px'); assert.equal(link['outline-offset'], '-2px'); });
    check('the focusable scroll container itself: offset -2px', () => { assert.equal(scroller['outline-offset'], '-2px'); assert.equal(scroller['outline-width'], '2px'); });
    // ---- 1b. forced colors ----
    await browser.load(studioPage(THEMES['HypeProof Studio']), { width: 1420, forcedColors: true });
    const fPlain = await g('#plain'), fIn = await g('#inscroll'), fSel = await g('#sel');
    const sys = await browser.evaluate(`({hl:getComputedStyle(document.getElementById('p-hl')).color,hlt:getComputedStyle(document.getElementById('p-hlt')).color})`);
    check('forced colors: normal control +2px, scroll control -2px', () => { assert.equal(fPlain['outline-offset'], '2px'); assert.equal(fIn['outline-offset'], '-2px'); assert.equal(fIn['outline-width'], '2px'); });
    check('forced colors: ring is Highlight, including a selected control inside a scroller', () => { assert.equal(fPlain['outline-color'], sys.hl); assert.equal(fIn['outline-color'], sys.hl); assert.equal(fSel['outline-offset'], '-2px'); assert.equal(fSel['outline-color'], sys.hl); assert.notEqual(sys.hl, sys.hlt); assert.ok(fSel['descendant-colors'].length >= 2); for (const color of fSel['descendant-colors']) assert.equal(color, fSel.color); });
    // ---- 2. contrast per theme ----
    for (const [name, t] of Object.entries(THEMES)) {
      await browser.load(studioPage(t), { width: 1420, dark: !/Light/.test(name) });
      const surf = await browser.evaluate(`({app:getComputedStyle(document.body).backgroundColor,panel:getComputedStyle(document.getElementById('panel')).backgroundColor,paper:getComputedStyle(document.getElementById('paper-plain').parentElement).backgroundColor})`);
      const app = parse(surf.app).rgb, panel = over(parse(surf.panel), app), paper = parse(surf.paper).rgb;
      for (const [sel, under, label] of [['#plain', app, 'app'], ['#panelbtn', panel, 'panel'], ['#inscroll', panel, 'scroller'], ['#cta', app, 'cta surface'], ['#send', app, 'send'], ['#save', app, 'edit'], ['#run', app, 'run'], ['#retry', app, 'retry'], ['#sel', panel, 'selected'], ['#paper-plain', paper, 'paper'], ['#paper-cta', paper, 'paper cta surface']]) {
        for (const states of [[], ['hover'], ['active']]) {
          const s = await browser.focusVisibleStyle(sel, BASE_PROPS, states);
          const ring = parse(s['outline-color']);
          const fill = parse(s['background-color']);
          check(`${name}: ${sel} descendants follow the control's text colour`, () => { for (const color of s['descendant-colors']) assert.equal(color, s.color); });
          check(`${name}: ${sel} ring vs ${label} >= 3:1`, () => { const r = ratio(over(ring, under), under); assert.ok(r >= 3, `${r.toFixed(2)}:1 (ring ${s['outline-color']} on rgb(${under.map(Math.round)}))`); });
          // The ring only sits on the fill when it is inset; every other ring is separated from it by the 2px gap.
          if (s['outline-offset'].startsWith('-')) check(`${name}: ${sel} inset ring vs its fill >= 3:1`, () => { const r = ratio(over(ring, under), over(fill, under)); assert.ok(r >= 3, `${r.toFixed(2)}:1`); });
        }
      }
      // Focus must not change the control's own paint: same fill, image and text focused and unfocused, per state.
      for (const sel of ['#cta', '#send', '#save', '#run', '#retry', '#paper-cta', '#plain', '#sel']) {
        for (const states of [[], ['hover'], ['active']]) {
          const paint = ['background-color', 'background-image', 'color'];
          const rest = await browser.focusVisibleStyle(sel, paint, states, false);
          const focused = await browser.focusVisibleStyle(sel, paint, states, true);
          check(`${name}: ${sel} ${states} fill and text are identical focused vs unfocused`, () => assert.deepEqual(focused, rest));
        }
      }
      const cta = await browser.focusVisibleStyle('.hp-cta-primary', ['background-color'], [], false);
      const ctaFocused = await browser.focusVisibleStyle('.hp-cta-primary', ['background-color'], [], true);
      check(`${name}: .hp-cta-primary computed background identical focused vs unfocused`, () => assert.equal(ctaFocused['background-color'], cta['background-color']));
      // An accent-filled control is ringed outside even inside a scroll scope; a plain one is inset there.
      const sc = await browser.focusVisibleStyle('#scoped-cta', BASE_PROPS), ss = await browser.focusVisibleStyle('#scoped-send', BASE_PROPS), sp = await browser.focusVisibleStyle('#inscroll', BASE_PROPS);
      check(`${name}: accent controls in a scroll scope keep the outside ring, plain ones inset`, () => { assert.equal(sc['outline-offset'], '2px'); assert.equal(ss['outline-offset'], '2px'); assert.equal(sp['outline-offset'], '-2px'); });
    }
    // ---- 1c. Chalk ----
    await browser.load(chalkPage('board.html'), { width: 1420 });
    const cb = await browser.focusVisibleStyle('#go', BASE_PROPS);
    check('Chalk page control: 2px (the legacy page rule is overridden), +2px', () => { assert.equal(cb['outline-width'], '2px'); assert.equal(cb['outline-style'], 'solid'); assert.equal(cb['outline-offset'], '2px'); });
    await browser.load(chalkPage('authoring.html'), { width: 1420 });
    const wide = await browser.focusVisibleStyle('.hp-flowbar nav a', BASE_PROPS);
    await browser.load(chalkPage('authoring.html'), { width: 500 });
    const narrow = await browser.focusVisibleStyle('.hp-flowbar nav a', BASE_PROPS);
    check('Chalk wrapping flow bar: +2px at wide and narrow widths', () => { assert.equal(wide['outline-offset'], '2px'); assert.equal(narrow['outline-offset'], '2px'); assert.equal(narrow['outline-width'], '2px'); });
    // every Chalk page: ring is 2px solid on every distinct control kind
    for (const f of readdirSync(resolve(root, 'chalk/src/ui')).filter((n) => n.endsWith('.html'))) {
      await browser.load(chalkPage(f), { width: 1420 });
      const controls = await browser.evaluate(`(() => { const result = []; document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary').forEach((e,i) => { if (e.getClientRects().length) { e.setAttribute('data-focus-probe', String(i)); result.push('[data-focus-probe="' + i + '"]'); } }); return result; })()`);
      for (const selector of controls) {
        const surround = await browser.evaluate(`(() => { let e = document.querySelector(${JSON.stringify(selector)}).parentElement; while(e) { const c = getComputedStyle(e).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; e=e.parentElement; } return 'rgb(255,255,255)'; })()`);
        for (const states of [[], ['hover'], ['active']]) {
          const s = await browser.focusVisibleStyle(selector, BASE_PROPS, states);
          check(`Chalk ${f} ${selector} ${states}: geometry and dual contrast`, () => {
            assert.equal(s['outline-width'], '2px'); assert.equal(s['outline-style'], 'solid');
            const under = parse(surround).rgb, ring = parse(s['outline-color']).rgb;
            assert.ok(ratio(ring,under) >= 3, `surround ${surround}`);
            if (s['outline-offset'].startsWith('-')) assert.ok(ratio(ring,over(parse(s['background-color']),under)) >= 3, `fill ${s['background-color']}`);
          });
        }
      }
    }
  } finally { await browser.close(); }
}

// Parsed stylesheet contracts remain executable in a sandbox without Chromium.
const expand = staticTokens(readFileSync(resolve(SRC, 'designTokens.css'), 'utf8'));
const geometry = postcss.parse(expand(readFileSync(resolve(SRC, 'focusGeometry.css'), 'utf8')));
const baseSelector = 'html body :focus-visible:where(:not(.hps-shell[data-chat-detail="personal"] .hps-input textarea):not(.cp-preview h3))';
const fillSelector = baseSelector.replace(':focus-visible:', ':is(:focus-visible, #disconnect):focus-visible:focus-visible:');
const declaration = (selector, prop, media = '') => {
  let found;
  geometry.walkRules((r) => {
    const context = r.parent.type === 'atrule' ? r.parent.params : '';
    if (r.selector === selector && context === media) r.walkDecls(prop, (d) => { found = d; });
  });
  assert.ok(found, `${selector} ${prop} in ${media}`);
  return found;
};
check('geometry: 2px solid semantic ring; +2px default; important cascade', () => {
  const outline = declaration(baseSelector, 'outline');
  assert.equal(outline.value, '2px solid var(--hp-ring-focus-default, #D5F279)');
  assert.ok(outline.important);
  const offset = declaration(baseSelector, 'outline-offset');
  assert.equal(offset.value, 'var(--hp-focus-offset, 2px)');
  assert.ok(offset.important);
});
check('focus never repaints the control: no background/color rule on the focus selector outside forced colors', () => {
  geometry.walkRules((r) => {
    if (r.parent.type === 'atrule' && /forced-colors/.test(r.parent.params)) return;
    r.walkDecls((d) => { assert.ok(!/^(background|color|background-color|background-image)$/.test(d.prop) || !/focus-visible/.test(r.selector), `${r.selector} sets ${d.prop}`); });
  });
});
check('accent-filled controls keep the outside offset inside scroll scopes', () => {
  const d = declaration('html body :is(.hp-cta-primary, .hps-btn-send, .hps-edit-save, .hps-checkpoint-save, .hps-msg-run, .hps-error-banner-retry)', '--hp-focus-offset');
  assert.match(d.value, /2px/);
});
check('forced colors: Highlight against Canvas including selected controls; descendants follow the text colour', () => {
  for (const [prop, expected] of Object.entries({'outline-color':'Highlight', background:'Canvas', color:'CanvasText'})) {
    const d = declaration(fillSelector, prop, '(forced-colors: active)');
    assert.equal(d.value, expected); assert.ok(d.important);
  }
  const inherit = declaration(fillSelector + ' :where(*)', 'color', '(forced-colors: active)');
  assert.equal(inherit.value, 'inherit'); assert.ok(inherit.important);
});
check('every scroll scope sets -2px, responsive scopes only at their actual breakpoint', () => {
  let count = 0;
  geometry.walkDecls('--hp-focus-offset', (d) => {
    if (d.parent.selector.startsWith('html body :is(.hp-cta-primary')) { assert.equal(d.value, '2px'); return; }
    count++; assert.equal(d.value, '-2px');
    const media = d.parent.parent.type === 'atrule' ? d.parent.parent.params : '';
    const responsive = new Map([['html body :is(.ops-top)', '(max-width: 520px)'], ['html body :is(.ops-top>#ops-state-filters)', '(max-width: 600px)']]);
    assert.equal(media, responsive.get(d.parent.selector) || '');
  });
  assert.equal(count, 4); // the :is() scroll list, the shared .hp-modal card (CGP-DS-D-020), and the two Chalk responsive scrollers
});
// Resolve the actual role declarations and primitive tiers, with explicit host fixtures.
// This is token-pair evidence, not a substitute for the browser's cascade/paint checks.
const roles = postcss.parse(expand(readFileSync(resolve(SRC, 'tokens.css'), 'utf8')));
const resolveVar = (value, vars) => {
  for (let i = 0; i < 30 && value.includes('var('); i++) value = value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, key, fallback) => vars[key] ?? fallback ?? 'UNRESOLVED');
  assert.ok(!value.includes('UNRESOLVED') && !value.includes('var('), value);
  return value;
};
const hex = (v) => { assert.match(v, /^#[0-9a-f]{6}$/i); return [1,3,5].map((i) => parseInt(v.slice(i,i+2),16)); };
check('four theme kinds plus branded/Paper/Chalk: ring >=3 against the surround', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const scope of [':root', '.studio-start, .studio-disconnected', '[data-surface="growth"], .hp-reflection']) {
      const vars = Object.fromEntries(Object.entries(theme.v).map(([k,v]) => ['--vscode-' + k,v]));
      roles.walkRules((r) => { if (r.selector === ':root' || r.selector === scope) r.walkDecls((d) => { if (d.prop.startsWith('--')) vars[d.prop] = d.value; }); });
      const ring = hex(resolveVar('var(--hp-ring-focus-default)', vars));
      for (const surface of ['--hp-bg-app-default','--hp-bg-panel-default']) assert.ok(ratio(ring, hex(resolveVar(`var(${surface})`, vars))) >= 3, `${name}/${scope}/${surface}`);
    }
  }
  // Chalk does not import tokens.css; both properties use the shared primitive fallback.
  const ring = hex(resolveVar(declaration(baseSelector, 'outline').value.replace('2px solid ', ''), {}));
  for (const surround of ['#1D2630','#101418','#18231C','#202C24']) assert.ok(ratio(ring,hex(surround)) >= 3);
});

// ---------- 3. static inventory (no browser) ----------
check('stylesheet order: the geometry follows the role tokens, Chalk serves the same bytes', () => {
  const main = readFileSync(resolve(SRC, 'main.tsx'), 'utf8');
  assert.ok(main.indexOf('import "./tokens.css"') >= 0 && main.indexOf('import "./focusGeometry.css"') > main.indexOf('import "./tokens.css"'), 'main.tsx imports focusGeometry.css after tokens.css');
  const designTokens = readFileSync(resolve(SRC, 'designTokens.css'), 'utf8');
  const focus = readFileSync(resolve(SRC, 'focusGeometry.css'), 'utf8');
  const radius = readFileSync(resolve(SRC, 'radiusScale.css'), 'utf8'); // CGP-DS-R-011: the radius scale rides in the same transport
  assert.equal(chalkTokens, designTokens + radius + focus, 'Chalk transport = designTokens.css + radiusScale.css + focusGeometry.css');
});
check('every overflow:auto|scroll selector in Studio and Chalk CSS sits under a scroll scope', () => {
  const geometry = postcss.parse(readFileSync(resolve(SRC, 'focusGeometry.css'), 'utf8'));
  const scopes = new Set();
  geometry.walkRules((r) => { if (r.nodes.some((d) => d.prop === '--hp-focus-offset')) r.selector.replace(/^html body :is\(([\s\S]*)\)$/, '$1').split(/,(?![^(\[]*[)\]])/).forEach((s) => scopes.add(s.replace(/\s+/g, ' ').trim())); });
  assert.ok(scopes.size >= 40, `scope inventory (${scopes.size})`);
  const normalize = (s) => s.replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' ').trim();
  const known = [...scopes].map(normalize);
  let audited = 0;
  for (const directory of ['extensions/hypeproof-chat/webview-ui/src', 'chalk/src/ui']) {
    for (const file of readdirSync(resolve(root, directory)).filter((f) => /\.(css|html)$/.test(f))) {
      const text = readFileSync(resolve(root, directory, file), 'utf8');
      const blocks = file.endsWith('.html') ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]) : [text];
      const parsed = blocks.map((block) => postcss.parse(block));
      // A later unconditional !important overflow:visible wins over obsolete narrow rules.
      const visible = new Set();
      for (const sheet of parsed) sheet.walkDecls('overflow', (d) => {
        if (d.value === 'visible' && d.important && d.parent.parent.type === 'root') for (const selector of d.parent.selectors) visible.add(normalize(selector));
      });
      for (const sheet of parsed) sheet.walkDecls((d) => {
        if (!/^overflow(?:-[xy])?$/.test(d.prop) || !/^(auto|scroll)$/.test(d.value)) return;
        for (const selector of d.parent.selectors) {
          const actual = normalize(selector);
          if (visible.has(actual) && !d.important) continue;
          assert.ok(known.some((expected) => actual === expected || actual.endsWith(' ' + expected) || actual.startsWith(expected + '>') || actual.startsWith(expected + ' ')), `${file}: scrolling ${selector} has no inset coverage`);
          audited++;
        }
      });
    }
  }
  assert.ok(audited >= 40, `the inventory reads both products (${audited})`);
});
if (failures.length) { console.error(`focus-geometry: ${failures.length} FAIL`); process.exit(1); }
console.log(`focus-geometry: stylesheet contracts and inventory PASS; browser ${browser ? 'PASS' : 'NOT RUN'}`);
