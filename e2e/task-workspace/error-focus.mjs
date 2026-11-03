import { chromium, expect } from '@playwright/test';
import { serveTaskWorkspace } from './server.mjs';
import { resolvedProfile } from '../../extensions/hypeproof-chat/test/sx-screen-fixtures.mjs';

// Existing host fixture, actual built webview; model/network failure is synthetic.
const browser = await chromium.launch({ headless: true });
try {
  for (const action of ['dismiss', 'retry']) {
    for (const mode of ['keyboard', 'pointer']) {
      const server = await serveTaskWorkspace({ profile: resolvedProfile(3, { lesson: undefined }) });
      const page = await browser.newPage();
      try {
        await page.goto(server.url);
        const input = page.locator('.hps-input textarea');
        await input.fill('My next draft');
        await input.evaluate(editor => editor.setSelectionRange(3, 7, 'backward'));
        await server.fixture.h.post({ type: 'streamStart', streamId: 'fixture-run', messageId: 'focus-test' });
        await server.fixture.h.post({ type: 'streamError', streamId: 'fixture-run', error: '합성 연결 오류' });
        const button = page.locator(`.hps-error-banner-${action}`);
        await expect(button).toBeVisible();
        await expect(input).toBeFocused(); // Error arrival must not steal focus.
        if (mode === 'keyboard') {
          await button.focus(); await page.keyboard.press('Enter');
        } else await button.click();
        await expect(button).toHaveCount(0);
        await expect(input).toBeFocused();
        expect(await input.evaluate(editor => [editor.selectionStart, editor.selectionEnd, editor.selectionDirection])).toEqual([3, 7, 'backward']);
        await page.keyboard.type('new');
        await expect(input).toHaveValue('My new draft');
        await expect.poll(() => server.sent.length).toBe(action === 'retry' ? 1 : 0);
        if (action === 'retry') expect(server.sent[0].type).toBe('retryMessage');
        console.log(`PASS ${action}/${mode}: selection, typing, focus and intended sends`);
      } finally { await page.close(); await server.close(); }
    }
  }
} finally { await browser.close(); }
