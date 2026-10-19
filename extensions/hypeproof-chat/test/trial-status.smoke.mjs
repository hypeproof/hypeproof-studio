// TUX-SP-13 — what a one-hour trial seat shows about its allowance (CU-13, trial diagnosis C2/U3).
//
// The Service's `trial` block on /v1/profile (`state`, `ends_at`, `request_limit`,
// `requests_used`) is the only source. What is locked here:
//   - the candidate card states the allowance before the activity starts;
//   - the chat header carries a passive remaining line, as of the last profile read;
//   - an exhausted or expired grant is "ended", so the start page draws the ended card
//     instead of "이어서 하기";
//   - a value the Service did not confirm is never shown as 0 or as unlimited (CU-13);
//   - a pass keeps `passSummary` / `passEnd` and is never read as a trial.
//
// Run: node --experimental-strip-types test/trial-status.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { activityDetail, passSummary, passEnd, trialAllowance, trialEnded, trialEndedFacts, trialHeaderLine, trialSummary } =
  await import("../webview-ui/src/activityLabel.ts");

// Local-time fixtures: the copy is in the learner's own clock.
const now = new Date(2026, 9, 18, 14, 30).getTime();
const endsAt = new Date(2026, 9, 18, 15, 20).toISOString();
const fresh = { state: "active", ends_at: endsAt, request_limit: 40, requests_used: 0 };
const nearLimit = { state: "active", ends_at: endsAt, request_limit: 40, requests_used: 37 };
const exhausted = { state: "exhausted", ends_at: endsAt, request_limit: 40, requests_used: 40 };
const expired = { state: "expired", ends_at: new Date(2026, 9, 18, 14, 0).toISOString(), request_limit: 40, requests_used: 12 };
const notStarted = { state: "not_started", ends_at: null, request_limit: 40, requests_used: 0 };

// ── Ended: exhausted / expired, from the Service's state or from the confirmed values ──
assert.equal(trialEnded(fresh, now), null);
assert.equal(trialEnded(nearLimit, now), null);
assert.equal(trialEnded(notStarted, now), null);
assert.equal(trialEnded(exhausted, now), "exhausted");
assert.equal(trialEnded(expired, now), "expired");
assert.equal(trialEnded({ ...fresh, requests_used: 40 }, now), "exhausted", "the count is enough even before the Service relabels the state");
assert.equal(trialEnded(fresh, new Date(2026, 9, 18, 15, 20).getTime()), "expired", "ends_at <= now is the gate's boundary");
assert.equal(trialEnded({ ...exhausted, ends_at: expired.ends_at, state: "expired" }, now), "expired", "expiry is checked first, as the gate does");
assert.equal(trialEnded(undefined, now), null);

// ── Candidate card: the allowance, before "이 활동 시작하기" ──
assert.equal(trialAllowance(fresh, now), "AI 요청 40번 · 오후 3시 20분까지");
assert.equal(trialAllowance(notStarted, now), "AI 요청 40번", "no ends_at yet: no guessed end time");
assert.equal(trialAllowance({ ...fresh, ends_at: new Date(2026, 9, 19, 9, 0).toISOString() }, now), "AI 요청 40번 · 10월 19일 오전 9시까지", "another day names the date");

// ── Connected card and header: what is left ──
assert.equal(trialSummary(fresh, now), "AI 요청 40번 남음 · 오후 3시 20분까지");
assert.equal(trialSummary(nearLimit, now), "AI 요청 3번 남음 · 오후 3시 20분까지");
assert.equal(trialSummary(exhausted, now), null, "an ended trial gets the ended card, not a summary row");
assert.equal(trialHeaderLine(fresh, now), "AI 요청 40번 남음 · 오후 3시 20분까지");
assert.equal(trialHeaderLine(nearLimit, now), "AI 요청 3번 남음 · 오후 3시 20분까지");
assert.equal(trialHeaderLine(notStarted, now), "AI 요청 40번 남음");
assert.equal(trialHeaderLine(exhausted, now), "체험 요청을 모두 사용함");
assert.equal(trialHeaderLine(expired, now), "체험 시간 끝남");

// ── Ended card facts ──
assert.deepEqual(trialEndedFacts(exhausted, now), {
  reason: "exhausted",
  title: "체험이 끝났습니다",
  description: "AI 요청을 모두 사용했습니다. 만든 파일은 작업 폴더에 그대로 있습니다.",
  row: "AI 요청 40번 모두 사용",
});
assert.deepEqual(trialEndedFacts(expired, now), {
  reason: "expired",
  title: "체험이 끝났습니다",
  description: "체험 시간이 끝났습니다. 만든 파일은 작업 폴더에 그대로 있습니다.",
  row: "오후 2시에 끝남",
});
assert.equal(trialEndedFacts(fresh, now), null);

// ── CU-13: an unconfirmed value is not shown, never as 0 or as unlimited ──
for (const bad of [
  null, {}, "x", { ...fresh, request_limit: 0 }, { ...fresh, request_limit: -1 }, { ...fresh, request_limit: Infinity },
  { ...fresh, request_limit: "40" }, { ...fresh, requests_used: undefined }, { ...fresh, requests_used: -2 }, { ...fresh, requests_used: NaN },
]) {
  assert.equal(trialAllowance(bad, now), null, `malformed ${JSON.stringify(bad)}: no allowance`);
  assert.equal(trialSummary(bad, now), null, `malformed ${JSON.stringify(bad)}: no summary`);
  assert.equal(trialHeaderLine(bad, now), null, `malformed ${JSON.stringify(bad)}: no header line`);
  assert.equal(trialEnded(bad, now), null, `malformed ${JSON.stringify(bad)}: not called ended`);
}
assert.equal(trialSummary({ ...fresh, ends_at: "not a date" }, now), "AI 요청 40번 남음", "an unreadable end time is dropped, the count stays");
assert.equal(trialEnded({ ...fresh, ends_at: "not a date" }, now), null);

// ── Negative: a pass keeps its own copy, and a pass is never read as a trial ──
const pass = { request_limit: 200, requests_used: 20, expires_at: new Date(2026, 10, 17).getTime() };
assert.equal(passSummary(pass, now), "AI 요청 180번 남음 · 11월 17일까지");
assert.equal(passEnd(pass), "11월 17일까지");
assert.equal(activityDetail({ pass, trial: exhausted }, now), "11월 17일까지", "pass wins over a stray trial block");
assert.equal(activityDetail({ pass }, now), "11월 17일까지");
assert.equal(activityDetail({ trial: nearLimit }, now), "AI 요청 3번 남음 · 오후 3시 20분까지");
assert.equal(activityDetail({}, now), null, "a classroom seat has no detail");

// ── Wiring: the views read these helpers, not their own copies ──
const start = readFileSync(new URL("../webview-ui/src/StartPage.tsx", import.meta.url), "utf8");
assert.match(start, /trialEndedFacts\(/, "the start page decides the ended card from the helper");
assert.match(start, /trialAllowance\(/, "the candidate card states the allowance");
assert.match(start, /passSummary\(/, "pass seats keep passSummary");
const chat = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
assert.doesNotMatch(chat, /passEnd\(/, "both chat headers go through activityDetail");
assert.equal((chat.match(/activityDetail\(/g) ?? []).length >= 2, true, "naming header and mission header both carry the detail");
assert.match(chat, /trialHeaderLine\(config\.activity\.trial, Date\.now\(\), !!config\.activity\.free\)/, "the personal-workspace chat header (no mission header) carries the trial line");
const trialLineJsx = chat.match(/<span className="hps-trial-left"[^>]*>[\s\S]*?<\/span>\}?<\/span>/)?.[0] ?? "";
assert.ok(trialLineJsx.includes("trialLine.split"), "the trial line is drawn from trialLine");
assert.doesNotMatch(trialLineJsx, /<button|<a |onClick/, "the trial line is plain text, not a button");
const host = readFileSync(new URL("../src/startPage.ts", import.meta.url), "utf8");
assert.match(host, /p\.trial && !p\.pass/, "the start page host forwards the trial block only for a non-pass seat");
const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
assert.match(provider, /refreshTrialStatus\(/, "the header line is re-read after a trial turn");

console.log("trial-status: ok");
