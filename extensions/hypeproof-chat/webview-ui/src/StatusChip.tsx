import { ChatIcon } from "./ChatDetails";
import { STATUS_CHIPS, statusChipState } from "./statusChipLogic";

/**
 * CGP-DS-D-004 — one status chip (styles.css `.hp-status-chip`). The icon is decoration: the
 * label beside it carries the state, and `data-status` keeps it in the markup for print and for
 * the e2e observers.
 */
export function StatusChip({ state, className }: { state: unknown; className?: string }) {
  const key = statusChipState(state);
  const chip = STATUS_CHIPS[key];
  return (
    <span className={className ? `hp-status-chip ${className}` : "hp-status-chip"} data-status={key} data-intent={chip.intent}>
      <ChatIcon kind={chip.icon} size={16} />
      <span className="hp-status-chip-label">{chip.label}</span>
    </span>
  );
}
