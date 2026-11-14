/**
 * Guardian account / child profile, app-side posture only (docs/requirements/guardian-child-profile.md,
 * GRD-08, GRD-09, GRD-10, GRD-19 client part, GRD-23, GRD-24; Studio #3847). Pure: no VS Code API.
 *
 * A child seat is a `/v1/profile` with `child_profile: true` (proposed Service contract; the Service
 * also serves `minor_cohort: true`). This slice changes nothing on the Service and adds no route.
 *
 * Switch: `hypeproofChat.guardianEnabled`, the app-side mirror of the proposed Service switch
 * `HPS_GUARDIAN` (GRD-23). Default off. While it is off, `child_profile` is ignored and every
 * profile passes through unchanged, so the app behaves exactly as before.
 *
 * While it is on, a child seat fails closed (GRD-08):
 * - the profile counts as minor even without `minor_cohort`, so every existing minor gate applies
 *   (publish gate, store seat, orchestrator, proxy runtime, browser safety, memory overview);
 * - the capability blocks that open an outward act are closed in the profile itself, so a gate that
 *   reads the block directly (gallery publish, automations, Curriculum Runtime, analytics upload,
 *   email opt-in) refuses too;
 * - surfaces that do not read the profile (pass purchase, skill store, phone/companion connection,
 *   GitHub skills, on-device memory) refuse through `childSurfaceRefusal`.
 */
import type { ResolvedProfile } from "./protocol";

/** `hypeproofChat.<GUARDIAN_SETTING>`; the app-side name for Service `HPS_GUARDIAN`. */
export const GUARDIAN_SETTING = "guardianEnabled";

/** GRD-24 — always visible on the child's screen. Draft copy, fixed in the requirement review. */
export const CHILD_GUARDIAN_NOTICE = "보호자가 이 기록을 볼 수 있어요";

export type ChildSurface = "publish" | "purchase" | "connections" | "store" | "invite" | "memory";

/** GRD-24 — plain 해요체 for the child. No legal terms, no amounts. Draft copy. */
export const CHILD_REFUSAL: Readonly<Record<ChildSurface, string>> = {
  // GRD-10 — nothing leaves the device. The on-device simulation is a later slice.
  publish: "아이 프로필에서는 인터넷에 올리지 않아요. 만든 것은 이 기기 안에서만 볼 수 있어요.",
  // GRD-10 — no pass purchase.
  purchase: "아이 프로필에서는 이용권을 살 수 없어요. 보호자에게 말해 주세요.",
  // GRD-09 — no account, mail, phone, cloud or MCP connection.
  connections: "아이 프로필에서는 다른 서비스나 기기와 연결하지 않아요.",
  // GRD-10 — no skill store purchase or sale.
  store: "아이 프로필에서는 스킬 스토어를 쓸 수 없어요.",
  // GRD-09 — no invites.
  invite: "아이 프로필에서는 초대를 보낼 수 없어요.",
  // GRD-19 / Q10 — no on-device or server memory for a child.
  memory: "아이 프로필에서는 기억을 저장하지 않아요.",
};

let switchReader: () => unknown = () => false;

/** The host binds the setting once at activation. Tests bind a stub. */
export function configureGuardianSwitch(reader: () => unknown): void {
  switchReader = reader;
}

/** GRD-23 — only a literal `true` turns the posture on; an unreadable setting is off (no change). */
export function guardianSwitchOn(): boolean {
  try { return switchReader() === true; } catch { return false; }
}

/** A child seat under the switch: `child_profile` must be literally `true`. */
export function isChildSeat(profile: { child_profile?: unknown } | null | undefined, on: boolean = guardianSwitchOn()): boolean {
  return on && profile?.child_profile === true;
}

/**
 * GRD-08/09/10/19 — the child posture applied to a served profile. Returns the same object when the
 * switch is off or the seat is not a child seat. Never mutates its input.
 */
export function applyChildPosture<T extends ResolvedProfile>(profile: T, on: boolean = guardianSwitchOn()): T {
  if (!isChildSeat(profile, on)) return profile;
  const sdk = profile.sdk_tools;
  return {
    ...profile,
    // GRD-08 — minor even when the Service left the flag out.
    minor_cohort: true,
    coach_runtime: "proxy",
    // GRD-10 — no site or gallery publish.
    publishing: { ...profile.publishing, enabled: false },
    // GRD-09 — no mail automation (Google connection).
    automations: undefined,
    // GRD-10 — no Foundry / user-test publication; GRD-19 — no server project memory.
    curriculum_runtime: { enabled: false },
    // GRD-19 — nothing goes to team analytics; no email collection from the child.
    analytics: { upload_session_logs: false },
    notify_optin: undefined,
    // GRD-08 — the classroom child seat's tool posture: no write, browser, subagents or shell.
    ...(sdk ? { sdk_tools: { ...sdk, write: false, browser: false, subagents: false, shell: false } } : {}),
    orchestrator: undefined,
    browser_control: undefined,
  };
}

let seatReader: () => { child_profile?: unknown } | null | undefined = () => null;

/** The host binds the chat provider's current served profile once it exists. Tests bind a stub. */
export function configureChildSeat(reader: () => { child_profile?: unknown } | null | undefined): void {
  seatReader = reader;
}

/** The refusal for `surface` on the current seat (configureChildSeat), or null. */
export function childRefusalNow(surface: ChildSurface): string | null {
  let profile: { child_profile?: unknown } | null | undefined;
  try { profile = seatReader(); } catch { profile = null; }
  return childSurfaceRefusal(surface, profile);
}

/** The refusal for `surface` on a child seat, or null where the surface keeps today's behaviour. */
export function childSurfaceRefusal(surface: ChildSurface, profile: { child_profile?: unknown } | null | undefined, on: boolean = guardianSwitchOn()): string | null {
  return isChildSeat(profile, on) ? CHILD_REFUSAL[surface] : null;
}

/** GRD-24 — the notice the chat panel draws on a child seat; undefined elsewhere. */
export function childGuardianNotice(profile: { child_profile?: unknown } | null | undefined, on: boolean = guardianSwitchOn()): string | undefined {
  return isChildSeat(profile, on) ? CHILD_GUARDIAN_NOTICE : undefined;
}
