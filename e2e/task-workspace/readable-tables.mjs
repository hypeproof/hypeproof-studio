import { chromium, expect } from '@playwright/test';
import { serveTaskWorkspace } from './server.mjs';

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 400 }]) {
    const server = await serveTaskWorkspace({ seedHistory: false });
    const page = await browser.newPage({ viewport });
    try {
      await page.goto(server.url);
      const input = page.locator('.hps-input textarea');
      await input.fill('표를 읽어도 남아야 할 초안');
      const row = '읽을 수 있는 긴 설명입니다. '.repeat(8);
      const wide = '| ' + Array.from({ length: 8 }, (_, i) => `항목 ${i}`).join(' | ') + ' |\n| ' + Array(8).fill('---').join(' | ') + ' |\n| ' + Array(8).fill(row).join(' | ') + ' |';
      await server.fixture.h.appendHistory([{ id: 'tables', role: 'assistant', content: wide + '\n\n| 이름 | 값 |\n| --- | --- |\n| 하나 | 1 |', createdAt: 1 }]);
      await server.fixture.h.postHistory();
      const tables = page.getByRole('region', { name: '대화의 표' });
      await expect(tables).toHaveCount(2);
      const wideTable = tables.first();
      const size = await wideTable.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, cellWidth: el.querySelector('td').getBoundingClientRect().width, rowHeight: el.querySelector('tbody tr').getBoundingClientRect().height }));
      expect(size.scroll).toBeGreaterThan(size.width);
      expect(size.cellWidth).toBeGreaterThanOrEqual(128);
      expect(size.rowHeight).toBeLessThan(400);
      await wideTable.focus();
      await wideTable.press('ArrowRight');
      await expect.poll(() => wideTable.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const small = await tables.last().evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      expect(small.scroll).toBeLessThanOrEqual(small.width + 1);
      // Let the preceding native ArrowRight scroll finish before measuring retention.
      await wideTable.evaluate(el => new Promise(resolve => {
        let previous = el.scrollLeft, stable = 0;
        const frame = () => {
          const next = el.scrollLeft;
          stable = next === previous ? stable + 1 : 0;
          previous = next;
          if (stable >= 4) resolve(); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }));
      await wideTable.evaluate(el => { el.scrollLeft = 200; });
      const readingOffset = await wideTable.evaluate(el => el.scrollLeft);
      await input.focus();
      await input.press('End');
      await input.press('!');
      await expect(input).toHaveValue('표를 읽어도 남아야 할 초안!');
      await expect.poll(() => wideTable.evaluate(el => el.scrollLeft)).toBe(readingOffset);
      // A new answer must not reset the reader's position in an older table.
      await server.fixture.h.appendHistory([{ id: 'next-answer', role: 'assistant', content: '새 답변이 추가되어도 표의 읽던 열을 유지합니다.', createdAt: 2 }]);
      await server.fixture.h.postHistory();
      await expect(page.locator('.hps-messages')).toContainText('새 답변이 추가되어도');
      await expect.poll(() => wideTable.evaluate(el => el.scrollLeft)).toBe(readingOffset);
      // Changed text must render too: memoization must not freeze the answer.
      await server.fixture.h.post({ type: 'history', messages: [{ id: 'tables', role: 'assistant', content: wide + '\n\n추가된 설명도 바로 보입니다.', createdAt: 1 }] });
      await expect(page.locator('.hps-messages')).toContainText('추가된 설명도 바로 보입니다.');
      await expect.poll(() => wideTable.evaluate(el => el.scrollLeft)).toBe(readingOffset);
      await expect(input).toHaveValue('표를 읽어도 남아야 할 초안!');
      expect(server.sent).toHaveLength(0);
      console.log('PASS readable tables', viewport, size);
    } finally { await page.close(); await server.close(); }
  }
} finally { await browser.close(); }
