// CGP-ART-D-012: the notice sheet as drawn in the real publish panel, in headless Chromium.
// Real markup (SSR of PublishPanel and PublishNoticeSheet; the sheet is placed where the panel
// draws it, after the publish actions) and the committed stylesheet and tokens.
//   - three bullets, each at most two lines at 320 px: measured, and also bounded without the
//     machine's fonts (every Hangul syllable counted a full em, any other character 0.6 em), so a
//     wider CI font cannot push a bullet to a third line
//   - 알겠어요 and 취소 at least 44 px, text at least 14 px, focus ring, contrast 4.5:1
//   - edges in forced colours, no horizontal overflow, both themes, personal and classroom seats
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderComponent } from './sx-render.mjs';
import { rules } from './fixtures/stylesheet-rules.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const css = readFileSync(new URL('../webview-ui/src/styles.css', import.meta.url), 'utf8');
const value = (selector, property, media = false) => rules(css).filter(r => (media ? !!r.media : !r.media) && r.selectors.includes(selector)).at(-1)?.decls[property];
// Declaration guards: logical properties and tokens only.
assert.equal(value('.hps-publish-notice-actions button', 'min-block-size'), 'var(--hp-control-min)');
assert.equal(value('.hps-publish-notice-actions button', 'min-inline-size'), 'var(--hp-control-min)');
assert.equal(value('.hps-publish-notice', 'font-size'), 'var(--hp-font-body)');
assert.equal(value('.hps-publish-notice ul', 'padding-inline-start'), 'var(--ds-c-studio-styles-space-20)');
assert.equal(value('.hps-publish-notice-actions button:focus-visible', 'outline'), 'var(--ds-c-focus-width) solid var(--hp-ring-focus-default)');
assert.equal(value('.hps-publish-notice', 'border-color', true), 'CanvasText');
assert.equal(value('.hps-publish-notice-actions button', 'border-color', true), 'ButtonText');
for (const r of rules(css).filter(r => r.selectors.some(s => s.includes('hps-publish-notice')))) {
  for (const [p, v] of Object.entries(r.decls)) {
    assert.doesNotMatch(p, /^(margin|padding|border)-(left|right|top|bottom)$|^(width|height|min-width|min-height)$/, `logical property: ${p}`);
    assert.doesNotMatch(v, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i, `colour token: ${p}: ${v}`);
  }
}
console.log('PASS notice stylesheet guards');

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw new Error('Chromium required'); console.log('NOT RUN notice computed layout: no Chromium'); process.exit(0); }
let browser;
try { browser = await launch(bin); } catch (error) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw error; console.log(`NOT RUN notice computed layout: ${error.message}`); process.exit(0); }
try {
  const view = { available: true, reason: null, project: null, version: { id: 'v1', files: [], manifest_added: [], refusal: null, refusal_lines: [] }, verification: { state: 'not_verified', open: [] }, hypotheses: [], timing: null, notice: null, experiments: [], publish_notice: { version: 'x', acknowledged: false } };
  const panel = await renderComponent('PublishPanel', { view, error: null, errorLines: [], shareUrl: null, busy: false });
  const sheet = await renderComponent('PublishNoticeSheet', { busy: false });
  assert.match(sheet, /알겠어요/);
  const tokens = ['designTokens.css', 'tokens.css'].map(f => readFileSync(new URL(`../webview-ui/src/${f}`, import.meta.url), 'utf8')).join('\n');
  const place = `(() => { const t = document.getElementById('sheet'); const a = document.querySelector('.hps-publish-actions'); a.after(t.content.cloneNode(true)); return !!document.querySelector('.hps-publish-notice'); })()`;
  const measure = `(() => {
    const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c) || /color\\(srgb ([^)]+)\\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); const scale = c.startsWith('color(') ? 255 : 1; return { r: p[0] * scale, g: p[1] * scale, b: p[2] * scale, a: p.length > 3 ? p[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const backdrop = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) return c; } return null; };
    const contrast = (el) => { const fg = parse(getComputedStyle(el).color), bg = backdrop(el); if (!fg || !bg) return null; const hi = Math.max(lum(fg), lum(bg)), lo = Math.min(lum(fg), lum(bg)); return (hi + 0.05) / (lo + 0.05); };
    const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); const tops = new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))); return tops.size; };
    const s = document.querySelector('.hps-publish-notice'), sr = s.getBoundingClientRect(), scs = getComputedStyle(s);
    return {
      viewport: document.documentElement.clientWidth, docScroll: document.documentElement.scrollWidth,
      sheet: { right: sr.right, width: sr.width, border: scs.borderTopStyle, borderWidth: parseFloat(scs.borderTopWidth), font: parseFloat(scs.fontSize), scroll: s.scrollWidth, client: s.clientWidth },
      title: { text: s.querySelector('strong').textContent, contrast: contrast(s.querySelector('strong')) },
      bullets: [...s.querySelectorAll('li')].map(li => { const cs = getComputedStyle(li); const text = li.textContent; return { text, lines: lines(li), width: li.clientWidth, font: parseFloat(cs.fontSize), hangul: [...text].filter(c => /[\\uac00-\\ud7a3]/.test(c)).length, other: [...text].filter(c => !/[\\uac00-\\ud7a3]/.test(c)).length, contrast: contrast(li) }; }),
      buttons: [...s.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b); return { text: b.textContent, h: r.height, w: r.width, font: parseFloat(cs.fontSize), border: cs.borderTopStyle, borderWidth: parseFloat(cs.borderTopWidth), contrast: contrast(b) }; }),
      platformFont: getComputedStyle(s).fontFamily,
    };
  })()`;
  let combos = 0, narrowest = null;
  for (const width of [320, 800, 1420]) for (const dark of [true, false]) for (const seat of ['personal', 'classroom']) for (const forcedColors of [false, true]) {
    combos++;
    await browser.load(`<style>${tokens}\n${css}</style><div class="hps-shell" data-chat-detail="${seat}">${panel}</div><template id="sheet">${sheet}</template>`, { width, dark, forcedColors });
    assert.equal(await browser.evaluate(place), true);
    const m = await browser.evaluate(measure);
    const ctx = `${width}px ${dark ? 'dark' : 'light'} ${seat}${forcedColors ? ' forced' : ''}: ${JSON.stringify(m)}`;
    if (width === 320 && !forcedColors && seat === 'personal' && dark) narrowest = m;
    assert.equal(m.title.text, '공개하기 전에 확인해요', ctx);
    assert.equal(m.bullets.length, 3, ctx);
    for (const b of m.bullets) {
      assert.ok(b.lines >= 1 && b.lines <= 2, `bullet ${b.lines} lines: ${ctx}`);
      assert.ok(b.font >= 14, `bullet text ${b.font}px: ${ctx}`);
      // Font-independent bound: the bullet fits two lines even if every glyph were this wide.
      const worst = (b.hangul + b.other * 0.6) * b.font;
      assert.ok(worst <= 2 * b.width, `worst-case width ${worst} > 2 x ${b.width}: ${ctx}`);
      if (!forcedColors) assert.ok(b.contrast !== null && b.contrast >= 4.5, `bullet contrast ${b.contrast}: ${ctx}`);
    }
    assert.deepEqual(m.buttons.map(b => b.text), ['알겠어요', '취소'], ctx);
    for (const b of m.buttons) {
      assert.ok(b.h >= 44 && b.w >= 44 && b.font >= 14, `button size: ${ctx}`);
      assert.ok(b.border === 'solid' && b.borderWidth >= 1, `button edge: ${ctx}`);
      if (!forcedColors) assert.ok(b.contrast !== null && b.contrast >= 4.5, `button contrast ${b.contrast}: ${ctx}`);
    }
    assert.ok(m.sheet.border === 'solid' && m.sheet.borderWidth >= 1, `sheet edge: ${ctx}`);
    assert.ok(m.sheet.font >= 14, ctx);
    assert.ok(m.sheet.scroll <= m.sheet.client + 1 && m.sheet.right <= m.viewport + 1 && m.docScroll <= m.viewport + 1, `no horizontal overflow: ${ctx}`);
    const focus = await browser.focusVisibleStyle('.hps-publish-notice-ack');
    assert.ok(parseFloat(focus['outline-width']) >= 2, ctx); assert.equal(focus['outline-style'], 'solid', ctx);
  }
  console.log(`measured at 320px: font ${narrowest.platformFont}; bullets ${narrowest.bullets.map(b => `${b.lines} line(s), worst ${((b.hangul + b.other * 0.6) * b.font).toFixed(0)}/${2 * b.width}px`).join('; ')}`);
  console.log(`PASS notice computed layout: 320/800/1420 x dark/light x personal/classroom x forced colours (${combos} renders)`);
} finally { await browser.close(); }
