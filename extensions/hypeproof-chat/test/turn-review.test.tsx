// AE-15 / CGP-ART-R-002 / CGP-AGENT-R-026 (#673) — the review bar draws exactly what the host measured.
// Bundled with esbuild and run with plain Node, like response-announcer.

import { renderToStaticMarkup } from "react-dom/server";
import { TurnReviewBar } from "../webview-ui/src/TurnReviewBar";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import type { TurnReviewView } from "../src/turnReviewView";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const has = (html: string, s: string) => { if (!html.includes(s)) throw new Error(`missing ${JSON.stringify(s)}`); };
const lacks = (html: string, s: string) => { if (html.includes(s)) throw new Error(`unexpected ${JSON.stringify(s)}`); };
const noop = () => {};
const bar = (view: TurnReviewView) => renderToStaticMarkup(<TurnReviewBar view={view} onRevert={noop} onKeep={noop} onClose={noop} />);
const OPEN: TurnReviewView = { turnId: "t1", state: "open", added: ["game/one.js", "new.png"], changed: ["index.html"], deleted: ["notes.md"], notCovered: [] };

t("open bar: count, grouped list, both choices", () => {
  const html = bar(OPEN);
  has(html, "AI가 이번에 바꾼 파일 4개");
  has(html, "<summary>바뀐 파일 보기</summary>");
  has(html, '<div class="hps-turn-review-group" data-kind="added"><strong>새로 만듦 2개</strong>');
  has(html, '<div class="hps-turn-review-group" data-kind="changed"><strong>바뀜 1개</strong>');
  has(html, '<div class="hps-turn-review-group" data-kind="deleted"><strong>지움 1개</strong>');
  has(html, "<code>game/one.js</code>");
  has(html, ">되돌리기</button>");
  has(html, ">이대로 둘게요</button>");
  has(html, "AI가 일하는 동안 내가 직접 고친 파일도 함께 셌어요.");
  has(html, "작업 폴더 밖에서 바뀐 것은 되돌리지 않아요");
  lacks(html, "disabled");
});
t("empty groups are not drawn", () => {
  const html = bar({ ...OPEN, added: [], deleted: [] });
  has(html, "AI가 이번에 바꾼 파일 1개");
  lacks(html, 'data-kind="added"');
  lacks(html, 'data-kind="deleted"');
});
t("not-covered files are named on the open bar", () => {
  has(bar({ ...OPEN, notCovered: ["video.mp4"] }), "너무 크거나 보관할 수 없는 파일은 되돌리지 않아요: video.mp4");
  lacks(bar(OPEN), "turn-review-not-covered");
});
t("restoring: both buttons disabled", () => {
  const html = bar({ ...OPEN, state: "restoring" });
  has(html, "되돌리는 중…");
  if ((html.match(/disabled=""/g) ?? []).length !== 2) throw new Error("buttons not disabled");
});
t("busy refusal is a notice on the same bar", () => {
  has(bar({ ...OPEN, notice: "진행 중인 작업이 끝난 뒤에 되돌릴 수 있어요." }), "진행 중인 작업이 끝난 뒤에 되돌릴 수 있어요.");
});
t("restored: verified count, kept pre-restore state, external note, no choice buttons", () => {
  const html = bar({ ...OPEN, state: "restored", restoredCount: 4, beforeRestoreKept: true, failed: [] });
  has(html, "이번 요청 전으로 되돌렸어요. 파일 4개가 그대로 돌아온 것을 확인했어요.");
  has(html, "되돌리기 직전 상태도 따로 보관해 뒀어요.");
  has(html, "작업 폴더 밖에서 바뀐 것은 되돌리지 않아요");
  has(html, ">확인</button>");
  lacks(html, ">되돌리기</button>");
});
t("negative control: a partial failure never reads as success and names the files", () => {
  const html = bar({ ...OPEN, state: "failed", restoredCount: 3, failed: ["index.html"], beforeRestoreKept: true });
  has(html, "일부 파일을 되돌리지 못했어요");
  has(html, "<code>index.html</code>");
  has(html, 'role="alert"');
  lacks(html, "되돌렸어요.");
});
t("nothing changed when the pre-revert state could not be kept", () => {
  const html = bar({ ...OPEN, state: "failed", failed: [], nothingChanged: true, beforeRestoreKept: false });
  has(html, "아무 파일도 바꾸지 않았어요");
  lacks(html, "일부 파일을 되돌리지 못했어요");
  lacks(html, "직전 상태");
});

// The default chat render has no bar (the host sends one only after a turn changed files), so the A5 digests stay.
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
const config = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
t("default chat render draws no review bar", () => {
  lacks(renderToStaticMarkup(<ChatPanel {...PROPS} config={config} instructor={false} />), "turn-review");
});

if (fail) { console.error(`turn-review: ${fail} failed`); process.exit(1); }
console.log("turn-review OK");
