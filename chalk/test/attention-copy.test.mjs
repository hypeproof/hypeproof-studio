// CGP-AGENT-R-013 (REQ-CGP-AGENT-23) / classroom-admin ADM-09 attention-copy table.
// Every attention item on /manage (one per seat reason) has a title "state + object" and a summary that is one next
// step for the instructor. This test pins the full list so a copy change shows up as a diff here, and lints it:
//   - title 4–20 characters, summary <= 40 characters (DES-CGP-AGENT-23 row truncation budget);
//   - no internal codes (snake_case, HTTP status numbers, SDK) and none of the banned generic words;
//   - '확인 불가' appears only in stale_signal: seatStatus() turns an "ok" row into "확인 불가" when the stage
//     contains that word, so adding it to another title would change behaviour, not just copy;
//   - the approval-wait row stage reads the same title as the waiting_approval item.
// Negative controls feed bad copy to the linter and prove it reports each failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../src/ui/manage.html', import.meta.url), 'utf8');
const literal = html.match(/const reasonLabels=(\{[^\n]*\});\n/);
assert.ok(literal, 'manage.html defines reasonLabels on one line');
// JSON round trip: objects built in another vm realm fail deepStrictEqual on their prototypes.
const labels = JSON.parse(JSON.stringify(vm.runInNewContext('(' + literal[1] + ')')));

const expected = {
  auth_expired: ['학생 토큰 기한 지남', '학생 초대 화면에서 새 토큰을 발급해 주세요'],
  auth_signature: ['학생 토큰이 잘못됨', '토큰이 잘리지 않게 다시 붙여넣게 해 주세요'],
  auth_revoked: ['학생 토큰이 폐기됨', '학생 초대 화면에서 새 토큰을 발급해 주세요'],
  auth_rejected: ['학생 토큰 거부 · 원인 모름', '만료로 단정하지 말고 수업 열림도 확인해 주세요'],
  class_not_open: ['수업이 열려 있지 않음', '수업 열기·종료 화면에서 수업을 열어 주세요'],
  profile_mismatch: ['다른 수업의 학생 토큰', '이번 수업용 토큰을 다시 발급해 주세요'],
  roster_missing: ['명단에 없는 학생', '학생 초대 화면에서 명단에 추가해 주세요'],
  budget_limit: ['AI 사용 한도 도달', '예산 화면에서 한도를 확인해 주세요'],
  provider_rate_limit: ['AI 제공자 요청 제한', '잠시 기다려 주세요. PC 초기화는 필요 없어요'],
  provider_5xx: ['AI 제공자 쪽 장애', '이 PC 문제가 아니에요. 복구를 기다려 주세요'],
  network: ['서버에 연결 안 됨', '교실 와이파이와 학생 PC 연결을 확인해 주세요'],
  sdk_not_ready: ['AI 실행 환경 준비 안 됨', '학생 PC에서 앱을 다시 시작해 주세요'],
  tool_not_ready: ['AI 도구 준비 안 됨', '학생 PC에서 앱을 다시 시작해 주세요'],
  review_error: ['결과 검수 중 오류', '학생 화면의 안내를 같이 확인해 주세요'],
  upload_failed: ['수업 기록 전송 실패', '기다려 주세요. 연결되면 자동으로 다시 보내요'],
  unknown: ['원인 모를 오류', '학생 화면을 직접 보고 확인해 주세요'],
  not_connected: ['학생 기기 연결 안 됨', '연결 코드를 발급해 학생 앱에 넣게 해 주세요'],
  connection_revoked: ['학생 기기 연결 해제됨', '연결 코드를 다시 발급해 주세요'],
  no_signal: ['앱 신호가 아직 없음', '앱이 켜져 있는지 학생에게 확인해 보세요'],
  stale_signal: ['신호 끊김 · 확인 불가', '노트북 덮개·와이파이·앱 종료를 직접 확인해 주세요'],
  waiting_approval: ['학생 승인 기다리는 중', '오류 아님 · 학생에게 승인 창을 보게 해 주세요'],
};

// 1. The full list, in order. A new reason type or a reworded item must be added here on purpose.
assert.deepEqual(Object.keys(labels), Object.keys(expected), 'attention item types');
assert.deepEqual(labels, expected, 'attention item title/summary list');

// 2. Copy lint.
const BANNED = ['업데이트', '완료', '참고'];
function lint(map) {
  const problems = [];
  for (const [type, pair] of Object.entries(map)) {
    if (!Array.isArray(pair) || pair.length !== 2) { problems.push(type + ': not [title, summary]'); continue; }
    const [title, summary] = pair;
    if ([...title].length < 4 || [...title].length > 20) problems.push(type + ': title length ' + [...title].length);
    if ([...summary].length > 40) problems.push(type + ': summary length ' + [...summary].length);
    if (!summary.trim()) problems.push(type + ': empty summary');
    for (const text of [title, summary]) {
      if (/[a-z]+_[a-z_]+/i.test(text)) problems.push(type + ': internal code in "' + text + '"');
      if (/\b[1-5]\d\d\b|\b[1-5]xx\b|SDK/i.test(text)) problems.push(type + ': status code or SDK in "' + text + '"');
      if (!/[가-힣]/.test(text)) problems.push(type + ': not Korean "' + text + '"');
      for (const w of BANNED) if (text.includes(w)) problems.push(type + ': banned word ' + w);
      if (/습니다|십시오/.test(text)) problems.push(type + ': formal ending in "' + text + '"');
    }
    if (title.includes('확인 불가') !== (type === 'stale_signal')) problems.push(type + ': 확인 불가 changes seatStatus()');
  }
  return problems;
}
assert.deepEqual(lint(labels), [], 'attention copy lint');

// Negative controls: each bad item is reported.
const bad = {
  stale_signal: ['신호 끊김', '확인하세요'],
  too_long_title: ['아주아주아주 긴 제목이 스무 글자를 넘어 버림', '다시 시도해 주세요'],
  long_summary: ['학생 토큰 기한 지남', '학생 초대 화면으로 가서 새 토큰을 발급한 뒤 학생에게 다시 붙여넣게 해 주세요'],
  code: ['auth_expired 오류', '새 토큰을 발급해 주세요'],
  status: ['AI 제공자 529', '복구를 기다려 주세요'],
  banned: ['토큰 업데이트 필요', '참고만 하세요'],
  formal: ['학생 토큰 기한 지남', '새 토큰을 발급하십시오'],
  unknown_word: ['신호 확인 불가', '학생에게 물어보세요'],
};
const found = lint(bad).join('\n');
for (const needle of ['stale_signal: 확인 불가', 'too_long_title: title length', 'long_summary: summary length', 'code: internal code',
  'status: status code', 'banned: banned word 업데이트', 'banned: banned word 참고', 'formal: formal ending', 'unknown_word: 확인 불가'])
  assert.ok(found.includes(needle), 'linter reports ' + needle + '\n' + found);

// 3. The approval-wait row stage (no reason code, runtime says waiting) uses the same title as the item.
assert.match(html, /else if\(wait\)stage=reasonLabels\.waiting_approval\[0\];/, 'approval-wait stage reads the item title');

// 4. The old wording is gone from the page (no second copy left behind).
for (const old of ['토큰 기한이 지났습니다', '토큰이 올바르지 않습니다', '기기가 연결되지 않았습니다', '신호가 끊겼습니다 · 확인 불가',
  '학생의 승인을 기다리는 중', '원인 미확인 오류', '네트워크 연결 문제'])
  assert.ok(!html.includes(old), 'old attention copy remains: ' + old);

console.log('attention-copy: ' + Object.keys(labels).length + ' item types pinned and linted, ' + Object.keys(bad).length + ' negative controls');
