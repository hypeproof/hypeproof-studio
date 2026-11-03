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
  const paste = () => input.evaluate(el => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), x => x.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'tiny.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await input.fill('작업을 바꿔도 이미지와 이 질문을 보존해 주세요');
  await paste();
  await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(1);
  await expect.poll(() => server.fixture.store.getDraft().text).toBe('작업을 바꿔도 이미지와 이 질문을 보존해 주세요');
  const originalTask = server.fixture.store.getView().activeTaskId;
  await page.locator('.tw-new').click();
  await expect(input).not.toBeEditable();
  expect(server.fixture.store.getView().activeTaskId).toBe(originalTask);
  await page.evaluate(() => window.pendingReads.shift()(false));
  await expect.poll(() => server.fixture.store.getView().activeTaskId).not.toBe(originalTask);
  await expect(input).toHaveValue('');
  expect(server.fixture.store.getDraft().images).toHaveLength(0);
  await page.locator('.tw-task:not([aria-current])').click();
  await expect.poll(() => server.fixture.store.getView().activeTaskId).toBe(originalTask);
  await expect(input).toHaveValue('작업을 바꿔도 이미지와 이 질문을 보존해 주세요');
  await expect.poll(() => server.fixture.store.getDraft().images.length).toBe(1);
  expect(server.sent).toHaveLength(0);
  // A failure can race the nonce request, not only the final persistence effect.
  for (const afterFreeze of [false, true]) {
    await paste();
    await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(1);
    await page.locator('.tw-task:not([aria-current])').click();
    await expect.poll(() => server.fixture.h.connectionChanging).toBe(true);
    if (afterFreeze) await expect(input).not.toBeEditable();
    await page.evaluate(() => window.pendingReads.shift()(true));
    await expect(page.getByText('이미지를 준비하지 못해 작업을 바꾸지 않았어요.', { exact: false })).toBeVisible();
    expect(server.fixture.store.getView().activeTaskId).toBe(originalTask);
    await expect(input).toBeEditable();
    await expect(input).toHaveValue('작업을 바꿔도 이미지와 이 질문을 보존해 주세요');
    expect(server.fixture.store.getDraft().images).toHaveLength(1);
    await page.locator('.tw-task:not([aria-current])').click();
    await expect.poll(() => server.fixture.store.getView().activeTaskId).not.toBe(originalTask);
    await page.locator('.tw-task:not([aria-current])').click();
    await expect.poll(() => server.fixture.store.getView().activeTaskId).toBe(originalTask);
  }
  expect(server.sent).toHaveLength(0);
  console.log('PASS image navigation: waits for image, saves original draft, changes task, restores attachment; no send or cross-task pollution');
} finally { await page.close(); await browser.close(); await server.close(); }
