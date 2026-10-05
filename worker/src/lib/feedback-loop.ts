// #1013 feedback-loop — the learner's answer to a person's feedback (AE-43) and the instructor's lesson retrospective that
// starts the next draft (AE-42, CH-05). PURE rules: what may be written, whose words each cited part is, and what a finding
// may claim. Storage and HTTP: routes/classroom.ts (the learner's answer) and routes/lesson-retrospective.ts.
//
// What this keeps from the contracts it builds on, and how:
//   - Selective sending (classroom sharing ADM-03/07/14, hps-observation/1). A retrospective cites a share the learner chose
//     to send to THIS instructor, by id and part. It never copies the learner's content, so a withdrawal or an expiry reaches
//     it: the reference then resolves to nothing and the finding falls back to unobserved.
//   - Unobserved stays unobserved. A finding is `observed` only on a person's words: the learner's own (question, prompt,
//     verification, their answer to feedback) or a person's feedback. An AI answer, a tool line or a URL alone never makes it
//     observed, the same rule as `missing_human_evidence` in measurement-core/legacy-observation.ts. No person's feedback
//     cited means the social correction is unobserved, never "there was none".
//   - No independence is inferred. Nothing in a share records independent performance, so `independent` is refused, and
//     `assisted` needs a cited help request. A missing record is `unknown`, never "did it alone".
//   - No score. A key shaped like a score is refused by the measurement core's own check (forbidPersonalMetrics).
import { forbidPersonalMetrics } from './measurement-core/learning-events.ts';

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
const PERSON_ORIGINS: ReadonlySet<PartOrigin> = new Set(['learner', 'human']);

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

/** What a reader sees of the learner's latest answer. `answers_current_feedback` is false once the feedback text changed. */
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
      if (!isObject(s) || !keysOk(s, ['share_id', 'part']) || typeof s.share_id !== 'string' || !SHARE_ID.test(s.share_id) || typeof s.part !== 'string' || !(s.part in PART_ORIGIN)) return fail('invalid_source');
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

/** `assisted` stands on a cited help request: the learner asked a person for help. */
export const assistanceRefusal = (f: RetroFinding, kindOf: (shareId: string) => string | undefined) =>
  f.assistance === 'assisted' && !f.sources.some((s) => kindOf(s.share_id) === 'help') ? 'unsupported_assistance' : '';

export interface ResolvedShare { available: boolean; kind?: string; student_id?: string; parts?: ReadonlySet<SharePart> }

/** One finding as it reads NOW, from the shares the instructor can still read. Recomputed on every read, never stored. */
export function findingView(f: RetroFinding, resolve: (shareId: string) => ResolvedShare) {
  const sources = f.sources.map((s) => {
    const r = resolve(s.share_id), available = r.available && !!r.parts?.has(s.part);
    return { share_id: s.share_id, part: s.part, origin: PART_ORIGIN[s.part], available, ...(available ? { kind: r.kind, student_id: r.student_id } : {}) };
  });
  const live = sources.filter((s) => s.available);
  const person = live.some((s) => PERSON_ORIGINS.has(s.origin));
  const unobserved_reason = person ? null : !f.sources.length ? 'no_source' : !live.length ? 'sources_unavailable' : 'no_person_source';
  const helpLive = live.some((s) => s.kind === 'help');
  return {
    id: f.id, text: f.text, sources,
    status: person ? 'observed' as const : 'unobserved' as const,
    ...(unobserved_reason ? { unobserved_reason } : {}),
    human_feedback: live.some((s) => s.part === 'feedback') ? 'present' as const : 'unobserved' as const,
    assistance: f.assistance === 'assisted' && helpLive ? 'assisted' as const : 'unknown' as const,
    ...(f.assistance === 'assisted' && !helpLive ? { assistance_basis_unavailable: true } : {}),
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
