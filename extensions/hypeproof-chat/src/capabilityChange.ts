// REQ-STUDIO-CAPABILITY-CHANGE (CGP-SHELL-R-024): when a profile refresh changes what the AI can
// do on this seat, the learner sees one calm card in the chat before the next turn, saying what
// was added and what was removed, in the REQ-M47 card's own words (aiCapabilities.ts labels).
//
// Pure: no vscode import. The host feeds every served profile it publishes to the panel through
// `CapabilityChangeTracker.observe`, together with how the REQ-M47 card evaluates a profile right
// now (`seatAiCapabilities` under the current access choice, runtime setting and fallback), and
// passes the result on in the panel config; the panel's dismiss comes back through `dismiss`.
// Nothing is persisted: a new window is a first load.

import { accessProfile, type AccessChoiceView } from "./accessClient.ts";
import { AI_CAPABILITY_LABELS, aiCapabilities, type AiCapability, type AiCapabilityKey, type CapabilityChange } from "./aiCapabilities.ts";
import { resolveCoachRuntime } from "./chatPanelHelpers.ts";
import { finishNoticeApplies, type FinishSeat } from "./finishNotice.ts";
import { folderRemovedFeatures } from "./folderConsent.ts";
import { availableModelSelection } from "./modelSelection.ts";
import type { ResolvedProfile } from "./protocol";

// The copy lives next to the labels in aiCapabilities.ts, which the webview can import (this file reads folderConsent.ts, which is Node-only).
export { CAPABILITY_CHANGE_COPY } from "./aiCapabilities.ts";

export type { CapabilityChange } from "./aiCapabilities.ts";

/** What the learner chose on this machine; the same for both sides of a comparison. */
export interface SeatInputs {
  /** The selected access choice (pass / funding source), if any. */
  choice?: AccessChoiceView;
  /** The machine setting `hypeproofChat.coachRuntime`. */
  settingRuntime: "proxy" | "agent-sdk";
  /** An agent-sdk -> proxy fallback happened this session (REQ-M7): turns run on proxy. */
  fallback: boolean;
  /** Effective machine approval setting; display only, never a grant. */
  requiredApprovals?: readonly string[];
}

/** The runtime a profile's turns resolve to under the setting, as `postConfig` resolves `toolRuntime`. */
export function seatRuntime(profile: ResolvedProfile, settingRuntime: "proxy" | "agent-sdk"): "proxy" | "agent-sdk" {
  const selection = availableModelSelection(profile, settingRuntime);
  return selection?.source === "lesson" ? selection.runtime : resolveCoachRuntime({ settingRuntime, profileRuntime: profile.coach_runtime, minorCohort: profile.minor_cohort });
}

/**
 * The REQ-M47 card's rows for a served profile: the access choice applied (`accessProfile`), then
 * `aiCapabilities` under the effective runtime (proxy after a fallback). The card and the change
 * card both use this, so the change card can never report a row the card does not show.
 */
export function seatAiCapabilities(profile: ResolvedProfile, inputs: SeatInputs): AiCapability[] {
  return aiCapabilities(accessProfile(profile, inputs.choice), inputs.fallback ? "proxy" : seatRuntime(profile, inputs.settingRuntime), inputs.requiredApprovals);
}

/**
 * A folder-narrowed profile with the grants `narrowForFolder` (REQ-STUDIO-FOLDER-CONSENT) turned
 * off put back, so the learner's folder choice, which has its own question and line, is never
 * reported as a change. The host passes the un-narrowed cached profile anyway; this is defence in
 * depth. A display comparison only: it grants nothing.
 */
export function withoutFolderNarrowing(profile: ResolvedProfile): ResolvedProfile {
  const folder = folderRemovedFeatures(profile);
  const t = profile.sdk_tools;
  if (!t || !(folder.has("write") || folder.has("shell"))) return profile;
  return { ...profile, sdk_tools: { ...t, write: t.write || folder.has("write"), shell: t.shell || folder.has("shell") } };
}

/** The keys that are on for a served profile under the current inputs. */
export function seatCapabilityKeys(profile: ResolvedProfile | null | undefined, inputs: SeatInputs): AiCapabilityKey[] {
  if (!profile) return [];
  return seatAiCapabilities(withoutFolderNarrowing(profile), inputs).filter((c) => c.on).map((c) => c.key);
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
  profile: ResolvedProfile | null;
  /** The learner's current choices; both the remembered and the new profile are evaluated under them. */
  inputs: SeatInputs;
  instructor?: boolean;
  /** Local runtime: no REQ-M47 card, so no change card either. */
  local?: boolean;
}

/**
 * Remembers the served profile the learner was last told about and reports the difference once.
 * Both that profile and the new one are evaluated under the *current* inputs, so a change of the
 * access choice, the runtime setting or a fallback never makes a card by itself, and a profile
 * change those inputs mask stays silent. The baseline is the first profile in a scope (no card at
 * first load); it moves to the new profile when the card is dismissed, so the same profile on a
 * later refresh shows nothing again. A change undone before dismissal clears the card. A quiet
 * seat moves the baseline silently.
 */
export class CapabilityChangeTracker {
  private scope: string | null = null;
  private known: ResolvedProfile | null = null;
  private current: ResolvedProfile | null = null;
  private pending: CapabilityChange | null = null;
  private seq = 0;

  observe(o: CapabilityObservation): CapabilityChange | null {
    // An unresolved profile (failed or pending fetch) changes nothing.
    if (!o.profile) return this.pending;
    if (o.scope !== this.scope) {
      this.scope = o.scope;
      this.known = o.profile; this.current = o.profile; this.pending = null;
      return null;
    }
    this.current = o.profile;
    if (o.local || !capabilityChangeApplies(o.profile, o.instructor === true)) {
      this.known = o.profile; this.pending = null;
      return null;
    }
    const { added, removed } = diffCapabilities(seatCapabilityKeys(this.known, o.inputs), seatCapabilityKeys(o.profile, o.inputs));
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
