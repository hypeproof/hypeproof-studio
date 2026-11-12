import '@hypeproof/service-testkit/test/harness/loader.mjs';
// E5 #3778 — learners connect with ONE class code instead of a 12-digit ticket per seat. Designed behaviour, in a real browser:
//  - "수업 코드 만들기" in the connection area makes the run's code (POST /join-codes, chosen duration) and shows it large
//    (≥32px) with its expiry and "이 수업 명단에 있는 수강생만 연결됩니다";
//  - the clear code is kept only in this tab's sessionStorage: a reload of the tab shows it again, another tab does not
//    (it says a live code exists and that a new one replaces it), and the device-wide localStorage never holds it;
//  - uses are shown as learners connect; "코드 폐기" revokes it and the code then connects nobody;
//  - the per-seat 12-character ticket flow is still there.
// Real here: Chalk /manage in Chromium, Chalk worker + forwarder, the Service router + SQLite. The learner side is the
// Service join route called with the learner's own class token, as the app does.
import assert from 'node:assert/strict';
import { e5Stack, OPS_ALL, until } from './e5-chalk.mjs';

const S = await e5Stack(), { local } = S;
const { setRoster } = await import('@hypeproof/service-testkit/src/lib/kv.ts');
let n = 0; const ok = (name) => { n++; console.log('PASS ' + name); };
const T = (page, id) => page.locator('#' + id).innerText();
try {
  await setRoster(local.env.HPS_KV, local.cohort, ['student-a', 'student-b', 'student-c', 'student-x']);
  const seats = ['a', 'b', 'c'].map((x, i) => ({ seat_id: 'A' + (i + 1), student_id: 'student-' + x }));
  assert.equal((await local.configure(seats, 0, { flags: { ops_observe: true }, lesson: undefined })).status, 201);
  const X = await local.teacher('teacher-j', OPS_ALL);
  const join = async (who, code, no) => local.request('/v1/classroom/ops/join', 'POST', { code, ...local.instance(no, ['observe']) }, await local.student(who));

  const page = await S.instructor(X, '#ops-seats .ops-seat[data-seat="A3"]');
  assert.equal(await page.locator('#ops-join').isVisible(), false);
  await page.locator('#join-code-open').click(); await page.locator('#ops-join-make').waitFor();
  assert.equal(await page.locator('#ops-join-live').isVisible(), false, 'no live code yet');
  await page.locator('#ops-join-ttl').selectOption('30'); await page.locator('#ops-join-make').click();
  await page.locator('#ops-join-state').filter({ hasText: '수업 코드를 만들었습니다' }).waitFor();
  const code = (await T(page, 'ops-join-code')).trim();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/, 'XXXX-XXXX without confusable characters: ' + code);
  const px = await page.locator('#ops-join-code').evaluate((e) => parseFloat(getComputedStyle(e).fontSize)); assert.ok(px >= 32, 'shown large: ' + px + 'px');
  assert.match(await T(page, 'ops-join-live'), /이 수업 명단에 있는 수강생만 연결됩니다/);
  assert.match(await T(page, 'ops-join-meta'), /까지 \((29|30)분 남음\) · 이 코드로 연결 0회/);
  const row = local.db.prepare("SELECT id,expires_at,created_at,state FROM class_run_join_codes WHERE state='active'").get();
  assert.ok(Math.abs(row.expires_at - row.created_at - 30 * 60_000) < 5000, 'the chosen duration was sent');
  const held = await page.evaluate(() => ({ session: Object.entries(sessionStorage), local: Object.entries(localStorage) }));
  assert.equal(held.session.length, 1); assert.ok(held.session[0][1].includes(code), 'the clear code is in this tab\'s sessionStorage');
  assert.ok(!JSON.stringify(held.local).includes(code), 'and never in localStorage');
  ok('수업 코드 만들기: the code shown at ≥32px with expiry and the roster-only note, kept in sessionStorage only');

  // ── learners connect with it; uses follow ──
  assert.equal((await join('student-a', code, 1)).status, 201); assert.equal((await join('student-b', code.replace('-', '').toLowerCase(), 2)).status, 201);
  assert.equal((await join('student-x', code, 3)).json.reason, 'seat_not_found', 'a learner not on this run roster does not connect');
  await until(page, async () => /이 코드로 연결 2회/.test(await T(page, 'ops-join-meta')), 'uses shown');
  ok('learners on the roster connect with the code; uses are shown as they do');

  // ── the same tab after a reload shows it again; another tab does not ──
  await page.reload(); await page.locator('#cohort').fill(local.cohort); await page.locator('#prefix').fill('student-'); await page.locator('#connect button').first().click();
  await page.locator('#status').filter({ hasText: '연결됨' }).waitFor(); await page.locator('#refresh').click(); await page.locator('#ops-seats .ops-seat[data-seat="A1"]').waitFor();
  await page.locator('#join-code-open').click(); await page.locator('#ops-join-code').filter({ hasText: code }).waitFor();
  const other = await S.instructor(X, '#ops-seats .ops-seat[data-seat="A1"]'); await other.locator('#join-code-open').click();
  await other.locator('#ops-join-other').filter({ hasText: '코드는 만든 탭에서만 다시 볼 수 있습니다' }).waitFor();
  assert.equal(await other.locator('#ops-join-code').isVisible(), false); assert.ok(!(await other.content()).includes(code), 'another tab never has the clear code');
  assert.match(await T(other, 'ops-join-meta'), /이 코드로 연결 2회/);
  ok('a reload of the same tab shows the code again; another tab only says a live code exists');

  // ── a new code in the other tab supersedes; the first tab notices; then revoke ──
  await other.locator('#ops-join-make').click(); await other.locator('#ops-join-impact').filter({ hasText: '지금 코드는 바로 폐기' }).waitFor(); await other.locator('#ops-join-go').click();
  await other.locator('#ops-join-state').filter({ hasText: '수업 코드를 만들었습니다' }).waitFor(); const code2 = (await T(other, 'ops-join-code')).trim(); assert.notEqual(code2, code);
  assert.equal((await join('student-c', code, 3)).json.reason, 'code_invalid', 'the superseded code connects nobody');
  await until(page, async () => !(await page.locator('#ops-join-code').isVisible()) && (await page.locator('#ops-join-other').isVisible()), 'first tab drops its superseded code');
  assert.equal(await page.evaluate(() => sessionStorage.length), 0, 'the superseded code is removed from the first tab');
  await other.locator('#ops-join-revoke').click(); await other.locator('#ops-join-go').click();
  await other.locator('#ops-join-state').filter({ hasText: '코드를 폐기했습니다' }).waitFor();
  assert.equal(await other.locator('#ops-join-live').isVisible(), false); assert.equal(await other.evaluate(() => sessionStorage.length), 0);
  assert.equal((await join('student-c', code2, 3)).json.reason, 'code_invalid', 'a revoked code connects nobody');
  assert.equal(local.db.prepare("SELECT COUNT(*) AS n FROM class_run_join_codes WHERE state='active'").get().n, 0);
  ok('one live code per run: a new one supersedes the old; 코드 폐기 revokes it and clears the tab');

  // ── the per-seat 12-character ticket stays ──
  await page.locator('#ops-seats .ops-seat[data-seat="A3"] .seat-open').click();
  const pair = page.locator('#ops-actions [data-act="pairing"]').first(); await pair.waitFor({ state: 'attached' });
  // The seat's connection tools sit in a folded section of the detail; the instructor opens it.
  await pair.evaluate((b) => { for (let d = b.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true; });
  assert.match(await pair.innerText(), /연결 코드 발급/); await pair.click();
  await page.locator('#ops-actions .ticket').waitFor(); assert.match((await page.locator('#ops-actions .ticket').innerText()).replace(/[^0-9A-Za-z]/g, ''), /^[0-9A-Za-z]{12}$/, 'a 12-character seat ticket');
  ok('the per-seat 12-character ticket is still issued from the seat detail');

  assert.deepEqual(S.errors, [], 'no script error on the instructor pages'); console.log(`\n${n} join-code browser checks passed`);
} finally { await S.close(); }
