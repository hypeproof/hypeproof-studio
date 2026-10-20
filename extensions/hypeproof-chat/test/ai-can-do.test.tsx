// CGP-AGENT-R-003 — the "이 수업에서 AI가 할 수 있는 일" card lists exactly the seat's capabilities.
// Bundled with esbuild and run with plain Node, like seat-vocabulary-render.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { AI_CAPABILITY_LABELS, aiCapabilities, aiCapabilityState } from "../src/aiCapabilities";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const onKeys = (p: Parameters<typeof aiCapabilities>[0], r: "proxy" | "agent-sdk") => aiCapabilities(p, r).filter((c) => c.on).map((c) => c.key);

// Three representative profiles (a kids proxy class, a kids SDK class with files, an adult SDK seat).
const kidsProxy = { browser_control: { enabled: false } };
const kidsFiles = { sdk_tools: { read: true, write: true } };
const adult = { sdk_tools: { read: true, write: true, shell: true, subagents: true, browser: true }, tools: { web_search: true } };
t("six rows in REQ-M38 order, always", () => eq(aiCapabilities(null, "proxy").map((c) => c.key), ["read", "write", "shell", "subagents", "browser", "web_search"]));
t("kids proxy class: nothing on", () => eq(onKeys(kidsProxy, "proxy"), []));
t("kids SDK class with files: read and write only", () => eq(onKeys(kidsFiles, "agent-sdk"), ["read", "write"]));
t("adult SDK seat: everything the profile grants", () => eq(onKeys(adult, "agent-sdk"), ["read", "write", "shell", "subagents", "browser", "web_search"]));
t("never over-promises: file and command grants do not count on the proxy runtime", () => eq(onKeys(adult, "proxy"), ["web_search"]));
t("proxy browsing comes from browser_control, not sdk_tools", () => eq(onKeys({ browser_control: { enabled: true }, sdk_tools: { browser: false } }, "proxy"), ["browser"]));

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
const config = (caps?: ReturnType<typeof aiCapabilities>) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
  ...(caps ? { aiCapabilities: caps } : {}),
}) as unknown as ChatConfig;

t("card renders every row with 해요 / 안 해요 and stays closed", () => {
  const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={config(aiCapabilities(kidsFiles, "agent-sdk"))} instructor={false} />);
  // REQ-STUDIO-UI-POLISH-1: the summary also says how many things the AI does here (kidsFiles: read, write).
  if (!html.includes('<details class="hp-rail-lesson hp-ai-can-do"><summary><span class="hp-ai-can-do-title">이 수업에서 AI가 할 수 있는 일</span><span class="hp-ai-can-do-count">6가지 중 2가지')) throw new Error("card missing or open");
  eq((html.match(/data-capability="/g) ?? []).length, 6, "rows");
  if (!/data-capability="read" data-on="true"[^>]*>[\s\S]*?<span class="hp-ai-can-do-state">해요<\/span>/.test(html)) throw new Error("read on");
  if (!/data-capability="shell" data-on="false"[^>]*>[\s\S]*?<span class="hp-ai-can-do-state">안 해요<\/span>/.test(html)) throw new Error("shell off");
});
t("negative control: no card without capabilities", () => {
  if (renderToStaticMarkup(<ChatPanel {...PROPS} config={config()} instructor={false} />).includes("hp-ai-can-do")) throw new Error("card without data");
});
t("solo seats get no classroom or teacher words (trial diagnosis D3)", () => {
  const trial = { ...config(aiCapabilities(adult, "agent-sdk")), profile: { ...config().profile, activity_kind: "trial", profile_id: "studio-native-trial" }, activity: { id: "t1", name: "AI 체험", kind: "trial", workspace: "/tmp/t", verified: true } } as unknown as ChatConfig;
  const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={trial} instructor={false} />);
  const card = /<details class="hp-rail-lesson hp-ai-can-do">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  if (!card.includes("여기서 AI가 할 수 있는 일")) throw new Error("solo title missing");
  for (const word of ["수업", "선생님"]) if (card.includes(word)) throw new Error(`solo card says ${word}`);
});

// CGP-AGENT-D-002: assert the rendered words and names, never infer from colour.
t("approval-aware rows keep grants authoritative and expose a complete accessible name", () => {
  const rows = aiCapabilities(adult, "agent-sdk", ["writeFile", "delegateAgent", "webSearch"]);
  eq(rows.map(aiCapabilityState), ["해요", "물어봐요", "물어봐요", "물어봐요", "물어봐요", "물어봐요"]);
  const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={config(rows)} instructor={false} />);
  for (const row of rows) {
    const rendered = new RegExp(`<li[^>]*data-capability="${row.key}"[^>]*>[\\s\\S]*?</li>`).exec(html)?.[0] ?? "";
    if (!rendered.includes(`aria-label="${row.label}: ${aiCapabilityState(row)}"`)) throw new Error(`missing complete name: ${row.key}`);
    if (!rendered.includes(`<span class="hp-ai-can-do-state">${aiCapabilityState(row)}</span>`)) throw new Error(`missing state: ${row.key}`);
    if (!rendered.includes(`data-icon="${row.asks ? 'info' : 'check'}"`)) throw new Error(`wrong icon: ${row.key}`);
  }
  if (!html.includes("이미 허락했거나 확인이 필요 없는 동작은 바로 할 수 있어요.")) throw new Error("conditional approval explanation missing");
  const denied = [{ key: "write" as const, label: "파일 고치기", on: false, asks: true }];
  const deniedHtml = renderToStaticMarkup(<ChatPanel {...PROPS} config={config(denied)} instructor={false} />);
  if (!deniedHtml.includes('data-icon="minus"')) throw new Error("denied icon");
  if (!deniedHtml.includes('aria-label="파일 고치기: 안 해요"') || deniedHtml.includes("물어봐요")) throw new Error("denied capability must never promise an approval path");
  const askHtml = renderToStaticMarkup(<ChatPanel {...PROPS} config={config([{ ...denied[0], on: true }])} instructor={false} />);
  if (!askHtml.includes('aria-label="파일 고치기: 물어봐요"')) throw new Error("approval accessible name");
  if (renderToStaticMarkup(<ChatPanel {...PROPS} config={config(rows)} instructor={true} />).includes('hp-ai-can-do')) throw new Error("instructor card");
});

t("the browser row asks only where an approval exists: agent-sdk asks, proxy and a fallback run without a modal", () => {
  const grants = { ...adult, browser_control: { enabled: true } };
  const browserOf = (rows: ReturnType<typeof aiCapabilities>) => aiCapabilityState(rows.find((r) => r.key === "browser")!);
  eq(browserOf(aiCapabilities(grants, "agent-sdk")), "물어봐요");
  eq(browserOf(aiCapabilities(grants, "proxy")), "해요");
  eq(browserOf(aiCapabilities({ ...grants, browser_control: { enabled: false } }, "proxy")), "안 해요");
  const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={config(aiCapabilities({ browser_control: { enabled: true } } as never, "proxy"))} instructor={false} />);
  if (html.includes("물어봐요")) throw new Error("a proxy-only browser seat must not promise a prompt or explain one");
});

// CGP-SHELL-R-024 — the one-time "what the AI can do changed" card (REQ-STUDIO-CAPABILITY-CHANGE).
const change = { id: "cap-1", added: [AI_CAPABILITY_LABELS.web_search], removed: [AI_CAPABILITY_LABELS.shell] };
const withChange = (c: object | null) => ({ ...config(aiCapabilities(kidsFiles, "agent-sdk")), ...(c ? { capabilityChange: c } : {}) }) as unknown as ChatConfig;
t("change card: title, added and removed in the REQ-M47 words, a quiet dismiss, a status line", () => {
  const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={withChange(change)} instructor={false} />);
  const card = /<div class="hps-stop-notice hps-capability-change"[\s\S]*?<\/button><\/div>/.exec(html)?.[0] ?? "";
  if (!card) throw new Error("card missing");
  if (!card.includes('role="status"') || !card.includes('data-capability-change="cap-1"')) throw new Error("not a status line with its id");
  if (!card.includes("이제 AI가 할 수 있는 일이 바뀌었어요")) throw new Error("title");
  if (!card.includes('<p data-change="added">새로 생김 — 웹에서 찾아보기</p>')) throw new Error("added line");
  if (!card.includes('<p data-change="removed">이제 안 됨 — 명령 실행하기</p>')) throw new Error("removed line");
  if (!card.includes(">알겠어요</button>")) throw new Error("dismiss");
  for (const word of ["FRAMING", "JUDGMENT", "ORCHESTRATE", "VERIFY", "ADAPT", "OWNERSHIP", "점수"]) if (card.includes(word)) throw new Error(`capability-score label ${word}`);
  if (/<textarea[^>]*disabled/.test(html)) throw new Error("composer disabled by the card");
});
t("change card: only the lines that have entries", () => {
  const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={withChange({ ...change, removed: [] })} instructor={false} />);
  if (html.includes('data-change="removed"')) throw new Error("empty removed line drawn");
  if (!html.includes('data-change="added"')) throw new Error("added line missing");
});
t("negative controls: no change card without a change, or for an instructor", () => {
  if (renderToStaticMarkup(<ChatPanel {...PROPS} config={withChange(null)} instructor={false} />).includes("hps-capability-change")) throw new Error("card without a change");
  if (renderToStaticMarkup(<ChatPanel {...PROPS} config={withChange(change)} instructor={true} />).includes("hps-capability-change")) throw new Error("card for an instructor");
});

if (fail) { console.error(`ai-can-do: ${fail} failed`); process.exit(1); }
console.log("ai-can-do OK");
