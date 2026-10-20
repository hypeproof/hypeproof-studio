// CGP-KNOW-R-015 (REQ-STUDIO-ASK-ABOUT-FILE) — "이 파일에 대해 묻기" in the 작업 자료 file list.
// Mounted with react-dom/client on the minimal DOM (fixtures/mini-dom.mjs, loaded first) and driven
// by real clicks: the row button asks the host to attach that path (the host owns every check and
// the attach itself, see ask-about-file-host.smoke.mjs); the action is drawn only where the host
// granted file attach (never for instructors); the host's focus request lands in the composer and
// keeps the draft; nothing is sent. Bundled with esbuild and run with plain Node.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { TaskWorkspace } from "../webview-ui/src/TaskWorkspace";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { askAboutFileAllowed, ASK_ABOUT_FILE_LABEL } from "../webview-ui/src/askAboutFile";
import { buildFileAttachment } from "../src/fileAttachment";
import type { ArtifactProvenanceView } from "../src/artifactProvenanceView";
import type { ChatConfig } from "../src/protocol";

// TaskWorkspace checks `instanceof HTMLElement`; mini-dom's Element plays that role.
(globalThis as unknown as { HTMLElement?: unknown }).HTMLElement ??= (globalThis as unknown as { window: { Element: unknown } }).window.Element;
const posted = (globalThis as unknown as { __posted: { type: string; path?: string }[] }).__posted;
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type El = { localName: string; textContent: string; value: string; hidden?: boolean; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(test: (e: El) => boolean): El[]; className?: string };
const all = (test: (e: El) => boolean) => (doc as unknown as { documentElement: El }).documentElement.findAll(test);
const buttons = (text: string) => all((e) => e.localName === "button" && e.textContent === text);
const hostSays = (data: unknown) => act(async () => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: "message", data, bubbles: false }); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

const VIEW: ArtifactProvenanceView = {
  entries: [
    { path: "notes/plan.md", kind: "ai_created", label: "AI가 만듦", symbol: "✦", history: ["AI가 만듦"], at: 2 },
    { path: "index.html", kind: "none", label: "기록 없음", symbol: "○", history: [] },
  ],
  more: 0, unobserved: false, unconfirmed: false,
};
const WS = { scope: "s", revision: 1, activeTaskId: "a", tasks: [{ id: "a", title: "첫 작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };

async function mountWorkspace(onAsk?: (path: string) => void): Promise<{ root: Root; host: unknown }> {
  const host = mountPoint();
  const root = createRoot(host as never);
  await act(async () => { root.render(<TaskWorkspace view={WS as never} messages={[]} busy={false} error={null} onDismissError={() => {}} onAskAboutFile={onAsk}><textarea aria-label="메시지" /></TaskWorkspace>); });
  const toggle = all((e) => e.localName === "button" && (e.getAttribute("class") ?? "").includes("tw-sources-toggle"))[0];
  ok(toggle, "자료 toggle");
  await act(async () => { click(toggle); });
  await hostSays({ type: "artifactProvenance", view: VIEW });
  return { root, host };
}

t("each listed file has 이 파일에 대해 묻기; pressing it asks the host to attach that path and sends nothing", async () => {
  posted.length = 0;
  const asked: string[] = [];
  const { root } = await mountWorkspace((p) => asked.push(p));
  const asks = buttons(ASK_ABOUT_FILE_LABEL);
  eq(asks.length, 2, "one action per file");
  eq(asks.map((b) => b.getAttribute("aria-label")), ["이 파일에 대해 묻기: notes/plan.md", "이 파일에 대해 묻기: index.html"], "accessible names start with the visible text and name the file");
  ok(asks.every((b) => b.getAttribute("type") === "button"), "never a submit button");
  await act(async () => { click(asks[0]); });
  eq(asked, ["notes/plan.md"], "the row's own path");
  ok(!posted.some((m) => m.type === "send" || m.type === "sendMessage"), "nothing sent");
  await act(async () => { root.unmount(); });
});

t("in the narrow dialog layout the panel closes so the composer can take focus", async () => {
  const { root } = await mountWorkspace(() => {});
  const panel = all((e) => e.localName === "aside" && e.getAttribute("id") === "task-sources")[0];
  ok(panel && panel.getAttribute("role") === "dialog", "dialog layout at 1024px (control)");
  await act(async () => { click(buttons(ASK_ABOUT_FILE_LABEL)[0]); });
  ok(panel.hasAttribute("hidden"), "작업 자료 closed after asking");
  await act(async () => { root.unmount(); });
});

t("negative control: without the grant the list has no action", async () => {
  const { root } = await mountWorkspace(undefined);
  ok(all((e) => e.localName === "span" && e.textContent === "notes/plan.md").length === 1, "the list itself is drawn");
  eq(buttons(ASK_ABOUT_FILE_LABEL).length, 0, "no action");
  await act(async () => { root.unmount(); });
});

t("gate: offered only where the host granted file attach, never on the instructor surface", () => {
  eq(askAboutFileAllowed({ fileAttach: true } as ChatConfig), true, "granted learner seat");
  eq(askAboutFileAllowed({ fileAttach: true, isInstructor: true } as ChatConfig), false, "instructor");
  eq(askAboutFileAllowed({} as ChatConfig), false, "no grant (no sdk_tools.read)");
  eq(askAboutFileAllowed(null), false, "no config yet");
  const app = readFileSync("webview-ui/src/App.tsx", "utf8");
  ok(/onAskAboutFile=\{askAboutFileAllowed\(state\.config\) \? \(path: string\) => postToHost\(\{ type: "askAboutFile", path \}\) : undefined\}/.test(app), "App wires the list through the gate to the host message");
});

t("label: Korean, no capability name, 44px target at the caption step or larger", () => {
  eq(ASK_ABOUT_FILE_LABEL, "이 파일에 대해 묻기", "label");
  const css = readFileSync("webview-ui/src/taskWorkspace.css", "utf8");
  const rule = /\.tw-source-list \.tw-artifact-ask \{([^}]*)\}/.exec(css)?.[1] ?? "";
  ok(/min-height: 44px/.test(rule), "44px target");
  ok(/font-size: var\(--hp-text-(caption|body)\)/.test(rule), "type-scale token (≥14px)");
});

t("the host's focus request after an attach lands in the composer and keeps the draft", async () => {
  const UX = {
    coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
    suggestions: { initial: [], follow_up: [] },
    hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
    retry_button: { enabled: false, show_counter: false },
  };
  const config = {
    model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787", fileAttach: true,
    coach: { name: "HypeProof", personality: "", configured: true },
    profile: { profile_id: "p", activity_kind: "personal", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
    activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
    taskWorkspace: WS,
    activityDraft: { text: "이 부분이 궁금해", images: [], queued: null },
  } as unknown as ChatConfig;
  const noop = () => {};
  const props = {
    messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: () => { throw new Error("sent"); }, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
  };
  const file = buildFileAttachment("notes/plan.md", "# 내 계획\n", 12);
  const host = mountPoint();
  const root = createRoot(host as never);
  const render = (attachment: unknown) => root.render(<ChatPanel {...(props as never)} config={config} instructor={false} onAttachFile={noop} onRemoveFileAttachment={noop} fileAttachment={attachment as never} />);
  await act(async () => { render(null); });
  await hostSays({ type: "config", config });
  const ta = all((e) => e.localName === "textarea")[0];
  ok(ta, "composer");
  await act(async () => { render(file.preview); });
  await hostSays({ type: "focusInput", activityId: "p1" });
  await settle();
  ok((doc as unknown as { activeElement: unknown }).activeElement === ta, "composer focused");
  eq(ta.value, "이 부분이 궁금해", "draft kept");
  ok(all((e) => e.localName === "strong" && e.textContent === "파일 · notes/plan.md").length === 1, "file chip shown above the composer");
  await act(async () => { root.unmount(); });
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  if (fail) { console.error(`ask-about-file: ${fail} failed`); process.exit(1); }
  console.log("ask-about-file OK");
  process.exit(0);
})();
