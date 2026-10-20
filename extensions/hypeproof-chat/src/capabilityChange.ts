// REQ-STUDIO-CAPABILITY-CHANGE (CGP-SHELL-R-024): when a profile refresh changes what the AI can
// do on this seat, the learner sees one calm card in the chat before the next turn, saying what
// was added and what was removed, in the REQ-M47 card's own words (aiCapabilities.ts labels).
//
// Pure: no vscode import. The host feeds every resolved profile it publishes to the panel through
// `CapabilityChangeTracker.observe` and passes the result on in the panel config; the panel's
// dismiss comes back through `dismiss`. Nothing is persisted: a new window is a first load.

import { AI_CAPABILITY_LABELS, aiCapabilities, type AiCapabilityKey, type CapabilityChange } from "./aiCapabilities.ts";
import { finishNoticeApplies, type FinishSeat } from "./finishNotice.ts";
import { folderRemovedFeatures } from "./folderConsent.ts";
import type { ResolvedProfile } from "./protocol";

// The copy lives next to the labels in aiCapabilities.ts, which the webview can import (this file reads folderConsent.ts, which is Node-only).
export { CAPABILITY_CHANGE_COPY } from "./aiCapabilities.ts";

export type { CapabilityChange } from "./aiCapabilities.ts";

type CapabilityProfile = Pick<ResolvedProfile, "sdk_tools" | "tools" | "browser_control">;

/**
 * The capability keys the served profile turns on under `runtime`, before the learner's own
 * folder choice. `narrowForFolder` (REQ-STUDIO-FOLDER-CONSENT) records the grants it turned off;
 * they are put back here so a folder choice, which already has its own question and line, is
 * never reported as a lesson change. This is a display comparison only and grants nothing.
 */
export function servedCapabilityKeys(profile: CapabilityProfile | null | undefined, runtime: "proxy" | "agent-sdk"): AiCapabilityKey[] {
  if (!profile) return [];
  const folder = folderRemovedFeatures(profile as ResolvedProfile);
  const t = profile.sdk_tools;
  const served: CapabilityProfile = t && (folder.has("write") || folder.has("shell"))
    ? { ...profile, sdk_tools: { ...t, write: t.write || folder.has("write"), shell: t.shell || folder.has("shell") } }
    : profile;
  return aiCapabilities(served, runtime).filter((c) => c.on).map((c) => c.key);
}

/** Added and removed keys between two observations, in REQ-M38 order. */
export function diffCapabilities(before: readonly AiCapabilityKey[], after: readonly AiCapabilityKey[]): { added: AiCapabilityKey[]; removed: AiCapabilityKey[] } {
  const b = new Set(before), a = new Set(after);
  const order = Object.keys(AI_CAPABILITY_LABELS) as AiCapabilityKey[];
  return { added: order.filter((k) => a.has(k) && !b.has(k)), removed: order.filter((k) => b.has(k) && !a.has(k)) };
}

/**
 * Seats that get the card: personal work only (personal, trial, a bought pass). A classroom seat,
 * a seat with a served lesson or an enforced lesson binding, the instructor surface and an unknown
 * seat stay quiet. This is the stricter existing quiet rule (REQ-STUDIO-FINISH-NOTICE #2072, which
 * follows CGP-SHELL-R-001 `classUpdateHold` #1890); REQ-M47 does not say otherwise. In class the
 * closed REQ-M47 card already follows the new profile.
 */
export function capabilityChangeApplies(seat: FinishSeat, instructor = false): boolean {
  return finishNoticeApplies(seat, instructor);
}

export interface CapabilityObservation {
  /** Who and where: a different scope (token, activity) is a first load, never a change. */
  scope: string;
  /** The served profile (before access choice and folder narrowing); null when not resolved. */
  profile: (CapabilityProfile & NonNullable<FinishSeat>) | null;
  runtime: "proxy" | "agent-sdk";
  instructor?: boolean;
  /** Local runtime: no REQ-M47 card, so no change card either. */
  local?: boolean;
}

/**
 * Remembers what the learner was last told the AI can do and reports the difference once. The
 * baseline is the first observation in a scope (no card at first load); it moves to the new set
 * when the card is dismissed, so the same profile on a later refresh shows nothing again. A change
 * that is undone before dismissal clears the card. A quiet seat moves the baseline silently.
 */
export class CapabilityChangeTracker {
  private scope: string | null = null;
  private known: AiCapabilityKey[] = [];
  private current: AiCapabilityKey[] = [];
  private pending: CapabilityChange | null = null;
  private seq = 0;

  observe(o: CapabilityObservation): CapabilityChange | null {
    // An unresolved profile (failed or pending fetch) changes nothing.
    if (!o.profile) return this.pending;
    const keys = servedCapabilityKeys(o.profile, o.runtime);
    if (o.scope !== this.scope) {
      this.scope = o.scope;
      this.known = keys; this.current = keys; this.pending = null;
      return null;
    }
    this.current = keys;
    if (o.local || !capabilityChangeApplies(o.profile, o.instructor === true)) {
      this.known = keys; this.pending = null;
      return null;
    }
    const { added, removed } = diffCapabilities(this.known, keys);
    if (!added.length && !removed.length) { this.pending = null; return null; }
    const label = (k: AiCapabilityKey) => AI_CAPABILITY_LABELS[k];
    const same = this.pending && this.pending.added.join() === added.map(label).join() && this.pending.removed.join() === removed.map(label).join();
    if (!same) this.pending = { id: `cap-${++this.seq}`, added: added.map(label), removed: removed.map(label) };
    return this.pending;
  }

  /** The learner closed card `id`: what they were told is now what the AI can do. */
  dismiss(id: string): void {
    if (this.pending?.id !== id) return;
    this.known = this.current; this.pending = null;
  }
}
