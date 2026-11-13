import '@hypeproof/service-testkit/test/harness/loader.mjs';
// E5 #3777 — the instructor knows "my learners" by name, and the names never leave the instructor's device.
// Designed behaviour, in a real browser:
//  - names pasted as `handle,name` CSV in /manage are stored in this browser's localStorage under the cohort;
//  - the seat board and the question answers view show the name next to the handle; a seat without a name shows its handle;
//  - a name written as markup stays text;
//  - no request the page makes — to Chalk or through it to the Service — carries a name, in its URL or its body;
//  - names survive a reload of the page on this device, and the clear button removes them from the screen and storage.
// Real here: Chalk /manage in Chromium, Chalk worker + forwarder, the Service router + SQLite.
import assert from 'node:assert/strict';
import { e5Stack, OPS_ALL, until } from './e5-chalk.mjs';

const S = await e5Stack(), { local } = S;
const { setRoster } = await import('@hypeproof/service-testkit/src/lib/kv.ts');
let n = 0; const ok = (name) => { n++; console.log('PASS ' + name); };
const T = (page, id) => page.locator('#' + id).innerText();
const NAMES = ['김민지', '이서준', '<b>박</b>하늘'];
try {
  await setRoster(local.env.HPS_KV, local.cohort, ['student-a', 'student-b', 'student-c', 'student-d']);
  const seats = ['a', 'b', 'c', 'd'].map((x, i) => ({ seat_id: 'A' + (i + 1), student_id: 'student-' + x }));
  assert.equal((await local.configure(seats, 0, { flags: { ops_observe: true, ops_distribute: true, ops_questions: true }, lesson: undefined })).status, 201);
  const X = await local.teacher('teacher-n', [...OPS_ALL, 'distribute']);
  const requests = []; S.context.on('request', (r) => requests.push({ url: r.url(), body: r.postData() ?? '' }));
  const page = await S.instructor(X, '#ops-seats .ops-seat[data-seat="A4"]');
  // The seat cell without its consent chip (#3775), which follows the label.
  const seatText = async (id) => (await page.locator(`#ops-seats .ops-seat[data-seat="${id}"] .c-seat`).innerText()).replace(/\s*동의(함| 전)$/, '');

  // ── import ──
  await page.locator('#ops-names-sum').click();
  await page.locator('#ops-names-text').fill('handle,name\nstudent-a,김민지\nstudent-b,이서준\nstudent-c,<b>박</b>하늘\nstudent-zz,=HYPERLINK("x")');
  assert.match(await T(page, 'ops-names-preview'), /이름 있는 줄 3 · 확인 필요 1 \(5번째 줄: =, \+, -, @로 시작하는 칸이 있어요/);
  await page.getByRole('button', { name: '이 기기에 이름 저장' }).click();
  await page.locator('#ops-names-state').filter({ hasText: '이 기기에 저장했습니다 · 새 이름 3' }).waitFor();
  assert.deepEqual([await seatText('A1'), await seatText('A2'), await seatText('A3')], ['A1 김민지 student-a', 'A2 이서준 student-b', 'A3 <b>박</b>하늘 student-c'], 'the name is shown next to the handle');
  assert.equal(await page.locator('#ops-seats .ops-seat[data-seat="A3"] b').count(), 0, 'a name written as markup stays text');
  assert.equal(await page.locator('#ops-seats .ops-seat[data-seat="A4"] .who-name').count(), 0); assert.equal(await page.locator('#ops-seats .ops-seat[data-seat="A4"] .who').textContent(), 'student-d', 'no name: the handle, as before');
  assert.match(await T(page, 'ops-names-sum'), /3명 · 이번 수업 명단 중 3명/);
  const stored = await page.evaluate((c) => localStorage.getItem('chalk.learner-names.v1.' + c), local.cohort);
  assert.deepEqual(JSON.parse(stored), { 'student-a': '김민지', 'student-b': '이서준', 'student-c': '<b>박</b>하늘' }, 'stored on this device under the cohort');
  await page.locator('#ops-search').fill('서준'); assert.equal(await page.locator('#ops-seats .ops-seat:not([hidden])').count(), 1, 'the seat search finds a learner by name'); await page.locator('#ops-search').fill('');
  ok('names pasted as handle,name are kept on this device and shown next to handles; markup stays text; no name falls back to the handle');

  // ── question answers view ──
  await page.locator('#ops-q-summary').click(); await page.locator('#ops-q-body').fill('지금 진행 단계는?'); await page.locator('#ops-q-options').fill('시작 전\n진행 중\n끝남');
  await page.locator('#ops-q-send').click(); await page.locator('#ops-q-go').click(); await page.locator('#ops-q-state').filter({ hasText: '보냈습니다 · 4석' }).waitFor();
  await page.locator('#ops-qc-view tr[data-seat="A4"]').waitFor();
  const who = async (seat) => (await page.locator(`#ops-qc-view tr[data-seat="${seat}"] td`).allInnerTexts())[1];
  assert.deepEqual([await who('A1'), await who('A2'), await who('A3'), await who('A4')], ['김민지 (student-a)', '이서준 (student-b)', '<b>박</b>하늘 (student-c)', 'student-d']);
  ok('the question answers view shows names next to handles; a missing name shows the handle');

  // ── names survive a reload on this device; nothing ever carried them ──
  await page.reload(); await page.locator('#cohort').fill(local.cohort); await page.locator('#prefix').fill('student-'); await page.locator('#connect button').first().click();
  await page.locator('#status').filter({ hasText: '연결됨' }).waitFor(); await page.locator('#refresh').click(); await page.locator('#ops-seats .ops-seat[data-seat="A1"] .who-name').waitFor();
  assert.equal(await seatText('A1'), 'A1 김민지 student-a', 'still on this device after a reload');
  await until(page, async () => true, 'one more board read');
  assert.ok(requests.length > 20, 'the run made real requests: ' + requests.length);
  const leaked = requests.filter((r) => NAMES.some((nm) => r.body.includes(nm) || decodeURIComponent(r.url).includes(nm) || r.body.includes(JSON.stringify(nm).slice(1, -1))));
  assert.deepEqual(leaked, [], 'no request URL or body carries a learner name');
  assert.ok(!JSON.stringify(local.db.prepare("SELECT * FROM ops_audit").all()).includes('김민지'), 'and the Service holds none');
  ok('no request URL or body ever carries a name (' + requests.length + ' requests checked); names survive a reload');

  // ── clear ──
  await page.locator('#ops-names-sum').click(); await page.getByRole('button', { name: '이 기기의 이름 지우기' }).click();
  await page.locator('#ops-names-state').filter({ hasText: '지웠습니다' }).waitFor();
  assert.equal(await page.locator('#ops-seats .who-name').count(), 0); assert.equal(await page.evaluate((c) => localStorage.getItem('chalk.learner-names.v1.' + c), local.cohort), null);
  ok('the clear button removes the names from the screen and from this device');

  assert.deepEqual(S.errors, [], 'no script error on the instructor page'); console.log(`\n${n} learner-name browser checks passed`);
} finally { await S.close(); }
