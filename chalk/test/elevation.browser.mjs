// CGP-DS-R-012 / REQ-CGP-DS-13 / DES-CGP-DS-13: Chalk's elevated surfaces on the REAL /manage page in
// headless Chromium (CDP). Chalk is dark only, so every elevated surface uses the dark alpha of a named
// level (>= .2); forced colors drops the shadow and the 1px border on the exposed edge stays.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
// Never opens a window or sends OS input.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('elevation.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  elevation.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const html = await (await app.fetch(new Request('https://chalk.test/manage'), { ENVIRONMENT: 'test' })).text();
// selector -> exposed edge. 1000px: below 1199px the side menu is a drawer, below 1080px the seat detail is.
const SURFACES = { '.side': 'right', '#ops-detail': 'left', '#ops-pick-by .menu-body': 'top' };
const open = `(() => {
  document.body.classList.add('side-open');
  document.getElementById('ops-split').classList.add('has-detail');
  document.getElementById('ops-detail').hidden = false;
  for (let n = document.getElementById('ops-pick-by'); n; n = n.parentElement) { if (n.hidden) n.hidden = false; if (n.tagName === 'DETAILS') n.open = true; }
  return 0;
})()`;
const probe = `(() => {
  const probe = document.createElement('div'); document.body.append(probe);
  const level = {}; for (const l of ['raised', 'overlay']) { probe.style.boxShadow = 'var(--ds-c-elevation-' + l + '-dark)'; level[l] = getComputedStyle(probe).boxShadow; }
  probe.remove();
  const out = {};
  for (const [sel, edge] of Object.entries(${JSON.stringify(SURFACES)})) {
    const el = document.querySelector(sel); const s = getComputedStyle(el); const E = edge[0].toUpperCase() + edge.slice(1);
    out[sel] = { shadow: s.boxShadow, width: parseFloat(s['border' + E + 'Width']), style: s['border' + E + 'Style'], visible: el.getBoundingClientRect().width > 0 };
  }
  return { level, out };
})()`;
const alphaOf = (shadow) => { const m = /rgba?\(([^)]*)\)/.exec(shadow); if (!m) return 0; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
for (const forcedColors of [false, true]) {
  // Only the first document loaded into a headless target runs its scripts: one browser per run.
  const b = await launch(bin);
  try {
    await b.load(html, { width: 1000, height: 900, forcedColors });
    await b.evaluate(open);
    const { level, out } = await b.evaluate(probe);
    for (const [sel, v] of Object.entries(out)) {
      assert.ok(v.visible, `${sel} must render`);
      assert.ok(v.width >= 1 && v.style === 'solid', `${sel}: 1px solid border on its exposed edge (${v.width}px ${v.style})`);
      if (forcedColors) assert.equal(v.shadow, 'none', `forced colors: ${sel} has no shadow`);
      else {
        assert.ok(Object.values(level).includes(v.shadow), `${sel}: shadow ${v.shadow} is not a named level (${JSON.stringify(level)})`);
        assert.ok(alphaOf(v.shadow) >= 0.2, `${sel}: dark shadow alpha must be >= .2 (${v.shadow})`);
      }
    }
  } finally { await b.close(); }
}
console.log(`PASS elevation.browser: ${Object.keys(SURFACES).length} Chalk surfaces on a named dark level (alpha >= .2), flat with 1px borders in forced colors`);
