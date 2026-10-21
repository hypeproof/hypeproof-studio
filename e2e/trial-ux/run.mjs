import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { serviceSourceManifest } from '../service-provenance.mjs';

// This reuses start-page/run.mjs's built React + controlled extension-host
// boundary. Outbound messages are assertions, not real API/OS operations.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(repo, 'extensions/hypeproof-chat/webview-ui/dist');
const out = path.resolve(process.env.HPS_TRIAL_UX_OUT || path.join(repo, 'e2e/test-results/trial-ux', new Date().toISOString().replace(/[:.]/g, '-')));
await fs.mkdir(out, { recursive: true });
const bundled = await build({ entryPoints: [fileURLToPath(import.meta.resolve('@hypeproof/service-testkit/src/profiles/studio-native-trial.ts'))], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.md': 'text' } });
const { profile: sourceProfile } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
// The host's own trial-ending copy (REQ-L12 (13)), so TUX-SP-05 renders what the host sends, not a paraphrase.
const passCopy = await build({ entryPoints: [path.join(repo, 'extensions/hypeproof-chat/src/passPurchase.ts')], bundle: true, write: false, platform: 'node', format: 'esm' });
const { TRIAL_EXPIRED_FRIENDLY, withTrialPassPointer } = await import(`data:text/javascript;base64,${Buffer.from(passCopy.outputFiles[0].text).toString('base64')}`);
const native = {
  ...sourceProfile, profile_id: sourceProfile.id,
  // `assess: true` because this suite OWNS TUX-OBS-01..10, and after ADR 0010 the
  // results panel is drawn only for a cohort that opted into assessment. The trial
  // is that cohort (`studio-native-trial`), so this mirrors what it is served — it
  // is not a test-only switch.
  observation: { format: 'hps-observation/1', scope: 'synthetic-scope-a', assess: true },
  series_index: 1, series_total: 1,
};
const config = (profile = native, extra = {}) => ({ proxyUrl: 'http://controlled-host.invalid/v1', model: 'controlled-host-only', hasToken: true, coach: { name: '다른 수업 이름', personality: '', configured: true }, profile, ...extra });
const course = { id: 'studio-native-trial', name: native.display_name, coach: '코치', series: '1 / 1', workspace: '~/SyntheticTrial' };
const event = (id, kind, text, extra = {}) => ({ id, seq: Number(id.slice(1)), kind, text, task: 'synthetic-task', at: '2026-09-08T00:00:00.000Z', assistance: 'unknown', ...extra });
const batch = { format: 'hps-observation/1', scope: 'synthetic-scope-a', session: 'synthetic-session', program: 'studio-native-trial', events: [event('e1', 'user', '대상을 확인하고 내용을 수정해주세요.'), event('e2', 'artifact', '<h1>첫 저장</h1>', { sha256: 'a'.repeat(64) }), event('e3', 'artifact', '<h1>최근 저장</h1>', { sha256: 'b'.repeat(64) })] };
const findings = ['TASTE', 'INTENT', 'CONTEXT', 'VERIFY', 'DELEGATE', 'ITERATE', 'OWNERSHIP'].map((asset, i) => ({ asset, status: i ? 'unobserved' : 'observed', interpretation: i ? '이 기록에서 확인하지 못했습니다.' : '대상을 먼저 확인하도록 요청했습니다.', assistance: 'unknown', evidence: i ? [] : [{ event_id: 'e1', quote: batch.events[0].text }], next: '다음 작업의 확인 기준을 적어보세요.' }));
const learningPath = { title: '강의에서 계속하기', reason: '다음 학습에서 기준을 적용해보세요.', url: 'https://hypeproof-ai.xyz/training' };
const history = [{ id: 'u1', role: 'user', content: '가상 안내 페이지를 만들어주세요.', createdAt: 1 }, { id: 'a1', role: 'assistant', content: '초안입니다.\n```html\n<!doctype html><html><body><h1>합성 초안</h1></body></html>\n```', createdAt: 2, citations: [{ url: 'https://example.org/source', title: '합성 출처', domain: 'example.org', tier: 4 }] }];

// A new verdict gets positive/negative controls before browser execution.
const emitted = (messages, type) => messages.filter(m => m.type === type);
const containsRequest = (messages, expected) => emitted(messages, expected.type).some(m => Object.entries(expected).every(([k, v]) => JSON.stringify(m[k]) === JSON.stringify(v)));
assert.equal(containsRequest([{ type: 'sendMessage', text: 'known' }], { type: 'sendMessage', text: 'known' }), true);
assert.equal(containsRequest([{ type: 'sendMessage', text: 'wrong' }], { type: 'sendMessage', text: 'known' }), false);
assert.equal(containsRequest([], { type: 'sendMessage' }), false);
// Draft snapshots carry their next-turn mode, including the default. Keep the
// whole snapshot comparison strict so a lost or changed mode cannot pass.
const draftControl = { type: 'saveActivityDraft', activityId: 'control-activity', nonce: 'control-flush', draft: { text: 'preserved', images: [], queued: null, toolMode: 'auto' } };
assert.equal(containsRequest([draftControl], draftControl), true, 'exact draft snapshot must match');
const draftWithoutMode = { ...draftControl.draft }; delete draftWithoutMode.toolMode;
for (const [name, draft] of [
  ['missing tool mode', draftWithoutMode],
  ['wrong tool mode', { ...draftControl.draft, toolMode: 'web-search' }],
  ['changed text', { ...draftControl.draft, text: 'lost' }],
  ['changed images', { ...draftControl.draft, images: ['unexpected'] }],
  ['changed queue', { ...draftControl.draft, queued: 'unexpected' }],
]) assert.equal(containsRequest([{ ...draftControl, draft }], draftControl), false, `${name} must not match the saved draft`);
for (const [key, value] of [['activityId', 'wrong-activity'], ['nonce', 'wrong-flush']]) {
  assert.equal(containsRequest([{ ...draftControl, [key]: value }], draftControl), false, `wrong ${key} must not match the draft acknowledgement`);
}
// TUX-COND-07 — the end-of-trial card is built by the host's own pure helper, so the browser
// renders what the host sends, not a paraphrase. Fixtures: an open-trial seat (studio-open-trial) and a Service that
// sells two passes; the turn ended with the observed exhausted sentence.
const endCardSrc = await build({ entryPoints: [path.join(repo, 'extensions/hypeproof-chat/src/trialEndCard.ts')], bundle: true, write: false, platform: 'node', format: 'esm' });
const { trialEndCardView, endCardCopyProblems, passOfferLine } = await import(`data:text/javascript;base64,${Buffer.from(endCardSrc.outputFiles[0].text).toString('base64')}`);
const endCardTheme = JSON.parse(await fs.readFile(path.join(repo, 'extensions/hypeproof-chat/media/hypeproof-theme.json'), 'utf8'));
const endCardDarkTheme = ':root{color-scheme:dark;' + Object.entries(endCardTheme.colors).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v};`).join('') + '--vscode-descriptionForeground:#ACB9A5;}';
const endCardPasses = [{ id: 'pass-lite', label: '라이트', amount: 30000, durationDays: 30, requestLimit: 200, recommended: true }, { id: 'pass-basic', label: '기본', amount: 55000, durationDays: 30, requestLimit: 350 }];
const endCardExhausted = new Error('Claude Code returned an error result: API Error: Request rejected (429) · 개인 체험의 총 요청 한도에 도달했습니다.');
const endCard = trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial' }, err: endCardExhausted, products: endCardPasses });
// Controls for the judgment the browser case relies on: open-trial seat → card; code-issued trial or mid-work → none.
assert.ok(endCard, 'positive control: an open-trial ending yields a card');
assert.equal(trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-native-trial' }, err: endCardExhausted, products: endCardPasses }), null, 'negative control: code-issued trial (flag off)');
assert.equal(trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial' }, err: new Error('fetch failed'), products: endCardPasses }), null, 'negative control: mid-work failure');
// TUX-COND-08 — the optional email section rides on the same card, only when the Service advertises it.
const notifyOffer = { available: true, consent_version: 'free-notify-2026-10-19' };
const notifyCard = trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial', notify_optin: notifyOffer }, err: endCardExhausted, products: endCardPasses });
assert.equal(notifyCard?.notify?.consentVersion, notifyOffer.consent_version, 'positive control: an advertised free seat gets the section');
assert.equal(endCard.notify, undefined, 'negative control: not advertised');
assert.equal(trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial', notify_optin: { ...notifyOffer, available: false } }, err: endCardExhausted, products: endCardPasses }).notify, undefined, 'negative control: available false');
assert.equal(trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-native-trial', notify_optin: notifyOffer }, err: endCardExhausted, products: endCardPasses }), null, 'negative control: code-issued trial');
assert.equal(trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial', notify_optin: notifyOffer, pass: { request_limit: 1, requests_used: 1 } }, err: endCardExhausted, products: endCardPasses }), null, 'negative control: pass seat');
assert.equal(trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial', notify_optin: notifyOffer }, err: new Error('fetch failed'), products: endCardPasses }), null, 'negative control: before the end');
const notifySubmittedCard = trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial', notify_optin: notifyOffer }, err: endCardExhausted, products: endCardPasses, notifySubmitted: true });
assert.equal(notifySubmittedCard.notify.submitted, true);
// Named apart from the in-block `trialActivity(trial)` helper, which shadowed this object so the
// end-card cases spread a function and ran on a seat with no activity (a classroom audience).
const endCardTrialSeat = { activity: { id: 'activity-trial', name: '합성 체험', kind: 'trial', workspace: '/synthetic/trial', verified: true } };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const target = path.resolve(dist, name);
    if (!target.startsWith(`${dist}/`)) throw Error('outside dist');
    let body = await fs.readFile(target);
    if (name === 'index.html' && url.searchParams.get('surface') === 'start') body = Buffer.from(body.toString().replace('<html', '<html data-surface="start"'));
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const results = [];
const url = `http://127.0.0.1:${server.address().port}`;
const host = (p, data) => p.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
const startState = (p, state) => host(p, { type: 'startState', state: { checking: false, version: 'synthetic', ...state } });
const observe = (p, state = {}) => host(p, { type: 'observationState', batch, error: null, findings: [], learningPath, ...state });
const requests = p => p.evaluate(() => window.sent);
const request = async (p, expected) => expect.poll(async () => containsRequest(await requests(p), expected)).toBe(true);
const draft = p => p.locator('.hps-input textarea');
const btn = (p, name) => p.getByRole('button', { name, exact: true });
const openObservation = async p => { await p.getByText('내 작업 돌아보기', { exact: true }).click(); };
async function test(id, title, fn, { surface = 'chat', profile = native, cfg = {}, expectedCrash = false } = {}) {
  if (process.env.HPS_TRIAL_UX_CASE && !id.includes(process.env.HPS_TRIAL_UX_CASE)) return;
  const p = await browser.newPage({ viewport: { width: 390, height: 900 } });
  p.setDefaultTimeout(4000);
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    window.sent = [];
    window.acquireVsCodeApi = () => ({ postMessage: m => { window.sent.push(m); /* controlled host: KNOW-R-020 send-time preparation succeeds */ if(m.type==='prepareAttachments')setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'attachmentsPrepared',requestId:m.requestId,failures:[]}}))); }, getState: () => undefined, setState: () => { throw Error('unexpected webview persistence'); } });
  });
  const row = { id, title, status: 'FAIL', scope: 'built React + controlled host messages', screenshots: [] };
  try {
    await p.goto(`${url}/?surface=${surface}`);
    await request(p, { type: surface === 'start' ? 'startReady' : 'ready' });
    if (surface === 'start') await startState(p, {});
    else await host(p, { type: 'config', config: config(profile, cfg) });
    await fn(p);
    if (!expectedCrash) assert.deepEqual(errors, []);
    // Check the final rendered state of every scenario, including pending,
    // error and conditional controls. This does not claim a screen-reader audit.
    for (const control of await p.locator('button, a[href], input, textarea, summary').all()) {
      if (!await control.isVisible()) continue;
      await expect(control).toHaveAccessibleName(/\S/);
      if (await control.isEnabled()) {
        expect(await control.evaluate(el => el.tabIndex)).toBeGreaterThanOrEqual(0);
        await control.focus();
        await expect(control).toBeFocused();
      }
    }
    assert.deepEqual(await p.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    row.status = 'PASS';
  } catch (e) { row.error = e.stack; }
  row.layout = await p.evaluate(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}))}));
  const shot = `${id}.png`;
  await p.screenshot({ path: path.join(out, shot), fullPage: true }).catch(() => {});
  row.screenshots.push(shot);
  row.requests = await requests(p).catch(() => []);
  row.pageErrors = errors;
  results.push(row);
  await fs.writeFile(path.join(out, `${id}.json`), JSON.stringify(row, null, 2));
  console.log(`${row.status} ${id} ${title}${row.error ? `: ${row.error.split('\n')[0]}` : ''}`);
  await p.close();
}

try {
  await test('TUX-SP-01', 'Code masking, whitespace disable, keyboard submission clears credential', async p => {
    await btn(p, '수업에 참여하기').click();
    const input = p.locator('#course-code'), submit = btn(p, '코드 확인하기');
    await expect(input).toHaveAttribute('type', 'password');
    await expect(submit).toBeDisabled(); await input.fill('   '); await expect(submit).toBeDisabled();
    await input.fill('synthetic-not-a-secret'); await input.press('Enter');
    await request(p, { type: 'connectCourse', token: 'synthetic-not-a-secret' });
    await expect(input).toHaveValue(''); await expect(input).toBeDisabled();
  }, { surface: 'start' });
  await test('TUX-SP-02', 'Connection pending prevents duplicate submit and announces progress', async p => {
    await btn(p, '수업에 참여하기').click();
    await p.locator('#course-code').fill('synthetic'); await btn(p, '코드 확인하기').dblclick();
    await expect(p.locator('.studio-connect')).toHaveAttribute('aria-busy', 'true');
    assert.equal(emitted(await requests(p), 'connectCourse').length, 1);
    await expect(btn(p, '코드 확인 중…')).toBeDisabled();
  }, { surface: 'start' });
  await test('TUX-SP-03', 'Start and continue route to coach; begin pending disables course actions', async p => {
    await startState(p, { profile: course }); await btn(p, '이어서 하기').press('Enter');
    await request(p, { type: 'beginCourse' });
    await expect(btn(p, '활동 여는 중…')).toBeDisabled(); await expect(btn(p, '다른 활동 선택')).toBeDisabled(); await expect(btn(p, '연결 해제')).toBeDisabled();
    await startState(p, { profile: course, started: true }); await btn(p, '코치와 계속 작업하기').click();
    assert.equal(emitted(await requests(p), 'beginCourse').length, 2);
  }, { surface: 'start' });
  await test('TUX-SP-04', 'Change course focuses code and back restores old course', async p => {
    await startState(p, { profile: course }); await btn(p, '다른 활동 선택').click(); await btn(p, '수업에 참여하기').click();
    await expect(p.locator('#course-code')).toBeFocused(); await p.locator('#course-code').fill('unsubmitted-synthetic');
    await btn(p, '기존 활동으로 돌아가기').click(); await expect(p.getByText(course.name, { exact: true })).toBeVisible();
    assert.equal(emitted(await requests(p), 'connectCourse').length, 0);
  }, { surface: 'start' });
  await test('TUX-SP-05', 'Invalid code and expired trial permit recovery without stale begin', async p => {
    await startState(p, { profile: course }); await btn(p, '다른 활동 선택').click(); await btn(p, '수업에 참여하기').click(); await p.locator('#course-code').fill('bad'); await btn(p, '코드 확인하기').click();
    await startState(p, { profile: course, error: '인증에 실패했습니다.' }); await expect(p.getByRole('alert')).toContainText('기존 활동 연결은 유지됩니다.');
    await btn(p, '기존 활동으로 돌아가기').click(); await expect(btn(p, '이어서 하기')).toBeEnabled();
    await startState(p, { error: '개인 체험 시간이 끝났습니다.' }); await expect(btn(p, '이어서 하기')).toHaveCount(0); await expect(p.locator('#course-code')).toBeEnabled();
    // REQ-L12 (13): after a trial expired the host names the pass entry while passes are sold. It is drawn, and
    // only the person opens it: the error itself sends no purchase request.
    const passes = { available: true, products: [{ id: 'pass-basic', label: '기본', recommended: true, amount: 55000, durationDays: 30, requestLimit: 350 }] };
    const before = emitted(await requests(p), 'purchaseOpen').length;
    await startState(p, { error: withTrialPassPointer(TRIAL_EXPIRED_FRIENDLY, true), purchase: passes });
    await expect(p.getByRole('alert')).toContainText('만든 파일과 대화는 그대로 있어요');
    await expect(p.getByRole('alert')).toContainText("'이용권으로 시작하기'");
    await expect(p.getByRole('alert')).not.toContainText('코드 발급 담당자');
    // The code form is still open from the retry above; going back to the start choices shows the named entry.
    await btn(p, '시작 방법 다시 선택').click();
    await expect(btn(p, '이용권으로 시작하기')).toBeVisible();
    await expect(p.getByRole('alert')).toContainText("'이용권으로 시작하기'");
    assert.equal(emitted(await requests(p), 'purchaseOpen').length, before, 'the trial ending never opens the purchase screen');
    // Without a catalogue the same ending names no entry that is not drawn.
    await startState(p, { error: withTrialPassPointer(TRIAL_EXPIRED_FRIENDLY, false) });
    await expect(p.getByRole('alert')).not.toContainText('이용권');
    await expect(btn(p, '이용권으로 시작하기')).toHaveCount(0);
  }, { surface: 'start' });
  await test('TUX-SP-06', 'Disconnect delegates host request and disconnected host state replaces course', async p => {
    await startState(p, { profile: course }); await btn(p, '연결 해제').click(); await request(p, { type: 'disconnectCourse' });
    await startState(p, {}); await expect(btn(p, 'AI 체험하기')).toBeVisible(); await expect(p.getByText(course.name, { exact: true })).toHaveCount(0);
  }, { surface: 'start' });
  for (const [id, label, type] of [['07', '파일', 'openStudioFiles'], ['08', '설정', 'openStudioSettings'], ['09', '작업 폴더 열기', 'openLocalFolder']]) {
    await test(`TUX-SP-${id}`, `${label}: keyboard action emits correct host request`, async p => { await btn(p, label).focus(); await expect(btn(p, label)).toBeFocused(); await btn(p, label).press('Enter'); await request(p, { type }); }, { surface: 'start' });
  }
  await test('TUX-SP-10', 'Disconnected coach has start-page CTA', async p => { await btn(p, '시작 화면 열기').click(); await request(p, { type: 'setToken' }); await expect(draft(p)).toHaveCount(0); }, { profile: null });
  // TUX-SP-13 — the trial allowance (CU-13): candidate card, passive header line, ended card. The
  // Service's `trial` block is the only source; a pass keeps passSummary (negative).
  const trialEnds = new Date(Date.now() + 50 * 60_000).toISOString();
  const trialSeat = (trial, extra = {}) => ({ ...course, kind: 'trial', trial, ...extra });
  const fresh = { state: 'active', ends_at: trialEnds, request_limit: 40, requests_used: 0 };
  const nearLimit = { ...fresh, requests_used: 37 };
  const exhausted = { ...fresh, state: 'exhausted', requests_used: 40 };
  const expiredTrial = { ...fresh, state: 'expired', ends_at: new Date(Date.now() - 60_000).toISOString(), requests_used: 12 };
  const courseRow = (p, dt) => p.locator('.studio-course dl > div').filter({ has: p.locator('dt', { hasText: new RegExp(`^${dt}$`) }) }).locator('dd');
  const taskWorkspace = { scope: 'synthetic-scope', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '합성 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
  const trialActivity = trial => ({ id: 'activity-trial', name: '합성 체험', kind: 'trial', workspace: '/synthetic/trial', verified: true, trial });
  await test('TUX-SP-13A', 'Fresh trial: candidate card states the allowance; connected card shows what is left', async p => {
    await startState(p, { profile: trialSeat(fresh), candidate: true });
    await expect(courseRow(p, '체험 한도')).toHaveText(/^AI 요청 40번 · (\d+월 \d+일 )?(오전|오후) \d+시( \d+분)?까지$/); // the date appears when the end is not today
    await expect(btn(p, '이 활동 시작하기')).toBeEnabled();
    await startState(p, { profile: trialSeat(fresh) });
    await expect(courseRow(p, '남은 체험')).toHaveText(/^AI 요청 40번 남음 · /);
    await btn(p, '이어서 하기').click(); await request(p, { type: 'beginCourse' });
    await expect(p.getByText('체험이 끝났습니다')).toHaveCount(0);
  }, { surface: 'start' });
  await test('TUX-SP-13B', 'Near-limit trial: passive remaining line in the chat header, no button', async p => {
    const line = p.locator('.hps-header .hps-trial-left');
    await expect(line).toHaveText(/^AI 요청 3번 남음 · /);
    await expect(line.locator('button, a')).toHaveCount(0);
    assert.equal(await line.evaluate(el => el.tagName), 'SPAN');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the line fits the 390px header');
    await p.screenshot({ path: path.join(out, 'TUX-SP-13B-personal-header.png') });
    // POLISH iter4 — at 390px the count is whole (never "AI 요청 3…"); only the end time gives way.
    const fit = () => line.evaluate(el => ({ text: el.innerText, clipped: el.scrollWidth > el.clientWidth + 1 }));
    assert.deepEqual(await fit(), { text: 'AI 요청 3번 남음', clipped: false }, 'the remaining count is whole at 390px');
    await p.setViewportSize({ width: 1280, height: 900 });
    assert.match((await fit()).text, /^AI 요청 3번 남음 · .+까지$/, 'positive control: a wide header shows the end time too');
    await p.setViewportSize({ width: 390, height: 900 });
    await host(p, { type: 'config', config: config(native, { taskWorkspace, activity: trialActivity(fresh) }) });
    await expect(line).toHaveText(/^AI 요청 40번 남음 · /);
    // The mission header (a trial without a personal workspace) carries the same line as its detail.
    await host(p, { type: 'config', config: config(native, { activity: trialActivity(nearLimit) }) });
    await expect(p.getByLabel('현재 활동')).toContainText('AI 요청 3번 남음');
    await expect(p.locator('.hps-trial-left')).toHaveCount(0);
    assert.equal(emitted(await requests(p), 'purchaseOpen').length, 0, 'the header never opens the purchase');
  }, { cfg: { taskWorkspace, activity: trialActivity(nearLimit) } });
  // US-05 (P0) — personal chat has no mission header (#1760), so the task heading row itself names the
  // current activity and its kind under the `현재 활동` label. The packaged-app acceptance
  // (native-unified-switch.spec.ts) reads the same label; it went missing from the real app.
  await test('US-05-PERSONAL', 'Personal chat header names the current activity and its kind', async p => {
    const heading = p.locator('.tw-heading');
    const now = heading.getByLabel('현재 활동');
    await expect(now).toHaveText('AI 체험 · 합성 체험');
    await expect(now.locator('button, a')).toHaveCount(0);
    // 390px with a trial line: the activity stays in the accessibility tree but gives its room to the
    // remaining count, which stays whole (the trial line already says "AI 요청 … 남음").
    const clipped = l => l.evaluate(el => el.scrollWidth > el.clientWidth + 1);
    const shown = l => l.evaluate(el => el.getBoundingClientRect().width > 1);
    assert.equal(await shown(now), false, 'a trial seat hides the activity line at 390px');
    assert.deepEqual(await heading.locator('.hps-trial-left').evaluate(el => ({ text: el.innerText, clipped: el.scrollWidth > el.clientWidth + 1 })), { text: 'AI 요청 3번 남음', clipped: false }, 'the remaining count is whole at 390px');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'fits 390px');
    await p.screenshot({ path: path.join(out, 'US-05-personal-390.png') });
    await p.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await now.evaluate(el => el.innerText), 'AI 체험 · 합성 체험', 'a wide header shows the name too');
    assert.equal(await clipped(now), false, 'the activity line is whole at 1280px');
    const tops = await Promise.all([heading.locator('h1'), now, heading.locator('.hps-trial-left')].map(async l => { const b = await l.boundingBox(); return Math.round(b.y + b.height / 2); }));
    assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, `one header row: ${tops}`);
    await p.screenshot({ path: path.join(out, 'US-05-personal-1280.png') });
    await p.setViewportSize({ width: 390, height: 900 });
    // A class seat in personal chat says 수업.
    await host(p, { type: 'config', config: config(native, { taskWorkspace, activity: { id: 'activity-class', name: '합성 수업', kind: 'classroom', workspace: '/synthetic/class', verified: true } }) });
    await expect(now).toHaveText('수업 · 합성 수업');
    // No trial line: at 390px the kind is on screen and whole; the name yields.
    assert.equal(await shown(now.locator('.hps-activity-kind')), true, 'the kind is visible at 390px');
    assert.equal(await clipped(now), false, 'the kind is not clipped at 390px');
    assert.equal(await shown(now.locator('.hps-activity-name')), false, 'the name yields at 390px');
    await p.screenshot({ path: path.join(out, 'US-05-class-390.png') });
    // A free seat says 무료 사용 and never a count (TUX-SP-13G).
    await host(p, { type: 'config', config: config(native, { taskWorkspace, activity: { ...trialActivity(nearLimit), free: true } }) });
    await expect(now).toHaveText('무료 사용 · 합성 체험');
    await expect(now).not.toContainText('번 남음');
    // Negative control: no activity, no label.
    await host(p, { type: 'config', config: config(native, { taskWorkspace }) });
    await expect(p.getByLabel('현재 활동')).toHaveCount(0);
  }, { cfg: { taskWorkspace, activity: trialActivity(nearLimit) } });
  await test('TUX-SP-13C', 'Exhausted trial: ended card instead of "이어서 하기"; pass only on press', async p => {
    await startState(p, { profile: trialSeat(exhausted) });
    await expect(p.locator('#connect-title')).toHaveText('체험이 끝났습니다');
    await expect(p.getByText('AI 요청을 모두 사용했습니다. 만든 파일은 작업 폴더에 그대로 있습니다.')).toBeVisible();
    await expect(courseRow(p, '체험')).toHaveText('AI 요청 40번 모두 사용');
    await expect(btn(p, '이어서 하기')).toHaveCount(0);
    await expect(p.locator('.studio-connect .studio-primary')).toHaveCount(0);
    await expect(btn(p, '이어서 하려면 이용권으로 시작하기')).toHaveCount(0);
    await startState(p, { profile: trialSeat(exhausted), purchase: { available: true } });
    assert.equal(emitted(await requests(p), 'purchaseOpen').length, 0, 'an ended trial never opens the purchase by itself');
    await btn(p, '이어서 하려면 이용권으로 시작하기').click(); await request(p, { type: 'purchaseOpen' });
    await startState(p, { profile: trialSeat(exhausted) });
    await btn(p, '지난 대화 보기').click(); await request(p, { type: 'beginCourse' });
    await expect(btn(p, '다른 활동 선택')).toBeVisible();
    await startState(p, { profile: trialSeat(exhausted), candidate: true });
    await expect(btn(p, '이 활동 시작하기')).toHaveCount(0); await expect(btn(p, '지난 대화 보기')).toHaveCount(0); await expect(btn(p, '선택 취소')).toBeEnabled();
  }, { surface: 'start' });
  await test('TUX-SP-13D', 'Expired trial: ended card, no "이어서 하기" and no stale begin', async p => {
    await startState(p, { profile: trialSeat(expiredTrial) });
    await expect(p.locator('#connect-title')).toHaveText('체험이 끝났습니다');
    await expect(p.getByText('체험 시간이 끝났습니다. 만든 파일은 작업 폴더에 그대로 있습니다.')).toBeVisible();
    await expect(courseRow(p, '체험')).toHaveText(/^(\d+월 \d+일 )?(오전|오후) \d+시( \d+분)?에 끝남$/);
    await expect(btn(p, '이어서 하기')).toHaveCount(0); await expect(btn(p, '지난 대화 보기')).toHaveCount(0);
    assert.equal(emitted(await requests(p), 'beginCourse').length, 0);
  }, { surface: 'start' });
  await test('TUX-SP-13N', 'Negative: a pass seat keeps passSummary and is never drawn as an ended trial', async p => {
    const pass = { request_limit: 200, requests_used: 20, expires_at: Date.now() + 20 * 86_400_000 };
    await startState(p, { profile: trialSeat(exhausted, { pass }) });
    await expect(courseRow(p, '남은 이용')).toHaveText(/^AI 요청 180번 남음 · \d+월 \d+일까지$/);
    await expect(btn(p, '이어서 하기')).toBeEnabled();
    await expect(p.getByText('체험이 끝났습니다')).toHaveCount(0);
    await expect(courseRow(p, '체험')).toHaveCount(0); await expect(courseRow(p, '남은 체험')).toHaveCount(0);
    // A classroom seat (no trial block) is unchanged too.
    await startState(p, { profile: course });
    await expect(btn(p, '이어서 하기')).toBeEnabled(); await expect(courseRow(p, '남은 체험')).toHaveCount(0);
  }, { surface: 'start' });
  await test('TUX-CHAT-01', 'All three real profile suggestions fill and focus draft without sending', async p => {
    for (const chip of native.ux.suggestions.initial) { const button = p.getByRole('button', { name: new RegExp(chip.text) }); await button.click(); await expect(draft(p)).toHaveValue(chip.text); await expect(draft(p)).toBeFocused(); }
    assert.equal(emitted(await requests(p), 'sendMessage').length, 0);
    const fixedName = p.locator('strong.hps-coach-name');
    await expect(fixedName).toHaveText('코치');
    await expect(fixedName).toHaveAttribute('title', '이 수업의 AI 이름: 코치');
    await expect(p.getByRole('button', { name: '코치 이름 바꾸기' })).toHaveCount(0);
  });
  await test('TUX-CHAT-02', 'Send rejects empty/space and sends trimmed text once', async p => {
    await expect(btn(p, '보내기')).toBeDisabled(); await draft(p).fill('  '); await expect(btn(p, '보내기')).toBeDisabled();
    await draft(p).fill('  실제 요청  '); await btn(p, '보내기').click(); await request(p, { type: 'sendMessage', text: '실제 요청' }); await expect(draft(p)).toHaveValue(''); await expect(btn(p, '보내기')).toBeDisabled();
  });
  await test('TUX-CHAT-03', 'Enter sends, Shift+Enter preserves newline, IME Enter does not send', async p => {
    await draft(p).fill('첫 줄'); await draft(p).press('Shift+Enter'); await draft(p).press('a'); await expect(draft(p)).toHaveValue('첫 줄\na');
    await draft(p).dispatchEvent('compositionstart'); await draft(p).press('Enter'); assert.equal(emitted(await requests(p), 'sendMessage').length, 0);
    await draft(p).dispatchEvent('compositionend'); await draft(p).press('Enter'); await request(p, { type: 'sendMessage', text: '첫 줄\na' });
  });
  await test('TUX-CHAT-04', 'Stop routes actual stream ID and preserves queued plus current draft', async p => {
    await host(p, { type: 'streamStart', streamId: 'synthetic-stream', messageId: 'a1' });
    await draft(p).fill('예약 문장'); await draft(p).press('Enter'); await draft(p).fill('추가 문장'); await btn(p, 'Stop').click();
    await request(p, { type: 'cancelStream', streamId: 'synthetic-stream' });
    await expect(draft(p)).toHaveValue(/예약 문장/); await expect(draft(p)).toHaveValue(/추가 문장/);
    await host(p, { type: 'streamStopped' }); await expect(btn(p, 'Stop')).toHaveCount(0); await expect(p.getByText('답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요.', { exact: false })).toBeVisible();
    assert.equal(emitted(await requests(p), 'sendMessage').length, 0);
  });
  await test('TUX-CHAT-05', 'Queue cancel restores draft; normal completion flushes exactly once', async p => {
    await host(p, { type: 'streamStart', streamId: 's1', messageId: 'a1' }); await draft(p).fill('보존할 예약'); await draft(p).press('Enter');
    await btn(p, '예약 취소').click(); await expect(draft(p)).toHaveValue('보존할 예약'); assert.equal(emitted(await requests(p), 'sendMessage').length, 0);
    await draft(p).press('Enter'); await host(p, { type: 'streamEnd' }); await request(p, { type: 'sendMessage', text: '보존할 예약' }); await host(p, { type: 'streamEnd' }); assert.equal(emitted(await requests(p), 'sendMessage').length, 1);
  });
  await test('TUX-CHAT-06', 'Host image attachment enables image-only send and removal disables it', async p => {
    const dataUrl = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 10; return c.toDataURL('image/png'); });
    await host(p, { type: 'attachImage', dataUrl }); await expect(btn(p, '이미지 제거')).toBeVisible(); await expect(btn(p, '보내기')).toBeEnabled();
    await btn(p, '이미지 제거').click(); await expect(btn(p, '보내기')).toBeDisabled();
    await host(p, { type: 'attachImage', dataUrl }); await expect(btn(p, '이미지 제거')).toBeVisible(); await btn(p, '보내기').click();
    await request(p, { type: 'sendMessage', text: '' }); assert.equal(emitted(await requests(p), 'sendMessage')[0].images.length, 1); await expect(btn(p, '이미지 제거')).toHaveCount(0);
  });
  for (const [id, label, type] of [['07', '활동 변경', 'setToken'], ['08', '대화 지우기', 'clearHistory'], ['09', '설정', 'openSettings']]) {
    await test(`TUX-CHAT-${id}`, `${label}: request delegates to host; Clear waits for host confirmation/result`, async p => {
      await host(p, { type: 'history', messages: history }); await btn(p, label).click(); await request(p, { type });
      if (type === 'clearHistory') { await expect(p.getByText(history[0].content, { exact: true })).toBeVisible(); await host(p, { type: 'history', messages: [] }); await expect(p.getByText(history[0].content, { exact: true })).toHaveCount(0); }
    });
  }
  await test('TUX-CHAT-10', 'Retry reuses preceding prompt and hides during streaming', async p => {
    assert.equal(native.ux.retry_button.enabled, true); await host(p, { type: 'history', messages: history }); await p.locator('.hps-msg-retry').click(); await request(p, { type: 'retryMessage', prompt: history[0].content });
    await host(p, { type: 'streamStart', streamId: 's1', messageId: 'a2' }); await expect(p.locator('.hps-msg-retry')).toHaveCount(0);
  });
  // REQ-STUDIO-CHAT-POLISH ① — personal chat: retry sits in the answer-actions row of the LATEST
  // coach answer only, and a free seat gets none (a retry is a new turn and spends a free turn).
  // Positive control: a personal non-free seat shows exactly one, under the last answer.
  // Negative controls: the free seat shows none; the old boxed control beside the label is gone.
  const twoAnswers = [...history, { id: 'u2', role: 'user', content: '제목을 더 크게 해 주세요.', createdAt: 3 }, { id: 'a2', role: 'assistant', content: '제목을 키웠어요.', createdAt: 4 }];
  await test('TUX-CHAT-10P', 'Personal chat: retry under the latest answer only, never on a free seat', async p => {
    assert.equal(native.ux.retry_button.enabled, true);
    await host(p, { type: 'history', messages: twoAnswers });
    const retry = p.locator('.hps-msg-retry');
    await expect(retry).toHaveCount(1);
    await expect(retry).toHaveAccessibleName('답변 다시 받기');
    await expect(retry).toHaveText('다시 받기');
    await expect(p.locator('.hps-msg-assistant').last().locator('.hps-answer-actions .hps-msg-retry')).toHaveCount(1);
    await expect(p.locator('.hps-msg-role .hps-msg-retry, .hps-msg-role .hps-msg-run')).toHaveCount(0);
    const [copyBox, retryBox] = [await p.locator('.hps-msg-assistant').last().locator('.hps-copy-answer').boundingBox(), await retry.boundingBox()];
    assert.equal(Math.round(copyBox.height), Math.round(retryBox.height), 'copy and retry are one size');
    assert.equal(await retry.evaluate(el => getComputedStyle(el).borderTopWidth), '0px', 'retry has no visible box');
    await retry.click(); await request(p, { type: 'retryMessage', prompt: '제목을 더 크게 해 주세요.' });
    // Free seat (studio-open-trial, `activity.free`): the same history offers no retry at all.
    await host(p, { type: 'config', config: config({ ...native, profile_id: 'studio-open-trial' }, { taskWorkspace, activity: { ...trialActivity(fresh), free: true } }) });
    await host(p, { type: 'history', messages: twoAnswers });
    await expect(p.locator('.hps-copy-answer')).toHaveCount(2);
    await expect(p.locator('.hps-msg-retry')).toHaveCount(0);
    await p.screenshot({ path: path.join(out, 'TUX-CHAT-10P-free-seat.png') });
  }, { cfg: { taskWorkspace, activity: trialActivity(fresh) } });
  // REQ-STUDIO-CHAT-POLISH ⑤⑥ (merged with #1763 REQ-STUDIO-CHAT-DETAIL) — one header row (task
  // title, remaining line, 자료, menu); model, 생각 깊이 and usage only in the 대화 설정 dialog; the
  // menu's 이용권 · 사용량 opens it on usage. Control: the classroom chat (no task workspace) keeps
  // its own header and its separate Effort/usage rows, and has no dialog.
  await test('TUX-CHAT-17', 'Personal chat: one header row, settings in the dialog, usage from the menu', async p => {
    await host(p, { type: 'history', messages: history });
    const heading = p.locator('.tw-heading');
    await expect(heading.locator('.hps-header .hps-trial-left')).toHaveText(/^AI 요청 40번 남음 · /);
    await expect(heading.getByRole('button', { name: '대화 메뉴' })).toBeVisible();
    await expect(p.locator('.hps-shell > .hps-header')).toHaveCount(0);
    const tops = await Promise.all([heading.locator('h1'), heading.locator('.hps-trial-left'), heading.getByRole('button', { name: '자료' }), heading.getByRole('button', { name: '대화 메뉴' })].map(async l => Math.round((await l.boundingBox()).y + (await l.boundingBox()).height / 2)));
    assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, `header controls share one row: ${tops}`);
    // Work surface: no model, effort or usage controls.
    await expect(p.getByRole('combobox', { name: '대화 모델' })).toHaveCount(0);
    await expect(p.getByRole('combobox', { name: '생각 깊이' })).toHaveCount(0);
    await expect(p.getByRole('combobox', { name: 'Effort', exact: true })).toHaveCount(0);
    await expect(p.locator('.hps-access')).toBeHidden();
    const dialog = p.getByRole('dialog', { name: '대화 설정', exact: true });
    // 설정 → the dialog, focus on its close button; model and 생각 깊이 under 응답 고급 설정.
    await p.getByRole('button', { name: '대화 메뉴' }).click();
    await p.getByRole('menuitem', { name: '설정', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(p.getByRole('button', { name: '대화 설정 닫기' })).toBeFocused();
    await dialog.getByText('응답 고급 설정', { exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: '대화 모델' })).toHaveCount(native.model_selection ? 1 : 0);
    await expect(dialog.getByRole('combobox', { name: '생각 깊이' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Effort', exact: true })).toHaveCount(0);
    await expect(dialog.locator('.hps-access')).not.toHaveAttribute('open', '');
    await p.keyboard.press('Escape'); await expect(dialog).toBeHidden();
    // 이용권 · 사용량 → the same dialog, usage open and focused.
    await p.getByRole('button', { name: '대화 메뉴' }).click();
    await p.getByRole('menuitem', { name: '이용권 · 사용량' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.hps-access')).toHaveAttribute('open', '');
    await expect(dialog.locator('.hps-access > summary')).toBeFocused();
    await expect(dialog.locator('.hps-access')).toContainText('수업·체험의 기본 이용 정책'); // code-issued seat: unchanged copy (control)
    await p.keyboard.press('Escape'); await expect(dialog).toBeHidden();
    // A free seat's usage panel never says 체험 (SPEC iteration 4 ground rule).
    await host(p, { type: 'config', config: config({ ...native, profile_id: 'studio-open-trial' }, { taskWorkspace, activity: { ...trialActivity(fresh), free: true }, access: { status: 'ready', view: { schema: 'hps-access-view/1', configured: false, required: false, as_of: new Date().toISOString(), choices: [] } } }) });
    await p.getByRole('button', { name: '대화 메뉴' }).click();
    await p.getByRole('menuitem', { name: '이용권 · 사용량' }).click();
    await expect(dialog.locator('.hps-access')).toContainText('무료 사용의 기본 이용 정책');
    await expect(dialog.locator('.hps-access')).not.toContainText('체험');
    await p.keyboard.press('Escape'); await expect(dialog).toBeHidden();
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'fits 390px');
    await p.screenshot({ path: path.join(out, 'TUX-CHAT-17-personal.png') });
    // Control: classroom chat keeps the in-shell header and the separate Effort control.
    await host(p, { type: 'config', config: config(native, { effort: { value: 'medium', allowed: ['low', 'medium'] }, access: { status: 'ready', view: { schema: 'hps-access-view/1', configured: false, required: false, as_of: new Date().toISOString(), choices: [] } } }) });
    await expect(p.locator('.hps-shell > .hps-header')).toHaveCount(1);
    await expect(p.getByRole('combobox', { name: 'Effort', exact: true })).toBeVisible();
    await expect(p.locator('.hps-access')).toHaveCount(1);
    await expect(p.locator('dialog.hps-preferences')).toHaveCount(0);
  }, { cfg: { taskWorkspace, activity: trialActivity(fresh), effort: { value: 'medium', allowed: ['low', 'medium'] }, access: { status: 'ready', view: { schema: 'hps-access-view/1', configured: false, required: false, as_of: new Date().toISOString(), choices: [] } } } });
  await test('TUX-CHAT-11', 'Run emits exact HTML; plain response has no Run', async p => {
    await host(p, { type: 'history', messages: [{ ...history[1], content: '텍스트만 있습니다.' }] }); await expect(p.locator('.hps-msg-run')).toHaveCount(0);
    await host(p, { type: 'history', messages: history }); await p.locator('.hps-msg-run').click(); await request(p, { type: 'runCode', html: '<!doctype html><html><body><h1>합성 초안</h1></body></html>' });
  });
  await test('TUX-CHAT-12', 'Code disclosure toggles without executing code', async p => {
    await host(p, { type: 'history', messages: history }); await expect(p.locator('.hps-codepill-body')).toHaveCount(0); await p.locator('.hps-codepill-toggle').press('Enter'); await expect(p.locator('.hps-codepill-body')).toContainText('합성 초안'); await p.locator('.hps-codepill-toggle').press('Enter'); await expect(p.locator('.hps-codepill-body')).toHaveCount(0); assert.equal(emitted(await requests(p), 'runCode').length, 0);
  });
  await test('TUX-CHAT-15', 'Markdown renders Korean emphasis, lists, tables and literal code', async p => {
    const show = content => host(p, { type: 'history', messages: [{ ...history[1], citations: [], content }] });
    await show('구체적인 일'); await expect(p.locator('.hps-prose strong')).toHaveCount(0);
    await show('지금 **구체적인 일**이 무엇인가요?\n\n## 맡길 범위\n\n- 목차 초안\n- *최종 판단*\n\n| AI | 나 |\n| --- | --- |\n| 초안 | 검토 |\n\n`**원문 유지**`\n\n```text\n**코드 원문**\n```');
    await expect(p.locator('.hps-prose strong')).toHaveText('구체적인 일');
    await expect(p.locator('.hps-prose h2')).toHaveText('맡길 범위');
    await expect(p.locator('.hps-prose li')).toHaveCount(2);
    await expect(p.locator('.hps-prose table')).toContainText('검토');
    await expect(p.locator('.hps-prose code')).toHaveText('**원문 유지**');
    await p.locator('.hps-codepill-toggle').click();
    await expect(p.locator('.hps-codepill-body')).toHaveText('**코드 원문**');
  });
  await test('TUX-CHAT-15B', 'Model HTML, image URLs and unsafe links never execute or fetch; safe links use the host', async p => {
    const outside = [];
    p.on('request', req => { if (!req.url().startsWith(url)) outside.push(req.url()); });
    await host(p, { type: 'history', messages: [{ ...history[1], citations: [], content: '<img src="https://example.invalid/raw" onerror="window.markdownExecuted=true">\n\n![합성 이미지](https://example.invalid/pixel)\n\n[위험 링크](javascript:alert%281%29)\n\n[허용 링크](https://example.org/markdown)' }] });
    await expect(p.locator('.hps-prose img, .hps-prose script')).toHaveCount(0);
    await expect(p.locator('.hps-prose a')).toHaveCount(1);
    await expect(p.getByText('위험 링크', { exact: true })).toBeVisible();
    assert.equal(await p.evaluate(() => window.markdownExecuted), undefined);
    assert.deepEqual(outside, []);
    await p.getByRole('link', { name: '허용 링크' }).click();
    await request(p, { type: 'openExternal', url: 'https://example.org/markdown' });
    assert.deepEqual(outside, []);
  });
  await test('TUX-CHAT-15C', 'A split streaming emphasis becomes bold only when complete', async p => {
    await host(p, { type: 'streamStart', streamId: 'md-stream', messageId: 'md-message' });
    await host(p, { type: 'streamChunk', streamId: 'md-stream', delta: '지금 **구체적인' });
    await expect(p.locator('.hps-prose strong')).toHaveCount(0);
    await host(p, { type: 'streamChunk', streamId: 'md-stream', delta: ' 일**을 골라주세요.' });
    await host(p, { type: 'streamEnd', streamId: 'md-stream' });
    await expect(p.locator('.hps-prose strong')).toHaveText('구체적인 일');
    await expect(p.locator('.hps-prose')).toHaveText('지금 구체적인 일을 골라주세요.');
  });
  await test('TUX-CHAT-16', 'Waiting completion is not a file-change claim; raw processing text is optional', async p => {
    const tool = (id, label, state = 'done', icon = '🔧') => ({ id, role: 'tool', content: '', createdAt: 1, tool: { label, state, icon } });
    await host(p, { type: 'history', messages: [tool('pending-synthetic', '고쳤어요'), tool('think-0', 'Synthetic processing detail in English', 'done', '💭'), tool('real-write', 'Write(index.html)'), tool('failed-write', 'Write(other.html) — 실패', 'error')] });
    await expect(p.getByText('고쳤어요', { exact: true })).toHaveCount(0);
    await expect(p.getByText('Synthetic processing detail in English', { exact: true })).not.toBeVisible();
    await expect(p.locator('.hps-tool-log-line').filter({ hasText: 'Write(index.html)' })).toBeVisible();
    await expect(p.locator('.hps-tool-error')).toContainText('실패');
    const details = p.getByLabel('AI 처리 내용 보기');
    await details.press('Enter'); await expect(p.getByText('Synthetic processing detail in English', { exact: true })).toBeVisible();
    await details.press('Enter'); await expect(p.getByText('Synthetic processing detail in English', { exact: true })).not.toBeVisible();
    await host(p, { type: 'history', messages: [tool('pending-synthetic', '다음 단계를 준비하는 중…', 'running', '…')] });
    await expect(p.locator('.hps-tool-running')).toBeVisible();
    await host(p, { type: 'history', messages: [tool('pending-synthetic', '대기 종료')] });
    await expect(p.locator('.hps-tool-log-line')).toHaveCount(0);
  });
  await test('TUX-CHAT-13', 'Citation emits exact external URL', async p => { await host(p, { type: 'history', messages: history }); await p.locator('.hps-cit-chip').click(); await request(p, { type: 'openExternal', url: 'https://example.org/source' }); });
  await test('TUX-CHAT-14', 'Error retry/report/close preserve draft and expose request/runbook', async p => {
    await host(p, { type: 'history', messages: history }); await draft(p).fill('작성 중인 문장');
    await host(p, { type: 'streamError', error: '연결이 끊겼습니다.', requestId: 'synthetic-request-id', runbookUrl: 'https://example.org/runbook' });
    await expect(p.getByRole('alert')).toContainText('synthetic-request-id'); await expect(p.getByRole('link', { name: /강사 안내/ })).toHaveAttribute('href', 'https://example.org/runbook');
    await btn(p, '다시 보내기').click(); await request(p, { type: 'retryMessage', prompt: history[0].content }); await btn(p, '신고하기').click(); await request(p, { type: 'openReportModal' }); await btn(p, '닫기').click(); await expect(p.getByRole('alert')).toHaveCount(0); await expect(draft(p)).toHaveValue('작성 중인 문장');
    await host(p, { type: 'history', messages: [] }); await host(p, { type: 'streamError', error: '인증에 실패했습니다.' }); await expect(btn(p, '다시 보내기')).toHaveCount(0);
  });
  await test('TUX-OBS-01', 'Observation disclosure and record refresh do not assess automatically', async p => { await openObservation(p); await btn(p, '이 작업의 기록 확인').click(); await request(p, { type: 'observationOpen' }); assert.equal(emitted(await requests(p), 'observationAssess').length, 0); await observe(p); await expect(p.getByText('3건 · 도움 사용 범위는 확인 전까지 미확인입니다.')).toBeVisible(); });
  await test('TUX-OBS-02', 'Artifact disclosure shows first/latest content and SHA without execution', async p => { await openObservation(p); await observe(p); await p.getByText('보존된 산출물 비교', { exact: true }).click(); await expect(p.locator('.hps-observation-compare section')).toHaveCount(2); await expect(p.locator('.hps-observation-compare')).toContainText('a'.repeat(64)); await expect(p.locator('.hps-observation-compare')).toContainText('최근 저장'); assert.equal(emitted(await requests(p), 'runCode').length, 0); });
  await test('TUX-OBS-03', 'Record disclosure shows exact source without allowing HTML execution', async p => { await openObservation(p); await observe(p); await p.getByText('평가에 보낼 기록 보기', { exact: true }).click(); await expect(p.locator('.hps-native-observation ol li')).toHaveCount(3); await expect(p.locator('.hps-native-observation ol')).toContainText('<h1>첫 저장</h1>'); await expect(p.locator('.hps-native-observation ol h1')).toHaveCount(0); });
  await test('TUX-OBS-04', 'Consent defaults off; empty events cannot be assessed even with consent', async p => { await openObservation(p); await observe(p); await expect(btn(p, '관찰 받기')).toBeDisabled(); await p.getByRole('checkbox').check(); await expect(btn(p, '관찰 받기')).toBeEnabled(); await observe(p, { batch: { ...batch, events: [] } }); await p.getByRole('checkbox').check(); await expect(btn(p, '관찰 받기')).toBeDisabled(); });
  await test('TUX-OBS-05', 'Assessment sends reviewed IDs once and locks while busy; new records reset consent', async p => { await openObservation(p); await observe(p); await p.getByRole('checkbox').check(); await btn(p, '관찰 받기').click(); await request(p, { type: 'observationAssess', scope: batch.scope, eventIds: batch.events.map(e => e.id) }); await expect(btn(p, '관찰 중…')).toBeDisabled(); await observe(p, { batch: { ...batch, events: [...batch.events, event('e4', 'user', '추가 기록')] } }); await expect(p.getByRole('checkbox')).not.toBeChecked(); await expect(btn(p, '관찰 받기')).toBeDisabled(); });
  await test('TUX-OBS-06', 'Cancel delegates and host cancellation unlocks with honest error', async p => { await openObservation(p); await observe(p); await p.getByRole('checkbox').check(); await btn(p, '관찰 받기').click(); await btn(p, '관찰 취소').click(); await request(p, { type: 'observationCancel' }); await observe(p, { error: '관찰을 취소했습니다.' }); await expect(p.getByRole('alert')).toHaveText('관찰을 취소했습니다.'); await expect(btn(p, '관찰 취소')).toHaveCount(0); await expect(p.getByRole('checkbox')).not.toBeChecked(); });
  await test('TUX-OBS-07', 'Seven controlled findings retain evidence IDs, unknown status and assessed count', async p => { await openObservation(p); await observe(p, { findings, assessedEventCount: 2 }); await expect(p.locator('.hps-native-observation article')).toHaveCount(7); await expect(p.locator('.hps-native-observation blockquote')).toContainText('e1'); await expect(p.getByText('이 관찰은 2개 기록 기준입니다.', { exact: false })).toBeVisible(); await expect(p.getByText('도움 사용 범위 미확인', { exact: true })).toHaveCount(7); });
  await test('TUX-OBS-08', 'Correction whitespace disabled, bounded and scoped; draft clears after send', async p => { await openObservation(p); await observe(p, { findings }); const input = p.getByLabel('내가 다르게 보는 점'); await expect(input).toHaveAttribute('maxLength', '2000'); await expect(btn(p, '정정 기록 남기기')).toBeDisabled(); await input.fill('  '); await expect(btn(p, '정정 기록 남기기')).toBeDisabled(); await input.fill('근거를 제가 직접 확인한 것은 아닙니다.'); await btn(p, '정정 기록 남기기').click(); await request(p, { type: 'observationCorrect', scope: batch.scope, text: '근거를 제가 직접 확인한 것은 아닙니다.' }); await expect(input).toHaveValue(''); });
  await test('TUX-OBS-09', 'Learning link available before assessment and emits exact approved URL', async p => { await openObservation(p); await observe(p); await btn(p, learningPath.title).click(); await request(p, { type: 'openExternal', url: learningPath.url }); assert.equal(emitted(await requests(p), 'observationAssess').length, 0); });
  await test('TUX-OBS-10', 'Config scope switch clears prior errors, learning link and unsubmitted correction', async p => {
    await openObservation(p); await observe(p, { findings, error: '이전 사용자 오류' }); await p.getByLabel('내가 다르게 보는 점').fill('이전 사용자 개인 정정');
    await host(p, { type: 'config', config: config({ ...native, observation: { format: 'hps-observation/1', scope: 'synthetic-scope-b', assess: true } }) });
    await expect(p.getByText('이전 사용자 오류', { exact: true })).toHaveCount(0); await expect(btn(p, learningPath.title)).toHaveCount(0);
    await observe(p, { batch: { ...batch, scope: 'synthetic-scope-b' }, findings, learningPath: null }); await expect(p.getByLabel('내가 다르게 보는 점')).toHaveValue('');
  });
  const update = { version: '9.9.9', notes: '합성 변경 내용', sizeBytes: 1048576, releaseUrl: 'https://example.org/synthetic-release' };
  await test('TUX-COND-01', 'Update notes disclosure preserves draft', async p => { await draft(p).fill('보존 문장'); await btn(p, '자세히 보기').click(); await expect(p.locator('.hps-update-banner-notes')).toHaveText(update.notes); await btn(p, '접기').click(); await expect(p.locator('.hps-update-banner-notes')).toHaveCount(0); await expect(draft(p)).toHaveValue('보존 문장'); }, { cfg: { update } });
  await test('TUX-COND-02', 'Update action delegates; browser never installs actual App', async p => { await btn(p, '업데이트').click(); await request(p, { type: 'installUpdate' }); }, { cfg: { update } });
  await test('TUX-COND-03', 'Postpone identifies offered version and host removes banner', async p => { await btn(p, '나중에').click(); await request(p, { type: 'dismissUpdate', version: update.version }); await host(p, { type: 'config', config: config() }); await expect(p.locator('.hps-update-banner')).toHaveCount(0); }, { cfg: { update } });
  await test('TUX-COND-04', 'Fatal boundary reports error and settings action; transient bad config recovers', async p => {
    await host(p, { type: 'config', config: config({ ...native, ux: { ...native.ux, suggestions: null } }) });
    await expect(btn(p, '다시 열기')).toBeVisible(); await request(p, { type: 'webviewError' }); await btn(p, '설정 열기').click(); await request(p, { type: 'openSettings' });
    await host(p, { type: 'config', config: config() }); await btn(p, '다시 열기').click(); await expect(draft(p)).toBeVisible(); await expect(btn(p, '다시 열기')).toHaveCount(0);
  }, { expectedCrash: true });
  await test('TUX-COND-04B', 'Crash injection resets and reloads saved host state without looping', async p => {
    await host(p, { type: 'webviewTestCrash' });
    await expect(btn(p, '다시 열기')).toBeVisible();
    await btn(p, '다시 열기').click();
    await expect(draft(p)).toBeVisible();
    await expect(btn(p, '다시 열기')).toHaveCount(0);
    await expect.poll(async()=>emitted(await requests(p),'ready').length).toBe(2);
  }, { expectedCrash: true });
  await test('TUX-COND-05', 'Native profile excludes unrelated naming/world/gallery/roll/lesson/followup surfaces', async p => {
    // `.hps-lesson` became `.hp-rail-lesson` in P0-C. If the name is not kept up with, this
    // assertion means **a class that no longer exists occurs 0 times** and passes quietly
    // while measuring nothing — worse than a red.
    for (const selector of ['.hps-naming', '.hps-world-strip', '.hps-gallery-btn', '.hps-btn-roll', '.hp-rail-lesson']) await expect(p.locator(selector)).toHaveCount(0);
    // Control: this profile has no lesson, so the mission header has to say "no lesson is
    // connected". That is the evidence the assertion above is actually counting something.
    await expect(p.locator('.hp-mission')).toHaveCount(1);
    await host(p, { type: 'history', messages: history }); await expect(p.locator('.hps-chips')).toHaveCount(0);
    await host(p, { type: 'config', config: config({ ...native, observation: undefined }) }); await expect(p.getByText('현재 연결은 작업 관찰을 지원하지 않습니다.', { exact: false })).toBeVisible(); await expect(p.locator('.hps-native-observation')).toHaveCount(0);
  });
  await test('TUX-COND-07', 'Trial limit ends in an inline card: facts, one Primary, an escape; nothing opens by itself', async p => {
    await draft(p).fill('마지막 요청');
    await draft(p).press('Enter');
    await request(p, { type: 'sendMessage' });
    await host(p, { type: 'streamStart', streamId: 'limit', messageId: 'a-limit' });
    await host(p, { type: 'streamError', streamId: 'limit', error: endCard.text, trialEndCard: endCard });
    const card = p.locator('.hps-trial-end-card');
    await expect(card).toHaveCount(1);
    // CONV-ENDCARD-R-002: the title and first line speak about continuing the work, before any pass fact.
    await expect(card.getByRole('heading')).toHaveText('만든 작업을 그대로 이어서 할 수 있어요');
    const facts = card.locator('.hps-trial-end-card-fact');
    await expect(facts).toHaveText([
      '만든 파일은 작업 폴더에, 대화는 이 채팅에 그대로 있어요. 이용권이 있으면 이 작업을 이어서 할 수 있어요.',
      // The Service's recommended pass by name, period and price, never a hardcoded price.
      passOfferLine(endCardPasses[0]),
      '한 번만 결제하고, 자동으로 다시 결제되지 않아요.',
      '무료로 쓸 수 있는 AI 요청은 모두 썼어요.',
    ]);
    assert.equal(passOfferLine(endCardPasses[0]), '라이트 이용권은 30일 동안 쓸 수 있고 30,000원이에요. AI 요청 200번이 들어 있어요.');
    // The checker reads what the browser drew: no count, no countdown, no pressure words.
    assert.deepEqual(endCardCopyProblems({ title: await card.getByRole('heading').innerText(), facts: await facts.allInnerTexts(), primary: await card.locator('.hps-trial-end-card-primary').innerText(), escape: await card.locator('.hps-trial-end-card-escape').innerText() }, endCardPasses[0]), []);
    // Exactly one Primary and one escape; the error banner (and its report button) is not drawn.
    await expect(card.getByRole('button')).toHaveCount(2);
    await expect(card.locator('.hps-trial-end-card-primary')).toHaveText('이용권 살펴보기');
    await expect(card.locator('.hps-trial-end-card-escape')).toHaveText('오늘은 여기까지');
    await expect(p.locator('.hps-error-banner')).toHaveCount(0);
    await expect(p.getByRole('dialog')).toHaveCount(0);
    await p.screenshot({ path: path.join(out, 'TUX-COND-07-card.png'), fullPage: true });
    // Dark theme at the two widths the conversion register asks for (1420px, 800px).
    await p.addStyleTag({ content: endCardDarkTheme });
    await p.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.dataset.vscodeThemeKind = 'vscode-dark'; });
    for (const width of [1420, 800]) {
      await p.setViewportSize({ width, height: 900 });
      await expect(card).toBeVisible();
      await p.screenshot({ path: path.join(out, `TUX-COND-07-card-dark-${width}.png`) });
    }
    await p.setViewportSize({ width: 390, height: 900 });
    // No countdown or pressure copy.
    assert.doesNotMatch(await card.innerText(), /남았|남음|남은|곧|마감|지금 바로|놓치|할인|한정|\d+\s*(초|분)\b/);
    // Never opens by itself: no purchase request before the person presses the Primary.
    assert.equal(emitted(await requests(p), 'trialEndCardPasses').length, 0);
    await btn(p, '이용권 살펴보기').click();
    await expect.poll(async () => emitted(await requests(p), 'trialEndCardPasses').length).toBe(1);
    // The escape closes the card and asks for nothing: its only message is the funnel count
    // (CONV-FUNNEL-R-003, offer_dismissed end_card), which opens nothing on the host.
    const before = (await requests(p)).length;
    await btn(p, '오늘은 여기까지').click();
    await expect(card).toHaveCount(0);
    const after = (await requests(p)).slice(before);
    assert.deepEqual(after.map((m) => m.type), ['trialEndCardDismiss'], 'the escape sends only trialEndCardDismiss');
    await expect(draft(p)).toBeVisible();
  }, { cfg: endCardTrialSeat });
  await test('TUX-COND-07N', 'Card absent mid-work and for ordinary errors (negative control)', async p => {
    await host(p, { type: 'streamStart', streamId: 'work', messageId: 'a-work' });
    await host(p, { type: 'streamChunk', streamId: 'work', delta: '페이지를 만들고 있어요' });
    await expect(p.getByText('페이지를 만들고 있어요')).toBeVisible();
    await expect(p.locator('.hps-trial-end-card')).toHaveCount(0);
    await host(p, { type: 'streamEnd', streamId: 'work' });
    await expect(p.locator('.hps-trial-end-card')).toHaveCount(0);
    // An ordinary failure keeps today's banner and never draws the card.
    await host(p, { type: 'streamStart', streamId: 'fail', messageId: 'a-fail' });
    await host(p, { type: 'streamError', streamId: 'fail', error: '연결이 끊겼습니다. 다시 보내 주세요.' });
    await expect(p.locator('.hps-error-banner')).toHaveCount(1);
    await expect(p.locator('.hps-trial-end-card')).toHaveCount(0);
    await expect(btn(p, '이용권 살펴보기')).toHaveCount(0);
    // A card from an earlier ending does not survive into a later ordinary error.
    await host(p, { type: 'streamStart', streamId: 'limit', messageId: 'a-limit' });
    await host(p, { type: 'streamError', streamId: 'limit', error: endCard.text, trialEndCard: endCard });
    await expect(p.locator('.hps-trial-end-card')).toHaveCount(1);
    await host(p, { type: 'streamStart', streamId: 'fail2', messageId: 'a-fail2' });
    await expect(p.locator('.hps-trial-end-card')).toHaveCount(0);
    await host(p, { type: 'streamError', streamId: 'fail2', error: '연결이 끊겼습니다. 다시 보내 주세요.' });
    await expect(p.locator('.hps-trial-end-card')).toHaveCount(0);
    assert.equal(emitted(await requests(p), 'trialEndCardPasses').length, 0);
  }, { cfg: endCardTrialSeat });
  // TUX-COND-08 — optional "이메일로 소식 받기" below the pass offer (Jay 2026-10-19). The webview's
  // setState throws in this harness, so a persisted address would fail the case; localStorage is
  // checked empty after every case too.
  const SYNTHETIC_EMAIL = 'learner.synthetic@example.com';
  await test('TUX-COND-08', 'Free end card: optional email section, explicit opt-in, address only to the host, withdraw', async p => {
    await host(p, { type: 'streamStart', streamId: 'limit', messageId: 'a-limit' });
    await host(p, { type: 'streamError', streamId: 'limit', error: notifyCard.text, trialEndCard: notifyCard });
    const card = p.locator('.hps-trial-end-card');
    const section = card.getByTestId('notify-optin');
    await expect(section).toHaveCount(1);
    await expect(section).toContainText('새 기능과 할인 소식을 이메일로 받아 볼래요? (선택)');
    await expect(section).toContainText('[수집 항목: 이메일 · 목적: 서비스·할인 소식 안내 · 보관: 수신 거부 또는 1년 뒤 삭제]');
    // The pass offer stays the one Primary, first in the card; the section comes after it.
    await expect(card.locator('.hps-trial-end-card-primary')).toHaveCount(1);
    assert.equal(await card.evaluate(el => {
      const primary = el.querySelector('.hps-trial-end-card-primary'), s = el.querySelector('[data-testid="notify-optin"]');
      return !!(primary.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true, 'the section is below the pass offer');
    // Explicit opt-in (정보통신망법 §50): no checkbox, nothing pre-checked or pre-filled; 받기 needs an address.
    await expect(card.locator('input[type="checkbox"], input[type="radio"]')).toHaveCount(0);
    const input = section.getByRole('textbox', { name: '이메일' });
    await expect(input).toHaveValue('');
    await expect(btn(p, '받기')).toBeDisabled();
    // Nothing is sent by drawing the card.
    assert.equal(emitted(await requests(p), 'notifyOptinSubmit').length, 0);
    await p.screenshot({ path: path.join(out, 'TUX-COND-08-form.png'), fullPage: true });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no overflow at 390px');
    await input.fill(SYNTHETIC_EMAIL);
    await btn(p, '받기').click();
    await request(p, { type: 'notifyOptinSubmit', email: SYNTHETIC_EMAIL });
    assert.equal(emitted(await requests(p), 'notifyOptinSubmit').length, 1);
    await expect(btn(p, '받기')).toBeDisabled();
    // A Service refusal shows its sentence and keeps the form.
    await host(p, { type: 'notifyOptinResult', state: 'error', message: '이메일 주소를 다시 확인해 주세요.' });
    await expect(section.getByRole('alert')).toHaveText('이메일 주소를 다시 확인해 주세요.');
    await btn(p, '받기').click();
    await host(p, { type: 'notifyOptinResult', state: 'subscribed' });
    await expect(section).toContainText('소식을 보내 드릴게요.');
    await expect(section.getByRole('textbox')).toHaveCount(0);
    assert.ok(!(await p.content()).includes(SYNTHETIC_EMAIL), 'the address is gone from the page after success');
    await p.screenshot({ path: path.join(out, 'TUX-COND-08-done.png'), fullPage: true });
    // Withdraw is a small link-style button; it asks the host, which calls the delete route.
    await btn(p, '그만 받기').click();
    await request(p, { type: 'notifyOptinWithdraw' });
    await host(p, { type: 'notifyOptinResult', state: 'withdrawn' });
    await expect(section).toContainText('이제 소식을 보내지 않을게요.');
    // The pass Primary still works and the section never opened the purchase view by itself.
    assert.equal(emitted(await requests(p), 'trialEndCardPasses').length, 0);
    await btn(p, '이용권 살펴보기').click();
    await expect.poll(async () => emitted(await requests(p), 'trialEndCardPasses').length).toBe(1);
  }, { cfg: endCardTrialSeat });
  await test('TUX-COND-08N', 'Email section absent when not advertised; an earlier submission shows the done line (controls)', async p => {
    await host(p, { type: 'streamStart', streamId: 'limit', messageId: 'a-limit' });
    await host(p, { type: 'streamError', streamId: 'limit', error: endCard.text, trialEndCard: endCard });
    await expect(p.locator('.hps-trial-end-card')).toHaveCount(1);
    await expect(p.getByTestId('notify-optin')).toHaveCount(0);
    await expect(p.getByText('이메일로 받아 볼래요', { exact: false })).toHaveCount(0);
    // Mid-work: no card, no section.
    await host(p, { type: 'streamStart', streamId: 'work', messageId: 'a-work' });
    await expect(p.getByTestId('notify-optin')).toHaveCount(0);
    await host(p, { type: 'streamEnd', streamId: 'work' });
    // A seat that already submitted: done line and withdraw, no empty form.
    await host(p, { type: 'streamStart', streamId: 'limit2', messageId: 'a-limit2' });
    await host(p, { type: 'streamError', streamId: 'limit2', error: notifySubmittedCard.text, trialEndCard: notifySubmittedCard });
    await expect(p.getByTestId('notify-optin')).toContainText('소식을 보내 드릴게요.');
    await expect(p.getByTestId('notify-optin').getByRole('textbox')).toHaveCount(0);
    await expect(btn(p, '그만 받기')).toBeVisible();
    assert.equal(emitted(await requests(p), 'notifyOptinSubmit').length + emitted(await requests(p), 'notifyOptinWithdraw').length, 0);
  }, { cfg: endCardTrialSeat });
  // ── Free start (SPEC iteration 4 §2.3/§2.4; TUX-SP-14/15/16) ─────────────────────────────
  // Selectors follow StartPage.tsx's FreeStartCard branch. Control for the 체험 checker: today's
  // start page (free start not advertised) does contain 체험, so the checker can fail.
  const FREE_OFFER = { entry: 'open', durationHours: 24, requestLimit: 10, unit: 'turn', claim: '/v1/free/claim', available: true };
  // Jay 2026-10-19: the host sends no allowance line for a free start; the end card speaks at the end.
  const freeStart = (extra = {}) => ({ trialOffer: FREE_OFFER, freeStart: { ...extra } });
  const cardText = p => p.locator('.studio-connect').innerText();
  await test('TUX-SP-14A', 'Free start: one age question, no 체험/수업 choice, code is a small link', async p => {
    await startState(p, {});
    assert.match(await cardText(p), /체험/, 'control: today\'s start page says 체험, so the checker below can fail');
    await expect(p.locator('.studio-free-allowance')).toHaveCount(0); // negative control: no free offer line without the advertisement
    await startState(p, freeStart());
    // POLISH iter4 — the card leads with what the person can do (start now, no login); the age check follows.
    await expect(p.locator('#connect-title')).toHaveText('바로 시작할 수 있습니다');
    await expect(p.locator('.studio-card-description')).toHaveText('로그인 없이 바로 시작합니다.');
    await expect(p.getByText('만 14세 이상인가요?', { exact: true })).toBeVisible();
    await expect(btn(p, 'AI 체험하기')).toHaveCount(0);
    await expect(btn(p, '수업에 참여하기')).toHaveCount(0);
    await expect(p.locator('.studio-connect .studio-primary')).toHaveCount(1);
    await expect(p.locator('.studio-connect .studio-primary')).toHaveText(/^네, 만 14세 이상입니다/);
    await expect(p.locator('.studio-free-allowance')).toHaveCount(0);
    assert.doesNotMatch(await cardText(p), /AI 요청 \d+번/, 'no allowance count before use (Jay 2026-10-19)');
    assert.doesNotMatch(await cardText(p), /체험/, 'no 체험 on the free card');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await p.screenshot({ path: path.join(out, 'TUX-SP-14A-age-390.png'), fullPage: true });
    await btn(p, '네, 만 14세 이상입니다').click();
    await request(p, { type: 'freeStartAge', answer: '14+' });
    // Claiming: the free card stays; the candidate preview never shows, even when the host already has one.
    await startState(p, { ...freeStart({ age: '14+', claiming: true }), checking: true, candidate: true, profile: { ...course, id: 'studio-open-trial', kind: 'trial', free: true } });
    await expect(p.getByText('작업 공간을 준비하고 있습니다.', { exact: true })).toBeVisible();
    await expect(p.getByText('이 활동으로 시작할까요?')).toHaveCount(0);
    await expect(btn(p, '이 활동 시작하기')).toHaveCount(0);
    await expect(btn(p, '다른 작업 폴더 선택')).toHaveCount(0);
    // Saved age: a single Primary, no question again.
    await startState(p, freeStart({ age: '14+' }));
    await expect(p.getByText('만 14세 이상인가요?')).toHaveCount(0);
    await btn(p, '바로 시작하기').click();
    await request(p, { type: 'freeStartClaim' });
    // The code path: one label, no trial/class split.
    await btn(p, '참여 코드가 있어요').click();
    await expect(p.locator('label[for="course-code"]')).toHaveText('참여 코드');
    await expect(p.getByText('강사나 운영자에게 받은 코드를 붙여 넣으세요.', { exact: true })).toBeVisible();
    assert.doesNotMatch(await cardText(p), /체험/);
    await btn(p, '돌아가기').click();
    await expect(btn(p, '바로 시작하기')).toBeVisible();
    // The secondary links sit on the card's left axis with everything else (not centred under the Primary).
    const [linkX, primaryX] = await Promise.all([btn(p, '참여 코드가 있어요'), p.locator('.studio-connect .studio-primary')].map(async l => Math.round((await l.boundingBox()).x)));
    assert.ok(Math.abs(linkX + 4 - primaryX) <= 2, `secondary links align left with the Primary: ${linkX} vs ${primaryX}`);
    assert.equal(emitted(await requests(p), 'purchaseOpen').length, 0, 'nothing opens the purchase for the person');
  }, { surface: 'start' });
  await test('TUX-SP-14B', 'Free start refusals: Service sentence shown as given; app too old offers the update', async p => {
    const limit = '이 네트워크에서 오늘 시작할 수 있는 횟수를 모두 사용했습니다. 내일 다시 시도하거나, 참여 코드나 이용권으로 시작해 주세요.';
    await startState(p, freeStart({ age: '14+', refusal: { code: 'network_limit', message: limit } }));
    await expect(p.getByRole('alert')).toHaveText(limit);
    await expect(btn(p, '바로 시작하기')).toBeEnabled();
    await startState(p, freeStart({ age: '14+', refusal: { code: 'network', message: '연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.' } }));
    await expect(btn(p, '바로 시작하기')).toBeEnabled();
    await startState(p, freeStart({ age: '14+', tooOld: true, refusal: { code: 'app_too_old', message: '이 Studio는 바로 시작하기를 지원하지 않는 버전입니다. 최신 Studio로 업데이트한 뒤 다시 열어 주세요.' } }));
    await expect(btn(p, '바로 시작하기')).toHaveCount(0);
    await btn(p, '업데이트 확인').click();
    await request(p, { type: 'freeStartUpdate' });
  }, { surface: 'start' });
  await test('TUX-SP-15', 'Under 14: guardian block, no claim button, the code link stays', async p => {
    await startState(p, { ...freeStart({ age: 'under14' }), purchase: { available: true } });
    await expect(p.locator('#connect-title')).toHaveText('보호자와 함께 시작해 주세요');
    await expect(p.getByText('만 14세 미만은 보호자의 동의가 있어야 사용할 수 있습니다. 지금은 앱에서 보호자 동의를 받을 수 없어 여기서 시작할 수 없습니다.', { exact: true })).toBeVisible();
    await expect(p.locator('.studio-connect .studio-primary')).toHaveCount(0);
    await expect(btn(p, '이용권으로 시작하기')).toHaveCount(0);
    await expect(btn(p, '참여 코드가 있어요')).toBeVisible();
    await btn(p, '보호자 안내 보기').click();
    await request(p, { type: 'freeStartGuardian' });
    assert.equal(emitted(await requests(p), 'freeStartClaim').length, 0);
    await p.screenshot({ path: path.join(out, 'TUX-SP-15-under14-390.png'), fullPage: true });
  }, { surface: 'start' });
  await test('TUX-SP-16', 'Daily cap drained: calm notice with 00:00 KST, no Primary, no purchase opened', async p => {
    await startState(p, { ...freeStart({ age: '14+' }), trialOffer: { ...FREE_OFFER, available: false, reason: 'daily_cap' }, freeStart: { age: '14+', unavailable: 'daily_cap' }, purchase: { available: true } });
    await expect(p.locator('#connect-title')).toHaveText('밤 12시 이후에 시작할 수 있습니다');
    const notice = p.locator('.studio-notice');
    await expect(notice).toHaveText('오늘 준비한 무료 사용량이 모두 소진되었습니다. 밤 12시(한국 시간) 이후에 다시 시작할 수 있습니다.');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(p.getByRole('alert')).toHaveCount(0);
    await expect(p.locator('.studio-connect .studio-primary')).toHaveCount(0);
    await expect(btn(p, '참여 코드가 있어요')).toBeVisible();
    await expect(btn(p, '이용권으로 시작하기')).toBeVisible();
    assert.equal(emitted(await requests(p), 'purchaseOpen').length, 0);
    await p.screenshot({ path: path.join(out, 'TUX-SP-16-drained-390.png'), fullPage: true });
    // A newcomer who has not answered the age question sees the same calm state, not the question.
    await startState(p, { trialOffer: { ...FREE_OFFER, available: false, reason: 'daily_cap' }, freeStart: { unavailable: 'daily_cap' } });
    await expect(p.getByText('만 14세 이상인가요?')).toHaveCount(0);
    await expect(p.locator('.studio-notice')).toBeVisible();
  }, { surface: 'start' });
  await test('TUX-SP-16P', 'Operator pause: calm card says the install stays and to come back later; no Primary, no error (800/1420 dark)', async p => {
    const paused = '지금은 무료 사용을 잠시 멈췄습니다. Studio는 그대로 두고, 나중에 다시 열면 바로 시작할 수 있습니다.';
    const calmCard = async () => {
      await expect(p.locator('#connect-title')).toHaveText('나중에 시작할 수 있습니다');
      const notice = p.locator('.studio-notice');
      await expect(notice).toHaveText(paused);
      await expect(notice).toHaveAttribute('role', 'status');
      await expect(p.getByRole('alert')).toHaveCount(0);
      await expect(p.locator('.studio-error')).toHaveCount(0);
      await expect(p.locator('.studio-connect .studio-primary')).toHaveCount(0);
      await expect(p.getByText('만 14세 이상인가요?')).toHaveCount(0);
      await expect(btn(p, '참여 코드가 있어요')).toBeVisible();
      await expect(btn(p, '이용권으로 시작하기')).toBeVisible();
      assert.doesNotMatch(await cardText(p), /\d+\s*(번|회|초|분|시간)|오류|실패|다시 시도|체험|수업/);
    };
    // The Service advertises the pause (offer path)...
    await startState(p, { trialOffer: { ...FREE_OFFER, available: false, reason: 'paused' }, freeStart: { age: '14+', unavailable: 'paused' }, purchase: { available: true } });
    await calmCard();
    // ...or refuses the claim with `paused`: the same card, never the Service's retry sentence.
    await startState(p, { trialOffer: FREE_OFFER, freeStart: { age: '14+', refusal: { code: 'paused', message: '지금은 무료 사용을 잠시 멈췄습니다. 잠시 뒤 다시 시도해 주세요.' } }, purchase: { available: true } });
    await calmCard();
    assert.equal(emitted(await requests(p), 'purchaseOpen').length, 0);
    assert.equal(emitted(await requests(p), 'freeStartClaim').length, 0);
    // Dark theme at the two widths the conversion register asks for: the card fits and nothing spills.
    await p.addStyleTag({ content: endCardDarkTheme });
    await p.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.dataset.vscodeThemeKind = 'vscode-dark'; });
    for (const width of [800, 1420]) {
      await p.setViewportSize({ width, height: 900 });
      await expect(p.locator('.studio-notice')).toBeVisible();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no horizontal scroll at ${width}px`);
      const box = await p.locator('.studio-notice').boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, `notice inside the viewport at ${width}px`);
      await p.screenshot({ path: path.join(out, `TUX-SP-16P-paused-dark-${width}.png`) });
    }
    await p.setViewportSize({ width: 390, height: 900 });
  }, { surface: 'start' });
  await test('TUX-SP-13F', 'Free seat labels: 무료 사용 on the start card and in the chat header, never 체험', async p => {
    await startState(p, { profile: trialSeat(nearLimit, { id: 'studio-open-trial', free: true }) });
    await expect(p.locator('.studio-verified')).toHaveText('무료 사용');
    // POLISH iter4 — a free seat has no code, so its footer never speaks of one.
    await expect(p.locator('.studio-card-footer')).toHaveText('만든 파일과 대화는 이 컴퓨터에 남습니다. 로그인은 이용권을 결제할 때만 합니다.');
    await expect(p.locator('.studio-course dt', { hasText: '남은 무료 사용' })).toHaveCount(0); // no count while in use (Jay 2026-10-19)
    assert.doesNotMatch(await cardText(p), /번 남음/);
    assert.doesNotMatch(await cardText(p), /체험/);
    await startState(p, { profile: trialSeat(exhausted, { id: 'studio-open-trial', free: true }) });
    await expect(p.locator('#connect-title')).toHaveText('무료 사용이 끝났습니다');
    await expect(courseRow(p, '무료 사용')).toHaveText('무료 AI 요청 40번 모두 사용');
    assert.doesNotMatch(await cardText(p), /체험/);
    // Negative control: the same seat without the free mark keeps today's wording.
    await startState(p, { profile: trialSeat(exhausted) });
    await expect(p.locator('#connect-title')).toHaveText('체험이 끝났습니다');
    await expect(p.locator('.studio-card-footer')).toHaveText('참여 코드에 연결된 활동과 이용 조건이 적용됩니다.');
  }, { surface: 'start' });
  await test('TUX-SP-13G', 'Free seat chat header: 무료 사용 label, no remaining count while in use', async p => {
    await expect(p.getByLabel('현재 활동')).toContainText('무료 사용 · 합성 체험');
    await expect(p.getByLabel('현재 활동')).not.toContainText('번 남음'); // Jay 2026-10-19
  }, { cfg: { activity: { ...trialActivity(nearLimit), free: true } } });
  await test('TUX-SP-13H', 'Control: a code-issued trial still shows its remaining count in the header', async p => {
    await expect(p.getByLabel('현재 활동')).toContainText('AI 요청 3번 남음');
  }, { cfg: { activity: trialActivity(nearLimit) } });
  await test('REQ-L12-14', 'Free seat purchase: payer question, then the guardian checkout as link and QR', async p => {
    const passes = [{ id: 'pass-lite', label: '라이트', amount: 30000, durationDays: 30, requestLimit: 200, recommended: true }];
    await startState(p, { purchase: { available: true, products: passes, stage: 'choosing', freeSeat: true }, ...freeStart({ age: '14+' }) });
    await btn(p, '이용권으로 시작하기').click();
    await request(p, { type: 'purchaseOpen' });
    await expect(p.getByText('결제하는 분이 만 19세 이상인가요?', { exact: true })).toBeVisible();
    await expect(btn(p, '30,000원 결제하러 가기')).toHaveCount(0);
    // POLISH iter4 — leaving the pass list goes back; it is not a "start over" (Jay: 다시 시작 안 어울림).
    await expect(btn(p, '돌아가기')).toBeVisible();
    await expect(btn(p, '시작 방법 다시 선택')).toHaveCount(0);
    await btn(p, '아니요').click();
    await request(p, { type: 'purchasePayer', adult: false });
    await startState(p, { purchase: { available: true, products: passes, stage: 'choosing', freeSeat: true, payerAdult: false }, ...freeStart({ age: '14+' }) });
    await btn(p, '보호자에게 결제 요청하기').click();
    await request(p, { type: 'purchaseStart', productId: 'pass-lite', guardian: true });
    await startState(p, { purchase: { available: true, stage: 'waiting', order: { label: '라이트', amount: 30000 }, message: '브라우저에서 결제를 마치면 자동으로 이어져요.', freeSeat: true, payerAdult: false, guardian: { url: 'https://site.test/studio/checkout?order=x', qr: 'data:image/svg+xml;base64,PHN2Zy8+' } }, ...freeStart({ age: '14+' }) });
    await expect(p.getByRole('img', { name: '보호자 결제 페이지 QR 코드' })).toBeVisible();
    await expect(p.getByText('결제는 보호자가 해 주세요. 보호자 휴대폰으로 이 QR을 열면 결제 페이지가 열립니다.', { exact: true })).toBeVisible();
    // Negative control: an adult payer on the same seat goes to today's checkout button.
    await startState(p, { purchase: { available: true, products: passes, stage: 'choosing', freeSeat: true, payerAdult: true }, ...freeStart({ age: '14+' }) });
    await expect(btn(p, '30,000원 결제하러 가기')).toBeVisible();
  }, { surface: 'start' });
  await test('TUX-SP-17', 'Login at purchase: Google sign-in is the Primary before checkout; never on the first screen; no anonymous fallback', async p => {
    // Selectors follow StartPage.tsx: AccountEntry's signed-out button is `.studio-google` (studio-primary).
    const passes = [{ id: 'pass-lite', label: '라이트', amount: 30000, durationDays: 30, requestLimit: 200, recommended: true }];
    const signedOut = { status: 'signedOut' };
    const signedIn = { status: 'signedIn', account: { id: 'acc_1', email: 'learner@example.test', display_name: '학습자' }, passes: [] };
    const google = p.locator('.studio-google');
    // Control: today's choice list (no free start) draws the account entry, so the checker below can fail.
    await startState(p, { account: signedOut, purchase: { available: true } });
    await expect(google).toHaveCount(1);
    // The first screen of free start has no login, even with the account runtime present.
    await startState(p, { account: signedOut, purchase: { available: true, login: 'signIn' }, ...freeStart({ age: '14+' }) });
    await expect(p.locator('#connect-title')).toHaveText('바로 시작할 수 있습니다');
    await expect(google).toHaveCount(0);
    // The pass list on a free seat while signed out: the Google button is the one Primary, no pay button, no payer question.
    await btn(p, '이용권으로 시작하기').click();
    await request(p, { type: 'purchaseOpen' });
    await startState(p, { account: signedOut, purchase: { available: true, products: passes, stage: 'choosing', freeSeat: true, login: 'signIn' }, ...freeStart({ age: '14+' }) });
    await expect(p.getByText('이용권을 사려면 Google로 로그인해 주세요.', { exact: true })).toBeVisible();
    await expect(p.locator('.studio-connect .studio-primary')).toHaveCount(1);
    await expect(google).toHaveCount(1);
    await expect(btn(p, '30,000원 결제하러 가기')).toHaveCount(0);
    await expect(btn(p, '보호자에게 결제 요청하기')).toHaveCount(0);
    await expect(p.getByText('결제하는 분이 만 19세 이상인가요?')).toHaveCount(0);
    await expect(p.getByRole('radiogroup', { name: '이용권 고르기' })).toBeVisible(); // the passes stay visible to choose from
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await p.screenshot({ path: path.join(out, 'TUX-SP-17-sign-in-390.png'), fullPage: true });
    await btn(p, 'Google로 시작하기').click();
    await request(p, { type: 'accountSignIn' });
    assert.equal(emitted(await requests(p), 'purchaseStart').length, 0, 'no checkout before sign-in');
    // Signed in: the gate is gone and checkout follows (payer question first on a free seat).
    await startState(p, { account: signedIn, purchase: { available: true, products: passes, stage: 'choosing', freeSeat: true, payerAdult: true }, ...freeStart({ age: '14+' }) });
    await expect(google).toHaveCount(0);
    await expect(p.getByText('이용권을 사려면 Google로 로그인해 주세요.')).toHaveCount(0);
    await expect(btn(p, '30,000원 결제하러 가기')).toBeVisible();
    // No account sign-in on this build or Service: a calm notice, no Primary, no checkout, no red alert.
    await startState(p, { purchase: { available: true, products: passes, stage: 'choosing', freeSeat: true, login: 'unavailable' }, ...freeStart({ age: '14+' }) });
    const notice = p.locator('.studio-purchase .studio-notice');
    await expect(notice).toHaveText('결제는 Google 로그인과 함께 열려요. 잠시 뒤 다시 확인해 주세요.');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(p.locator('.studio-connect .studio-primary')).toHaveCount(0);
    await expect(btn(p, '30,000원 결제하러 가기')).toHaveCount(0);
    await expect(p.getByRole('alert')).toHaveCount(0);
    await expect(btn(p, '돌아가기')).toBeVisible();
    await p.screenshot({ path: path.join(out, 'TUX-SP-17-unavailable-390.png'), fullPage: true });
    // Negative control: a code-issued seat with no gate keeps today's pay button (still on the pass list).
    await startState(p, { purchase: { available: true, products: passes, stage: 'choosing' } });
    await expect(btn(p, '30,000원 결제하러 가기')).toBeVisible();
    await expect(google).toHaveCount(0);
  }, { surface: 'start' });
  await test('TUX-A11Y-01', 'Visible controls have names and keyboard focus including citation and settings', async p => {
    await expect(p.getByRole('textbox',{name:'코치에게 보낼 메시지'})).toBeVisible();
    await expect(btn(p,'설정')).toBeVisible();
    await host(p,{type:'history',messages:history});
    const citation=p.locator('.hps-cit-chip').first();
    await expect(citation).toHaveRole('button');
    await citation.focus();await expect(citation).toBeFocused();await citation.press('Enter');
    await request(p,{type:'openExternal',url:history[1].citations[0].url});
    for(const button of await p.getByRole('button').all()) {
      if(await button.isVisible())expect(await button.getAttribute('aria-label')||await button.innerText()||await button.getAttribute('title')).toBeTruthy();
    }
  });
  await test('US-UI-DRAFT', 'Activity draft, attachment, queue restoration and freeze acknowledgment', async p => {
    await expect(draft(p)).toHaveValue('예약한 합성 입력\n작성 중인 합성 입력');
    assert.equal(emitted(await requests(p),'sendMessage').length,0,'restart must not auto-send queued work');
    await draft(p).fill('저장할 합성 초안');
    await host(p,{type:'activityFreeze',activityId:'activity-a',frozen:true,nonce:'flush-control'});
    await expect(draft(p)).toHaveAttribute('readonly','');
    await request(p,{type:'saveActivityDraft',activityId:'activity-a',nonce:'flush-control',draft:{text:'저장할 합성 초안',images:[],queued:null,toolMode:'auto'}});
    await host(p,{type:'activityFreeze',activityId:'activity-a',frozen:false});
    await expect(draft(p)).not.toHaveAttribute('readonly','');
    await draft(p).fill('');
    await host(p,{type:'inputRejected',activityId:'activity-a',text:'연결 거부 후 보존할 입력'});
    await expect(draft(p)).toHaveValue('연결 거부 후 보존할 입력');
    await host(p,{type:'config',config:config(native,{activity:{id:'activity-b',name:'합성 활동 B',kind:'classroom',workspace:'/synthetic/b',verified:true},activityDraft:{text:'B 초안',images:[],queued:null}})});
    await host(p,{type:'streamChunk',activityId:'activity-a',delta:'다른 활동의 비밀 표식'});
    await expect(draft(p)).toHaveValue('B 초안');
    await expect(p.getByText('다른 활동의 비밀 표식')).toHaveCount(0);
    await expect(p.getByLabel('현재 활동')).toContainText('합성 활동 B');
  },{cfg:{activity:{id:'activity-a',name:'합성 활동 A',kind:'trial',workspace:'/synthetic/a',verified:true},activityDraft:{text:'작성 중인 합성 입력',images:[],queued:'예약한 합성 입력'}}});
  await test('US-UI-OFFLINE', 'Offline activity keeps local history without permitting send', async p => {
    await host(p,{type:'history',activityId:'activity-a',messages:history});
    await expect(p.getByText('가상 안내 페이지를 만들어주세요.',{exact:true})).toBeVisible();
    await expect(draft(p)).toHaveAttribute('readonly','');
    await expect(p.getByRole('status').filter({hasText:'연결을 확인하지 못했습니다'})).toBeVisible();
    assert.equal(emitted(await requests(p),'sendMessage').length,0);
  },{profile:null,cfg:{activity:{id:'activity-a',name:'합성 활동 A',kind:'trial',workspace:'/synthetic/a',verified:false},activityDraft:{text:'보존한 입력',images:[],queued:null}}});
  await test('TUX-LAYOUT-01', 'Start surface 390/768/1280 has no horizontal overflow', async p => { for (const width of [390, 768, 1280]) { await p.setViewportSize({ width, height: 900 }); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await p.screenshot({ path: path.join(out, `start-${width}.png`), fullPage: true }); } }, { surface: 'start' });
  await test('TUX-LAYOUT-02', 'Chat + expanded observation 390/768/1280 has no horizontal overflow', async p => { await openObservation(p); await observe(p, { findings }); await p.getByText('보존된 산출물 비교', { exact: true }).click(); for (const width of [390, 768, 1280]) { await p.setViewportSize({ width, height: 900 }); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await p.screenshot({ path: path.join(out, `chat-${width}.png`), fullPage: true }); } });
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  const assets = (await fs.readdir(path.join(dist, 'assets'))).filter(f => f.endsWith('.js'));
  const hashes = Object.fromEntries(await Promise.all(assets.map(async f => [f, createHash('sha256').update(await fs.readFile(path.join(dist, 'assets', f))).digest('hex')])));
  const report = { schema: 'hps-trial-ux/1', executedAt: new Date().toISOString(), codeSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(), browser: 'Chromium', platform: process.platform, arch: process.arch, bundleSha256: hashes, profileSource: '@hypeproof/service-testkit/src/profiles/studio-native-trial.ts (actual public package registry profile)', servicePackage: serviceSourceManifest(), scope: 'Built React. Host messages, findings, artifacts and API outcomes are controlled synthetic fixtures. No real authentication, provider, native dialog, URL open, update, disk restore or deployment is claimed.', evaluatorControls: { positive: 'PASS', negativeMismatch: 'PASS', negativeMissing: 'PASS', draftExact: 'PASS', draftMissingToolMode: 'PASS', draftWrongToolMode: 'PASS', draftContentMismatch: 'PASS', draftScopeMismatch: 'PASS' }, counts: { pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length }, results };
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Report: ${path.join(out, 'report.json')}`);
  if (report.counts.fail) process.exitCode = 1;
}
