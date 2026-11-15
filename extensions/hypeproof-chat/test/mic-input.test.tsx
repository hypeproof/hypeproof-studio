// CGP-VOICE-R-019 / D-015 (REQ-CGPV-23 / DES-CGPV-23): choosing the microphone, rendered for real (React on the
// minimal DOM) through the real VoiceProvider, the real dictation addon and the real settings row, for an adult seat
// and a minor seat (policy hps-voice-policy/1: audio in memory only, never stored). Scripted browser objects only.
// - the 마이크 row: drawn only where dictation is served; lists the microphones with 시스템 기본값 first; opening it
//   never opens the microphone; hidden list / no microphone / unplugged choice each say so in words; a plug-in event
//   refreshes it; a pick goes to the host as setMicInput (an id and a label, nothing else);
// - dictation: records exactly from the chosen microphone; an unplugged choice never records, says
//   "선택한 마이크가 연결되어 있지 않아요" with one action "기본 마이크로 녹음" that records this once with the default,
//   and the next press asks again (the choice is kept);
// - 마이크 시험: behind the disclosure and the microphone explainer; listens to the chosen microphone for 5 s at most,
//   shows the real level (not under reduced motion), says heard / not heard, sends and keeps nothing, and closes the
//   tracks and the meter when done, when stopped early and when the dialog closes.
// Run: node scripts/run-tsx-tests.mjs mic-input
import { act as reactAct, createElement } from "react";
import { click, document, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { VoiceProvider, useVoiceController } from "../webview-ui/src/VoiceProvider";
import { dictationAddonFor } from "../webview-ui/src/dictationAddon";
import { DictationEnvContext } from "../webview-ui/src/DictationControl";
import { MicInputSetting } from "../webview-ui/src/MicInputSetting";
import { MIC_MISSING_VALUE, MIC_TEST_MS } from "../src/micInput";

type El = { tagName?: string; textContent: string; value?: string; selected?: boolean; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; dispatchEvent(e: unknown): boolean; findAll(f: (e: El) => boolean): El[] };
const act: (fn: () => unknown) => Promise<void> = (reactAct as unknown as (fn: () => unknown) => Promise<void>);
const g = globalThis as unknown as { __posted: Array<Record<string, unknown>>; fetch: unknown; window: { dispatchEvent(e: unknown): void; matchMedia?: unknown } };
const V1 = "hps-voice-policy/1";
const realError = console.error;
console.error = (...args: unknown[]) => { if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return; realError(...args); };
g.fetch = () => { throw new Error("network"); };

// React drives a controlled <select> through `select.options` and each option's `value` property; mini-dom has no
// `options` and does not reflect an option's value attribute, so this gives both their browser meaning.
const proto = Object.getPrototypeOf(document.createElement("select")) as object;
if (!Object.getOwnPropertyDescriptor(proto, "options")) {
  Object.defineProperty(proto, "options", { configurable: true, get(this: El) {
    if (this.tagName !== "SELECT") return undefined;
    const options = this.findAll((e) => e.tagName === "OPTION");
    for (const o of options) o.value = o.getAttribute("value") ?? o.textContent;
    return options;
  } });
  // A single select has one selected option: selecting one deselects the others, as a browser does.
  Object.defineProperty(proto, "selected", { configurable: true,
    get(this: { _selected?: boolean }) { return !!this._selected; },
    set(this: El & { _selected?: boolean; parentNode?: El }, on: boolean) {
      if (on && this.parentNode) for (const o of this.parentNode.findAll((e) => e.tagName === "OPTION")) (o as { _selected?: boolean })._selected = false;
      this._selected = !!on;
    } });
}

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
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });

const HEX = (c: string) => c.repeat(64);
const A = { id: HEX("a"), label: "USB 헤드셋" }, B = { id: HEX("b"), label: "" };

// ---- scripted browser objects ----
class FakeRecorder {
  static isTypeSupported() { return true; }
  state = "inactive"; ondataavailable: ((e: unknown) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  start() { this.state = "recording"; }
  stop() { if (this.state === "inactive") return; this.state = "inactive"; queueMicrotask(() => this.onstop?.()); }
}
const rig = { constraints: [] as unknown[], tracksStopped: 0, listCalls: 0, devices: [A, B] as Array<{ id: string; label: string }> | null, permission: "granted", deviceListeners: [] as Array<() => void>, meter: { reads: 0, closed: 0, value: 0.6 } };
let clock = 0;
const timers: Array<{ at: number; fn: () => void; id: number }> = [];
let timerSeq = 0;
const dictEnv = () => ({
  micPermission: async () => rig.permission as never,
  getUserMedia: async (c: unknown) => { rig.constraints.push(c); return { getTracks: () => [{ stop() { rig.tracksStopped++; } }] }; },
  listMics: async () => { rig.listCalls++; return rig.devices; },
  onDeviceChange: (fn: () => void) => { rig.deviceListeners.push(fn); return () => { rig.deviceListeners = rig.deviceListeners.filter((f) => f !== fn); }; },
  levelMeter: () => ({ read: () => { rig.meter.reads++; return rig.meter.value; }, close: () => { rig.meter.closed++; } }),
  Recorder: FakeRecorder as never,
  now: () => clock,
  setTimeout: (fn: () => void, ms: number) => { const tm = { at: clock + ms, fn, id: ++timerSeq }; timers.push(tm); return tm.id; },
  clearTimeout: (id: unknown) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
});
const advance = (ms: number) => act(async () => {
  const end = clock + ms;
  for (;;) {
    const next = timers.filter((tm) => tm.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    clock = next.at; timers.splice(timers.indexOf(next), 1); next.fn();
    await new Promise((r) => setTimeout(r, 0));
  }
  clock = end;
  await new Promise((r) => setTimeout(r, 0));
});

function Harness({ profile, micInput, setting = true }: { profile: unknown; micInput?: unknown; setting?: boolean }) {
  const controller = useVoiceController(profile as never, "s1", true, micInput);
  const addon = dictationAddonFor(controller.value.availability);
  const api = { insert: () => true, disabled: false, disabledReason: null, focusComposer: () => {} };
  return createElement(VoiceProvider, { controller },
    createElement(DictationEnvContext.Provider, { value: dictEnv },
      createElement("div", { className: "frame" },
        addon ? createElement(addon.Scope, { api }, createElement("div", { className: "composer" }, createElement(addon.Notice), createElement(addon.Control))) : null,
        setting ? createElement("div", { className: "dialog" }, createElement(MicInputSetting)) : null)));
}
let current: { profile: unknown; micInput?: unknown; setting?: boolean } = { profile: null };
const render = (props: typeof current) => { current = props; return act(() => root.render(createElement(Harness, props as never))); };
async function mount(profile: unknown, opts: { micInput?: unknown; acked?: boolean; devices?: typeof rig.devices; permission?: string } = {}) {
  await act(() => root.render(createElement("div")));
  rig.constraints = []; rig.tracksStopped = 0; rig.listCalls = 0; rig.devices = opts.devices === undefined ? [A, B] : opts.devices; rig.permission = opts.permission ?? "granted"; rig.deviceListeners = [];
  rig.meter = { reads: 0, closed: 0, value: 0.6 };
  timers.length = 0; clock = 0; g.__posted.length = 0;
  await render({ profile, micInput: opts.micInput, setting: true });
  if (opts.acked !== false && posted("voiceDisclosureRead").length) await hostSays({ type: "voiceDisclosureState", acknowledged: [V1] });
  await flush();
}
const adult = () => ({ profile_id: "p", voice: { dictation: true, read_aloud: true, policy_version: V1 } });
const minor = () => ({ profile_id: "p", minor_cohort: true, voice: { dictation: true, read_aloud: true, policy_version: V1 } });
const select = () => all((e) => e.tagName === "SELECT")[0];
const optionTexts = () => select().findAll((e) => e.tagName === "OPTION").map((o) => o.textContent);
const chosen = () => { const o = select().findAll((e) => e.tagName === "OPTION").find((x) => x.selected); return o ? o.getAttribute("value") : null; };
const hint = () => { const id = select().getAttribute("aria-describedby")!; return all((e) => e.getAttribute("id") === id)[0]?.textContent ?? null; };
const status = () => all((e) => (e.getAttribute("class") ?? "").includes("hps-mic-test-result"))[0]?.textContent ?? null;
const pick = (value: string) => act(async () => { const s = select() as unknown as { value: string; dispatchEvent(e: unknown): void }; s.value = value; s.dispatchEvent({ type: "change", bubbles: true }); });
const line = () => all((e) => (e.getAttribute("class") ?? "").includes("hps-voice-failure"))[0];
const actions = () => line() ? line().findAll((e: El) => e.tagName === "BUTTON").map((b: El) => b.textContent.trim()) : null;
const bar = () => all((e) => (e.getAttribute("class") ?? "").includes("hps-voice-level"))[0];

t("an unserved seat draws no 마이크 row and touches no browser API", async () => {
  await mount({ profile_id: "p" });
  eq([select(), rig.listCalls, rig.constraints.length, rig.deviceListeners.length], [undefined, 0, 0, 0], "nothing drawn, nothing listed, no listener");
  await mount({ profile_id: "p", voice: { dictation: false, read_aloud: true, policy_version: V1 } });
  eq(select(), undefined, "read-aloud only: no microphone row");
});

for (const [seat, profile] of [["adult", adult], ["minor", minor]] as const) {
  t(`${seat}: the row lists the microphones, 시스템 기본값 first, without opening the microphone`, async () => {
    await mount(profile());
    eq(optionTexts(), ["시스템 기본값", "USB 헤드셋", "마이크 2"], "labels, or 마이크 N without one");
    eq(chosen(), "", "the system default is chosen");
    eq(hint(), "받아쓰기와 음성 대화에 쓸 마이크예요.");
    const legend = all((e) => e.getAttribute("id") === select().getAttribute("aria-labelledby"))[0];
    eq(legend?.textContent, "마이크", "the select is named 마이크");
    eq(rig.constraints.length, 0, "opening the row never asks for the microphone");
    await pick(A.id);
    eq(posted("setMicInput"), [{ type: "setMicInput", choice: A }], "a pick goes to the host: id and label only");
    await render({ ...current, micInput: A }); await flush();
    eq(chosen(), A.id, "the host's choice is shown");
    await pick("");
    eq(posted("setMicInput").at(-1), { type: "setMicInput", choice: null }, "시스템 기본값 is null");
  });

  t(`${seat}: dictation records from the chosen microphone; unplugged, it never records and offers the default once`, async () => {
    await mount(profile(), { micInput: A });
    await act(() => click(byLabel("받아쓰기") as never)); await flush();
    eq(rig.constraints, [{ audio: { deviceId: { exact: A.id } } }], "exactly the chosen microphone");
    await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush();
    await act(() => click(byText("닫기") as never));

    await mount(profile(), { micInput: A, devices: [B] });
    await act(() => click(byLabel("받아쓰기") as never)); await flush();
    eq(rig.constraints.length, 0, "no microphone opened, never silently the default");
    ok(line() && line().textContent.includes("선택한 마이크가 연결되어 있지 않아요"), `the line (${line()?.textContent})`);
    eq(actions(), ["기본 마이크로 녹음", "닫기"], "one action, then 닫기");
    eq(chosen(), MIC_MISSING_VALUE, "the row says 연결되지 않은 마이크");
    await act(() => click(byText("기본 마이크로 녹음") as never)); await flush();
    eq(rig.constraints, [{ audio: true }], "one press records with the default");
    ok(byLabel("받아쓰기 끝내기"), "and it is recording");
    await act(() => click(byLabel("받아쓰기 끝내기") as never)); await flush();
    await act(() => click(byText("닫기") as never));
    await act(() => click(byLabel("받아쓰기") as never)); await flush();
    eq([rig.constraints.length, actions()], [1, ["기본 마이크로 녹음", "닫기"]], "the next press asks again: the choice is kept");
    eq(posted("setMicInput"), [], "the stored choice was never changed");
  });
}

t("hidden list, no microphone, unplugged choice and a plug-in event each read in words", async () => {
  await mount(adult(), { devices: null });
  eq([optionTexts(), hint()], [["시스템 기본값"], "마이크를 한 번 허용하면 이름을 보고 고를 수 있어요."], "before permission");
  await mount(adult(), { devices: [] });
  eq(hint(), "마이크를 찾을 수 없어요", "DES empty state");
  await mount(adult(), { devices: [B], micInput: A });
  eq([optionTexts().at(-1), chosen(), hint()], ["연결되지 않은 마이크", MIC_MISSING_VALUE, "고른 마이크가 연결되어 있지 않아요. 다시 연결하면 그 마이크로 받아써요."], "unplugged");
  await pick(MIC_MISSING_VALUE);
  eq(posted("setMicInput"), [], "picking 연결되지 않은 마이크 changes nothing");
  rig.devices = [B, A];
  await act(() => { for (const fn of rig.deviceListeners) fn(); }); await flush();
  eq([chosen(), hint()], [A.id, "받아쓰기와 음성 대화에 쓸 마이크예요."], "plugged back in: chosen again, no notice");
  await mount(adult(), { devices: [B, { id: HEX("e"), label: A.label }], micInput: A });
  eq(chosen(), HEX("e"), "the same headset under a new id");
});

t("마이크 시험: 5 s from the chosen microphone, the real level, heard / not heard, then everything closed", async () => {
  await mount(adult(), { micInput: A });
  await act(() => click(byText("마이크 시험") as never)); await flush();
  eq(rig.constraints, [{ audio: { deviceId: { exact: A.id } } }], "the chosen microphone");
  const stopBtn = byText("시험 멈추기");
  eq(stopBtn?.getAttribute("aria-pressed"), "true", "the press is pressed while listening");
  eq(status(), "말해 보세요. 5초 동안 들어요.");
  await advance(500);
  ok(bar() && bar().getAttribute("aria-hidden") === "true" && bar().getAttribute("data-level") === "0.60", "the real level, decorative");
  // verify-4197: a hard deadline. Still listening 1 ms before 5000 ms from the start, finished at 5000 ms, never after.
  await advance(MIC_TEST_MS - 500 - 1);
  eq([status(), rig.tracksStopped], ["말해 보세요. 5초 동안 들어요.", 0], "listening at 4999 ms");
  await advance(1);
  eq([status(), rig.tracksStopped, rig.meter.closed, timers.length], ["소리가 들려요.", 1, 1, 0], "heard at 5000 ms; tracks stopped, meter closed, no timer left");
  ok(byText("마이크 시험") && !bar(), "back to the press, no bar");
  eq([posted("voiceTranscribe").length, posted("setMicInput").length], [0, 0], "nothing sent");

  rig.meter.value = 0;
  await act(() => click(byText("마이크 시험") as never)); await flush();
  await advance(MIC_TEST_MS + 200);
  eq(status(), "소리가 들리지 않았어요. 마이크가 켜져 있는지 확인해 주세요.", "silent");

  await act(() => click(byText("마이크 시험") as never)); await flush();
  await act(() => click(byText("시험 멈추기") as never));
  eq([rig.tracksStopped, rig.meter.closed, timers.length], [3, 3, 0], "stopped early: closed at once");

  await act(() => click(byText("마이크 시험") as never)); await flush();
  await render({ ...current, setting: false });
  eq([rig.tracksStopped, rig.meter.closed, timers.length], [4, 4, 0], "the dialog closing ends the test");
});

t("마이크 시험 is behind the disclosure and the explainer; a missing choice never opens the microphone", async () => {
  await mount(minor(), { acked: false });
  await act(() => click(byText("마이크 시험") as never)); await flush();
  eq(rig.constraints.length, 0, "disclosure not read: no microphone");
  ok(all((e) => e.tagName === "BUTTON" && e.textContent.trim() === "시작하기").length === 1, "the disclosure sheet is up");

  await mount(adult(), { permission: "prompt" });
  await act(() => click(byText("마이크 시험") as never)); await flush();
  eq(rig.constraints.length, 0, "the explainer first");
  ok(all((e) => e.textContent.includes("허용하기를 누르면")).length > 0, "its body");
  await act(() => click(byText("허용하기") as never)); await flush();
  eq(rig.constraints, [{ audio: true }], "then the test, from the default");
  await act(() => click(byText("시험 멈추기") as never));

  await mount(adult(), { micInput: A, devices: [B] });
  await act(() => click(byText("마이크 시험") as never)); await flush();
  eq([rig.constraints.length, status()], [0, "선택한 마이크가 연결되어 있지 않아요"], "missing: said, never the default");
});

t("마이크 시험 under reduced motion: the words, no moving bar", async () => {
  g.window.matchMedia = () => ({ matches: true });
  try {
    await mount(adult());
    await act(() => click(byText("마이크 시험") as never)); await flush();
    await advance(500);
    eq(bar(), undefined, "no bar");
    eq(status(), "말해 보세요. 5초 동안 들어요.");
    await advance(MIC_TEST_MS);
    eq(status(), "소리가 들려요.", "the result still comes");
  } finally { delete g.window.matchMedia; }
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).stack}`); fail++; }
  }
  void document;
  if (fail) { console.error(`${fail} failed`); process.exit(1); }
  console.log(`mic-input: ${tests.length} passed`);
  await act(() => root.unmount());
  process.exit(0);
})();
