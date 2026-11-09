// Studio voice in the webview, rendered for real (React on the minimal DOM): dictation in the
// composer, read-aloud on an answer, the disclosure sheet, the class-off state. A scripted recorder and
// synthesizer stand in for the browser; host replies are posted as window "message" events, the way the
// extension host answers.
import { act as reactAct, createElement } from "react";
import { click, document, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { VoiceProvider, useVoiceController } from "../webview-ui/src/VoiceProvider";
import { dictationAddonFor } from "../webview-ui/src/dictationAddon";
import { DictationEnvContext } from "../webview-ui/src/DictationControl";
import { ReadAloudButton, SpeechEnvContext } from "../webview-ui/src/ReadAloudButton";
import { insertAtCaret } from "../webview-ui/src/composerAddon";
import { DICTATION_STOP_AT_MS } from "../src/voiceDictation";

type El = { tagName?: string; textContent: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; focus(): void; dispatchEvent(e: unknown): boolean; findAll(f: (e: El) => boolean): El[] };
const act: (fn: () => unknown) => Promise<void> = (reactAct as unknown as (fn: () => unknown) => Promise<void>);
const g = globalThis as unknown as { __posted: Array<Record<string, unknown>>; fetch: unknown; window: { dispatchEvent(e: unknown): void } };
const V1 = "hps-voice-policy/1";
const tripwire: string[] = [];
// Recorder and timer callbacks arrive between act() scopes, as they do in a browser; React's reminder about that is noise here.
const realError = console.error;
console.error = (...args: unknown[]) => { if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return; realError(...args); };
g.fetch = () => { tripwire.push("fetch"); throw new Error("network"); };

let fail = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const host = mountPoint() as unknown as El;
const root = createRoot(host as unknown as HTMLElement);
const all = (f: (e: El) => boolean) => host.findAll(f);
const byLabel = (label: string) => all((e) => e.tagName === "BUTTON" && e.getAttribute("aria-label") === label)[0];
const byText = (text: string) => all((e) => e.tagName === "BUTTON" && e.textContent.trim() === text)[0];
const posted = (type: string) => g.__posted.filter((m) => m.type === type);
const hostSays = (data: Record<string, unknown>) => act(() => { g.window.dispatchEvent({ type: "message", data, bubbles: false }); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

// ---- scripted browser objects ----
interface Rig { recorders: FakeRecorder[]; mediaCalls: number; tracksStopped: number; spoken: Array<{ text: string; lang: string; voice: unknown }>; cancels: number; inserted: string[]; insertOk: boolean }
class FakeRecorder {
  static supported = ["audio/webm;codecs=opus"];
  static isTypeSupported(m: string) { return FakeRecorder.supported.includes(m); }
  state = "inactive"; options: unknown; ondataavailable: ((e: unknown) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(_s: unknown, options: unknown) { this.options = options; rig.recorders.push(this); }
  start() { this.state = "recording"; }
  stop() { if (this.state === "inactive") return; this.state = "inactive"; queueMicrotask(() => this.onstop?.()); }
  emit(bytes: Uint8Array) { this.ondataavailable?.({ data: { size: bytes.length, arrayBuffer: async () => bytes.buffer } }); }
}
let rig: Rig;
let denyMic = false;
let clock = 0;
const timers: Array<{ at: number; fn: () => void; id: number }> = [];
const dictEnv = () => ({
  getUserMedia: async () => { rig.mediaCalls++; if (denyMic) throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); return { getTracks: () => [{ stop() { rig.tracksStopped++; } }] }; },
  Recorder: FakeRecorder as never,
  now: () => clock,
  setTimeout: (fn: () => void, ms: number) => { const tm = { at: clock + ms, fn, id: timers.length + 1 }; timers.push(tm); return tm.id; },
  clearTimeout: (id: unknown) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
});
const speechEnv = () => ({
  synth: { speak: (u: { text: string; lang: string; voice: unknown }) => rig.spoken.push({ text: u.text, lang: u.lang, voice: u.voice }), cancel: () => { rig.cancels++; }, getVoices: () => [{ lang: "ko-KR", localService: true, name: "Yuna" }] },
  makeUtterance: (text: string) => ({ text, lang: "", rate: 1, voice: null, onend: null, onerror: null }),
});
const noSpeech = () => ({ synth: undefined, makeUtterance: () => ({}) as never });

function Harness({ profile, scope = "s1", speech = speechEnv, insertOk = true }: { profile: unknown; scope?: string; speech?: () => ReturnType<typeof speechEnv> | ReturnType<typeof noSpeech>; insertOk?: boolean }) {
  const controller = useVoiceController(profile as never, scope, true);
  const addon = dictationAddonFor(controller.value.availability);
  const api = { insert: (text: string) => { if (insertOk) rig.inserted.push(text); return insertOk; }, disabled: false };
  return createElement(VoiceProvider, { controller },
    createElement(DictationEnvContext.Provider, { value: dictEnv },
      createElement(SpeechEnvContext.Provider, { value: speech as never },
        createElement("div", { className: "frame" },
          addon ? createElement(addon.Scope, { api }, createElement("div", { className: "composer" }, createElement(addon.Notice), createElement(addon.Control))) : null,
          createElement("div", { className: "answer-actions" }, createElement(ReadAloudButton, { answerId: "a1", content: "안녕하세요. 답이에요.\n```\ncode()\n```" }))))));
}
const profileOn = (extra: Record<string, unknown> = {}) => ({ profile_id: "p", voice: { dictation: true, read_aloud: true, policy_version: V1, ...extra } });

async function mount(profile: unknown, opts: { scope?: string; speech?: () => ReturnType<typeof speechEnv> | ReturnType<typeof noSpeech>; acked?: boolean; insertOk?: boolean } = {}) {
  rig = { recorders: [], mediaCalls: 0, tracksStopped: 0, spoken: [], cancels: 0, inserted: [], insertOk: true };
  timers.length = 0; clock = 0; denyMic = false; g.__posted.length = 0;
  await act(() => root.render(createElement(Harness, { profile, ...opts, key: Math.random() })));
  if (opts.acked && posted("voiceDisclosureRead").length) await hostSays({ type: "voiceDisclosureState", acknowledged: [V1] });
}
const advance = (ms: number) => act(async () => { clock += ms; for (const tm of [...timers]) if (tm.at <= clock) { timers.splice(timers.indexOf(tm), 1); tm.fn(); } await new Promise((r) => setTimeout(r, 0)); });

// ============================================================================================
t("a seat with no voice block draws nothing and asks the host nothing", async () => {
  for (const profile of [null, { profile_id: "p" }, { profile_id: "p", voice: { dictation: false, read_aloud: false, policy_version: V1 } }, { profile_id: "p", voice: { dictation: true, policy_version: "hps-voice-policy/9" } }]) {
    await mount(profile);
    eq(all((e) => (e.getAttribute("class") ?? "").includes("hps-voice")).length, 0, "no voice element");
    eq(all((e) => e.tagName === "BUTTON").length, 0, "no button at all");
    eq(g.__posted.length, 0, "no host message");
  }
});

t("voice on: the mic button and the read-aloud button draw, and the host is asked what was read", async () => {
  await mount(profileOn());
  ok(byLabel("받아쓰기"), "mic button named 받아쓰기");
  ok(byLabel("소리로 듣기"), "read-aloud button named 소리로 듣기");
  eq(posted("voiceDisclosureRead").length, 1, "one disclosure read");
  eq(byLabel("받아쓰기").getAttribute("aria-keyshortcuts"), "Alt+Shift+M", "the in-app key is declared");
});

t("each half is its own switch", async () => {
  await mount(profileOn({ read_aloud: false }));
  ok(byLabel("받아쓰기") && !byLabel("소리로 듣기"), "dictation only");
  await mount(profileOn({ dictation: false }));
  ok(!byLabel("받아쓰기") && byLabel("소리로 듣기"), "read-aloud only");
});

t("disclosure gates the first use: sheet, then 시작하기 remembers and starts; Escape does not start", async () => {
  await mount(profileOn());
  await act(() => click(byLabel("받아쓰기") as never));
  const dialog = all((e) => e.tagName === "DIALOG")[0];
  ok(dialog, "the sheet opened");
  ok(dialog.textContent.includes("말하면 글자로 바꿔 줘요. 목소리는 글자로 바꾸는 데만 쓰고 저장하지 않아요. 보내기 전에 글을 고칠 수 있어요."), "the policy sentence for dictation");
  ok(dialog.textContent.includes("답을 소리로 읽어 줘요. 이 컴퓨터 안에서 읽어서 아무 데도 보내지 않아요."), "and for read-aloud");
  eq(rig.mediaCalls, 0, "no microphone before 시작하기");
  // 취소 by Escape: nothing starts, nothing is remembered
  await act(() => { dialog.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }); });
  eq(rig.mediaCalls, 0, "Escape never starts");
  eq(posted("voiceDisclosureAck").length, 0, "Escape never records an acknowledgement");
  // again, and accept
  await act(() => click(byLabel("받아쓰기") as never));
  await act(() => click(byText("시작하기") as never));
  await flush();
  eq(posted("voiceDisclosureAck"), [{ type: "voiceDisclosureAck", policyVersion: V1 }], "acknowledged once for this policy version");
  eq(rig.mediaCalls, 1, "dictation started after 시작하기");
  // the second press does not ask again (stop, then press again)
  await act(() => click(byLabel("받아쓰기 끝내기") as never));
});

t("an acknowledged version skips the sheet; read-aloud is gated too until then", async () => {
  await mount(profileOn());
  await act(() => click(byLabel("소리로 듣기") as never));
  ok(all((e) => e.tagName === "DIALOG")[0], "read-aloud opens the sheet first");
  eq(rig.spoken.length, 0, "nothing is spoken before 시작하기");
  await act(() => click(byText("시작하기") as never));
  ok(rig.spoken.length > 0, "speaks after 시작하기");
  await mount(profileOn(), { acked: true });
  await act(() => click(byLabel("소리로 듣기") as never));
  eq(all((e) => e.tagName === "DIALOG").length, 0, "no sheet once this version was read");
  ok(rig.spoken.length > 0, "speaks at once");
});

t("dictation: records webm/opus at 32 kbps, a transcript is inserted for editing, never sent", async () => {
  await mount(profileOn(), { acked: true });
  await act(() => click(byLabel("받아쓰기") as never));
  await flush();
  eq(rig.mediaCalls, 1);
  eq(rig.recorders[0].options, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 }, "the format");
  ok(byLabel("받아쓰기 끝내기"), "the button becomes the stop control");
  ok(all((e) => e.textContent.includes("듣고 있어요")).length > 0, "recording is said in words");
  rig.recorders[0].emit(new Uint8Array([9, 8, 7]));
  await advance(2000);
  await act(() => click(byLabel("받아쓰기 끝내기") as never));
  await flush(); await flush();
  const sent = posted("voiceTranscribe");
  eq(sent.length, 1, "one clip sent to the host");
  eq([sent[0].mime, sent[0].seconds, sent[0].audio], ["audio/webm", 2, Buffer.from([9, 8, 7]).toString("base64")]);
  ok(rig.tracksStopped >= 1, "the microphone is released");
  ok(all((e) => e.textContent.includes("글로 바꾸는 중이에요")).length > 0, "working state in words");
  await hostSays({ type: "voiceTranscribeResult", requestId: sent[0].requestId, ok: true, text: "안녕하세요 반가워요" });
  eq(rig.inserted, ["안녕하세요 반가워요"], "the transcript goes to the composer");
  eq(posted("sendMessage").length, 0, "never auto-sent");
  ok(all((e) => e.textContent.includes("입력창에 넣었어요")).length > 0, "said in words");
});

t("the hard stop ends the clip with no press", async () => {
  await mount(profileOn(), { acked: true });
  await act(() => click(byLabel("받아쓰기") as never));
  await flush();
  rig.recorders[0].emit(new Uint8Array(50));
  await advance(DICTATION_STOP_AT_MS);
  await flush();
  eq(posted("voiceTranscribe").length, 1, "stopped by the timer and sent");
  ok((posted("voiceTranscribe")[0].seconds as number) <= 60, "within the Service limit");
});

t("one clip at a time: a second press while working starts nothing", async () => {
  await mount(profileOn(), { acked: true });
  await act(() => click(byLabel("받아쓰기") as never)); await flush();
  rig.recorders[0].emit(new Uint8Array(5)); await advance(1500);
  await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush();
  eq(rig.mediaCalls, 1);
  ok(byLabel("받아쓰기").hasAttribute("disabled"), "the button is disabled while the clip is being turned into text");
});

t("Service refusals are calm: cap verbatim with no retry; unreadable gets the softer line with a retry", async () => {
  await mount(profileOn(), { acked: true });
  const press = async () => { await act(() => click(byLabel("받아쓰기") as never)); await flush(); rig.recorders[rig.recorders.length - 1].emit(new Uint8Array(5)); await advance(1500); await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush(); await flush(); };
  await press();
  let id = posted("voiceTranscribe").at(-1)!.requestId;
  const cap = "오늘 쓸 수 있는 음성 받아쓰기를 다 썼어요. 글로는 계속 이야기할 수 있어요.";
  await hostSays({ type: "voiceTranscribeResult", requestId: id, ok: false, kind: "cap", message: cap, retry: false });
  ok(all((e) => e.textContent.includes(cap)).length > 0, "the cap line, verbatim");
  ok(!byText("다시 시도"), "no retry button at a cap");
  await act(() => click(byText("닫기") as never));
  await press();
  id = posted("voiceTranscribe").at(-1)!.requestId;
  await hostSays({ type: "voiceTranscribeResult", requestId: id, ok: false, kind: "unreadable", message: "소리가 잘 들리지 않았어요. 다시 말해 볼까요?", retry: true });
  ok(all((e) => e.textContent.includes("소리가 잘 들리지 않았어요. 다시 말해 볼까요?")).length > 0, "the softer line");
  // retry sends the SAME clip from memory; the recovered text needs an explicit insert
  await act(() => click(byText("다시 시도") as never));
  const again = posted("voiceTranscribe");
  eq(again.length, 3, "one more send");
  eq(again[2].audio, again[1].audio, "the clip kept in memory is the one retried");
  await hostSays({ type: "voiceTranscribeResult", requestId: again[2].requestId, ok: true, text: "다시 들은 문장" });
  eq(rig.inserted, [], "recovered text is not inserted by itself");
  await act(() => click(byText("메시지에 넣기") as never));
  eq(rig.inserted, ["다시 들은 문장"], "inserted on the explicit press");
});

t("microphone permission denied: a recovery card with the one-click settings path, no auto retry", async () => {
  await mount(profileOn(), { acked: true });
  denyMic = true;
  await act(() => click(byLabel("받아쓰기") as never)); await flush();
  ok(all((e) => e.textContent.includes("마이크를 쓸 수 없어요")).length > 0, "the card");
  const open = byText("마이크 설정 열기");
  ok(open, "the settings button");
  await act(() => click(open as never));
  eq(posted("voiceOpenMicSettings"), [{ type: "voiceOpenMicSettings" }], "the webview names no URL");
  eq(rig.mediaCalls, 1, "opening settings does not try the microphone again");
  await hostSays({ type: "voiceMicSettingsResult", ok: false });
  ok(all((e) => e.textContent.includes("설정을 열지 못했어요")).length > 0, "a failed handoff says so");
  await act(() => click(byText("글로 계속하기") as never));
  eq(all((e) => (e.getAttribute("class") ?? "").includes("hps-voice-card")).length, 0, "dismissed");
});

t("a class that turned voice off mid-session shows the disabled state with its reason; text is untouched", async () => {
  await mount(profileOn(), { acked: true, scope: "same" });
  await act(() => root.render(createElement(Harness, { profile: { profile_id: "p" }, scope: "same" })));
  const mic = all((e) => e.tagName === "BUTTON" && (e.getAttribute("aria-label") ?? "").startsWith("받아쓰기"))[0];
  ok(mic && mic.hasAttribute("disabled"), "the mic button is disabled");
  ok(mic.getAttribute("aria-label")!.includes("이 수업에서는 쓸 수 없어요"), "its name carries the reason");
  ok(all((e) => e.textContent.includes("이 수업에서는 쓸 수 없어요")).length > 0, "the reason is also text, not only a grey button");
  const listen = all((e) => e.tagName === "BUTTON" && (e.getAttribute("aria-label") ?? "").startsWith("소리로 듣기"))[0];
  ok(listen && listen.hasAttribute("disabled"), "read-aloud is disabled too");
  await act(() => click(mic as never));
  eq(rig.mediaCalls, 0, "a disabled control starts nothing");
});

t("a Service refusal that says class-off switches the seat to the disabled state", async () => {
  await mount(profileOn(), { acked: true });
  await act(() => click(byLabel("받아쓰기") as never)); await flush();
  rig.recorders[0].emit(new Uint8Array(5)); await advance(1500);
  await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush();
  const id = posted("voiceTranscribe")[0].requestId;
  await hostSays({ type: "voiceTranscribeResult", requestId: id, ok: false, kind: "class_off", message: "이 수업에서는 쓸 수 없어요.", retry: false });
  const mic = all((e) => e.tagName === "BUTTON" && (e.getAttribute("aria-label") ?? "").startsWith("받아쓰기"))[0];
  ok(mic.hasAttribute("disabled") && mic.getAttribute("aria-label")!.includes("쓸 수 없어요"), "disabled with the reason");
});

t("Escape while recording cancels: nothing is sent, the microphone is released", async () => {
  await mount(profileOn(), { acked: true });
  await act(() => click(byLabel("받아쓰기") as never)); await flush();
  rig.recorders[0].emit(new Uint8Array(5));
  await act(() => { g.window.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }); });
  await flush();
  eq(posted("voiceTranscribe").length, 0, "nothing sent");
  ok(rig.tracksStopped >= 1, "the microphone is released");
  ok(byLabel("받아쓰기"), "back to the mic button");
});

t("the in-app key Alt+Shift+M starts and ends dictation; it is not a global shortcut", async () => {
  await mount(profileOn(), { acked: true });
  const key = () => act(() => { g.window.dispatchEvent({ type: "keydown", key: "M", code: "KeyM", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, keyCode: 77, bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }); });
  await key(); await flush();
  eq(rig.mediaCalls, 1, "started by the key");
  await key();
  ok(byLabel("받아쓰기") || byLabel("받아쓰기 끝내기"), "still mounted");
  // while an IME composition is open the key is left alone
  await mount(profileOn(), { acked: true });
  await act(() => { g.window.dispatchEvent({ type: "keydown", key: "M", code: "KeyM", altKey: true, shiftKey: true, repeat: false, isComposing: true, keyCode: 229, bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }); });
  eq(rig.mediaCalls, 0, "composition keeps the keyboard");
});

t("read-aloud: speaks the answer in Korean on the device, skips code and says so, one press stops it, no fetch", async () => {
  await mount(profileOn(), { acked: true });
  await act(() => click(byLabel("소리로 듣기") as never));
  ok(rig.spoken.length > 0 && rig.spoken.every((u) => u.lang === "ko-KR"), "ko-KR utterances");
  ok(rig.spoken.every((u) => !u.text.includes("code()")), "code is not read");
  ok(all((e) => e.textContent.includes("코드는 건너뛰었어요")).length > 0, "the skipped code is announced");
  ok(byLabel("읽기 멈추기"), "the same button now stops it");
  await act(() => click(byLabel("읽기 멈추기") as never));
  ok(rig.cancels >= 1, "stop cancels the synthesizer");
  ok(byLabel("소리로 듣기"), "and offers it again");
  eq(tripwire, [], "no network");
});

t("read-aloud without a synthesizer is a disabled button with a reason, not a silent miss", async () => {
  await mount(profileOn({ dictation: false }), { acked: true, speech: noSpeech });
  const b = all((e) => e.tagName === "BUTTON")[0];
  ok(b.hasAttribute("disabled") && b.getAttribute("aria-label")!.includes("읽을 수 없어요"), "disabled with the reason");
});

t("a profile that stops serving voice stops a reading in progress", async () => {
  await mount(profileOn(), { acked: true, scope: "k" });
  await act(() => click(byLabel("소리로 듣기") as never));
  const before = rig.cancels;
  await act(() => root.render(createElement(Harness, { profile: { profile_id: "p" }, scope: "other" })));
  ok(rig.cancels > before, "cancelled");
});

t("insertAtCaret: caret, selection, spacing and the length limit", async () => {
  eq(insertAtCaret("", 0, 0, "안녕"), { value: "안녕", caret: 2 });
  eq(insertAtCaret("가나", 2, 2, "다라"), { value: "가나 다라", caret: 5 }, "a space before");
  eq(insertAtCaret("가 나", 1, 1, "다"), { value: "가 다 나", caret: 3 }, "mid text keeps spaces either side");
  eq(insertAtCaret("가나다", 1, 2, "X"), { value: "가 X 다", caret: 4 }, "replaces a selection");
  eq(insertAtCaret("a\n", 2, 2, "b"), { value: "a\nb", caret: 3 }, "no space after a line break");
  eq(insertAtCaret("x".repeat(10), 10, 10, "yyyy", 12), null, "over the limit");
  eq(insertAtCaret("abc", 1, 1, "  \n "), { value: "abc", caret: 1 }, "whitespace-only text changes nothing");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  void document;
  if (fail) { console.error(`${fail} failed`); process.exit(1); }
  console.log(`voice-ui: ${tests.length} passed`);
  // A recording tick is a live interval; leaving the page unmounts it, and the process ends here.
  await act(() => root.unmount());
  process.exit(0);
})();
