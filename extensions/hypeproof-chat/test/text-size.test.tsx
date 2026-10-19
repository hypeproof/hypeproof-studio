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
t("CSS: classroom 15/17px and personal 17/19px for body and composer", () => {
  for (const [sel, px] of [['.hps-shell[data-text-size="large"] .hps-msg-body', 15], ['.hps-shell[data-text-size="xlarge"] .hps-msg-body', 17],
    ['.hps-shell[data-chat-detail="personal"][data-text-size="large"] .hps-input textarea', 17], ['.hps-shell[data-chat-detail="personal"][data-text-size="xlarge"] .hps-input textarea', 19]] as const) {
    const i = css.indexOf(sel); ok(i >= 0, sel);
    ok(new RegExp(`font-size: ${px}px`).test(css.slice(i, css.indexOf("}", i))), `${sel} → ${px}px`);
  }
});
const host = readFileSync("src/chatPanelProvider.ts", "utf8");
t("host stores the normalized choice and re-posts config", () => ok(/case "setTextSize":\s*\n\s*await this\.context\.globalState\.update\(TEXT_SIZE_KEY, normalizeTextSize\(msg\.size\)\);\s*\n\s*await this\.postConfig\(\);/.test(host), "handler"));

if (fail) { console.error(`text-size: ${fail} failed`); process.exit(1); }
console.log("text-size OK");
