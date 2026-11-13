// CGP-VOICE-R-002 / CGP-VOICE-D-001 (REQ-CGPV-02 / DES-CGPV-02): microphone mute and speaker
// (output) mute are two separate switches, each its own icon button in the big voice panel and in
// the compact control.
//
// Rendered for real on the minimal DOM, with a served-voice profile (VoiceProvider, the disclosure
// already read) and a scripted synthesizer: the real VoicePanel, driven through the real popup and
// session reducers (popupTransition / voiceTransition), next to a real read-aloud button.
//   - each button has its own accessible name, aria-pressed and glyph, in both presentations;
//   - 소리 끄기 stops a reading at once and refuses a new one, and never touches the microphone
//     (no mute event, capture stays open);
//   - 마이크 끄기 closes capture and never touches the speaker switch; a reading keeps going;
//   - both switches survive collapse and expand; each change is announced in its own words;
//   - ending the voice conversation turns sound back on (no dead read-aloud button afterwards).
// Run: node scripts/run-tsx-tests.mjs voice-mute
import { act as reactAct, createElement, useState } from "react";
import { click, document, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { VoiceProvider, useVoiceController } from "../webview-ui/src/VoiceProvider";
import { ReadAloudButton, SpeechEnvContext } from "../webview-ui/src/ReadAloudButton";
import { VoicePanel } from "../webview-ui/src/VoicePanel";
import { initialPopupState, meterView, popupTransition, type PopupEvent, type PopupState } from "../src/voicePopupHelpers";
import { initialVoiceSession, voiceTransition, type VoiceSession } from "../src/voiceSessionHelpers";
import { windowOutputMute } from "../src/voiceOutputMute";

type El = { tagName?: string; textContent: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(f: (e: El) => boolean): El[] };
const act: (fn: () => unknown) => Promise<void> = (reactAct as unknown as (fn: () => unknown) => Promise<void>);
const g = globalThis as unknown as { __posted: Array<Record<string, unknown>>; window: { dispatchEvent(e: unknown): void } };
const V1 = "hps-voice-policy/1";

let fail = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const host = mountPoint() as unknown as El;
const root = createRoot(host as unknown as HTMLElement);
const all = (f: (e: El) => boolean) => host.findAll(f);
const buttons = (label: string) => all((e) => e.tagName === "BUTTON" && e.getAttribute("aria-label") === label);
const one = (label: string) => { const found = buttons(label); eq(found.length, 1, `exactly one "${label}" button`); return found[0]; };
const listen = () => all((e) => e.tagName === "BUTTON" && (e.getAttribute("class") ?? "").includes("hps-voice-listen"))[0];
const glyph = (b: El) => b.findAll((e) => e.tagName === "svg" || e.tagName === "SVG").map((s) => s.getAttribute("data-icon"));
const statusText = () => all((e) => e.getAttribute("role") === "status").map((e) => e.textContent).join(" | ");
const hostSays = (data: Record<string, unknown>) => act(() => { g.window.dispatchEvent({ type: "message", data, bubbles: false }); });

interface Rig { spoken: string[]; cancels: number; muteEvents: string[]; session: VoiceSession; popup: PopupState }
let rig: Rig;
const speechEnv = () => ({
  synth: { speak: (u: { text: string }) => { rig.spoken.push(u.text); }, cancel: () => { rig.cancels++; }, getVoices: () => [{ lang: "ko-KR", localService: true, name: "Yuna" }] },
  makeUtterance: (text: string) => ({ text, lang: "", rate: 1, voice: null, onend: null, onerror: null }),
});

/** The panel's future owner, reduced to the two real reducers: no shortcut around them. */
function Owner() {
  const listening = voiceTransition(voiceTransition(initialVoiceSession(), { type: "start" }), { type: "transport_ready" });
  const [state, setState] = useState<{ popup: PopupState; session: VoiceSession }>({ popup: popupTransition(initialPopupState(), { type: "open" }).state, session: listening });
  rig.session = state.session; rig.popup = state.popup;
  const dispatch = (e: PopupEvent) => setState((s) => {
    const step = popupTransition(s.popup, e);
    let session = s.session;
    for (const v of step.voiceEvents) { rig.muteEvents.push(v.type); session = voiceTransition(session, v); }
    return { popup: step.state, session };
  });
  return createElement(VoicePanel, {
    coachName: "발표 도우미", session: state.session, popup: state.popup,
    meter: meterView(state.session, null), reference: null, info: [], finalTranscript: null, partialTranscript: null, failure: null,
    onMinimize: () => dispatch({ type: "minimize" }), onExpand: () => dispatch({ type: "expand" }),
    onToggleMute: () => dispatch({ type: state.popup.userMuteIntent ? "user_unmute" : "user_mute" }),
    onResume: () => dispatch({ type: "resume_requested" }), onStopSpeaking: () => {}, onDismiss: () => dispatch({ type: "dismissed" }), onRetry: () => {},
    cornerStore: { read: () => null, write: () => {} },
  });
}

function Harness() {
  const controller = useVoiceController({ profile_id: "p", voice: { dictation: true, read_aloud: true, policy_version: V1 } } as never, "s1", true);
  return createElement(VoiceProvider, { controller },
    createElement(SpeechEnvContext.Provider, { value: speechEnv as never },
      createElement("div", { className: "frame" },
        createElement(Owner),
        createElement("div", { className: "answer-actions" }, createElement(ReadAloudButton, { answerId: "a1", content: "안녕하세요. 답이에요. 두 번째 문장이에요." })))));
}

async function mount() {
  rig = { spoken: [], cancels: 0, muteEvents: [], session: initialVoiceSession(), popup: initialPopupState() };
  g.__posted.length = 0;
  windowOutputMute.set(false);
  await act(() => root.render(createElement(Harness, { key: Math.random() })));
  await hostSays({ type: "voiceDisclosureState", acknowledged: [V1] });
}
const press = (b: El) => act(() => click(b as never));

// ============================================================================================
t("big panel: microphone and speaker mute are two distinct icon buttons with their own names", async () => {
  await mount();
  const mic = one("마이크 끄기"), out = one("소리 끄기");
  ok(mic !== out, "two different elements");
  eq([mic.getAttribute("aria-pressed"), out.getAttribute("aria-pressed")], ["false", "false"], "both are toggles, both released");
  eq(glyph(mic), ["mic"], "microphone glyph"); eq(glyph(out), ["speaker"], "speaker glyph");
  eq(buttons("음소거").length + all((e) => e.tagName === "BUTTON" && e.textContent.trim() === "음소거").length, 0, "the single ambiguous 음소거 button is gone");
});

t("compact control: the same two buttons, separately named and pressed", async () => {
  await mount();
  await press(all((e) => e.tagName === "BUTTON" && e.getAttribute("aria-label") === "음성 대화 축소")[0]);
  eq(rig.popup.presentation, "compact", "collapsed");
  const mic = one("마이크 끄기"), out = one("소리 끄기");
  eq([mic.getAttribute("aria-pressed"), out.getAttribute("aria-pressed")], ["false", "false"]);
  eq([glyph(mic), glyph(out)], [["mic"], ["speaker"]], "icon buttons in the compact control too");
});

t("소리 끄기 stops a reading at once and never touches the microphone", async () => {
  await mount();
  await press(listen());
  ok(rig.spoken.length > 0, "the reading started");
  eq(listen().getAttribute("aria-pressed"), "true", "reading");
  const cancelsBefore = rig.cancels;
  const started = Date.now();
  await press(one("소리 끄기"));
  ok(rig.cancels > cancelsBefore, "the synthesizer was cancelled by the press itself");
  ok(Date.now() - started < 200, "silenced within 200 ms");
  eq(one("소리 끄기").getAttribute("aria-pressed"), "true", "speaker switch pressed");
  eq(glyph(one("소리 끄기")), ["speaker-off"], "the speaker glyph is struck through");
  eq(one("마이크 끄기").getAttribute("aria-pressed"), "false", "microphone switch unchanged");
  eq(rig.muteEvents, [], "no mute event reached the session");
  eq([rig.session.state, rig.session.captureOpen], ["listening", true], "capture is still open");
  ok(statusText().includes("소리 꺼짐"), `the change is announced: ${statusText()}`);
  ok(all((e) => e.textContent.trim() === "소리 꺼짐").length > 0, "the off state is written out, not only drawn");
});

t("while sound is off a read-aloud press speaks nothing and says why", async () => {
  await mount();
  await press(one("소리 끄기"));
  const b = listen();
  ok(b.hasAttribute("disabled"), "read-aloud is held while sound is off");
  ok((b.getAttribute("aria-label") ?? "").includes("소리 꺼짐"), `its name says why: ${b.getAttribute("aria-label")}`);
  await press(b);
  eq(rig.spoken.length, 0, "nothing was spoken");
  await press(one("소리 끄기"));
  eq(one("소리 끄기").getAttribute("aria-pressed"), "false", "sound back on");
  await press(listen());
  ok(rig.spoken.length > 0, "read-aloud works again");
});

t("마이크 끄기 closes capture and never touches the speaker switch; a reading keeps going", async () => {
  await mount();
  await press(listen());
  const spoken = rig.spoken.length, cancels = rig.cancels;
  await press(one("마이크 끄기"));
  eq(rig.muteEvents, ["mute"], "one mute reached the session");
  eq([rig.session.state, rig.session.captureOpen], ["muted", false], "capture closed");
  eq(one("마이크 끄기").getAttribute("aria-pressed"), "true", "microphone switch pressed");
  eq(glyph(one("마이크 끄기")), ["mic-off"], "the microphone glyph is struck through");
  eq(one("소리 끄기").getAttribute("aria-pressed"), "false", "speaker switch unchanged");
  eq(windowOutputMute.getMuted(), false, "the output store was not touched");
  eq([rig.cancels, listen().getAttribute("aria-pressed"), rig.spoken.length], [cancels, "true", spoken], "the reading was not stopped");
  ok(statusText().includes("마이크 꺼짐"), `announced in its own words: ${statusText()}`);
  await press(one("마이크 끄기"));
  eq([rig.session.captureOpen, one("마이크 끄기").getAttribute("aria-pressed")], [true, "false"], "and back on");
});

t("both switches survive collapse and expand, independently", async () => {
  await mount();
  await press(one("소리 끄기"));
  await press(all((e) => e.tagName === "BUTTON" && e.getAttribute("aria-label") === "음성 대화 축소")[0]);
  eq([one("마이크 끄기").getAttribute("aria-pressed"), one("소리 끄기").getAttribute("aria-pressed")], ["false", "true"], "compact keeps speaker off, mic on");
  await press(one("마이크 끄기"));
  await press(all((e) => e.tagName === "BUTTON" && e.textContent.trim() === "펼치기")[0]);
  eq(rig.popup.presentation, "expanded", "expanded again");
  eq([one("마이크 끄기").getAttribute("aria-pressed"), one("소리 끄기").getAttribute("aria-pressed")], ["true", "true"], "expanded keeps both");
  await press(one("소리 끄기"));
  eq([one("마이크 끄기").getAttribute("aria-pressed"), one("소리 끄기").getAttribute("aria-pressed")], ["true", "false"], "turning sound on leaves the microphone off");
  eq(rig.session.captureOpen, false, "and capture closed");
});

t("ending the voice conversation turns sound back on", async () => {
  await mount();
  await press(one("소리 끄기"));
  await press(all((e) => e.tagName === "BUTTON" && e.getAttribute("aria-label") === "음성 대화 종료")[0]);
  eq(rig.popup.presentation, "hidden", "the panel closed");
  eq(windowOutputMute.getMuted(), false, "sound is on again");
  ok(!listen().hasAttribute("disabled"), "read-aloud is not left disabled with no switch on screen");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  void document;
  await act(() => root.unmount());
  if (fail) { console.error(`${fail} failed`); process.exit(1); }
  console.log(`voice-mute: ${tests.length} passed`);
  process.exit(0);
})();
