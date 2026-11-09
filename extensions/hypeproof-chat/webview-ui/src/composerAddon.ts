// A seam in the composer for controls that are not part of the text flow. The composer hands an addon
// one small API and draws what comes back; it knows nothing about what the addon does. An absent addon
// draws nothing, so a seat without one renders exactly what it rendered before.
import type { ComponentType, ReactNode } from "react";

export interface ComposerAddonApi {
  /**
   * Put text into the draft at the caret (replacing a selection), caret after it, focus in the composer.
   * While a Korean IME composition is open the insert waits for `compositionend`. Returns false when the
   * text would not fit; the draft is then unchanged.
   */
  insert(text: string): boolean;
  /** True when the composer cannot take input now (no activity, missing folder, a question card open). */
  disabled: boolean;
}

/**
 * A static definition, so its components keep their identity across renders. `Scope` wraps the whole
 * composer area and holds the addon's state; `Control` is drawn in the button row, before Send;
 * `Notice` is drawn above the text box (status and recovery cards).
 */
export interface ComposerAddon {
  Scope: ComponentType<{ api: ComposerAddonApi; children: ReactNode }>;
  Control: ComponentType;
  Notice: ComponentType;
}

/** What a composer without an addon wraps its area in: nothing, no element of its own. */
export function PassThrough({ children }: { api?: ComposerAddonApi; children: ReactNode }) { return children as never; }

/** The longest draft the composer accepts (matches the paste limit in ChatPanel). */
export const DRAFT_LIMIT = 200_000;

export interface Inserted { value: string; caret: number }

/**
 * `text` at [start, end) of `value`, one space of separation where the neighbours are not already
 * space or a line break. Returns null when the result would pass `limit`.
 */
export function insertAtCaret(value: string, start: number, end: number, text: string, limit = DRAFT_LIMIT): Inserted | null {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { value, caret: from };
  const before = value.slice(0, from), after = value.slice(to);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const inserted = lead + clean + trail;
  const next = before + inserted + after;
  if (next.length > limit) return null;
  return { value: next, caret: before.length + lead.length + clean.length + trail.length };
}
