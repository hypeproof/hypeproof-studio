// DES-CGP-DS-23 / CGP-DS-D-018: computed geometry of the REAL Chalk pages in headless Chromium (CDP).
// Reuses the extension's headless helper. Without a browser this prints NOT RUN; with
// FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails. Never opens a window or sends OS input.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('list-rows.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  list-rows.browser (no headless Chromium); declaration tests still run');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const page = async (route) => (await app.fetch(new Request('https://chalk.test/' + route), { ENVIRONMENT: 'test' })).text();
// Only the first document loaded into a headless target runs its scripts, so each route gets its own
// browser and widths change through device-metrics emulation (container queries re-evaluate live).
const open = async (route, forcedColors = false) => {
  const b = await launch(bin);
  await b.load(await page(route), { width: 1420, height: 900, forcedColors });
  const resize = (width) => b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  return Object.assign(b, { resize });
};
const SEATS = `renderSeats({seats:Array.from({length:30},(_,i)=>({seat_id:'S'+i,student_id:'학생'+i,attention:'ok',signal:'fresh'}))});document.getElementById('ops-table').hidden=false;0`;
const WIDTHS = [390, 800, 1420];
// Every list-row action shipped on the static pages, plus the seat rows rendered by the page's own renderSeats().
const ACTIONS = 'tbody button, tbody a, li button, li summary, #steps>.step button, .flow a, .flow-more a, .flow-more summary';
const probe = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  return [...document.querySelectorAll(${JSON.stringify(ACTIONS)})].filter(vis).map((e) => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect(), range = document.createRange();
    range.selectNodeContents(e);
    return { name: e.tagName + '.' + e.className + ' ' + e.textContent.trim().slice(0, 20), h: r.height, w: r.width, font: parseFloat(s.fontSize),
      display: s.display, icon: getComputedStyle(e, '::before').maskImage, content: getComputedStyle(e, '::before').content, iconDisplay: getComputedStyle(e, '::before').display, iconW: getComputedStyle(e, '::before').width,
      lines: new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size, clipped: e.scrollWidth > e.clientWidth + 1, summary: e.tagName === 'SUMMARY' };
  });
})()`;
let checked = 0;
const ROUTES = ['console', 'start', 'issuer', 'board', 'authoring', 'manage', 'budgets', 'sharing', 'learn'];
for (const route of ROUTES) {
  const b = await open(route);
  try {
    if (route === 'manage') await b.evaluate(SEATS);
    for (const width of WIDTHS) {
      await b.resize(width); await new Promise((r) => setTimeout(r, 50));
      for (const a of await b.evaluate(probe)) {
        const id = `${route}@${width} ${a.name}`;
        assert.ok(a.h >= 43.5, `${id}: target ${a.h}px < 44`);
        assert.ok(a.font >= 12, `${id}: font ${a.font}px < 12 (Chalk base floor)`);
        assert.notEqual(a.display, 'inline', `${id}: inline display collapses the 44px target`);
        assert.ok(a.summary || a.icon.includes('data:image/svg+xml'), `${id}: persistent icon missing at ${width}px`);
        assert.ok(a.summary || (a.content === '""' && a.iconDisplay !== 'none' && parseFloat(a.iconW) >= 16), `${id}: icon not drawn (${a.iconDisplay} ${a.iconW}, button ${a.w}px)`);
        assert.ok(!a.clipped, `${id}: label clipped (${a.w}px)`);
        checked++;
      }
      if (route === 'start') {
        // Inline prose links stay inline with no injected arrow (inline links are exempt from 44px, WCAG 2.5.8).
        const prose = await b.evaluate(`(() => { const a = document.querySelector('ol li > a'); const s = getComputedStyle(a); return { display: s.display, icon: getComputedStyle(a, '::before').content }; })()`);
        assert.equal(prose.display, 'inline', 'start prose link stays inline');
        assert.ok(prose.icon === 'none' || prose.icon === 'normal', 'no arrow injected into prose: ' + prose.icon);
      }
      if (route === 'manage') {
        const seats = await b.evaluate(`(() => {
          const rows = [...document.querySelectorAll('.ops-seat')], out = { count: rows.length, bad: [], display: getComputedStyle(rows[0]).display };
          const box = (e) => e.getBoundingClientRect();
          for (const row of rows) {
            const rr = box(row), kids = [...row.querySelectorAll('td,td *')].filter((e) => { const b = box(e); return b.width > 1 && b.height > 1 && getComputedStyle(e).display !== 'none'; });
            for (const k of kids) { const b = box(k); if (b.left < rr.left - 1 || b.right > rr.right + 1 || b.top < rr.top - 1 || b.bottom > rr.bottom + 1) out.bad.push(row.dataset.seat + ' escapes row: ' + k.tagName + '.' + k.className); }
            const cells = [...row.children].map(box).filter((b) => b.width > 0 && b.height > 0);
            for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
              const x = Math.min(cells[i].right, cells[j].right) - Math.max(cells[i].left, cells[j].left), y = Math.min(cells[i].bottom, cells[j].bottom) - Math.max(cells[i].top, cells[j].top);
              if (x > 1 && y > 1) out.bad.push(row.dataset.seat + ' cells ' + i + '/' + j + ' overlap ' + x + 'x' + y);
            }
            const b = row.querySelector('.seat-open'), range = document.createRange(); range.selectNodeContents(b);
            if (new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size !== 1) out.bad.push(row.dataset.seat + ' 상세 wraps');
            if (rr.height < 43.5) out.bad.push(row.dataset.seat + ' row ' + rr.height + 'px');
            // ops-g1 (8 complete rows at 1280x720) needs the table row to be the 44px target, not 44px + a 1px cell border.
            if (getComputedStyle(row).display === 'table-row') {
              if (rr.height > 44.5) out.bad.push(row.dataset.seat + ' table row ' + rr.height + 'px, expected 44');
              const cell = row.querySelector('td.c-act'), line = getComputedStyle(cell, '::after');
              if (getComputedStyle(cell).borderBottomWidth !== '0px' || line.borderTopWidth === '0px' || line.position !== 'absolute') out.bad.push(row.dataset.seat + ' divider is not a zero-height pseudo line');
            }
          }
          return out;
        })()`);
        assert.equal(seats.count, 30);
        assert.deepEqual(seats.bad, [], `/manage seat rows at ${width}px (${seats.display})`);
        if (width === 390) assert.notEqual(seats.display, 'table-row', 'narrow width really exercises the card layout');
        // Scroll fade: first and last row sit inside the opaque part of the mask.
        const fade = await b.evaluate(`(() => {
          const list = document.getElementById('ops-seats'), rows = [...list.querySelectorAll('.ops-seat')], s = getComputedStyle(list);
          const edge = () => { const c = list.getBoundingClientRect(); return { top: c.top + parseFloat(s.borderTopWidth), bottom: c.bottom - parseFloat(s.borderBottomWidth) }; };
          list.scrollTop = 0; const t = rows[0].getBoundingClientRect().top - edge().top;
          list.scrollTop = list.scrollHeight; const b = edge().bottom - rows[rows.length - 1].getBoundingClientRect().bottom;
          return { mask: s.maskImage, top: t, bottom: b, focusMask: (list.focus(), getComputedStyle(list).maskImage, (() => { const m = getComputedStyle(list).maskImage; list.blur(); return m; })()) };
        })()`);
        assert.ok(fade.mask.includes('16px') && fade.mask.includes('32px'), 'fade mask 16/32: ' + fade.mask);
        assert.ok(fade.top >= 15.5, `first seat row below the top fade (${fade.top}px)`);
        assert.ok(fade.bottom >= 31.5, `last seat row above the bottom fade (${fade.bottom}px) at ${width}px`);
        assert.equal(fade.focusMask, 'none', 'focus inside removes the fade');

      }
    }
  } finally { await b.close(); }
}
{
  const b = await open('manage', true);
  try { await b.evaluate(SEATS); assert.equal(await b.evaluate(`getComputedStyle(document.getElementById('ops-seats')).maskImage`), 'none', 'forced colours removes the fade'); } finally { await b.close(); }
}
assert.ok(checked >= 90, 'enough real actions measured: ' + checked);
console.log(`list rows (real pages, 390/800/1420, ${checked} actions): 44px targets, icons, 12px text floor, no overlap, fade PASS`);
