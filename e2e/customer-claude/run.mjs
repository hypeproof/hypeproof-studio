// Actual review HTML in headless Chromium, with synthetic host/provider messages.
// This proves the webview interaction, not an installed Studio or real account.
import { chromium, expect } from '@playwright/test';
import { build } from '../../extensions/hypeproof-chat/node_modules/esbuild/lib/main.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = resolve(process.argv[2] || 'test-results/customer-claude');
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'personal-claude-view-'));
await build({ entryPoints: ['extensions/hypeproof-chat/src/personalContinuationView.ts'], outfile: join(temp, 'view.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { personalContinuationHtml } = await import(pathToFileURL(join(temp, 'view.mjs')).href);
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const direct of [false, true]) for (const theme of ['light', 'dark']) for (const width of [800, 1420]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const html = personalContinuationHtml('testnonce', { projectLabel: '고객 작업 <script>throw 1</script>', draft: '남겨 둔 요청', historyCount: 2, direct });
    await page.addInitScript(() => { window.__posted = []; window.acquireVsCodeApi = () => ({ postMessage: m => window.__posted.push(m) }); });
    await page.route('https://customer-claude.test/', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://customer-claude.test/');
    await page.addStyleTag({ content: `:root{--vscode-foreground:${theme === 'dark' ? '#eee' : '#222'};--vscode-editor-background:${theme === 'dark' ? '#202124' : '#fff'};--vscode-descriptionForeground:${theme === 'dark' ? '#bbb' : '#555'};--vscode-input-background:${theme === 'dark' ? '#303134' : '#fafafa'};--vscode-input-foreground:${theme === 'dark' ? '#eee' : '#222'};--vscode-panel-border:#888;--vscode-button-background:#1769aa;--vscode-button-foreground:#fff;--vscode-button-secondaryBackground:#ddd;--vscode-button-secondaryForeground:#222;--vscode-focusBorder:#168cff}` });
    const deliver = async message => page.evaluate(m => window.postMessage(m, '*'), message);
    await expect(page.locator('#draft')).toHaveValue('남겨 둔 요청');
    await expect(page.locator('#review')).toBeDisabled();
    await deliver({ type: 'inspection', ready: true, account: 'Synthetic personal account\n개인 구독 · 추가 사용은 공급자 계정 정책 적용', message: '계정 확인 완료 (합성)' });
    await page.locator('#material').fill('내가 고른 자료');
    await page.locator('#review').click();
    const review = await page.evaluate(() => window.__posted.filter(m => m.type === 'review').at(-1));
    if (review.draft !== '남겨 둔 요청' || review.history !== false || review.material !== '내가 고른 자료') throw new Error('explicit selection changed');
    const payload = '모델: sonnet\n합성 시스템 지시\n남겨 둔 요청\n내가 고른 자료 <img src=x onerror=alert(1)>';
    await deliver({ type: 'review', digest: 'review-one', payload });
    await expect(page.locator('#send')).toBeDisabled();
    await expect(page.locator('#payload')).toHaveText(payload);
    await expect(page.locator('#payload img')).toHaveCount(0);
    await page.locator('#consent').check();
    await expect(page.locator('#send')).toBeEnabled();
    await page.screenshot({ path: join(output, `review-${direct ? 'experimental' : 'manual'}-${theme}-${width}.png`), fullPage: true });
    await page.locator('#draft').fill('수정된 요청');
    await expect(page.locator('#consent')).not.toBeChecked();
    await expect(page.locator('#send')).toBeDisabled();
    await expect(page.locator('#reviewPane')).toBeHidden();
    await page.locator('#review').click();
    await deliver({ type: 'review', digest: 'review-two', payload: '수정된 요청' });
    await page.locator('#consent').check();
    await page.locator('#send').click();
    const sent = await page.evaluate(() => window.__posted.filter(m => m.type === 'send'));
    if (sent.length !== 1 || sent[0].digest !== 'review-two' || sent[0].consent !== true) throw new Error('send did not use exact new consent');
    await expect(page.locator('#draft')).toBeDisabled();
    if (!direct) {
      await deliver({ type: 'copied', message: '복사됨 (합성)' });
      await expect(page.locator('#manualPane')).toBeVisible();
      await page.locator('#manualAnswer').fill('공식 프로그램에서 직접 가져온 답변');
      await page.locator('#saveManual').click();
      const saved = await page.evaluate(() => window.__posted.filter(m => m.type === 'saveManualReply'));
      if (saved.length !== 1 || saved[0].consent !== true || saved[0].text !== '공식 프로그램에서 직접 가져온 답변') throw new Error('manual answer needs explicit save');
      await deliver({ type: 'result', message: '저장됨 (합성)', text: saved[0].text });
      await expect(page.locator('#manualPane')).toBeHidden();
    }
    await page.locator('#cancel').click();
    await expect(page.locator('#draft')).toHaveValue('수정된 요청');
    await expect(page.locator('#draft')).toBeEnabled();
    await deliver({ type: 'result', message: '같은 작업에 저장됨 (합성)', text: '<img src=x onerror=alert(1)> 검토할 답변' });
    await expect(page.locator('#answer img')).toHaveCount(0);
    await expect(page.locator('#send')).toBeDisabled();
    await page.locator('#close').click();
    if (!(await page.evaluate(() => window.__posted.some(m => m.type === 'close')))) throw new Error('AI-free return absent');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error('horizontal overflow');
    results.push({ mode: direct ? 'experimental' : 'manual', theme, width, verdict: 'PASS', boundary: 'synthetic-host actual-webview headless-chromium' });
    await page.close();
  }
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, native: 'NOT RUN', realInference: 'NOT RUN' }, null, 2));
  console.log(JSON.stringify({ verdict: 'PASS', scenarios: results.length, output }));
} finally { await browser.close(); await rm(temp, { recursive: true, force: true }); }
