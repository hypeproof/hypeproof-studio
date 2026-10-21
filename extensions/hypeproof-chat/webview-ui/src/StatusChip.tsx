import { ChatIcon } from "./ChatDetails";
import { STATUS_CHIPS, statusChipState, type StatusChipView } from "./statusChipLogic";

/**
 * CGP-DS-D-004 — one status chip (styles.css `.hp-status-chip`). The icon is decoration: the
 * label beside it carries the state, and `data-status` keeps it in the markup for print and for
 * the e2e observers.
 */
export function StatusChip({ state, className }: { state: unknown; className?: string }) {
  const key = statusChipState(state);
  return <IntentChip chip={STATUS_CHIPS[key]} status={key} className={className} />;
}

/**
 * CGP-DS-R-006 — the same chip for any status family (statusChipLogic.ts): words, a 16px icon and
 * the named intent. `attrs` carries a family's own data/test attributes and `role="status"`.
 */
export function IntentChip({ chip, status, className, attrs }: {
  chip: StatusChipView;
  status: string;
  className?: string;
  attrs?: Readonly<{ role?: "status" } & Record<`data-${string}`, string>>;
}) {
  return (
    <span {...attrs} className={className ? `hp-status-chip ${className}` : "hp-status-chip"} data-status={status} data-intent={chip.intent}>
      <ChatIcon kind={chip.icon} size={16} />
      <span className="hp-status-chip-label">{chip.label}</span>
    </span>
  );
}
