// CGP-VOICE-R-014 / R-015 / D-010 / D-012 (REQ-CGPV-17c / 18, DES-CGPV-17 / 18): dictation as its own control,
// every failure by cause with one recovery action, the starting and recording states, and the failure line.
// Rendered for real (React on the minimal DOM) through the real dictation addon under a served-voice profile, for an
// adult seat and a minor seat (policy hps-voice-policy/1: audio in memory only, never stored). The harness is
// voice-ui.test.tsx's: a scripted recorder and timers; host replies arrive as window "message" events.
// Run: node scripts/run-tsx-tests.mjs dictation-recovery
import { act as reactAct, createElement } from "react";
import { click, document, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { VoiceProvider, useVoiceController } from "../webview-ui/src/VoiceProvider";
import { dictationAddonFor } from "../webview-ui/src/dictationAddon";
import { DictationEnvContext, useDictationController, type DictationController } from "../webview-ui/src/DictationControl";
import { ReadAloudButton, SpeechEnvContext, browserSpeechEnv } from "../webview-ui/src/ReadAloudButton";
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
interface Rig { speechEnvCalls: number; recorders: FakeRecorder[]; mediaCalls: number; tracksStopped: number; spoken: Array<{ text: string; lang: string; voice: unknown }>; utterances: Array<{ onend: (() => void) | null }>; cancels: number; inserted: string[]; insertOk: boolean }
class FakeRecorder {
  static supported = ["audio/webm;codecs=opus"];
  static isTypeSupported(m: string) { return FakeRecorder.supported.includes(m); }
  state = "inactive"; options: unknown; ondataavailable: ((e: unknown) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(_s: unknown, options: unknown) { this.options = options; rig.recorders.push(this); }
  start() { this.state = "recording"; }
  stop() { if (this.state === "inactive") return; this.state = "inactive"; queueMicrotask(() => this.onstop?.()); }
  emit(bytes: Uint8Array) { this.ondataavailable?.({ data: { size: bytes.length, arrayBuffer: async () => bytes.buffer } }); }
}
let rig: Rig & { focused: number };
/** Reads the real controller (the kept-clip flag only, never the bytes). */
let probe: DictationController | null = null;
function Probe() { probe = useDictationController(); return null; }
let blockedReason: string | null = null;
let denyMic = false;
let clock = 0;
const timers: Array<{ at: number; fn: () => void; id: number }> = [];
let micError: string | null = null;
let micGate: Promise<void> | null = null;
const meter = { reads: 0, closed: 0, value: 0.6 };
let withRecorder = true;
const dictEnv = () => ({
  getUserMedia: async () => {
    rig.mediaCalls++;
    if (denyMic) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    if (micError) throw Object.assign(new Error("x"), { name: micError });
    if (micGate) await micGate;
    return { getTracks: () => [{ stop() { rig.tracksStopped++; } }] };
  },
  levelMeter: () => ({ read: () => { meter.reads++; return meter.value; }, close: () => { meter.closed++; } }),
  get Recorder() { return (withRecorder ? FakeRecorder : undefined) as never; },
  now: () => clock,
  setTimeout: (fn: () => void, ms: number) => { const tm = { at: clock + ms, fn, id: timers.length + 1 }; timers.push(tm); return tm.id; },
  clearTimeout: (id: unknown) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
});
const speechEnv = () => (rig.speechEnvCalls++, {
  synth: { speak: (u: { text: string; lang: string; voice: unknown; onend: (() => void) | null }) => { rig.spoken.push({ text: u.text, lang: u.lang, voice: u.voice }); rig.utterances.push(u); }, cancel: () => { rig.cancels++; }, getVoices: () => [{ lang: "ko-KR", localService: true, name: "Yuna" }] },
  makeUtterance: (text: string) => ({ text, lang: "", rate: 1, voice: null, onend: null, onerror: null }),
});
const noSpeech = () => (rig.speechEnvCalls++, { synth: undefined, makeUtterance: () => ({}) as never });

const ANSWER = "안녕하세요. 답이에요.\n```\ncode()\n```";
function Harness({ profile, scope = "s1", speech = speechEnv, insertOk = true, content = ANSWER }: { profile: unknown; scope?: string; speech?: () => ReturnType<typeof speechEnv> | ReturnType<typeof noSpeech>; insertOk?: boolean; content?: string }) {
  const controller = useVoiceController(profile as never, scope, true);
  const addon = dictationAddonFor(controller.value.availability);
  const api = { insert: (text: string) => { if (insertOk) rig.inserted.push(text); return insertOk; }, get disabled() { return !!blockedReason; }, get disabledReason() { return blockedReason; }, focusComposer: () => { rig.focused++; } };
  return createElement(VoiceProvider, { controller },
    createElement(DictationEnvContext.Provider, { value: dictEnv },
      createElement(SpeechEnvContext.Provider, { value: speech as never },
        createElement("div", { className: "frame" },
          addon ? createElement(addon.Scope, { api }, createElement("div", { className: "composer" }, createElement(addon.Notice), createElement(addon.Control), createElement(Probe))) : null,
          createElement("div", { className: "answer-actions" }, createElement(ReadAloudButton, { answerId: "a1", content }))))));
}
const profileOn = (extra: Record<string, unknown> = {}) => ({ profile_id: "p", voice: { dictation: true, read_aloud: true, policy_version: V1, ...extra } });

async function mount(profile: unknown, opts: { scope?: string; speech?: () => ReturnType<typeof speechEnv> | ReturnType<typeof noSpeech>; acked?: boolean; insertOk?: boolean; content?: string; blocked?: string } = {}) {
  rig = { speechEnvCalls: 0, recorders: [], mediaCalls: 0, tracksStopped: 0, spoken: [], utterances: [], cancels: 0, inserted: [], insertOk: true, focused: 0 } as never;
  timers.length = 0; clock = 0; denyMic = false; micError = null; micGate = null; withRecorder = true; blockedReason = opts.blocked ?? null; g.__posted.length = 0;
  meter.reads = 0; meter.closed = 0; meter.value = 0.6;
  await act(() => root.render(createElement(Harness, { profile, ...opts, key: Math.random() })));
  if (opts.acked && posted("voiceDisclosureRead").length) await hostSays({ type: "voiceDisclosureState", acknowledged: [V1] });
}
const advance = (ms: number) => act(async () => { clock += ms; for (const tm of [...timers]) if (tm.at <= clock) { timers.splice(timers.indexOf(tm), 1); tm.fn(); } await new Promise((r) => setTimeout(r, 0)); });

// ============================================================================================
const adult = () => ({ profile_id: "p", voice: { dictation: true, read_aloud: true, policy_version: V1 } });
const minor = () => ({ profile_id: "p", minor_cohort: true, voice: { dictation: true, read_aloud: true, policy_version: V1 } });
const line = () => all((e) => (e.getAttribute("class") ?? "").includes("hps-voice-failure"))[0];
const actions = () => line() ? line().findAll((e: El) => e.tagName === "BUTTON").map((b: El) => b.textContent.trim()) : null;
const press = () => act(() => click(byLabel("받아쓰기") as never));
/** Record and stop, so a clip goes to the host. */
const recordClip = async () => { await press(); await flush(); rig.recorders.at(-1)!.emit(new Uint8Array(24).map((_, i) => (i * 37 + 11) & 255)); await advance(1500); await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush(); };
const lastSend = () => posted("voiceTranscribe").at(-1)!;

for (const [seat, profile] of [["adult", adult], ["minor", minor]] as const) {
  t(`${seat}: each webview cause shows its own line and one recovery action`, async () => {
    for (const [error, text, action] of [["NotFoundError", "마이크를 찾을 수 없어요", "다시 말하기"], ["NotReadableError", "마이크를 다른 곳에서 쓰고 있어요", "다시 말하기"]] as const) {
      await mount(profile(), { acked: true });
      micError = error;
      await press(); await flush();
      ok(line() && line().textContent.includes(text), `${error}: the cause's line (${line()?.textContent})`);
      eq(actions(), [action, "닫기"], `${error}: one recovery action, then 닫기`);
      eq(line().findAll((e: El) => e.tagName === "svg" || e.tagName === "SVG").map((s: El) => s.getAttribute("data-icon")), ["alert"], "the alert icon");
      eq(rig.inserted, [], "the draft is untouched");
    }
    await mount(profile(), { acked: true });
    withRecorder = false;
    await press(); await flush();
    eq(actions(), ["글로 쓰기", "닫기"], "unsupported: write instead");
    await act(() => click(byText("글로 쓰기") as never));
    eq([line(), rig.focused], [undefined, 1], "글로 쓰기 closes the line and puts the caret in the composer");
  });

  t(`${seat}: host and Service causes get their own action; 다시 보내기 resends the clip kept in memory`, async () => {
    await mount(profile(), { acked: true });
    await recordClip();
    await hostSays({ type: "voiceTranscribeResult", requestId: lastSend().requestId, ok: false, kind: "network", message: "인터넷 연결을 확인해 주세요. 글로는 계속 이야기할 수 있어요.", retry: true });
    eq(actions(), ["다시 보내기", "닫기"], "network: resend");
    const audio = lastSend().audio, sends = posted("voiceTranscribe").length;
    await act(() => click(byText("다시 보내기") as never));
    eq([posted("voiceTranscribe").length, lastSend().audio, rig.mediaCalls], [sends + 1, audio, 1], "the same clip, from memory; the microphone is not reopened");
    await hostSays({ type: "voiceTranscribeResult", requestId: lastSend().requestId, ok: false, kind: "cap", message: "오늘 쓸 수 있는 음성 받아쓰기를 다 썼어요. 글로는 계속 이야기할 수 있어요.", retry: false });
    eq(actions(), ["글로 쓰기", "닫기"], "cap: write instead, no resend");
    await act(() => click(byText("닫기") as never));
    for (const [kind, action] of [["auth", "글로 쓰기"], ["unavailable", "글로 쓰기"], ["too_long", "다시 말하기"], ["too_large", "다시 말하기"]] as const) {
      await recordClip();
      await hostSays({ type: "voiceTranscribeResult", requestId: lastSend().requestId, ok: false, kind, message: `${kind} 문장`, retry: false });
      eq(actions(), [action, "닫기"], `${kind}`);
      ok(line().textContent.includes(`${kind} 문장`), `${kind}: the host's sentence as written`);
      await act(() => click(byText("닫기") as never));
    }
    eq(rig.inserted, [], "the draft was never touched");
  });

  t(`${seat}: 다시 말하기 starts a new recording; a resend after the kept clip expired records anew`, async () => {
    await mount(profile(), { acked: true });
    micError = "NotFoundError";
    await press(); await flush();
    micError = null;
    const calls = rig.mediaCalls;
    await act(() => click(byText("다시 말하기") as never)); await flush();
    eq(rig.mediaCalls, calls + 1, "a new recording");
    ok(byLabel("받아쓰기 끝내기"), "recording again");
    await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush();
    // A kept clip lives ten minutes (REQ-CGPV-19); after that 다시 보내기 cannot resend and records instead.
    await mount(profile(), { acked: true });
    await recordClip();
    await hostSays({ type: "voiceTranscribeResult", requestId: lastSend().requestId, ok: false, kind: "network", message: "연결", retry: true });
    await advance(10 * 60 * 1000 + 1);
    const sends = posted("voiceTranscribe").length, mics = rig.mediaCalls;
    await act(() => click(byText("다시 보내기") as never)); await flush();
    eq([posted("voiceTranscribe").length, rig.mediaCalls], [sends, mics + 1], "no stale resend; a fresh recording");
  });
}

for (const [seat, profile] of [["adult", adult], ["minor", minor]] as const) {
  t(`${seat}: the retry copy is memory only and dropped on success, 닫기, window hide, pagehide, leaving the chat and after 10 minutes`, async () => {
    const failOnce = async () => {
      await recordClip();
      await hostSays({ type: "voiceTranscribeResult", requestId: lastSend().requestId, ok: false, kind: "network", message: "연결", retry: true });
      ok(probe!.hasKeptClip(), "a retryable failure keeps the clip in memory");
    };
    // No disk: no storage API, no blob URL, nothing in the webview state, the audio only in voiceTranscribe.
    const spies: string[] = [];
    const gw = globalThis as unknown as Record<string, unknown>;
    const keep = { ls: gw.localStorage, ss: gw.sessionStorage, idb: gw.indexedDB, cou: (URL as unknown as { createObjectURL?: unknown }).createObjectURL };
    const trap = (name: string) => new Proxy({}, { get: (_t, k) => () => { spies.push(`${name}.${String(k)}`); } });
    gw.localStorage = trap("localStorage"); gw.sessionStorage = trap("sessionStorage"); gw.indexedDB = trap("indexedDB");
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => { spies.push("URL.createObjectURL"); return ""; };
    (globalThis as unknown as { __vsState: unknown }).__vsState = undefined;
    try {
      await mount(profile(), { acked: true });
      // Success drops it.
      await failOnce();
      const audio = lastSend().audio as string;
      await act(() => click(byText("다시 보내기") as never));
      await hostSays({ type: "voiceTranscribeResult", requestId: lastSend().requestId, ok: true, text: "다시 들은 문장" });
      ok(!probe!.hasKeptClip(), "success drops the copy");
      // 닫기 drops it.
      await failOnce();
      await act(() => click(byText("닫기") as never));
      ok(!probe!.hasKeptClip(), "닫기 drops the copy");
      // Hiding the window drops it (visibilitychange), and so does pagehide.
      await failOnce();
      const doc = document as unknown as { visibilityState: string; dispatchEvent(e: unknown): void };
      const vis = Object.getOwnPropertyDescriptor(doc, "visibilityState");
      Object.defineProperty(doc, "visibilityState", { configurable: true, get: () => "hidden" });
      await act(() => { doc.dispatchEvent({ type: "visibilitychange", bubbles: false }); });
      if (vis) Object.defineProperty(doc, "visibilityState", vis); else delete (doc as unknown as { visibilityState?: string }).visibilityState;
      ok(!probe!.hasKeptClip(), "a hidden window drops the copy");
      await failOnce();
      await act(() => { g.window.dispatchEvent({ type: "pagehide", bubbles: false }); });
      ok(!probe!.hasKeptClip(), "pagehide drops the copy");
      // Ten minutes drop it.
      await failOnce();
      await advance(10 * 60 * 1000 + 1);
      ok(!probe!.hasKeptClip(), "after 10 minutes the copy is gone");
      // Leaving the chat (a task or seat switch remounts the chat) drops it.
      await failOnce();
      const before = probe!;
      await act(() => root.render(createElement("div")));
      ok(!before.hasKeptClip(), "leaving the chat drops the copy");
      eq(spies, [], "no storage or blob URL was used");
      const state = JSON.stringify((globalThis as unknown as { __vsState: unknown }).__vsState ?? null);
      ok(!state.includes(audio.slice(0, 12)), "the webview state holds no audio");
      ok(g.__posted.filter((m) => m.type !== "voiceTranscribe").every((m) => !JSON.stringify(m).includes(audio.slice(0, 12))), "no other host message carries the audio");
    } finally {
      gw.localStorage = keep.ls; gw.sessionStorage = keep.ss; gw.indexedDB = keep.idb; (URL as unknown as { createObjectURL: unknown }).createObjectURL = keep.cou;
    }
  });
}

t("too short: its line goes away after 8 s; a no-microphone line never does", async () => {
  await mount(adult(), { acked: true });
  await press(); await flush();
  await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush();
  ok(line() && line().getAttribute("data-cause") === "too_short", "too short");
  eq(actions(), ["다시 말하기", "닫기"]);
  await act(() => new Promise((r) => setTimeout(r, 8_300)));
  eq(line(), undefined, "gone after 8 s");
  micError = "NotFoundError";
  await press(); await flush();
  await act(() => new Promise((r) => setTimeout(r, 8_300)));
  ok(line() && line().getAttribute("data-cause") === "no_mic", "the no-microphone line stays");
});

t("starting: said in words with 취소; 취소 closes the microphone it was about to get", async () => {
  await mount(adult(), { acked: true });
  let open: () => void = () => {};
  micGate = new Promise<void>((r) => { open = r; });
  await press(); await flush();
  const starting = all((e) => (e.getAttribute("class") ?? "").includes("hps-voice-starting"))[0];
  ok(starting && starting.textContent.includes("마이크를 켜는 중이에요"), `the starting line (${starting?.textContent})`);
  ok(!all((e) => (e.getAttribute("class") ?? "").includes("spinner")).length, "no spinner");
  await act(() => click(starting.findAll((e: El) => e.tagName === "BUTTON")[0] as never));
  open(); await flush();
  eq([rig.tracksStopped, rig.recorders.length], [1, 0], "the late microphone is closed; no recording starts");
  ok(byLabel("받아쓰기"), "back to idle");
});

t("recording: a decorative level from the real meter, gone with reduced motion; the meter closes when recording ends", async () => {
  await mount(adult(), { acked: true });
  await press(); await flush();
  await act(() => new Promise((r) => setTimeout(r, 300)));
  const bar = () => all((e) => (e.getAttribute("class") ?? "").includes("hps-voice-level"))[0];
  ok(bar(), "a level bar while recording");
  eq([bar().getAttribute("aria-hidden"), bar().getAttribute("data-level")], ["true", "0.60"], "decorative, at the meter's level");
  ok(meter.reads > 0, "read from the meter");
  meter.value = 0;
  await act(() => new Promise((r) => setTimeout(r, 300)));
  eq(bar().getAttribute("data-level"), "0.00", "negative control: a silent stream draws a flat level");
  await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush();
  eq(meter.closed, 1, "the meter is closed when recording ends");
  ok(!bar(), "no bar after recording");
  // Reduced motion: nothing moves, so no bar at all; the words still say it is recording.
  (g.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true });
  try {
    await mount(adult(), { acked: true });
    await press(); await flush();
    eq(bar(), undefined, "no level bar under reduced motion");
    ok(all((e) => e.textContent === "듣고 있어요").length > 0, "the words carry the state");
    await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush();
  } finally { delete (g.window as unknown as { matchMedia?: unknown }).matchMedia; }
});

t("R-014: while a voice conversation holds the microphone, dictation says why and a press is refused with that line", async () => {
  await mount(adult(), { acked: true, blocked: "음성 대화 중에는 받아쓰기를 쓸 수 없어요" });
  const b = all((e) => e.tagName === "BUTTON" && (e.getAttribute("aria-label") ?? "").startsWith("받아쓰기"))[0];
  eq(b.getAttribute("aria-label"), "받아쓰기, 음성 대화 중에는 받아쓰기를 쓸 수 없어요", "the reason is in the name");
  eq(b.getAttribute("data-hp-tooltip"), "음성 대화 중에는 받아쓰기를 쓸 수 없어요", "and the tooltip");
  await act(() => { g.window.dispatchEvent({ type: "keydown", key: "M", code: "KeyM", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, keyCode: 77, bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }); });
  ok(line() && line().textContent.includes("음성 대화 중에는 받아쓰기를 쓸 수 없어요"), "Alt+Shift+M is refused with the line");
  eq(actions(), ["닫기"], "nothing to recover: only 닫기");
  eq(rig.mediaCalls, 0, "the microphone was never asked for");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  void document;
  if (fail) { console.error(`${fail} failed`); process.exit(1); }
  console.log(`dictation-recovery: ${tests.length} passed`);
  await act(() => root.unmount());
  process.exit(0);
})();
