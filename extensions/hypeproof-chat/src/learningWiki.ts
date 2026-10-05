// Learning wiki skill (generic). A team's record across sessions lives in the student's workspace as
// plain files. There is one step, ingest: one session's Studio conversation (the spool's events.jsonl)
// and the student's notes go to the model once; the model proposes a problem, hypotheses, evidence,
// decisions, product changes and a next action, and every proposal must cite a turn id or a note file
// of that session. This module checks the citations, numbers the entries (H-n, E-n, D-n), appends
// only and renders the pages. It knows nothing about a course: a cohort's `learning_wiki.plan`
// (served on the profile) names the folder, the audience, the session label and each session's
// question. The deck is a separate skill (deckGenerator.ts) that reads this wiki.
//
// Pure and vscode-free (fs and path only), like sessionSpool.ts, so a smoke drives exactly what the
// provider runs. Nothing is sent to a server store.

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

/** The cohort's specialization, as /v1/profile serves it under `learning_wiki.plan`. Every field is optional. */
export interface LearningWikiPlan {
  /** Folder in the workspace (default "wiki"). */
  dir?: string;
  /** Who the learners are, in the prompt's words (default "학습 팀"). */
  audience?: string;
  /** What one session is called (default "회차"; the founder course says "주차"). */
  session_label?: string;
  /** Deck template for the deck skill. */
  /** Deck template for the deck skill; `hint` tells the skill what the slide must and must not show. */
  deck?: { title?: string; slides: Array<{ no: number; title: string; question: string; hint?: string }> };
  /** Per session: the slides the deck skill drafts that session and the session's question. */
  sessions?: Array<{ session: number; focus?: number[]; question?: string }>;
}

export const DEFAULT_WIKI_DIR = "wiki";
const STATE_KO = { real: "실제", self_reported: "팀 시험·자기 보고", simulated: "모의" } as const;
const OUT_KO = { match: "맞음", mismatch: "안 맞음" } as const;
type SourceState = keyof typeof STATE_KO;
type Outcome = keyof typeof OUT_KO | "";

export interface Cited { cite: string[]; session: number }
export type HypothesisStatus = "열림" | "시험 중" | "팀 시험에서만 맞음" | "지지";
export interface Hypothesis extends Cited { id: string; text: string; date: string; status: HypothesisStatus; evidence: string[] }
export interface Evidence extends Cited { id: string; kind: string; state: SourceState; outcome: Outcome; text: string; provenance: string; hypothesis: string | null; date: string }
export interface Decision extends Cited { id: string; therefore: string; ai_choice: string; observed: string[]; date: string }
export interface WikiState {
  format: "hps-learning-wiki/1";
  team: string;
  sessions_ingested: string[];
  sessions: number[];
  problem: { text: string; cite: string[]; session: number } | null;
  H: Hypothesis[];
  E: Evidence[];
  D: Decision[];
  changes: Array<{ text: string; cite: string[]; session: number }>;
  next: { text: string; cite: string[]; session: number } | null;
  /** Drafted by the deck skill (deckGenerator.ts), by slide number. */
  deck: Record<string, import("./deckGenerator.ts").PitchSlide>;
  dropped: string[];
  log: string[];
}
export interface Turn { id: string; student?: string; coach?: string }
export interface Sources { turns: Turn[]; notes: Record<string, string> }
export interface WikiProposal {
  problem?: { text?: string; cite?: string[] } | null;
  hypotheses?: Array<{ id?: string; text?: string; cite?: string[] }>;
  evidence?: Array<{ id?: string; kind?: string; state?: string; outcome?: string; hypothesis?: string | null; text?: string; provenance?: string; cite?: string[] }>;
  decisions?: Array<{ id?: string; therefore?: string; ai_choice?: string; observed?: string[]; cite?: string[] }>;
  changes?: Array<{ text?: string; cite?: string[] }>;
  next?: { text?: string; cite?: string[] } | null;
}

export const wikiDir = (root: string, plan?: LearningWikiPlan) => path.join(root, plan?.dir && /^[A-Za-z0-9._-]+$/.test(plan.dir) ? plan.dir : DEFAULT_WIKI_DIR);
export const sessionLabel = (plan?: LearningWikiPlan) => plan?.session_label || "회차";
export const sessionQuestion = (plan: LearningWikiPlan | undefined, n: number) => plan?.sessions?.find((s) => s.session === n)?.question ?? "";
export const sessionFocus = (plan: LearningWikiPlan | undefined, n: number) => plan?.sessions?.find((s) => s.session === n)?.focus ?? [];
/** How many sessions to offer (the plan's, else 12). */
export const sessionCount = (plan?: LearningWikiPlan) => Math.max(1, ...(plan?.sessions?.map((s) => s.session) ?? [12]));

export function newState(team: string): WikiState {
  return { format: "hps-learning-wiki/1", team, sessions_ingested: [], sessions: [], problem: null, H: [], E: [], D: [], changes: [], next: null, deck: {}, dropped: [], log: [] };
}
const STATE_FILE = ".wiki-state.json";

export function loadState(dir: string): WikiState | null {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), "utf8"));
    return s && s.format === "hps-learning-wiki/1" ? (s as WikiState) : null;
  } catch {
    return null;
  }
}

/**
 * The conversation of one session, from the spool's events.jsonl: the student's prompt and the
 * coach's answer per turn id, each cut to 700 characters, renumbered t1, t2 … in order.
 */
export function turnsFromEvents(eventsJsonl: string): Turn[] {
  const byTurn = new Map<string, Turn>();
  const order: string[] = [];
  for (const line of eventsJsonl.split("\n")) {
    if (!line.trim()) continue;
    let e: { type?: string; turn_id?: string; text?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e.turn_id || (e.type !== "prompt" && e.type !== "response") || typeof e.text !== "string") continue;
    if (!byTurn.has(e.turn_id)) {
      byTurn.set(e.turn_id, { id: "" });
      order.push(e.turn_id);
    }
    const t = byTurn.get(e.turn_id)!;
    if (e.type === "prompt") t.student = e.text.slice(0, 700);
    else t.coach = e.text.slice(0, 700);
  }
  return order.map((k, i) => ({ ...byTurn.get(k)!, id: `t${i + 1}` })).filter((t) => t.student || t.coach);
}

/** A stable id for "this conversation and these notes in this session", so it is not ingested twice. */
export function sessionHash(session: number, sources: Sources): string {
  return createHash("sha256").update(JSON.stringify({ session, sources })).digest("hex").slice(0, 12);
}

export function wikiPrompt(s: WikiState, session: number, sources: Sources, plan?: LearningWikiPlan): string {
  const label = sessionLabel(plan);
  const q = sessionQuestion(plan, session);
  const wiki = {
    problem: s.problem,
    H: s.H.map(({ id, text, status }) => ({ id, text, status })),
    E: s.E.map(({ id, kind, state, outcome, hypothesis, text }) => ({ id, kind, state, outcome, hypothesis, text })),
    D: s.D.map(({ id, therefore }) => ({ id, therefore })),
    next: s.next,
  };
  return `너는 ${plan?.audience || "학습 팀"}의 ${session}${label} 기록을 정리한다.${q ? ` 이번 ${label} 질문: ${q}` : ""}
아래 SOURCES(이번 ${label} 대화와 메모)와 WIKI(지금까지 쌓인 것)만 쓴다.

규칙
- 새 항목마다 cite에 근거가 된 대화 턴(t1, t2 …)이나 메모 파일 이름을 단다. SOURCES에 없는 것은 쓸 수 없다.
- 사람, 숫자, 날짜, 사실을 만들지 않는다. 학생이 말하지 않은 것은 쓰지 않는다.
- 근거의 state: 학생이 당사자를 직접 만났다고 말했으면 "real", 팀원이 역할을 맡았거나 팀끼리 해 봤으면 "self_reported", 가상·모의 데이터면 "simulated".
- outcome은 학생이 기준에 맞았다/안 맞았다고 말했을 때만 "match"/"mismatch", 아니면 "".
- WIKI에 이미 있는 내용은 다시 넣지 않는다. 새 항목에는 임시 번호(nH1, nE1, nD1 …)를 쓰고 기존 번호(H-1, E-3, D-2)는 그대로 쓴다.
- 짧은 한국어 문장. 평가·점수 없음.

JSON 하나만 출력하고 앞뒤에 다른 말을 쓰지 않는다:
{"problem": {"text": "", "cite": []} 또는 null,
 "hypotheses": [{"id": "nH1", "text": "맞다고 볼 기준", "cite": []}],
 "evidence": [{"id": "nE1", "kind": "외부 반응|시험|재시험", "state": "real|self_reported|simulated", "outcome": "match|mismatch|", "hypothesis": "H-1|nH1|null", "text": "", "provenance": "누구·언제·어디(말한 만큼만)", "cite": []}],
 "decisions": [{"id": "nD1", "therefore": "", "ai_choice": "AI가 제안한 것과 학생의 선택·이유", "observed": ["E-1", "nE2"], "cite": []}],
 "changes": [{"text": "제품에서 바뀐 것", "cite": []}],
 "next": {"text": "", "cite": []} 또는 null}

WIKI
${JSON.stringify(wiki)}

SOURCES
${JSON.stringify(sources)}`;
}

export interface IngestResult { state: WikiState; dropped: string[]; logLine: string; already: boolean }

/**
 * Applies one model proposal. Only items whose citations name a turn or note of this session are
 * kept; temporary ids become the next numbers. Appends only: nothing earlier is rewritten except the
 * derived hypothesis status.
 */
export function applyWikiProposal(prev: WikiState, session: number, sources: Sources, proposal: WikiProposal, sid: string, today: string, plan?: LearningWikiPlan): IngestResult {
  const label = sessionLabel(plan);
  if (prev.sessions_ingested.includes(sid)) return { state: prev, dropped: [], logLine: `${session}${label} 이 대화는 이미 정리했어요`, already: true };
  const s: WikiState = JSON.parse(JSON.stringify(prev));
  const turnIds = new Set(sources.turns.map((t) => t.id));
  const noteIds = new Set(Object.keys(sources.notes));
  const tag = (c: unknown): string[] => (Array.isArray(c) ? c : []).map(String).filter((x) => turnIds.has(x) || noteIds.has(x)).map((x) => (turnIds.has(x) ? `s${session}·${x}` : `raw/${x}`));
  const dropped: string[] = [];
  const tmp = new Map<string, string>();
  const cited = (item: { cite?: unknown; text?: unknown; therefore?: unknown }, what: string): string[] => {
    const c = tag(item.cite);
    if (!c.length) dropped.push(`${what}: "${String(item.text ?? item.therefore ?? "").slice(0, 30)}…" (인용 없음)`);
    return c;
  };
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  if (proposal.problem && !s.problem && str(proposal.problem.text)) {
    const c = cited(proposal.problem, "문제");
    if (c.length) s.problem = { text: str(proposal.problem.text), cite: c, session };
  }
  for (const h of proposal.hypotheses ?? []) {
    if (!str(h?.text)) continue;
    const c = cited(h, "가설");
    if (!c.length) continue;
    const id = `H-${s.H.length + 1}`;
    if (h.id) tmp.set(h.id, id);
    s.H.push({ id, text: str(h.text), cite: c, session, date: today, status: "열림", evidence: [] });
  }
  for (const e of proposal.evidence ?? []) {
    if (!str(e?.text)) continue;
    const c = cited(e, "근거");
    if (!c.length) continue;
    const id = `E-${s.E.length + 1}`;
    if (e.id) tmp.set(e.id, id);
    const hyp = e.hypothesis ? (tmp.get(e.hypothesis) ?? e.hypothesis) : null;
    s.E.push({
      id,
      kind: str(e.kind),
      state: (e.state && e.state in STATE_KO ? e.state : "self_reported") as SourceState,
      outcome: (e.outcome && e.outcome in OUT_KO ? e.outcome : "") as Outcome,
      text: str(e.text),
      provenance: str(e.provenance),
      hypothesis: hyp && s.H.some((x) => x.id === hyp) ? hyp : null,
      cite: c,
      session,
      date: today,
    });
  }
  for (const d of proposal.decisions ?? []) {
    if (!str(d?.therefore)) continue;
    const c = cited(d, "결정");
    if (!c.length) continue;
    const id = `D-${s.D.length + 1}`;
    if (d.id) tmp.set(d.id, id);
    const observed = (Array.isArray(d.observed) ? d.observed : []).map((x) => tmp.get(String(x)) ?? String(x)).filter((x) => s.E.some((e) => e.id === x));
    s.D.push({ id, therefore: str(d.therefore), ai_choice: str(d.ai_choice), observed, cite: c, session, date: today });
  }
  for (const ch of proposal.changes ?? []) {
    if (!str(ch?.text)) continue;
    const c = cited(ch, "바뀐 것");
    if (c.length) s.changes.push({ text: str(ch.text), cite: c, session });
  }
  if (proposal.next && str(proposal.next.text)) {
    const c = cited(proposal.next, "다음 행동");
    if (c.length) s.next = { text: str(proposal.next.text), cite: c, session };
  }
  for (const h of s.H) h.evidence = s.E.filter((e) => e.hypothesis === h.id).map((e) => e.id);
  for (const h of s.H) h.status = hypothesisStatus(h, s.E);
  s.dropped = [...s.dropped.filter((x) => !x.startsWith(`s${session} 위키 `)), ...dropped.map((x) => `s${session} 위키 ${x}`)];
  s.sessions_ingested.push(sid);
  if (!s.sessions.includes(session)) s.sessions.push(session);
  s.sessions.sort((a, b) => a - b);
  const n = (k: "H" | "E" | "D") => s[k].length - prev[k].length;
  const logLine = `[${today}] ${session}${label} | 정리 | 대화 ${sources.turns.length}턴 · 메모 ${noteIds.size} → 가설 +${n("H")} · 근거 +${n("E")} · 결정 +${n("D")} · 뺀 것 ${dropped.length}`;
  s.log.push(logLine);
  return { state: s, dropped, logLine, already: false };
}

/** A hypothesis is supported only when a real observation was judged a match and the latest judgement is a match. */
export function hypothesisStatus(h: Hypothesis, all: Evidence[]): HypothesisStatus {
  const evs = all.filter((e) => e.hypothesis === h.id);
  if (!evs.length) return "열림";
  const last = evs.filter((e) => e.outcome).at(-1);
  if (last?.outcome === "match") return evs.some((e) => e.state === "real" && e.outcome === "match") ? "지지" : "팀 시험에서만 맞음";
  return "시험 중";
}

/** What the team should look at next (wiki only; the deck skill adds its own lines). */
export function lintWiki(s: WikiState): string[] {
  const out: string[] = [];
  for (const h of s.H) {
    if (h.status === "열림") out.push(`${h.id}: 아직 시험하지 않은 가설`);
    else if (h.status === "팀 시험에서만 맞음") out.push(`${h.id}: 팀 시험에서만 맞았어요. 실제 당사자로 확인이 필요해요`);
  }
  for (const e of s.E) if (e.state === "real" && e.hypothesis && !e.outcome) out.push(`${e.id}: 실제 반응인데 ${e.hypothesis} 기준에 맞았는지 판정이 없어요`);
  for (const d of s.D) if (!d.observed.length) out.push(`${d.id}: 근거(E)가 안 붙은 결정`);
  if (!s.next) out.push("다음 행동이 정해지지 않았어요");
  out.push(...s.dropped.map((x) => { const [, kind, ...rest] = x.split(" "); return `${kind === "덱" ? "덱 " : ""}${rest.join(" ")} → 뺐어요`; }));
  return out;
}

/** What the coach is given at the start of the next session (prepended to the first turn). */
export function coachContext(s: WikiState, plan?: LearningWikiPlan): string {
  const label = sessionLabel(plan);
  const nextSession = Math.min((s.sessions.length ? Math.max(...s.sessions) : 0) + 1, sessionCount(plan));
  const q = sessionQuestion(plan, nextSession);
  const focus = sessionFocus(plan, nextSession).map((n) => plan?.deck?.slides.find((x) => x.no === n)).filter(Boolean).map((x) => `${x!.no} ${x!.title}`);
  const testing = s.H.filter((h) => h.status !== "지지").map((h) => `${h.id} ${h.text}`).join(" / ") || "없음";
  return [
    `[팀 위키 요약 · ${s.team}]`,
    `문제: ${s.problem?.text ?? "(아직 없음)"}`,
    `시험 중인 가설: ${testing}`,
    ...(q ? [`이번 ${label} 질문 (${nextSession}${label}): ${q}`] : []),
    ...(focus.length ? [`이번 ${label}에 집중할 덱 장: ${focus.join(", ")}`] : []),
    `다음 행동: ${s.next?.text ?? "(정해지지 않음)"}`,
    `최근 기록: ${s.log.slice(-2).join(" / ") || "없음"}`,
    `위 요약을 먼저 보여 주지 말고, 첫 응답에서 "지난 ${label}에 무엇을 시험했고 결과가 어땠어요?"라고 물은 뒤 학생 답과 요약을 비교해 이어 가세요.`,
  ].join("\n");
}

const cites = (c: string[]) => (c.length ? ` (${c.join(", ")})` : "");

/** The wiki's own pages as relative path → content (the deck skill renders deck/ and deck.html). */
export function renderWikiPages(s: WikiState, plan?: LearningWikiPlan): Record<string, string> {
  const label = sessionLabel(plan);
  const files: Record<string, string> = {};
  const cnt = (st: SourceState) => s.E.filter((e) => e.state === st).length;
  const hs = (st: HypothesisStatus) => s.H.filter((h) => h.status === st).length;
  const last = s.sessions.length ? Math.max(...s.sessions) : 0;
  const nq = sessionQuestion(plan, last + 1);
  files["index.md"] = [
    `# ${s.team}`,
    "",
    `- 문제: ${s.problem?.text ?? "(아직 없음)"}`,
    `- 지금 시험 중인 가설: ${s.H.filter((h) => h.status !== "지지").map((h) => `${h.id} ${h.text}`).join(", ") || "없음"}`,
    ...(nq ? [`- 다음 ${label} 질문 (${last + 1}${label}): ${nq}`] : []),
    `- 다음 행동: ${s.next?.text ?? "(정해지지 않음)"}`,
    "",
    "## 페이지",
    "",
    `- sessions/ ${label}별 정리 ${s.sessions.length}개`,
    `- hypotheses.md 가설 ${s.H.length}개 (지지 ${hs("지지")} · 팀 시험에서만 맞음 ${hs("팀 시험에서만 맞음")} · 시험 중 ${hs("시험 중")} · 열림 ${hs("열림")})`,
    `- evidence.md 근거 ${s.E.length}개 (실제 ${cnt("real")} · 팀 시험·자기 보고 ${cnt("self_reported")} · 모의 ${cnt("simulated")})`,
    `- decisions.md 결정 ${s.D.length}개`,
    ...(plan?.deck ? [`- deck/ ${Object.keys(s.deck).length} / ${plan.deck.slides.length}장 · deck.html`] : []),
    "- notes/ 메모 (정리할 때 raw/로 옮김)",
    "- log.md",
    "",
  ].join("\n");
  const hyp = ["# 가설", ""];
  for (const h of s.H) hyp.push(`## ${h.id} · ${h.status}`, "", `- 맞다고 볼 기준: ${h.text}${cites(h.cite)}`, `- 근거: ${h.evidence.join(", ") || "아직 없음"}`, "");
  if (s.next) hyp.push("## 다음 시험 카드 (초안)", "", `- 확인 방법: ${s.next.text}`, "- 맞다고 볼 기준: (시험 전에 학생이 쓴다)", "");
  files["hypotheses.md"] = hyp.join("\n");
  files["evidence.md"] = ["# 근거", "", "추가만 한다.", "", ...s.E.map((e) => `- **${e.id}** [${e.session}${label}] ${e.kind} · ${STATE_KO[e.state]}${e.outcome ? ` · 결과: ${OUT_KO[e.outcome]}` : ""}${e.hypothesis ? ` · ${e.hypothesis}` : ""} · ${e.text}${e.provenance ? ` (누구·언제: ${e.provenance})` : ""}${cites(e.cite)}`)].join("\n") + "\n";
  const dec = ["# 결정", "", "추가만 한다. 판단이 바뀌면 새 결정을 쓴다.", ""];
  for (const d of s.D) dec.push(`## ${d.id} [${d.session}${label}]`, "", `- 그래서 할 것: ${d.therefore}`, `- 본 것: ${d.observed.join(", ") || "없음"}`, `- AI 판단, 내 선택: ${d.ai_choice || "(비어 있음)"}${cites(d.cite)}`, "");
  files["decisions.md"] = dec.join("\n");
  for (const n of s.sessions) {
    const q = sessionQuestion(plan, n);
    const pg = [`# ${n}${label} 정리`, "", ...(q ? [`질문: ${q}`, ""] : []), "## 바뀐 것", ""];
    const ch = s.changes.filter((c) => c.session === n).map((c) => `- ${c.text}${cites(c.cite)}`);
    pg.push(...(ch.length ? ch : ["- 기록 없음"]), "", "## 새 근거", "");
    const ev = s.E.filter((e) => e.session === n).map((e) => `- ${e.id} ${e.kind} · ${STATE_KO[e.state]} · ${e.text}`);
    pg.push(...(ev.length ? ev : ["- 없음"]), "", "## 결정 · AI 판단, 내 선택", "");
    const ds = s.D.filter((d) => d.session === n).map((d) => `- ${d.id} ${d.therefore} / ${d.ai_choice}`);
    pg.push(...(ds.length ? ds : ["- 없음"]), "");
    files[`sessions/${String(n).padStart(2, "0")}.md`] = pg.join("\n");
  }
  const dropped = s.dropped.map((x) => `- ${x}`);
  files["log.md"] = `# 기록\n\n${s.log.map((l) => `- ${l}`).join("\n")}\n${dropped.length ? `\n## 인용이 없어 뺀 것\n\n${dropped.join("\n")}\n` : ""}`;
  return files;
}

export function saveState(dir: string, s: WikiState): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(s, null, 1), "utf8");
}

export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, "utf8");
  }
}

/** Creates the wiki folder (pages, notes/, raw/) once; an existing wiki is left as it is. */
export function initWiki(dir: string, team: string, plan?: LearningWikiPlan): WikiState {
  const existing = loadState(dir);
  if (existing) return existing;
  for (const sub of ["", "notes", "raw", "sessions"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const s = newState(team);
  writeFiles(dir, renderWikiPages(s, plan));
  saveState(dir, s);
  return s;
}

/** The student's notes in `<wiki>/notes/` (markdown or text), by file name. */
export function readNotes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(dir, "notes")).filter((n) => /\.(md|txt)$/i.test(n)).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      out[n] = fs.readFileSync(path.join(dir, "notes", n), "utf8").slice(0, 4000);
    } catch {}
  }
  return out;
}

/**
 * Notes that reached the wiki move to raw/ (the source the citations point at), so the next session
 * reads only new notes. A raw/ file of the same name is kept and the new one gets a suffix.
 */
export function archiveNotes(dir: string, notes: Record<string, string>): void {
  fs.mkdirSync(path.join(dir, "raw"), { recursive: true });
  for (const [n, text] of Object.entries(notes)) {
    const ext = path.extname(n);
    let target = path.join(dir, "raw", n);
    for (let i = 2; fs.existsSync(target) && fs.readFileSync(target, "utf8") !== text; i++) target = path.join(dir, "raw", `${path.basename(n, ext)}-${i}${ext}`);
    fs.writeFileSync(target, text, "utf8");
    try { fs.unlinkSync(path.join(dir, "notes", n)); } catch {}
  }
}

/** The first JSON object in a model answer (prose around it is ignored), or null. */
export function jsonFromText<T>(text: string | undefined): T | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

/** The student's product title (the workspace's index.html <title>), used as the wiki's team label. */
export function productTitle(root: string): string | null {
  try {
    const m = /<title>([^<]{1,80})<\/title>/i.exec(fs.readFileSync(path.join(root, "index.html"), "utf8"));
    return m?.[1].trim() || null;
  } catch {
    return null;
  }
}
