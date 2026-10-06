// Synthetic cohorts (#1404): cohorts that exist only for automated checks.
//
// Release acceptance opens and closes its own short session on one of these
// cohorts and mints fresh codes for it on every run. That only stays safe if
// two things hold, and both are decided here so they cannot drift:
//
//   1. No real participant can ever be on the cohort. Every roster write and
//      every token mint names a handle in the `synthetic-` namespace, or it is
//      refused, so an operator who picks this cohort for a real student gets a
//      400 instead of a seat.
//   2. The live-session freeze can tell such a session from a class. The
//      worker answers that from the compiled profiles (`GET /admin/cohorts`
//      reports `synthetic`), so the freeze never maintains a second list.
//
// A cohort is synthetic only when every profile on it says so. A real track
// later added to the same cohort id turns the exemption off, and the freeze
// blocks that cohort's sessions again (fail closed).

import { listProfiles } from "../profiles";

export const SYNTHETIC_HANDLE_PREFIX = "synthetic-";

export function isSyntheticCohort(cohortId: string): boolean {
  const serving = listProfiles().filter((p) => p.session.cohort_id === cohortId);
  return serving.length > 0 && serving.every((p) => p.synthetic === true);
}

/** Handles a synthetic cohort refuses. Empty for every non-synthetic cohort. */
export function refusedSyntheticHandles(cohortId: string, users: readonly string[]): string[] {
  if (!isSyntheticCohort(cohortId)) return [];
  return users.filter((u) => !u.startsWith(SYNTHETIC_HANDLE_PREFIX) || u.length === SYNTHETIC_HANDLE_PREFIX.length);
}

export function syntheticHandleError(refused: readonly string[]) {
  return {
    error: `synthetic cohort accepts only "${SYNTHETIC_HANDLE_PREFIX}" handles`,
    code: "synthetic_handle_required",
    refused,
  };
}
