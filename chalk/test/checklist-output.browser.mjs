// CGP-LEARN-D-015 / DES-CGP-LEARN-15 — the completion checklist is rendered as plain checklist rows: no points column and
// no level headers. Measured on the REAL served /authoring page in headless Chromium (CDP), at 1420 and 375 px:
//   1. a loaded draft whose items carry hostile extra keys (points, level, score) draws one list row per item, rows stacked
//      in one column, each row = the item sentence + its record kind + row actions; no table, grid, column header, heading
//      or number field inside the list, and no score or level word anywhere in the rendered list;
//   2. the saved body carries only id/text/event per item (the extra keys are not drawn and not written back);
//   3. the one-line summary used by the version and change views counts items, never points.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails. Never opens a window or
// sends OS input. CHECKLIST_PNG_DIR=<dir> also saves the list area as PNGs for a visual look.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('checklist-output.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  checklist-output.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const server = createServer(async (req, res) => {
  const r = await app.fetch(new Request('http://127.0.0.1' + req.url), { ENVIRONMENT: 'test' });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const b = await launch(bin);
const ev = (js) => b.evaluate(`(() => { ${js} })()`);
// Wait on a condition, never on a fixed delay.
async function until(js, what) {
  for (let i = 0; i < 200; i++) {
    if (await ev(js).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for ' + what);
}
const ITEMS = [
  { id: 'c-1', text: '첫 화면 시안 1개를 만들면 끝', event: 'test_observed', points: 10, level: '우수', score: { max: 10 } },
  { id: 'c-2', text: '두 안의 차이점 2개를 적으면 끝', event: 'criterion_set', points: 5, level: '미흡' },
  { id: 'c-3', text: '고친 화면을 같은 조건으로 다시 확인하면 끝', event: 'retest_confirmed', grade: 'A' },
];
const DRAFT = { steps: [], learning: { week: 2, mission: '내 첫 홈페이지 만들기', completion: ITEMS } };
// Score or level words that a points column or a level header would draw (OUT-05, SX-35). Bare 점 stays allowed
// (차이점 is in an item); a number before 점 is not.
const GRADED = /점수|배점|만점|등급|수준|우수|미흡|\d\s*점|\bpoints?\b|\bpts\b|\blevel\b|\bscore\b|\bgrade\b/i;
let checks = 0;
try {
  for (const width of [1420, 375]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Page.navigate', { url: origin + '/authoring' });
    await until(`return document.readyState === 'complete' && typeof render === 'function' && !!document.getElementById('learning-completion')`, '/authoring');
    await ev(`render(${JSON.stringify(DRAFT)}); return 0`);
    await until(`return document.querySelectorAll('#learning-completion > li').length === ${ITEMS.length} && !document.getElementById('learning-fields').hidden`, 'the completion rows');
    await ev(`document.getElementById('learning-completion').scrollIntoView({ block: 'center' }); return 0`);
    const m = await ev(`const list = document.getElementById('learning-completion'), fs = document.getElementById('learning');
      const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; };
      const shown = (e) => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const rows = [...list.children].map((li) => ({
        tag: li.tagName,
        box: box(li),
        texts: [...li.querySelectorAll('[data-completion-text]')].map((t) => t.value),
        selects: [...li.querySelectorAll('select')].map((s) => ({ value: s.value, shown: s.selectedOptions[0]?.textContent || '' })),
        numberFields: li.querySelectorAll('input[type=number], input[inputmode=numeric], input[type=range], meter, progress').length,
        fields: [...li.querySelectorAll('input, select, textarea')].filter(shown).length,
        // Everything a reader sees in the row: labels, buttons, field values, chosen options.
        words: (li.innerText + ' ' + [...li.querySelectorAll('input, textarea')].map((t) => t.value).join(' ') + ' ' + [...li.querySelectorAll('select')].map((s) => s.selectedOptions[0]?.textContent || '').join(' ')),
      }));
      const optionWords = [...list.querySelectorAll('option')].map((o) => o.textContent).join(' ');
      const inList = (sel) => [...list.querySelectorAll(sel)].filter(shown).length;
      // A level header would be a heading between the list's own title and its rows, or any heading inside the list.
      const headingsInList = inList('h1, h2, h3, h4, h5, h6, [role=heading], th, [role=columnheader], [role=rowheader], caption, thead, legend');
      const tables = [...fs.querySelectorAll('table, [role=table], [role=grid], [role=treegrid], [role=columnheader]')].filter(shown).length;
      const listHeads = [...fs.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')].filter(shown).map((h) => h.textContent.trim());
      const s = getComputedStyle(list);
      return { listTag: list.tagName, display: s.display, gridCols: s.gridTemplateColumns, columns: s.columnCount, rows, optionWords, headingsInList, tables, listHeads,
        overflow: document.scrollingElement.scrollWidth - innerWidth, listRight: list.getBoundingClientRect().right - innerWidth,
        allListText: list.innerText };`);
    // 1. Plain list rows, one per item, stacked in one column.
    assert.match(m.listTag, /^(OL|UL)$/, `${width}px: the checklist is a list element (${m.listTag})`);
    assert.ok(!/grid|table/.test(m.display), `${width}px: the list is not laid out as a grid or table (${m.display})`);
    assert.ok(m.gridCols === 'none' && (m.columns === 'auto' || m.columns === '1'), `${width}px: the list has no columns (${m.gridCols} / ${m.columns})`);
    assert.equal(m.rows.length, ITEMS.length, `${width}px: one row per item`);
    for (const [i, r] of m.rows.entries()) {
      assert.equal(r.tag, 'LI', `${width}px row ${i}: a list item`);
      assert.deepEqual(r.texts, [ITEMS[i].text], `${width}px row ${i}: exactly the item sentence, once`);
      assert.deepEqual(r.selects.map((x) => x.value), [ITEMS[i].event], `${width}px row ${i}: one record-kind field, the item's own`);
      assert.equal(r.numberFields, 0, `${width}px row ${i}: no number, range or meter field (a points cell)`);
      assert.equal(r.fields, 2, `${width}px row ${i}: sentence + record kind only (${r.fields} fields)`);
      assert.ok(!GRADED.test(r.words), `${width}px row ${i}: a score or level word is drawn: ${JSON.stringify(r.words.match(GRADED)?.[0])}`);
      if (i) {
        const prev = m.rows[i - 1].box;
        assert.ok(r.box.top >= prev.bottom - 0.5, `${width}px row ${i}: starts below the previous row (one item per row)`);
        assert.ok(Math.abs(r.box.left - prev.left) < 0.5 && Math.abs(r.box.w - prev.w) < 0.5, `${width}px row ${i}: same column as the previous row`);
      }
    }
    assert.ok(!GRADED.test(m.optionWords), `${width}px: a record-kind option names a score or level: ${m.optionWords.match(GRADED)?.[0]}`);
    assert.equal(m.headingsInList, 0, `${width}px: no header (level or column) inside the checklist`);
    assert.equal(m.tables, 0, `${width}px: no table, grid or column header in the mission and checklist section`);
    for (const h of m.listHeads) assert.ok(!GRADED.test(h), `${width}px: a level header "${h}" heads the checklist`);
    assert.ok(m.overflow <= 0 && m.listRight <= 0.5, `${width}px: the checklist fits the page (scroll ${m.overflow}px, past edge ${m.listRight}px)`);
    checks += 9 + m.rows.length * 6;

    if (process.env.CHECKLIST_PNG_DIR) {
      mkdirSync(process.env.CHECKLIST_PNG_DIR, { recursive: true });
      for (const forced of ['none', 'active']) {
        await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forced }] });
        const r = await ev(`const r = document.getElementById('learning').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }`);
        const shot = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.w + 16, height: r.h + 16, scale: 1 } });
        writeFileSync(join(process.env.CHECKLIST_PNG_DIR, `checklist-${width}${forced === 'active' ? '-forced' : ''}.png`), Buffer.from(shot.data, 'base64'));
      }
      await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    }
  }

  // 2. The saved body writes back plain items: the hostile extra keys are neither drawn nor kept.
  const saved = await ev(`return content().learning.completion`);
  assert.deepEqual(saved, ITEMS.map(({ id, text, event }) => ({ id, text, event })), 'the saved checklist items carry only id, text and record kind');
  // 3. The version/change summary counts items and never names points or levels.
  const line = await ev(`return missionLine(${JSON.stringify(DRAFT.learning)})`);
  assert.equal(line, `2주차 ‘내 첫 홈페이지 만들기’ · 완료 조건 ${ITEMS.length}개`);
  assert.ok(!GRADED.test(line), 'the summary line names no score or level');
  checks += 3;
  console.log(`PASS checklist-output.browser: ${checks} checks`);
} finally {
  await b.close();
  server.close();
}
