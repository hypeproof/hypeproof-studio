// CGP-CHAT-R-005 (REQ-STUDIO-ANSWER-VERDICT) — where "맞아요 / 고쳐야 해요" and the reasons render.
// Bundled with esbuild and run with plain Node, like edit-resend.test.tsx.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { VerdictReasons, NOTE_LABEL, REASONS_LABEL, VERDICT_PRIVACY } from "../webview-ui/src/AnswerVerdict";
import type { ChatConfig, ChatMessage } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
  onEditResend: () => true, onVerdict: noop,
};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const classroom = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
const personal = {
  ...classroom, profile: { ...(classroom as unknown as { profile: object }).profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
} as unknown as ChatConfig;

const u = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: 1 });
const a = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, createdAt: 1 });
const tool = (id: string): ChatMessage => ({ id, role: "tool", content: "", createdAt: 1, tool: { icon: "🔧", label: "Write(index.html)", state: "done" } });
const plain = [u("u1", "첫 질문"), a("a1", "첫 답"), u("u2", "고양이 그려 줘"), a("a2", "만들게요"), tool("t2"), a("a2#2", "고양이 답")];

const RIGHT = ">맞아요</button>";
const FIX = ">고쳐야 해요</button>";
const count = (html: string, needle: string) => html.split(needle).length - 1;
const render = (config: ChatConfig, extra: Record<string, unknown> = {}) => renderToStaticMarkup(<ChatPanel {...PROPS} config={config} instructor={false} messages={plain} {...extra} />);

t("personal: one pair per finished answer, on its last bubble, Korean text labels (positive control)", () => {
  const html = render(personal);
  ok(count(html, RIGHT) === 2 && count(html, FIX) === 2, `right ${count(html, RIGHT)} fix ${count(html, FIX)}`);
  const second = html.indexOf(RIGHT, html.indexOf(RIGHT) + 1);
  ok(second > html.indexOf("고양이 답"), "the split answer's pair is not under its last bubble");
  ok(html.indexOf(RIGHT) > html.indexOf("첫 답") && html.indexOf(RIGHT) < html.indexOf("고양이 그려 줘"), "first pair misplaced");
  ok(count(html, 'aria-pressed="false"') >= 4, "aria-pressed missing");
  ok(!html.includes(`aria-label="${REASONS_LABEL}"`), "reasons shown before 고쳐야 해요");
});
t("personal: not on user lines, not on the first bubble of a split answer (negative controls)", () => {
  const html = render(personal);
  const userLine = html.slice(html.indexOf("고양이 그려 줘"), html.indexOf("만들게요"));
  ok(!userLine.includes(RIGHT), "verdict under a user line");
  const firstBubble = html.slice(html.indexOf("만들게요"), html.indexOf("고양이 답"));
  ok(!firstBubble.includes(RIGHT), "verdict under the first bubble of a split answer");
});
t("personal: hidden on the answer that is still streaming; earlier answers keep theirs", () => {
  const live = [...plain, u("u3", "하나 더"), a("a3", "쓰는 중")];
  const html = render(personal, { messages: live, streaming: true, streamingId: "a3" });
  ok(count(html, RIGHT) === 2, `count ${count(html, RIGHT)}`);
  ok(html.lastIndexOf(RIGHT) < html.indexOf("쓰는 중"), "verdict under the live answer");
  ok(count(render(personal, { messages: live }), RIGHT) === 3, "control: the finished answer gets one");
});
t("reasons appear only for 고쳐야 해요, as a labelled group with the four Korean reasons", () => {
  const fix = render(personal, { verdicts: { "a2#2": { verdict: "fix" } } });
  ok(count(fix, `aria-label="${REASONS_LABEL}"`) === 1, "reasons group missing");
  for (const label of ["틀렸어요", "내가 원한 게 아니에요", "너무 어려워요", "기타"]) ok(fix.includes(`>${label}</button>`), label);
  ok(/aria-pressed="true"[^>]*><svg[^>]*data-icon="check"[^>]*aria-hidden="true">(?:(?!<\/svg>)[\s\S])*<\/svg>고쳐야 해요<\/button>/.test(fix), "고쳐야 해요 is not drawn pressed with a check mark");
  ok(fix.includes(VERDICT_PRIVACY), "privacy line missing");
  ok(!fix.includes(NOTE_LABEL), "note box before a reason was chosen");
  const right = render(personal, { verdicts: { "a2#2": { verdict: "right" } } });
  ok(!right.includes(`aria-label="${REASONS_LABEL}"`), "reasons under 맞아요");
  ok(/aria-pressed="true"[^>]*><svg[^>]*data-icon="check"[^>]*aria-hidden="true">(?:(?!<\/svg>)[\s\S])*<\/svg>맞아요<\/button>/.test(right), "맞아요 not pressed");
  ok(!/aria-pressed="true"[^>]*><svg[^>]*data-icon="check"[^>]*aria-hidden="true">(?:(?!<\/svg>)[\s\S])*<\/svg>맞아요<\/button>/.test(fix), "control: 맞아요 pressed under 고쳐야 해요");
});
t("a chosen reason opens the optional note (≤300) with the saved text", () => {
  const html = renderToStaticMarkup(<VerdictReasons state={{ verdict: "fix", reason: "other", note: "색이 어두워요" }} onChange={noop} />);
  ok(html.includes('maxLength="300"') && html.includes(`aria-label="${NOTE_LABEL}"`), "note box");
  ok(html.includes(">색이 어두워요</textarea>"), "saved note not shown");
  ok(html.includes(">저장</button>"), "save button");
  ok(count(html, 'aria-pressed="true"') === 1, "the chosen reason is not the only pressed one");
});
t("no verdicts in a classroom seat, a lesson, instructor mode or without the handler (negative controls)", () => {
  ok(count(render(classroom), RIGHT) === 0, "classroom");
  const lesson = { ...personal, profile: { ...(personal as unknown as { profile: object }).profile, lesson: { version: 1, content: { steps: [] } } } } as unknown as ChatConfig;
  ok(count(render(lesson), RIGHT) === 0, "lesson");
  ok(count(renderToStaticMarkup(<ChatPanel {...PROPS} config={personal} messages={plain} instructor={true} />), RIGHT) === 0, "instructor");
  ok(count(render(personal, { onVerdict: undefined }), RIGHT) === 0, "no handler");
  ok(count(render(personal), RIGHT) > 0, "control: personal still shows them");
});
t("no score-like copy anywhere in the verdict UI", () => {
  const html = render(personal, { verdicts: { "a2#2": { verdict: "fix", reason: "wrong" } } });
  for (const word of ["점수", "등급", "평가 결과", "%"]) ok(!html.slice(html.indexOf("고양이 답")).includes(word), word);
});

if (fail) { console.error(`answer-verdict: ${fail} failed`); process.exit(1); }
console.log("answer-verdict render OK");
