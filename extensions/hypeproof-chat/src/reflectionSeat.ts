// #4179: which seats may open "나의 질문" (personal reflection).
//
// The gate used to require `activity_kind: "personal"`. The Service serves that kind only for a
// legacy access-contract `account` token. Every seat a signed-in account owns today (super access,
// an invite seat, a pass bought earlier) is minted as a native-trial grant and served as `trial`,
// so no seat a member could pick ever passed. The Service keeps `trial` on the wire on purpose
// (installed builds key busy handling and SDK-only routing on it); Service PR #536 adds
// `seat_owner: "account"` instead. This module accepts such a seat without waiting for that field.
//
// Evidence, strongest first:
//   1. The saved activity's account pass binding (`accountPass.sessionId`). Studio writes it only
//      when this install activated the pass with that account session (AccountSession.activate).
//   2. The seat credential's `personal_account` / `account_session` claims. Read unverified, only
//      to compare with the signed-in account; it never grants anything. The Service still
//      authorizes every request with that credential.
//   3. The served profile's `seat_owner: "account"` (Service #536, when deployed). It says that an
//      account owns the seat, not which one, so it never overrides evidence 1 or 2.
//
// Still refused: classroom seats, lessons, the anonymous free seat (no account path: it goes to
// sign-in and the pass chooser as before), and a seat bound to another account or session.

import { decodeTokenPayloadUnverified } from "./chatPanelHelpers.ts";
import { isFreeSeat } from "./seatVocabulary.ts";

/** Whose seat this is, as far as local evidence tells. */
export type SeatOwnership = "mine" | "other" | "unknown";

export interface ReflectionSeatRecord {
  kind?: string;
  lesson?: boolean;
  free?: boolean;
  token?: string;
  accountPass?: { sessionId: string };
}

export interface ReflectionSeatProfile {
  activity_kind?: string;
  lesson?: unknown;
  seat_owner?: unknown;
  profile_id?: string | null;
  pass?: unknown;
}

/** The credential's account claims, if it carries any. Unverified; comparison only. */
function tokenAccount(token: string | undefined): { account?: string; session?: string } {
  const payload = decodeTokenPayloadUnverified(token);
  const account = typeof payload?.personal_account === "string" && payload.personal_account ? payload.personal_account : undefined;
  const session = typeof payload?.account_session === "string" && payload.account_session ? payload.account_session : undefined;
  return { account, session };
}

/**
 * Compare a seat's local evidence with the signed-in account. Any contradiction wins over any
 * match: a binding to another session, or a credential naming another account or session, is
 * `other` even if some other piece agrees.
 */
export function seatOwnership(
  seat: { token?: string; accountPass?: { sessionId: string } } | undefined,
  accountId: string | undefined,
  sessionId: string | undefined,
): SeatOwnership {
  if (!seat || !accountId || !sessionId) return "unknown";
  let mine = false;
  if (seat.accountPass) {
    if (seat.accountPass.sessionId !== sessionId) return "other";
    mine = true;
  }
  const claims = tokenAccount(seat.token);
  if (claims.account) {
    if (claims.account !== accountId) return "other";
    if (claims.session && claims.session !== sessionId) return "other";
    mine = true;
  }
  return mine ? "mine" : "unknown";
}

/**
 * A saved activity that may be an account-owned seat: a non-free, non-lesson `trial` record with
 * an account binding or account claims. Local shape only; the caller still checks ownership.
 * Records saved before this change (kind `trial` plus `accountPass`) qualify.
 */
export function mayBeAccountSeatRecord(record: ReflectionSeatRecord | undefined): boolean {
  if (!record || record.kind !== "trial" || record.free || record.lesson) return false;
  return !!record.accountPass || !!tokenAccount(record.token).account;
}

/** The saved activity may host 나의 질문: a `personal` record, or an account seat this account owns. */
export function reflectionRecordAccepted(record: ReflectionSeatRecord | undefined, ownership: SeatOwnership): boolean {
  if (!record || record.lesson || ownership === "other") return false;
  if (record.kind === "personal") return true;
  return mayBeAccountSeatRecord(record) && ownership === "mine";
}

/**
 * The served profile may host 나의 질문. `personal` as before; `trial` only when it is not the
 * anonymous free seat and either local evidence says this account owns it or the Service says an
 * account owns it (`seat_owner`). A lesson, a classroom seat or another account's seat never passes.
 */
export function reflectionProfileAccepted(profile: ReflectionSeatProfile | null | undefined, ownership: SeatOwnership): boolean {
  if (!profile || profile.lesson || ownership === "other") return false;
  if (profile.activity_kind === "personal") return true;
  if (profile.activity_kind !== "trial" || isFreeSeat(profile)) return false;
  return ownership === "mine" || profile.seat_owner === "account";
}
