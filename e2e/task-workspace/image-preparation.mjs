import { chromium, expect } from '@playwright/test';
import { serveTaskWorkspace } from './server.mjs';
import { resolvedProfile } from '../../extensions/hypeproof-chat/test/sx-screen-fixtures.mjs';

const browser = await chromium.launch({ headless: true });
const server = await serveTaskWorkspace({ seedHistory: false, profile: resolvedProfile(3, { lesson: undefined, input: { image_paste: true, image_files: false } }) });
const page = await browser.newPage();
try {
  // Real file read; control only its completion timing to expose the send race.
  await page.addInitScript(() => {
    const Native = window.FileReader;
    window.pendingReads = [];
    window.FileReader = class {
      readAsDataURL(file) {
        const reader = new Native();
        reader.onload = () => {
          this.result = reader.result;
          window.pendingReads.push(fail => fail ? this.onerror?.(new Event('error')) : this.onload?.(new Event('load')));
        };
        reader.onerror = () => this.onerror?.(new Event('error'));
        reader.readAsDataURL(file);
      }
    };
  });
  await page.goto(server.url);
  const input = page.locator('.hps-input textarea');
  const send = page.getByRole('button', { name: '메시지 보내기', exact: true });
  const paste = () => input.evaluate(el => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), x => x.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'tiny.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await input.fill('두 이미지와 이 초안을 함께 보내 주세요');
  await paste(); await paste();
  await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(2);
  await expect(send).toBeDisabled();
  await input.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: '이미지 2장을 준비' })).toHaveCount(1);
  await expect(page.locator('.hps-img-note')).toHaveCount(0);
  expect(server.sent).toHaveLength(0);
  await expect(input).toHaveValue('두 이미지와 이 초안을 함께 보내 주세요');
  await page.evaluate(() => window.pendingReads.shift()(false));
  await expect.poll(() => server.fixture.store.getDraft().images.length).toBe(1);
  await expect(send).toBeDisabled();
  await page.evaluate(() => window.pendingReads.shift()(true));
  await expect(send).toBeEnabled();
  await expect(page.getByText('이미지를 붙이지 못했어요. 다시 시도하거나 URL로 참고 화면을 주세요.')).toBeVisible();
  expect(server.sent).toHaveLength(0);
  await paste();
  await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(1);
  await expect(send).toBeDisabled();
  await expect(page.getByText('이미지를 붙이지 못했어요. 다시 시도하거나 URL로 참고 화면을 주세요.')).toHaveCount(0);
  await expect(page.locator('.hps-image-preparing')).toHaveCount(1);
  await page.evaluate(() => window.pendingReads.shift()(false));
  await expect.poll(() => server.fixture.store.getDraft().images.length).toBe(2);
  await expect(send).toBeEnabled();
  expect(server.sent).toHaveLength(0); // Completion never sends automatically.
  await send.click();
  await expect.poll(() => server.sent.length).toBe(1);
  expect(server.sent[0].images).toHaveLength(2);
  expect(server.sent[0].text).toBe('두 이미지와 이 초안을 함께 보내 주세요');
  await input.fill('다음 초안');
  await expect.poll(() => server.fixture.store.getDraft().images.length).toBe(0);
  console.log('PASS pending images: Enter/pointer blocked, partial completion held, failure preserves draft/image, explicit repaste and send only once');
} finally { await page.close(); await browser.close(); await server.close(); }
