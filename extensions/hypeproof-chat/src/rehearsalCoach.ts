// #19 (student run path) — the coach instructions of a subscription rehearsal. The turn's system prompt is the text the
// Service sends for this step and help mode, in the order the Service gives (profile instructions first, then the lesson
// text). The download uses the learner rehearsal code (Authorization header) and nothing else.
//
// Held in host memory for the seat only: never written to disk, never logged, never posted to the webview. A download is
// kept per (rehearsal, step, help), so the same combination is fetched once while the seat runs.
// Pure except for `downloadRehearsalCoach`, which takes its fetch as an input (the host test passes a fake).

export const REHEARSAL_COACH_PATH = "/classroom/rehearsal/coach";
const DEFAULT_ORDER = ["profile_instructions", "text"] as const;

export type CoachDownload =
  | { ok: true; instructions: string }
  | { ok: false; status: number; reason?: string };

/** The instructions text in the Service's order, or null when the body is not the coach contract. Refuses unknown keys. */
export function instructionsInOrder(body: unknown, expectedRehearsalId: string): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.rehearsal_id !== expectedRehearsalId || typeof b.text !== "string") return null;
  const order: unknown[] = Array.isArray(b.order) ? b.order : [...DEFAULT_ORDER];
  const parts: string[] = [];
  for (const key of order) {
    if (key === "text") parts.push(b.text);
    else if (key === "profile_instructions" && typeof b.profile_instructions === "string") parts.push(b.profile_instructions);
    else return null; // an unknown key, or a listed key without its text: the contract is broken, so the turn does not run
  }
  return parts.join("\n\n");
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
  const instructions = instructionsInOrder(await response.json().catch(() => null), input.rehearsalId);
  if (instructions === null) return { ok: false, status: response.status, reason: "invalid_coach_body" };
  return { ok: true, instructions };
}

/** The per-seat memory: one download per (rehearsal, step, help). Host memory only; cleared when the window closes. */
export class RehearsalCoachMemory {
  private readonly held = new Map<string, string>();
  private key(rehearsalId: string, step: string | undefined, help: string | undefined): string {
    return `${rehearsalId}\u0000${step ?? ""}\u0000${help ?? ""}`;
  }
  get(rehearsalId: string, step: string | undefined, help: string | undefined): string | undefined {
    return this.held.get(this.key(rehearsalId, step, help));
  }
  set(rehearsalId: string, step: string | undefined, help: string | undefined, instructions: string): void {
    this.held.set(this.key(rehearsalId, step, help), instructions);
  }
}
