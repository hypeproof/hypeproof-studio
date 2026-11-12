// CGP-AGENT-R-002 / DES-CGP-AGENT-01 — the lesson's approval preset, read-only, left of the
// send button: text + lock icon, never a dropdown or button (no hover/press affordance). The
// tooltip on focus says the teacher chose it. The value comes from /v1/profile
// (`approval_preset`, approvalPreset.ts) and changes only at a turn boundary.
import { useEffect, useRef } from "react";
import { ChatIcon } from "./ChatDetails";
import { APPROVAL_PRESET_NAME, type ServedApprovalPreset } from "../../src/approvalPreset";

/**
 * What the label shows: while a turn runs it keeps the preset the turn started under; between
 * turns it follows the profile. Pure so the boundary rule is testable without a DOM.
 */
export function presetAtTurnBoundary(
  held: ServedApprovalPreset | null,
  served: ServedApprovalPreset | null,
  running: boolean,
): ServedApprovalPreset | null {
  return running ? held : served;
}

/** The preset to draw now; remembers the last idle value across a running turn. */
export function useTurnBoundaryPreset(served: ServedApprovalPreset | null, running: boolean): ServedApprovalPreset | null {
  const held = useRef(served);
  const shown = presetAtTurnBoundary(held.current, served, running);
  useEffect(() => { if (!running) held.current = served; });
  return shown;
}

export function approvalPresetTooltip(preset: ServedApprovalPreset): string {
  return `선생님이 정한 방식이에요. ${preset.description}`;
}

export function ApprovalPresetLabel({ preset }: { preset: ServedApprovalPreset | null }) {
  if (!preset) return null;
  const tooltip = approvalPresetTooltip(preset);
  return <span
    className="hps-approval-preset"
    data-approval-preset={preset.id}
    tabIndex={0}
    role="note"
    aria-label={`${APPROVAL_PRESET_NAME}: ${preset.label}. ${tooltip}`}
    data-hp-tooltip={`${preset.label} — ${tooltip}`}
  >
    <ChatIcon kind="lock" size={16} />
    <span className="hps-approval-preset-text">{preset.label}</span>
  </span>;
}
