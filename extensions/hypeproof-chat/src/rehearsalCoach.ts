// #19 (student run path) — the coach system prompt of a subscription rehearsal. The Service sends the whole lesson-seat
// system prompt for this step and help mode in one field, `system` (#19b: the cohort cached prefix over the lesson prompt,
// the same bytes as the server path's first block). The turn runs with it, and the client context the local runtime
// already adds (email and remember guides, in runLocalCoach) follows it unchanged.
//
// Not byte-identical to the full server system: the coach tail (workspace, preview, name), the fast-model notes and the
// store-run block are added locally (decision 2026-11-26).
//
// The download uses the learner rehearsal code (Authorization header) and nothing else. Held in host memory for the seat
// only: never written to disk, never logged (the status line only), never posted to the webview. Kept per
// (rehearsal, step, help), so the same combination is fetched once while the seat runs.
// Pure except for `downloadRehearsalCoach`, which takes its fetch as an input (the host test passes a fake).

export const REHEARSAL_COACH_PATH = "/classroom/rehearsal/coach";

/** The student sentence when the coach instructions cannot be used (download refused, failed, or a broken contract). */
export const REHEARSAL_COACH_UNAVAILABLE = "이 리허설의 강사 지시를 받지 못해 답을 만들지 않았습니다. 강사에게 알려 주세요.";
/** The student sentence when this window has no rehearsal code, so the instructions cannot be asked for. */
export const REHEARSAL_COACH_CODE_MISSING = "이 창에 리허설 코드가 없어 답을 만들지 않았습니다. 리허설 코드로 다시 들어오세요.";

export type CoachDownload =
  | { ok: true; system: string }
  | { ok: false; status: number; reason?: string };

/**
 * The `system` text of the subscription coach answer, or null when the body is not that contract. The answer must name this
 * rehearsal and carry `system` as a string. Unknown keys are ignored. A server-path answer (`text`, no `system`) is refused.
 */
export function systemFromBody(body: unknown, expectedRehearsalId: string): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.rehearsal_id !== expectedRehearsalId) return null;
  if (typeof b.system !== "string" || b.system.length === 0) return null;
  return b.system;
}

export interface CoachDownloadInput {
  base: string;
  code: string;
  rehearsalId: string;
  step?: string;
  help?: string;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

/** One GET to the coach route with the learner code in the header. Logs the status only (never the body). */
export async function downloadRehearsalCoach(input: CoachDownloadInput): Promise<CoachDownload> {
  const query = new URLSearchParams();
  if (input.step) query.set("step", input.step);
  if (input.help) query.set("help", input.help);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const url = input.base.replace(/\/$/, "") + REHEARSAL_COACH_PATH + suffix;
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, { headers: { authorization: `Bearer ${input.code}` } });
  } catch {
    input.log?.("[rehearsal-coach] network");
    return { ok: false, status: 0 };
  }
  input.log?.(`[rehearsal-coach] status=${response.status}`);
  if (!response.ok) {
    const j = (await response.json().catch(() => ({}))) as { reason?: unknown };
    return { ok: false, status: response.status, reason: typeof j.reason === "string" ? j.reason : undefined };
  }
  const system = systemFromBody(await response.json().catch(() => null), input.rehearsalId);
  if (system === null) return { ok: false, status: response.status, reason: "invalid_coach_body" };
  return { ok: true, system };
}

/** The per-seat memory: one download per (rehearsal, step, help). Host memory only. */
export class RehearsalCoachMemory {
  private readonly held = new Map<string, string>();
  private key(rehearsalId: string, step: string | undefined, help: string | undefined): string {
    return `${rehearsalId}\u0000${step ?? ""}\u0000${help ?? ""}`;
  }
  get(rehearsalId: string, step: string | undefined, help: string | undefined): string | undefined {
    return this.held.get(this.key(rehearsalId, step, help));
  }
  set(rehearsalId: string, step: string | undefined, help: string | undefined, system: string): void {
    this.held.set(this.key(rehearsalId, step, help), system);
  }
}
