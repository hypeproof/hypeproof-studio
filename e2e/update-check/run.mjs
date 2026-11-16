// Read-only update UI check. Never clicks install or changes the installed app.
//
//   node update-check/run.mjs                                   # dev: installed App + this checkout's built extension
//   HPS_UPDATE_APP_PATH=<App> HPS_UPDATE_CHECK_SHIPPED=1 node update-check/run.mjs
//                                                               # release: the App exactly as shipped (macOS)
//
// Shipped mode (verify-unified-release.yml) injects nothing: the candidate's own bundled extension runs the
// update command against the public release API. It proves the shipped updater starts, reaches the
// public API and shows its answer. It is NOT an upgrade from the previous version: the updater reads only
// the latest published stable release (never a draft or an -rc), so previous -> rc cannot be offered
// before publication. Install and restart are NOT RUN (BB-022, BB-028 stay manual).
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const shipped = process.env.HPS_UPDATE_CHECK_SHIPPED === '1';
// In CI the shipped check must not fall back to the runner IP's anonymous budget (it decides nothing).
if (shipped && process.env.GITHUB_ACTIONS === 'true' && !process.env.HPS_UPDATE_CHECK_TOKEN?.trim()) {
  throw new Error('shipped update check in CI needs HPS_UPDATE_CHECK_TOKEN (the job token for the public release read)');
}
const mac = process.platform === 'darwin';
if (!mac && !(process.platform === 'win32' && shipped)) throw new Error('update-check drives a macOS App bundle, or a Windows install in shipped mode only (NOT RUN, not skipped silently)');
const resources = (dir) => (mac ? join(dir, 'Contents/Resources/app') : join(dir, 'resources/app'));
const osName = mac ? 'darwin-arm64' : 'win32-x64';
const shots = [];
const VIEWPORT = { width: 1280, height: 800 };
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const data = mkdtempSync(join(tmpdir(), 'hps-update-ui-'));
const report = resolve(process.env.HPS_UPDATE_REPORT_DIR || resolve(root, 'e2e/test-results/update-check'));
const appPath = join(data, mac ? 'HypeProof Studio.app' : 'HypeProof Studio');
mkdirSync(join(data, 'User'), { recursive: true });
mkdirSync(join(data, 'workspace'));
mkdirSync(report, { recursive: true });
writeFileSync(join(data, 'User/settings.json'), JSON.stringify({
  'hypeproofChat.proxyUrl': 'http://127.0.0.1:1/v1',
  'telemetry.telemetryLevel': 'off', 'workbench.startupEditor': 'none',
  // Shipped mode reads the public release anonymously, as a free seat does (REQ-I14, BB-025): the member
  // mirror needs a member GitHub login that a release runner does not have.
  ...(shipped ? { 'hypeproofChat.publicUpdates': true } : {}),
}));
let app;
try {
  // A development-extension launch can silently use the bundled old extension
  // if engine compatibility rejects the override. Inject only into a scratch
  // copy, then assert byte equality, so this run exercises the changed host.
  const appSource = process.env.HPS_UPDATE_APP_PATH || '/Applications/HypeProof Studio.app';
  if (mac) execFileSync('/usr/bin/ditto', [appSource, appPath]);
  else cpSync(appSource, appPath, { recursive: true });
  const source = join(root, 'extensions/hypeproof-chat/dist/extension.js');
  const injected = join(resources(appPath), 'extensions/hypeproof-chat/dist/extension.js');
  const appVersion = JSON.parse(readFileSync(join(resources(appPath), 'product.json'), 'utf8')).version;
  if (shipped) {
    // The candidate as shipped: nothing is injected, and the bundled extension must exist to be exercised.
    assert.ok(readFileSync(injected).length > 0, 'the App has no bundled hypeproof-chat extension');
    console.log(`shipped mode: App ${appVersion}, bundled extension untouched`);
  } else {
    copyFileSync(source, injected);
    assert.deepEqual(readFileSync(injected), readFileSync(source));
    execFileSync('/usr/bin/ditto', [join(root, 'extensions/hypeproof-chat/webview-ui/dist'), join(resources(appPath), 'extensions/hypeproof-chat/webview-ui/dist')]);
  }
  app = await electron.launch({
    executablePath: mac ? join(appPath, 'Contents/MacOS/HypeProof Studio') : join(appPath, 'HypeProof Studio.exe'),
    args: [`--user-data-dir=${data}`, `--extensions-dir=${join(data, 'extensions')}`, '--use-inmemory-secretstorage', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--folder-uri', pathToFileURL(join(data, 'workspace')).href],
    timeout: 30_000,
    // Shipped mode must not depend on whichever token the runner happens to carry. The only credential it
    // gets is the job token for the public read, through the acceptance-only path (updateTransport.ts
    // acceptanceCheckToken): a hosted runner's shared IP exhausts the 60/h anonymous budget.
    ...(shipped ? { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !['HPS_RELEASE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'].includes(k))),
      ...(process.env.HPS_UPDATE_CHECK_TOKEN ? { HPS_UPDATE_CHECK_ACCEPTANCE: '1' } : {}) } } : {}),
  });
  await app.evaluate(({ app: a, BrowserWindow }, v) => { a.dock?.hide(); for (const w of BrowserWindow.getAllWindows()) { w.setContentSize(v.width, v.height); w.setPosition(-4000, -4000); } }, VIEWPORT);
  const win = await app.firstWindow();
  await win.waitForSelector('.monaco-workbench');
  // Screenshots for the visual review (scripts/release/screenshot-review.mjs). Best effort by design: a
  // state this run cannot reach is recorded as not reached, it never fails the check.
  const shot = async (name, reach) => {
    const file = `${name}.png`;
    try {
      if (reach) await reach();
      await win.screenshot({ path: join(report, file) });
      shots.push({ name, file, reached: true });
    } catch (error) {
      shots.push({ name, file: null, reached: false, note: String(error.message).split('\n')[0].slice(0, 200) });
    }
  };
  const startPage = async () => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      for (const frame of win.frames()) if (await frame.getByRole('button', { name: '설정' }).count().catch(() => 0)) return frame;
      await win.waitForTimeout(500);
    }
    throw new Error('the Start page did not show');
  };
  await shot('start-page', startPage);
  const input = win.locator('.quick-input-widget input.input').first();
  // Every answer the update command can give (updateChecker.ts checkForUpdates / reportManualUpdateCheckFailure).
  // Only the first two prove the public API answered; the others are read so a run reports what the App said
  // instead of "no answer" (an info toast hides itself before the failure screenshot).
  const ANSWERS = [
    ['found', /새 버전 v.*발견/], ['latest', /최신 버전입니다/],
    ['rate-limited', /지금은 새 버전을 확인할 수 없어요/], ['no-access', /앱 안에서 새 버전을 확인할 수 없어요/],
    ['failed', /업데이트를 확인하지 못했습니다/],
  ];
  const message = win.locator('.notifications-toasts').getByText(new RegExp(ANSWERS.map(([, re]) => re.source).join('|'))).first();
  // The extension activates lazily, so the first palette run can precede the command's registration and
  // do nothing. Run the command again (3 tries, 15 s each) before calling it a failure.
  let shown = false;
  for (let attempt = 1; attempt <= 3 && !shown; attempt++) {
    await win.keyboard.press('Escape');
    await win.keyboard.press('ControlOrMeta+Shift+P');
    await input.fill('>HypeProof Chat: 업데이트 확인');
    await win.waitForTimeout(300);
    await win.keyboard.press('Enter');
    shown = await message.waitFor({ timeout: 15_000 }).then(() => true, () => false);
    if (!shown) console.log(`update command attempt ${attempt}: no answer within 15 s`);
  }
  if (!shown) {
    await win.screenshot({ path: join(report, 'update-check-failed.png') });
    throw new Error('the update command gave no answer in 3 attempts (see update-check-failed.png)');
  }
  const answer = await message.innerText();
  const kind = ANSWERS.find(([, re]) => re.test(answer))?.[0];
  if (kind !== 'found' && kind !== 'latest') {
    await win.screenshot({ path: join(report, 'update-check-failed.png') });
    const why = kind === 'rate-limited' ? 'the public release API rate limited this runner (anonymous GitHub API budget, HTTP 403/429); the updater handled it as designed (D19) but the API answer was not observed'
      : kind === 'no-access' ? 'the public release API refused the anonymous read (HTTP 401/403/404)' : 'the update check failed';
    throw new Error(`update command answered "${answer}" (${kind}): ${why}`);
  }
  console.log('PASS real Electron update command:', answer);
  const found = /새 버전/.test(answer);
  if (found) {
    await win.keyboard.press('Escape');
    await win.locator('.monaco-workbench .part.titlebar').first().click({ position: { x: 10, y: 10 }, force: true });
    await win.keyboard.press('ControlOrMeta+Shift+P');
    const focusTitle = JSON.parse(readFileSync(resolve(root, 'extensions/hypeproof-chat/package.json'), 'utf8')).contributes.commands.find(c => c.command === 'hypeproof-chat.focus').title;
    await input.fill(`>${focusTitle}`);
    await win.waitForTimeout(300);
    await win.keyboard.press('Enter');
    // The offer is drawn by whichever webview is showing: the chat panel (.hps-update-banner) or the Start
    // page (.studio-update, StartUpdateNotice), which is what a fresh profile shows. Look in every frame.
    const offer = '.hps-update-banner, .studio-update';
    let chat;
    try {
      const deadline = Date.now() + 30_000;
      while (!chat && Date.now() < deadline) {
        for (const frame of win.frames()) {
          if (await frame.locator(offer).count().catch(() => 0)) { chat = frame; break; }
        }
        if (!chat) await win.waitForTimeout(500);
      }
      assert.ok(chat, `no webview frame shows ${offer}`);
    } catch (error) {
      await win.screenshot({ path: join(report, 'update-banner-failed.png') });
      for (const f of win.frames()) console.error('frame', f.url().slice(-60), await f.locator(offer).count().catch(e => `err ${e.message.slice(0, 60)}`), (await f.locator('body').innerText({ timeout: 2000 }).catch(() => '')).slice(0, 80).replace(/\n/g, ' | '));
      throw error;
    }
    await win.keyboard.press('Escape');
    await win.screenshot({ path: join(report, 'update-banner.png') });
    shots.push({ name: 'update-banner', file: 'update-banner.png', reached: true });
    await chat.locator('.hps-update-banner-dismiss, .studio-update button:has-text("나중에")').first().click();
    await chat.locator(offer).waitFor({ state: 'hidden' });
    console.log('PASS real Electron update banner: visible, Later dismisses it without installation');
  }
  await shot('settings', async () => {
    const frame = await startPage();
    await frame.getByRole('button', { name: '설정' }).first().click();
    await win.waitForTimeout(1000);
  });
  await shot('composer', async () => {
    await win.keyboard.press('Escape');
    await win.keyboard.press('ControlOrMeta+Shift+P');
    const focusTitle = JSON.parse(readFileSync(resolve(root, 'extensions/hypeproof-chat/package.json'), 'utf8')).contributes.commands.find(c => c.command === 'hypeproof-chat.focus').title;
    await input.fill(`>${focusTitle}`);
    await win.waitForTimeout(300);
    await win.keyboard.press('Enter');
    let box;
    for (let i = 0; i < 20 && !box; i++) {
      for (const frame of win.frames()) { const t = frame.locator('textarea').first(); if (await t.count().catch(() => 0)) { box = t; break; } }
      if (!box) await win.waitForTimeout(500);
    }
    if (!box) throw new Error('no composer in any webview');
    await box.fill('안녕하세요');
    await win.keyboard.press('Escape');
  });
  // Evidence for the release workflow: what this run observed, and what it did not run.
  writeFileSync(join(report, 'update-check-result.json'), `${JSON.stringify({
    schema: 'hps-update-check/1', platform: osName, mode: shipped ? 'shipped' : 'injected', appVersion, outcome: found ? 'update-found' : 'latest', message: answer,
    covers: ['the App starts and its updater command runs', 'the public release API answers', found ? 'update banner shows and Later dismisses it, nothing installed' : 'the latest-version answer shows'],
    notRun: ['previous stable -> rc install and restart (BB-022, BB-028)', 'Windows'],
  }, null, 2)}\n`);
  await win.screenshot({ path: join(report, 'update-check.png') });
  console.log('NOT RUN: install/restart; this check never replaces the installed app.');
} finally {
  // Written even when the check failed, so the visual review sees the states that were reached.
  if (shots.length) writeFileSync(join(report, 'screenshots-manifest.json'), `${JSON.stringify({ schema: 'hps-acceptance-screenshots/1', os: osName, viewport: VIEWPORT, states: shots }, null, 2)}\n`);
  if (app) await app.close();
  rmSync(data, { recursive: true, force: true });
}
