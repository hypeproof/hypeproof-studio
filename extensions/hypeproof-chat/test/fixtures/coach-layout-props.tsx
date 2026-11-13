// Props shared by test/coach-layout-compact.test.tsx and the golden-markup capture (HEAD 7ea4479f): one definition, so the
// golden fixtures and the "flag absent" render are made from the same inputs. Uses only APIs that exist at HEAD.
import { aiCapabilities } from "../../src/aiCapabilities";
import type { ChatConfig } from "../../src/protocol";

export const H = "다음에 해볼 만한 것";
export const STEPS = `설명이에요.\n\n${H}\n→ 색을 바꿔 보기\n→ 제목을 더 크게`;
export const FOLLOW_UP = [{ text: "정적인 이어가기", style: "good" as const }];
const ux = (layout?: string) => ({
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: FOLLOW_UP },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
  ...(layout === undefined ? {} : { coach_layout: layout }),
});
export const config = (layout?: string) => ({
  model: "m", hasToken: true, proxyUrl: "http://localhost:8787", fileAttach: true, materials: true,
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "p", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: ux(layout) },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
  aiCapabilities: aiCapabilities({ sdk_tools: { read: true, write: true } }, "agent-sdk"),
}) as unknown as ChatConfig;
/** A cohort-managed model (its reason is the select's aria-describedby) and a usage panel to draw. */
export const managed = (layout?: string, access: object = { status: "unknown" }) => {
  const base = config(layout) as unknown as Record<string, any>;
  return { ...base, model: "m1", cohortSettings: { model: true }, access,
    profile: { ...base.profile, model_selection: { source: "cohort", choices: [{ id: "c1", alias: "m1", label: "모델 하나" }, { id: "c2", alias: "m2", label: "모델 둘" }] } } } as unknown as ChatConfig;
};
const noop = () => {};
export const PROPS = {
  streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop, onAttachFile: noop,
};
export const CONVERSATION = [{ id: "u1", role: "user", content: "홈페이지 만들어 줘" }, { id: "a1", role: "assistant", content: STEPS }];
export const PROCESSES = [
  { id: "live:1", purpose: "미리보기 서버", kind: "preview", folder: "site", address: "127.0.0.1:1", state: "running" },
  { id: "sdk:1", purpose: "테스트 감시", kind: "shell", state: "running" },
];
