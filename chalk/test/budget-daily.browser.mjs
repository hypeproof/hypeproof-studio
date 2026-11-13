// CGP-SHELL-R-031 / CGP-SHELL-D-030 — the daily class-usage chart on the REAL served /budgets page, driven through the page's
// own render() in headless Chromium (no Service, no OS input, no visible window).
// Designed behavior: 14 Korea days per class budget; each day stacks confirmed (solid), reserved (hatched) and unconfirmed
// (dashed outline); the legend names all three in words; a day with unconfirmed lines but no amount yet is marked and
// written as 미확인 n건 (금액 확인 전), never 0; 표로 보기 shows the same numbers in a table and back; the header carries the
// as-of time and says 30분 넘게 지난 숫자 when the read is older; no usage → a sentence, no chart; a Service without the
// daily view → a sentence; at 320 and 1280 px nothing leaves the page, text is at least 14 px and the toggle is 44 px.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('budget-daily.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  budget-daily.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const SHIM = '<script>if (!crypto.randomUUID) crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000";window.fetch = async () => new Response("{}");</script>';
const served = await (await app.fetch(new Request('https://chalk.test/budgets'), { ENVIRONMENT: 'test' })).text();
const html = served.replace(/<head\b[^>]*>/i, (m) => m + SHIM);
const M = 'currency:USD:micro';
const days = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
const row = (day, o = {}) => ({ day, confirmed: 0, reserved: 0, unconfirmed: 0, unconfirmed_lines: 0, lines: 0, ...o });
const daily = (meters) => ({ day_basis: 'Asia/Seoul', days, meters });
const series = days.map((d, i) => i === 13 ? row(d, { confirmed: 2_500_000, reserved: 910_000, unconfirmed: 0, unconfirmed_lines: 2, lines: 5 }) : i === 12 ? row(d, { confirmed: 1_000_000, unconfirmed: 300_000, unconfirmed_lines: 1, lines: 3 }) : row(d));
const budget = (d) => ({ account: { id: 'pool:abc', paused: false }, balances: [{ meter: M, available: 1, spent: 1, held: 0, allocated: 0, unresolved: 0, overrun: 0 }], daily: d, can_edit: false, children: [], requests: [], truncated: false });
const viewOf = (d, asOf = new Date().toISOString()) => ({ schema: 'hps-class-budget/1', cohort: 'c1', as_of: asOf, budgets: [budget(d)], seats: [], truncated: false, forecast: { state: 'unavailable', reason: '-' } });
const show = (v) => `(() => { connected = true; cohort = 'c1'; view = ${JSON.stringify(v)}; render(); return true; })()`;
let checks = 0;
const check = (c, m) => { assert.ok(c, m); checks++; };
const b = await launch(bin);
try {
  for (const width of [320, 1280]) {
    await b.load(html, { width, height: 900 });
    await b.evaluate(show(viewOf(daily({ [M]: series }))));
    const m = await b.evaluate(`(() => { const box = document.querySelector('[data-daily]'); const vw = document.documentElement.clientWidth;
      const kinds = [...box.querySelectorAll('svg[role="img"] [data-kind]')].map((r) => r.closest('[data-day]').dataset.day + ':' + r.dataset.kind);
      return { kinds, groups: box.querySelectorAll('svg[role="img"] [data-day]').length, legend: [...box.querySelectorAll('[data-legend]')].map((l) => l.textContent),
        head: box.querySelector('.daily-head').textContent, stale: box.querySelector('[data-stale]').hidden, docFits: document.documentElement.scrollWidth <= vw + 1,
        boxRight: box.getBoundingClientRect().right <= vw + 1, minFont: Math.min(...[...box.querySelectorAll('h3, span, li, button, text')].map((n) => parseFloat(getComputedStyle(n).fontSize))),
        toggle: (() => { const t = box.querySelector('[data-daily-toggle]'); const r = t.getBoundingClientRect(); return { text: t.textContent, h: r.height, w: r.width, pressed: t.getAttribute('aria-pressed') }; })(),
        tableHidden: box.querySelector('.daily-table').hidden }; })()`);
    const ctx = `${width}px: ${JSON.stringify(m)}`;
    check(m.groups === 14, 'one group per day: ' + ctx);
    check(JSON.stringify(m.kinds) === JSON.stringify(['2026-11-13:confirmed', '2026-11-13:unconfirmed', '2026-11-14:confirmed', '2026-11-14:reserved', '2026-11-14:unconfirmed-unknown']), 'stacks per day, the unknown amount marked: ' + ctx);
    check(m.legend.length === 3 && m.legend[0].includes('확인된 사용 (채움)') && m.legend[1].includes('예약 (빗금)') && m.legend[2].includes('미확인 (점선 윤곽'), 'legend in words: ' + ctx);
    check(m.head.includes('기준 시각') && m.head.includes('한국 시간 기준') && m.stale, 'as-of time, fresh: ' + ctx);
    check(m.docFits && m.boxRight, 'nothing leaves the page: ' + ctx);
    check(m.minFont >= 14, 'text ≥ 14px: ' + ctx);
    check(m.toggle.text === '표로 보기' && m.toggle.h >= 44 && m.toggle.w >= 44 && m.toggle.pressed === 'false' && m.tableHidden, 'toggle 44px, table hidden: ' + ctx);
    // The table gives the same numbers, and never a bare 0 for an unknown amount.
    await b.evaluate(`document.querySelector('[data-daily-toggle]').click()`);
    const t = await b.evaluate(`(() => { const box = document.querySelector('[data-daily]'); return { hidden: box.querySelector('.daily-table').hidden, chart: getComputedStyle(box.querySelector('svg[role="img"]')).display,
      rows: [...box.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => c.textContent)), toggle: box.querySelector('[data-daily-toggle]').textContent, fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 }; })()`);
    check(!t.hidden && t.chart === 'none' && t.toggle === '그래프로 보기' && t.rows.length === 14, 'table view: ' + JSON.stringify(t));
    check(JSON.stringify(t.rows[13]) === JSON.stringify(['11/14', '2.5', '0.91', '미확인 2건 (금액 확인 전)']), 'last day: ' + JSON.stringify(t.rows[13]));
    check(JSON.stringify(t.rows[12]) === JSON.stringify(['11/13', '1', '0', '0.3 · 미확인 1건']), 'a day with an observed unconfirmed amount: ' + JSON.stringify(t.rows[12]));
    check(JSON.stringify(t.rows[0]) === JSON.stringify(['11/1', '0', '0', '0']), 'an empty day: ' + JSON.stringify(t.rows[0]));
    check(t.fits, 'table fits or scrolls inside its own box: ' + width);
    await b.evaluate(`document.querySelector('[data-daily-toggle]').click()`);
    check(await b.evaluate(`document.querySelector('.daily-table').hidden`), 'back to the chart');
  }
  // Stale: the read is older than 30 minutes.
  await b.evaluate(show(viewOf(daily({ [M]: series }), new Date(Date.now() - 31 * 60000).toISOString())));
  check(await b.evaluate(`(() => { const s = document.querySelector('[data-stale]'); return !s.hidden && s.textContent === '30분 넘게 지난 숫자 · 새로 확인하세요'; })()`), 'stale label');
  // No usage at all → a sentence, no chart. A Service without the daily view → a sentence.
  await b.evaluate(show(viewOf(daily({ [M]: days.map((d) => row(d)) }))));
  check(await b.evaluate(`!document.querySelector('[data-daily] svg[role="img"]') && document.querySelector('[data-daily]').textContent.includes('최근 14일 사용 기록이 없습니다.')`), 'empty: sentence instead of chart');
  await b.evaluate(show(viewOf(undefined)));
  check(await b.evaluate(`document.querySelector('[data-daily]').textContent.includes('일별 사용을 확인하지 못했습니다.')`), 'no daily view: said, not drawn as 0');
  // Two meters: a chooser, currency first.
  await b.evaluate(show(viewOf(daily({ 'requests:count': days.map((d, i) => row(d, i === 13 ? { confirmed: 7, lines: 7 } : {})), [M]: series }))));
  check(await b.evaluate(`document.querySelector('[data-daily] select')?.value === 'currency:USD:micro'`), 'meter chooser defaults to the currency meter');
  console.log(`PASS budget-daily.browser: ${checks} checks (chart, legend, unknown amounts, table toggle, stale, empty, 320/1280)`);
} finally { await b.close(); }
