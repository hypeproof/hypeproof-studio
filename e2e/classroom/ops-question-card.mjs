import '@hypeproof/service-testkit/test/harness/loader.mjs';
// E5 #3776 — the instructor throws a question card to every learner from Chalk /manage and sees, per learner, whether it
// reached the device and what they answered. Designed behaviour, in a real browser:
//  - the composer appears only when the run has question cards on (and the instructor may send);
//  - choice (2–6 distinct options) or short answer, a preview, then a confirmation step; nothing is sent before it;
//  - "모든 좌석" = every seat of the run roster: an absent learner gets the card when they connect;
//  - per seat: 전달 전 → 전달됨 (the device confirmed it holds the card) → 답함 with the answer; not delivered says why
//    (offline → 연결되면 전달, an app without question cards → 앱 업데이트 필요); answers are text, never markup;
//  - the answers view follows the board's refresh while it is open; withdrawal through the distribution ledger;
//  - nothing ever says a learner opened or read a card.
// Real here: Chalk /manage in Chromium, Chalk worker + forwarder, the Service router + SQLite. The learner devices are the
// Service sync protocol driven directly (receipts as the app sends them); this Studio checkout's app does not yet declare
// `inbox_question`, so its InboxSession is not used here.
import assert from 'node:assert/strict';
import { e5Stack, OPS_ALL, until } from './e5-chalk.mjs';

const S = await e5Stack(), { local } = S;
const { setRoster } = await import('@hypeproof/service-testkit/src/lib/kv.ts');
const { CLASS_DATA_POLICY } = await import('@hypeproof/service-testkit/src/lib/class-data-policy.ts');
let n = 0; const ok = (name) => { n++; console.log('PASS ' + name); };
const T = (page, id) => page.locator('#' + id).innerText();
const CAN = ['observe', 'distribution_inbox', 'inbox_question'], OLD = ['observe', 'distribution_inbox'];
const KEY = () => crypto.randomUUID();
try {
  await setRoster(local.env.HPS_KV, local.cohort, ['student-a', 'student-b', 'student-c']);
  const seats = [{ seat_id: 'A1', student_id: 'student-a' }, { seat_id: 'A2', student_id: 'student-b' }, { seat_id: 'A3', student_id: 'student-c' }];
  assert.equal((await local.configure(seats, 0, { flags: { ops_observe: true, ops_distribute: true }, lesson: undefined })).status, 201);
  const X = await local.teacher('teacher-q', [...OPS_ALL, 'distribute']);
  // A1: a current app, connected. A2: an app without question cards, connected. A3: not connected yet.
  const a1 = (await local.pair('A1', 1, 1, CAN)).conn.json, a2 = (await local.pair('A2', 1, 2, OLD)).conn.json;
  const dsync = (conn, no, distribution = {}) => local.sync(conn.credential, [], no, { distribution });
  const receipt = (item, stage) => ({ offer_key: item.offer_key, distribution_id: item.distribution_id, object_id: item.object_id, revision: item.revision, content_hash: item.content_hash, seq: item.seq, stage, result_code: '', observed_at: Date.now() });
  const answer = (conn, item, a) => local.request('/v1/classroom/ops/participation/answers', 'POST', { idempotency_key: KEY(), distribution_id: item.distribution_id, object_id: item.object_id, revision: item.revision, content_hash: item.content_hash, answer: a }, conn.credential);
  const consent = (conn) => local.request('/v1/classroom/ops/participation/consent', 'POST', { consent: true, notice_version: CLASS_DATA_POLICY.notice_version }, conn.credential);
  const take = async (conn, no, objectId) => { const items = (await dsync(conn, no)).json?.distribution?.items ?? []; const item = items.find((i) => i.object_id === objectId); if (item) await dsync(conn, no, { receipts: [receipt(item, 'received'), receipt(item, 'reflected')] }); return item; };

  const page = await S.instructor(X, '#ops-seats .ops-seat[data-seat="A3"]');
  const sent = []; page.on('request', (r) => { if (r.method() === 'POST') sent.push([new URL(r.url()).pathname, r.postData()]); });
  const row = (seat) => page.locator(`#ops-qc-view tr[data-seat="${seat}"]`);
  const cell = async (seat) => (await row(seat).locator('td').allInnerTexts()).slice(2);

  // ── the composer follows the run switch ──
  assert.equal(await page.locator('#ops-q').isVisible(), false, 'question cards are off for this run: no composer');
  await page.locator('#ops-setup > summary').click(); await page.locator('#ops-questions').check(); await page.getByRole('button', { name: '명단·설정 저장' }).click();
  await until(page, () => page.locator('#ops-q').isVisible(), 'composer after turning question cards on');
  ok('the composer appears only once the run has question cards on');

  // ── compose: form checks, preview, confirmation ──
  await page.locator('#ops-q-summary').click();
  await page.locator('#ops-q-body').fill('오늘 실습에서 가장 어려웠던 단계는?');
  await page.locator('#ops-q-options').fill('자료 정리'); await page.locator('#ops-q-send').click();
  assert.match(await T(page, 'ops-q-problem'), /보기는 2–6개여야 합니다 \(지금 1개\)/);
  await page.locator('#ops-q-options').fill('자료 정리\n자료 정리'); await page.locator('#ops-q-send').click(); assert.match(await T(page, 'ops-q-problem'), /같은 보기가 두 번/);
  await page.locator('#ops-q-options').fill('자료 정리\n프롬프트 작성\n결과 검토');
  assert.match(await T(page, 'ops-q-preview'), /강사 질문[\s\S]*오늘 실습에서 가장 어려웠던 단계는\?[\s\S]*○ 자료 정리[\s\S]*○ 프롬프트 작성[\s\S]*○ 결과 검토/);
  assert.match(await T(page, 'ops-q-to-all'), /명단 3석 \(지금 연결 2석 · 연결 안 된 학생은 연결되면 받습니다\)/);
  await page.locator('#ops-q-send').click();
  assert.match(await T(page, 'ops-q-impact'), /명단 전체 3석에 보냅니다 — 지금 연결 2석, 미연결 1석/);
  assert.deepEqual(sent.filter(([p]) => /\/contents|\/distributions/.test(p)), [], 'nothing is saved or sent before the confirmation');
  await page.locator('#ops-q-go').click(); await page.locator('#ops-q-state').filter({ hasText: '보냈습니다 · 3석' }).waitFor();
  const d1 = local.db.prepare("SELECT d.id,d.object_id,d.targets_json FROM classroom_distributions d JOIN classroom_content_objects o ON o.object_id=d.object_id WHERE o.kind='question'").all();
  assert.equal(d1.length, 1); assert.deepEqual(JSON.parse(d1[0].targets_json).map((t) => typeof t === 'string' ? t : Array.isArray(t) ? t[0] : t.seat_id).sort(), ['A1', 'A2', 'A3'], 'every seat of the run roster is a target');
  ok('choice card: 2–6 distinct options checked, preview shown, nothing sent before confirming; "모든 좌석" targets the whole roster');

  // ── delivery: device holds it → 전달됨; old app → 앱 업데이트 필요; absent → 연결되면 전달 ──
  await row('A1').waitFor();
  const choiceId = d1[0].object_id, i1 = await take(a1, 1, choiceId); assert.ok(i1, 'A1 was offered the card');
  assert.equal(await take(a2, 2, choiceId), undefined, 'an app without question cards is offered nothing');
  await until(page, async () => (await cell('A1'))[1] === '전달됨', 'A1 delivered');
  assert.deepEqual(await cell('A1'), ['연결됨', '전달됨', '']);
  assert.deepEqual(await cell('A2'), ['연결됨', '전달 전', '앱 업데이트 필요 — 이 앱은 질문 카드를 받지 못합니다']);
  assert.deepEqual(await cell('A3'), ['미연결', '전달 전', '미연결 — 연결되면 전달']);
  // The late joiner connects: the card that waited for the seat reaches the device.
  const a3 = (await local.pair('A3', 2, 3, CAN)).conn.json, i3 = await take(a3, 3, choiceId); assert.ok(i3, 'the card waited for the absent seat');
  await until(page, async () => (await cell('A3'))[1] === '전달됨', 'A3 delivered after connecting');
  ok('per learner 전달 전 → 전달됨 once the device holds it; the late joiner gets it on connecting; not delivered says why');

  // ── answers ──
  assert.equal((await answer(a1, i1, { choice: 1 })).json.reason, 'consent_required', 'the Service requires consent first');
  await consent(a1); assert.equal((await answer(a1, i1, { choice: 1 })).status, 201);
  await consent(a3); assert.equal((await answer(a3, i3, { skipped: true })).status, 201);
  await until(page, async () => (await cell('A1'))[1] === '답함', 'A1 answered (board refresh drives the answers view)');
  assert.deepEqual(await cell('A1'), ['연결됨', '답함', '2번 · 프롬프트 작성']); assert.deepEqual((await cell('A3')).slice(1), ['답함', '건너뜀']);
  assert.match(await T(page, 'ops-qc-view'), /1번 자료 정리 — 0명[\s\S]*2번 프롬프트 작성 — 1명[\s\S]*3번 결과 검토 — 0명/);
  assert.match(await T(page, 'ops-qc-state'), /명단 3석 · 전달 전 1 · 전달됨 0 · 답함 2 \(그중 건너뜀 1\)/);
  ok('answered shows each learner’s answer and the choice tally');

  // ── a short-answer card to the selected seat only; markup stays text; withdrawal ──
  await page.locator('#ops-seats .ops-seat[data-seat="A1"]').getByLabel('선택').check();
  await page.locator('#ops-q-body').fill('지금 막힌 부분을 한 줄로 적어 주세요.'); await page.locator('#ops-q-title').fill('막힌 곳');
  await page.locator('input[name="ops-q-type"][value="text"]').check(); assert.equal(await page.locator('#ops-q-options').isVisible(), false);
  await page.locator('input[name="ops-q-to"][value="picked"]').check(); await page.locator('#ops-q-send').click();
  assert.match(await T(page, 'ops-q-impact'), /‘막힌 곳’ 질문 카드를 선택한 1석에 보냅니다/);
  await page.locator('#ops-q-go').click(); await page.locator('#ops-q-state').filter({ hasText: '보냈습니다 · 1석' }).waitFor();
  const textCard = local.db.prepare("SELECT d.object_id,d.targets_json FROM classroom_distributions d JOIN classroom_content_objects o ON o.object_id=d.object_id WHERE o.kind='question' ORDER BY d.created_at DESC LIMIT 1").get();
  assert.equal(JSON.parse(textCard.targets_json).length, 1);
  const it = await take(a1, 1, textCard.object_id); assert.ok(it); assert.equal((await answer(a1, it, { text: '<img src=x onerror="window.__xss=1">표 정리 단계' })).status, 201);
  await until(page, async () => (await cell('A1'))[1] === '답함', 'text answer shown');
  assert.equal((await cell('A1'))[2], '<img src=x onerror="window.__xss=1">표 정리 단계', 'the answer is shown as text');
  assert.equal(await page.locator('#ops-qc-view img').count(), 0); assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.deepEqual((await cell('A2')).slice(1), ['전달 전', '이 좌석에는 보내지 않음']);
  await page.locator('#ops-qc-withdraw').click(); await page.locator('#ops-qc-withdraw-impact').filter({ hasText: '‘막힌 곳’ 질문 카드를 회수합니다 (배포 1건)' }).waitFor();
  await page.locator('#ops-qc-withdraw-go').click(); await page.locator('#ops-qc-note').filter({ hasText: '회수했습니다 · 배포 1건' }).waitFor();
  assert.notEqual(local.db.prepare('SELECT revoked_at FROM classroom_distributions WHERE object_id=?').get(textCard.object_id).revoked_at, null, 'withdrawn through the distribution ledger');
  assert.deepEqual(await cell('A1'), ['연결됨', '답함', '<img src=x onerror="window.__xss=1">표 정리 단계'], 'an answer given before the withdrawal stays');
  assert.equal((await answer(a1, it, { text: '또' })).json.reason, 'withdrawn');
  ok('short answer to the selected seat, answer shown as text only, withdrawn with the ledger');

  // Switching back to the first card in the list shows its own answers.
  await page.locator('#ops-qc-list button', { hasText: '강사 질문' }).click(); await until(page, async () => (await cell('A1'))[2] === '2번 · 프롬프트 작성', 'first card again');
  const words = (await T(page, 'ops-q')) + (await T(page, 'ops-qc'));
  assert.doesNotMatch(words, /열람|읽음|읽었|opened/, 'nothing claims a learner opened or read a card');
  ok('the cards list switches between cards; no opened/read wording anywhere in the question views');

  assert.deepEqual(S.errors, [], 'no script error on the instructor page'); console.log(`\n${n} question-card browser checks passed`);
} finally { await S.close(); }
