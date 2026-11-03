// CGP-ART-R-011: real markup, committed declaration guards and computed cascade checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderComponent } from './sx-render.mjs';
import { rules } from './fixtures/stylesheet-rules.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const css = readFileSync(new URL('../webview-ui/src/styles.css', import.meta.url), 'utf8');
const value = (selector, property) => rules(css).filter(r => !r.media && r.selectors.includes(selector)).at(-1)?.decls[property];
assert.equal(value('.hps-publish-sharing', 'font-size'), 'var(--ds-c-studio-styles-type-17)');
assert.equal(value('.hps-publish-sharing', 'overflow-wrap'), 'anywhere');
assert.equal(value('.hps-publish-sharing button', 'font'), 'inherit');
assert.equal(value('.hps-publish-sharing button', 'min-height'), 'var(--ds-c-studio-tokens-control-md)');
assert.equal(value('.hps-publish-sharing button', 'min-width'), 'var(--ds-c-studio-tokens-control-md)');
assert.equal(value('.hps-publish-sharing button:focus-visible', 'outline'), 'var(--ds-c-focus-width) solid var(--hp-ring-focus-default)');
assert.equal(value('.hps-publish-sharing button:focus-visible', 'outline-offset'), 'var(--ds-c-focus-width)');
console.log('PASS sharing stylesheet guards');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw new Error('Chromium required'); console.log('NOT RUN sharing computed layout: no Chromium'); process.exit(0); }
let browser;
try { browser = await launch(bin); } catch (error) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw error; console.log(`NOT RUN sharing computed layout: ${error.message}`); process.exit(0); }
try {
  const future = Date.now() + 86400000;
  const link = (state) => ({ id: 'l', state, expires_at: future, share_url: 'https://test.invalid/l/a', qr: null });
  const exp = (links) => ({ id: 'e', product_version_id: 'v1', question: '내 페이지', week: 1, links });
  const base = { available: true, reason: null, project: null, version: { id: 'v1', files: [], manifest_added: [], refusal: null, refusal_lines: [] }, verification: { state: 'not_verified', open: [] }, hypotheses: [], timing: null, notice: null, experiments: [] };
  const failed = '공유 상태를 확인하지 못했어요 (503).';
  // Every sharing state the panel can show. `text` is what must be visible next to the version; `status` is the role="status" region.
  const states = {
    live: { view: { ...base, experiments: [exp([link('live')])] }, text: /링크가 있는 누구나 · .*까지 · 활성 링크 1개/, rows: 1, copy: true },
    unpublished: { view: { ...base, experiments: [exp([])] }, text: /나만 볼 수 있어요 · 활성 링크 0개/, rows: 1, copy: false },
    closed: { view: { ...base, experiments: [exp([link('revoked')])] }, text: /링크 끊김 · 활성 링크 0개/, rows: 1, copy: false },
    stale: { view: { ...base, experiments: [exp([link('live')])], read_failed: true, stale_at: Date.now() - 60000, reason: failed }, text: /에 확인한 상태/, rows: 1, copy: false, unknown: /공유 상태를 확인하지 못했어요 \(503\)\..*마지막 상태예요/ },
    'read error': { view: { ...base, available: false, read_failed: true, reason: failed }, text: null, rows: 0, copy: false, unknown: /^공유 상태를 확인하지 못했어요 \(503\)\.$/ },
  };
  const tokens = ['designTokens.css', 'tokens.css'].map(f => readFileSync(new URL(`../webview-ui/src/${f}`, import.meta.url), 'utf8')).join('\n');
  const measure = `(() => {
    const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c) || /color\\(srgb ([^)]+)\\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); const scale = c.startsWith('color(') ? 255 : 1; return { r: p[0] * scale, g: p[1] * scale, b: p[2] * scale, a: p.length > 3 ? p[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const backdrop = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) return c; } return null; };
    const out = { rows: [], blocks: [] };
    for (const block of document.querySelectorAll('.hps-publish-sharing')) {
      const br = block.getBoundingClientRect();
      out.blocks.push({ clientWidth: block.clientWidth, scrollWidth: block.scrollWidth, right: br.right, viewport: document.documentElement.clientWidth, height: br.height, font: parseFloat(getComputedStyle(block).fontSize) });
      for (const status of block.querySelectorAll('[role="status"]')) {
        const cs = getComputedStyle(status), r = status.getBoundingClientRect(), fg = parse(cs.color), bg = backdrop(status);
        const hi = fg && bg ? Math.max(lum(fg), lum(bg)) : 0, lo = fg && bg ? Math.min(lum(fg), lum(bg)) : 0;
        out.rows.push({ text: status.innerText, display: cs.display, visibility: cs.visibility, opacity: parseFloat(cs.opacity), width: r.width, height: r.height, fgAlpha: fg ? fg.a : null, contrast: fg && bg ? (hi + 0.05) / (lo + 0.05) : null, scrollWidth: status.scrollWidth, clientWidth: status.clientWidth, version: status.parentElement.getAttribute('data-version'), sharing: status.parentElement.getAttribute('data-sharing') });
      }
    }
    const button = document.querySelector('.hps-publish-sharing button');
    out.button = button ? { font: parseFloat(getComputedStyle(button).fontSize), height: button.getBoundingClientRect().height, width: button.getBoundingClientRect().width, disabled: button.disabled } : null;
    const title = document.querySelector('.hps-publish-experiment strong');
    out.title = title ? { text: title.textContent, overflow: title.scrollWidth > title.clientWidth } : null;
    return out;
  })()`;
  let combos = 0;
  for (const [name, spec] of Object.entries(states)) {
    const markup = await renderComponent('PublishPanel', { view: spec.view, error: null, errorLines: [], shareUrl: null, busy: false });
    for (const width of [320, 800, 1420]) for (const dark of [true, false]) for (const seat of ['personal', 'classroom']) for (const forcedColors of [false, true]) {
      combos++;
      await browser.load(`<style>${tokens}\n${css}</style><div class="hps-shell" data-chat-detail="${seat}">${markup}</div>`, { width, dark, forcedColors });
      const m = await browser.evaluate(measure);
      const ctx = `${name} ${width}px ${dark ? 'dark' : 'light'} ${seat}${forcedColors ? ' forced' : ''}: ${JSON.stringify(m)}`;
      // Visible label next to the version, in a role="status" region, with enough contrast.
      const expected = spec.rows + (spec.unknown ? 1 : 0);
      assert.equal(m.rows.length, expected, `status regions: ${ctx}`);
      const labels = m.rows.map(r => r.text);
      if (spec.text) assert.ok(labels.some(t => spec.text.test(t)), `label text: ${ctx}`);
      if (spec.unknown) assert.ok(labels.some(t => spec.unknown.test(t)), `unknown text: ${ctx}`);
      for (const r of m.rows) {
        assert.notEqual(r.display, 'none', ctx); assert.equal(r.visibility, 'visible', ctx); assert.ok(r.opacity > 0.99, ctx);
        assert.ok(r.width > 0 && r.height > 0 && r.text.trim().length > 0, `visible: ${ctx}`);
        assert.ok(r.fgAlpha === null || r.fgAlpha > 0.99, `text colour is not transparent: ${ctx}`);
        if (!forcedColors) assert.ok(r.contrast !== null && r.contrast >= 4.5, `contrast ${r.contrast}: ${ctx}`);
        assert.ok(r.scrollWidth <= r.clientWidth + 1, `status does not overflow: ${ctx}`);
      }
      for (const b of m.blocks) {
        assert.ok(b.height > 0 && b.font >= 14, ctx);
        assert.ok(b.scrollWidth <= b.clientWidth + 1 && b.right <= b.viewport + 1, `block inside the column: ${ctx}`);
      }
      if (spec.rows) {
        assert.ok(m.button && m.button.font >= 14 && m.button.height >= 44 && m.button.width >= 44, ctx);
        assert.equal(m.button.disabled, !spec.copy, `copy ${spec.copy ? 'on' : 'off'}: ${ctx}`);
        assert.equal(m.title.text, '내 페이지'); assert.equal(m.title.overflow, false, ctx);
        const focus = await browser.focusVisibleStyle('.hps-publish-sharing button');
        assert.ok(parseFloat(focus['outline-width']) >= 2); assert.equal(focus['outline-style'], 'solid');
      }
    }
  }
  console.log(`PASS sharing computed layout: live/unpublished/closed/stale/read error x personal/classroom x 320/800/1420 x dark/light/forced colors (${combos} renders)`);
} finally { await browser.close(); }
