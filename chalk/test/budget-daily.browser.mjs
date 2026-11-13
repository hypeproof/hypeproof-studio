// CGP-SHELL-R-031 / CGP-SHELL-D-030 — the daily class-usage chart on the REAL served /budgets page, driven through the page's
// own render() in headless Chromium (no Service, no OS input, no visible window).
// Designed behavior: 14 Korea days per class budget; each day stacks confirmed (solid), reserved (hatched) and unconfirmed
// (dashed outline); the legend names all three in words; a day with unconfirmed lines but no amount yet is marked and
// written as 미확인 (금액 확인 전), never 0; 표로 보기 shows the same numbers in a table and back; the header carries the
// as-of time and says 30분 넘게 지난 숫자 when the read is older; no usage → a sentence, no chart; a Service without the
// daily view → a sentence; at 320 and 1280 px nothing leaves the page, text is at least 14 px and the toggle is 44 px.
// The fixture is hypeproof-service#270's contract: budgets[].daily_usage[] = {meter, time_zone, days: [{date,
// confirmed_amount, reserved_amount, unconfirmed_amount: null while unresolved costs remain}]}.
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
const row = (date, o = {}) => ({ date, confirmed_amount: 0, reserved_amount: 0, unconfirmed_amount: 0, ...o });
const daily = (meters) => Object.entries(meters).map(([meter, rows]) => ({ meter, time_zone: 'Asia/Seoul', days: rows }));
const series = days.map((d, i) => i === 13 ? row(d, { confirmed_amount: 2_500_000, reserved_amount: 910_000, unconfirmed_amount: null }) : i === 12 ? row(d, { confirmed_amount: 1_000_000, unconfirmed_amount: 300_000 }) : i === 11 ? row(d, { confirmed_amount: 400_000, unconfirmed_amount: null }) : row(d));
const budget = (d) => ({ account: { id: 'pool:abc', paused: false }, balances: [{ meter: M, available: 1, spent: 1, held: 0, allocated: 0, unresolved: 0, overrun: 0 }], ...(d === undefined ? {} : { daily_usage: d }), can_edit: false, children: [], requests: [], truncated: false });
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
    check(JSON.stringify(m.kinds) === JSON.stringify(['2026-11-12:confirmed', '2026-11-12:unconfirmed-unknown', '2026-11-13:confirmed', '2026-11-13:unconfirmed', '2026-11-14:confirmed', '2026-11-14:reserved', '2026-11-14:unconfirmed-unknown']), 'stacks per day, the unknown amount marked: ' + ctx);
    check(m.legend.length === 3 && m.legend[0].includes('확인된 사용 (채움)') && m.legend[1].includes('예약 (빗금)') && m.legend[2].includes('미확인 (점선 윤곽'), 'legend in words: ' + ctx);
    check(m.head.includes('기준 시각') && m.head.includes('한국 시간 기준') && m.stale, 'as-of time, fresh: ' + ctx);
    check(m.docFits && m.boxRight, 'nothing leaves the page: ' + ctx);
    check(m.minFont >= 14, 'text ≥ 14px: ' + ctx);
    // The hatch is the reserved part's meaning (not colour): the reserved bar is filled with the hatch pattern, which exists.
    const hatch = await b.evaluate(`(() => { const r = document.querySelector('[data-daily] [data-kind="reserved"]'); const f = r.getAttribute('fill'); const id = (f.match(/^url\\(#(.+)\\)$/) || [])[1];
      const p = id && document.getElementById(id); return { f, pattern: !!p && p.tagName.toLowerCase() === 'pattern' && !!p.querySelector('line') }; })()`);
    check(/^url\(#hatch-/.test(hatch.f) && hatch.pattern, 'reserved is hatched: ' + JSON.stringify(hatch));
    check(await b.evaluate(`(() => { const r = document.querySelector('[data-daily] [data-kind="confirmed"]'); return r.getAttribute('fill') === 'currentColor'; })()`), 'confirmed is solid');
    check(await b.evaluate(`(() => { const r = document.querySelector('[data-daily] [data-kind="unconfirmed"]'); return r.getAttribute('fill') === 'none' && !!r.getAttribute('stroke-dasharray'); })()`), 'unconfirmed is a dashed outline');
    // Day labels keep their size whatever the chart scales to: rendered (not computed) height, and no overlap.
    const lab = await b.evaluate(`(() => { const vw = document.documentElement.clientWidth; const r = [...document.querySelectorAll('[data-daily] .daily-days span')].map((s) => { const b = s.getBoundingClientRect(); return { t: s.textContent, h: b.height, l: b.left, r: b.right, sw: s.scrollWidth, cw: s.clientWidth }; }); return { r, vw }; })()`);
    check(JSON.stringify(lab.r.map((x) => x.t)) === JSON.stringify(['2', '4', '6', '8', '10', '12', '14']), 'seven day-of-month labels, the last is today: ' + JSON.stringify(lab));
    check(m.head.includes('11/1–11/14'), 'the range with its month is named: ' + m.head);
    check(lab.r.every((x) => x.h >= 12) && lab.r.every((x, i) => i === 0 || x.l >= lab.r[i - 1].r - 0.5) && lab.r.every((x) => x.r <= lab.vw + 1 && x.sw <= x.cw + 1), 'labels at least 12px rendered, apart and inside: ' + width + ' ' + JSON.stringify(lab.r));
    check(m.toggle.text === '표로 보기' && m.toggle.h >= 44 && m.toggle.w >= 44 && m.toggle.pressed === 'false' && m.tableHidden, 'toggle 44px, table hidden: ' + ctx);
    // The table gives the same numbers, and never a bare 0 for an unknown amount.
    await b.evaluate(`document.querySelector('[data-daily-toggle]').click()`);
    const t = await b.evaluate(`(() => { const box = document.querySelector('[data-daily]'); return { hidden: box.querySelector('.daily-table').hidden, chart: getComputedStyle(box.querySelector('svg[role="img"]')).display,
      rows: [...box.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => c.textContent)), toggle: box.querySelector('[data-daily-toggle]').textContent, fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 }; })()`);
    check(!t.hidden && t.chart === 'none' && t.toggle === '그래프로 보기' && t.rows.length === 14, 'table view: ' + JSON.stringify(t));
    check(JSON.stringify(t.rows[13]) === JSON.stringify(['11/14', '2.5', '0.91', '미확인 (금액 확인 전)']), 'last day: ' + JSON.stringify(t.rows[13]));
    check(JSON.stringify(t.rows[12]) === JSON.stringify(['11/13', '1', '0', '0.3 (확정 전)']), 'a positive unconfirmed amount says it is not final: ' + JSON.stringify(t.rows[12]));
    check(JSON.stringify(t.rows[11]) === JSON.stringify(['11/12', '0.4', '0', '미확인 (금액 확인 전)']), 'confirmed plus unresolved: the unknown part is said, never folded into a total: ' + JSON.stringify(t.rows[11]));
    check(!t.rows.some((r) => /건/.test(r.join(' '))), 'no count wording: #270 sends no count');
    check(JSON.stringify(t.rows[0]) === JSON.stringify(['11/1', '0', '0', '0']), 'an empty day: ' + JSON.stringify(t.rows[0]));
    check(t.fits, 'table fits or scrolls inside its own box: ' + width);
    await b.evaluate(`document.querySelector('[data-daily-toggle]').click()`);
    check(await b.evaluate(`document.querySelector('.daily-table').hidden`), 'back to the chart');
  }
  // Forced colours, light and dark: the chart takes the system text colour, readable on the canvas.
  for (const dark of [false, true]) {
    await b.load(html, { width: 1280, height: 900, forcedColors: true, dark });
    await b.evaluate(show(viewOf(daily({ [M]: series }))));
    const fc = await b.evaluate(`(() => { const rgb = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number); const lum = (c) => rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const bg = (() => { for (let e = document.querySelector('[data-daily]'); e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c; } return getComputedStyle(document.documentElement).backgroundColor; })();
      const fill = getComputedStyle(document.querySelector('[data-daily] [data-kind="confirmed"]')).fill, stroke = getComputedStyle(document.querySelector('[data-daily] [data-kind="unconfirmed"]')).stroke;
      const ratio = (a, c) => { const [x, y] = [lum(a), lum(c)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      return { bg, fill, stroke, fillRatio: ratio(fill, bg), strokeRatio: ratio(stroke, bg) }; })()`);
    check(fc.fillRatio >= 4.5 && fc.strokeRatio >= 4.5, `forced colours ${dark ? 'dark' : 'light'}: chart readable on the canvas: ` + JSON.stringify(fc));
  }
  await b.load(html, { width: 1280, height: 900 });
  // Stale: the read is older than 30 minutes.
  await b.evaluate(show(viewOf(daily({ [M]: series }), new Date(Date.now() - 31 * 60000).toISOString())));
  check(await b.evaluate(`(() => { const s = document.querySelector('[data-stale]'); return !s.hidden && s.textContent === '30분 넘게 지난 숫자 · 새로 확인하세요'; })()`), 'stale label');
  // No usage at all → a sentence, no chart. A Service without the daily view → a sentence.
  await b.evaluate(show(viewOf(daily({ [M]: days.map((d) => row(d)) }))));
  check(await b.evaluate(`!document.querySelector('[data-daily] svg[role="img"]') && document.querySelector('[data-daily]').textContent.includes('최근 14일 사용 기록이 없습니다.')`), 'empty: sentence instead of chart');
  await b.evaluate(show(viewOf(undefined)));
  check(await b.evaluate(`document.querySelector('[data-daily]').textContent.includes('일별 사용을 확인하지 못했습니다.')`), 'no daily view: said, not drawn as 0');
  // Two currency meters: a chooser. A malformed amount is shown as unknown, not as 0.
  await b.evaluate(show(viewOf(daily({ 'currency:KRW:micro': days.map((d, i) => row(d, i === 13 ? { confirmed_amount: 'x' } : {})), [M]: series }))));
  check(await b.evaluate(`document.querySelector('[data-daily] select')?.options.length === 2`), 'meter chooser');
  await b.evaluate(`(() => { const s = document.querySelector('[data-daily] select'); s.value = 'currency:KRW:micro'; s.dispatchEvent(new Event('change')); document.querySelector('[data-daily-toggle]').click(); return 0; })()`);
  check(await b.evaluate(`[...document.querySelectorAll('[data-daily] tbody tr')].at(-1).lastElementChild.textContent === '미확인 (금액 확인 전)'`), 'malformed amount → unknown');
  console.log(`PASS budget-daily.browser: ${checks} checks (chart, legend, unknown amounts, table toggle, stale, empty, 320/1280)`);
} finally { await b.close(); }
