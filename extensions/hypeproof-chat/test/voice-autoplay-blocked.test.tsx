// CGP-VOICE-R-028 / CGP-VOICE-D-021 (REQ-CGPV-41, DES-CGPV-41 autoplay part): blocked audio autoplay is
// recoverable by one click.
//
// Rendered for real on the minimal DOM with a served-voice profile (VoiceProvider, disclosure read) and
// a scripted synthesizer whose utterances the test can fail with `not-allowed` (the speech-synthesis
// form of the media NotAllowedError):
//   - a refused start is not shown as reading (no aria-pressed, no "읽는 중이에요");
//   - one quiet inline notice "소리가 막혔어요." with one action "소리 켜기": a real button, no dialog, no
//     focus move, announced once in the row's status;
//   - one press reads on from the first chunk that did not finish (nothing heard twice, nothing lost);
//   - 소리 끄기 (CGP-VOICE-R-002) clears the notice and a resume then speaks nothing;
//   - negative controls: another engine error is not the blocked notice; an unserved seat draws nothing.
// Run: node scripts/run-tsx-tests.mjs voice-autoplay-blocked
import { act as reactAct, createElement } from "react";
import { readFileSync } from "node:fs";
import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { VoiceProvider, useVoiceController } from "../webview-ui/src/VoiceProvider";
import { ReadAloudButton, SpeechEnvContext } from "../webview-ui/src/ReadAloudButton";
import { windowOutputMute } from "../src/voiceOutputMute";
import { ReadAloud } from "../src/voiceReadAloud";

type El = { tagName?: string; textContent: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(f: (e: El) => boolean): El[] };
const act: (fn: () => unknown) => Promise<void> = (reactAct as unknown as (fn: () => unknown) => Promise<void>);
const g = globalThis as unknown as { __posted: Array<Record<string, unknown>>; window: { dispatchEvent(e: unknown): void } };
const V1 = "hps-voice-policy/1";

let fail = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

type Utt = { text: string; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null };
interface Rig { spoken: Utt[]; cancels: number }
let rig: Rig;
const speechEnv = () => ({
  synth: { speak: (u: Utt) => { rig.spoken.push(u); }, cancel: () => { rig.cancels++; }, getVoices: () => [{ lang: "ko-KR", localService: true, name: "Yuna" }] },
  makeUtterance: (text: string) => ({ text, lang: "", rate: 1, voice: null, onend: null, onerror: null }),
});

const host = mountPoint() as unknown as El;
const root = createRoot(host as unknown as HTMLElement);
const all = (f: (e: El) => boolean) => host.findAll(f);
const cls = (e: El) => e.getAttribute("class") ?? "";
const listen = () => all((e) => e.tagName === "BUTTON" && cls(e).includes("hps-voice-listen"))[0];
const resumeButtons = () => all((e) => e.tagName === "BUTTON" && e.textContent.trim() === "소리 켜기");
const notices = () => all((e) => cls(e).split(" ").includes("hps-voice-blocked"));
const statusText = () => all((e) => e.getAttribute("role") === "status").map((e) => e.textContent).join(" | ");
const hostSays = (data: Record<string, unknown>) => act(() => { g.window.dispatchEvent({ type: "message", data, bubbles: false }); });
const press = (b: El) => act(() => click(b as never));
const fire = (fn: () => void) => act(fn);
// Long enough for several chunks: each sentence is ~70 characters, chunks hold 180.
const ANSWER = Array.from({ length: 12 }, (_, i) => `${i + 1}번째 문장이에요. 이 문장은 소리로 읽을 수 있을 만큼 충분히 길게 써 두었어요. 끝까지 들어 보세요.`).join(" ");

function Harness({ served }: { served: boolean }) {
  const profile = served ? { profile_id: "p", voice: { dictation: true, read_aloud: true, policy_version: V1 } } : { profile_id: "p" };
  const controller = useVoiceController(profile as never, "s1", true);
  return createElement(VoiceProvider, { controller },
    createElement(SpeechEnvContext.Provider, { value: speechEnv as never },
      createElement("div", { className: "hps-answer-actions" }, createElement(ReadAloudButton, { answerId: "a1", content: ANSWER }))));
}
async function mount(served = true) {
  rig = { spoken: [], cancels: 0 };
  g.__posted.length = 0;
  windowOutputMute.set(false);
  await act(() => root.render(createElement(Harness, { served, key: Math.random() })));
  await hostSays({ type: "voiceDisclosureState", acknowledged: [V1] });
}

// ============================================================================================
t("a refused start is not shown as reading; one quiet notice with one 소리 켜기 action", async () => {
  await mount();
  await press(listen());
  const queued = rig.spoken.length;
  ok(queued >= 3, `several chunks queued: ${queued}`);
  eq(listen().getAttribute("aria-pressed"), "true", "reading before the refusal");
  await fire(() => rig.spoken[0].onerror?.({ error: "not-allowed" }));
  eq(listen().getAttribute("aria-pressed"), "false", "a blocked reading is not shown as reading");
  ok(!statusText().includes("읽는 중이에요"), `not announced as reading: ${statusText()}`);
  eq(notices().length, 1, "exactly one notice");
  ok(notices()[0].textContent.includes("소리가 막혔어요."), notices()[0].textContent);
  eq(resumeButtons().length, 1, "exactly one action");
  eq(resumeButtons()[0].getAttribute("type"), "button", "a real, keyboard-reachable button");
  ok(statusText().includes("소리가 막혔어요."), `announced in the row's status: ${statusText()}`);
  eq(all((e) => e.tagName === "DIALOG" || e.getAttribute("role") === "dialog" || e.getAttribute("role") === "alertdialog").length, 0, "not a modal");
  ok(rig.cancels >= 1, "the refused queue was cancelled");
});

t("one press reads on from the first chunk that did not finish", async () => {
  await mount();
  await press(listen());
  const first = rig.spoken.slice();
  await fire(() => first[0].onend?.());
  await fire(() => first[1].onerror?.({ error: "not-allowed" }));
  const before = rig.spoken.length;
  await press(resumeButtons()[0]);
  const resumed = rig.spoken.slice(before).map((u) => u.text);
  eq(resumed, first.slice(1).map((u) => u.text), "the unheard chunks, in order: none repeated, none lost");
  eq(listen().getAttribute("aria-pressed"), "true", "reading again");
  eq(notices().length, 0, "the notice is gone after the press");
  // The resumed reading ends normally.
  const tail = rig.spoken.slice(before);
  for (const u of tail) await fire(() => u.onend?.());
  eq(listen().getAttribute("aria-pressed"), "false", "finished");
  eq(notices().length, 0, "shown once: no notice after a normal end");
});

t("소리 끄기 clears the notice and nothing is spoken after it", async () => {
  await mount();
  await press(listen());
  await fire(() => rig.spoken[0].onerror?.({ error: "not-allowed" }));
  eq(notices().length, 1);
  await act(() => { windowOutputMute.set(true); });
  eq(notices().length, 0, "the speaker switch clears the blocked notice");
  const hub = new ReadAloud(speechEnv() as never, windowOutputMute);
  eq(hub.resume("a1"), false, "nothing to resume on a fresh hub");
  await act(() => { windowOutputMute.set(false); });
});

t("negative controls: another engine error is not the blocked notice; an unserved seat draws nothing", async () => {
  await mount();
  await press(listen());
  await fire(() => rig.spoken[0].onerror?.({ error: "synthesis-failed" }));
  eq(notices().length, 0, "a failure that a press cannot fix is not offered as 소리 켜기");
  eq(listen().getAttribute("aria-pressed"), "false");
  await mount(false);
  // An unserved seat never reads aloud: at most the disabled class-off button, never an action or a notice.
  eq(all((e) => e.tagName === "BUTTON" && !e.hasAttribute("disabled")).length, 0, "voice not served: nothing to press");
  eq([notices().length, resumeButtons().length], [0, 0], "voice not served: no notice");
});

t("hub: resume is refused unless this answer is blocked; stop forgets the pending chunks", async () => {
  rig = { spoken: [], cancels: 0 };
  const hub = new ReadAloud(speechEnv() as never);
  eq(hub.resume("a1"), false, "idle");
  hub.play("a1", ANSWER);
  eq(hub.resume("a1"), false, "playing");
  rig.spoken[0].onerror?.({ error: "not-allowed" });
  eq(hub.getStatus(), { kind: "blocked", id: "a1" });
  eq(hub.resume("other"), false, "another answer");
  hub.stop();
  eq(hub.getStatus(), { kind: "idle" });
  eq(hub.resume("a1"), false, "stopped: nothing pending");
});

t("style: the notice has no motion and wraps; copy is one sentence + one action", async () => {
  const css = readFileSync("webview-ui/src/voice.css", "utf8");
  const rule = css.slice(css.indexOf(".hps-voice-blocked {")).split("}")[0];
  ok(rule.includes("animation: none") && rule.includes("transition: none"), "no motion");
  ok(rule.includes("flex-wrap: wrap") && rule.includes("font-size: var(--hp-font-caption)"), "wraps at 320px, >=14px");
});

void (async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  await act(() => root.unmount());
  if (fail) { console.error(`voice autoplay blocked: ${fail} failed`); process.exit(1); }
  console.log("voice autoplay blocked OK");
  // The mini DOM keeps timers alive (as voice-mute does): exit explicitly.
  process.exit(0);
})();
