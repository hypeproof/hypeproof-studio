// CGP-SHELL-R-010 / CGP-SHELL-D-009 (REQ-SHELL-10, DES-SHELL-09): Studio explains the microphone in its
// own Korean words before the OS permission prompt, and only at the step that needs it.
//
// Rendered for real on the minimal DOM: the composer's dictation control under a served-voice profile
// (disclosure read), with a scripted recorder and a scripted permission answer. `getUserMedia` is the
// only call that can raise the OS prompt, so the test counts it.
//   - nothing asks at mount (no permission query, no getUserMedia);
//   - permission `prompt` / `unknown`: the first press draws an inline card (not a dialog) with the mic
//     glyph, "목소리로 말하려면 마이크가 필요해요", 허용하기 (focused) and 나중에; getUserMedia is called
//     only after 허용하기;
//   - 나중에 calls nothing and the text flow is untouched; the next press goes straight on;
//   - negative controls: `granted` (no prompt will come) and `denied` (the denied card explains) draw no
//     explainer; a denial after 허용하기 still ends in the existing denied card with 글로 계속하기.
// Run: node scripts/run-tsx-tests.mjs voice-mic-explainer
import { act as reactAct, createElement } from "react";
import { click, document, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { VoiceProvider, useVoiceController } from "../webview-ui/src/VoiceProvider";
import { DICTATION_ADDON, dictationAddonFor } from "../webview-ui/src/dictationAddon";
import { DictationEnvContext } from "../webview-ui/src/DictationControl";
import { needsMicExplainer, type MicPermission } from "../src/voiceDictation";

type El = { tagName?: string; textContent: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(f: (e: El) => boolean): El[] };
const act: (fn: () => unknown) => Promise<void> = (reactAct as unknown as (fn: () => unknown) => Promise<void>);
const g = globalThis as unknown as { __posted: Array<Record<string, unknown>>; window: { dispatchEvent(e: unknown): void } };
const V1 = "hps-voice-policy/1";
const realError = console.error;
console.error = (...args: unknown[]) => { if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return; realError(...args); };

let fail = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const host = mountPoint() as unknown as El;
const root = createRoot(host as unknown as HTMLElement);
const all = (f: (e: El) => boolean) => host.findAll(f);
const byLabel = (label: string) => all((e) => e.tagName === "BUTTON" && e.getAttribute("aria-label") === label)[0];
const byText = (text: string) => all((e) => e.tagName === "BUTTON" && e.textContent.trim() === text);
const explainer = () => all((e) => (e.getAttribute("class") ?? "").split(" ").includes("hps-voice-explain"));
const hostSays = (data: Record<string, unknown>) => act(() => { g.window.dispatchEvent({ type: "message", data, bubbles: false }); });
const flush = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); });
const press = async (b: El | undefined) => { ok(b, "button exists"); await act(() => click(b as never)); await flush(); };

class FakeRecorder {
  static isTypeSupported(m: string) { return m === "audio/webm;codecs=opus"; }
  state = "inactive"; ondataavailable: ((e: unknown) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  start() { this.state = "recording"; }
  stop() { if (this.state === "inactive") return; this.state = "inactive"; queueMicrotask(() => this.onstop?.()); }
}
interface Rig { mediaCalls: number; permissionQueries: number; permission: MicPermission | null; deny: boolean }
let rig: Rig;
const dictEnv = () => ({
  ...(rig.permission === null ? {} : { micPermission: async () => { rig.permissionQueries++; return rig.permission as MicPermission; } }),
  getUserMedia: async () => {
    rig.mediaCalls++;
    if (rig.deny) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    return { getTracks: () => [{ stop() {} }] };
  },
  Recorder: FakeRecorder as never,
  now: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
});
const SERVED = { profile_id: "p", voice: { dictation: true, read_aloud: false, policy_version: V1 } };
function Harness({ profile, forceAddon }: { profile: unknown; forceAddon?: boolean }) {
  const controller = useVoiceController(profile as never, "s1", true);
  // forceAddon mounts the control even where the composer would not (each guard is tested on its own).
  const addon = forceAddon ? DICTATION_ADDON : dictationAddonFor(controller.value.availability);
  const api = { insert: () => true, disabled: false };
  return createElement(VoiceProvider, { controller },
    createElement(DictationEnvContext.Provider, { value: dictEnv as never },
      addon ? createElement(addon.Scope, { api }, createElement("div", { className: "composer" }, createElement(addon.Notice), createElement(addon.Control))) : null));
}
async function mount(permission: MicPermission | null, deny = false, profile: unknown = SERVED, forceAddon = false) {
  rig = { mediaCalls: 0, permissionQueries: 0, permission, deny };
  g.__posted.length = 0;
  await act(() => root.render(createElement(Harness, { profile, forceAddon, key: Math.random() })));
  await hostSays({ type: "voiceDisclosureState", acknowledged: [V1] });
}
const mic = () => byLabel("받아쓰기");
const recording = () => !!byLabel("받아쓰기 끝내기");

// ============================================================================================
t("nothing asks at mount: no permission query, no getUserMedia", async () => {
  await mount("prompt");
  ok(mic(), "the mic button is drawn");
  eq([rig.permissionQueries, rig.mediaCalls], [0, 0]);
  eq(explainer().length, 0, "no card before the learner presses");
});

t("prompt: the first press shows Studio's own inline card before any OS prompt", async () => {
  await mount("prompt");
  await press(mic());
  eq(rig.mediaCalls, 0, "getUserMedia was not called before the explanation");
  eq(explainer().length, 1, "one card");
  const card = explainer()[0];
  ok(card.textContent.includes("목소리로 말하려면 마이크가 필요해요"), card.textContent);
  ok(card.textContent.includes("허용하지 않아도 글로는 계속 이야기할 수 있어요."), "says text keeps working");
  eq(card.getAttribute("role"), "group", "an inline group, labelled by its title");
  eq(all((e) => e.tagName === "DIALOG" || e.getAttribute("role") === "dialog").length, 0, "not a modal");
  eq(card.findAll((e) => e.tagName === "svg" || e.tagName === "SVG").map((s) => s.getAttribute("data-icon")), ["mic"], "the device glyph");
  eq([byText("허용하기").length, byText("나중에").length], [1, 1], "one primary, one secondary");
  eq((document as unknown as { activeElement: El | null }).activeElement?.textContent, "허용하기", "focus lands on 허용하기");
});

t("허용하기 is the step that raises the OS prompt, and recording starts", async () => {
  await mount("prompt");
  await press(mic());
  await press(byText("허용하기")[0]);
  eq(rig.mediaCalls, 1, "getUserMedia once, right after 허용하기");
  ok(recording(), "recording");
  eq(explainer().length, 0, "the card is gone");
});

t("나중에 calls nothing; the next press goes straight on (one explanation per control)", async () => {
  await mount("unknown");
  await press(mic());
  eq(explainer().length, 1, "unknown permission also explains");
  await press(byText("나중에")[0]);
  eq([rig.mediaCalls, explainer().length], [0, 0], "nothing asked, card gone");
  ok(!recording(), "not recording");
  await press(mic());
  eq(explainer().length, 0, "not shown twice");
  eq(rig.mediaCalls, 1, "the second press asks the OS directly");
});

t("negative controls: granted and denied draw no explainer; an older env without the query starts directly", async () => {
  await mount("granted");
  await press(mic());
  eq([explainer().length, rig.mediaCalls], [0, 1], "granted: no prompt will come, so no card");
  await mount("denied", true);
  await press(mic());
  eq(explainer().length, 0, "denied: no card");
  ok(all((e) => e.textContent.trim() === "마이크를 쓸 수 없어요").length > 0, "the denied card explains instead");
  await mount(null);
  await press(mic());
  eq([explainer().length, rig.mediaCalls], [0, 1], "no permission query available in the env: unchanged behaviour");
});

t("a denial after 허용하기 keeps text chat working with a way to retry", async () => {
  await mount("prompt", true);
  await press(mic());
  await press(byText("허용하기")[0]);
  eq(rig.mediaCalls, 1);
  ok(byText("마이크 설정 열기").length === 1 && byText("글로 계속하기").length === 1, "settings and continue-in-text");
  await press(byText("글로 계속하기")[0]);
  ok(mic() && !mic().hasAttribute("disabled"), "the mic button is back for a retry");
});

t("not served: no card, no permission query, no microphone request, whatever the shortcut or the seat", async () => {
  const unserved = [{ profile_id: "p" }, { profile_id: "p", voice: { dictation: false, read_aloud: true, policy_version: V1 } }, { profile_id: "p", voice: { dictation: true, policy_version: "hps-voice-policy/99" } }];
  for (const [profile, forceAddon] of unserved.flatMap((p) => [[p, false], [p, true]] as const)) {
    await mount("prompt", false, profile, forceAddon);
    eq(mic(), undefined, `no mic button: ${JSON.stringify(profile)}`);
    // The in-app shortcut is bound by the button; with no button there is nothing to press or type.
    await act(() => { g.window.dispatchEvent({ type: "keydown", altKey: true, shiftKey: true, code: "KeyM", key: "M", bubbles: true, preventDefault() {}, stopPropagation() {} }); });
    await flush();
    eq([explainer().length, rig.permissionQueries, rig.mediaCalls], [0, 0, 0], `nothing asked: ${JSON.stringify(profile)} forced=${forceAddon}`);
  }
});

t("pure rule", async () => {
  eq((["granted", "denied", "prompt", "unknown"] as MicPermission[]).map((p) => needsMicExplainer(p, false)), [false, false, true, true]);
  eq(needsMicExplainer("prompt", true), false, "once per control");
});

void (async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  await act(() => root.unmount());
  if (fail) { console.error(`voice mic explainer: ${fail} failed`); process.exit(1); }
  console.log(`voice mic explainer: ${tests.length} passed`);
  process.exit(0);
})();
