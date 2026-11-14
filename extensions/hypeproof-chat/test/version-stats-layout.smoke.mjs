// CGP-ART-D-013: the stat tiles in the real PublishPanel markup and the real stylesheet, computed in headless Chromium
// at 320 and 1280 px, dark and light. Checks what does not depend on the machine's fonts: the tiles are visible buttons
// of at least 44x44 px, their text is at least 14 px, the number uses tabular figures, nothing scrolls sideways or leaves
// the column, at 1280 the two tiles sit side by side, and the empty / unknown / loading states replace the tiles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderComponent } from './sx-render.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw new Error('Chromium required'); console.log('NOT RUN version stats layout: no Chromium'); process.exit(0); }
const css = readFileSync(new URL('../webview-ui/src/styles.css', import.meta.url), 'utf8');
const tokens = ['designTokens.css', 'tokens.css'].map((f) => readFileSync(new URL(`../webview-ui/src/${f}`, import.meta.url), 'utf8')).join('\n');
const src = (id) => ({ session_id: id, experiment_id: 'e', at: Date.now() - 3_600_000, pages: 12, clicks: 40, completed: true });
const ok = { state: 'ok', opened: { last: 128, prev: 9, sources: [src('ps_aaaaaa1')] }, completed: { last: 7, prev: 11, sources: [src('ps_aaaaaa1')] } };
const base = { available: true, reason: null, project: null, version: { id: 'v1', files: [], manifest_added: [], refusal: null, refusal_lines: [] }, verification: { state: 'not_verified', open: [] }, hypotheses: [], timing: null, notice: null,
  experiments: [{ id: 'e', product_version_id: 'v1', question: '내 페이지', week: 1, method: 'task_test', success_criteria: [], hypothesis: null, current_version: true, status: 'running', links: [], sessions: null }] };
const measure = `(() => {
  const vw = document.documentElement.clientWidth, out = { tiles: [], doc: document.documentElement.scrollWidth <= vw + 1 };
  for (const t of document.querySelectorAll('.hps-stat-tile')) {
    const r = t.getBoundingClientRect(), v = t.querySelector('.hps-stat-value');
    out.tiles.push({ w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, inside: r.right <= vw + 1 && r.left >= -1,
      minFont: Math.min(...[...t.querySelectorAll('span')].map((s) => parseFloat(getComputedStyle(s).fontSize))), tab: v ? getComputedStyle(v).fontVariantNumeric : '',
      overflow: t.scrollWidth > t.clientWidth + 1, visible: getComputedStyle(t).visibility === 'visible' && r.width > 0 });
  }
  const st = document.querySelector('[data-testid^="stat-empty"], [data-testid="stat-unknown"], [data-testid="stat-loading"]');
  out.state = st ? { text: st.textContent, font: parseFloat(getComputedStyle(st).fontSize), right: st.getBoundingClientRect().right <= vw + 1 } : null;
  return out;
})()`;
const browser = await launch(bin);
let renders = 0;
try {
  for (const [name, stats] of Object.entries({ ok, empty: { state: 'empty' }, unknown: { state: 'unknown' }, loading: { state: 'loading' } })) {
    const markup = await renderComponent('PublishPanel', { view: { ...base, stats: { v1: stats } }, error: null, errorLines: [], shareUrl: null, busy: false });
    for (const width of [320, 1280]) for (const dark of [true, false]) {
      renders++;
      await browser.load(`<style>${tokens}\n${css}</style><div class="hps-shell" data-chat-detail="personal">${markup}</div>`, { width, dark });
      const m = await browser.evaluate(measure), ctx = `${name} ${width}px ${dark ? 'dark' : 'light'}: ${JSON.stringify(m)}`;
      assert.ok(m.doc, `no sideways scroll: ${ctx}`);
      if (name === 'ok') {
        assert.equal(m.tiles.length, 2, ctx);
        for (const t of m.tiles) {
          assert.ok(t.visible && t.inside && !t.overflow, `tile visible inside the column: ${ctx}`);
          assert.ok(t.w >= 44 && t.h >= 44, `44px target: ${ctx}`);
          assert.ok(t.minFont >= 14, `text ≥ 14px: ${ctx}`);
          assert.match(t.tab, /tabular-nums/, `tabular figures: ${ctx}`);
        }
        if (width === 1280) assert.ok(Math.abs(m.tiles[0].top - m.tiles[1].top) < 1 && m.tiles[1].left > m.tiles[0].right - 1, `side by side at 1280: ${ctx}`);
        else assert.ok(m.tiles[1].left >= m.tiles[0].left - 1, ctx);
      } else {
        assert.equal(m.tiles.length, 0, `${name} replaces the tiles: ${ctx}`);
        assert.ok(m.state && m.state.font >= 14 && m.state.right, `${name} text visible: ${ctx}`);
      }
    }
  }
  console.log(`PASS version stats layout: ok/empty/unknown/loading x 320/1280 x dark/light (${renders} renders)`);
} finally { await browser.close(); }
