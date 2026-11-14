// #4099 — which runtime a learner-condition rehearsal turn may use.
// 'subscription' runs only on the local subscription runtime; the server conversation routes are never called for it.
// Any value other than 'subscription' (absent, 'server', or an unknown value) is treated as 'server'.

export type RehearsalPath = "server" | "subscription";

export function rehearsalPathOf(rehearsal: { path?: unknown } | null | undefined): RehearsalPath {
  return rehearsal?.path === "subscription" ? "subscription" : "server";
}

// True when a turn of this rehearsal must not reach the server: the local runtime is required, or the turn is refused.
export function mustStayLocal(rehearsal: { path?: unknown } | null | undefined): boolean {
  return rehearsalPathOf(rehearsal) === "subscription";
}
