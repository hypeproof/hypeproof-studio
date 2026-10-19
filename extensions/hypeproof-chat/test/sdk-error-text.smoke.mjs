// Raw SDK/English error text stays out of the coach bubble and the banner (TUX-CHAT-14, REQ-M44).
//
// The recorded scenarios replay the exact message types the vendored Agent SDK 0.3.299 produced against
// the Service's real 429/403 bodies (test/fixtures/sdk-gateway-errors.json). Before the fix the learner read
// "API Error: Request rejected (429) · …" in the coach's bubble and
// "Claude Code returned an error result: …" in the banner. The stream goes through the App's own
// consumeSdkStream and the banner text through the same order handleSendError uses
// (passSpentNotice first, then sdkErrorDisplayText).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  consumeSdkStream,
  sdkErrorDisplayText,
  sdkCliErrorLine,
  SDK_ERROR_GENERIC_FRIENDLY,
} from "../src/sdkCoachHelpers.ts";
import { passSpentNotice, PASS_SPENT_FRIENDLY } from "../src/passPurchase.ts";
import { bindingRefusalCode } from "../src/lessonBinding.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, "fixtures/sdk-gateway-errors.json"), "utf8"));

const RAW = /API Error|Failed to authenticate|Claude Code returned an error result|Claude Code process exited|Request rejected/;
const count = (hay, needle) => hay.split(needle).length - 1;

/** The SDK message a recorded rawTypes row summarises, in the shape the SDK emits. */
function toSdkMessage(row, i) {
  if (row.type === "system") return { type: "system", subtype: row.subtype, ...(row.error ? { error: row.error } : {}), ...(row.error_status !== undefined ? { error_status: row.error_status } : {}) };
  if (row.type === "assistant") return { type: "assistant", ...(row.error ? { error: row.error } : {}), message: { id: `m${i}`, role: "assistant", model: row.model ?? "claude-sonnet-4-5", content: [{ type: "text", text: row.text }] } };
  if (row.type === "result") return { type: "result", subtype: row.subtype, is_error: row.is_error === true, result: "" };
  return { type: row.type };
}

/** One turn: the stream, then (like the real SDK) optionally a throw after the last message. */
async function turn(messages, { throwAfter = null } = {}) {
  const deltas = [];
  let aborted = 0;
  const stream = (async function* () {
    for (const m of messages) yield m;
    if (throwAfter) throw new Error(throwAfter);
  })();
  let error = null;
  let end = null;
  try {
    end = await consumeSdkStream(stream, {
      isAborted: () => false,
      makeAbortError: () => Object.assign(new Error("aborted"), { name: "AbortError" }),
      abortQuery: () => { aborted += 1; },
      makeFatalAuthError: (status) => Object.assign(new Error(`fatal ${status}`), { status }),
      onDelta: (d) => deltas.push(d),
      stallMs: 0,
    });
  } catch (err) {
    error = err;
  }
  const bubble = deltas.join("");
  // handleSendError order: a spent pass first, then the generic banner text.
  const banner = error ? passSpentNotice(error) ?? sdkErrorDisplayText(error) : "";
  return { bubble, banner, error, end, aborted };
}

// ── Negative control for the detector itself: the recorded (pre-fix) screens DO contain the raw text. ──
for (const [name, s] of Object.entries(fixture.scenarios)) {
  assert.match(s.recordedBubble, RAW, `${name}: the recorded bubble is a known-bad sample the detector must flag`);
  assert.match(s.recordedBanner, RAW, `${name}: the recorded banner is a known-bad sample the detector must flag`);
}

// ── Recorded 429/403 scenarios, replayed. ──
for (const [name, s] of Object.entries(fixture.scenarios)) {
  const sentence = s.serviceBody.error.message;
  const messages = s.rawTypes.map(toSdkMessage);
  for (const sdkThrows of [true, false]) {
    const label = `${name} (${sdkThrows ? "SDK throws after the result, as recorded" : "SDK ends the stream quietly"})`;
    const r = await turn(messages, { throwAfter: sdkThrows ? s.sdkThrew : null });
    assert.doesNotMatch(r.bubble, RAW, `${label}: no raw SDK text in the bubble`);
    assert.doesNotMatch(r.banner, RAW, `${label}: no raw SDK text in the banner`);
    assert.ok(r.error, `${label}: a refused turn never ends silently — it reaches the banner`);
    assert.equal(r.bubble, "", `${label}: the coach bubble does not speak the gateway's refusal`);
    assert.equal(r.error.status, s.serviceStatus, `${label}: the turn keeps the gateway's status for spool/ops`);
    // Classifiers still read the SDK's own wording (the [hps:…] tag and the pass sentence live in the message).
    assert.match(r.error.message, /^Claude Code returned an error result: /, `${label}: the error message keeps the SDK's form for the classifiers`);
    const shown = r.bubble + "\n" + r.banner;
    assert.equal(count(shown, sentence), 1, `${label}: the Service's Korean sentence is shown exactly once`);
    assert.equal(r.banner, sentence, `${label}: the banner is the Service's sentence`);
  }
}

// ── Synthesized shapes for the other statuses the acceptance names (401, 409) and the CLI variants. ──
const synthetic = (text, error) => ({ type: "assistant", error, message: { id: "s", model: "<synthetic>", content: [{ type: "text", text }] } });
const failedResult = { type: "result", subtype: "success", is_error: true, result: "" };
{
  const sentence = "이 참여 코드는 더 이상 쓸 수 없습니다. 새 코드를 받아 다시 연결해 주세요.";
  const r = await turn([synthetic(`Failed to authenticate. API Error: 401 ${sentence}`, "authentication_failed"), failedResult]);
  assert.equal(r.banner, sentence, "401 without an api_retry: the Service's sentence");
  assert.equal(r.error.status, 401);
  assert.equal(r.bubble, "");
}
{
  const sentence = "체험을 시작하려면 최신 Studio가 필요합니다.";
  const body = JSON.stringify({ error: { code: "trial_requires_sdk", message: sentence } });
  const r = await turn([synthetic(`API Error: 409 ${body}`, "invalid_request"), failedResult], { throwAfter: `Claude Code returned an error result: API Error: 409 ${body}` });
  assert.equal(r.banner, sentence, "409 whose body the CLI did not unwrap: the JSON's message, not the JSON");
  assert.equal(r.error.status, 409);
}
{
  // A model answer that only carries "<synthetic>" without `error` and without an API-error line is not hidden.
  assert.equal(sdkCliErrorLine(synthetic("No response requested.", undefined)), null);
  assert.equal(sdkCliErrorLine(synthetic("API Error: 500 boom", undefined)), "API Error: 500 boom");
  assert.equal(sdkCliErrorLine({ type: "assistant", error: "rate_limit", message: { content: [{ type: "text", text: "API Error: 429" }] } }), "API Error: 429");
}
{
  // No human sentence at all (provider 5xx through the gateway, then the CLI exits): Korean copy, no English.
  const r = await turn([{ type: "system", subtype: "api_retry", error_status: 502 }, synthetic("API Error: 502 upstream error (status 500).", "server_error")], { throwAfter: "Claude Code process exited with code 1" });
  assert.doesNotMatch(r.banner + r.bubble, RAW, "5xx without a Service sentence: no raw text");
  assert.match(r.banner, /AI 서비스 오류로 응답을 받지 못했습니다.*\(502\)/, "5xx keeps the existing provider-error copy");
  assert.equal(r.error.status, 502);
}
{
  const err = Object.assign(new Error("Claude Code returned an error result: API Error: 400 bad request"), {});
  assert.equal(sdkErrorDisplayText(err), SDK_ERROR_GENERIC_FRIENDLY, "an English-only refusal falls back to the generic Korean line");
  assert.doesNotMatch(SDK_ERROR_GENERIC_FRIENDLY, RAW);
}
{
  // The Service's [hps:…] tag is for the binding classifier, never for the learner.
  const err = new Error("Claude Code returned an error result: API Error: 403 수업 설정이 바뀌었습니다. [hps:lesson_binding_stale]");
  assert.equal(bindingRefusalCode(err), "lesson_binding_stale", "the classifier still finds the tag");
  assert.equal(sdkErrorDisplayText(err), "수업 설정이 바뀌었습니다.");
}
{
  // A bought pass that is spent still gets the pass copy first (REQ-L12 ⑪), from a recorded-shape stream.
  const sentence = "이용권의 AI 요청 횟수를 모두 썼습니다.";
  const r = await turn([synthetic(`API Error: Request rejected (429) · ${sentence}`, "rate_limit"), failedResult]);
  assert.equal(r.banner, PASS_SPENT_FRIENDLY);
  assert.equal(count(r.bubble + r.banner, sentence), 0, "the pass copy replaces the raw sentence");
}

// ── Positive controls: normal turns render exactly as before. ──
{
  const r = await turn([
    { type: "system", subtype: "init" },
    { type: "assistant", message: { id: "a", model: "claude-sonnet-4-5", content: [{ type: "text", text: "안녕하세요! 무엇을 만들어 볼까요?" }] } },
    { type: "result", subtype: "success", is_error: false },
  ]);
  assert.equal(r.error, null);
  assert.equal(r.bubble, "안녕하세요! 무엇을 만들어 볼까요?", "a normal assistant message still renders verbatim");
  assert.deepEqual(r.end, { failed: false });
}
{
  // The coach explaining an API error in its own words is an answer, not a refusal.
  const text = "`API Error: 429` 는 요청이 너무 많다는 뜻이에요.";
  const r = await turn([{ type: "assistant", message: { id: "a", model: "claude-sonnet-4-5", content: [{ type: "text", text }] } }, { type: "result", subtype: "success", is_error: false }]);
  assert.equal(r.bubble, text);
  assert.equal(r.error, null);
}
{
  // A refusal that the SDK retried past and then answered is not this turn's failure.
  const r = await turn([
    synthetic("API Error: 429", "rate_limit"),
    { type: "system", subtype: "api_retry", error_status: 429, error: "rate_limit" },
    { type: "assistant", message: { id: "a", model: "claude-sonnet-4-5", content: [{ type: "text", text: "다시 연결됐어요." }] } },
    { type: "result", subtype: "success", is_error: false },
  ]);
  assert.equal(r.error, null);
  assert.equal(r.bubble, "다시 연결됐어요.");
}
{
  // A non-gateway terminal error keeps its REQ-M39 notice in the bubble.
  const r = await turn([{ type: "assistant", message: { id: "a", content: [{ type: "text", text: "작업 중" }] } }, { type: "result", subtype: "error_during_execution", is_error: true }]);
  assert.equal(r.error, null);
  assert.match(r.bubble, /^작업 중\n\n---\n\n/, "REQ-M39 notice unchanged");
}
{
  // The App's own Korean errors pass through untouched.
  for (const m of ["요청 한도에 도달해 응답을 받지 못했습니다. 잠시 후 다시 시도하거나 강사에게 체험 한도를 확인해 주세요. (429)", "선택한 모델의 실행 환경을 사용할 수 없습니다."]) {
    assert.equal(sdkErrorDisplayText(new Error(m)), m);
  }
  assert.equal(sdkErrorDisplayText("not an error"), SDK_ERROR_GENERIC_FRIENDLY);
}

// ── Wiring: handleSendError's generic branch uses the display helper, not err.message. ──
{
  const src = fs.readFileSync(path.join(here, "../src/chatPanelProvider.ts"), "utf8");
  const body = src.slice(src.indexOf("private async handleSendError("), src.indexOf("private async handleActionRequest("));
  assert.match(body, /sdkErrorDisplayText\(err[,)]/, "handleSendError builds the banner text with sdkErrorDisplayText");
  assert.doesNotMatch(body, /const reason = err instanceof Error \? err\.message/, "the raw message is no longer the banner text");
}

console.log("sdk-error-text: ok");
