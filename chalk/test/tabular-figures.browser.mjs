// CGP-DS-R-030 / REQ-CGP-DS-35: Chalk's seat tables, usage figures, counters and timers use tabular figures.
// Each REAL served page is rendered in headless Chromium through its own render functions with synthetic data (no Service,
// no network) and the COMPUTED `font-variant-numeric` of every numeric element is measured at 1420, 800 and 390px, so a
// later override, an `@media` rule or a UA `font` reset on a control (buttons, inputs) cannot slip through.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('tabular-figures.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  tabular-figures.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
// about:blank is an insecure context without crypto.randomUUID; without this shim some pages stop at their first call.
// about:blank also denies Web Storage, which /board reads at load; an in-memory stand-in keeps its script running.
const SHIM = '<script>{const mem=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}};Object.defineProperty(window,"localStorage",{value:mem(),configurable:true});Object.defineProperty(window,"sessionStorage",{value:mem(),configurable:true});}if (!crypto.randomUUID) crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000";window.fetch = async () => new Response("{}");</script>';
const served = async (route) => {
  const raw = await (await app.fetch(new Request('https://chalk.test/' + route), { ENVIRONMENT: 'test' })).text();
  const at = /<head\b[^>]*>/i.test(raw) ? /<head\b[^>]*>/i : /<html\b[^>]*>/i;
  return raw.replace(at, (m) => m + SHIM);
};

const NOW = 'Date.now()';
// Every scene renders numbers through the page's own code, then names the elements that carry them.
const SCENES = {
  manage: {
    setup: `(() => {
      const now = ${NOW};
      const seats = Array.from({ length: 12 }, (_, i) => ({ seat_id: 'A' + (i + 1), student_id: '학생-' + (i + 10), attention: ['ok', 'caution', 'blocked', 'unknown'][i % 4], signal: 'fresh' }));
      token = 't'; cohort = 'c1'; helpState = 'ok'; helpCounts = { open: 2, answered: 0 }; helpExpanded = true;
      opsData = { seats, counts: { total: 12, runtime_ready: 9 }, run: { class_run_id: 'R1', roster_revision: 1, flags: {} } };
      helpRows = [1, 2].map((n) => ({ id: 'h' + n, kind: 'help', session_id: 'S1', student_id: '학생-' + (n + 9), status: 'received', revision: 1, created_at: Math.floor(now / 1000) - 60 * n * 7, expires_at: Math.floor(now / 1000) + 3600 }));
      board = { session: { session_id: 'S1' }, seats: [] };
      renderSummary(opsData); renderSeats(opsData);
      opsQuery = 'A1'; applySeatFilter();
      renderBoard({ session: { session_id: 'S1' }, roster: { rendered: 12 }, now, seats: [{ user_id: '학생-10', idle_ms: 11 * 60000, calls_in_session: 118, failures_in_session: 0, heartbeat: 'alive' }] });
      renderHelp();
      document.getElementById('ops-state').textContent = '명단 12명 중 앱 준비 완료 9';
    })()`,
    targets: {
      'seat table cell': '#ops-rows td',
      'seat id': '#ops-rows td.c-seat strong',
      'summary counter': '#ops-summary button',
      'state filter count': '#ops-state-filters .cgp-state-filter',
      'help badge': '#nav-help',
      'shown counter': '#ops-shown',
      'class counts': '#ops-state',
      'legacy seat usage': '#seats .seat p',
      'legacy filter count': '#legacy-state-filters .cgp-state-filter',
      'help queue age': '#ops-help-list li',
    },
  },
  budgets: {
    setup: `(() => {
      const bal = (m) => ({ meter: m, available: 1234500000, spent: 11000000, held: 0, allocated: 7000000, overrun: 0, unresolved: 1, granted: 2000000000 });
      const account = { id: 'b1', kind: 'cap', scope_id: 's', paused: false, revision: 1, max_concurrent: 4 };
      view = { as_of: ${NOW}, truncated: false, forecast: { reason: '예상 소진 3일' }, seats: [{ user_id: '학생-10', subject_key: 'k10' }],
        budgets: [{ account, can_edit: true, requests: [], balances: [bal('currency:KRW'), bal('requests:count')],
          children: [{ account: { ...account, id: 'c1', scope_id: 'k10' }, balances: [bal('requests:count')] }] }] };
      render(); edit(view.budgets[0], view.budgets[0].children[0]);
    })()`,
    targets: {
      'usage figure': '#overview .metric strong',
      'usage breakdown': '#overview .metric small',
      'unresolved counter': '#overview .metric p',
      'per-seat usage': '#overview section > div > small',
      'limit input': '#limits input',
      'concurrency input': '#slots',
    },
  },
  board: {
    setup: `(() => {
      render({ error_signal: 'observed', degraded: [], seats: [
        { user_id: '학생-10', severity: 'ok', idle_ms: 61000, mean_wait_ms: 1200, calls_in_window: 18, failures_in_window: 0, heartbeat: 'alive', artifact_age_ms: 600000 },
        { user_id: '학생-11', severity: 'watch', idle_ms: 900000, mean_wait_ms: 8000, calls_in_window: 111, failures_in_window: 1, heartbeat: 'alive', artifact_age_ms: null } ] });
    })()`,
    targets: {
      'seat table cell': '#tbl td',
      'state filter count': '#summary .cgp-state-filter',
    },
  },
  console: {
    // The countdown markup is the string renderSession() builds for a live session; the tick fills it the same way.
    setup: `(() => {
      const host = document.createElement('div'); host.className = 'track live';
      host.innerHTML = '<div class="countdown" data-ends="2099-01-01T00:00:00Z">남은 시간 1:59:59</div>';
      (document.querySelector('main') || document.body).append(host);
    })()`,
    targets: { 'session timer': '.track .countdown' },
  },
};

const probe = (targets) => `(() => {
  const out = [];
  for (const [name, sel] of Object.entries(${JSON.stringify(targets)})) {
    const els = [...document.querySelectorAll(sel)];
    out.push({ name, sel, count: els.length,
      digits: els.filter((e) => /[0-9]/.test(e.value ?? '') || /[0-9]/.test(e.textContent)).length,
      bad: els.map((e) => getComputedStyle(e).fontVariantNumeric).filter((v) => !v.split(' ').includes('tabular-nums')) });
  }
  return out;
})()`;

// TABULAR_FIGURES_EVIDENCE=<dir> also saves a PNG per page and width (local review only; CI does not set it).
const evidence = process.env.TABULAR_FIGURES_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
let checked = 0;
const failures = [];
for (const [route, scene] of Object.entries(SCENES)) {
  const b = await launch(bin);
  try {
    await b.load(await served(route), { width: 1420, height: 900 });
    await b.evaluate(scene.setup);
    for (const width of [1420, 800, 390]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await new Promise((r) => setTimeout(r, 40));
      for (const t of await b.evaluate(probe(scene.targets))) {
        const id = `${route}@${width} ${t.name} (${t.sel})`;
        assert.ok(t.count > 0, `${id}: nothing rendered`);
        assert.ok(t.digits > 0, `${id}: no numeric content rendered, so the probe would prove nothing`);
        if (t.bad.length) failures.push(`${id}: ${t.bad.length}/${t.count} computed font-variant-numeric lack tabular-nums (${[...new Set(t.bad)].join(', ')})`);
        checked += t.count;
      }
      if (evidence) {
        const shot = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        writeFileSync(`${evidence}/chalk-${route}-${width}.png`, Buffer.from(shot.data, 'base64'));
      }
    }
    if (!failures.some((f) => f.startsWith(route + '@'))) console.log(`PASS ${route}: ${Object.keys(scene.targets).length} numeric surfaces use tabular figures at 1420/800/390px`);
  } finally { await b.close(); }
}
assert.ok(checked > 0);
assert.deepEqual(failures, [], 'every numeric surface uses tabular figures');
console.log(`tabular-figures.browser: ${checked} computed checks`);
