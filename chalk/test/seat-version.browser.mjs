// CGP-SHELL-R-034 (REQ-SHELL-34) and CGP-SHELL-D-033 (DES-SHELL-33): the /manage seat table shows each seat's Studio version.
// The version comes from the heartbeat the board read already returns (`seats[].client_version`), joined on student_id.
// Run on the REAL served /manage page in headless Chromium through the page's own render functions (page-level only: no OS
// input, no visible window, no Service).
//   (a) a 버전 column sits in the dense G1 table, between 지금 상태 and 근거·조치, at most 96px wide;
//   (b) a known version reads as itself; a seat the board does not list, a null version or a malformed one reads 확인 불가,
//       an icon + words mark, never a guess;
//   (c) while the latest formal release is unknown (here: the page has not read it) no seat says 업데이트 필요; the D-033
//       look for a seat below the floor (amber icon + 업데이트 필요, version kept in the accessible text) is drawn by the
//       page's own cell renderer and measured;
//   (d) every seat row stays the 44px target (ops-g1), nothing in the cell is clipped, text is 14px or more, 확인 불가 reads on
//       one line, a version and 업데이트 필요 on at most two, a release version wraps only after its first dot (forced with
//       letter spacing so it does not depend on the machine's fonts), and the marks have no chip box;
//   (e) 순서 sorts by version, low→high and high→low, unknown last both ways, and back to the Service's order; the header
//       announces it with aria-sort; arrow keys follow the shown order; the choice survives a refresh and resets on disconnect;
//   (f) the 순서 control is a native 44px select: on the selection tools' row when that row is shown (adding no height there:
//       8 rows at 1280x720), on its own row above the table when the class has no remote action and so no such row;
//   (g) at 800, 600 and 390px (card rows, also the list beside the open detail at 1280) the version is labelled 버전 at the
//       end of the seat line, inside its row, overlapping nothing, and the card is no taller than without it;
//   (h) the legacy activity list says 버전 <version> / 버전 확인 불가 in its usage line;
//   (i) DEC-24 (Jay, 2026-11-12): through the page's own readLatest() and GET /studio/latest-release, a seat below the latest
//       formal release is flagged (an older release, an rc of the latest), a seat at it, above it (a newer release or rc) or
//       not on a release version is not, an unknown version stays 확인 불가; a feed that is down, answers 503, null or an rc
//       flags nobody and clears earlier flags; the page reads the feed at most every 5 minutes, from its refresh.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('seat-version.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  seat-version.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const SHIM = '<script>if (!crypto.randomUUID) crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000";window.fetch = async () => new Response("{}");</script>';
const served = await (await app.fetch(new Request('https://chalk.test/manage'), { ENVIRONMENT: 'test' })).text();
const html = served.replace(/<head\b[^>]*>/i, (m) => m + SHIM);

let checks = 0;
const check = (cond, msg) => { assert.ok(cond, msg); checks++; };
const settle = () => new Promise((r) => setTimeout(r, 80));

// Seven seats in the Service's order. The board knows five of them; S6 is not on the board and S7's heartbeat expired.
const VERSIONS = { S1: '2026.1111.0', S2: '2026.1109.0', S3: null, S4: '2026.1111.0-rc.1', S5: 'dev-build', S7: null };
const SETUP = `(() => {
  const versions = ${JSON.stringify(VERSIONS)};
  const ids = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
  connected = true; cohort = 'c1'; helpState = 'ok';
  window.__seats = ids.map((id) => ({ seat_id: id, student_id: 'student-' + id, attention: 'ok', signal: 'fresh', runtime: { status: 'running' } }));
  board = { session: { session_id: 'K1' }, roster: { rendered: 6 }, now: new Date().toISOString(),
    seats: Object.entries(versions).map(([id, v]) => ({ user_id: 'student-' + id, state: 'ok', idle_ms: 60000, calls_in_session: 3, failures_in_session: 0, heartbeat: 'alive', client_version: v })) };
  opsData = { seats: __seats, counts: { total: 7, runtime_ready: 7 }, run: { class_run_id: 'R1', roster_revision: 1, flags: {} }, actions: [] };
  renderSummary(opsData); renderSeats(opsData); renderSelection();
  return true;
})()`;
const rows = `[...document.querySelectorAll('#ops-rows .ops-seat')].map((r) => ({ seat: r.dataset.seat, ver: r.querySelector('td.c-ver').textContent }))`;
const order = async (b) => (await b.evaluate(rows)).map((r) => r.seat).join(',');
const choose = (b, v) => b.evaluate(`(() => { const s = document.getElementById('ops-sort'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); return document.getElementById('ops-ver-head').getAttribute('aria-sort'); })()`);

const b = await launch(bin);
try {
  await b.load(html, { width: 1420, height: 900 });
  await b.evaluate(SETUP); await settle();

  // (a) column in the dense table
  const head = await b.evaluate(`[...document.querySelectorAll('#ops-table thead th')].map((t) => t.innerText.trim())`);
  check(JSON.stringify(head) === JSON.stringify(['선택', '좌석 · 학생', '지금 상태', '버전', '근거·조치']), 'header: ' + JSON.stringify(head));
  check(await b.evaluate(`[...document.querySelectorAll('#ops-table col')].map((c) => c.className).join(',')`) === 'c-pick,c-seat,c-step,c-ver,c-act', 'colgroup carries c-ver');

  // (b) values, (c) no minimum → no 업데이트 필요
  const cells = await b.evaluate(rows);
  const byId = Object.fromEntries(cells.map((c) => [c.seat, c.ver]));
  check(byId.S1 === '2026.1111.0' && byId.S2 === '2026.1109.0' && byId.S4 === '2026.1111.0-rc.1' && byId.S5 === 'dev-build', 'known versions read as themselves: ' + JSON.stringify(byId));
  for (const id of ['S3', 'S6', 'S7']) check(byId[id] === '확인 불가', id + ' unknown reads 확인 불가: ' + byId[id]);
  check(!cells.some((c) => c.ver.includes('업데이트')), 'latest formal release unknown: nobody is marked 업데이트 필요');
  const unknownMark = await b.evaluate(`(() => { const c = document.querySelector('#ops-rows .ops-seat[data-seat="S6"] td.c-ver .cgp-state'); return { intent: c.dataset.intent, icon: c.querySelector('svg').getAttribute('data-icon'), hidden: c.querySelector('svg').getAttribute('aria-hidden') }; })()`);
  check(unknownMark.intent === 'neutral' && unknownMark.icon === 'help' && unknownMark.hidden === 'true', 'unknown is the neutral help mark: ' + JSON.stringify(unknownMark));
  const malformed = await b.evaluate(`[verInfo('2026.1111.0 <b>'), verInfo(''), verInfo(42), verInfo('x'.repeat(65))].map((i) => i.version)`);
  check(malformed.every((v) => v === null), 'malformed versions are unknown, never echoed: ' + JSON.stringify(malformed));

  // (c) the outdated look and the comparison it rests on
  const cmp = await b.evaluate(`[verInfo('2026.1105.0', '2026.1111.0').outdated, verInfo('2026.1111.0', '2026.1111.0').outdated, verInfo('2026.1112.0', '2026.1111.0').outdated,
    verInfo('2026.1111.0-rc.1', '2026.1111.0').outdated, verInfo('dev-build', '2026.1111.0').outdated, verInfo('2026.1111.0', null).outdated, verInfo(null, '2026.1111.0').outdated]`);
  check(JSON.stringify(cmp) === JSON.stringify([true, false, false, true, false, false, false]), 'below / equal / above / rc below release / unparseable / no minimum / unknown: ' + JSON.stringify(cmp));
  // The page's own cell renderer with a minimum, on a real row (S2 keeps it for the geometry checks below).
  const flag = await b.evaluate(`(() => {
    const td = document.querySelector('#ops-rows .ops-seat[data-seat="S2"] td.c-ver');
    versionCell(td, verInfo('2026.1109.0', '2026.1111.0'));
    const c = td.querySelector('.cgp-state'), label = c.querySelector('.cgp-state-label'), r = document.createRange(); r.selectNodeContents(label);
    const probe = document.createElement('span'); probe.style.color = 'var(--ink-warn)'; document.body.append(probe); const warn = getComputedStyle(probe).color; probe.remove();
    return { intent: c.dataset.intent, icon: c.querySelector('svg').getAttribute('data-icon'), words: label.textContent, text: td.textContent,
      color: getComputedStyle(c).color, iconColor: getComputedStyle(c.querySelector('svg')).color, warn, lines: new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size };
  })()`);
  check(flag.intent === 'caution' && flag.icon === 'alert' && flag.words === '업데이트 필요', 'outdated: caution alert icon + 업데이트 필요: ' + JSON.stringify(flag));
  check(flag.text === '2026.1109.0 · 업데이트 필요', 'outdated keeps the version in the accessible text: ' + flag.text);
  check(flag.color === flag.warn && flag.iconColor === flag.warn, 'icon and words are the amber warn ink: ' + JSON.stringify(flag));
  check(flag.lines <= 2, '업데이트 필요 takes at most two lines: ' + flag.lines);

  // (d) geometry in table rows, at the widths the e2e layout gate uses and the widest
  for (const width of [1420, 1280, 1024]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 720, deviceScaleFactor: 1, mobile: false }); await settle();
    const g = await b.evaluate(`(() => {
      const out = { display: getComputedStyle(document.querySelector('.ops-seat')).display, bad: [] };
      const lineCount = (node) => { const r = document.createRange(); r.selectNodeContents(node); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size; };
      for (const row of document.querySelectorAll('#ops-rows .ops-seat')) {
        const td = row.querySelector('td.c-ver'), box = td.getBoundingClientRect(), rr = row.getBoundingClientRect();
        if (box.width > 96.5) out.bad.push(row.dataset.seat + ' cell ' + box.width + 'px');
        if (rr.height > 44.5) out.bad.push(row.dataset.seat + ' row ' + rr.height + 'px');
        for (const e of td.querySelectorAll('*')) { const b = e.getBoundingClientRect(); if (b.width && (b.left < box.left - 0.5 || b.right > box.right + 0.5 || b.top < rr.top - 0.5 || b.bottom > rr.bottom + 0.5) && !e.classList.contains('sr-only')) out.bad.push(row.dataset.seat + ' ' + e.className + ' escapes'); }
        if (td.scrollWidth > td.clientWidth + 1) out.bad.push(row.dataset.seat + ' clipped');
        for (const e of [td, ...td.querySelectorAll('span')]) if (e.textContent.trim() && !e.classList.contains('sr-only') && parseFloat(getComputedStyle(e).fontSize) < 14) out.bad.push(row.dataset.seat + ' font ' + getComputedStyle(e).fontSize);
        // 확인 불가 reads on one line, a version and 업데이트 필요 on at most two; a release version that wraps breaks only after
        // its first dot (each of its two text pieces stays on one line), never inside a number.
        const words = td.querySelector('.ver-num, .cgp-state-label'), lines = lineCount(words);
        if (lines > (words.textContent === '확인 불가' ? 1 : 2)) out.bad.push(row.dataset.seat + ' "' + words.textContent + '" on ' + lines + ' lines');
        if (words.classList.contains('ver-num') && /^\\d+\\.\\d+\\.\\d+$/.test(words.textContent) && [...words.childNodes].some((n) => n.nodeType === 3 && lineCount(n) !== 1)) out.bad.push(row.dataset.seat + ' "' + words.textContent + '" breaks inside a number');
        const mark = td.querySelector('.cgp-state'); if (mark) { const ms = getComputedStyle(mark); if (ms.borderTopWidth !== '0px' || ms.paddingLeft !== '0px' || ms.paddingTop !== '0px') out.bad.push(row.dataset.seat + ' mark has a chip box'); }
      }
      const th = document.getElementById('ops-ver-head').getBoundingClientRect(); out.head = th.width;
      return out;
    })()`);
    check(g.display === 'table-row', width + ': table rows: ' + g.display);
    check(g.head <= 96.5, width + ': 버전 header ' + g.head + 'px');
    check(g.bad.length === 0, width + ': ' + g.bad.join('; '));
  }
  // Which font this machine draws the version in, and its width: one line of evidence for layout reports (CDP, read-only).
  {
    const { root } = await b.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await b.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#ops-rows .ops-seat[data-seat="S1"] .ver-num' });
    const { fonts } = await b.send('CSS.getPlatformFontsForNode', { nodeId });
    const w = await b.evaluate(`(() => { const n = document.querySelector('#ops-rows .ops-seat[data-seat="S1"] .ver-num'), r = document.createRange(); r.selectNodeContents(n); const td = n.closest('td'), cs = getComputedStyle(td); const by = new Map(); for (const q of r.getClientRects()) by.set(Math.round(q.top), (by.get(Math.round(q.top)) ?? 0) + q.width); return { lines: [...by.values()].map((x) => Math.round(x * 10) / 10), content: td.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }; })()`);
    console.log('  version text: ' + fonts.map((f) => f.familyName).join(', ') + ' · line widths ' + w.lines.join(' + ') + 'px in a ' + w.content + 'px cell');
  }
  // A wide font, forced with letter spacing so it does not depend on the machine's fonts: the version wraps after its first dot.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1420, height: 900, deviceScaleFactor: 1, mobile: false }); await settle();
  const wide = await b.evaluate(`(() => {
    const row = document.querySelector('#ops-rows .ops-seat[data-seat="S1"]'), n = row.querySelector('.ver-num'); n.style.letterSpacing = '3px';
    const tops = (node) => { const r = document.createRange(); r.selectNodeContents(node); return [...new Set([...r.getClientRects()].map((q) => Math.round(q.top)))]; };
    const parts = [...n.childNodes].filter((x) => x.nodeType === 3), out = { parts: parts.map((x) => x.textContent), tops: parts.map(tops), row: row.getBoundingClientRect().height, clipped: row.querySelector('td.c-ver').scrollWidth > row.querySelector('td.c-ver').clientWidth + 1 };
    n.style.letterSpacing = ''; return out;
  })()`);
  check(JSON.stringify(wide.parts) === JSON.stringify(['2026.', '1111.0']), 'a release version is two text pieces split after its first dot: ' + JSON.stringify(wide.parts));
  check(wide.tops.every((t) => t.length === 1) && wide.tops[0][0] < wide.tops[1][0] && wide.row <= 44.5 && !wide.clipped, 'wide text wraps as 2026. / 1111.0 inside a 44px row: ' + JSON.stringify(wide));
  await b.evaluate('renderSeats(opsData)'); await settle();

  // (e) sorting
  check(await order(b) === 'S1,S2,S3,S4,S5,S6,S7', 'default: the Service order');
  check(await b.evaluate(`document.getElementById('ops-ver-head').hasAttribute('aria-sort')`) === false, 'default: no aria-sort');
  check(await choose(b, 'asc') === 'ascending', 'asc: aria-sort ascending');
  check(await order(b) === 'S2,S4,S1,S5,S3,S6,S7', 'asc: 1109, 1111-rc.1, 1111, then other text, unknown last in Service order: ' + await order(b));
  check(await b.evaluate(`getComputedStyle(document.getElementById('ops-ver-head'), '::after').content`) !== 'none', 'asc: the header draws its arrow');
  check(await choose(b, 'desc') === 'descending', 'desc: aria-sort descending');
  check(await order(b) === 'S1,S4,S2,S5,S3,S6,S7', 'desc: 1111, 1111-rc.1, 1109, then other text, unknown still last: ' + await order(b));
  await b.evaluate(`(() => { const box = document.querySelector('#ops-rows .ops-seat[data-seat="S4"] input[type=checkbox]'); box.checked = true; box.onchange(); })()`);
  await b.evaluate('renderSeats(opsData)'); await settle();
  check(await order(b) === 'S1,S4,S2,S5,S3,S6,S7', 'the order survives a refresh of the rows');
  check(await b.evaluate(`document.querySelector('#ops-rows .ops-seat[data-seat="S4"] input[type=checkbox]').checked && picked.has('S4') && picked.size === 1`), 'sorting changes no selection');
  // Arrow keys move through the rows in the order shown.
  await b.evaluate(`document.querySelector('#ops-rows .ops-seat[data-seat="S1"] .seat-open').focus()`);
  await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await settle();
  check(await b.evaluate(`document.activeElement.closest('.ops-seat')?.dataset.seat`) === 'S4', 'ArrowDown from the first shown row reaches the second shown row');
  // Keyboard on the native select: focus it and press ArrowDown/ArrowUp (the select's own keys).
  await b.evaluate(`document.getElementById('ops-sort').focus()`);
  await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
  await settle();
  const keyed = await b.evaluate(`({ value: document.getElementById('ops-sort').value, sort: document.getElementById('ops-ver-head').getAttribute('aria-sort'), focus: document.activeElement.id })`);
  check(keyed.value === 'asc' && keyed.sort === 'ascending' && keyed.focus === 'ops-sort', 'keyboard: ArrowUp on the focused select picks 버전 낮은 순 and keeps focus: ' + JSON.stringify(keyed));
  check(await order(b) === 'S2,S4,S1,S5,S3,S6,S7', 'keyboard choice re-sorts the rows');
  check(await choose(b, 'none') === null, 'none: aria-sort removed');
  check(await order(b) === 'S1,S2,S3,S4,S5,S6,S7', 'none: back to the Service order');
  await choose(b, 'asc');
  await b.evaluate('opsReset()');
  const reset = await b.evaluate(`({ value: document.getElementById('ops-sort').value, sort: document.getElementById('ops-ver-head').getAttribute('aria-sort') })`);
  check(reset.value === 'none' && reset.sort === null, 'disconnect resets the order: ' + JSON.stringify(reset));
  await b.evaluate(SETUP); await settle();
  check(await order(b) === 'S1,S2,S3,S4,S5,S6,S7', 'a new connection starts in the Service order');

  // (f) the 순서 control: a visible native 44px select. With a remote action the selection tools' row is shown and the control
  // rides on it, adding no height; without one (this fixture so far) there is no such row and the control has its own row.
  const control = (width) => b.evaluate(`(() => {
    const s = document.getElementById('ops-sort'), r = s.getBoundingClientRect(), bulk = document.getElementById('ops-bulk'), label = document.getElementById('ops-sort-label');
    const withIt = bulk.getBoundingClientRect().height; label.style.display = 'none'; const without = bulk.getBoundingClientRect().height; label.style.display = '';
    return { tag: s.tagName, h: r.height, visible: r.width > 0 && s.checkVisibility(), inView: r.right <= innerWidth + 0.5 && r.left >= -0.5, font: parseFloat(getComputedStyle(s).fontSize),
      name: label.textContent.slice(0, 2), home: label.parentElement.id, bar: !bulk.hidden, order: !document.getElementById('ops-order').hidden, withIt, without };
  })()`);
  for (const [actions, home] of [[[], 'ops-order'], [[{ action: 'retry_diagnostics', enabled: true, held: true }], 'ops-bulk-row'], [[], 'ops-order']]) {
    await b.evaluate(`opsData.actions = ${JSON.stringify(actions)}; renderSelection(); 0`);
    for (const width of [1420, 1280, 1024, 390]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height: 720, deviceScaleFactor: 1, mobile: false }); await settle();
      const c = await control(width), id = width + ' ' + home + ': ';
      check(c.home === home && c.bar === (home === 'ops-bulk-row') && c.order === (home === 'ops-order'), id + 'the control lives on the right row: ' + JSON.stringify(c));
      check(c.tag === 'SELECT' && c.visible && c.inView, id + '순서 select visible in the viewport: ' + JSON.stringify(c));
      check(c.h >= 43.5 && c.font >= 14 && c.name === '순서', id + '44px, 14px, labelled 순서: ' + JSON.stringify(c));
      if (home === 'ops-bulk-row' && width >= 1024) check(Math.abs(c.withIt - c.without) <= 0.5, id + 'the control adds no height to the selection tools row: ' + c.withIt + ' vs ' + c.without);
    }
  }
  await b.evaluate(`opsReset(); 0`);
  check(await b.evaluate(`document.getElementById('ops-order').hidden`), 'disconnected: no stray 순서 row');
  await b.evaluate(SETUP); await settle();

  // (g) card rows: the version sits at the end of the seat line, so a card is no taller with it than without it
  for (const width of [800, 600, 390]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }); await settle();
    const g = await b.evaluate(`(() => {
      const out = { display: getComputedStyle(document.querySelector('.ops-seat')).display, bad: [], label: null };
      for (const row of document.querySelectorAll('#ops-rows .ops-seat')) {
        const rr = row.getBoundingClientRect(), cells = [...row.children].map((c) => [c.className, c.getBoundingClientRect()]).filter(([, b]) => b.width > 0 && b.height > 0);
        const ver = row.querySelector('td.c-ver').getBoundingClientRect();
        if (!(ver.width > 0 && ver.height > 0)) out.bad.push(row.dataset.seat + ' version hidden');
        const seat = row.querySelector('td.c-seat').getBoundingClientRect();
        if (Math.abs(ver.top - seat.top) > 2 || ver.left < seat.left) out.bad.push(row.dataset.seat + ' version not at the end of the seat line');
        const td = row.querySelector('td.c-ver'), shown = rr.height; td.style.display = 'none'; const hidden = row.getBoundingClientRect().height; td.style.display = '';
        if (shown > hidden + 0.5) out.bad.push(row.dataset.seat + ' card grows ' + hidden + ' -> ' + shown);
        for (const [n, b] of cells) if (b.left < rr.left - 1 || b.right > rr.right + 1 || b.top < rr.top - 1 || b.bottom > rr.bottom + 1) out.bad.push(row.dataset.seat + ' ' + n + ' escapes');
        for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) { const [a, p] = cells[i], [c, q] = cells[j]; const x = Math.min(p.right, q.right) - Math.max(p.left, q.left), y = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top); if (x > 1 && y > 1) out.bad.push(row.dataset.seat + ' ' + a + '/' + c + ' overlap'); }
      }
      out.label = getComputedStyle(document.querySelector('#ops-rows td.c-ver'), '::before').content;
      out.overflow = document.documentElement.scrollWidth > innerWidth + 1;
      return out;
    })()`);
    check(g.display !== 'table-row', width + ': card rows really drawn: ' + g.display);
    check(g.label.includes('버전'), width + ': the version is labelled 버전 in a card: ' + g.label);
    check(g.bad.length === 0 && !g.overflow, width + ': ' + g.bad.join('; ') + (g.overflow ? ' page overflow' : ''));
  }

  // (h) legacy activity list
  await b.evaluate(`renderBoard(board)`);
  const legacy = await b.evaluate(`Object.fromEntries([...document.querySelectorAll('#seats .seat')].map((r) => [r.dataset.user, r.querySelector('p.muted').textContent]))`);
  check(legacy['student-S1'].endsWith(' · 버전 2026.1111.0'), 'legacy row: ' + legacy['student-S1']);
  check(legacy['student-S3'].endsWith(' · 버전 확인 불가'), 'legacy unknown row: ' + legacy['student-S3']);

  // (i) DEC-24: the floor is the latest formal release, read by the page from GET /studio/latest-release.
  const FLOOR = { F1: '2026.1109.0', F2: '2026.1111.0-rc.1', F3: '2026.1111.0', F4: '2026.1112.0', F5: '2026.1111.1-rc.1', F6: 'dev-build', F7: null };
  // The helper's evaluate does not await a promise; readLatest() is async, so this one does.
  const evalAsync = async (expression) => { const r = await b.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed'); return r.result.value; };
  const floor = (answer, force = true) => evalAsync(`(async () => {
    window.__latest = 0;
    window.fetch = async (url) => { if (String(url) !== '/studio/latest-release') return new Response('{}'); window.__latest++; ${answer} };
    const versions = ${JSON.stringify(FLOOR)};
    board = { session: { session_id: 'K2' }, roster: { rendered: 7 }, now: new Date().toISOString(),
      seats: Object.entries(versions).map(([id, v]) => ({ user_id: 'student-' + id, state: 'ok', idle_ms: 60000, calls_in_session: 3, failures_in_session: 0, heartbeat: 'alive', client_version: v })) };
    opsData = { seats: Object.keys(versions).map((id) => ({ seat_id: id, student_id: 'student-' + id, attention: 'ok', signal: 'fresh' })), counts: { total: 7, runtime_ready: 7 }, run: { class_run_id: 'R2', roster_revision: 1, flags: {} }, actions: [] };
    renderSeats(opsData); renderBoard(board);
    await readLatest(${force});
    const rows = [...document.querySelectorAll('#ops-rows .ops-seat')];
    return { calls: window.__latest, floor: verLatest,
      flagged: rows.filter((r) => r.querySelector('td.c-ver .ver-flag')).map((r) => r.dataset.seat).join(','),
      unknown: rows.filter((r) => r.querySelector('td.c-ver .ver-unknown')).map((r) => r.dataset.seat).join(','),
      text: Object.fromEntries(rows.map((r) => [r.dataset.seat, r.querySelector('td.c-ver').textContent])),
      legacy: Object.fromEntries([...document.querySelectorAll('#seats .seat')].map((r) => [r.dataset.user, r.querySelector('p.muted').textContent])) };
  })()`);
  const up = await floor(`return Response.json({ version: '2026.1111.0', checked_at: null, source: 'test' });`);
  check(up.calls === 1 && up.floor === '2026.1111.0', 'the page reads the floor from /studio/latest-release: ' + JSON.stringify(up));
  check(up.flagged === 'F1,F2', 'below the latest formal (an older release, an rc of it) is flagged; equal, newer, a newer rc and dev-build are not: ' + up.flagged);
  check(up.unknown === 'F7', 'an unknown version stays 확인 불가, never flagged: ' + up.unknown);
  check(up.text.F1 === '2026.1109.0 · 업데이트 필요' && up.text.F3 === '2026.1111.0' && up.text.F4 === '2026.1112.0', 'flagged cells keep the version in the accessible text: ' + JSON.stringify(up.text));
  check(up.legacy['student-F1'].endsWith(' · 버전 2026.1109.0 · 업데이트 필요') && up.legacy['student-F3'].endsWith(' · 버전 2026.1111.0'), 'the legacy line says it too: ' + JSON.stringify(up.legacy));
  const gated = await floor(`return Response.json({ version: '2026.1112.0' });`, false);
  check(gated.calls === 0 && gated.floor === '2026.1111.0' && gated.flagged === 'F1,F2', 'within 5 minutes the page does not read the feed again: ' + JSON.stringify(gated));
  for (const [name, answer] of [
    ['feed down', `throw new TypeError('fetch failed');`],
    ['503', `return new Response('', { status: 503 });`],
    ['unknown (null)', `return Response.json({ version: null });`],
    ['an rc as latest', `return Response.json({ version: '2026.1111.0-rc.1' });`],
    ['junk', `return new Response('<html>', { status: 200 });`],
  ]) {
    await floor(`return Response.json({ version: '2026.1111.0' });`);
    const down = await floor(answer);
    check(down.calls === 1 && down.floor === null && down.flagged === '' && !Object.values(down.legacy).some((l) => l.includes('업데이트')), name + ': the floor is unknown and nobody is flagged (earlier flags cleared): ' + JSON.stringify(down));
  }
  check(await b.evaluate(`String(refresh).includes('readLatest()')`), 'the page refresh reads the floor (gated to every 5 minutes)');
} finally { await b.close(); }
console.log(`seat-version.browser: ${checks} checks PASS (버전 column ≤96px, 44px rows, 확인 불가 for unknown, 업데이트 필요 below the latest formal release only when it is known, sort by version, card rows, legacy line)`);
