import type { IconKind } from "./ChatDetails";
import { SOURCE_STATE_LABELS, normalizeSourceState } from "./evidenceDrawerLogic";

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
export type StatusIntent = "success" | "caution" | "info" | "neutral" | "danger";

export const STATUS_CHIPS: Readonly<Record<StatusChipState, { label: string; icon: IconKind; intent: StatusIntent }>> = {
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
