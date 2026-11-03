// Epic #3418 — the skill store in the actual isolated macOS Dev app (scripts/studio-dev.py --account-preview), against a
// local development Service on 127.0.0.1:8793. Synthetic accounts and Service only.
//
// The Lab's part (approving the device sign-in) is played through the Service's own Lab bridge with the local key.
// Payment: the checkout URL the App opens is captured (never opened in the user's browser). With STORE_FIXTURE_PAY=1
// the gateway's browser redirect is replayed against the Service, which then confirms with whatever gateway it is
// configured for; in a local run that is a FIXTURE stand-in (HPS_STORE_GATEWAY_BASE), not Toss. Report it as fixture.
//
//   HPS_STORE_DEV_STATE=<studio-dev state dir> HPS_STORE_EVIDENCE=<out dir> HPS_STORE_DEV_VARS=<worker/.dev.vars> \
//   STORE_ROLE=buyer|seller STORE_ACCOUNT=acc_… [STORE_FIXTURE_PAY=1] node e2e/store/mac-store.mjs
//
// A run is composed by the Service on a chat turn (design v1 D2); its App entry ships with the quest slice (#1605).
import { _electron as electron } from '@playwright/test';
import { macWindow } from '../classroom/mac-window.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const state = process.env.HPS_STORE_DEV_STATE, out = process.env.HPS_STORE_EVIDENCE, varsFile = process.env.HPS_STORE_DEV_VARS;
const role = process.env.STORE_ROLE, accountId = process.env.STORE_ACCOUNT;
if (!state || !out || !varsFile || !['buyer', 'seller'].includes(role) || !/^acc_[0-9a-f]{32}$/.test(accountId ?? '')) throw Error('see header for the required environment');
const SERVICE = 'http://127.0.0.1:8793';
const vars = Object.fromEntries(readFileSync(varsFile, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), JSON.parse(l.slice(l.indexOf('=') + 1))]));
const receipt = JSON.parse(readFileSync(path.join(state, 'receipt.json'), 'utf8'));
if (!receipt.official_app_unchanged || receipt.app.startsWith('/Applications/')) throw Error('Prepared isolated app required');
mkdirSync(out, { recursive: true });
const log = [];
const note = (line) => { log.push(`${new Date().toISOString()} ${line}`); console.log(line); };

const app = await electron.launch({
  executablePath: path.join(receipt.app, 'Contents/MacOS/HypeProof Studio'),
  args: ['--user-data-dir=' + path.join(state, 'user-data'), '--extensions-dir=' + path.join(state, 'extensions'), '--use-inmemory-secretstorage', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=9433', '--folder-uri', new URL('file://' + path.join(state, 'workspace')).href],
  env: { ...process.env, VSCODE_CLI: '1', HPS_TEST_E2E: '1' }, timeout: 45000,
});
// Keep the window off-screen and capture every external link instead of opening the user's browser.
await app.evaluate(({ app, BrowserWindow, shell }) => {
  app.dock?.hide();
  const stash = (w) => { w.setFocusable(false); w.setPosition(-4000, -4000); w.showInactive(); };
  for (const w of BrowserWindow.getAllWindows()) stash(w);
  app.on('browser-window-created', (_e, w) => { stash(w); w.on('show', () => stash(w)); });
  globalThis.__storeLinks = [];
  shell.openExternal = async (url) => { globalThis.__storeLinks.push(url); };
});
const links = () => app.evaluate(() => globalThis.__storeLinks);
const driver = macWindow({ debugPort: 9433, realFetch: fetch, out });
const window = await driver.attach();
await window.setViewportSize({ width: 1440, height: 1000 });
await window.keyboard.press('Escape');
let shotNo = 0;
const shot = async (name) => { await window.waitForTimeout(400); const file = `${String(++shotNo).padStart(2, '0')}-${role}-${name}.png`; await window.screenshot({ path: path.join(out, file) }); note(`SHOT ${file}`); };
const has = (frame, text) => frame.evaluate(`document.body.textContent.includes(${JSON.stringify(text)})`);
/** Marks the first button whose text is exactly `text` so the driver can press it like a person would. */
const pressText = async (frame, text, label = text) => {
  const tag = 'e2e' + Math.random().toString(36).slice(2, 8);
  const found = await frame.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!b)return false;b.setAttribute('data-e2e','${tag}');return true;})()`);
  if (!found) throw Error(`no enabled button "${text}"`);
  await driver.press(frame, `[data-e2e=${tag}]`, label);
};
const setInput = (frame, selector, value) => frame.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.constructor.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);

try {
  // 1. Personal account sign-in, the Lab's approval played through the Service bridge.
  const start = await driver.frame('.studio-start');
  await driver.press(start, '.studio-account .studio-primary', 'Google sign-in');
  await driver.wait(() => has(start, '브라우저에서 연결을 승인해 주세요'), 'device approval waiting', 30000);
  const link = (await links()).at(-1);
  const userCode = new URL(link).searchParams.get('code');
  const approve = await fetch(SERVICE + '/v1/internal/accounts/device/approve', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hps-account-key': vars.HPS_ACCOUNT_LAB_KEY }, body: JSON.stringify({ user_code: userCode, account_id: accountId, approve: true }) });
  note(`device approval ${approve.status} (local Lab bridge)`);
  await driver.wait(() => has(start, '내 이용권'), 'signed in', 60000);
  // The device sign-in's return link asks to reopen the App; the local run has already signed in, so decline it.
  // Workbench dialog buttons are <a class="monaco-button">, not <button>.
  const dialogButton = (text) => window.locator('.monaco-dialog-box .monaco-button', { hasText: text });
  await dialogButton('Cancel').first().click({ timeout: 10000 }).then(() => note('declined the return-link prompt'), () => note('no return-link prompt'));
  await shot('signed-in');

  // 2. The start-page entry opens the store panel.
  await pressText(start, '스킬 스토어', 'start page store entry');
  const store = await driver.frame('.skill-store', "document.querySelector('.skill-store [aria-label=\"스킬 목록\"], .skill-store [role=alert]')!==null || document.body.textContent.includes('아직 올라온')", 60000);
  await driver.wait(async () => !(await has(store, '불러오는 중이에요')), 'store loaded', 30000);
  await shot('store-browse');

  if (role === 'buyer') {
    // Rule shown before purchase.
    note('refund rule visible before purchase: ' + await has(store, '구매 후 7일 안에, 한 번도 실행하지 않았다면 전액 환불돼요.'));
    if (await has(store, '태어난 해를 한 번만 알려 주세요')) {
      await setInput(store, '.skill-store [aria-label="태어난 해"] input', '1985');
      await pressText(store, '알려 주기', 'declare birth year');
      await driver.wait(async () => !(await has(store, '태어난 해를 한 번만 알려 주세요')), 'age recorded', 30000);
    }
    const buyOnce = async (n) => {
      await pressText(store, '10,000원 카드 결제', 'card purchase');
      const checkout = await driver.wait(async () => (await links()).find((u) => u.includes('/v1/store/checkout?order=') && !log.some((l) => l.includes(u))), 'checkout link captured', 30000);
      note(`checkout ${n} opened (captured, not shown in a browser): ${checkout}`);
      await shot(`checkout-waiting-${n}`);
      if (process.env.STORE_FIXTURE_PAY !== '1') return null;
      const order = new URL(checkout).searchParams.get('order');
      const back = await fetch(`${SERVICE}/v1/store/return?orderId=${order}&paymentKey=fixture_${order.slice(4, 20)}&amount=10000`, { redirect: 'manual' });
      note(`FIXTURE gateway return replayed: ${back.status} ${back.headers.get('location')}`);
      await driver.wait(() => has(store, '설치했어요.'), 'installed after payment', 60000);
      return order;
    };
    // A rerun continues from an install a previous run paid for.
    const already = await has(store, '설치했어요.');
    if (already) { note('already installed from an earlier run: continuing at the refund'); await pressText(store, '내 스킬', 'my skills'); await driver.wait(() => has(store, '실행하기 전에만 환불할 수 있어요'), 'refundable install', 30000); }
    const first = already ? 'existing' : await buyOnce(1);
    if (first) {
      await shot('installed');
      // Custody (design v1 D1): the installed skill shows its public steps; the App has no call that fetches its text.
      await pressText(store, '내 스킬', 'my skills').catch(() => {});
      note('public steps shown on the install: ' + await store.evaluate("document.querySelectorAll('[aria-label=\"포함된 단계\"] li').length"));
      note('run button present: ' + await store.evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='실행')"));
      await pressText(store, '환불', 'refund before first run');
      await dialogButton('환불하기').first().waitFor({ timeout: 15000 });
      await shot('refund-confirm');
      await dialogButton('환불하기').first().click();
      await driver.wait(() => has(store, '환불했어요. 스킬도 지웠어요.'), 'refunded', 30000);
      await shot('refunded');
      await pressText(store, '둘러보기', 'back to the list');
      await driver.wait(() => has(store, '10,000원 카드 결제'), 'buyable again', 30000);
    }
  } else {
    await pressText(store, '판매', 'seller tab');
    await driver.wait(() => has(store, '정산 내역'), 'settlement view', 30000);
    await store.evaluate("document.querySelector('[aria-label=\"정산 내역\"]')?.scrollIntoView()");
    await shot('seller-settlement');
    note('settlement rows: ' + await store.evaluate("JSON.stringify([...document.querySelectorAll('[aria-label=\"정산 내역\"] tbody tr')].map(r=>r.innerText))"));
  }
} finally {
  writeFileSync(path.join(out, `run-${role}.log`), log.join('\n') + '\n');
  await app.close();
}
