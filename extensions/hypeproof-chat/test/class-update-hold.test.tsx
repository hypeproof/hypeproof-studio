// CGP-SHELL-R-001 — no update install while a class seat is active.
// Bundled with esbuild and run with plain Node, like seat-vocabulary-render.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { classUpdateHold } from "../src/updateCheckerHelpers";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };

let fail = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
};
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

t("a classroom seat holds the install", () => ok(classUpdateHold({ activity_kind: "classroom" }) === true, "classroom"));
t("negative control: personal, trial and no profile do not hold", () => {
  for (const p of [{ activity_kind: "personal" }, { activity_kind: "trial" }, {}, null, undefined]) ok(classUpdateHold(p) === false, JSON.stringify(p));
});

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
const config = (heldForClass: boolean) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
  update: { version: "9.9.9", notes: "", releaseUrl: "https://example.org/r", sizeBytes: 0, heldForClass },
}) as unknown as ChatConfig;
const render = (c: ChatConfig) => renderToStaticMarkup(<ChatPanel {...PROPS} config={c} instructor={false} />);

t("held: the banner says when it can be installed and offers no install", () => {
  const html = render(config(true));
  ok(html.includes("새 버전 v9.9.9"), "banner missing");
  ok(html.includes("수업이 끝나면 설치할 수 있어요."), "hold copy missing");
  ok(!html.includes("hps-update-banner-install"), "install button rendered during class");
});
t("not held (positive control): install button and restart warning as before", () => {
  const html = render(config(false));
  ok(html.includes("hps-update-banner-install"), "install button missing outside class");
  ok(html.includes("업데이트하면 자동으로 재시작됩니다."), "restart copy missing");
});

const ext = readFileSync("src/extension.ts", "utf8") /* npm runs this from extensions/hypeproof-chat */;
t("the install command refuses before any download while held", () => {
  const body = ext.slice(ext.indexOf('registerCommand("hypeproof-chat.installUpdate"'));
  ok(body.indexOf("provider.isClassUpdateHeld()") > -1 && body.indexOf("provider.isClassUpdateHeld()") < body.indexOf("checkForUpdates("), "hold check is not first");
});

if (fail) { console.error(`class-update-hold: ${fail} failed`); process.exit(1); }
console.log("class-update-hold OK");
