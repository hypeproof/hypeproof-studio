// Weekly Review Pack (cr-review #1398; PRD P0-8; CR-48–CR-53, CR-62; recon R9). Pure: no env,
// no storage, no model call.
//
// A pack is one team's (Project's) review of one curriculum week: the PRD's ten sections, in
// order. It is composed from Venture Memory as `memoryState` reads it (memory.ts: the cr_*
// documents and the evidence items of the experiments' measurement-core records), never from
// chat history (CR-28), and it is a cached VIEW of them, not a store of evidence (SX-48): every
// claim names its sources by reference (`ev:`, `hypothesis:`, `experiment:`, `version:`,
// `decision:`, `metric:`, `slide:`), the evidence stays in the record, and the routes resolve a
// reference against the record each time a pack is opened.
//
// Nine sections are facts composed by rule, with no model: what was tested, what was observed
// (kept apart from the interpretations, and from the assumptions), what changed in the product,
// the metrics, the slides the week's decisions affect, and the decisions the director and team
// need to make, which are read off the records (the hypothesis tested and the assumptions still
// open). The tenth, the suggested next experiment, is the model's: it is the Experiment skill
// (cr-skills, CR-46) run on the existing coach route with its skill tag and capability (CR-45),
// gated by the skill's own output check (CR-44). Nothing else in a pack is written by a model.
//
// Staleness (CR-49). Each section carries the digest of what it was composed from: a fact
// section, the digest of its composed content (so it is stale exactly when composing it again
// from the records now gives something else); the model section, the digest of the exact
// context and input the model reads (`nextExperimentRun`), so a cached suggestion is stale
// exactly when the model would be asked something else. Opening compares those digests with
// the records now and marks the stale sections (CR-50: opening never generates). Preparing
// again regenerates only the stale sections (`buildPack`): a fresh section is carried over
// byte for byte, and the model is asked again only when its own section is stale.
//
// The classroom observation report (`classroom-report.ts`, `classroom-evaluator.ts`,
// `classroom-report-html.ts`, recon R9) is the pattern followed here, not code called: a
// validated draft (`packProblems`) keyed by what it was made from, sections that state an
// absence in words instead of leaving it empty, opened from storage with no model call. Its
// composer and renderer are the learner observation report (capability findings, quotes, a
// guardian page) and its evaluator calls the provider with the Service's own key outside the
// student's budget and without a skill tag, which CR-45 and the plan's model path rule out.

import { digestOf } from "../measurement-core/local-record.ts";
import { CURRICULUM_SKILLS, checkSkillOutput, skillPrompt, type CurriculumSkill } from "../../skills/curriculum/registry.ts";
import { modelContextOf, skillContextOf } from "./skill-run.ts";
import { shownAs, versionDiff, type EvidenceItemView, type MemoryState } from "./memory.ts";
import { DECK_SLIDES, VENTURE_SCHEMA, isHumanDecision, parseEvidenceItemRef, type Decision, type Experiment } from "./venture.ts";

export const REVIEW_FORMAT = "hps-weekly-review/1";

/** The PRD P0-8 sections, in the PRD's order (CR-48). */
export const REVIEW_SECTION_IDS = ["hypothesis", "experiment", "observed", "interpretation", "product_change", "metrics", "deck_slides", "assumptions", "decision_needed", "next_experiment"] as const;
export type ReviewSectionId = (typeof REVIEW_SECTION_IDS)[number];
/** The sections a model writes. Every other section is composed by rule from the records. */
export const MODEL_SECTIONS: readonly ReviewSectionId[] = ["next_experiment"];
/** The skill that writes the suggested next experiment (CR-46): the registry's Experiment skill, unchanged. */
export const NEXT_EXPERIMENT_SKILL = "experiment";

/**
 * What an item of a section is. `record`, `observed`, `interpreted`, `assumed` and `agenda`
 * state something about the team's records and must name at least one source (CR-48);
 * `ai_suggestion` is the model's proposal, labelled as such and never a fact.
 */
export const REVIEW_ITEM_CLASSES = ["record", "observed", "interpreted", "assumed", "agenda", "ai_suggestion"] as const;
export type ReviewItemClass = (typeof REVIEW_ITEM_CLASSES)[number];
export const SOURCED_CLASSES: ReadonlySet<ReviewItemClass> = new Set(["record", "observed", "interpreted", "assumed", "agenda"]);

/** The one class each section may hold: observed evidence, interpretation and assumptions never mix (CR-48, PRD §5.3). */
export const SECTION_CLASS: Record<ReviewSectionId, ReviewItemClass> = {
  hypothesis: "record",
  experiment: "record",
  observed: "observed",
  interpretation: "interpreted",
  product_change: "record",
  metrics: "record",
  deck_slides: "record",
  assumptions: "assumed",
  decision_needed: "agenda",
  next_experiment: "ai_suggestion",
};

/** Marks a claim carries in the panel; the facts behind them are the evidence item's (memory.ts). */
export type ReviewMark = "unreviewed" | "not_real" | "ai_written" | "observed_later" | "not_in_register";

export interface ReviewItem {
  class: ReviewItemClass;
  text: string;
  /** References to the records the claim rests on; the routes resolve them on every open. */
  sources: string[];
  marks?: ReviewMark[];
}

/** A pending slide patch proposal (cr-deck, CR-56), part of the pack's source state. None exist before cr-deck. */
export interface SlideProposal {
  slide: number;
  evidence_refs: string[];
}

export interface ReviewSection {
  id: ReviewSectionId;
  /** The digest of what this section was composed from; null for a model section never generated. */
  digest: string | null;
  generated_at: number;
  /** The pack revision that generated this content; a fresh section carried over keeps its own. */
  generated_in: number;
  items: ReviewItem[];
  /** Statements about the section as a whole: an absence said in words ("no proposal", "nothing observed this week"). */
  notes: string[];
  /** `deck_slides` only: the slide patch proposals pending when the pack was prepared (CR-48, CR-56). */
  proposals?: SlideProposal[];
  /** `next_experiment` only: the skill tag, the model the coach route answered with, and the skill's accepted output. */
  skill?: string;
  model?: string | null;
  suggestion?: Record<string, unknown>;
}

export interface WeeklyReview {
  schema: typeof VENTURE_SCHEMA;
  kind: "weekly_review";
  format: typeof REVIEW_FORMAT;
  project_id: string;
  week: number;
  revision: number;
  prepared_at: number;
  /** The team member who ran "Prepare Weekly Review" for this revision. */
  prepared_by: string;
  sections: ReviewSection[];
  /**
   * What the App measured for this preparation (CR-62): the run up to sending the commit and the
   * model's share of it, plus the Service's own time for the commit (`commit_ms`), which the App
   * cannot know when it sends its figures. Reported, not trusted for anything.
   */
  timing?: { total_ms: number; provider_ms: number; commit_ms?: number };
}

// ── Student-facing words (Korean product copy) ──────────────────────────────

/** The "deck slides affected" section's statement when no patch proposal is pending (CR-48). */
export const NO_PROPOSAL = "아직 제안된 슬라이드 수정이 없어요.";
/** The model section before a suggestion was ever stored. */
export const NOT_GENERATED = "다음 실험 제안을 아직 만들지 못했어요. 주간 리뷰를 다시 준비해 주세요.";
/** What the model section is, said once on the section. */
export const AI_SUGGESTION_NOTE = "AI가 기록을 보고 만든 제안이에요. 다음 실험은 디렉터와 팀이 정해요.";
const STATUS_KO: Record<string, string> = { open: "아직 확인 중", supported: "맞았어요", refuted: "틀렸어요", revised: "고쳐 썼어요" };
const EXPERIMENT_STATUS_KO: Record<string, string> = { draft: "초안", running: "진행 중", closed: "끝남" };
export const METHOD_KO: Record<string, string> = { task_test: "과제 해 보기", interview: "인터뷰", observation: "지켜보기" };
const CONFIDENCE_KO: Record<string, string> = { observed: "확인한 것", interpreted: "해석", assumed: "가정" };
const SHOWN_AS_KO: Record<string, string> = { team_decision: "팀 결정", director_decision: "디렉터 결정", ai_suggestion: "AI 제안 (결정 아님)" };

/** At most this many claims per section; the rest are counted in a note, never dropped silently. */
export const MAX_ITEMS_PER_SECTION = 60;
/** A claim's text is cut here with an ellipsis; its source still opens the whole record. Bounds one pack row. */
export const MAX_ITEM_TEXT = 1000;
const clip = (t: string) => (t.length > MAX_ITEM_TEXT ? `${t.slice(0, MAX_ITEM_TEXT - 1)}…` : t);
const MAX_AGENDA_SOURCES = 10;

const short = (id: string) => id.replace(/^sha256:/, "").slice(0, 8);
const cap = (items: ReviewItem[], notes: string[]): { items: ReviewItem[]; notes: string[] } => {
  const kept = items.slice(0, MAX_ITEMS_PER_SECTION).map((i) => ({ ...i, text: clip(i.text) }));
  return items.length <= MAX_ITEMS_PER_SECTION ? { items: kept, notes } : { items: kept, notes: [...notes, `외 ${items.length - MAX_ITEMS_PER_SECTION}개는 프로젝트 기억에서 볼 수 있어요.`] };
};

// ── The week ────────────────────────────────────────────────────────────────

/**
 * The week a pack is for: the requested one (1–52, the Experiment contract's range), else the
 * week of the newest experiment the team ran (a director's draft is not run), else 1. null when
 * the requested value is not a week.
 */
export function reviewWeek(memory: Pick<MemoryState, "experiments">, requested?: unknown): number | null {
  if (requested !== undefined && requested !== null && requested !== "") {
    const n = typeof requested === "string" && /^\d{1,2}$/.test(requested) ? Number(requested) : requested;
    return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 52 ? (n as number) : null;
  }
  const ran = [...memory.experiments].filter((e) => e.status !== "draft").sort((a, b) => b.created_at - a.created_at)[0];
  return ran?.week ?? 1;
}

/** The experiments a week's pack reviews: those of that week the team ran (drafts are next weeks' plans, not runs). */
export function weekExperiments(memory: Pick<MemoryState, "experiments">, week: number): Experiment[] {
  return [...memory.experiments].filter((e) => e.week === week && e.status !== "draft").sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}

// ── The nine fact sections (composed by rule, no model) ─────────────────────

export interface ComposedSection {
  id: ReviewSectionId;
  items: ReviewItem[];
  notes: string[];
  proposals?: SlideProposal[];
}

const itemMarks = (i: EvidenceItemView, withAuthor: boolean): ReviewMark[] => {
  const m: ReviewMark[] = [];
  if (withAuthor && i.created_by === "system") m.push("ai_written");
  if (i.pending_review) m.push("unreviewed");
  if (i.sources_real === false) m.push("not_real");
  if (i.assumption_status === "observed_later") m.push("observed_later");
  return m;
};
const evidenceItem = (cls: "observed" | "interpreted" | "assumed", i: EvidenceItemView, withAuthor: boolean): ReviewItem => {
  const marks = itemMarks(i, withAuthor);
  return { class: cls, text: i.statement, sources: [i.id], ...(marks.length ? { marks } : {}) };
};

/**
 * The nine sections composed by rule from Venture Memory, in order (every section but the
 * model's). `proposals` are the slide patch proposals pending now: none until cr-deck stores
 * them (CR-56); the "deck slides affected" section then says so in words (CR-48).
 */
export function composeFacts(memory: MemoryState, week: number, proposals: readonly SlideProposal[] = []): ComposedSection[] {
  const exps = weekExperiments(memory, week);
  const expIds = new Set(exps.map((e) => e.id));
  const ordinal = new Map(memory.versions.map((v, i) => [v.id, i]));
  const weekItems = memory.evidence_items.filter((i) => expIds.has(i.experiment_id));
  const weekItemIds = new Set(weekItems.map((i) => i.id));

  // 1. The hypotheses the week's experiments tested, with their current statement and status.
  const hypothesisIds = [...new Set(exps.map((e) => e.hypothesis_id))];
  const hyps = hypothesisIds.map((id) => memory.hypotheses.find((h) => h.id === id)).filter((h): h is MemoryState["hypotheses"][number] => !!h);
  const hypothesisItems: ReviewItem[] = [];
  for (const h of hyps) {
    const revs = h.revisions;
    const cur = revs.at(-1)!;
    hypothesisItems.push({ class: "record", text: `가설: ${cur.statement} · ${STATUS_KO[cur.status] ?? cur.status}`, sources: [`hypothesis:${h.id}@${cur.revision}`] });
    if (revs.length > 1) hypothesisItems.push({ class: "record", text: `처음 가설: ${revs[0]!.statement}`, sources: [`hypothesis:${h.id}@${revs[0]!.revision}`] });
  }

  // 2. What was actually tested: the question, the method, the success criteria and the version.
  const experimentItems: ReviewItem[] = [];
  for (const e of exps) {
    const src = `experiment:${e.id}`;
    experimentItems.push({ class: "record", text: `질문: ${e.question} · 방법: ${METHOD_KO[e.method] ?? e.method} · ${EXPERIMENT_STATUS_KO[e.status] ?? e.status}`, sources: [src] });
    for (const c of e.success_criteria) experimentItems.push({ class: "record", text: `성공 기준: ${c}`, sources: [src] });
    const n = ordinal.get(e.product_version_id);
    experimentItems.push({ class: "record", text: n === undefined ? `시험한 버전: ${short(e.product_version_id)}` : `시험한 버전: v${n} (${short(e.product_version_id)})`, sources: [src, `version:${e.product_version_id}`] });
    if (e.data_deleted_at !== undefined) experimentItems.push({ class: "record", text: "이 실험의 참가 기록은 지워졌어요.", sources: [src] });
  }

  // 3–4. Observed evidence and interpretation of the week's experiments, kept apart (CR-48, PRD §5.3).
  const observed = weekItems.filter((i) => i.confidence === "observed").map((i) => evidenceItem("observed", i, false));
  const interpreted = weekItems.filter((i) => i.confidence === "interpreted").map((i) => evidenceItem("interpreted", i, true));

  // 5. The product: the version the week tested, and every version made after it with the decision behind it (CR-77).
  const productItems: ReviewItem[] = [];
  const testedIds = [...new Set(exps.map((e) => e.product_version_id))];
  const tested = memory.versions.filter((v) => testedIds.includes(v.id));
  for (const v of tested) productItems.push({ class: "record", text: `실험한 버전: v${ordinal.get(v.id)} (${short(v.id)}) · 파일 ${v.files.length}개`, sources: [`version:${v.id}`] });
  const lastTested = tested.at(-1);
  const newer = lastTested ? memory.versions.filter((v) => v.created_at > lastTested.created_at) : [];
  const items = new Map(memory.evidence_items.map((i) => [i.id, i]));
  for (const v of newer) {
    const diff = versionDiff(memory.project.id, lastTested!, v, memory.decisions, items);
    const changed = diff.ok ? diff.files.length : 0;
    productItems.push({ class: "record", text: `새 버전: v${ordinal.get(v.id)} (${short(v.id)}) · 바뀐 파일 ${changed}개`, sources: [`version:${v.id}`] });
    const behind = memory.decisions.filter((d) => isHumanDecision(d) && d.resulting_version_id === v.id);
    if (behind.length) for (const d of behind) productItems.push({ class: "record", text: `이 버전을 만든 ${SHOWN_AS_KO[shownAs(d)]}: ${d.statement}`, sources: [`decision:${d.id}`, `version:${v.id}`] });
    else productItems.push({ class: "record", text: `v${ordinal.get(v.id)}를 만든 결정은 기록되지 않았어요.`, sources: [`version:${v.id}`] });
  }

  // 6. Metrics: a value only from real records (CR-76, SX-46); otherwise said so.
  const metricItems: ReviewItem[] = memory.metrics.map((m) => {
    const v = m.value;
    const unreal = Object.keys(v.not_counted).length ? " · 연습·가상 기록은 세지 않았어요" : "";
    if (v.status === "result") return { class: "record", text: `${m.name}: ${v.value}${m.unit} (실제 기록 ${v.source_refs.length}개)${unreal}`, sources: [`metric:${m.id}`] };
    if (v.status === "evidence_only") return { class: "record", text: `${m.name}: 숫자 없이 근거 ${v.source_refs.length}개${unreal}`, sources: [`metric:${m.id}`, ...v.source_refs.slice(0, MAX_AGENDA_SOURCES)] };
    return { class: "record", text: `${m.name}: 근거가 되는 실제 기록이 없어요${unreal}`, sources: [`metric:${m.id}`] };
  });

  // 7. Deck slides the week's decisions affect (CR-41 `affected_deck_slides`), and pending patch proposals (CR-56).
  const weekDecisions = memory.decisions.filter(
    (d) => isHumanDecision(d) && ((d.experiment_id !== undefined && expIds.has(d.experiment_id)) || d.evidence_refs.some((r) => weekItemIds.has(r)) || d.review?.week === week),
  );
  const slideNumbers = [...new Set(weekDecisions.flatMap((d) => d.affected_deck_slides))].filter((n) => n >= 1 && n <= DECK_SLIDES).sort((a, b) => a - b);
  const deckItems: ReviewItem[] = slideNumbers.map((n) => {
    const ds = weekDecisions.filter((d) => d.affected_deck_slides.includes(n));
    const slide = memory.deck_slides.find((s) => s.number === n);
    return {
      class: "record",
      text: `슬라이드 ${n}${slide ? ` (${slide.title})` : ""}: ${ds.map((d) => `${SHOWN_AS_KO[shownAs(d)]} "${d.statement}"`).join(", ")}`,
      sources: [...ds.map((d) => `decision:${d.id}`), ...(slide ? [`slide:${n}@${slide.revision}`] : [])],
    };
  });
  const pending = proposals.filter((p) => p.slide >= 1 && p.slide <= DECK_SLIDES);
  for (const p of pending) deckItems.push({ class: "record", text: `슬라이드 ${p.slide} 수정 제안 (근거 ${p.evidence_refs.length}개)`, sources: [...p.evidence_refs] });
  const deckNotes = [...(slideNumbers.length ? [] : ["이 주의 결정이 바꾸는 슬라이드는 없어요."]), ...(pending.length ? [] : [NO_PROPOSAL])];

  // 8. Assumptions the project still holds open (CR-82): project-wide, not only this week's.
  const open = memory.register.assumed.filter((i) => i.assumption_status !== "observed_later");
  const assumptionItems = open.map((i) => evidenceItem("assumed", i, true));

  // 9. What the director and the team need to decide now (PRD §1.1 item 8), read off the records:
  //    the hypothesis the week tested, with what was observed about it; and which open
  //    assumption the next experiment tests. Nothing here is a model's.
  const agenda: ReviewItem[] = [];
  const observedRefs = observed.flatMap((o) => o.sources).slice(0, MAX_AGENDA_SOURCES);
  for (const h of hyps) {
    const cur = h.revisions.at(-1)!;
    agenda.push({ class: "agenda", text: `가설 "${cur.statement}"을(를) 그대로 둘지, 고칠지, 버릴지 정하기${observed.length ? ` (관찰한 것 ${observed.length}개)` : " (아직 관찰한 것이 없어요)"}`, sources: [`hypothesis:${h.id}@${cur.revision}`, ...observedRefs] });
  }
  if (open.length) agenda.push({ class: "agenda", text: `다음 실험에서 먼저 확인할 가정 고르기 (아직 확인 안 된 가정 ${open.length}개)`, sources: open.map((i) => i.id).slice(0, MAX_AGENDA_SOURCES) });
  const unreviewed = weekItems.filter((i) => i.pending_review).length;
  const agendaNotes = [...(agenda.length ? [] : ["지금 정할 것이 기록에 아직 없어요."]), ...(unreviewed ? [`팀이 아직 검토하지 않은 AI 초안이 ${unreviewed}개 있어요. 검토해야 결정의 근거로 쓸 수 있어요.`] : [])];

  const section = (id: ReviewSectionId, list: ReviewItem[], emptyNote: string | null, extra: string[] = []): ComposedSection => {
    const c = cap(list, list.length || emptyNote === null ? extra : [emptyNote, ...extra]);
    return { id, items: c.items, notes: c.notes };
  };
  return [
    section("hypothesis", hypothesisItems, `${week}주차에 시험한 가설이 없어요.`),
    section("experiment", experimentItems, `${week}주차에 한 실험이 없어요.`),
    section("observed", observed, "이 주에 기록된 관찰이 없어요."),
    section("interpretation", interpreted, "이 주에 적은 해석이 없어요."),
    section("product_change", productItems, tested.length ? null : "이 주에 시험한 버전이 없어요.", tested.length && !newer.length ? ["실험한 뒤로 새 버전은 없어요."] : []),
    section("metrics", metricItems, "정한 지표가 없어요."),
    { ...section("deck_slides", deckItems, null, deckNotes), proposals: pending.map((p) => ({ slide: p.slide, evidence_refs: [...p.evidence_refs] })) },
    section("assumptions", assumptionItems, "확인할 가정이 남아 있지 않아요."),
    section("decision_needed", agenda, null, agendaNotes),
  ];
}

// ── The model section: the Experiment skill, unchanged ──────────────────────

export interface NextExperimentRun {
  skill: CurriculumSkill;
  input: { week: number };
  context: Record<string, unknown>;
  prompt: string;
  /** The coach route's request metadata (CR-45): the skill tag and a capability, never a model id. */
  headers: Record<string, string>;
}

/**
 * The Experiment skill's run for the week after `week`: the same prompt, context and output check
 * the skills panel uses (cr-skills), read from the same Venture Memory. The section's digest is the
 * digest of exactly this context and input.
 */
export function nextExperimentRun(memory: MemoryState, week: number): NextExperimentRun {
  const skill = CURRICULUM_SKILLS.get(NEXT_EXPERIMENT_SKILL);
  if (!skill) throw new Error("next_experiment_skill_missing");
  // The skill's input schema takes a curriculum week (1–6); a pack of week 6 or later asks for week 6.
  const input = { week: Math.min(Math.max(week + 1, 1), 6) };
  const context = modelContextOf(skill.contract, memory, { week: input.week, version: null, records: null });
  return { skill, input, context, prompt: skillPrompt(skill, context, input), headers: { "x-hps-skill": skill.tag, "x-hps-capability": skill.contract.preferred_capability } };
}

export const runDigest = (run: NextExperimentRun) => digestOf({ skill: run.skill.tag, context: run.context, input: run.input });

/** The skill's own output check (CR-44): the schema, then its validation rules, against the records now. */
export function checkNextExperiment(memory: MemoryState, run: NextExperimentRun, output: unknown) {
  return checkSkillOutput(run.skill, skillContextOf(memory, run.input.week, null), run.input, output);
}

/** The accepted suggestion as claims, every one labelled the AI's; the assumption it tests is cited when the register has it. */
export function nextExperimentItems(out: Record<string, unknown>): ReviewItem[] {
  const refs = typeof out.assumption_ref === "string" && out.assumption_ref ? [out.assumption_ref] : [];
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const items: ReviewItem[] = [
    { class: "ai_suggestion", text: `확인할 가정: ${String(out.assumption ?? "")}`, sources: refs, ...(refs.length ? {} : { marks: ["not_in_register" as const] }) },
    { class: "ai_suggestion", text: `먼저 확인하는 이유: ${String(out.why_riskiest ?? "")}`, sources: refs },
    { class: "ai_suggestion", text: `가설: ${String(out.hypothesis ?? "")}`, sources: refs },
    { class: "ai_suggestion", text: `방법: ${METHOD_KO[String(out.method)] ?? String(out.method ?? "")}`, sources: [] },
    ...list(out.procedure).map((p, i): ReviewItem => ({ class: "ai_suggestion", text: `${i + 1}. ${p}`, sources: [] })),
    ...list(out.success_criteria).map((c): ReviewItem => ({ class: "ai_suggestion", text: `성공 기준: ${c}`, sources: [] })),
  ];
  return items.map((i) => ({ ...i, text: clip(i.text) }));
}

// ── The current state, staleness, and the next revision ────────────────────

export interface CurrentReview {
  week: number;
  facts: Array<ComposedSection & { digest: string }>;
  next: { run: NextExperimentRun; digest: string };
}

/** What every section would be composed from now. No model call. */
export async function currentReview(memory: MemoryState, week: number, proposals: readonly SlideProposal[] = []): Promise<CurrentReview> {
  const facts = composeFacts(memory, week, proposals);
  const digests = await Promise.all(facts.map((f) => digestOf(f)));
  const run = nextExperimentRun(memory, week);
  return { week, facts: facts.map((f, i) => ({ ...f, digest: digests[i]! })), next: { run, digest: await runDigest(run) } };
}

export type ReviewStatus = "fresh" | "stale" | "missing";

/**
 * A stored pack against the records now (CR-49, CR-53): `missing` with no pack; `stale` when any
 * section's digest differs from what it would be composed from now (or a model section was never
 * generated); else `fresh`. Never generates anything (CR-50).
 */
export function reviewStatus(pack: Pick<WeeklyReview, "sections"> | null, current: CurrentReview): { status: ReviewStatus; stale_sections: ReviewSectionId[] } {
  if (!pack) return { status: "missing", stale_sections: [...REVIEW_SECTION_IDS] };
  const stale: ReviewSectionId[] = [];
  for (const id of REVIEW_SECTION_IDS) {
    const s = pack.sections.find((x) => x.id === id);
    const want = id === "next_experiment" ? current.next.digest : current.facts.find((f) => f.id === id)?.digest;
    if (!s || s.digest === null || s.digest !== want) stale.push(id);
  }
  return { status: stale.length ? "stale" : "fresh", stale_sections: stale };
}

/**
 * The next revision of a week's pack (CR-49): a section whose digest is still current is carried
 * over byte for byte (its `generated_at` and `generated_in` too); a stale fact section is composed
 * again; the model section is replaced only by an accepted suggestion for exactly the current
 * context (`model.output`), else the earlier suggestion stays (and opens stale) or, the first
 * time, the section says it was not generated. `regenerated` names the sections this revision wrote.
 */
export function buildPack(
  base: WeeklyReview | null,
  current: CurrentReview,
  input: { project_id: string; by: string; now: number; model?: { output: Record<string, unknown>; model: string | null }; timing?: { total_ms: number; provider_ms: number } },
): { pack: WeeklyReview; regenerated: ReviewSectionId[] } {
  const revision = (base?.revision ?? 0) + 1;
  const sections: ReviewSection[] = REVIEW_SECTION_IDS.map((id) => {
    const old = base?.sections.find((s) => s.id === id);
    if (id === "next_experiment") {
      if (old && old.digest !== null && old.digest === current.next.digest) return old;
      if (input.model) {
        return { id, digest: current.next.digest, generated_at: input.now, generated_in: revision, items: nextExperimentItems(input.model.output), notes: [AI_SUGGESTION_NOTE], skill: current.next.run.skill.tag, model: input.model.model, suggestion: input.model.output };
      }
      return old ?? { id, digest: null, generated_at: input.now, generated_in: revision, items: [], notes: [NOT_GENERATED] };
    }
    const f = current.facts.find((x) => x.id === id)!;
    if (old && old.digest === f.digest) return old;
    return { id, digest: f.digest, generated_at: input.now, generated_in: revision, items: f.items, notes: f.notes, ...(f.proposals ? { proposals: f.proposals } : {}) };
  });
  const pack: WeeklyReview = {
    schema: VENTURE_SCHEMA,
    kind: "weekly_review",
    format: REVIEW_FORMAT,
    project_id: input.project_id,
    week: current.week,
    revision,
    prepared_at: input.now,
    prepared_by: input.by,
    sections,
    ...(input.timing ? { timing: input.timing } : {}),
  };
  return { pack, regenerated: sections.filter((s) => s.generated_in === revision).map((s) => s.id) };
}

// ── The pack's own check (CR-48), run before anything is stored ─────────────

const SOURCE_REF = /^(ev:.+|hypothesis:[A-Za-z0-9_-]{1,64}@\d{1,4}|experiment:[A-Za-z0-9_-]{1,64}|version:sha256:[0-9a-f]{64}|decision:[A-Za-z0-9_-]{1,64}|metric:[A-Za-z0-9_-]{1,64}|slide:[1-8]@\d{1,4})$/;

/**
 * Problems with a pack; empty means it may be stored. Every claim about the records names a
 * source in a known form; each section holds only its own class of item, so observed evidence,
 * interpretation, assumptions and the AI's suggestion never mix; the "deck slides affected"
 * section says "no proposal" in words when none is pending; the ten sections are all there, in
 * the PRD's order.
 */
export function packProblems(pack: WeeklyReview): string[] {
  const out: string[] = [];
  if (pack.schema !== VENTURE_SCHEMA || pack.kind !== "weekly_review" || pack.format !== REVIEW_FORMAT) out.push("not_a_weekly_review");
  if (!Number.isInteger(pack.week) || pack.week < 1 || pack.week > 52) out.push("invalid:week");
  if (!Number.isInteger(pack.revision) || pack.revision < 1) out.push("invalid:revision");
  const ids = (pack.sections ?? []).map((s) => s.id);
  if (ids.length !== REVIEW_SECTION_IDS.length || ids.some((id, i) => id !== REVIEW_SECTION_IDS[i])) out.push("sections_not_the_ten_in_order");
  for (const s of pack.sections ?? []) {
    if (!(REVIEW_SECTION_IDS as readonly string[]).includes(s.id)) continue;
    if (s.digest === null && !MODEL_SECTIONS.includes(s.id)) out.push(`${s.id}: fact_section_without_digest`);
    if (!Array.isArray(s.items) || !Array.isArray(s.notes)) {
      out.push(`${s.id}: invalid_section`);
      continue;
    }
    s.items.forEach((it, i) => {
      const at = `${s.id}[${i}]`;
      if (!(REVIEW_ITEM_CLASSES as readonly string[]).includes(it.class)) out.push(`${at}: invalid_class`);
      else if (it.class !== SECTION_CLASS[s.id]) out.push(`${at}: class_not_allowed:${it.class}`);
      if (typeof it.text !== "string" || !it.text.trim() || it.text.length > 2000) out.push(`${at}: invalid_text`);
      if (!Array.isArray(it.sources)) out.push(`${at}: invalid_sources`);
      else {
        if (SOURCED_CLASSES.has(it.class) && it.sources.length === 0) out.push(`${at}: claim_without_source`);
        for (const r of it.sources) if (typeof r !== "string" || !SOURCE_REF.test(r)) out.push(`${at}: unknown_source:${String(r).slice(0, 80)}`);
      }
    });
    if (!s.items.length && !s.notes.length) out.push(`${s.id}: empty_without_note`);
    if (s.id === "deck_slides" && !(Array.isArray(s.proposals) && s.proposals.length) && !s.notes.includes(NO_PROPOSAL)) out.push("deck_slides: no_proposal_not_said");
    if (s.id === "next_experiment" && s.digest === null && !s.notes.includes(NOT_GENERATED)) out.push("next_experiment: not_generated_not_said");
  }
  return out;
}

// ── Sources, resolved on every open ─────────────────────────────────────────

/** Every reference a pack's claims and proposals name, once. */
export function sourcesOf(pack: Pick<WeeklyReview, "sections">): string[] {
  const out = new Set<string>();
  for (const s of pack.sections) {
    for (const it of s.items) for (const r of it.sources) out.add(r);
    for (const p of s.proposals ?? []) for (const r of p.evidence_refs) out.add(r);
  }
  return [...out];
}

export interface SourceView {
  ref: string;
  kind: "evidence_item" | "hypothesis" | "experiment" | "product_version" | "decision" | "metric" | "deck_slide" | "unknown";
  /** The record resolves now. A claim whose source no longer resolves says so ("needs review", SX-32 / MC-15). */
  found: boolean;
  label: string;
  /** What opening the source shows: an evidence item's records, a revision's status, a version's files. */
  lines: string[];
}

const RECORD_KO = (r: string) => (r.startsWith("session:") ? `참가 세션 ${r.slice(8, 20)}` : r.startsWith("event:") ? `참가 기록 ${r.slice(6, 18)}` : r.startsWith("note:") ? `메모 ${r.slice(5, 22)}` : r);

/** Each reference resolved against the records now (no model call): what it is and whether it still exists. */
export function resolveSources(memory: MemoryState, refs: Iterable<string>): Record<string, SourceView> {
  const out: Record<string, SourceView> = {};
  const items = new Map(memory.evidence_items.map((i) => [i.id, i]));
  const missing = (ref: string, kind: SourceView["kind"]): SourceView => ({ ref, kind, found: false, label: "찾을 수 없는 기록이에요 (지워졌거나 바뀌었어요)", lines: [] });
  for (const ref of refs) {
    if (out[ref]) continue;
    const [kind, rest = ""] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
    if (kind === "ev") {
      const it = items.get(ref);
      out[ref] = it
        ? { ref, kind: "evidence_item", found: true, label: it.statement, lines: [`${CONFIDENCE_KO[it.confidence] ?? it.confidence} · ${it.pending_review ? "아직 검토하지 않은 초안" : "검토함"}${it.sources_real === false ? " · 실제로 본 기록이 아니에요" : ""}`, ...it.source_refs.map(RECORD_KO)] }
        : missing(ref, "evidence_item");
    } else if (kind === "hypothesis") {
      const [id, rev] = rest.split("@");
      const r = memory.hypotheses.find((h) => h.id === id)?.revisions.find((x) => String(x.revision) === rev);
      out[ref] = r ? { ref, kind: "hypothesis", found: true, label: r.statement, lines: [`${r.revision}번째 기록 · ${STATUS_KO[r.status] ?? r.status}`] } : missing(ref, "hypothesis");
    } else if (kind === "experiment") {
      const e = memory.experiments.find((x) => x.id === rest);
      out[ref] = e ? { ref, kind: "experiment", found: true, label: `${e.week}주차 실험 · ${e.question}`, lines: [`방법: ${METHOD_KO[e.method] ?? e.method}`, ...e.success_criteria.map((c) => `성공 기준: ${c}`)] } : missing(ref, "experiment");
    } else if (kind === "version") {
      const i = memory.versions.findIndex((v) => v.id === rest);
      const v = memory.versions[i];
      out[ref] = v ? { ref, kind: "product_version", found: true, label: `v${i} (${short(v.id)}) · 시작 파일 ${v.entry_html}`, lines: v.files.map((f) => `${f.path} · ${short(f.sha256)}`) } : missing(ref, "product_version");
    } else if (kind === "decision") {
      const d = memory.decisions.find((x) => x.id === rest);
      out[ref] = d ? { ref, kind: "decision", found: true, label: `${SHOWN_AS_KO[d.shown_as]}: ${d.statement}`, lines: [...(d.no_evidence ? ["근거가 연결되지 않았어요"] : d.evidence.map((e) => `근거: ${e.statement ?? "찾을 수 없는 근거"}`)), ...(d.affected_deck_slides.length ? [`슬라이드 ${d.affected_deck_slides.join(", ")}`] : [])] } : missing(ref, "decision");
    } else if (kind === "metric") {
      const m = memory.metrics.find((x) => x.id === rest);
      out[ref] = m ? { ref, kind: "metric", found: true, label: m.name, lines: [m.definition, ...m.value.source_refs.slice(0, 20).map(RECORD_KO)] } : missing(ref, "metric");
    } else if (kind === "slide") {
      const [n, rev] = rest.split("@");
      const sl = memory.slide_revisions.find((x) => String(x.number) === n && String(x.revision) === rev);
      out[ref] = sl ? { ref, kind: "deck_slide", found: true, label: `슬라이드 ${sl.number} · ${sl.title}`, lines: [sl.body].filter(Boolean) } : missing(ref, "deck_slide");
    } else out[ref] = missing(ref, "unknown");
  }
  return out;
}

/**
 * What a director's decision may cite from a pack (CR-52 "linked to the pack's evidence"): the
 * evidence items of its observed and interpretation sections, and the assumptions of its
 * assumptions section.
 */
export function packEvidence(pack: Pick<WeeklyReview, "sections">): { evidence: Set<string>; assumptions: Set<string> } {
  const refsOf = (id: ReviewSectionId) => (pack.sections.find((s) => s.id === id)?.items ?? []).flatMap((i) => i.sources).filter((r) => parseEvidenceItemRef(r) !== null);
  return { evidence: new Set([...refsOf("observed"), ...refsOf("interpretation")]), assumptions: new Set(refsOf("assumptions")) };
}

/** The `ev:` references a pack quotes (its statements are copies of these items' statements). */
export const evidenceRefsOf = (pack: Pick<WeeklyReview, "sections">): string[] => sourcesOf(pack).filter((r) => parseEvidenceItemRef(r) !== null);

/** A director's decision as the pack shows it under its sections (CR-51): the decision and the draft written with it. */
export function decisionsOfReview(decisions: readonly Decision[], week: number): Decision[] {
  return decisions.filter((d) => d.actor === "director" && d.review?.week === week);
}
