// CGP-VOICE-R-007 / CGP-VOICE-D-006 (REQ-CGPV-08 / DES-CGPV-08, VO-18 / VO-20): while the agent works,
// the voice panel's status line shows, announces and reads aloud only events that actually occurred.
//
// Rendered for real on the minimal DOM: the real VoicePanel driven by the real popup and session
// reducers, inside a served-voice VoiceProvider (read-aloud served, disclosure read) with a scripted
// synthesizer, next to a real answer read-aloud button. Host events go through the real chat channel
// (window `message` events read by onHostMessage), in the shapes chatPanelProvider posts:
// streamStart, streamChunk, toolLog (tool_use id, running -> done/error), approvalWait, streamEnd,
// streamStopped, streamError.
//   - a tool start is shown with the chat header's run-state word and the host's label, announced
//     once and read once; a step update of the same call is shown but neither announced nor read;
//   - 끝났어요 only after that call's own result event; a call with no result is never called done;
//   - negative control: prose that claims "파일을 저장했어요" with no tool event makes no status;
//   - a tool failure and a failed reading are two different lines (VO-20);
//   - 소리 끄기 holds every reading; an answer the learner is listening to is never cut off;
//   - approvals, other streams, pacing (at most one change per interval), collapse and expand;
//   - voice not served: the line is drawn from the same events but nothing touches the synthesizer.
// Text checks read DOM text and attributes only (no layout), so fonts cannot change a verdict.
// Run: node scripts/run-tsx-tests.mjs voice-agent-status
import { act as reactAct, createElement, useState } from "react";
import { click, document, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { VoiceProvider, useVoiceController } from "../webview-ui/src/VoiceProvider";
import { ReadAloudButton, SpeechEnvContext, useServedReadAloud } from "../webview-ui/src/ReadAloudButton";
import { VoicePanel } from "../webview-ui/src/VoicePanel";
import { initialPopupState, meterView, popupTransition, type PopupEvent, type PopupState } from "../src/voicePopupHelpers";
import { initialVoiceSession, voiceTransition, type VoiceSession } from "../src/voiceSessionHelpers";
import { windowOutputMute } from "../src/voiceOutputMute";
import { agentStatusTransition, initialAgentStatus } from "../src/voiceAgentStatus";

type El = { tagName?: string; textContent: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(f: (e: El) => boolean): El[] };
const act: (fn: () => unknown) => Promise<void> = (reactAct as unknown as (fn: () => unknown) => Promise<void>);
const g = globalThis as unknown as { __posted: Array<Record<string, unknown>>; window: { dispatchEvent(e: unknown): void } };
const V1 = "hps-voice-policy/1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const host = mountPoint() as unknown as El;
const root = createRoot(host as unknown as HTMLElement);
const all = (f: (e: El) => boolean) => host.findAll(f);
const cls = (e: El, c: string) => (e.getAttribute("class") ?? "").split(/\s+/).includes(c);
const lineEl = () => all((e) => cls(e, "hps-voice-agent-status"))[0];
const line = () => all((e) => cls(e, "hps-voice-agent-status-text"))[0]?.textContent ?? null;
const lineKind = () => lineEl()?.getAttribute("data-agent-status") ?? null;
const announcer = () => all((e) => e.hasAttribute("data-agent-status-announcer"))[0]?.textContent ?? null;
const speechFailedLine = () => all((e) => cls(e, "hps-voice-agent-speech-failed")).map((e) => e.textContent);
const everything = () => host.textContent;
const byLabel = (label: string) => all((e) => e.tagName === "BUTTON" && e.getAttribute("aria-label") === label)[0];
const listen = () => all((e) => e.tagName === "BUTTON" && cls(e, "hps-voice-listen"))[0];
const press = (b: El) => act(() => click(b as never));
const hostSays = (data: Record<string, unknown>) => act(() => { g.window.dispatchEvent({ type: "message", data, bubbles: false }); });

// ---- the host's own event shapes (chatPanelProvider.postToolLog and the stream messages) ----
const S = "stream-1";
const start = (streamId = S) => hostSays({ type: "streamStart", streamId, messageId: `m-${streamId}` });
const chunk = (delta: string, streamId = S) => hostSays({ type: "streamChunk", streamId, delta });
const tool = (id: string, state: "running" | "done" | "error", label = "파일 고치기 index.html", icon = "✍️", streamId = S) =>
  hostSays({ type: "toolLog", streamId, id, icon, label, state, at: Date.now() });
const approval = (waiting: boolean) => hostSays({ type: "approvalWait", waiting });
const end = (failed = false, streamId = S) => hostSays({ type: "streamEnd", streamId, ...(failed ? { failed: true } : {}) });

// ---- a scripted synthesizer ----
interface Utter { text: string; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null }
interface Rig { spoken: Utter[]; cancels: number; voicesAsked: number; session: VoiceSession; popup: PopupState }
let rig: Rig;
const speechEnv = () => ({
  synth: {
    speak: (u: Utter) => { rig.spoken.push(u); }, cancel: () => { rig.cancels++; },
    getVoices: () => { rig.voicesAsked++; return [{ lang: "ko-KR", localService: true, name: "Yuna" }]; },
  },
  makeUtterance: (text: string) => ({ text, lang: "", rate: 1, voice: null, onend: null, onerror: null }),
});
const spokenTexts = () => rig.spoken.map((u) => u.text);

let interval = 0;
function Owner() {
  const listening = voiceTransition(voiceTransition(initialVoiceSession(), { type: "start" }), { type: "transport_ready" });
  const [state, setState] = useState<{ popup: PopupState; session: VoiceSession }>({ popup: popupTransition(initialPopupState(), { type: "open" }).state, session: listening });
  rig.session = state.session; rig.popup = state.popup;
  // The future owner's wiring: the hub only where read-aloud is served.
  const statusSpeech = useServedReadAloud();
  const dispatch = (e: PopupEvent) => setState((s) => {
    const step = popupTransition(s.popup, e);
    let session = s.session;
    for (const v of step.voiceEvents) session = voiceTransition(session, v);
    return { popup: step.state, session };
  });
  return createElement(VoicePanel, {
    coachName: "발표 도우미", session: state.session, popup: state.popup,
    meter: meterView(state.session, null), reference: null, info: [], finalTranscript: null, partialTranscript: null, failure: null,
    onMinimize: () => dispatch({ type: "minimize" }), onExpand: () => dispatch({ type: "expand" }),
    onToggleMute: () => dispatch({ type: state.popup.userMuteIntent ? "user_unmute" : "user_mute" }),
    onResume: () => {}, onStopSpeaking: () => {}, onDismiss: () => dispatch({ type: "dismissed" }), onRetry: () => {},
    cornerStore: { read: () => null, write: () => {} }, agentStatusIntervalMs: interval, statusSpeech,
  });
}

function Harness({ served }: { served: boolean }) {
  const profile = served ? { profile_id: "p", voice: { dictation: true, read_aloud: true, policy_version: V1 } } : { profile_id: "p" };
  // A seat never served (a separate scope: a seat once served in this window reads as class-off instead).
  const controller = useVoiceController(profile as never, served ? "s1" : "never-served", true);
  return createElement(VoiceProvider, { controller },
    createElement(SpeechEnvContext.Provider, { value: speechEnv as never },
      createElement("div", { className: "frame" },
        createElement(Owner),
        createElement("div", { className: "answer-actions" }, createElement(ReadAloudButton, { answerId: "a1", content: "답을 읽어요. 두 번째 문장이에요." })))));
}

async function mount({ served = true, intervalMs = 0 } = {}) {
  // Unmount the previous case first: its cleanup (stopping its own reading) must not count against this one.
  await act(() => root.render(null));
  rig = { spoken: [], cancels: 0, voicesAsked: 0, session: initialVoiceSession(), popup: initialPopupState() };
  interval = intervalMs;
  g.__posted.length = 0;
  windowOutputMute.set(false);
  await act(() => root.render(createElement(Harness, { key: Math.random(), served })));
  if (served) await hostSays({ type: "voiceDisclosureState", acknowledged: [V1] });
}

// ============================================================================================
t("a tool start: run-state word + the host's label, announced once and read once", async () => {
  await mount();
  await start();
  eq(line(), "생각 중", "an open stream with no tool is the header's 생각 중");
  eq([announcer(), spokenTexts()], ["", []], "an open stream is shown, not announced or read");
  await tool("toolu_1", "running");
  eq(line(), "만드는 중 · 파일 고치기 index.html", "the line");
  eq(lineKind(), "creating");
  eq(announcer(), "만드는 중 · 파일 고치기 index.html", "announced");
  eq(spokenTexts(), ["만드는 중 · 파일 고치기 index.html"], "read once");
  ok(!everything().includes("끝났어요"), "nothing is called finished before its result");
  eq(lineEl().getAttribute("data-hp-tooltip"), "만드는 중 · 파일 고치기 index.html", "the full text is in the tooltip");
});

t("a step update of the same call is shown but neither announced nor read again", async () => {
  await mount();
  await start();
  await tool("toolu_1", "running", "파일 고치기 index.html");
  await tool("toolu_1", "running", "파일 고치기 style.css");
  eq(line(), "만드는 중 · 파일 고치기 style.css", "the words follow the host");
  eq(announcer(), "만드는 중 · 파일 고치기 index.html", "no second announcement");
  eq(rig.spoken.length, 1, "no second reading");
});

t("끝났어요 only after the call's own result event", async () => {
  await mount();
  await start();
  await tool("toolu_1", "running");
  await tool("toolu_2", "running", "파일 읽기 notes.md", "📖");
  eq(line(), "찾는 중 · 파일 읽기 notes.md", "the newest call; a read is 찾는 중");
  ok(!everything().includes("끝났어요"), "two calls running, none finished");
  await tool("toolu_1", "done");
  eq(line(), "파일 고치기 index.html 끝났어요", "the finished call is the one named");
  eq(announcer(), "파일 고치기 index.html 끝났어요", "announced");
  eq(spokenTexts().at(-1), "파일 고치기 index.html 끝났어요", "read");
  eq(lineEl().getAttribute("data-agent-status"), "done");
});

t("negative control: prose claiming 파일을 저장했어요 with no tool event makes no status", async () => {
  await mount();
  await start();
  await chunk("파일을 저장했어요. ");
  await chunk("index.html 을 만들었고 끝났어요!");
  eq(line(), "생각 중", "the prose changed nothing");
  eq(announcer(), "", "nothing announced");
  eq(spokenTexts(), [], "nothing read");
  await end();
  eq(line(), "준비됨", "the turn ended: the header's 준비됨, nothing claimed");
  eq(announcer(), "", "still nothing announced");
  eq(spokenTexts(), [], "still nothing read");
  const statusTexts = [line(), announcer()].join(" ");
  ok(!/저장|만들었|끝났어요/.test(statusTexts), `no status repeats the prose: ${statusTexts}`);
});

t("a call with no result event is never called finished, even when the turn ends", async () => {
  await mount();
  await start();
  await tool("toolu_1", "running");
  await end();
  eq(line(), "준비됨", "the unanswered call's line is dropped");
  ok(!everything().includes("끝났어요"), "never 끝났어요");
  eq(spokenTexts(), ["만드는 중 · 파일 고치기 index.html"], "only the start was read");
});

t("a tool failure and a failed reading are two different lines (VO-20)", async () => {
  await mount();
  await start();
  await tool("toolu_1", "running");
  await tool("toolu_1", "error");
  eq(line(), "문제가 생겼어요 · 파일 고치기 index.html", "the tool failure, in the header's words");
  eq(lineKind(), "error");
  eq(speechFailedLine(), [], "no reading failed yet");
  // The engine fails on the failure's own reading.
  const reading = rig.spoken.at(-1)!;
  await act(() => reading.onerror?.({ error: "synthesis-failed" }));
  eq(speechFailedLine(), ["작업 상태를 소리로 읽지 못했어요. 화면의 글로 볼 수 있어요."], "the failed reading is said on its own");
  eq(line(), "문제가 생겼어요 · 파일 고치기 index.html", "the tool line is unchanged");
  // And the other way round: a failed reading of a success never turns the success into a failure.
  await tool("toolu_2", "running", "파일 고치기 app.js");
  await act(() => rig.spoken.at(-1)!.onerror?.({ error: "synthesis-failed" }));
  await tool("toolu_2", "done", "파일 고치기 app.js");
  eq([line(), lineKind()], ["파일 고치기 app.js 끝났어요", "done"], "the tool result is still a success");
});

t("소리 끄기 holds every reading; the line and the announcement still follow events", async () => {
  await mount();
  await start();
  await press(byLabel("소리 끄기"));
  await tool("toolu_1", "running");
  eq(line(), "만드는 중 · 파일 고치기 index.html", "shown");
  eq(announcer(), "만드는 중 · 파일 고치기 index.html", "announced");
  eq(rig.spoken.length, 0, "not read while sound is off");
  await tool("toolu_1", "done");
  eq(rig.spoken.length, 0, "the finish is not read either");
  await press(byLabel("소리 끄기"));
  await tool("toolu_2", "running", "파일 고치기 app.js");
  eq(spokenTexts(), ["만드는 중 · 파일 고치기 app.js"], "sound on again: the next start is read");
});

t("소리 끄기 during a status reading stops it in the same press", async () => {
  await mount();
  await start();
  await tool("toolu_1", "running");
  const cancels = rig.cancels;
  await press(byLabel("소리 끄기"));
  ok(rig.cancels > cancels, "the reading was cancelled");
});

t("an answer the learner is listening to is never cut off by a status", async () => {
  await mount();
  await press(listen());
  eq(listen().getAttribute("aria-pressed"), "true", "the answer is being read");
  const before = rig.spoken.length, cancels = rig.cancels;
  await start();
  await tool("toolu_1", "running");
  eq(announcer(), "만드는 중 · 파일 고치기 index.html", "still announced");
  eq([rig.spoken.length, rig.cancels, listen().getAttribute("aria-pressed")], [before, cancels, "true"], "the answer keeps playing; no status reading");
});

t("approval waiting: 확인이 필요해요, held until answered", async () => {
  await mount();
  await start();
  await tool("toolu_1", "running");
  await approval(true);
  eq([line(), lineKind()], ["확인이 필요해요", "approval"], "the header's approval words");
  eq(announcer(), "확인이 필요해요", "announced");
  await tool("toolu_2", "running", "명령 실행", "⌨️");
  eq(line(), "확인이 필요해요", "a new event does not hide the open question");
  await approval(false);
  eq(line(), "생각 중 · 명령 실행", "back to the newest running call (a command is not claimed as making)");
});

t("events of another stream are ignored", async () => {
  await mount();
  await start();
  await tool("toolu_x", "running", "파일 고치기 other.html", "✍️", "stream-old");
  eq(line(), "생각 중", "another turn's tool line is not this turn's status");
  eq(rig.spoken.length, 0);
});

t("stop and errors: 멈춤 and 문제가 생겼어요, running calls never called finished", async () => {
  await mount();
  await start();
  await tool("toolu_1", "running");
  await hostSays({ type: "streamStopped", streamId: S });
  eq([line(), lineKind()], ["멈춤", "paused"], "stopped");
  ok(!everything().includes("끝났어요"), "a stop is not a finish (VO-18)");
  await start("stream-2");
  await hostSays({ type: "streamError", streamId: "stream-2", error: "x" });
  eq([line(), lineKind()], ["문제가 생겼어요", "error"], "a turn error");
  await start("stream-3");
  await end(true, "stream-3");
  eq([line(), lineKind()], ["문제가 생겼어요", "error"], "a failed turn");
});

t("pacing: the line changes at most once per interval, the newest event wins", async () => {
  await mount({ intervalMs: 300 });
  await start();
  await tool("toolu_1", "running");
  const shownAt = Date.now();
  eq(line(), "생각 중", "the first change shows at once; the second waits");
  await tool("toolu_1", "done");
  eq(line(), "생각 중", "still within the interval");
  await act(() => sleep(400));
  ok(Date.now() - shownAt >= 300, "waited the interval");
  eq(line(), "파일 고치기 index.html 끝났어요", "then the newest event is shown");
  eq(announcer(), "파일 고치기 index.html 끝났어요", "and announced");
});

t("collapse and expand neither repeat an announcement nor read again", async () => {
  await mount();
  await start();
  await tool("toolu_1", "running");
  const spoken = rig.spoken.length;
  await press(byLabel("음성 대화 축소"));
  eq(rig.popup.presentation, "compact");
  eq(announcer(), "만드는 중 · 파일 고치기 index.html", "the compact control keeps the announcer");
  await press(all((e) => e.tagName === "BUTTON" && e.textContent.trim() === "펼치기")[0]);
  eq(line(), "만드는 중 · 파일 고치기 index.html", "expanded again, same line");
  eq(rig.spoken.length, spoken, "no second reading");
});

t("voice not served: nothing touches the synthesizer", async () => {
  await mount({ served: false });
  await start();
  await tool("toolu_1", "running");
  await tool("toolu_1", "done");
  eq([rig.spoken.length, rig.cancels, rig.voicesAsked], [0, 0, 0], "no reading, no cancel, no voice lookup");
  eq(listen(), undefined, "and no read-aloud button");
});

t("reducer: unrelated and malformed messages leave the state as it is", async () => {
  let s = agentStatusTransition(initialAgentStatus(), { type: "streamStart", streamId: S });
  const before = s;
  for (const m of [{ type: "streamChunk", streamId: S, delta: "파일을 저장했어요" }, { type: "taskActivityFact", streamId: S }, { type: "toolLog", streamId: S, id: "", icon: "✍️", label: "x", state: "done" }, { type: "approvalWait", waiting: false }])
    s = agentStatusTransition(s, m as never);
  ok(s === before, "the same state object");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  void document;
  await act(() => root.unmount());
  if (fail) { console.error(`${fail} failed`); process.exit(1); }
  console.log(`voice-agent-status: ${tests.length} passed`);
  process.exit(0);
})();
