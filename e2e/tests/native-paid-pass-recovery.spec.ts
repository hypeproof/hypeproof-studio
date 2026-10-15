import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchApp, closeApp, chatFrame, startFrame, type AppContext } from '../fixtures/app';

const output = process.env.HPS_NATIVE_EVIDENCE_DIR ? resolve(process.env.HPS_NATIVE_EVIDENCE_DIR) : '';
const outageMs = Number(process.env.HPS_RECOVERY_OUTAGE_MS);
const proxyControl = process.env.HPS_RECOVERY_PROXY_CONTROL_URL!;
const proxySecret = process.env.HPS_RECOVERY_PROXY_SECRET!;
const serviceControl = process.env.HPS_RECOVERY_SERVICE_CONTROL_URL!;
const serviceSecret = process.env.HPS_RECOVERY_CONTROL_SECRET!;
const marker = 'HPS_PAID_RECOVERY_MARKER_20261015';

async function control(path: string, method = 'GET') {
  const response = await fetch(proxyControl + path, { method, headers: { 'x-hps-recovery-secret': proxySecret } });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ listening: boolean }>;
}

async function grantState() {
  const response = await fetch(serviceControl, { headers: { 'x-hps-recovery-secret': serviceSecret } });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    schema: string;
    grants: Array<{ grant_fingerprint: string; profile_id: string; started_at: number; expires_at: number; duration_ms: number; request_limit: number; requests_used: number; revoked: boolean; busy: boolean }>;
    request_statuses: Record<string, number>;
  }>;
}

async function encryptedStorage(ctx: AppContext) {
  return ctx.app.evaluate(({ app, safeStorage }) => ({ name: app.getName(), encrypted: safeStorage.isEncryptionAvailable() }));
}

async function beginSavedActivity(ctx: AppContext) {
  const start = await startFrame(ctx.win);
  await expect(start.locator('input[type=password]:visible')).toHaveCount(0);
  const button = start.getByRole('button', { name: /^(?:이어서 하기|수업 시작하기|이 활동 시작하기)$/ }).first();
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  return chatFrame(ctx.win);
}

async function observedPassCopy(ctx: AppContext) {
  const start = await startFrame(ctx.win);
  const activity = (await start.locator('.studio-verified').textContent())?.trim() ?? '';
  const allowanceRow = start.locator('.studio-course dl > div').filter({ hasText: '남은 이용' }).locator('dd');
  const allowance = await allowanceRow.count() ? ((await allowanceRow.textContent())?.trim() ?? null) : null;
  expect(activity).toMatch(/^(?:이용권|연결된 수업)$/);
  if (allowance) expect(allowance).toMatch(/^AI 요청 \d+번 남음 · \d+월 \d+일까지$/);
  return { activity, allowance, allowance_and_expiry_rendered: allowance !== null };
}

async function observedChatCopy(chat: Awaited<ReturnType<typeof chatFrame>>) {
  const label = chat.getByLabel('현재 활동');
  if (!await label.count()) return null;
  const copy = ((await label.textContent()) ?? '').trim();
  expect(copy).toMatch(/^이용권 · .+ · \d+월 \d+일까지$/);
  return copy;
}

async function waitActualDuration(duration: number) {
  const start = process.hrtime.bigint();
  let nextLog = 5 * 60_000;
  while (Number(process.hrtime.bigint() - start) / 1e6 < duration) {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    await new Promise(resolve => setTimeout(resolve, Math.min(60_000, duration - elapsed)));
    const current = Number(process.hrtime.bigint() - start) / 1e6;
    if (current >= nextLog) {
      const proxy = await control('/state');
      expect(proxy.listening).toBe(false);
      expect((await fetch(serviceControl.replace('/__test/paid-recovery', '/v1/health'))).ok).toBe(true);
      console.log(`paid recovery outage still active: ${Math.floor(current / 60000)}m`);
      nextLog += 5 * 60_000;
    }
  }
  return Number(process.hrtime.bigint() - start) / 1e6;
}

test('paid pass survives a real offline restart without code re-entry', async () => {
  test.skip(process.env.HPS_PAID_RECOVERY !== '1', 'hosted paid recovery runner only');
  test.setTimeout(outageMs + 12 * 60_000);
  mkdirSync(output, { recursive: true });
  let ctx = await launchApp({ preseedToken: false, stayOnStart: true, persistentTestSecrets: true, preseedCoach: { name: '코치' } });
  let codeEntries = 0, approvalsStopped = false;
  const approvals = (async () => {
    while (!approvalsStopped) {
      try {
        const box = ctx.win.locator('.monaco-dialog-box').first();
        if (await box.isVisible().catch(() => false)) {
          const copy = (await box.textContent()) || '';
          const allowed = /restart to take effect/i.test(copy) ? /^Cancel$/i : /^(저장|읽기|Approve|승인)$/;
          const button = box.locator('.monaco-button').filter({ hasText: allowed }).first();
          if (await button.isVisible().catch(() => false)) await button.click();
        }
      } catch { /* app restarts */ }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  })();
  try {
    expect(await encryptedStorage(ctx)).toEqual({ name: 'HypeProof Studio', encrypted: true });
    const start = await startFrame(ctx.win);
    const choose = start.getByRole('button', { name: /^(?:AI 체험하기|수업에 참여하기)$/ }).first();
    if (await choose.isVisible().catch(() => false)) await choose.click();
    const code = start.getByLabel(/^(?:체험 참여 코드|수업 참여 코드)$/).first();
    await expect(code).toBeVisible();
    await code.fill(ctx.token); codeEntries++;
    await start.getByRole('button', { name: /^(?:코드 확인하기|수업 확인하기)$/ }).click();
    const enter = start.getByRole('button', { name: /^(?:이어서 하기|수업 시작하기|이 활동 시작하기)$/ }).first();
    await expect(enter).toBeVisible({ timeout: 60_000 });
    await expect(start.locator('input[type=password]:visible')).toHaveCount(0);
    const startCopyBefore = await observedPassCopy(ctx);
    if (startCopyBefore.allowance) expect(startCopyBefore.allowance).toMatch(/^AI 요청 8번 남음 ·/);
    await enter.click();
    let chat = await chatFrame(ctx.win);
    const chatCopyBefore = await observedChatCopy(chat);
    const input = chat.getByRole('textbox', { name: /보낼 메시지/ });
    await input.fill(`합성 복구 검사입니다. 현재 작업 폴더에 recovery-marker.txt 파일을 만들고 내용은 ${marker} 한 줄만 넣어 주세요. 저장 뒤 다시 읽어 확인하세요. 셸, 브라우저, 외부 전송은 사용하지 마세요.`);
    await input.press('Enter');
    const file = join(ctx.wsDir, 'recovery-marker.txt');
    await expect.poll(() => existsSync(file), { timeout: 180_000, intervals: [1000, 3000] }).toBe(true);
    await expect(chat.locator('.hps-btn-stop')).toHaveCount(0, { timeout: 180_000 });
    const firstUserText = ((await chat.locator('.hps-msg-user').last().textContent()) ?? '').trim();
    const firstAssistantText = ((await chat.locator('.hps-msg-assistant').last().textContent()) ?? '').trim();
    expect(firstUserText).toContain('recovery-marker.txt');
    expect(firstAssistantText).toContain(marker);
    const retainedBytes = readFileSync(file);
    expect(retainedBytes.toString('utf8').trim()).toBe(marker);
    const before = await grantState();
    expect(before.grants).toHaveLength(1);
    expect(before.grants[0]).toMatchObject({ profile_id: 'synthetic-release-acceptance', duration_ms: 7200000, request_limit: 8, revoked: false, busy: false });
    expect(before.grants[0].requests_used).toBeGreaterThan(0);
    expect(Object.keys(before.request_statuses)).toEqual(['completed']);
    expect(before.request_statuses.completed).toBe(before.grants[0].requests_used);
    const userDataDir = ctx.userDataDir;
    await ctx.app.close();
    const pausedAt = new Date().toISOString();
    expect((await control('/pause', 'POST')).listening).toBe(false);
    expect((await fetch(serviceControl.replace('/__test/paid-recovery', '/v1/health'))).ok).toBe(true);

    ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: false, stayOnStart: true, persistentTestSecrets: true, preseedCoach: { name: '코치' } });
    expect(await encryptedStorage(ctx)).toEqual({ name: 'HypeProof Studio', encrypted: true });
    const offlineStart = await startFrame(ctx.win);
    await expect(offlineStart.locator('input[type=password]:visible')).toHaveCount(0, { timeout: 30_000 });
    const offlineElapsedMs = await waitActualDuration(outageMs);
    expect(offlineElapsedMs).toBeGreaterThanOrEqual(outageMs);
    expect((await control('/state')).listening).toBe(false);
    const during = await grantState();
    expect(during.grants[0].grant_fingerprint).toBe(before.grants[0].grant_fingerprint);
    expect(during.grants[0].requests_used).toBe(before.grants[0].requests_used);
    expect(during.request_statuses).toEqual(before.request_statuses);
    await control('/resume', 'POST');
    await expect.poll(async () => (await fetch(process.env.HPS_E2E_PROXY_URL!.replace('/v1', '/v1/health'))).ok, { timeout: 15_000 }).toBe(true);
    await ctx.app.close();

    ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: false, stayOnStart: true, persistentTestSecrets: true, preseedCoach: { name: '코치' } });
    const startCopyAfter = await observedPassCopy(ctx);
    if (startCopyAfter.allowance) expect(startCopyAfter.allowance).toContain(`AI 요청 ${8 - before.grants[0].requests_used}번 남음`);
    chat = await beginSavedActivity(ctx);
    const chatCopyAfter = await observedChatCopy(chat);
    await expect(chat.locator('.hps-msg-user').filter({ hasText: 'recovery-marker.txt' }).first()).toContainText(firstUserText);
    await expect(chat.locator('.hps-msg-assistant').filter({ hasText: marker }).first()).toContainText(firstAssistantText);
    expect(readFileSync(file)).toEqual(retainedBytes);
    const recoveredInput = chat.getByRole('textbox', { name: /보낼 메시지/ });
    await recoveredInput.fill('recovery-marker.txt를 읽고 파일에 실제로 있는 한 줄만 그대로 답해 주세요. 파일을 바꾸지 말고 셸, 브라우저, 외부 전송은 사용하지 마세요.');
    await recoveredInput.press('Enter');
    await expect(chat.locator('.hps-btn-stop')).toHaveCount(0, { timeout: 180_000 });
    await expect(chat.locator('.hps-msg-assistant').last()).toContainText(marker);
    expect(readFileSync(file)).toEqual(retainedBytes);
    const after = await grantState();
    expect(after.grants).toHaveLength(1);
    expect(after.grants[0].grant_fingerprint).toBe(before.grants[0].grant_fingerprint);
    expect(after.grants[0].started_at).toBe(before.grants[0].started_at);
    expect(after.grants[0].expires_at).toBe(before.grants[0].expires_at);
    expect(after.grants[0].expires_at).toBeGreaterThan(Date.now());
    expect(after.grants[0].requests_used).toBeGreaterThan(before.grants[0].requests_used);
    expect(after.grants[0].requests_used).toBeLessThanOrEqual(8);
    expect(Object.keys(after.request_statuses)).toEqual(['completed']);
    expect(after.request_statuses.completed).toBe(after.grants[0].requests_used);
    expect(after.grants[0]).toMatchObject({ revoked: false, busy: false });
    expect(codeEntries).toBe(1);
    const checks = [
      'real SecretStorage encrypted under ephemeral hosted keychain',
      'code entered exactly once',
      'App restarted while front proxy was offline',
      'backend grant stayed alive and unchanged during outage',
      'actual monotonic outage duration met',
      'same grant resumed after proxy restoration',
      'successful request completed after recovery',
      'workspace file bytes retained',
    ];
    writeFileSync(join(output, 'grant-before.json'), JSON.stringify(before, null, 2));
    writeFileSync(join(output, 'grant-during.json'), JSON.stringify(during, null, 2));
    writeFileSync(join(output, 'grant-after.json'), JSON.stringify(after, null, 2));
    writeFileSync(join(output, 'result.json'), JSON.stringify({
      schema: 'hps-paid-recovery-app/1', status: 'PASS', mode: process.env.HPS_RECOVERY_MODE,
      code_entries: codeEntries, same_grant: true, file_retained: true,
      offline_started_at: pausedAt, offline_elapsed_ms: offlineElapsedMs,
      grant_request_limit: after.grants[0].request_limit,
      grant_requests_used: after.grants[0].requests_used,
      observed_copy: {
        start_before: startCopyBefore, chat_before: chatCopyBefore,
        start_after: startCopyAfter, chat_after: chatCopyAfter,
        limitation: startCopyBefore.allowance_and_expiry_rendered ? null : 'public App does not render paid allowance or expiry copy; Service grant state is recorded separately',
      },
      checks,
    }, null, 2));
  } finally {
    approvalsStopped = true;
    await approvals;
    await closeApp(ctx);
  }
});
