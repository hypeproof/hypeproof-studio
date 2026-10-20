// CGP-DS-R-009 — the learner chooses a chat text size (기본 / 크게 / 아주 크게).
// Bundled with esbuild and run with plain Node, like seat-vocabulary-render.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { normalizeTextSize, TEXT_SIZES, TEXT_SIZE_LABELS } from "../src/textSize";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

t("three sizes with Korean labels", () => ok(TEXT_SIZES.map((s) => TEXT_SIZE_LABELS[s]).join("/") === "기본/크게/아주 크게", "labels"));
t("unknown values fall back to base (negative control)", () => { for (const v of [undefined, null, "huge", 3, "LARGE"]) ok(normalizeTextSize(v) === "base", String(v)); });

const noop = () => {};
const PROPS = {
  messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
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
const config = (textSize?: string) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
  ...(textSize ? { textSize } : {}),
}) as unknown as ChatConfig;
const shellAttr = (html: string) => /<div class="hps-shell"[^>]*?(?: data-text-size="([a-z]+)")?[^>]*>/.exec(html);

t("base size adds no attribute (existing renders unchanged)", () => ok(!/data-text-size=/.test(renderToStaticMarkup(<ChatPanel {...PROPS} config={config()} instructor={false} />)), "attribute on base"));
for (const size of ["large", "xlarge"]) t(`${size} marks the shell`, () => ok(renderToStaticMarkup(<ChatPanel {...PROPS} config={config(size)} instructor={false} />).includes(`data-text-size="${size}"`), "missing"));

const css = readFileSync("webview-ui/src/chatDetails.css", "utf8");
const tokens = readFileSync("webview-ui/src/tokens.css", "utf8");
// Effective value = the last rule in the file for that selector that sets font-size (same
// specificity, so the later one wins; media-query overrides are earlier in the file).
const lastSize = (sel: string) => { let v = ""; for (let i = css.indexOf(sel); i >= 0; i = css.indexOf(sel, i + 1)) { const m = /font-size: ([^;]+);/.exec(css.slice(i, css.indexOf("}", i))); if (m) v = m[1]; } return v; };
const P = '.hps-shell[data-chat-detail="personal"]';
// CGP-DS-R-008: sizes come from the semantic scale in tokens.css; the text-size choice is one step
// variable on the shell. The computed sizes (16/18/20 body, every caption +2/+4) are checked by
// test/type-scale.smoke.mjs, which runs the cascade.
t("personal base is 16px for body and composer (the steps build on the real base)", () => {
  ok(lastSize(`${P} .hps-msg-body {`) === "var(--hp-text-body)", `body base ${lastSize(`${P} .hps-msg-body {`)}`);
  ok(lastSize(`${P} .hps-input textarea {`) === "var(--hp-text-body)", `composer base ${lastSize(`${P} .hps-input textarea {`)}`);
  ok(/--hp-text-body: calc\(16px \+ var\(--hp-text-step\)\);/.test(tokens) && /--hp-text-step: 0px;/.test(tokens), "body token is 16px at step 0");
});
t("크게 / 아주 크게 are +2 / +4px over base for body, composer and reply choices", () => {
  ok(css.includes(`${P}[data-text-size="large"] { --hp-text-step: 2px; }`), "large step");
  ok(css.includes(`${P}[data-text-size="xlarge"] { --hp-text-step: 4px; }`), "xlarge step");
  ok(/:root, \.hps-shell \{[^}]*--hp-text-caption: calc\(14px \+ var\(--hp-text-step\)\)/.test(tokens), "size tokens are re-declared on the shell, where the step is set");
  for (const part of [".hps-reply-choices button", ".hps-choice-help button"]) ok(/^var\(--hp-text-[a-z]+\)$/.test(lastSize(`${P} ${part}`) || lastSize(`${part} {`)), `${part} uses a size token`);
});
t("no dead classroom rules: every size rule is scoped to personal chat", () => ok(!/\.hps-shell\[data-text-size=/.test(css), "classroom-only size rule present"));

const personal = { ...config("large"), profile: { ...config().profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } } as unknown as ChatConfig;
t("personal chat renders the picker with the saved size checked", () => {
  const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={personal} instructor={false} />);
  ok(html.includes("<legend>글자 크기</legend>"), "picker missing");
  for (const label of ["기본", "크게", "아주 크게"]) ok(html.includes(`<span>${label}</span>`), label);
  ok(/value="large" checked=""/.test(html) || /checked="" value="large"/.test(html), "saved size not checked");
  ok(html.includes('data-chat-detail="personal" data-text-size="large"'), "shell not marked");
});
const host = readFileSync("src/chatPanelProvider.ts", "utf8");
t("host stores the normalized choice and re-posts config", () => ok(/case "setTextSize":\s*\n\s*await this\.context\.globalState\.update\(TEXT_SIZE_KEY, normalizeTextSize\(msg\.size\)\);\s*\n\s*await this\.postConfig\(\);/.test(host), "handler"));

if (fail) { console.error(`text-size: ${fail} failed`); process.exit(1); }
console.log("text-size OK");
