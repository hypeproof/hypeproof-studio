// #1013 feedback-loop — the instructor's lesson retrospective and the next draft it starts (AE-42, CH-05).
// Contract: docs/testing/chalk-authoring.md#feedback-loop-20261005. Pure rules: lib/feedback-loop.ts.
//
// A retrospective is written about ONE frozen version, the lesson that ran. The instructor writes the hypothesis, findings
// that cite parts of shares learners chose to send to them, keep/revise/hold decisions per step, and notes on what they
// could not observe. The Service fills in everything that is not the instructor's to type: the version's digest and help
// condition, which cited shares are still readable and were sent under that version (or are not known to have been),
// whose words each cited part is, which findings rest on the learner's own words, the roster denominator, and the chain
// next draft → next candidate → its rehearsal.
//
// "Start the next draft" writes that version's content (Service bindings stripped, exactly what the authoring reuse
// offers) as a new draft revision and marks the retrospective applied, in ONE batch. The frozen version, its rehearsals and
// its confirmation are never written here: the lesson that ran stays as it was; only the new draft changes.
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../env';
import { authorizeIssuerForCohort, type IssuerAuthz } from '../lib/instructor-auth';
import { owns as ownsDraft, readDraft, writeDraft, type Draft } from '../lib/authoring-draft-write';
import { readLesson } from '../lib/lesson-delivery';
import { readinessOf } from '../lib/lesson-rehearsal-store';
import { isModuleVersion, sha256Hex } from '../lib/modules';
import { validateSessionDesign } from '../lib/session-design';
import { validateModelSubset } from '../lib/lesson-model-policy';
import { validateFeatureSubset } from '../lib/lesson-feature-policy';
import { getRoster } from '../lib/kv';
import { scrubSecrets } from '../lib/scrub-secrets';
import { getProfile } from '../profiles';
import { reusable, templateAdmission } from './authoring';
import {
  RETROSPECTIVE_FORMAT, RETRO_BODY_MAX, answerRefusal, assistanceRefusal, citeRefusal, citedShareIds, coverageOf, feedbackLoopEnabled,
  findingView, helpConditions, lessonAttribution, lessonRefusal, reportedHelpSeen, responseFor, shareParts, storedFeedback, validateRetrospectiveDoc,
  type CitedShare, type RetroBase, type RetroDoc, type RetroSource, type ResponseRow, type ShareLessonRow, type ShareRow,
} from '../lib/feedback-loop';

type Bindings = { Bindings: Env; Variables: { author: IssuerAuthz } };
interface RetroRow {
  retro_id: string; cohort_id: string; course_id: string; base_version: string; base_sha256: string; owner_id: string;
  revision: number; doc_json: string; request_id: string; created_at: number; updated_at: number;
  applied_draft_revision: number | null; applied_request_id: string | null; applied_at: number | null;
}
const root = '/cohorts/:cohort/authoring/:course/retrospectives';
const validId = (s: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(s);
const RETRO_ID = /^rt-[a-f0-9-]{36}$/;
// At most this many retrospectives about ONE version of a course. Counted per version (the unit a retrospective is about), not
// per course: nothing is deleted and a correction is a new retrospective, so a course-wide count would close a course for good
// once its history reached it, although the loop freezes each next draft as a new version.
const MAX_PER_VERSION = 50;
/** The list shows the newest this many retrospectives of a course and says whether older ones exist (`has_more`). */
const LIST_LIMIT = 50;
const nowS = () => Math.floor(Date.now() / 1000);
const PROFILE_CHANGED = { error: 'the course now runs on another profile than this version', reason: 'profile_changed' };

export const lessonRetrospectives = new Hono<Bindings>();

const authenticate: MiddlewareHandler<Bindings> = async (c, next) => {
  c.header('cache-control', 'no-store');
  // Off by default: nothing answers, and no table is read, until the Service opts in (migration 0039 first).
  if (!feedbackLoopEnabled(c.env)) return c.json({ error: 'not found', reason: 'feedback_loop_unavailable' }, 404);
  const auth = await authorizeIssuerForCohort(c, c.req.param('cohort') ?? '');
  if (auth instanceof Response) return auth;
  if (!auth) return c.json({ error: 'instructor Bearer required' }, 401);
  if (!validId(c.req.param('course') ?? '')) return c.json({ error: 'invalid course id' }, 400);
  c.set('author', auth);
  return next();
};
// Hono's trailing `/*` also matches the bare `root`, so one registration covers every route here exactly once.
lessonRetrospectives.use(root + '/*', authenticate);
// Sized from the field limits (RETRO_BODY_MAX), so every doc those limits allow fits; the refusal is named for the page.
lessonRetrospectives.use(root + '/*', bodyLimit({ maxSize: RETRO_BODY_MAX, onError: (c) => c.json({ error: 'request too large', reason: 'too_large' }, 413) }));

const owns = (d: Draft, a: IssuerAuthz) => ownsDraft(d, a.payload.u, a.scope.profiles);
const json = async (c: any) => { try { return await c.req.json(); } catch { return null; } };

/** When a frozen version was frozen (unix seconds), from its own stored document; null when that cannot be read. */
const frozenAtOf = (moduleJson: string | null | undefined): number | null => {
  try { const t = Date.parse(JSON.parse(moduleJson ?? 'null')?.published_at); return Number.isFinite(t) ? Math.floor(t / 1000) : null; } catch { return null; }
};

/** The frozen version a retrospective is about, readable under the course's profile right now. */
async function baseOf(env: Env, cohort: string, course: string, version: string, a: IssuerAuthz) {
  const row = await env.HPS_DB.prepare('SELECT source_revision,module_json FROM authoring_versions WHERE cohort_id=? AND course_id=? AND version=?').bind(cohort, course, version).first<{ source_revision: number; module_json: string }>();
  if (!row) return { refusal: { status: 404 as const, body: { error: 'version not found', reason: 'version_not_found' } } };
  const m = JSON.parse(row.module_json);
  if (!a.scope.profiles.includes(m.profile_id)) return { refusal: { status: 403 as const, body: { error: 'profile not permitted' } } };
  const lesson = await readLesson(env, cohort, course, version, m.profile_id);
  if (!lesson) return { refusal: { status: 409 as const, body: { error: 'this version cannot be opened under the current profile', reason: 'lesson_unavailable' } } };
  const identity: RetroBase = { course_id: course, version, frozen_at: frozenAtOf(row.module_json) };
  return { version, profileId: m.profile_id as string, sourceRevision: row.source_revision, sha256: lesson.sha256, content: lesson.content, identity };
}

/**
 * The shares, among `ids`, that THIS instructor may read now: the same rule as the instructor share routes (same cohort,
 * addressed to them, unexpired, a profile in their scope) narrowed to the course's own profile. Withdrawn shares no longer
 * exist. Each with the learner's answer as /sharing and /manage show it (`responseFor`: the one bound to the feedback text as
 * it is stored now, else the newest), whether it answers that text, the lesson recorded when it was sent — which version
 * it is evidence about is decided against that (lessonRefusal), not assumed — and whether this instructor has opened it
 * through the audited share view.
 */
async function citable(env: Env, cohort: string, recipient: string, profileId: string, ids: string[]): Promise<Map<string, CitedShare>> {
  const out = new Map<string, CitedShare>();
  if (!ids.length || !profileId) return out;
  const list = JSON.stringify(ids);
  const shares = (await env.HPS_DB.prepare('SELECT * FROM classroom_shares WHERE id IN (SELECT value FROM json_each(?)) AND cohort_id=? AND recipient_id=? AND profile_id=? AND expires_at>?')
    .bind(list, cohort, recipient, profileId, nowS()).all<ShareRow>()).results ?? [];
  if (!shares.length) return out;
  const responses = (await env.HPS_DB.prepare('SELECT * FROM classroom_share_responses WHERE share_id IN (SELECT value FROM json_each(?))')
    .bind(list).all<ResponseRow>()).results ?? [];
  const lessons = (await env.HPS_DB.prepare('SELECT * FROM classroom_share_lessons WHERE share_id IN (SELECT value FROM json_each(?))').bind(list).all<ShareLessonRow>()).results ?? [];
  // Which of them this instructor has opened through the audited share view (its `view` rows go with the share). Nothing drawn
  // from a share's content is shown or relied on before that (reportedHelpSeen).
  const viewed = (await env.HPS_DB.prepare("SELECT DISTINCT share_id FROM classroom_share_audit WHERE share_id IN (SELECT value FROM json_each(?)) AND actor_id=? AND action='view'")
    .bind(list, recipient).all<{ share_id: string }>()).results ?? [];
  const opened = new Set(viewed.map((v) => v.share_id));
  for (const s of shares) {
    const text = storedFeedback(s), sha = text === null ? null : await sha256Hex(text);
    const response = responseFor(responses.filter((r) => r.share_id === s.id), sha);
    const current = !!response && sha !== null && response.feedback_sha256 === sha;
    out.set(s.id, { share: s, response, response_current: current, lesson: lessons.find((l) => l.share_id === s.id) ?? null, opened: opened.has(s.id) });
  }
  return out;
}
/** Why a cited part cannot stand behind a finding about `base` now ('' = it can): gone, another lesson, or empty. */
const standRefusal = (src: RetroSource, x: CitedShare | undefined, base: RetroBase) =>
  !x ? 'source_unavailable' : lessonRefusal(x.share, x.lesson, base) || citeRefusal(src, x.share, x.response);

/** The instructor's doc, validated against the base version and the shares it cites. Secrets are masked before storage. */
async function checkedDoc(env: Env, a: IssuerAuthz, cohort: string, profileId: string, raw: unknown, steps: string[], base: RetroBase) {
  const v = validateRetrospectiveDoc(raw, steps);
  if (!v.ok) return { refusal: { status: 400 as const, body: { error: 'invalid retrospective', reason: v.code } } };
  const doc: RetroDoc = {
    hypothesis: scrubSecrets(v.doc.hypothesis),
    findings: v.doc.findings.map((f) => ({ ...f, text: scrubSecrets(f.text) })),
    decisions: v.doc.decisions.map((d) => ({ ...d, reason: scrubSecrets(d.reason) })),
    notes: Object.fromEntries(Object.entries(v.doc.notes).map(([k, t]) => [k, scrubSecrets(t as string)])),
  };
  const shares = await citable(env, cohort, a.payload.u, profileId, citedShareIds(doc));
  for (const f of doc.findings) {
    for (const s of f.sources) {
      const x = shares.get(s.share_id), why = standRefusal(s, x, base) || answerRefusal(s, x!);
      if (why) return { refusal: { status: 409 as const, body: { error: 'a cited share part cannot be used', reason: why, share_id: s.share_id, part: s.part, finding: f.id } } };
    }
    const why = assistanceRefusal(f, (id) => { const x = shares.get(id); return x ? { kind: x.share.kind, reported_help: reportedHelpSeen(x.share, x.opened) } : undefined; });
    if (why === 'record_not_opened') return { refusal: { status: 409 as const, body: { error: 'open the cited task record through the share view before citing the help it names', reason: why, finding: f.id } } };
    if (why) return { refusal: { status: 400 as const, body: { error: 'assisted needs a cited help request or a cited task record that names help', reason: why, finding: f.id } } };
  }
  return { doc };
}

/** What a retrospective says NOW: the instructor's words plus everything the Service derives, recomputed on every read. */
async function view(env: Env, a: IssuerAuthz, row: RetroRow, draft: Draft) {
  const doc = JSON.parse(row.doc_json) as RetroDoc;
  const version = await env.HPS_DB.prepare('SELECT module_json FROM authoring_versions WHERE cohort_id=? AND course_id=? AND version=?').bind(row.cohort_id, row.course_id, row.base_version).first<{ module_json: string }>();
  const base: RetroBase = { course_id: row.course_id, version: row.base_version, frozen_at: frozenAtOf(version?.module_json) };
  const shares = await citable(env, row.cohort_id, a.payload.u, draft.profile_id, citedShareIds(doc));
  const resolve = (id: string) => {
    const x = shares.get(id);
    // A share that is not evidence about this version reads like one that is gone: nothing of it is shown.
    return x && !lessonRefusal(x.share, x.lesson, base)
      ? { available: true, kind: x.share.kind, student_id: x.share.student_id, parts: new Set(shareParts(x.share, !!x.response).map((p) => p.part)), lesson: lessonAttribution(x.lesson), response_current: x.response_current, reported_help: reportedHelpSeen(x.share, x.opened) }
      : { available: false };
  };
  const findings = doc.findings.map((f) => findingView(f, resolve));
  const lesson = await readLesson(env, row.cohort_id, row.course_id, row.base_version, draft.profile_id);
  const readable = !!lesson && lesson.sha256 === row.base_sha256;
  const steps = readable ? helpConditions(lesson!.content as any) : [];
  const roster = await getRoster(env.HPS_KV, row.cohort_id);
  return {
    format: RETROSPECTIVE_FORMAT, id: row.retro_id, revision: row.revision, created_at: row.created_at, updated_at: row.updated_at,
    base: { version: row.base_version, lesson_sha256: row.base_sha256, readable, title: readable ? (lesson!.content as any).title ?? '' : '', steps },
    hypothesis: doc.hypothesis, findings,
    decisions: doc.decisions.map((d) => ({ ...d, target_title: d.target === 'lesson' ? '' : steps.find((s) => s.step_id === d.target)?.title ?? '' })),
    notes: doc.notes,
    coverage: coverageOf(roster?.users ?? null, findings),
    applied: row.applied_draft_revision === null ? null : { draft_revision: row.applied_draft_revision, at: row.applied_at },
    next: row.applied_draft_revision === null ? null : await nextChain(env, row),
  };
}

/** The first candidate frozen from the next draft (or a later revision of it) and that candidate's rehearsal state. */
async function nextChain(env: Env, row: RetroRow) {
  const v = await env.HPS_DB.prepare('SELECT version,source_revision,module_json FROM authoring_versions WHERE cohort_id=? AND course_id=? AND source_revision>=? ORDER BY source_revision ASC, version ASC LIMIT 1')
    .bind(row.cohort_id, row.course_id, row.applied_draft_revision).first<{ version: string; source_revision: number; module_json: string }>();
  if (!v) return { draft_revision: row.applied_draft_revision, version: null };
  const m = JSON.parse(v.module_json), lesson = await readLesson(env, row.cohort_id, row.course_id, v.version, m.profile_id);
  const ready = lesson ? await readinessOf(env, { cohort: row.cohort_id, course: row.course_id, version: v.version, profileId: m.profile_id, lessonSha: lesson.sha256, content: lesson.content }) : null;
  return {
    draft_revision: row.applied_draft_revision, version: v.version, source_revision: v.source_revision, lesson_sha256: lesson?.sha256 ?? null,
    rehearsal: ready ? { state: ready.state, id: ready.rehearsal?.id ?? null, verdict: ready.rehearsal?.verdict ?? null, judged_at: ready.rehearsal?.judged_at ?? null } : { state: 'not_run', id: null, verdict: null, judged_at: null },
    confirmed: !!ready?.confirmed,
  };
}

async function retroRow(env: Env, c: any, a: IssuerAuthz) {
  const id = c.req.param('id');
  if (!RETRO_ID.test(id)) return null;
  return env.HPS_DB.prepare('SELECT * FROM lesson_retrospectives WHERE retro_id=? AND cohort_id=? AND course_id=? AND owner_id=?').bind(id, c.req.param('cohort'), c.req.param('course'), a.payload.u).first<RetroRow>();
}

// The shares this instructor may cite for this course: metadata, the lesson recorded when each was sent (null = none
// recorded), and which parts hold something (with whose words they are), never their content. A share recorded under
// another course is not offered at all. The content is read through the existing instructor share route, which audits the view.
lessonRetrospectives.get(root + '/sources', async (c) => {
  const a = c.get('author'), cohort = c.req.param('cohort')!, course = c.req.param('course')!;
  const d = await readDraft(c.env.HPS_DB, cohort, course);
  if (!d || !owns(d, a)) return c.json({ error: 'course not found' }, 404);
  const rows = d.profile_id ? (await c.env.HPS_DB.prepare(`SELECT s.* FROM classroom_shares s WHERE s.cohort_id=? AND s.recipient_id=? AND s.profile_id=? AND s.expires_at>?
 AND NOT EXISTS (SELECT 1 FROM classroom_share_lessons l WHERE l.share_id=s.id AND l.course_id<>?) ORDER BY s.created_at DESC, s.id DESC LIMIT 101`)
    .bind(cohort, a.payload.u, d.profile_id, nowS(), course).all<ShareRow>()).results ?? [] : [];
  const shown = rows.slice(0, 100), ids = JSON.stringify(shown.map((s) => s.id));
  const responses = shown.length ? (await c.env.HPS_DB.prepare('SELECT share_id FROM classroom_share_responses WHERE share_id IN (SELECT value FROM json_each(?))').bind(ids).all<{ share_id: string }>()).results ?? [] : [];
  const lessons = shown.length ? (await c.env.HPS_DB.prepare('SELECT share_id,course_id,version FROM classroom_share_lessons WHERE share_id IN (SELECT value FROM json_each(?))').bind(ids).all<Pick<ShareLessonRow, 'share_id' | 'course_id' | 'version'>>()).results ?? [] : [];
  const answered = new Set(responses.map((r) => r.share_id));
  return c.json({
    recipient_id: a.payload.u, profile_id: d.profile_id || null, has_more: rows.length > 100,
    sources: shown.map((s) => {
      const l = lessons.find((x) => x.share_id === s.id);
      return { id: s.id, student_id: s.student_id, session_id: s.session_id, kind: s.kind, status: s.status, created_at: s.created_at, expires_at: s.expires_at,
        lesson: l ? { course_id: l.course_id, version: l.version } : null, parts: shareParts(s, answered.has(s.id)) };
    }),
  });
});

lessonRetrospectives.get(root, async (c) => {
  const a = c.get('author'), cohort = c.req.param('cohort')!, course = c.req.param('course')!;
  const d = await readDraft(c.env.HPS_DB, cohort, course);
  if (!d || !owns(d, a)) return c.json({ error: 'course not found' }, 404);
  const rows = (await c.env.HPS_DB.prepare('SELECT * FROM lesson_retrospectives WHERE cohort_id=? AND course_id=? AND owner_id=? ORDER BY created_at DESC, retro_id DESC LIMIT ?').bind(cohort, course, a.payload.u, LIST_LIMIT + 1).all<RetroRow>()).results ?? [];
  return c.json({ retrospectives: rows.slice(0, LIST_LIMIT).map((r) => ({ id: r.retro_id, base_version: r.base_version, revision: r.revision, hypothesis: (JSON.parse(r.doc_json) as RetroDoc).hypothesis.slice(0, 120), applied_draft_revision: r.applied_draft_revision, created_at: r.created_at, updated_at: r.updated_at })), has_more: rows.length > LIST_LIMIT });
});

lessonRetrospectives.post(root, async (c) => {
  const a = c.get('author'), cohort = c.req.param('cohort')!, course = c.req.param('course')!, b = await json(c);
  if (!b || typeof b.request_id !== 'string' || !validId(b.request_id) || typeof b.base_version !== 'string' || !isModuleVersion(b.base_version) || !('doc' in b))
    return c.json({ error: 'request_id, base_version and doc required' }, 400);
  const d = await readDraft(c.env.HPS_DB, cohort, course);
  if (!d || !owns(d, a)) return c.json({ error: 'course not found' }, 404);
  const base = await baseOf(c.env, cohort, course, b.base_version, a);
  if ('refusal' in base) return c.json(base.refusal!.body, base.refusal!.status);
  if (d.profile_id !== base.profileId) return c.json(PROFILE_CHANGED, 409);
  const checked = await checkedDoc(c.env, a, cohort, d.profile_id, b.doc, base.content.steps.map((s) => s.id), base.identity);
  if ('refusal' in checked) return c.json(checked.refusal!.body, checked.refusal!.status);
  const docJson = JSON.stringify(checked.doc);
  const same = (r: RetroRow) => r.owner_id === a.payload.u && r.base_version === b.base_version && r.doc_json === docJson;
  const prior = await c.env.HPS_DB.prepare('SELECT * FROM lesson_retrospectives WHERE cohort_id=? AND course_id=? AND request_id=?').bind(cohort, course, b.request_id).first<RetroRow>();
  if (prior) return same(prior) ? c.json(await view(c.env, a, prior, d)) : c.json({ error: 'request id reused with different content', reason: 'request_id_conflict' }, 409);
  const count = await c.env.HPS_DB.prepare('SELECT count(*) AS n FROM lesson_retrospectives WHERE cohort_id=? AND course_id=? AND base_version=?').bind(cohort, course, b.base_version).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_PER_VERSION) return c.json({ error: 'retrospective limit reached for this version', reason: 'limit_reached' }, 429);
  const id = 'rt-' + crypto.randomUUID(), at = Date.now();
  await c.env.HPS_DB.prepare(`INSERT INTO lesson_retrospectives(retro_id,cohort_id,course_id,base_version,base_sha256,owner_id,revision,doc_json,request_id,created_at,updated_at)
 SELECT ?,?,?,?,?,?,1,?,?,?,? WHERE EXISTS (SELECT 1 FROM authoring_drafts WHERE cohort_id=? AND course_id=? AND owner_id=?) ON CONFLICT DO NOTHING`)
    .bind(id, cohort, course, b.base_version, base.sha256, a.payload.u, docJson, b.request_id, at, at, cohort, course, a.payload.u).run();
  const saved = await c.env.HPS_DB.prepare('SELECT * FROM lesson_retrospectives WHERE cohort_id=? AND course_id=? AND request_id=?').bind(cohort, course, b.request_id).first<RetroRow>();
  if (!saved) return c.json({ error: 'retrospective could not be recorded; nothing was written' }, 409);
  if (saved.retro_id !== id) return same(saved) ? c.json(await view(c.env, a, saved, d)) : c.json({ error: 'request id reused with different content', reason: 'request_id_conflict' }, 409);
  return c.json(await view(c.env, a, saved, d), 201);
});

lessonRetrospectives.get(root + '/:id', async (c) => {
  const a = c.get('author'), cohort = c.req.param('cohort')!, course = c.req.param('course')!;
  const d = await readDraft(c.env.HPS_DB, cohort, course);
  if (!d || !owns(d, a)) return c.json({ error: 'course not found' }, 404);
  const row = await retroRow(c.env, c, a);
  if (!row) return c.json({ error: 'retrospective not found' }, 404);
  return c.json(await view(c.env, a, row, d));
});

// Editable while it has not started a draft. Once applied it is the record of why that draft began: a correction is a new
// retrospective, never an edit of this one.
lessonRetrospectives.put(root + '/:id', async (c) => {
  const a = c.get('author'), cohort = c.req.param('cohort')!, course = c.req.param('course')!, b = await json(c);
  if (!b || !Number.isSafeInteger(b.expected_revision) || !('doc' in b)) return c.json({ error: 'expected_revision and doc required' }, 400);
  const d = await readDraft(c.env.HPS_DB, cohort, course);
  if (!d || !owns(d, a)) return c.json({ error: 'course not found' }, 404);
  const row = await retroRow(c.env, c, a);
  if (!row) return c.json({ error: 'retrospective not found' }, 404);
  if (row.applied_draft_revision !== null) return c.json({ error: 'this retrospective already started a draft; write a new one', reason: 'retrospective_applied' }, 409);
  const base = await baseOf(c.env, cohort, course, row.base_version, a);
  if ('refusal' in base) return c.json(base.refusal!.body, base.refusal!.status);
  if (base.sha256 !== row.base_sha256) return c.json({ error: 'the version this retrospective is about no longer reads the same', reason: 'lesson_unavailable' }, 409);
  if (d.profile_id !== base.profileId) return c.json(PROFILE_CHANGED, 409);
  const checked = await checkedDoc(c.env, a, cohort, d.profile_id, b.doc, base.content.steps.map((s) => s.id), base.identity);
  if ('refusal' in checked) return c.json(checked.refusal!.body, checked.refusal!.status);
  const saved = await c.env.HPS_DB.prepare('UPDATE lesson_retrospectives SET doc_json=?,revision=revision+1,updated_at=? WHERE retro_id=? AND owner_id=? AND revision=? AND applied_draft_revision IS NULL RETURNING *')
    .bind(JSON.stringify(checked.doc), Date.now(), row.retro_id, a.payload.u, b.expected_revision).first<RetroRow>();
  if (!saved) return c.json({ error: 'the retrospective changed; reload before saving (your edits are kept on the page)', reason: 'revision_conflict' }, 409);
  return c.json(await view(c.env, a, saved, d));
});

lessonRetrospectives.post(root + '/:id/next-draft', async (c) => {
  const a = c.get('author'), cohort = c.req.param('cohort')!, course = c.req.param('course')!, b = await json(c);
  if (!b || typeof b.request_id !== 'string' || !validId(b.request_id) || !Number.isSafeInteger(b.expected_draft_revision) || b.expected_draft_revision < 1)
    return c.json({ error: 'request_id and expected_draft_revision required' }, 400);
  const d = await readDraft(c.env.HPS_DB, cohort, course);
  if (!d || !owns(d, a)) return c.json({ error: 'course not found' }, 404);
  const row = await retroRow(c.env, c, a);
  if (!row) return c.json({ error: 'retrospective not found' }, 404);
  if (row.applied_draft_revision !== null)
    return row.applied_request_id === b.request_id ? c.json(await view(c.env, a, row, d)) : c.json({ error: 'this retrospective already started a draft', reason: 'already_applied', draft_revision: row.applied_draft_revision }, 409);
  const base = await baseOf(c.env, cohort, course, row.base_version, a);
  if ('refusal' in base) return c.json(base.refusal!.body, base.refusal!.status);
  if (base.sha256 !== row.base_sha256) return c.json({ error: 'the version this retrospective is about no longer reads the same', reason: 'lesson_unavailable' }, 409);
  // It must still stand on what it cites: a share withdrawn or expired since it was written stops it here (T-28), and the
  // instructor edits the retrospective first. Nothing from such a share is carried forward.
  const doc = JSON.parse(row.doc_json) as RetroDoc, shares = await citable(c.env, cohort, a.payload.u, d.profile_id, citedShareIds(doc));
  const gone = [...new Set(doc.findings.flatMap((f) => f.sources.filter((s) => standRefusal(s, shares.get(s.share_id), base.identity)).map((s) => s.share_id)))];
  if (gone.length) return c.json({ error: 'a share this retrospective cites can no longer be read; edit the retrospective first', reason: 'source_unavailable', share_ids: gone }, 409);
  if (d.profile_id !== base.profileId) return c.json(PROFILE_CHANGED, 409);
  if (templateAdmission(!!d.independent, d.profile_id)) return c.json({ error: 'independent course requires a reviewed execution template', reason: 'template_not_reviewed' }, 403);
  // The new draft is the version's own content, Service bindings stripped (the same reuse the authoring page offers), and
  // it must pass the checks an ordinary draft save applies under the profile as it is NOW.
  const content = reusable(base.content), profile = getProfile(d.profile_id);
  const invalid = validateSessionDesign(content) ?? (!profile ? 'profile not found' : null) ?? (content.model ? validateModelSubset(content.model, profile!) : null) ?? (content.features ? validateFeatureSubset(content.features, profile!) : null);
  if (invalid) return c.json({ error: 'this version cannot start a draft under the current profile', reason: 'base_not_reusable', detail: invalid }, 409);
  const applied = b.expected_draft_revision + 1, contentJson = JSON.stringify(content);
  const hash = await sha256Hex(JSON.stringify([RETROSPECTIVE_FORMAT + ':next-draft', row.retro_id, b.expected_draft_revision, d.profile_id, content]));
  // Marked applied in the SAME batch as the draft write, and only if that write is the one this request made.
  const mark = c.env.HPS_DB.prepare(`UPDATE lesson_retrospectives SET applied_draft_revision=?,applied_request_id=?,applied_at=? WHERE retro_id=? AND applied_draft_revision IS NULL
 AND EXISTS (SELECT 1 FROM authoring_drafts WHERE cohort_id=? AND course_id=? AND owner_id=? AND revision=? AND request_id=? AND request_hash=?)`)
    .bind(applied, b.request_id, Date.now(), row.retro_id, cohort, course, a.payload.u, applied, b.request_id, hash);
  const wr = await writeDraft(c.env.HPS_DB, d, {
    cohort, course, owner_id: a.payload.u, expected_revision: b.expected_draft_revision, request_id: b.request_id,
    profile_id: d.profile_id, content_json: contentJson, hash, now: new Date().toISOString(), independent: !!d.independent,
    profile_scope: a.scope.profiles ?? [], extra_batch_stmts: [mark],
  });
  if (wr.kind === 'request_id_reused') return c.json({ error: 'request id reused with different content', reason: 'request_id_conflict' }, 409);
  const after = await retroRow(c.env, c, a);
  if (after && after.applied_request_id === b.request_id) {
    const draft = await readDraft(c.env.HPS_DB, cohort, course);
    return c.json({ ...(await view(c.env, a, after, draft ?? d)), draft: draft ? { revision: draft.revision, content: JSON.parse(draft.content_json) } : null }, wr.kind === 'ok' ? 201 : 200);
  }
  // A different apply of this retrospective won the race, or the draft moved: in both cases this request applied nothing
  // the instructor did not see. (A concurrent apply can at most rewrite the same version content once more.)
  if (after?.applied_draft_revision != null) return c.json({ error: 'this retrospective already started a draft', reason: 'already_applied', draft_revision: after.applied_draft_revision }, 409);
  return c.json({ error: 'the draft changed; reload it before starting the next draft', reason: 'draft_changed' }, 409);
});
