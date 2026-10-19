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
// Effective size = the last rule in the file for that selector that sets font-size (same
// specificity, so the later one wins; media-query overrides are earlier in the file).
const lastPx = (sel: string) => { let px = NaN; for (let i = css.indexOf(sel); i >= 0; i = css.indexOf(sel, i + 1)) { const m = /font-size: (\d+)px/.exec(css.slice(i, css.indexOf("}", i))); if (m) px = +m[1]; } return px; };
const P = '.hps-shell[data-chat-detail="personal"]';
t("personal base is 16px for body and composer (the steps build on the real base)", () => {
  ok(lastPx(`${P} .hps-msg-body {`) === 16, `body base ${lastPx(`${P} .hps-msg-body {`)}`);
  ok(lastPx(`${P} .hps-input textarea {`) === 16, `composer base ${lastPx(`${P} .hps-input textarea {`)}`);
});
t("크게 / 아주 크게 are +2 / +4px over base for body, composer and reply choices", () => {
  for (const [part, base] of [[".hps-msg-body", 16], [".hps-input textarea", 16], [".hps-reply-choices button", 14], [".hps-choice-help button", 12]] as const) {
    ok(lastPx(`${P}[data-text-size="large"] ${part}`) === base + 2, `${part} large`);
    ok(lastPx(`${P}[data-text-size="xlarge"] ${part}`) === base + 4, `${part} xlarge`);
  }
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
