// CGP-AGENT-R-001 / R-002 / D-001 — the lesson's approval preset.
//
// The Service serves `approval_preset: {id, label, description}` on /v1/profile when the
// learner's frozen lesson version carries one (hypeproof-service
// worker/src/lib/lesson-approval-preset.ts, docs/requirements/lesson-approval-preset.md).
// The instructor picks it in Chalk; the learner only reads it (the label next to the
// composer is text, never a control).
//
// A preset only ever ADDS approvals on top of the app's own tiers (REQ-E1); it never removes
// one. An absent or unknown preset means the seat's default (`approvalModeFor` below): `auto`
// for personal and adult seats, today's tiers (`important_only`) for minor seats:
//   important_only  today's tiers (destructive shell confirm, browser per site, subagent, typing)
//   before_changes  + every file write and every shell command asks first
//   always_ask      before_changes, and nothing allowed earlier is remembered or offered to
//                   remember ("이번 작업 동안 이 명령 허용", "이 사이트 계속 허용")

export const APPROVAL_PRESET_IDS = ["always_ask", "before_changes", "important_only"] as const;
export type ApprovalPresetId = (typeof APPROVAL_PRESET_IDS)[number];

export interface ServedApprovalPreset {
  id: ApprovalPresetId;
  label: string;
  description: string;
}

const isId = (value: unknown): value is ApprovalPresetId =>
  typeof value === "string" && (APPROVAL_PRESET_IDS as readonly string[]).includes(value);
const line = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\r\n]/.test(value);

/**
 * The preset this seat runs under, or null. A block with an id this app does not know, or
 * with a missing/odd name, is ignored: the app cannot honour a preset it does not know, so
 * it must not claim one (and its own tiers stay in force).
 */
export function servedApprovalPreset(profile: { approval_preset?: unknown } | null | undefined): ServedApprovalPreset | null {
  const block = profile?.approval_preset as Partial<ServedApprovalPreset> | null | undefined;
  if (!block || typeof block !== "object" || !isId(block.id) || !line(block.label, 40) || !line(block.description, 200)) return null;
  return { id: block.id, label: block.label.trim(), description: block.description.trim() };
}

/** File writes and every shell command ask first. */
export const presetAsksBeforeChanges = (id: ApprovalPresetId | null | undefined): boolean =>
  id === "before_changes" || id === "always_ask";

/** Nothing allowed earlier in the task is remembered, and no "remember" option is offered. */
export const presetForgetsAllows = (id: ApprovalPresetId | null | undefined): boolean => id === "always_ask";

/**
 * The approval kinds that open a modal under this preset: the machine's own list
 * (`hypeproofChat.requireApprovalFor`) plus what the preset adds. Never fewer.
 */
export function presetRequiredKinds(required: readonly string[], id: ApprovalPresetId | null | undefined): string[] {
  const out = [...required];
  if (presetAsksBeforeChanges(id)) for (const kind of ["writeFile", "executeShell"]) if (!out.includes(kind)) out.push(kind);
  return out;
}

const RANK: Record<ApprovalPresetId, number> = { important_only: 1, before_changes: 2, always_ask: 3 };

/**
 * The stricter of two presets (null = no preset, the loosest). The host combines the preset the
 * turn started under with the live profile's, so a refresh during a turn (the cached profile is
 * null while it refetches, or a looser lesson arrives) never loosens approvals before the next
 * turn; a stricter one applies at once.
 */
export function stricterPreset(a: ApprovalPresetId | null | undefined, b: ApprovalPresetId | null | undefined): ApprovalPresetId | null {
  const ra = a ? RANK[a] : 0, rb = b ? RANK[b] : 0;
  return (ra >= rb ? a : b) ?? null;
}

/**
 * DEC-11 amended (Jay 2026-11-04: "그냥 안묻게 했으면 좋겠어"). With no lesson preset, a personal or
 * adult seat runs in `auto`: file writes and shell commands inside the work folder run without a modal
 * (shellFolderScope.ts decides what "inside" means for a destructive command). Irreversible or outward
 * acts still ask: publishing (once per repository, publishHost.ts), deleting or changing anything outside
 * the work folder, and opening a site that already asks. A minor seat keeps `important_only` (agent
 * assumption, not confirmed by Jay). A served preset always wins and only ever adds asks.
 */
export type ApprovalMode = ApprovalPresetId | "auto";
export function approvalModeFor(preset: ApprovalPresetId | null | undefined, minor: boolean, servedBlock = false): ApprovalMode {
  // A served block this app does not understand (unknown id, odd label) is not "no preset": the instructor chose
  // something, so the seat keeps today's tiers instead of auto (verify 2026-11-04 M1).
  return preset ?? (minor || servedBlock ? "important_only" : "auto");
}

/** The profile carries an `approval_preset` block at all, understood or not. */
export const approvalPresetBlockServed = (profile: { approval_preset?: unknown } | null | undefined): boolean =>
  profile?.approval_preset !== undefined && profile?.approval_preset !== null;
