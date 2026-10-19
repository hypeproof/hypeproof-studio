import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveTaskWorkspace } from './server.mjs';

const server = await serveTaskWorkspace();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const output = resolve(process.env.HPS_CHAT_EVIDENCE ?? 'e2e/test-results/chat-details');
await mkdir(output, { recursive: true });
const checks = [], errors = [], measurements = [];
const EMBEDDED_SHELL = '352px';
page.on('pageerror', error => errors.push(error.message));
const input = page.locator('.hps-input textarea');
const transcript = page.locator('.hps-messages');
const bottomGap = () => transcript.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
const fixture = action => page.request.post(`${server.url}/fixture/${action}`).then(response => expect(response.ok()).toBe(true));
try {
  await page.goto(server.url);
  await expect(input).toBeVisible();
  await expect(transcript).toContainText('검증이 끝난 같은 파일');
  await page.screenshot({ path: resolve(output, 'conversation-1440.png') });
  const shortHeight = await input.evaluate(node => node.clientHeight);
  await input.fill(Array.from({ length: 6 }, (_, i) => `여섯 줄 입력 ${i + 1}`).join('\n'));
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBeGreaterThan(shortHeight);
  await input.fill('긴 초안입니다.\n'.repeat(40));
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBeLessThanOrEqual(192);
  expect(await input.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await expect(page.getByRole('button', { name: '메시지 보내기' })).toBeVisible();
  // The focused editing end must survive a smaller composer viewport.
  await input.press('ControlOrMeta+End');
  await input.press('ArrowRight');
  await expect.poll(() => input.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(1);
  const resizeDraft = await input.inputValue();
  // Embedded webviews can shrink without resizing the top-level browser viewport. The personal chat
  // header is drawn into the task heading (REQ-STUDIO-CHAT-POLISH ⑥), so the shell carries no header
  // and must shrink below 400px before the composer cap (shell - footer chrome - 96px transcript)
  // drops under 192px.
  await page.locator('.hps-shell').evaluate((node, height) => { node.style.height = height; }, EMBEDDED_SHELL);
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBeLessThan(192);
  await expect.poll(() => input.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(output, 'composer-embedded-small.png') });
  await page.locator('.hps-shell').evaluate(node => { node.style.height = ''; });
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBe(192);
  await page.setViewportSize({ width: 1024, height: 400 });
  await expect.poll(() => input.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(1);
  expect(await input.evaluate(node => node.selectionStart)).toBe(resizeDraft.length);
  await expect(input).toHaveValue(resizeDraft);
  await page.screenshot({ path: resolve(output, 'composer-end-small.png') });
  // Scrolling up to read is intentional, even if the caret remains at the end.
  await page.setViewportSize({ width: 1440, height: 900 });
  await input.hover();
  await page.mouse.wheel(0, -240);
  await expect.poll(() => input.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeGreaterThan(100);
  const draftReadingTop = await input.evaluate(node => node.scrollTop);
  await page.locator('.hps-shell').evaluate((node, height) => { node.style.height = height; }, EMBEDDED_SHELL);
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBeLessThan(192);
  await expect.poll(() => input.evaluate(node => node.scrollTop)).toBe(draftReadingTop);
  await page.locator('.hps-shell').evaluate(node => { node.style.height = ''; });
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBe(192);
  await page.setViewportSize({ width: 1024, height: 400 });
  await expect.poll(() => input.evaluate(node => node.scrollTop)).toBe(draftReadingTop);
  await expect(input).toHaveValue(resizeDraft);
  expect(server.sent).toHaveLength(0);
  const controlFits = name => page.getByRole('button', { name }).evaluate(node => node.getBoundingClientRect().bottom <= innerHeight);
  await expect.poll(() => controlFits('메시지 보내기')).toBe(true);
  await expect.poll(() => transcript.evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(90);
  expect(await input.evaluate(node => node.clientHeight)).toBeLessThan(192);
  await fixture('stream');
  await expect.poll(() => controlFits('응답 멈추기')).toBe(true);
  await page.screenshot({ path: resolve(output, 'short-window-stop.png') });
  await fixture('stop');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBe(192);
  await page.screenshot({ path: resolve(output, 'composer-expanded.png') });
  await page.reload();
  await expect(input).toHaveValue('긴 초안입니다.\n'.repeat(40));
  expect(await input.evaluate(node => node.clientHeight)).toBeLessThanOrEqual(192);
  // A visible caret in the middle of a draft must also survive height loss.
  await input.fill(Array.from({ length: 40 }, (_, i) => `초안 ${i + 1} 편집 문장`).join('\n'));
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBe(192);
  await input.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  for (let i = 0; i < 20; i++) await input.press('ArrowDown');
  const middleSelection = await input.evaluate(node => node.selectionEnd);
  expect(await input.evaluate(node => node.value.slice(0, node.selectionEnd).split('\n').length - 1)).toBe(20);
  await page.locator('.hps-shell').evaluate((node, height) => { node.style.height = height; }, EMBEDDED_SHELL);
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBeLessThan(192);
  await expect.poll(() => input.evaluate(node => {
    const line = parseFloat(getComputedStyle(node).lineHeight);
    const row = node.value.slice(0, node.selectionEnd).split('\n').length - 1;
    return (row + 1) * line - node.scrollTop <= node.clientHeight && row * line >= node.scrollTop;
  })).toBe(true);
  expect(await input.evaluate(node => node.selectionEnd)).toBe(middleSelection);
  await page.locator('.hps-shell').evaluate(node => { node.style.height = ''; });
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBe(192);
  await input.fill('');
  await expect.poll(() => input.evaluate(node => node.clientHeight)).toBe(shortHeight);
  checks.push('CP-02: multiline/restored draft grows, caps and shrinks; 400px window keeps Send/Stop and transcript inside viewport');

  await page.getByRole('button', { name: '답변 복사', exact: true }).click();
  await expect(page.locator('.hps-copy-status')).toHaveText('답변을 복사했습니다');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(server.fixture.store.getHistory().find(m => m.id === 'fixture-answer').content);
  await page.goto(server.url + '/?clipboard=denied');
  await page.getByRole('button', { name: '답변 복사', exact: true }).click();
  await expect(page.locator('.hps-copy-status')).toContainText('복사하지 못했습니다');
  await expect(page.getByText('복사됨', { exact: true })).toHaveCount(0);
  checks.push('CP-03: real browser clipboard success verified; browser Permissions-Policy denial never reports success');
  // Control settlement order independently from the real clipboard-policy controls above.
  await page.goto(server.url);
  await page.evaluate(() => {
    window.copyAttempts = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: content => new Promise((resolve, reject) => window.copyAttempts.push({ content, resolve, reject })),
    } });
  });
  const copyButton = page.getByRole('button', { name: '답변 복사', exact: true });
  const copyStatus = page.locator('.hps-copy-status');
  await copyButton.click(); await copyButton.click();
  await expect.poll(() => page.evaluate(() => window.copyAttempts.length)).toBe(2);
  await page.evaluate(() => window.copyAttempts[1].reject(new DOMException('Denied', 'NotAllowedError')));
  await expect(copyStatus).toContainText('복사하지 못했습니다');
  await page.evaluate(() => window.copyAttempts[0].resolve());
  await expect(copyStatus).toContainText('복사하지 못했습니다');
  await copyButton.click(); await expect(copyStatus).toHaveText('');
  await copyButton.click();
  await page.evaluate(() => window.copyAttempts[3].resolve());
  await expect(copyStatus).toHaveText('답변을 복사했습니다');
  await page.evaluate(() => window.copyAttempts[2].reject(new DOMException('Denied', 'NotAllowedError')));
  await expect(copyStatus).toHaveText('답변을 복사했습니다');
  expect(server.sent).toHaveLength(0);
  checks.push('CP-03: latest copy owns feedback in both completion orders; a new attempt clears stale feedback; zero sends');

  await page.goto(server.url);

  await input.fill('첫 문장');
  await input.press('Shift+Enter');
  await input.press('x');
  await expect(input).toHaveValue('첫 문장\nx');
  expect(server.sent).toHaveLength(0);
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  expect(server.sent).toHaveLength(0);
  await input.dispatchEvent('compositionend');
  await input.fill('보낼 문장');
  await input.press('Enter');
  await expect.poll(() => server.sent.length).toBe(1);
  expect(server.sent[0].text).toBe('보낼 문장');
  await expect(page.getByRole('button', { name: '응답 멈추기' })).toBeVisible();
  await expect(page.getByText('응답을 준비하고 있어요', { exact: true })).toBeVisible();
  await input.fill('중지 후 남겨 둘 예약 문장');
  await input.press('Enter');
  await expect(page.locator('.hps-queued')).toContainText('중지 후 남겨 둘 예약 문장');
  expect(server.sent).toHaveLength(1);
  await page.getByRole('button', { name: '응답 멈추기' }).click();
  await expect(input).toHaveValue('중지 후 남겨 둘 예약 문장');
  await expect.poll(() => server.canceled.length).toBe(1);
  expect(server.sent).toHaveLength(1);
  checks.push('CP-06: Shift+Enter/composition preserve draft; Enter sends once; Stop restores parked text without dispatch');

  await fixture('history');
  await fixture('stream');
  await fixture('delta');
  await expect.poll(bottomGap).toBeLessThanOrEqual(48);
  await expect(page.getByText('답변 작성 중', { exact: true })).toBeVisible();
  const heightBefore = await transcript.evaluate(node => node.scrollHeight);
  await fixture('delta');
  await expect.poll(() => transcript.evaluate(node => node.scrollHeight)).toBeGreaterThan(heightBefore);
  await expect.poll(bottomGap).toBeLessThanOrEqual(48);
  await transcript.hover();
  await page.mouse.wheel(0, -700);
  await expect(page.getByRole('button', { name: '최신 메시지' })).toBeVisible();
  await input.fill('읽으면서 쓰는 초안');
  await input.press('ArrowLeft');
  const caret = await input.evaluate(node => node.selectionStart);
  const readingTop = await transcript.evaluate(node => node.scrollTop);
  // scrollTop alone misses a transcript moving when surrounding chrome changes.
  const readingAnchor = await transcript.evaluate(node => {
    const viewport = node.getBoundingClientRect();
    const paragraph = [...node.querySelectorAll('.hps-prose p')].find(p => {
      const bounds = p.getBoundingClientRect();
      return bounds.top >= viewport.top + 20 && bounds.bottom <= viewport.bottom - 20;
    });
    if (!paragraph) throw Error('No visible reading paragraph');
    return { text: paragraph.textContent, top: paragraph.getBoundingClientRect().top };
  });
  const readingAnchorTop = () => transcript.evaluate((node, text) => {
    const paragraph = [...node.querySelectorAll('.hps-prose p')].find(p => p.textContent === text);
    if (!paragraph) throw Error('Reading paragraph disappeared');
    return paragraph.getBoundingClientRect().top;
  }, readingAnchor.text);
  await fixture('delta');
  await fixture('delta');
  await expect.poll(() => transcript.evaluate(node => node.scrollTop)).toBe(readingTop);
  await expect.poll(async () => Math.abs((await readingAnchorTop()) - readingAnchor.top)).toBeLessThanOrEqual(2);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('읽으면서 쓰는 초안');
  expect(await input.evaluate(node => node.selectionStart)).toBe(caret);
  await fixture('stop');
  await expect.poll(() => transcript.evaluate(node => node.scrollTop)).toBe(readingTop);
  await expect.poll(async () => Math.abs((await readingAnchorTop()) - readingAnchor.top)).toBeLessThanOrEqual(2);
  measurements.push({ case: 'reading-completion', before: readingAnchor.top, after: await readingAnchorTop() });
  await page.getByRole('button', { name: '최신 메시지' }).click();
  await expect.poll(bottomGap).toBeLessThanOrEqual(48);
  await fixture('stream');
  await fixture('delta');
  await expect.poll(bottomGap).toBeLessThanOrEqual(48);
  await fixture('stop');
  checks.push('CP-04: real wheel reading paragraph stays within 2 CSSpx through deltas and completion; draft/caret survive and latest resumes follow');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture('stream');
  expect(await page.locator('.hps-response-dots i').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  expect(await page.locator('.hps-msg-live').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  expect(await page.locator('.hps-btn-stop').evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
  await fixture('stop');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  checks.push('CP-05: browser reduced-motion suppresses pending/entry/control effects; scroll follows instantly');

  const oldTask = server.fixture.store.getView().activeTaskId;
  await page.getByRole('button', { name: '새 작업', exact: true }).click();
  await expect.poll(() => server.fixture.store.getView().activeTaskId).not.toBe(oldTask);
  await expect(transcript.locator('.hps-msg')).toHaveCount(0);
  await fixture('rich');
  await expect(transcript.getByRole('heading', { name: '오늘 확인할 것' })).toBeVisible();
  await expect(transcript.getByRole('table')).toBeVisible();
  await input.fill('설치 실패 사례도 함께 확인해줘');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.goto(server.url + '/?theme=light');
    await page.locator('.hps-codepill-toggle').click();
    await expect(page.locator('.hps-codepill-body')).toBeVisible();
    const contrast = await page.locator('.hps-codepill-body').evaluate(node => {
      const style = getComputedStyle(node);
      const luminance = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await transcript.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await expect(transcript.getByRole('table')).toHaveCount(1);
      await expect(transcript).toContainText('release-candidate-sha256-0123456789abcdef');
      await expect(page.getByRole('button', { name: '메시지 보내기' })).toBeVisible();
      await page.screenshot({ path: resolve(output, `${theme}-${width}.png`) });
      const idleTop = await transcript.evaluate(node => node.getBoundingClientRect().top);
      await fixture('stream');
      await expect(page.locator('.tw-run-note')).toContainText('작업 중');
      const busyTop = await transcript.evaluate(node => node.getBoundingClientRect().top);
      expect(Math.abs(busyTop - idleTop)).toBeLessThanOrEqual(2);
      expect(await page.locator('.tw-run-note').evaluate(node => {
        const bounds = node.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.height > 0;
      })).toBe(true);
      await page.screenshot({ path: resolve(output, `${theme}-${width}-busy.png`) });
      await fixture('stop');
      await expect.poll(() => transcript.evaluate(node => node.getBoundingClientRect().top)).toBe(idleTop);
      measurements.push({ case: 'busy-layout', theme, width, idleTop, busyTop });
    }
  }
  checks.push('CP-01: rich Markdown/table/expanded code/long identifier fit dark/light 320/390/1440; code text contrast exceeds 4.5:1');
  expect(errors).toEqual([]);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, measurements, scope: 'built React + actual task host/store; synthetic stream/model seam; browser clipboard policy; not OS IME or signed app acceptance', errors }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, output }));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') });
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ status: 'FAIL', checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); await server.close(); await rm(server.root, { recursive: true, force: true }); }
