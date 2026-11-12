// #3601 — 로컬 실행기 턴: 고정 180초 예산 → 무진행 정지 감지 (SDK 경로와 같은 규칙).
// 가짜 시계로 시간을 흘린다. vscode 모듈은 로드하지 않는다.
//
// 대조군 규율 (양방향):
//   정지가 나야 할 때 나고, 정지가 아니어야 할 때 나지 않는다.
//   T1 무진행 → 정지 / T2 긴 생각 stream → 정지 아님 / T3 사람 대기 → 정지 아님
//   T4 대기 끝난 뒤 유예 / T5 도구 실행 중 한 예산 + 유예 (한계 포함)
//   T6 설정 0 → 끔 / T8 절전 복귀 (음성 대조 포함) / T9 정지 문구와 사유
//   T10 설정 0 이어도 긴 단계 안내는 계산된다
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStallWatch, CoachStallError, setLocalStallTimeoutProvider, localStallTimeoutMs, LOCAL_DEFAULT_STALL_MS, LOCAL_SLEEP_GAP_MS } from "../src/localRuntime/stallWatch.ts";
import { createHumanWait } from "../src/localRuntime/humanWait.ts";
import { stallNotice } from "../src/coachIdentity.ts";
import { idleTurnHint } from "../src/longStepHint.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

// Fake clock: setInterval callbacks run as time advances, in 1 s steps (the watch ticks every 1 s at 240 s).
function fakeClock() {
  let t0 = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => t0,
    setInterval(fn, ms) { const id = nextId++; timers.set(id, { fn, ms, next: t0 + ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    // Moves time forward in steps and fires due ticks, as a running host would.
    advance(ms, step = 1000) {
      const end = t0 + ms;
      while (t0 < end) {
        t0 = Math.min(end, t0 + step);
        for (const tm of timers.values()) if (t0 >= tm.next) { tm.fn(); tm.next += tm.ms; }
      }
    },
    // Time passes with no tick running (a sleeping laptop).
    jump(ms) { t0 += ms; },
    timerCount: () => timers.size,
  };
}

const STALL = 240_000;
const SEC = 1000;

console.log("=== T1 무진행 정지 ===");
await t("T1 진행 없이 설정 시간이 지나면 정지로 끊긴다 (그 전에는 끊기지 않는다)", () => {
  const clock = fakeClock();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => false, clock });
  clock.advance(STALL - 5 * SEC);
  assert.equal(w.stalled(), false, "not stalled before the budget");
  clock.advance(10 * SEC);
  assert.equal(w.stalled(), true, "stalled after the budget");
  assert.equal(w.signal.aborted, true);
  assert.ok(w.signal.reason instanceof CoachStallError, "reason is a CoachStallError");
  w.dispose();
});

console.log("=== T2 긴 생각 stream 은 정지가 아니다 ===");
await t("T2 진행 줄이 간격 안에 오면 30분 동안에도 끊기지 않는다", () => {
  const clock = fakeClock();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => false, clock });
  for (let i = 0; i < 30; i++) { clock.advance(60 * SEC); w.progress(); }
  assert.equal(w.stalled(), false);
  assert.equal(w.signal.aborted, false);
  w.dispose();
});

console.log("=== T3 사람 대기 중에는 정지가 아니다 ===");
await t("T3 대화상자 대기(track) 중 20분이 지나도 끊기지 않는다", () => {
  const clock = fakeClock();
  const wait = createHumanWait();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => wait.active(), clock });
  let release;
  wait.track(() => new Promise((resolve) => { release = resolve; }));
  clock.advance(20 * 60 * SEC);
  assert.equal(w.stalled(), false, "a pending human answer pauses the stall judgment");
  release();
  w.dispose();
});

console.log("=== T4 대기가 끝난 뒤 유예 ===");
await t("T4 대기가 끝난 뒤 정지는 바로 나지 않고, 대기 종료 뒤 설정 시간 한 번만큼 유예된다", () => {
  const clock = fakeClock();
  let paused = true;
  const w = createStallWatch({ stallMs: STALL, isPaused: () => paused, clock });
  clock.advance(10 * 60 * SEC);
  paused = false;
  clock.advance(STALL - 5 * SEC);
  assert.equal(w.stalled(), false, "not stalled inside the grace budget after the pause ends");
  clock.advance(10 * SEC);
  assert.equal(w.stalled(), true, "stalled once one budget has passed since the pause ended");
  w.dispose();
});

console.log("=== T5 도구 실행 중 ===");
await t("T5 도구 실행 중에는 마지막 도구 시작 뒤 한 예산 동안 끊기지 않는다", () => {
  const clock = fakeClock();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => false, clock });
  w.toolStarted();
  clock.advance(STALL - 10 * SEC);
  assert.equal(w.stalled(), false);
  w.dispose();
});
await t("T5b 도구가 끝나지 않으면 시작 뒤 약 두 예산(창 + 유예) 안에 정지로 끊긴다 (한계)", () => {
  const clock = fakeClock();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => false, clock });
  w.toolStarted();
  clock.advance(2 * STALL - 30 * SEC);
  assert.equal(w.stalled(), false, "still inside the window plus grace");
  clock.advance(40 * SEC);
  assert.equal(w.stalled(), true, "a tool that never ends is stopped at about two budgets");
  w.dispose();
});
await t("T5c 도구가 끝나면 진행으로 세어 다시 설정 시간을 준다", () => {
  const clock = fakeClock();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => false, clock });
  w.toolStarted();
  clock.advance(60 * SEC);
  w.toolEnded();
  clock.advance(STALL - 10 * SEC);
  assert.equal(w.stalled(), false, "the tool's end counts as progress");
  w.dispose();
});

console.log("=== T6 설정 0 = 끔 ===");
await t("T6 설정 0 이면 30분 무진행에도 끊기지 않는다 (타이머도 없다)", () => {
  const clock = fakeClock();
  const w = createStallWatch({ stallMs: 0, isPaused: () => false, clock });
  clock.advance(30 * 60 * SEC);
  assert.equal(w.stalled(), false);
  assert.equal(w.signal.aborted, false);
  assert.equal(clock.timerCount(), 0, "no tick is scheduled when the watch is off");
  w.dispose();
});
await t("T6b 설정 값은 provider 에서 읽고, 잘못된 값은 기본 240000 으로 본다", () => {
  setLocalStallTimeoutProvider(() => 0);
  assert.equal(localStallTimeoutMs(), 0);
  setLocalStallTimeoutProvider(() => 90000);
  assert.equal(localStallTimeoutMs(), 90000);
  setLocalStallTimeoutProvider(() => undefined);
  assert.equal(localStallTimeoutMs(), LOCAL_DEFAULT_STALL_MS);
  setLocalStallTimeoutProvider(() => -5);
  assert.equal(localStallTimeoutMs(), LOCAL_DEFAULT_STALL_MS);
  setLocalStallTimeoutProvider(() => LOCAL_DEFAULT_STALL_MS);
});

console.log("=== T8 절전 복귀 ===");
await t("T8 시계가 크게 뛰면(절전) 그 틱에서 끊김을 판정하지 않는다", () => {
  const clock = fakeClock();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => false, clock });
  clock.advance(10 * SEC);
  clock.jump(5 * 60 * SEC); // the laptop slept: no ticks ran
  clock.advance(1 * SEC);   // the first tick after wake
  assert.equal(w.stalled(), false, "no judgment on the wake tick");
  clock.advance(STALL - 10 * SEC);
  assert.equal(w.stalled(), false, "the wake refreshed the clock");
  w.dispose();
});
await t("T8 음성 대조: 같은 정지를 점프 없이 주면 끊긴다", () => {
  const clock = fakeClock();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => false, clock });
  clock.advance(STALL + 5 * SEC);
  assert.equal(w.stalled(), true, "without a jump the same silence is a stall");
  w.dispose();
});

console.log("=== T9 정지 문구와 사유 ===");
await t("T9 정지 사유의 문구는 SDK 와 같은 stallNotice 다", () => {
  const clock = fakeClock();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => false, clock });
  clock.advance(STALL + 5 * SEC);
  assert.equal(w.signal.reason.message, stallNotice());
  assert.equal(w.signal.reason.name, "CoachStallError");
  w.dispose();
});

console.log("=== T10 설정 0 이어도 긴 단계 안내는 계산된다 ===");
await t("T10 안내는 턴을 끊지 않는다: 설정 0 에서 20초 무진행이면 안내 문구가 나온다", () => {
  const hint = idleTurnHint({ since: 0, now: 25 * SEC, streaming: true, stalled: false, approvalPending: false, step: null });
  assert.ok(hint && hint.text.includes("평소보다 오래 걸리고 있어요"), "hint shown");
});

console.log("=== 호환: 승인 대기 (새 Studio + 옛 Chalk) ===");
await t("C1 Chalk 신호가 없어도 Studio 가 여는 승인 대기는 정지 판정을 멈춘다", () => {
  const clock = fakeClock();
  const wait = createHumanWait();
  const w = createStallWatch({ stallMs: STALL, isPaused: () => wait.active(), clock });
  let release;
  wait.track(() => new Promise((resolve) => { release = resolve; }));
  clock.advance(15 * 60 * SEC);
  assert.equal(w.stalled(), false);
  release();
  w.dispose();
});

console.log("=== 구조: 로컬 턴이 고정 예산을 쓰지 않는다 ===");
await t("S1 index.ts 에 localTurnBudget 호출이 없고 createStallWatch 를 쓴다", () => {
  const src = readFileSync(new URL("../src/localRuntime/index.ts", import.meta.url), "utf8");
  assert.ok(!/localTurnBudget\(/.test(src), "no fixed budget call in the local runner");
  assert.ok(/createStallWatch\(/.test(src), "the stall watch is used");
});

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall local-stall-watch checks passed");
