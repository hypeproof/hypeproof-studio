import type { IconKind } from "./ChatDetails";
import { SOURCE_STATE_LABELS, normalizeSourceState } from "./evidenceDrawerLogic";
import { TASK_RUN_STATE_LABELS, type TaskRunState } from "../../src/taskRunState";
import { DELEGATION_STATUS_LABEL, type DelegationStatus } from "../../src/delegationRow";
import type { VerifyView } from "../../src/verifyView";

/**
 * CGP-DS-D-004 (DES-CGP-DS-05, traces to CGP-DS-R-006) — the status chip vocabulary.
 *
 * One chip per state: a 16px stroke icon, a 14px label, a 4px radius, 8px inline padding and a
 * soft background tinted by the state's named intent. The five states must still read apart in a
 * grayscale capture, so each one has its own icon shape and its own wording, and `unverified`
 * also has a dashed edge; the tint is only the third cue (SX-50: state is never colour alone).
 *
 * The four source states take their wording from `SOURCE_STATE_LABELS` (SX-21: one vocabulary
 * for the data and the screen). `blocked` uses Chalk's board word, 막힘 (chalk/src/lib/board-status.ts).
 */
export type StatusChipState = "real" | "simulated" | "self_reported" | "unverified" | "blocked";

/**
 * CGP-DS-R-006 (REQ-CGP-DS-05) — the named intents every status chip in Studio speaks. The four
 * status intents (info / caution / danger / success) plus `neutral`, the "no evidence yet" intent
 * the `source_state` family uses for unverified and the other families use for an idle or stopped
 * state (DEC-DS-R-006). Each intent has its own colour (styles.css) and its own edge pattern, so a
 * grayscale capture tells the intents apart even before the icon and the words are read.
 */
export type StatusIntent = "success" | "caution" | "info" | "neutral" | "danger";
export const STATUS_INTENTS: readonly StatusIntent[] = ["info", "caution", "danger", "success", "neutral"];

/** What one chip draws: Korean words, a stroke icon and the intent that picks its colour and edge. */
export interface StatusChipView { label: string; icon: IconKind; intent: StatusIntent }

export const STATUS_CHIPS: Readonly<Record<StatusChipState, StatusChipView>> = {
  real: { label: SOURCE_STATE_LABELS.real!, icon: "check", intent: "success" },
  simulated: { label: SOURCE_STATE_LABELS.simulated!, icon: "flask", intent: "caution" },
  self_reported: { label: SOURCE_STATE_LABELS.self_reported!, icon: "pencil", intent: "info" },
  unverified: { label: SOURCE_STATE_LABELS.unverified!, icon: "help", intent: "neutral" },
  blocked: { label: "막힘", icon: "ban", intent: "danger" },
};

/**
 * Unknown or empty values read as `unverified`, never `real` (SX-46). `blocked` is the one state
 * outside the source-state enum, so it is accepted here by exact match only.
 */
export function statusChipState(state: unknown): StatusChipState {
  return state === "blocked" ? "blocked" : (normalizeSourceState(state) as StatusChipState);
}

// ─── CGP-DS-R-006: the other status families, each state with words, icon and intent ────────────

/** The personal task rail's run state (REQ-STUDIO-TASK-RUN-STATE). Words and icon stay in taskRunState.ts. */
const TASK_RUN_INTENT: Readonly<Record<TaskRunState, StatusIntent>> = {
  preparing: "info", running: "info", approval: "caution", stopped: "neutral", error: "danger", done: "success",
};
export const TASK_RUN_CHIPS: Readonly<Record<TaskRunState, StatusChipView>> = Object.fromEntries(
  (Object.keys(TASK_RUN_INTENT) as TaskRunState[]).map((s) => [s, { label: TASK_RUN_STATE_LABELS[s].label, icon: TASK_RUN_STATE_LABELS[s].icon, intent: TASK_RUN_INTENT[s] }]),
) as Record<TaskRunState, StatusChipView>;

/** A coach delegation row (REQ-STUDIO-DELEGATION-ROW). Words stay in delegationRow.ts. */
export const DELEGATION_CHIPS: Readonly<Record<DelegationStatus, StatusChipView>> = {
  running: { label: DELEGATION_STATUS_LABEL.running, icon: "dot", intent: "info" },
  done: { label: DELEGATION_STATUS_LABEL.done, icon: "check", intent: "success" },
  stopped: { label: DELEGATION_STATUS_LABEL.stopped, icon: "stop", intent: "neutral" },
  failed: { label: DELEGATION_STATUS_LABEL.failed, icon: "alert", intent: "danger" },
};

/** The product test panel's verification state (VerifyPanel). */
export type VerifyChipState = VerifyView["verification"]["state"];
export const VERIFY_CHIPS: Readonly<Record<VerifyChipState, StatusChipView>> = {
  verified: { label: "검증됨 · 이 버전에서 기대 조건을 모두 통과했어요", icon: "check", intent: "success" },
  failed: { label: "통과하지 못한 조건이 있어요", icon: "close", intent: "danger" },
  incomplete: { label: "확인되지 않은 조건이 있어요", icon: "alert", intent: "caution" },
  needs_recheck: { label: "파일이 바뀌었어요 · 다시 테스트해 주세요 (이전 결과는 남아 있어요)", icon: "retry", intent: "caution" },
  not_verified: { label: "이 버전은 아직 테스트하지 않았어요", icon: "help", intent: "neutral" },
};

/** One criterion's verdict in the product test panel. */
export const VERDICT_CHIPS: Readonly<Record<string, StatusChipView>> = {
  pass: { label: "통과", icon: "check", intent: "success" },
  fail: { label: "실패", icon: "close", intent: "danger" },
  warning: { label: "주의", icon: "alert", intent: "caution" },
  not_verified: { label: "확인 안 됨", icon: "help", intent: "neutral" },
  non_reproducible: { label: "결과가 매번 달라요", icon: "retry", intent: "danger" },
};

/**
 * A help request card (#751). The words come from the card (classroomHelp.ts STATUS_LABEL); a
 * status the Studio does not know keeps the card's own words with the neutral intent, never a
 * reassuring one. "강사 답변 도착 · 내 확인 전" is caution: the learner still has to confirm it.
 */
const HELP_LOOK: Readonly<Record<string, Omit<StatusChipView, "label">>> = {
  received: { icon: "send", intent: "info" },
  reviewing: { icon: "eye", intent: "info" },
  answered: { icon: "message", intent: "caution" },
  resolved: { icon: "check", intent: "success" },
};
const UNKNOWN_LOOK: Omit<StatusChipView, "label"> = { icon: "help", intent: "neutral" };

/** Own-key lookup: `__proto__`, `constructor` and friends are unknown states, not prototype members. */
function own<T>(table: Readonly<Record<string, T>>, key: unknown): T | undefined {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

export function helpChip(status: unknown, label: string): StatusChipView {
  return { label, ...(own(HELP_LOOK, status) ?? UNKNOWN_LOOK) };
}

/** A criterion verdict; an unknown one reads as not checked, never as passed (and never as a raw token). */
export function verdictChip(status: unknown): StatusChipView {
  return own(VERDICT_CHIPS, status) ?? VERDICT_CHIPS.not_verified!;
}

/** A verification state from the host; an unknown one reads as not tested, never as verified. */
export function verifyChip(state: unknown): StatusChipView {
  return own(VERIFY_CHIPS, state) ?? VERIFY_CHIPS.not_verified;
}
