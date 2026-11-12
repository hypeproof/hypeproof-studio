// Studio voice in the real ChatPanel: not mounted without a voice block (byte-identical markup for every
// current seat), mounted with one, and the composer seam puts a transcript into the draft at the caret
// without sending. Server-rendered markup for the first two, the minimal DOM for the third.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { click, document, mountPoint } from "./fixtures/mini-dom.mjs";
import { act as reactAct, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { VoiceProvider, useVoiceController } from "../webview-ui/src/VoiceProvider";
import { dictationAddonFor } from "../webview-ui/src/dictationAddon";
import { SpeechEnvContext } from "../webview-ui/src/ReadAloudButton";
import type { ComposerAddon, ComposerAddonApi } from "../webview-ui/src/composerAddon";
import type { ChatConfig } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = reactAct as never;
let fail = 0;
const tests: Array<[string, () => void | Promise<void>]> = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// A server render derives useId values from the position in the React tree, so a wrapper above the panel
// renames them (":Rm7:" vs ":R2ot:"). A browser render numbers them in mount order and is not affected. The
// wrapper adds no element, so the comparison is on the markup with those tokens normalised.
const stableIds = (html: string) => html.replace(/:R[0-9a-z]+:/g, ":R:");

const noop = () => {};
const PROPS = {
  streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const profile = (voice?: unknown) => ({ profile_id: "adult-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX, ...(voice ? { voice } : {}) });
const config = (voice?: unknown) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: profile(voice),
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
}) as unknown as ChatConfig;
const personalOf = (cfg: ChatConfig) => ({ ...cfg, profile: { ...(cfg.profile as object), lesson: undefined }, taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } }) as unknown as ChatConfig;
const SEATS: Array<[string, (voice?: unknown) => ChatConfig]> = [["classroom", (v) => config(v)], ["personal", (v) => personalOf(config(v))]];
const MESSAGES = [
  { id: "u1", role: "user" as const, content: "안녕", createdAt: 1 },
  { id: "m1", role: "assistant" as const, content: "안녕하세요. 무엇을 만들까요?", createdAt: 2 },
];
const VOICE = { dictation: true, read_aloud: true, policy_version: "hps-voice-policy/1" };

const FAKE_SPEECH = () => ({ synth: { speak: noop, cancel: noop, getVoices: () => [] }, makeUtterance: (text: string) => ({ text, lang: "", rate: 1, voice: null, onend: null, onerror: null }) }) as never;

/** The way App wires voice: a controller from the served profile, a provider, and the addon only when it draws something. */
function Wired({ voice, inner }: { voice?: unknown; inner: (addon: ComposerAddon | undefined) => ReactNode }) {
  const cfg = config(voice);
  const controller = useVoiceController(cfg.profile as never, "a1:adult-a", true);
  return createElement(VoiceProvider, { controller }, createElement(SpeechEnvContext.Provider, { value: FAKE_SPEECH }, inner(dictationAddonFor(controller.value.availability))));
}
const panel = (cfg: ChatConfig, extra: Record<string, unknown> = {}) => createElement(ChatPanel, { ...PROPS, messages: MESSAGES, config: cfg, instructor: false, ...extra } as never);

for (const [seat, cfgOf] of SEATS) {
  t(`${seat}: no voice block, the markup is byte-identical with or without the voice wiring, and holds no voice at all`, () => {
    const bare = stableIds(renderToStaticMarkup(panel(cfgOf())));
    const wired = stableIds(renderToStaticMarkup(createElement(Wired, { inner: (addon) => panel(cfgOf(), { composerAddon: addon }) })));
    ok(bare.includes("data-message-id=\"m1\""), "the assistant answer rendered: the check below is not vacuous");
    ok(seat === "classroom" || bare.includes("hps-answer-actions"), "the personal answer row rendered");
    ok(bare.includes('class="hps-input'), "the composer rendered");
    ok(seat === "classroom" || bare.includes(":R:"), "the id normaliser matched something, so it is not hiding a difference by accident");
    ok(sha(bare) === sha(wired), `wiring changed the markup (sha ${sha(bare).slice(0, 12)} vs ${sha(wired).slice(0, 12)})`);
    ok(bare === wired, "byte-identical");
    for (const needle of ["hps-voice", "data-addon", "받아쓰기", "소리로 듣기", "음성", "이 수업에서는 쓸 수 없어요"]) ok(!bare.includes(needle), `unexpected ${needle}`);
  });

  t(`${seat}: a voice block that is off (both halves false, or an unknown policy version) is the same bytes as no block`, () => {
    const bare = stableIds(renderToStaticMarkup(panel(cfgOf())));
    for (const voice of [{ dictation: false, read_aloud: false, policy_version: "hps-voice-policy/1" }, { dictation: true, policy_version: "hps-voice-policy/2" }]) {
      const html = stableIds(renderToStaticMarkup(createElement(Wired, { voice, inner: (addon) => panel(cfgOf(voice), { composerAddon: addon }) })));
      ok(html === bare, `a non-served block changed the markup: ${JSON.stringify(voice)}`);
    }
  });

  t(`${seat}: voice served, the mic button and the read-aloud button are mounted`, () => {
    const html = renderToStaticMarkup(createElement(Wired, { voice: VOICE, inner: (addon) => panel(cfgOf(VOICE), { composerAddon: addon }) }));
    ok(html.includes("hps-voice-mic") && html.includes('aria-label="받아쓰기"'), "mic button");
    ok(html.includes('data-addon="true"'), "the composer marks the addon");
    ok(html.includes("hps-voice-listen") && html.includes('aria-label="소리로 듣기"'), "read-aloud on the answer");
    ok(/data-icon="mic"/.test(html) && /data-icon="speaker"/.test(html), "stroke icons, not emoji");
    ok(!/\p{Extended_Pictographic}/u.test(html.replace(/[\u{1F300}-\u{1FAFF}]/gu, "")), "no emoji in the voice markup");
    ok((html.match(/aria-label="소리로 듣기"/g) ?? []).length === 1, "once, on the one answer");
  });

  t(`${seat}: read-aloud only, no mic button and no composer marker`, () => {
    const voice = { dictation: false, read_aloud: true, policy_version: "hps-voice-policy/1" };
    const html = renderToStaticMarkup(createElement(Wired, { voice, inner: (addon) => panel(cfgOf(voice), { composerAddon: addon }) }));
    ok(!html.includes("hps-voice-mic") && !html.includes("data-addon"), "no mic, no addon marker");
    ok(html.includes('aria-label="소리로 듣기"'), "read-aloud only");
  });
}

t("an instructor panel never draws voice, even with the addon passed", () => {
  const html = renderToStaticMarkup(createElement(Wired, { voice: VOICE, inner: (addon) => panel(config(VOICE), { composerAddon: addon, instructor: true }) }));
  ok(!html.includes("hps-voice-mic") && !html.includes("data-addon"), "no composer addon for an instructor");
});

t("the text-flow files stay free of voice symbols: the seam is the only coupling", () => {
  const src = readFileSync("webview-ui/src/ChatPanel.tsx", "utf8");
  ok(!/voice|audio|microphone|speech|transcri|MediaRecorder|getUserMedia/i.test(src), "ChatPanel names no voice symbol");
  ok(/composerAddon/.test(src) && /AddonScope/.test(src), "the seam is there");
});

t("the composer takes a transcript at the caret, replaces a selection, never sends (real ChatPanel)", async () => {
  let api: ComposerAddonApi | null = null;
  const sent: unknown[] = [];
  const Probe = ({ children, api: a }: { children: ReactNode; api: ComposerAddonApi }) => { api = a; return children as never; };
  const addon: ComposerAddon = { Scope: Probe as ComponentType<{ api: ComposerAddonApi; children: ReactNode }>, Control: () => createElement("i", { className: "probe-control" }), Notice: () => createElement("i", { className: "probe-notice" }) };
  const host = mountPoint() as unknown as { findAll(f: (e: unknown) => boolean): Array<{ tagName: string; value?: string; textContent: string; setSelectionRange?: unknown }> };
  const root = createRoot(host as never);
  await act(() => root.render(panel(config(), { composerAddon: addon, onSend: (...a: unknown[]) => sent.push(a) })));
  const area = () => host.findAll((e) => (e as { tagName: string }).tagName === "TEXTAREA")[0] as unknown as { value: string; selectionStart: number; selectionEnd: number; focus(): void };
  ok(api, "the composer handed the addon its API");
  ok(host.findAll((e) => ((e as { getAttribute(n: string): string | null }).getAttribute("class") ?? "").includes("probe-control")).length === 1, "the control is in the button row");
  ok(host.findAll((e) => ((e as { getAttribute(n: string): string | null }).getAttribute("class") ?? "").includes("probe-notice")).length === 1, "the notice is above the text box");
  ok((api as unknown as ComposerAddonApi).disabled === false, "enabled with an activity");
  await act(() => { ok((api as unknown as ComposerAddonApi).insert("첫 문장") === true, "insert accepted"); });
  ok(area().value === "첫 문장", `draft is ${JSON.stringify(area().value)}`);
  await act(() => { (api as unknown as ComposerAddonApi).insert("두 번째"); });
  ok(area().value === "첫 문장 두 번째", `second insert appended with one space: ${JSON.stringify(area().value)}`);
  ok(sent.length === 0, "nothing was sent");
  void click; void document;
  await act(() => root.unmount());
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  if (fail) { console.error(`${fail} failed`); process.exit(1); }
  console.log(`voice-mount: ${tests.length} passed`);
  process.exit(0);
})();
