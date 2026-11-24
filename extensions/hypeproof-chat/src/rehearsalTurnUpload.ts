// #4501 — a subscription rehearsal turn is uploaded to the Service with no conversation text (A′, 2026-11-24).
// The body carries ids, the answered flag, the model, tool NAMES only and the help receipt. The server refuses text
// and tool input on a text_omitted turn (hypeproof-service worker/src/routes/chalk-transcripts.ts, d07c8401).
// The instructor token is read here and used only in the Authorization header; it never enters the body or a log.
import { ISSUER_TOKEN_KEY } from "./mintStudentTokenHelpers.ts";

export const REHEARSAL_UPLOAD_LOG = "[rehearsal-upload]";

export interface RehearsalTurnFacts {
  turnId: string;
  mode: string;
  model: string;
  toolNames: string[];
  answered: boolean;
  at: string;
  courseId: string;
  rehearsalId: string;
  lessonSha256: string;
  stepId: string | null;
  helpReceipt: string | null;
}

/** The upload body. No user_text, assistant_text or tool input field exists here, by construction. */
export function rehearsalTurnBody(f: RehearsalTurnFacts): Record<string, unknown> {
  return {
    text_omitted: true,
    answered: f.answered,
    turn_id: f.turnId,
    mode: f.mode,
    connection: "subscription",
    model: f.model,
    tools: f.toolNames.map((name) => ({ name })),
    at: f.at,
    course_id: f.courseId,
    rehearsal_id: f.rehearsalId,
    lesson_sha256: f.lessonSha256,
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

export type UploadOutcome = { status: number } | { status: "no_issuer" } | { status: "error" };

/**
 * Host-only upload. The issuer token is read from secrets here, sent in one header, and not returned.
 * Failures are reported as an outcome, never thrown, so the student turn is not blocked.
 */
export async function uploadRehearsalTurn(args: {
  secrets: { get(key: string): PromiseLike<string | undefined> };
  adminBase: string;
  body: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  log: (line: string) => void;
}): Promise<UploadOutcome> {
  const turnId = String(args.body.turn_id ?? "");
  let token: string | undefined;
  try { token = await args.secrets.get(ISSUER_TOKEN_KEY); } catch { token = undefined; }
  if (!token) return { status: "no_issuer" };
  try {
    const doFetch = args.fetchImpl ?? fetch;
    const res = await doFetch(args.adminBase + "/admin/chalk/transcripts", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(args.body),
    });
    args.log(`${REHEARSAL_UPLOAD_LOG} turn=${turnId} status=${res.status}`);
    return { status: res.status };
  } catch {
    args.log(`${REHEARSAL_UPLOAD_LOG} turn=${turnId} status=network`);
    return { status: "error" };
  }
}
