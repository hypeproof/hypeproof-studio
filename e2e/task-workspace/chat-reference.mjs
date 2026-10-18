import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveTaskWorkspace } from './server.mjs';

const server = await serveTaskWorkspace();
const browser = await chromium.launch({ headless: true });
const output = resolve(process.env.HPS_CHAT_REFERENCE_EVIDENCE ?? 'e2e/test-results/chat-reference');
await mkdir(output, { recursive: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', recordVideo: { dir: resolve(output, 'video'), size: { width: 1280, height: 720 } } });
const page = await context.newPage();
const errors = [], checks = [], measurements = {};
page.on('pageerror', error => errors.push(error.message));
const input = page.locator('.hps-input textarea');
const card = page.locator('.hps-input');
const tools = page.getByRole('button', { name: '도구 열기', exact: true });
const choose = page.getByRole('menuitemcheckbox', { name: /웹 검색/ });
const fixture = action => page.request.post(`${server.url}/fixture/${action}`).then(response => expect(response.ok()).toBe(true));
const shot = name => page.screenshot({ path: resolve(output, name + '.png') });
try {
  await page.goto(server.url + '/?theme=light');
  await expect(input).toBeVisible();
  measurements.compact = await card.boundingBox();
  expect(measurements.compact.height).toBeGreaterThanOrEqual(52);
  expect(measurements.compact.height).toBeLessThanOrEqual(64);
  await input.fill('짧은 입력');
  await expect(card).toHaveAttribute('data-expanded', 'false');
  const node = await input.elementHandle();
  await input.fill('줄바꿈 없이 길어진 단락과 입력 위치를 유지합니다. '.repeat(18));
  await expect(card).toHaveAttribute('data-expanded', 'true');
  expect(await input.evaluate((current, original) => current === original, node)).toBe(true);
  await input.fill(''); await expect(card).toHaveAttribute('data-expanded', 'false');
  await shot('compact-light-1280');
  checks.push('CG-01 compact 52–64px; wrap expansion/shrink uses same editor DOM node');

  await tools.click(); await expect(choose).toHaveAttribute('aria-disabled', 'true');
  await choose.click({ force: true }); await expect(page.getByRole('button', { name: '웹 검색 선택 해제' })).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(tools).toBeFocused();
  await fixture('tools-available');
  await tools.click(); await expect(choose).toHaveAttribute('aria-disabled', 'false');
  await choose.click(); await expect(input).toBeFocused();
  await expect(page.getByRole('button', { name: '웹 검색 선택 해제' })).toBeVisible();
  await input.fill('공식 자료로 확인해 줘');
  await expect.poll(() => server.fixture.store.getDraft().toolMode).toBe('web-search');
  await page.reload(); await expect(input).toHaveValue('공식 자료로 확인해 줘');
  await expect(page.getByRole('button', { name: '웹 검색 선택 해제' })).toBeVisible();
  await shot('selected-tool');
  await input.press('Enter'); await expect.poll(() => server.sent.length).toBe(1);
  expect(server.sent[0].toolMode).toBe('web-search'); expect(server.sent[0].userMessageId).toMatch(/^local-/);
  await expect(page.locator('.hps-user-tool').first()).toContainText('웹 검색 요청');
  checks.push('CG-02 unsupported selection cannot activate; selected mode persists and is sent with stable request ID; this is a request, not search proof');

  await input.fill('예약한 웹 검색'); await input.press('Enter');
  await expect(page.locator('.hps-queued')).toContainText('웹 검색');
  await expect(page.getByRole('button', { name: '웹 검색 선택 해제' })).toBeDisabled();
  await input.fill('그 다음 초안'); await fixture('stop');
  await expect.poll(() => server.sent.length).toBe(2); expect(server.sent[1].toolMode).toBe('web-search'); expect(server.sent[1].text).toBe('예약한 웹 검색');
  await expect(input).toHaveValue('그 다음 초안');
  await page.getByRole('button', { name: '응답 멈추기' }).click();
  await expect(input).toHaveValue('그 다음 초안');
  checks.push('CG-04 queued mode is immutable and distinct from active request; flush preserves next draft; Stop does not send it');

  await input.fill('실패할 검색 요청'); await input.press('Enter');
  await expect.poll(() => server.sent.length).toBe(3);
  await page.getByRole('button', { name: '웹 검색 선택 해제' }).click();
  await input.fill('도구가 다른 새 초안'); await fixture('reject');
  await expect(input).toHaveValue('도구가 다른 새 초안');
  await expect(page.locator('.hps-queued')).toContainText('보관한 메시지');
  await expect.poll(() => server.fixture.store.getDraft().queuedPaused).toBe(true);
  await page.reload(); await expect(input).toHaveValue('도구가 다른 새 초안');
  await expect(page.locator('.hps-queued')).toContainText('실패할 검색 요청');
  expect(server.sent.length).toBe(3);
  await page.locator('.hps-queued-send').click(); await expect.poll(() => server.sent.length).toBe(4); expect(server.sent[3].toolMode).toBe('web-search');
  await expect(input).toHaveValue('도구가 다른 새 초안'); await fixture('stop');
  checks.push('CG-02 rejected search keeps original mode separately from a different new draft across restart and requires explicit resending');

  await input.fill('자료를 보면서 유지할 입력');
  const source = page.getByRole('button', { name: /Electron 보안 지침.*출처 미리보기/ }).first();
  await source.click(); await expect(page.locator('#task-source-title')).toBeFocused();
  await expect(page.locator('.cp-source-url')).toHaveText('https://www.electronjs.org/docs/latest/tutorial/security');
  await page.getByRole('button', { name: '이 자료 고정', exact: true }).click();
  await expect(page.getByRole('button', { name: '고정 해제', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '브라우저에서 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: '대화로 돌아가기', exact: true })).toBeVisible();
  expect(server.fixture.opened.length).toBe(1);
  await page.getByRole('button', { name: '브라우저에서 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: '대화로 돌아가기', exact: true })).toBeVisible();
  expect(server.fixture.opened.length).toBe(1);
  await shot('source-preview-light-1280');
  await page.getByRole('button', { name: '대화로 돌아가기', exact: true }).click();
  await expect(page.locator('#task-sources')).toBeHidden(); await expect(source).toBeFocused(); await expect(input).toHaveValue('자료를 보면서 유지할 입력');
  checks.push('CG-03 actual host acknowledgments bind task/request/URL; repeat open reuses owned tab; return restores exact citation and draft (browser API is fixture)');

  await fixture('source');
  await page.getByRole('button', { name: /GitHub Actions 문서.*출처 미리보기/ }).click();
  await expect(page.locator('#task-source-title')).toHaveText('GitHub Actions 문서');
  await expect(page.locator('.tw-source-policy')).toContainText('기존에 고정한 자료');
  await page.keyboard.press('Escape'); await expect(page.locator('#task-sources')).toBeHidden(); await expect(page.getByRole('button', { name: /GitHub Actions 문서.*출처 미리보기/ })).toBeFocused();
  await page.getByRole('button', { name: /^자료 \d/ }).click();
  await expect(page.locator('#task-source-title')).toHaveText('Electron 보안 지침');
  await page.getByRole('button', { name: '자료 닫기', exact: true }).click();
  checks.push('CG-03 preview does not overwrite pinned source; Escape returns to actual opener');

  server.fixture.browserState.failOpen = true;
  await page.getByRole('button', { name: /GitHub Actions 문서.*출처 미리보기/ }).click();
  await page.getByRole('button', { name: '브라우저에서 열기', exact: true }).click();
  await expect(page.locator('.cp-source-error')).toBeVisible();
  await expect(page.getByRole('button', { name: '대화로 돌아가기', exact: true })).toHaveCount(0);
  await expect(input).toHaveValue('자료를 보면서 유지할 입력');
  await shot('source-open-failure');
  server.fixture.browserState.failOpen = false;
  await page.getByRole('button', { name: '자료 닫기', exact: true }).click();
  checks.push('CG-03 failed browser opening is visible and never grants a success/return state');

  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await source.click();
    await expect(page.locator('#task-source-title')).toBeFocused();
    if (width <= 1050) {
      await expect(page.locator('#task-sources')).toHaveAttribute('aria-modal', 'true');
      await expect(page.locator('.tw-main')).toHaveAttribute('inert', '');
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); expect(await page.locator('#task-sources').evaluate(panel => panel.contains(document.activeElement))).toBe(true); }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(`source-${width}`);
    await page.keyboard.press('Escape'); await expect(source).toBeFocused();
    await expect(input).toHaveValue('자료를 보면서 유지할 입력');
  }
  checks.push('CG-05 source panel at 320/390/1440: no page overflow, modal focus containment, Escape focus and draft preserved');
  expect(errors).toEqual([]);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ status: 'PASS', scope: 'built React + real disk/task host; synthetic model/browser seam, zero model calls; not native/live service acceptance', checks, measurements, sent: server.sent.map(({type,text,prompt,toolMode,userMessageId,sourceMessageId}) => ({type,text,prompt,toolMode,userMessageId,sourceMessageId})), errors }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, output }));
} catch (error) {
  await shot('failure'); await writeFile(resolve(output, 'result.json'), JSON.stringify({ status: 'FAIL', checks, measurements, errors, error: String(error) }, null, 2)); throw error;
} finally { await context.close(); await browser.close(); await server.close(); await rm(server.root, { recursive: true, force: true }); }
