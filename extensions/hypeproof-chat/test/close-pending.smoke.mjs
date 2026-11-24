// 침묵 구간 안내 줄을 닫는 경로(요약 모드 WorkLine.close / 일반 모드 postToolLog)가
// 쓰기 성공 여부를 각각 따르는가. 두 경로의 호출은 서로 다른 배열에 따로 모은다.
//
// Run: node --experimental-strip-types test/close-pending.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { closePendingLine } = await import("../src/chatPanelHelpers.ts");

function run({ summary, wroteOk, pendingShown }) {
  const closeCalls = [];
  const logCalls = [];
  const work = summary ? { close: (label) => closeCalls.push(label) } : undefined;
  closePendingLine({
    pendingShown,
    wroteOk,
    work,
    postToolLog: (entry) => logCalls.push(entry),
  });
  return { closeCalls, logCalls };
}

function test_tc_0088_summary_mode_close_without_write() {
  const { closeCalls, logCalls } = run({ summary: true, wroteOk: false, pendingShown: true });
  assert.deepEqual(closeCalls, ["생각했어요"]);
  assert.equal(logCalls.length, 0, "요약 모드 입력이 일반 모드 경로로 처리됐다");
}

function test_tc_0089_normal_mode_close_without_write() {
  const { closeCalls, logCalls } = run({ summary: false, wroteOk: false, pendingShown: true });
  assert.equal(closeCalls.length, 0);
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].label, "생각했어요");
  assert.equal(logCalls[0].state, "done");
}

function test_tc_0090_summary_mode_close_after_write() {
  const { closeCalls, logCalls } = run({ summary: true, wroteOk: true, pendingShown: true });
  assert.deepEqual(closeCalls, ["고쳤어요"]);
  assert.equal(logCalls.length, 0);
}

function test_tc_0091_normal_mode_close_after_write() {
  const { closeCalls, logCalls } = run({ summary: false, wroteOk: true, pendingShown: true });
  assert.equal(closeCalls.length, 0);
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].label, "고쳤어요");
  assert.equal(logCalls[0].state, "done");
}

function test_tc_0092_nothing_called_when_line_not_shown() {
  for (const summary of [true, false]) {
    for (const wroteOk of [true, false]) {
      const { closeCalls, logCalls } = run({ summary, wroteOk, pendingShown: false });
      assert.equal(closeCalls.length, 0);
      assert.equal(logCalls.length, 0);
    }
  }
}

function test_tc_0088_provider_clear_pending_uses_helper() {
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(src, /const clearPending = \(\) => \{[\s\S]{0,400}closePendingLine\(/, "clearPending must call closePendingLine");
}

for (const t of [
  test_tc_0088_summary_mode_close_without_write,
  test_tc_0089_normal_mode_close_without_write,
  test_tc_0090_summary_mode_close_after_write,
  test_tc_0091_normal_mode_close_after_write,
  test_tc_0092_nothing_called_when_line_not_shown,
  test_tc_0088_provider_clear_pending_uses_helper,
]) {
  t();
  console.log(`✓ ${t.name}`);
}
console.log("\nclose-pending smoke: ok");
