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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const shipped = process.env.HPS_UPDATE_CHECK_SHIPPED === '1';
if (process.platform !== 'darwin') throw new Error('update-check drives the macOS App bundle; there is no Windows mode (NOT RUN, not skipped silently)');
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const data = mkdtempSync(join(tmpdir(), 'hps-update-ui-'));
const report = resolve(process.env.HPS_UPDATE_REPORT_DIR || resolve(root, 'e2e/test-results/update-check'));
const appPath = join(data, 'HypeProof Studio.app');
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
  execFileSync('/usr/bin/ditto', [process.env.HPS_UPDATE_APP_PATH || '/Applications/HypeProof Studio.app', appPath]);
  const source = join(root, 'extensions/hypeproof-chat/dist/extension.js');
  const injected = join(appPath, 'Contents/Resources/app/extensions/hypeproof-chat/dist/extension.js');
  const appVersion = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' })).CFBundleShortVersionString;
  if (shipped) {
    // The candidate as shipped: nothing is injected, and the bundled extension must exist to be exercised.
    assert.ok(readFileSync(injected).length > 0, 'the App has no bundled hypeproof-chat extension');
    console.log(`shipped mode: App ${appVersion}, bundled extension untouched`);
  } else {
    copyFileSync(source, injected);
    assert.deepEqual(readFileSync(injected), readFileSync(source));
    execFileSync('/usr/bin/ditto', [join(root, 'extensions/hypeproof-chat/webview-ui/dist'), join(appPath, 'Contents/Resources/app/extensions/hypeproof-chat/webview-ui/dist')]);
  }
  app = await electron.launch({
    executablePath: join(appPath, 'Contents/MacOS/HypeProof Studio'),
    args: [`--user-data-dir=${data}`, `--extensions-dir=${join(data, 'extensions')}`, '--use-inmemory-secretstorage', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--folder-uri', pathToFileURL(join(data, 'workspace')).href],
    timeout: 30_000,
    // Shipped mode must not depend on whichever token the runner happens to carry.
    ...(shipped ? { env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !['HPS_RELEASE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'].includes(k))) } : {}),
  });
  await app.evaluate(({ app: a, BrowserWindow }) => { a.dock?.hide(); for (const w of BrowserWindow.getAllWindows()) w.setPosition(-4000, -4000); });
  const win = await app.firstWindow();
  await win.waitForSelector('.monaco-workbench');
  const input = win.locator('.quick-input-widget input.input').first();
  const message = win.locator('.notifications-toasts').getByText(/새 버전 v.*발견|최신 버전입니다/);
  // The extension activates lazily, so the first palette run can precede the command's registration and
  // do nothing. Run the command again (3 tries, 15 s each) before calling it a failure.
  let shown = false;
  for (let attempt = 1; attempt <= 3 && !shown; attempt++) {
    await win.keyboard.press('Escape');
    await win.keyboard.press('Meta+Shift+P');
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
  console.log('PASS real Electron update command:', answer);
  const found = /새 버전/.test(answer);
  if (found) {
    await win.keyboard.press('Escape');
    await win.locator('.monaco-workbench .part.titlebar').first().click({ position: { x: 10, y: 10 }, force: true });
    await win.keyboard.press('Meta+Shift+P');
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
    await chat.locator('.hps-update-banner-dismiss, .studio-update button:has-text("나중에")').first().click();
    await chat.locator(offer).waitFor({ state: 'hidden' });
    console.log('PASS real Electron update banner: visible, Later dismisses it without installation');
  }
  // Evidence for the release workflow: what this run observed, and what it did not run.
  writeFileSync(join(report, 'update-check-result.json'), `${JSON.stringify({
    schema: 'hps-update-check/1', mode: shipped ? 'shipped' : 'injected', appVersion, outcome: found ? 'update-found' : 'latest', message: answer,
    covers: ['the App starts and its updater command runs', 'the public release API answers', found ? 'update banner shows and Later dismisses it, nothing installed' : 'the latest-version answer shows'],
    notRun: ['previous stable -> rc install and restart (BB-022, BB-028)', 'Windows'],
  }, null, 2)}\n`);
  await win.screenshot({ path: join(report, 'update-check.png') });
  console.log('NOT RUN: install/restart; this check never replaces the installed app.');
} finally {
  if (app) await app.close();
  rmSync(data, { recursive: true, force: true });
}
