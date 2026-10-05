// The "주간 리뷰" (Weekly Review) panel's view (cr-review #1398; CR-48–CR-53, CR-62), shared by the
// host (reviewSession.ts) and the webview (ReviewPanel.tsx): no node or vscode imports.
//
// Everything a pack says is the Service's (`GET /v1/curriculum/projects/:id/review`): its ten
// sections as they were prepared, which of them are stale now, and every source resolved now.
// Nothing here decides a section, a claim or a status; this file names them in the student's and
// the director's words and checks the director's form before the Service checks it again.

export const REVIEW_SECTION_IDS = ["hypothesis", "experiment", "observed", "interpretation", "product_change", "metrics", "deck_slides", "assumptions", "decision_needed", "next_experiment"] as const;
export type ReviewSectionId = (typeof REVIEW_SECTION_IDS)[number];

/** Section titles (Korean product copy), in the PRD's order. */
export function sectionTitle(id: ReviewSectionId, week: number): string {
  switch (id) {
    case "hypothesis":
      return `${week}주차 가설`;
    case "experiment":
      return `${week}주차에 한 실험`;
    case "observed":
      return "관찰한 것";
    case "interpretation":
      return "해석";
    case "product_change":
      return "제품·버전 변화";
    case "metrics":
      return "지표";
    case "deck_slides":
      return "바뀌는 발표 슬라이드";
    case "assumptions":
      return "아직 확인 안 된 가정";
    case "decision_needed":
      return "디렉터와 정할 것";
    case "next_experiment":
      return "다음 실험 제안 (AI)";
  }
}

export interface ReviewItemView {
  class: "record" | "observed" | "interpreted" | "assumed" | "agenda" | "ai_suggestion";
  text: string;
  sources: string[];
  marks?: string[];
}

export interface ReviewSectionView {
  id: ReviewSectionId;
  digest: string | null;
  generated_at: number;
  generated_in: number;
  items: ReviewItemView[];
  notes: string[];
  proposals?: Array<{ slide: number; evidence_refs: string[] }>;
  skill?: string;
  model?: string | null;
  suggestion?: Record<string, unknown>;
}

export interface ReviewPackView {
  project_id: string;
  week: number;
  revision: number;
  prepared_at: number;
  prepared_by: string;
  sections: ReviewSectionView[];
  timing?: { total_ms: number; provider_ms: number };
}

export interface ReviewSourceView {
  ref: string;
  kind: string;
  found: boolean;
  label: string;
  lines: string[];
}

export type ReviewStatus = "fresh" | "stale" | "missing";

/** The Service's answer for one week's pack (`GET …/review`). */
export interface ReviewAnswer {
  project_id: string;
  project_title: string;
  week: number;
  status: ReviewStatus;
  stale_sections: ReviewSectionId[];
  pack: ReviewPackView | null;
  sources: Record<string, ReviewSourceView>;
  /** The director's decisions written from this week's packs (CR-51). */
  decisions: Array<{ id: string; statement: string; actor: string; shown_as: string; evidence_refs: string[]; assumption_refs: string[]; affected_deck_slides: number[]; review?: { week: number; revision: number }; next_experiment_id?: string; no_evidence: boolean }>;
  /** The Experiment drafts written with them (CR-52). */
  drafts: Array<{ id: string; week: number; question: string; method: string; success_criteria: string[]; status: string; hypothesis_id: string }>;
  weeks: Array<{ week: number; revision: number; prepared_at: number }>;
}

/** One directed team in the director's overview (CR-53). */
export interface OverviewTeam {
  project_id: string;
  title: string;
  cohort_id: string;
  members: number;
  week: number;
  status: ReviewStatus;
  stale_sections: ReviewSectionId[];
  revision: number | null;
  prepared_at: number | null;
}

/** The last "Prepare Weekly Review" as the App measured it (CR-62). */
export interface PrepareTiming {
  total_ms: number;
  provider_ms: number;
  verdict: "pass" | "miss_provider" | "miss_studio";
}

export interface ReviewView {
  mode: "student" | "director";
  available: boolean;
  /** Why the panel is empty or what last went wrong. */
  notice: string | null;
  review: ReviewAnswer | null;
  /** Director only: every directed team's pack status (CR-53). */
  teams: OverviewTeam[] | null;
  truncated?: boolean;
  /** Student only: a preparation is running. */
  running: boolean;
  timing: PrepareTiming | null;
  /** Why the AI's suggestion was not stored the last time (problem codes), or null. */
  refused: string[] | null;
}

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  fresh: "최신이에요",
  stale: "준비한 뒤로 바뀐 기록이 있어요",
  missing: "아직 준비하지 않았어요",
};

export const MARK_LABEL: Record<string, string> = {
  unreviewed: "아직 검토하지 않은 초안",
  not_real: "실제로 본 기록이 아니에요",
  ai_written: "AI가 쓴 해석",
  observed_later: "처음엔 가정이었는데 나중에 확인했어요",
  not_in_register: "기록에 없는 가정이에요 (AI가 적음)",
};

export const METHOD_CHOICES = [
  { id: "task_test", label: "과제 해 보기" },
  { id: "interview", label: "인터뷰" },
  { id: "observation", label: "지켜보기" },
] as const;

// ── CR-62: the regeneration target, judged with the provider's share apart ──

export const REGENERATION_TARGET_MS = 30_000;

/**
 * A full preparation against the 30 s target (CR-62, PRD §11): Studio's own processing is reported
 * apart from the provider's latency, so a slow provider is a provider-caused miss and never a
 * Studio pass; `miss_studio` when Studio alone takes the target.
 */
export function regenerationVerdict(t: { total_ms: number; provider_ms: number }): PrepareTiming {
  const provider = Math.max(0, Math.min(t.provider_ms, t.total_ms));
  const studio = Math.max(0, t.total_ms - provider);
  const verdict = t.total_ms < REGENERATION_TARGET_MS ? "pass" : studio < REGENERATION_TARGET_MS ? "miss_provider" : "miss_studio";
  return { total_ms: Math.round(t.total_ms), provider_ms: Math.round(provider), verdict };
}

/** "준비 시간 N초 (AI 응답 M초)" and, past the target, whose time it was. */
export function timingLine(t: PrepareTiming): string {
  const s = (ms: number) => (ms / 1000).toFixed(1);
  const base = `준비 시간 ${s(t.total_ms)}초 (AI 응답 ${s(t.provider_ms)}초)`;
  if (t.verdict === "pass") return base;
  return `${base} · 30초를 넘었어요 (${t.verdict === "miss_provider" ? "AI 응답이 늦었어요" : "Studio 처리가 늦었어요"})`;
}

// ── The director's form (CR-51, CR-52) ──────────────────────────────────────

export interface NextExperimentForm {
  /** A hypothesis of the Project, or — when absent — `hypothesis`, a new statement. */
  hypothesis_id?: string;
  hypothesis?: string;
  question: string;
  method: string;
  success_criteria: string[];
}

export interface DirectorDecisionForm {
  statement: string;
  evidence_refs: string[];
  assumption_refs: string[];
  affected_deck_slides: number[];
  /** The next experiment, written as a draft with the decision; null writes the decision alone. */
  next: NextExperimentForm | null;
}

/** What the form still needs, in the director's words; empty means it can be sent. */
export function directorFormProblems(f: DirectorDecisionForm): string[] {
  const out: string[] = [];
  if (!f.statement.trim()) out.push("무엇을 하기로 했는지 적어 주세요.");
  if (f.statement.length > 1000) out.push("결정은 1000자 안으로 적어 주세요.");
  if (f.affected_deck_slides.some((n) => !Number.isInteger(n) || n < 1 || n > 8)) out.push("발표 슬라이드는 1번부터 8번까지예요.");
  if (f.next) {
    if (!f.next.hypothesis_id && !f.next.hypothesis?.trim()) out.push("다음 실험이 확인할 가설을 고르거나 적어 주세요.");
    if (!f.next.question.trim()) out.push("다음 실험의 질문을 적어 주세요.");
    if (!METHOD_CHOICES.some((m) => m.id === f.next!.method)) out.push("다음 실험의 방법을 골라 주세요.");
    const criteria = f.next.success_criteria.map((c) => c.trim()).filter(Boolean);
    if (!criteria.length) out.push("다음 실험의 성공 기준을 하나 이상 적어 주세요.");
    if (criteria.length > 10) out.push("성공 기준은 10개까지 적을 수 있어요.");
  }
  return out;
}

/** The next-experiment form as the AI suggested it, for the director to edit (it is never sent unedited by itself). */
export function suggestedNext(review: ReviewAnswer | null): NextExperimentForm {
  const s = review?.pack?.sections.find((x) => x.id === "next_experiment")?.suggestion ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const method = typeof s.method === "string" && METHOD_CHOICES.some((m) => m.id === s.method) ? s.method : "task_test";
  return {
    hypothesis: typeof s.hypothesis === "string" ? s.hypothesis : "",
    // The skill names the assumption the test checks, not a question: the director turns it into one.
    question: typeof s.assumption === "string" ? s.assumption : (list(s.procedure)[0] ?? ""),
    method,
    success_criteria: list(s.success_criteria),
  };
}

/** The pack's evidence a director's decision may cite (CR-52): observed and interpretation items, and the open assumptions. */
export function packChoices(review: ReviewAnswer | null): { evidence: Array<{ ref: string; label: string }>; assumptions: Array<{ ref: string; label: string }> } {
  const refs = (id: ReviewSectionId) =>
    (review?.pack?.sections.find((s) => s.id === id)?.items ?? [])
      .filter((i) => !(i.marks ?? []).includes("unreviewed") && !(i.marks ?? []).includes("not_real"))
      .flatMap((i) => i.sources.filter((r) => r.startsWith("ev:")).map((r) => ({ ref: r, label: i.text })));
  return { evidence: [...refs("observed"), ...refs("interpretation")], assumptions: refs("assumptions") };
}

/** Refusal codes of the review routes, in the student's and director's words. */
export const REVIEW_MESSAGES: Record<string, string> = {
  invalid_week: "몇 주차 리뷰인지 다시 골라 주세요.",
  review_changed: "그사이 다른 팀원이 리뷰를 다시 준비했어요. 새로 불러온 뒤 다시 해 주세요.",
  inputs_changed: "준비하는 동안 기록이 바뀌었어요. 다시 준비해 주세요.",
  evidence_changed: "준비하는 동안 지워진 기록이 있어서 저장하지 않았어요. 다시 준비해 주세요.",
  invalid_pack: "리뷰를 만들지 못했어요. 강사에게 알려 주세요.",
  review_revision_limit: "이번 주 리뷰는 더 준비할 수 없어요.",
  review_missing: "이 팀은 아직 이번 주 리뷰를 준비하지 않았어요.",
  ref_not_in_review: "고른 근거 중에 이 리뷰에 없는 것이 있어요. 새로 불러온 뒤 다시 골라 주세요.",
  unresolved_decision_refs: "고른 근거 중에 결정의 근거로 쓸 수 없는 것이 있어요. 검토한 실제 기록만 고를 수 있어요.",
  invalid_decision: "결정을 저장하지 못했어요. 내용을 다시 확인해 주세요.",
  invalid_next_experiment: "다음 실험을 저장하지 못했어요. 질문, 방법, 성공 기준을 다시 확인해 주세요.",
  hypothesis_required: "다음 실험이 확인할 가설을 적어 주세요.",
  hypothesis_unresolved: "고른 가설을 이 프로젝트에서 찾지 못했어요.",
  version_unresolved: "이 프로젝트에 아직 공개한 버전이 없어서 다음 실험을 만들 수 없어요.",
  decision_limit: "이 프로젝트에는 결정을 더 저장할 수 없어요.",
  experiment_limit: "이 프로젝트에는 실험을 더 만들 수 없어요.",
  hypothesis_limit: "이 프로젝트에는 가설을 더 만들 수 없어요.",
  model_failed: "AI가 답하지 않아 다음 실험 제안은 만들지 못했어요. 나머지는 저장했어요.",
  not_json: "AI의 답을 읽지 못해 다음 실험 제안은 만들지 못했어요. 나머지는 저장했어요.",
};
