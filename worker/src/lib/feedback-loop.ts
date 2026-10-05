// #1013 feedback-loop — the learner's answer to a person's feedback (AE-43) and the instructor's lesson retrospective that
// starts the next draft (AE-42, CH-05). PURE rules: what may be written, whose words each cited part is, and what a finding
// may claim. Storage and HTTP: routes/classroom.ts (the learner's answer) and routes/lesson-retrospective.ts.
//
// What this keeps from the contracts it builds on, and how:
//   - Selective sending (classroom sharing ADM-03/07/14, hps-observation/1). A retrospective cites a share the learner chose
//     to send to THIS instructor, by id and part. It never copies the learner's content, so a withdrawal or an expiry reaches
//     it: the reference then resolves to nothing and the finding falls back to unobserved.
//   - Unobserved stays unobserved. A finding is `observed` only on the learner's own words (question, prompt, verification,
//     their answer to feedback). Which part counts is decided by the measurement core's ONE predicate, `isHumanEvidence`, over
//     each part read as the event it is (ORIGIN_EVENT) — the rule behind `missing_human_evidence`, not a copy of it (SX-48).
//     An AI answer, a tool line or a URL never counts, and neither does a person's feedback: the only feedback a retrospective
//     can cite is the reviewing instructor's own text (actor `teacher`), so it fills the social-correction axis
//     (`human_feedback`) and is never evidence about the learner. No feedback cited means that axis is unobserved, never
//     "there was none".
//   - Evidence about the version that ran, or visibly not. A share stands behind a finding about one frozen version only if
//     it was sent after that version was frozen and, where the Service recorded which lesson the learner was executing when
//     they sent it (`classroom_share_lessons`), that lesson is this course and version. A share with no such record reads
//     `lesson: unknown`; it is never silently attributed.
//   - No independence is inferred. Nothing in a share records independent performance, so `independent` is refused, and
//     `assisted` needs a cited help request. A missing record is `unknown`, never "did it alone".
//   - No score. A key shaped like a score is refused by the measurement core's own check (forbidPersonalMetrics).
import { forbidPersonalMetrics, isHumanEvidence } from './measurement-core/learning-events.ts';

/** Off unless the Service sets `HPS_FEEDBACK_LOOP=enabled` (migration 0039 first). Off = the routes answer 404. */
export const feedbackLoopEnabled = (env: { HPS_FEEDBACK_LOOP?: string }) => env.HPS_FEEDBACK_LOOP === 'enabled';
export const RETROSPECTIVE_FORMAT = 'hps-lesson-retrospective/1';

/** The six content fields a share may carry (routes/classroom.ts). */
export const CONTENT_PARTS = ['question', 'prompt', 'response', 'tool_summary', 'artifact_url', 'verification'] as const;
/**
 * Whose words each part of a share is. Derived from the part's NAME, never typed by anyone, so an AI answer cannot be
 * cited as a person's feedback: `response` is always `ai`, and `feedback` is only ever the recipient's own text.
 */
export const PART_ORIGIN = {
  question: 'learner',
  prompt: 'learner',
  verification: 'learner',
  response: 'ai',
  tool_summary: 'tool',
  artifact_url: 'artifact',
  feedback: 'human',
  learner_response: 'learner',
} as const;
export type SharePart = keyof typeof PART_ORIGIN;
export type PartOrigin = (typeof PART_ORIGIN)[SharePart];
/**
 * Each origin as the measurement core reads an event: what kind of record it is and who acted (OBSERVATION_ACTORS).
 * `human` is the feedback on a share, written by its recipient: the instructor (`teacher`), never the learner.
 */
export const ORIGIN_EVENT: Readonly<Record<PartOrigin, { kind: string; actor: string }>> = {
  learner: { kind: 'user', actor: 'user' },
  ai: { kind: 'coach', actor: 'ai' },
  tool: { kind: 'tool_result', actor: 'ai' },
  artifact: { kind: 'artifact', actor: 'user' },
  human: { kind: 'external_feedback_received', actor: 'teacher' },
};
/** Is this part evidence about the learner? The measurement core's own predicate decides; nothing here re-states it. */
export const isLearnerEvidence = (origin: PartOrigin) => isHumanEvidence(ORIGIN_EVENT[origin]);

// ── the learner's answer to a person's feedback (AE-43) ───────────────────────────────────────────────────────────

export const RESPONSE_DECISIONS = ['revise', 'keep', 'hold'] as const;
export type ResponseDecision = (typeof RESPONSE_DECISIONS)[number];
export const RESPONSE_REASON_MAX = 2000;

export interface ShareRow {
  id: string; cohort_id: string; profile_id: string; student_id: string; recipient_id: string; session_id: string;
  kind: string; content_json: string; revision: number; status: string; feedback: string; next_action: string;
  created_at: number; expires_at: number;
}
export interface ResponseRow { share_id: string; feedback_sha256: string; feedback_revision: number; decision: string; reason: string; created_at: number }

/** A person's feedback exists: the recipient answered (or the learner confirmed after an answer) with a non-empty text. */
export const hasFeedback = (s: Pick<ShareRow, 'status' | 'feedback'>) =>
  (s.status === 'answered' || s.status === 'resolved') && typeof s.feedback === 'string' && s.feedback.trim() !== '';

/** The body of `POST /v1/classroom/shares/:id/response`. Nothing is optional and nothing is filled in for the learner. */
export function parseResponse(b: unknown): { ok: true; expected_revision: number; decision: ResponseDecision; reason: string } | { ok: false; code: string } {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, code: 'invalid_response' };
  const o = b as Record<string, unknown>;
  if (Object.keys(o).some((k) => !['expected_revision', 'decision', 'reason'].includes(k))) return { ok: false, code: 'unknown_field' };
  if (!Number.isSafeInteger(o.expected_revision)) return { ok: false, code: 'revision_required' };
  if (!(RESPONSE_DECISIONS as readonly unknown[]).includes(o.decision)) return { ok: false, code: 'invalid_decision' };
  if (typeof o.reason !== 'string' || !o.reason.trim() || o.reason.length > RESPONSE_REASON_MAX) return { ok: false, code: 'invalid_reason' };
  return { ok: true, expected_revision: o.expected_revision as number, decision: o.decision as ResponseDecision, reason: o.reason };
}

/**
 * The feedback text a learner's answer is compared with: the text as it is stored NOW, whatever the share's status. The learner
 * sees that text on /sharing while it is "검토 중" too, so a status change alone does not make it another question; status
 * decides only whether a NEW answer may be written (`hasFeedback`). Null = no text, nothing an answer could be bound to.
 */
export const storedFeedback = (s: Pick<ShareRow, 'feedback'>) => (typeof s.feedback === 'string' && s.feedback.trim() !== '' ? s.feedback : null);

/**
 * Which of one share's stored answers a reader sees: the one bound to the feedback as it reads now (`feedbackSha`, the digest of
 * `storedFeedback`), whenever it was written, so feedback edited A → B → A shows A's answer again rather than B's newer one.
 * Only when no answer is bound to the current text is the newest shown (by time, then by the feedback revision it answered),
 * and `responseView` then marks it as answering an earlier feedback.
 */
export function responseFor(rows: readonly ResponseRow[], feedbackSha: string | null): ResponseRow | null {
  const bound = feedbackSha === null ? undefined : rows.find((r) => r.feedback_sha256 === feedbackSha);
  if (bound) return bound;
  let newest: ResponseRow | null = null;
  for (const r of rows) if (!newest || r.created_at > newest.created_at || (r.created_at === newest.created_at && r.feedback_revision > newest.feedback_revision)) newest = r;
  return newest;
}

/** What a reader sees of the learner's answer (`responseFor`). `answers_current_feedback` is false once the feedback text changed. */
export const responseView = (r: ResponseRow | null, currentFeedbackSha: string | null) =>
  r ? { decision: r.decision, reason: r.reason, created_at: r.created_at, answers_current_feedback: currentFeedbackSha !== null && r.feedback_sha256 === currentFeedbackSha } : null;

/** The parts of a share that hold something now, each with whose words they are. Never the content itself. */
export function shareParts(s: ShareRow, answered: boolean): Array<{ part: SharePart; origin: PartOrigin }> {
  let content: Record<string, unknown> = {};
  try { content = JSON.parse(s.content_json) ?? {}; } catch { content = {}; }
  const out: Array<{ part: SharePart; origin: PartOrigin }> = [];
  for (const part of CONTENT_PARTS) if (typeof content[part] === 'string' && (content[part] as string).trim()) out.push({ part, origin: PART_ORIGIN[part] });
  if (hasFeedback(s)) out.push({ part: 'feedback', origin: PART_ORIGIN.feedback });
  if (answered) out.push({ part: 'learner_response', origin: PART_ORIGIN.learner_response });
  return out;
}

// ── the instructor's retrospective (AE-42, CH-05) ────────────────────────────────────────────────────────────────

export const ASSISTANCE = ['unknown', 'assisted', 'independent'] as const;
export const DECISION_ACTIONS = ['keep', 'revise', 'hold'] as const;
export const LIMITS = { hypothesis: 2000, findings: 20, finding_text: 2000, sources: 8, decisions: 20, decision_reason: 1000, note: 1000 } as const;
export const NOTE_KEYS = ['no_signal', 'stopped', 'help_use'] as const;
/**
 * The largest body a valid retrospective request can be: every string at its limit, each UTF-16 unit costing up to six
 * JSON bytes (an escaped control character), plus keys and punctuation. Korean alone is three bytes a unit, so a smaller
 * cap would answer 413 to a doc that every field limit, and the page's maxlength, allows.
 */
const ID_UNITS = 64, SHARE_ID_UNITS = 128, PART_UNITS = 32;
export const RETRO_BODY_MAX = 6 * (128 + 32 + LIMITS.hypothesis + NOTE_KEYS.length * LIMITS.note
  + LIMITS.findings * (ID_UNITS + LIMITS.finding_text + PART_UNITS + LIMITS.sources * (SHARE_ID_UNITS + PART_UNITS))
  + LIMITS.decisions * (ID_UNITS + ID_UNITS + PART_UNITS + LIMITS.decision_reason + LIMITS.sources * ID_UNITS)) + 32 * 1024;

export interface RetroSource { share_id: string; part: SharePart }
export interface RetroFinding { id: string; text: string; sources: RetroSource[]; assistance: (typeof ASSISTANCE)[number] }
export interface RetroDecision { id: string; target: string; action: (typeof DECISION_ACTIONS)[number]; reason: string; findings: string[] }
export interface RetroDoc { hypothesis: string; findings: RetroFinding[]; decisions: RetroDecision[]; notes: Partial<Record<(typeof NOTE_KEYS)[number], string>> }

const ITEM_ID = /^[a-zA-Z0-9_-]{1,64}$/, SHARE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
/** Exactly these keys (the optional ones may be absent). Anything else is refused by name, never dropped. */
const keysOk = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every((k) => k in v) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));

/**
 * The instructor's part of a retrospective. `steps` are the step ids of the version it is about: a decision targets one of
 * them or the whole `lesson`. Returns the doc as it will be stored (assistance defaulted to `unknown`, notes trimmed to the
 * three named ones) or the first refusal, by name.
 */
export function validateRetrospectiveDoc(raw: unknown, steps: readonly string[]): { ok: true; doc: RetroDoc } | { ok: false; code: string } {
  const fail = (code: string) => ({ ok: false as const, code });
  try { forbidPersonalMetrics(raw); } catch { return fail('unsupported_score'); }
  if (!isObject(raw) || !keysOk(raw, ['hypothesis', 'findings', 'decisions'], ['notes'])) return fail('invalid_retrospective');
  if (!text(raw.hypothesis, LIMITS.hypothesis)) return fail('invalid_hypothesis');
  if (!Array.isArray(raw.findings) || raw.findings.length < 1 || raw.findings.length > LIMITS.findings) return fail('invalid_findings');
  const findings: RetroFinding[] = [], findingIds = new Set<string>();
  for (const f of raw.findings) {
    if (!isObject(f) || !keysOk(f, ['id', 'text', 'sources'], ['assistance'])) return fail('invalid_finding');
    if (typeof f.id !== 'string' || !ITEM_ID.test(f.id) || findingIds.has(f.id)) return fail('invalid_finding');
    if (!text(f.text, LIMITS.finding_text)) return fail('invalid_finding');
    if (!Array.isArray(f.sources) || f.sources.length > LIMITS.sources) return fail('invalid_source');
    const sources: RetroSource[] = [], seen = new Set<string>();
    for (const s of f.sources) {
      // An own key only: `in` would also admit inherited names such as `constructor` or `__proto__` as parts.
      if (!isObject(s) || !keysOk(s, ['share_id', 'part']) || typeof s.share_id !== 'string' || !SHARE_ID.test(s.share_id) || typeof s.part !== 'string' || !Object.hasOwn(PART_ORIGIN, s.part)) return fail('invalid_source');
      const key = s.share_id + '\u0000' + s.part;
      if (seen.has(key)) return fail('duplicate_source');
      seen.add(key); sources.push({ share_id: s.share_id, part: s.part as SharePart });
    }
    const assistance = f.assistance === undefined ? 'unknown' : f.assistance;
    if (!(ASSISTANCE as readonly unknown[]).includes(assistance)) return fail('invalid_assistance');
    // A share records no independent performance; nothing cited here can carry that claim (T-44, AE-T34).
    if (assistance === 'independent') return fail('unsupported_independence');
    findingIds.add(f.id); findings.push({ id: f.id, text: f.text, sources, assistance: assistance as RetroFinding['assistance'] });
  }
  if (!Array.isArray(raw.decisions) || raw.decisions.length < 1 || raw.decisions.length > LIMITS.decisions) return fail('invalid_decisions');
  const decisions: RetroDecision[] = [], decisionIds = new Set<string>();
  for (const d of raw.decisions) {
    if (!isObject(d) || !keysOk(d, ['id', 'target', 'action', 'reason'], ['findings'])) return fail('invalid_decision');
    if (typeof d.id !== 'string' || !ITEM_ID.test(d.id) || decisionIds.has(d.id)) return fail('invalid_decision');
    if (typeof d.target !== 'string' || (d.target !== 'lesson' && !steps.includes(d.target))) return fail('unknown_step');
    if (!(DECISION_ACTIONS as readonly unknown[]).includes(d.action)) return fail('invalid_decision');
    if (!text(d.reason, LIMITS.decision_reason)) return fail('invalid_decision');
    const refs = d.findings === undefined ? [] : d.findings;
    if (!Array.isArray(refs) || refs.length > LIMITS.sources || refs.some((x) => typeof x !== 'string' || !findingIds.has(x))) return fail('unknown_finding');
    decisionIds.add(d.id); decisions.push({ id: d.id, target: d.target, action: d.action as RetroDecision['action'], reason: d.reason, findings: [...new Set(refs as string[])] });
  }
  const notes: RetroDoc['notes'] = {};
  if (raw.notes !== undefined) {
    if (!isObject(raw.notes) || Object.keys(raw.notes).some((k) => !(NOTE_KEYS as readonly string[]).includes(k))) return fail('invalid_notes');
    for (const k of NOTE_KEYS) {
      const v = raw.notes[k];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v.length > LIMITS.note) return fail('invalid_notes');
      if (v.trim()) notes[k] = v;
    }
  }
  return { ok: true, doc: { hypothesis: raw.hypothesis, findings, decisions, notes } };
}

/** Every share a doc cites, once. */
export const citedShareIds = (doc: RetroDoc) => [...new Set(doc.findings.flatMap((f) => f.sources.map((s) => s.share_id)))];

/**
 * Why this part of this share cannot be cited now ('' = it can). `share` is null when the instructor cannot read it: not
 * theirs, another class, another cohort, expired or withdrawn — one answer for all, so a refusal never confirms existence.
 */
export function citeRefusal(src: RetroSource, share: ShareRow | null, response: ResponseRow | null): string {
  if (!share) return 'source_unavailable';
  if (src.part === 'feedback') return hasFeedback(share) ? '' : 'no_human_feedback';
  if (src.part === 'learner_response') return response ? '' : 'no_learner_response';
  return shareParts(share, !!response).some((p) => p.part === src.part) ? '' : 'source_part_empty';
}

/** What the Service recorded, right after a share was stored, about the lesson its sender was executing (routes/classroom.ts). */
export interface ShareLessonRow { share_id: string; course_id: string; version: string; lesson_sha256: string; source: string; recorded_at: number }
/** The version a retrospective is about: its course, its version id and when it was frozen (unix seconds; null = unreadable). */
export interface RetroBase { course_id: string; version: string; frozen_at: number | null }
/** A share as a retrospective reads it: the row, the learner's answer as a reader sees it (`responseFor`), whether that answer
 *  is to the feedback as it reads NOW, and the lesson recorded when it was sent (null = none recorded). */
export interface CitedShare { share: ShareRow; response: ResponseRow | null; response_current: boolean; lesson: ShareLessonRow | null }

/**
 * Can this share stand behind a finding about `base` at all ('' = yes)? A share sent before the version was frozen is about
 * something else (`source_before_version`), and so is a share whose recorded lesson is another course or another version
 * (`source_other_lesson`). A freeze time that cannot be read refuses rather than guesses. Both times are whole seconds (a
 * share's stored time has no finer grain), so a share sent in the same second as the freeze counts as after it; where the
 * lesson was recorded, the course and version check decides whatever the timing.
 */
export function lessonRefusal(share: Pick<ShareRow, 'created_at'>, lesson: Pick<ShareLessonRow, 'course_id' | 'version'> | null, base: RetroBase): string {
  if (base.frozen_at === null || share.created_at < base.frozen_at) return 'source_before_version';
  if (lesson && (lesson.course_id !== base.course_id || lesson.version !== base.version)) return 'source_other_lesson';
  return '';
}
/** `this_version` only where the Service recorded the lesson; otherwise `unknown`, never assumed to be the version. */
export const lessonAttribution = (lesson: ShareLessonRow | null) => (lesson ? 'this_version' : 'unknown') as 'this_version' | 'unknown';
/** Written now, a cited decision must answer the feedback as it reads now: one about an edited or cleared text is refused. */
export const answerRefusal = (src: RetroSource, x: Pick<CitedShare, 'response_current'>) =>
  src.part === 'learner_response' && !x.response_current ? 'learner_response_stale' : '';

/** `assisted` stands on a cited help request: the learner asked a person for help. */
export const assistanceRefusal = (f: RetroFinding, kindOf: (shareId: string) => string | undefined) =>
  f.assistance === 'assisted' && !f.sources.some((s) => kindOf(s.share_id) === 'help') ? 'unsupported_assistance' : '';

export interface ResolvedShare {
  available: boolean; kind?: string; student_id?: string; parts?: ReadonlySet<SharePart>;
  lesson?: 'this_version' | 'unknown'; response_current?: boolean;
}

/** One finding as it reads NOW, from the shares the instructor can still read. Recomputed on every read, never stored. */
export function findingView(f: RetroFinding, resolve: (shareId: string) => ResolvedShare) {
  const sources = f.sources.map((s) => {
    const r = resolve(s.share_id), available = r.available && !!r.parts?.has(s.part);
    return {
      share_id: s.share_id, part: s.part, origin: PART_ORIGIN[s.part], available,
      // Still readable, but this part holds nothing now (the feedback was cleared): not a withdrawal, and said so.
      ...(r.available && !available ? { part_empty: true } : {}),
      ...(available ? { kind: r.kind, student_id: r.student_id, lesson: r.lesson ?? 'unknown' } : {}),
      ...(available && s.part === 'learner_response' ? { answers_current_feedback: r.response_current === true } : {}),
    };
  });
  const live = sources.filter((s) => s.available);
  const person = live.some((s) => isLearnerEvidence(s.origin));
  const unobserved_reason = person ? null : !f.sources.length ? 'no_source' : !live.length ? 'sources_unavailable' : 'no_person_source';
  const helpLive = live.some((s) => s.kind === 'help');
  return {
    id: f.id, text: f.text, sources,
    status: person ? 'observed' as const : 'unobserved' as const,
    ...(unobserved_reason ? { unobserved_reason } : {}),
    human_feedback: live.some((s) => s.part === 'feedback') ? 'present' as const : 'unobserved' as const,
    assistance: f.assistance === 'assisted' && helpLive ? 'assisted' as const : 'unknown' as const,
    ...(f.assistance === 'assisted' && !helpLive ? { assistance_basis_unavailable: true } : {}),
    // A live source whose lesson the Service did not record: the finding is not claimed for this version.
    ...(live.some((s) => s.lesson === 'unknown') ? { lesson_unconfirmed: true } : {}),
    // A cited decision that answered feedback which has since been edited or cleared.
    ...(live.some((s) => s.answers_current_feedback === false) ? { stale_learner_response: true } : {}),
  };
}

/**
 * The denominator a retrospective must not hide (design: "참여 중단·무신호·도움 요청을 분모에서 빼지 않는다"). `roster` is the
 * cohort's current roster (null = unreadable). The Service keeps no per-turn record of help used or of a learner stopping in
 * a class turn, so those two are reported unobserved rather than counted as zero.
 */
export function coverageOf(roster: readonly string[] | null, findings: ReturnType<typeof findingView>[]) {
  const learners = new Set<string>(), help = new Set<string>();
  for (const f of findings) for (const s of f.sources) if (s.available) { if (s.student_id) learners.add(s.student_id); if (s.kind === 'help') help.add(s.share_id); }
  return {
    roster: roster ? roster.length : null,
    learners_with_sources: learners.size,
    learners_without_sources: roster ? roster.filter((u) => !learners.has(u)).length : null,
    help_requests_cited: help.size,
    help_use: 'unobserved' as const,
    stopped: 'unobserved' as const,
  };
}

/** The help condition of each step of the version a retrospective is about: what it offered and started with. */
export const helpConditions = (content: { steps?: ReadonlyArray<{ id: string; title?: string; help?: { default: string; allowed: readonly string[] } }> }) =>
  (content.steps ?? []).map((s) => ({ step_id: s.id, title: s.title ?? '', help: s.help ? { default: s.help.default, allowed: [...s.help.allowed] } : null }));
