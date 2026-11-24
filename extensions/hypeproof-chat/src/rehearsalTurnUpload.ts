// #4501 — a subscription rehearsal turn is uploaded to the Service with no conversation text (A′), and with the
// learner rehearsal code of this window (D1 = B, 2026-11-25). The instructor credential is never read here: the seat
// moves it to a return key, and this module does not touch that key. The server takes rehearsal id, course and lesson
// from the code itself; the body carries none of them (service-change-b.md).
// The rehearsal code is used only in the Authorization header; it never enters the body or a log.

export const REHEARSAL_UPLOAD_LOG = "[rehearsal-upload]";
// The same secret key the extension stores the workshop (learner) token under: extension.ts TOKEN_KEY, written by
// bindStudentToken (extension.ts:151-153). rehearsal-turn-upload.test.mjs checks that both spellings match.
export const REHEARSAL_CODE_KEY = "hypeproofChat.workshopToken";
export const REHEARSAL_TURNS_PATH = "/classroom/rehearsal/turns";

export interface RehearsalTurnFacts {
  turnId: string;
  mode: string;
  model: string;
  toolNames: string[];
  answered: boolean;
  at: string;
  stepId: string | null;
  helpReceipt: string | null;
}

/** The upload body. No user_text, assistant_text, tool input, rehearsal id, course id or lesson hash, by construction. */
export function rehearsalTurnBody(f: RehearsalTurnFacts): Record<string, unknown> {
  return {
    text_omitted: true,
    answered: f.answered,
    turn_id: f.turnId,
    mode: f.mode,
    model: f.model,
    tools: f.toolNames.map((name) => ({ name })),
    at: f.at,
    step_id: f.stepId,
    help_receipt: f.helpReceipt,
  };
}

/**
 * Same shape as the Service receipt (worker/src/lib/lesson-help-mode.ts helpModeReceipt, d07c8401):
 * `mode=<mode>; source=<student|lesson_default>; step=<id>; performance=unobserved`.
 * A step without help gets no receipt (server: help_receipt null).
 */
export function helpReceiptFor(
  step: { id: string; help?: { default: string } } | undefined,
  focusMode: string | undefined,
): string | null {
  if (!step || !step.help) return null;
  const source = focusMode ? "student" : "lesson_default";
  const mode = focusMode ?? step.help.default;
  return `mode=${mode}; source=${source}; step=${step.id}; performance=unobserved`;
}

/** `reason` is the Service reason code of a refused upload (403 not_rehearsal/server_path, 404, 409, 410, 429 turn_limit). */
export type UploadOutcome = { status: number; reason?: string } | { status: "no_code" } | { status: "error" };

async function reasonOf(res: Response): Promise<string | undefined> {
  try {
    const j = (await res.json()) as { reason?: unknown };
    return typeof j.reason === "string" ? j.reason : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Host-only upload to POST {base}/classroom/rehearsal/turns (base = proxyUrl, ends in /v1).
 * The rehearsal code is read from secrets here, sent in one header, and not returned.
 * Failures are reported as an outcome, never thrown, so the student turn is not blocked.
 */
export async function uploadRehearsalTurn(args: {
  secrets: { get(key: string): PromiseLike<string | undefined> };
  base: string;
  body: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  log: (line: string) => void;
}): Promise<UploadOutcome> {
  const turnId = String(args.body.turn_id ?? "");
  let code: string | undefined;
  try { code = await args.secrets.get(REHEARSAL_CODE_KEY); } catch { code = undefined; }
  if (!code) return { status: "no_code" };
  try {
    const doFetch = args.fetchImpl ?? fetch;
    const res = await doFetch(args.base + REHEARSAL_TURNS_PATH, {
      method: "POST",
      headers: { authorization: "Bearer " + code, "content-type": "application/json" },
      body: JSON.stringify(args.body),
    });
    args.log(`${REHEARSAL_UPLOAD_LOG} turn=${turnId} status=${res.status}`);
    if (res.status >= 200 && res.status < 300) return { status: res.status };
    return { status: res.status, reason: await reasonOf(res) };
  } catch {
    args.log(`${REHEARSAL_UPLOAD_LOG} turn=${turnId} status=network`);
    return { status: "error" };
  }
}

/**
 * Whether the rehearsal seat must say once that this window has no rehearsal code (entry notice).
 * Decided only by the code: a same-window seat (instructor return key present) has the code too, so no notice there.
 */
export function rehearsalCodeNoticeNeeded(input: { seatBand: boolean; subscription: boolean; codeInWindow: boolean }): boolean {
  return input.seatBand && input.subscription && !input.codeInWindow;
}
