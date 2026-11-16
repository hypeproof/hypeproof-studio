// Read-aloud voice hint (Jay, 2026-11-16), rendered for real (React on the minimal DOM) through the real VoiceProvider and
// ReadAloudButton with a scripted synthesizer:
// - on a Mac whose best Korean voice is the compact Yuna (or only novelty voices), the first reading shows one hint with
//   닫기 and tells the host it was shown; a second reading shows none; 닫기 hides it;
// - none when the host already recorded it, with a premium voice, or off a Mac;
// - the reading itself uses the ranked voice and the host is told the pick.
// Run: node scripts/run-tsx-tests.mjs read-aloud-voice
import { act as reactAct, createElement } from "react";
import { click, document, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { VoiceProvider, useVoiceController } from "../webview-ui/src/VoiceProvider";
import { ReadAloudButton, SpeechEnvContext, needsVoiceHint, reportVoicePick, setReadAloudVoicePrefs } from "../webview-ui/src/ReadAloudButton";
import { READ_ALOUD_VOICE_HINT } from "../src/voiceCopy";

type El = { tagName?: string; textContent: string; getAttribute(n: string): string | null; findAll(f: (e: El) => boolean): El[] };
const act: (fn: () => unknown) => Promise<void> = (reactAct as unknown as (fn: () => unknown) => Promise<void>);
const g = globalThis as unknown as { __posted: Array<Record<string, unknown>> };
const V1 = "hps-voice-policy/1";
let fail = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const host = mountPoint() as unknown as El;
const root = createRoot(host as unknown as HTMLElement);
const all = (f: (e: El) => boolean) => host.findAll(f);
const byText = (text: string) => all((e) => e.tagName === "BUTTON" && e.textContent.trim() === text)[0];
const posted = (type: string) => g.__posted.filter((m) => m.type === type);
const hint = () => all((e) => (e.getAttribute("class") ?? "").includes("hps-voice-hint") && e.getAttribute("role") === "note")[0];
const setPlatform = (p: string) => Object.defineProperty(globalThis.navigator, "platform", { configurable: true, value: p });

const ko = (name: string, uri: string) => ({ name, lang: "ko-KR", localService: true, voiceURI: uri });
const COMPACT = [ko("Eddy (Korean (South Korea))", "com.apple.eloquence.ko-KR.Eddy"), ko("Yuna", "com.apple.voice.compact.ko-KR.Yuna")];
const PREMIUM = [...COMPACT, ko("Yuna", "com.apple.voice.premium.ko-KR.Yuna")];
let voices = COMPACT;
const spoken: Array<{ voice: { voiceURI?: string } | null }> = [];
// A fresh env object per mount, so the window's hub is rebuilt (it is keyed on the env factory).
const envFor = () => () => ({
  synth: { getVoices: () => voices, cancel() {}, speak: (u: { voice: { voiceURI?: string } | null }) => { spoken.push(u); } },
  makeUtterance: (text: string) => ({ text, lang: "", rate: 1, voice: null, onend: null, onerror: null }),
  preferredVoiceUri: () => null,
  onVoicePicked: reportVoicePick,
});
function Harness({ env }: { env: () => unknown }) {
  const controller = useVoiceController({ profile_id: "p", voice: { dictation: true, read_aloud: true, policy_version: V1 } } as never, "s1", true);
  return createElement(VoiceProvider, { controller },
    createElement(SpeechEnvContext.Provider, { value: env as never },
      createElement("div", null, createElement(ReadAloudButton, { answerId: "a1", content: "첫 답이에요." }), createElement(ReadAloudButton, { answerId: "a2", content: "둘째 답이에요." }))));
}
async function mount() {
  await act(() => root.render(createElement("div")));
  g.__posted.length = 0; spoken.length = 0;
  await act(() => root.render(createElement(Harness, { env: envFor() })));
  await act(() => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): void } }).window.dispatchEvent({ type: "message", data: { type: "voiceDisclosureState", acknowledged: [V1] }, bubbles: false }); });
}
const read = (n: number) => act(() => click(all((e) => e.tagName === "BUTTON" && e.textContent.trim() === "읽어 주기")[n] as never));

t("no hint when the host already recorded it (this runs first: the once-per-window flag is still clear)", async () => {
  setPlatform("MacIntel"); voices = COMPACT; setReadAloudVoicePrefs({ readAloudVoiceHintShown: true });
  await mount(); await read(0);
  eq(spoken.at(-1)?.voice?.voiceURI, "com.apple.voice.compact.ko-KR.Yuna", "control: it read with the compact voice");
  eq([hint(), posted("readAloudVoiceHintShown").length], [undefined, 0], "already shown on this computer: no hint, nothing posted");
});

t("the hint rule: only a Mac whose best voice is compact, novelty or none", async () => {
  const pick = (tier: string | null) => ({ voice: null, tier, candidates: 1 }) as never;
  eq([needsVoiceHint(pick("compact"), true), needsVoiceHint(pick("novelty"), true), needsVoiceHint(pick(null), true)], [true, true, true], "a better voice can be downloaded");
  eq([needsVoiceHint(pick("premium"), true), needsVoiceHint(pick("enhanced"), true), needsVoiceHint(pick("other"), true)], [false, false, false], "already good, or not an Apple voice");
  eq([needsVoiceHint(pick("compact"), false), needsVoiceHint(null, true)], [false, false], "off a Mac (Windows: Heami only, a known limit), or before any reading");
});

t("a Mac with only the compact Yuna: one hint on the first reading, recorded on the host; none on the next; 닫기 hides it", async () => {
  setPlatform("MacIntel"); voices = COMPACT; setReadAloudVoicePrefs({});
  await mount();
  await read(0);
  eq(spoken[0]?.voice?.voiceURI, "com.apple.voice.compact.ko-KR.Yuna", "it reads with Yuna, not Eddy");
  eq(posted("readAloudVoicePicked").map((m) => [m.uri, m.tier, m.candidates]), [["com.apple.voice.compact.ko-KR.Yuna", "compact", 2]], "the host is told the pick");
  ok(hint() && hint().textContent.includes(READ_ALOUD_VOICE_HINT), "the hint is shown");
  eq(posted("readAloudVoiceHintShown").length, 1, "the host records it was shown");
  await act(() => click(byText("닫기") as never));
  eq(hint(), undefined, "닫기 hides it");
  await act(() => click(byText("그만 읽기") as never));
  await read(1);
  eq([hint(), posted("readAloudVoiceHintShown").length], [undefined, 1], "never again in this window");
});

t("a premium voice reads where one is installed; Windows reads with Heami", async () => {
  setPlatform("MacIntel"); voices = PREMIUM; setReadAloudVoicePrefs({});
  await mount(); await read(0);
  eq(spoken.at(-1)?.voice?.voiceURI, "com.apple.voice.premium.ko-KR.Yuna", "premium beats compact although both are named Yuna");
  setPlatform("Win32"); voices = [ko("Microsoft Heami - Korean (Korean)", "Microsoft Heami - Korean (Korean)")];
  await mount(); await read(0);
  eq(posted("readAloudVoicePicked").at(-1)?.tier, "other", "Windows: Heami");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  void document;
  if (fail) { console.error(`${fail} failed`); process.exit(1); }
  console.log(`read-aloud-voice: ${tests.length} passed`);
  await act(() => root.unmount());
  process.exit(0);
})();
