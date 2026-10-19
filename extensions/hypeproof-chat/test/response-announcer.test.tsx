// CGP-CHAT-R-001 — the response lifecycle reaches assistive tech once per turn.
// Bundled with esbuild and run with plain Node, like seat-vocabulary-render.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { responseAnnouncement } from "../webview-ui/src/responseAnnouncer";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };

let fail = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
};
const eq = (a: unknown, b: unknown) => { if (a !== b) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const classroom = { personal: false, stopped: false, failed: false };
const personal = { personal: true, stopped: false, failed: false };

t("classroom start is announced", () => eq(responseAnnouncement(false, true, classroom), "답변을 시작했어요"));
t("personal start stays with ResponsePending (no second announcement)", () => eq(responseAnnouncement(false, true, personal), ""));
t("completion is announced in both modes", () => {
  eq(responseAnnouncement(true, false, classroom), "답변이 끝났어요");
  eq(responseAnnouncement(true, false, personal), "답변이 끝났어요");
});
t("stop and error are not also announced as completion", () => {
  eq(responseAnnouncement(true, false, { ...classroom, stopped: true }), "");
  eq(responseAnnouncement(true, false, { ...personal, failed: true }), "");
});
t("negative control: no transition, no announcement", () => {
  eq(responseAnnouncement(false, false, classroom), null);
  eq(responseAnnouncement(true, true, classroom), null);
});

const noop = () => {};
const PROPS = {
  messages: [], streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
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
const config = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
const region = (html: string) => /<div class="hps-sr-only" role="status" aria-live="polite" data-testid="response-announcer">([^<]*)<\/div>/.exec(html);

for (const streaming of [false, true]) {
  t(`the announcer region renders and is silent on open (streaming=${streaming})`, () => {
    const m = region(renderToStaticMarkup(<ChatPanel {...PROPS} streaming={streaming} config={config} instructor={false} />));
    if (!m) throw new Error("announcer region missing");
    eq(m[1], "");
  });
}

if (fail) { console.error(`response-announcer: ${fail} failed`); process.exit(1); }
console.log("response-announcer OK");
