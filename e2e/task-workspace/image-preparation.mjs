import { chromium, expect } from '@playwright/test';
import { serveTaskWorkspace } from './server.mjs';
import { resolvedProfile } from '../../extensions/hypeproof-chat/test/sx-screen-fixtures.mjs';

const browser = await chromium.launch({ headless: true });
try {
for (const theme of ['dark', 'light']) {
for (const failureFirst of [false, true]) {
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
  await page.goto(server.url + '/?theme=' + theme);
  const input = page.locator('.hps-input textarea');
  const send = page.getByRole('button', { name: '메시지 보내기', exact: true });
  const announcement = page.getByTestId('attachment-announcer');
  await expect(announcement).toHaveText('');
  const liveRegion = await announcement.elementHandle();
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
  await page.evaluate(fail => window.pendingReads.shift()(fail), failureFirst);
  if (failureFirst) await expect(page.locator('.hps-img-note')).toContainText('이미지를 붙이지 못했어요');
  else await expect.poll(() => server.fixture.store.getDraft().images.length).toBe(1);
  await expect(send).toBeDisabled();
  await page.evaluate(fail => window.pendingReads.shift()(fail), !failureFirst);
  await expect.poll(() => server.fixture.store.getDraft().images.length).toBe(1);
  await expect(send).toBeEnabled();
  await expect(page.locator('.hps-img-note').filter({ hasText: '이미지를 붙이지 못했어요. 다시 시도하거나 URL로 참고 화면을 주세요.' })).toBeVisible();
  const failureText = '이미지를 붙이지 못했어요. 다시 시도하거나 URL로 참고 화면을 주세요.';
  await expect(announcement).toHaveText(failureText);
  expect(await liveRegion.evaluate(node => node.isConnected)).toBe(true);
  await expect(input).toBeFocused();
  expect(await input.evaluate(node => node.getAttribute('aria-describedby').split(/\s+/).map(id => document.getElementById(id)?.textContent).join(' '))).toContain(failureText);
  const contrast = await page.locator('.hps-img-note').evaluate(node => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const foreground = rgb(getComputedStyle(node).color);
    let opacity = 1, background;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      opacity *= Number(style.opacity);
      if (!background && style.backgroundColor !== 'rgba(0, 0, 0, 0)') background = rgb(style.backgroundColor);
    }
    if (!background) throw new Error('No rendered background for attachment guidance');
    const effective = foreground.map((channel, index) => channel * opacity + background[index] * (1 - opacity));
    const luminance = color => color.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const fg = luminance(effective), bg = luminance(background);
    return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
  });
  expect(contrast, `${theme} attachment failure guidance contrast`).toBeGreaterThanOrEqual(4.5);
  expect(server.sent).toHaveLength(0);
  await paste();
  await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(1);
  await expect(send).toBeDisabled();
  await expect(page.getByText('이미지를 붙이지 못했어요. 다시 시도하거나 URL로 참고 화면을 주세요.')).toHaveCount(0);
  await expect(page.locator('.hps-image-preparing')).toHaveCount(1);
  await expect(announcement).toHaveText('');
  expect(await input.evaluate(node => node.getAttribute('aria-describedby'))).toBe('personal-composer-hint');
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
} finally { await page.close(); await server.close(); }

}
}
} finally { await browser.close(); }
