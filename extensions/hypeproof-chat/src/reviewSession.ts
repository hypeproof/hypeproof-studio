// The "주간 리뷰" (Weekly Review) panel, App side (cr-review #1398; CR-48–CR-53, CR-62). Pure over
// its ports and vscode-free, so a smoke and the worker test drive exactly what the provider runs.
//
// Student ("Prepare Weekly Review", CR-49). Three steps, and the App decides none of the outcome:
//   1. `POST …/review/prepare` — the Service says which sections are stale and, when the model's
//      section is one of them, the Experiment skill's prompt and request metadata (CR-45);
//   2. `complete` — that prompt goes once through the existing coach route (`/v1/chat/completions`,
//      the same request a skill run sends), only when its section is stale;
//   3. `POST …/review/commit` — the Service checks the answer with the skill's own gate (CR-44),
//      composes the stale fact sections again and stores the next revision.
// The run is timed (CR-62): the whole run and the model's share, judged against the 30 s target
// with the provider's latency apart.
//
// Director (CR-50, CR-51, CR-53). With the issuer token: every directed team's pack status, one
// team's pack opened from storage (no model call), and the final decision and next experiment
// written from it. A student token never writes a director decision, and the director never
// prepares a pack.

import { curriculumRequest } from "./galleryPublish.ts";
import { extractJsonObject } from "./skillView.ts";
import type { SkillCompletion } from "./skillSession.ts";
import { REVIEW_MESSAGES, directorFormProblems, regenerationVerdict, type DirectorDecisionForm, type OverviewTeam, type PrepareTiming, type ReviewAnswer, type ReviewView } from "./reviewView.ts";

export interface ReviewPorts {
  switchOn(): boolean;
  /** The student token (TOKEN_KEY). */
  token(): Promise<string | null>;
  /** The director's issuer token (ISSUER_TOKEN_KEY), never the student's. */
  directorToken(): Promise<string | null>;
  base(): string;
  fetchImpl?: typeof fetch;
  /** The student's Project, as the publish panel remembered it (crProjectMemory). */
  projectId(): string | undefined;
  /** One coach-route request with the run's metadata headers (the skills panel's `completeSkill`). */
  complete(prompt: string, headers: Record<string, string>): Promise<SkillCompletion>;
  now?(): number;
}

const OFF = "이 수업에서는 주간 리뷰를 쓸 수 없어요.";
const SIGN_IN = "참여 코드를 먼저 입력해 주세요.";
const NO_PROJECT = "아직 프로젝트가 없어요. 먼저 사용자 테스트용으로 공개해 주세요.";
const NO_DIRECTOR = "강사 토큰을 넣어야 디렉터 화면을 볼 수 있어요.";
const msg = (r: { code: string; message: string; status?: number }) => REVIEW_MESSAGES[r.code] ?? (r.code === "not_found" ? OFF : r.message.startsWith("공개하지 못했어요") ? `주간 리뷰를 읽지 못했어요 (${r.status ?? "?"})` : r.message);

type Client = { base: string; token: string; fetchImpl?: typeof fetch };

/** Can this issuer token direct a switch-on cohort? The Service answers the unknown route otherwise (CR-02). */
export async function directorAvailable(input: { base: string; token: string | null; fetchImpl?: typeof fetch }): Promise<boolean> {
  if (!input.token) return false;
  const r = await curriculumRequest<{ projects?: unknown[] }>({ base: input.base, token: input.token, ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}) }, "GET", "/director/projects");
  return r.ok;
}

export class ReviewSession {
  private readonly ports: ReviewPorts;
  private running = false;
  private timing: PrepareTiming | null = null;
  private refused: string[] | null = null;
  /** The director's open team and week (the overview picks it). */
  private selected: { projectId: string; week?: number } | null = null;
  constructor(ports: ReviewPorts) {
    this.ports = ports;
  }

  private now(): number {
    return this.ports.now ? this.ports.now() : Date.now();
  }

  private client(token: string): Client {
    return { base: this.ports.base(), token, ...(this.ports.fetchImpl ? { fetchImpl: this.ports.fetchImpl } : {}) };
  }

  /** The remembered Project, else the newest one the student is a member of (read only). */
  private async project(client: Client): Promise<string | null> {
    const remembered = this.ports.projectId();
    if (remembered) return remembered;
    const list = await curriculumRequest<{ projects?: Array<{ id: string; created_at: number }> }>(client, "GET", "/projects");
    if (!list.ok) return null;
    return [...(list.body.projects ?? [])].sort((a, b) => b.created_at - a.created_at)[0]?.id ?? null;
  }

  isRunning(): boolean {
    return this.running;
  }

  private none(mode: ReviewView["mode"], notice: string): ReviewView {
    return { mode, available: false, notice, review: null, teams: null, running: this.running, timing: mode === "student" ? this.timing : null, refused: null };
  }

  // ── Student ──────────────────────────────────────────────────────────────

  /** The team's pack of the week (the newest experiment's unless `week` is given), read now; no model call. */
  async studentView(week?: number): Promise<ReviewView> {
    if (!this.ports.switchOn()) return this.none("student", OFF);
    const token = await this.ports.token();
    if (!token) return this.none("student", SIGN_IN);
    const client = this.client(token);
    const projectId = await this.project(client);
    if (!projectId) return this.none("student", NO_PROJECT);
    const r = await curriculumRequest<{ review: ReviewAnswer }>(client, "GET", `/projects/${encodeURIComponent(projectId)}/review${week ? `?week=${week}` : ""}`);
    if (!r.ok) return this.none("student", msg(r));
    return { mode: "student", available: true, notice: null, review: r.body.review, teams: null, running: this.running, timing: this.timing, refused: this.refused };
  }

  /**
   * "Prepare Weekly Review" (CR-49): only the stale sections are regenerated, and the model is
   * asked once per stale model section. When the records change between the two calls the
   * Service refuses the answer (`inputs_changed`, `review_changed`) and the run starts over once.
   */
  async prepare(week?: number): Promise<{ ok: true; regenerated: string[]; unchanged: boolean } | { ok: false; message: string }> {
    if (!this.ports.switchOn()) return { ok: false, message: OFF };
    if (this.running) return { ok: false, message: "주간 리뷰를 준비하고 있어요." };
    const token = await this.ports.token();
    if (!token) return { ok: false, message: SIGN_IN };
    const client = this.client(token);
    this.running = true;
    try {
      const projectId = await this.project(client);
      if (!projectId) return { ok: false, message: NO_PROJECT };
      const path = `/projects/${encodeURIComponent(projectId)}/review`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const t0 = this.now();
        let provider = 0;
        const prep = await curriculumRequest<{ week: number; base_revision: number; status: string; stale_sections: string[]; model_sections: Array<{ section: string; headers: Record<string, string>; prompt: string; input_digest: string }> }>(client, "POST", `${path}/prepare`, week ? { week } : {});
        if (!prep.ok) return { ok: false, message: msg(prep) };
        if (prep.body.status === "fresh") {
          this.refused = null;
          return { ok: true, regenerated: [], unchanged: true };
        }
        const outputs: Record<string, { input_digest: string; output: Record<string, unknown>; model: string | null }> = {};
        let failed: string | null = null;
        for (const m of prep.body.model_sections) {
          const t1 = this.now();
          const answer = await this.ports.complete(m.prompt, m.headers);
          provider += this.now() - t1;
          if (!answer.ok || typeof answer.text !== "string") {
            failed = "model_failed";
            continue;
          }
          const output = extractJsonObject(answer.text);
          if (!output) {
            failed = "not_json";
            continue;
          }
          outputs[m.section] = { input_digest: m.input_digest, output, model: answer.model ?? null };
        }
        const sent = { total_ms: this.now() - t0, provider_ms: provider };
        const done = await curriculumRequest<{ regenerated: string[]; unchanged?: boolean; refused?: { next_experiment?: { problems: string[] } } }>(client, "POST", `${path}/commit`, { week: prep.body.week, base_revision: prep.body.base_revision, outputs, timing: sent });
        if (!done.ok && attempt === 0 && (done.code === "inputs_changed" || done.code === "review_changed" || done.code === "evidence_changed")) continue;
        if (!done.ok) return { ok: false, message: msg(done) };
        this.timing = regenerationVerdict({ total_ms: this.now() - t0, provider_ms: provider });
        this.refused = done.body.refused?.next_experiment?.problems ?? (failed ? [failed] : null);
        // `unchanged` means the pack was already fresh. A commit that stored nothing because only the
        // AI's suggestion was stale and it was refused is not "up to date": the refusal says why.
        return { ok: true, regenerated: done.body.regenerated ?? [], unchanged: false };
      }
      return { ok: false, message: REVIEW_MESSAGES.inputs_changed! };
    } finally {
      this.running = false;
    }
  }

  /** What the last preparation could not store from the AI (shown under the pack), or null. */
  lastRefusal(): string[] | null {
    return this.refused;
  }

  // ── Director ─────────────────────────────────────────────────────────────

  /** Open one team's pack in the director's view (the overview row the director picked). */
  select(projectId: string | null, week?: number): void {
    this.selected = projectId ? { projectId, ...(week ? { week } : {}) } : null;
  }

  /** Every directed team's pack status (CR-53) and the selected team's pack (CR-50); no model call. */
  async directorView(): Promise<ReviewView> {
    const token = await this.ports.directorToken();
    if (!token) return this.none("director", NO_DIRECTOR);
    const client = this.client(token);
    const over = await curriculumRequest<{ teams: OverviewTeam[]; truncated?: boolean }>(client, "GET", "/reviews");
    if (!over.ok) return this.none("director", msg(over));
    let review: ReviewAnswer | null = null;
    let notice: string | null = null;
    if (this.selected) {
      const r = await curriculumRequest<{ review: ReviewAnswer }>(client, "GET", `/projects/${encodeURIComponent(this.selected.projectId)}/review${this.selected.week ? `?week=${this.selected.week}` : ""}`);
      if (r.ok) review = r.body.review;
      else notice = msg(r);
    }
    return { mode: "director", available: true, notice, review, teams: over.body.teams, ...(over.body.truncated ? { truncated: true } : {}), running: false, timing: null, refused: null };
  }

  /**
   * CR-51, CR-52 — the director's final decision and the next experiment, written from the pack
   * the director opened (its week and revision): checked here in the director's words, then by
   * the Service, which stores a Decision with the director as its actor and an Experiment draft.
   */
  async decide(projectId: string, at: { week: number; revision: number }, form: DirectorDecisionForm): Promise<{ ok: true; reused: boolean } | { ok: false; message: string }> {
    const problems = directorFormProblems(form);
    if (problems.length) return { ok: false, message: problems.join(" ") };
    const token = await this.ports.directorToken();
    if (!token) return { ok: false, message: NO_DIRECTOR };
    const next = form.next
      ? {
          ...(form.next.hypothesis_id ? { hypothesis_id: form.next.hypothesis_id } : { hypothesis: (form.next.hypothesis ?? "").trim() }),
          question: form.next.question.trim(),
          method: form.next.method,
          success_criteria: form.next.success_criteria.map((c) => c.trim()).filter(Boolean),
        }
      : null;
    const r = await curriculumRequest<{ reused?: boolean }>(this.client(token), "POST", `/projects/${encodeURIComponent(projectId)}/review/decision`, {
      week: at.week,
      revision: at.revision,
      statement: form.statement.trim(),
      evidence_refs: form.evidence_refs,
      assumption_refs: form.assumption_refs,
      affected_deck_slides: form.affected_deck_slides,
      ...(next ? { next_experiment: next } : {}),
    });
    return r.ok ? { ok: true, reused: r.body.reused === true } : { ok: false, message: msg(r) };
  }
}
