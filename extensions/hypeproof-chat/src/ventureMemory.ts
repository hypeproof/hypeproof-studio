// Venture Memory, local wiki (founder course only, behind the Curriculum Runtime switch).
//
// The team's six-week record lives in the student's workspace as plain files under `venture/`.
// There is one step, ingest: the week's Studio conversation (the session spool's events.jsonl)
// and the student's notes (`venture/notes/*.md`) go to the model once; the model proposes a
// problem, hypotheses, evidence, decisions, product changes, a next action and this week's deck
// slides, and every proposal must cite a turn id or a note file that exists. This module checks
// the citations, numbers the entries, appends only and renders every page. Nothing is sent to a
// server store: the server-side project memory (cr-memory, #1395) stays the place for published
// experiments, and pushing confirmed decisions there is a later step.
//
// Pure and vscode-free (fs and path only), like sessionSpool.ts, so a smoke drives exactly what the
// provider runs. The deck follows curriculum v5: week 1 → slide 1, 2 → 2-3, 3 → 4-5, 4 → 6,
// 5 → 7-8, 6 → polish.

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

export const VENTURE_DIR = "venture";
export const VENTURE_COURSE = "founder-ai-for-good";

export const DECK: Record<number, string> = { 1: "문제·기회", 2: "제공 가치", 3: "해결 원리", 4: "수익 구조와 임팩트", 5: "현장·고객 접근", 6: "기존 도움과 대안", 7: "재무·임팩트 지표", 8: "현재 성과와 다음 계획" };
export const DECK_Q: Record<number, string> = {
  1: "누구의 어떤 어려움인가, 근거는 무엇인가",
  2: "당사자에게 무엇이 나아지나",
  3: "AI가 하는 일, 사람이 확인하는 일, AI가 틀렸을 때의 안전장치",
  4: "누가 돈을 내고 무엇이 바뀌나",
  5: "큰 지출 없이 당사자와 지불자를 어떻게 만나나",
  6: "지금 있는 도움과 무엇이 다른가",
  7: "3년 예측과 임팩트 추정, 실적과 가정 구분",
  8: "지금까지 확인한 것, 다음 일정, 필요한 자원",
};
export const WEEK_SLIDES: Record<number, number[]> = { 1: [1], 2: [2, 3], 3: [4, 5], 4: [6], 5: [7, 8], 6: [] };
const SLIDE_WEEK: Record<number, number> = Object.fromEntries(Object.entries(WEEK_SLIDES).flatMap(([w, ss]) => ss.map((s) => [s, Number(w)])));
export const WEEK_Q: Record<number, string> = {
  1: "이 문제를 겪는 사람은 누구이고, 언제 무엇 때문에 힘든가?",
  2: "지금 있는 도움보다 무엇이 나아지고, AI가 틀리면 누가 곤란해지나?",
  3: "도움을 받는 사람과 돈을 내는 사람이 같은가? 바뀐 것을 어떻게 세나?",
  4: "당사자가 지금의 도움 대신 이걸 고를 이유는?",
  5: "지금까지 실제로 확인한 것은 무엇이고, 다음에 무엇이 필요한가?",
  6: "만든 제품과 바뀐 판단을 어떻게 보여 줄까?",
};
const STATE_KO = { real: "실제", self_reported: "팀 시험·자기 보고", simulated: "모의" } as const;
const OUT_KO = { match: "맞음", mismatch: "안 맞음" } as const;
type SourceState = keyof typeof STATE_KO;
type Outcome = keyof typeof OUT_KO | "";

export interface Cited { cite: string[]; week: number }
export interface Hypothesis extends Cited { id: string; text: string; date: string; status: HypothesisStatus; evidence: string[] }
export type HypothesisStatus = "열림" | "시험 중" | "팀 시험에서만 맞음" | "지지";
export interface Evidence extends Cited { id: string; kind: string; state: SourceState; outcome: Outcome; text: string; provenance: string; hypothesis: string | null; date: string }
export interface Decision extends Cited { id: string; therefore: string; ai_choice: string; observed: string[]; date: string }
export interface Slide { title: string; bullets: Array<{ text: string; refs: string[] }>; open: string[]; week: number }
export interface VentureState {
  course: typeof VENTURE_COURSE;
  team: string;
  sessions: string[];
  weeks: number[];
  problem: { text: string; cite: string[]; week: number } | null;
  H: Hypothesis[];
  E: Evidence[];
  D: Decision[];
  changes: Array<{ text: string; cite: string[]; week: number }>;
  next: { text: string; cite: string[]; week: number } | null;
  deck: Record<string, Slide>;
  dropped: string[];
  log: string[];
}

export interface Turn { id: string; student?: string; coach?: string }
export interface Sources { turns: Turn[]; notes: Record<string, string> }

/** The model's answer, as the prompt asks for it. Anything may be missing or malformed. */
export interface Proposal {
  problem?: { text?: string; cite?: string[] } | null;
  hypotheses?: Array<{ id?: string; text?: string; cite?: string[] }>;
  evidence?: Array<{ id?: string; kind?: string; state?: string; outcome?: string; hypothesis?: string | null; text?: string; provenance?: string; cite?: string[] }>;
  decisions?: Array<{ id?: string; therefore?: string; ai_choice?: string; observed?: string[]; cite?: string[] }>;
  changes?: Array<{ text?: string; cite?: string[] }>;
  next?: { text?: string; cite?: string[] } | null;
  slides?: Array<{ no?: number; title?: string; bullets?: Array<{ text?: string; refs?: string[] }>; open?: string[] }>;
}

export function newState(team: string): VentureState {
  return { course: VENTURE_COURSE, team, sessions: [], weeks: [], problem: null, H: [], E: [], D: [], changes: [], next: null, deck: {}, dropped: [], log: [] };
}

const STATE_FILE = ".venture-state.json";

export function loadState(dir: string): VentureState | null {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), "utf8"));
    return s && s.course === VENTURE_COURSE ? (s as VentureState) : null;
  } catch {
    return null;
  }
}

/** Creates `venture/` (pages, notes/, raw/) once; an existing wiki is left as it is. */
export function initWiki(dir: string, team: string): VentureState {
  const existing = loadState(dir);
  if (existing) return existing;
  for (const sub of ["", "notes", "raw", "deck", "weeks"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const s = newState(team);
  writeWiki(dir, s);
  return s;
}

/**
 * The conversation of one session, from the spool's events.jsonl: the student's prompt and the
 * coach's answer per turn id, each cut to 700 characters. Turns are renumbered t1, t2 … in order,
 * so citations are short and stable for the prompt.
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

/** A stable id for "this conversation and these notes in this week", so the same session is not ingested twice. */
export function sessionHash(week: number, sources: Sources): string {
  return createHash("sha256").update(JSON.stringify({ week, sources })).digest("hex").slice(0, 12);
}

export function ingestPrompt(s: VentureState, week: number, sources: Sources): string {
  const slides = WEEK_SLIDES[week] ?? [];
  const spec = slides.map((n) => `${n}번 "${DECK[n]}" (질문: ${DECK_Q[n]})`).join(", ") || "없음";
  const wiki = {
    problem: s.problem,
    H: s.H.map(({ id, text, status }) => ({ id, text, status })),
    E: s.E.map(({ id, kind, state, outcome, hypothesis, text }) => ({ id, kind, state, outcome, hypothesis, text })),
    D: s.D.map(({ id, therefore }) => ({ id, therefore })),
    next: s.next,
  };
  return `너는 고등학생 창업 팀의 주간 기록을 정리한다. 아래 SOURCES(이번 주 대화와 메모)와 WIKI(지금까지 쌓인 것)만 쓴다.

규칙
- 새 항목마다 cite에 근거가 된 대화 턴(t1, t2 …)이나 메모 파일 이름을 단다. SOURCES에 없는 것은 쓸 수 없다.
- 사람, 숫자, 날짜, 사실을 만들지 않는다. 학생이 말하지 않은 것은 쓰지 않는다.
- 근거의 state: 학생이 당사자를 직접 만났다고 말했으면 "real", 팀원이 역할을 맡았거나 팀끼리 해 봤으면 "self_reported", 가상·모의 데이터면 "simulated".
- outcome은 학생이 기준에 맞았다/안 맞았다고 말했을 때만 "match"/"mismatch", 아니면 "".
- WIKI에 이미 있는 내용은 다시 넣지 않는다.
- 새 항목에는 임시 번호를 쓴다: 가설 nH1, nH2 … / 근거 nE1 … / 결정 nD1 …. 기존 번호(H-1, E-3, D-2)는 그대로 쓴다.
- 덱은 이번 주 장만 쓴다: ${spec}. 각 장은 제목 한 문장과 문장 3~5개. 문장마다 refs에 E·D·H 번호(기존 또는 임시)를 단다.
  팀 시험이나 모의 근거에 기대면 문장에 "팀 시험" 또는 "모의"라고 밝힌다. 근거가 부족한 것은 open에 적는다. "위키", "기록" 같은 말은 문장에 쓰지 않는다.
- 짧은 한국어 문장. 평가·점수 없음.

JSON 하나만 출력하고 앞뒤에 다른 말을 쓰지 않는다:
{"problem": {"text": "", "cite": []} 또는 null,
 "hypotheses": [{"id": "nH1", "text": "맞다고 볼 기준", "cite": []}],
 "evidence": [{"id": "nE1", "kind": "외부 반응|시험|재시험", "state": "real|self_reported|simulated", "outcome": "match|mismatch|", "hypothesis": "H-1|nH1|null", "text": "", "provenance": "누구·언제·어디(말한 만큼만)", "cite": []}],
 "decisions": [{"id": "nD1", "therefore": "", "ai_choice": "AI가 제안한 것과 학생의 선택·이유", "observed": ["E-1", "nE2"], "cite": []}],
 "changes": [{"text": "제품에서 바뀐 것", "cite": []}],
 "next": {"text": "", "cite": []} 또는 null,
 "slides": [{"no": ${slides[0] ?? 0}, "title": "", "bullets": [{"text": "", "refs": []}], "open": []}]}

WIKI
${JSON.stringify(wiki)}

SOURCES
${JSON.stringify(sources)}`;
}

export interface IngestResult { state: VentureState; dropped: string[]; logLine: string; already: boolean }

/**
 * Applies one model proposal. Only items whose citations name a turn or note of this session are
 * kept; temporary ids (nH1, nE1, nD1) become the next numbers (H-n, E-n, D-n); a deck sentence
 * keeps only references that resolve. Appends only: nothing earlier is rewritten except the
 * derived hypothesis status and this week's slides.
 */
export function applyProposal(prev: VentureState, week: number, sources: Sources, proposal: Proposal, sid: string, today: string): IngestResult {
  if (prev.sessions.includes(sid)) return { state: prev, dropped: [], logLine: `${week}주차 이 세션은 이미 정리했어요`, already: true };
  const s: VentureState = JSON.parse(JSON.stringify(prev));
  const turnIds = new Set(sources.turns.map((t) => t.id));
  const noteIds = new Set(Object.keys(sources.notes));
  const tag = (c: unknown): string[] => (Array.isArray(c) ? c : []).map(String).filter((x) => turnIds.has(x) || noteIds.has(x)).map((x) => (turnIds.has(x) ? `w${week}·${x}` : `raw/${x}`));
  const dropped: string[] = [];
  const tmp = new Map<string, string>();
  const cited = (item: { cite?: unknown; text?: unknown; therefore?: unknown }, label: string): string[] => {
    const c = tag(item.cite);
    if (!c.length) dropped.push(`${label}: "${String(item.text ?? item.therefore ?? "").slice(0, 30)}…" (인용 없음)`);
    return c;
  };
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  if (proposal.problem && !s.problem && str(proposal.problem.text)) {
    const c = cited(proposal.problem, "문제");
    if (c.length) s.problem = { text: str(proposal.problem.text), cite: c, week };
  }
  for (const h of proposal.hypotheses ?? []) {
    if (!str(h?.text)) continue;
    const c = cited(h, "가설");
    if (!c.length) continue;
    const id = `H-${s.H.length + 1}`;
    if (h.id) tmp.set(h.id, id);
    s.H.push({ id, text: str(h.text), cite: c, week, date: today, status: "열림", evidence: [] });
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
      week,
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
    s.D.push({ id, therefore: str(d.therefore), ai_choice: str(d.ai_choice), observed, cite: c, week, date: today });
  }
  for (const ch of proposal.changes ?? []) {
    if (!str(ch?.text)) continue;
    const c = cited(ch, "바뀐 것");
    if (c.length) s.changes.push({ text: str(ch.text), cite: c, week });
  }
  if (proposal.next && str(proposal.next.text)) {
    const c = cited(proposal.next, "다음 행동");
    if (c.length) s.next = { text: str(proposal.next.text), cite: c, week };
  }
  const slides = WEEK_SLIDES[week] ?? [];
  const known = new Set([...s.H, ...s.E, ...s.D].map((x) => x.id));
  for (const sl of proposal.slides ?? []) {
    const no = Number(sl?.no);
    if (!slides.includes(no)) continue;
    const bullets: Slide["bullets"] = [];
    for (const b of sl.bullets ?? []) {
      const refs = (Array.isArray(b?.refs) ? b.refs : []).map((x) => tmp.get(String(x)) ?? String(x)).filter((r) => known.has(r));
      if (refs.length && str(b.text)) bullets.push({ text: str(b.text), refs });
      else dropped.push(`덱 ${String(no).padStart(2, "0")}: "${str(b?.text).slice(0, 30)}…" (번호 없음)`);
    }
    s.deck[String(no)] = { title: str(sl.title), bullets, open: (Array.isArray(sl.open) ? sl.open : []).map(String), week };
  }
  for (const h of s.H) h.status = hypothesisStatus(h, s.E);
  for (const h of s.H) h.evidence = s.E.filter((e) => e.hypothesis === h.id).map((e) => e.id);
  s.dropped = [...s.dropped.filter((x) => !x.startsWith(`w${week} `)), ...dropped.map((x) => `w${week} ${x}`)];
  s.sessions.push(sid);
  if (!s.weeks.includes(week)) s.weeks.push(week);
  s.weeks.sort((a, b) => a - b);
  const n = (k: "H" | "E" | "D") => s[k].length - prev[k].length;
  const logLine = `[${today}] w${week} | 정리 | 대화 ${sources.turns.length}턴 · 메모 ${noteIds.size} → 가설 +${n("H")} · 근거 +${n("E")} · 결정 +${n("D")} · 덱 ${Object.keys(s.deck).length}/8 · 뺀 것 ${dropped.length}`;
  s.log.push(logLine);
  return { state: s, dropped, logLine, already: false };
}

/** A hypothesis is supported only when a real observation was judged a match and the latest judgement is a match. */
export function hypothesisStatus(h: Hypothesis, all: Evidence[]): HypothesisStatus {
  const evs = all.filter((e) => e.hypothesis === h.id);
  if (!evs.length) return "열림";
  const judged = evs.filter((e) => e.outcome);
  const last = judged.at(-1);
  if (last?.outcome === "match") return evs.some((e) => e.state === "real" && e.outcome === "match") ? "지지" : "팀 시험에서만 맞음";
  return "시험 중";
}

/** What the student should look at next. Short Korean lines, no scores. */
export function lint(s: VentureState): string[] {
  const out: string[] = [];
  const E = new Map(s.E.map((e) => [e.id, e]));
  for (const [no, sl] of Object.entries(s.deck).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    for (const b of sl.bullets) {
      const ev = b.refs.filter((r) => E.has(r) || r.startsWith("D-"));
      const nn = String(no).padStart(2, "0");
      if (!ev.length) out.push(`덱 ${nn}: 근거(E)·결정(D) 번호 없는 문장, "${b.text.slice(0, 26)}…"`);
      else if (ev.every((r) => E.has(r) && E.get(r)!.state !== "real")) out.push(`덱 ${nn}: 실제 관찰 없이 팀 시험·모의만 근거, "${b.text.slice(0, 26)}…"`);
    }
  }
  out.push(...s.dropped.map((x) => `${x.split(" ").slice(1).join(" ")} → 뺐어요`));
  for (const h of s.H) {
    if (h.status === "열림") out.push(`${h.id}: 아직 시험하지 않은 가설`);
    else if (h.status === "팀 시험에서만 맞음") out.push(`${h.id}: 팀 시험에서만 맞았어요. 실제 당사자로 확인이 필요해요`);
  }
  for (const e of s.E) if (e.state === "real" && e.hypothesis && !e.outcome) out.push(`${e.id}: 실제 반응인데 ${e.hypothesis} 기준에 맞았는지 판정이 없어요`);
  for (const d of s.D) if (!d.observed.length) out.push(`${d.id}: 근거(E)가 안 붙은 결정`);
  if (!s.next) out.push("다음 행동이 정해지지 않았어요");
  return out;
}

/** What the coach is given at the start of the next session (prepended to the first turn). */
export function coachContext(s: VentureState): string {
  const wk = s.weeks.length ? Math.max(...s.weeks) : 0;
  const testing = s.H.filter((h) => h.status !== "지지").map((h) => `${h.id} ${h.text}`).join(" / ") || "없음";
  return [
    `[팀 위키 요약 · ${s.team}]`,
    `문제: ${s.problem?.text ?? "(아직 없음)"}`,
    `시험 중인 가설: ${testing}`,
    `이번 주 질문 (${Math.min(wk + 1, 6)}주차): ${WEEK_Q[Math.min(wk + 1, 6)]}`,
    `다음 행동: ${s.next?.text ?? "(정해지지 않음)"}`,
    `최근 기록: ${s.log.slice(-2).join(" / ") || "없음"}`,
    "위 요약을 먼저 보여 주지 말고, 첫 응답에서 \"지난주에 무엇을 시험했고 결과가 어땠어요?\"라고 물은 뒤 학생 답과 요약을 비교해 이어 가세요.",
  ].join("\n");
}

// ── pages ────────────────────────────────────────────────────────────────────

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cites = (c: string[]) => (c.length ? ` (${c.join(", ")})` : "");

/** Every page of the wiki as relative path → content. Pure, so a smoke can read it without a disk. */
export function renderWiki(s: VentureState): Record<string, string> {
  const files: Record<string, string> = {};
  const wk = s.weeks.length ? Math.max(...s.weeks) : 0;
  const cnt = (st: SourceState) => s.E.filter((e) => e.state === st).length;
  const hs = (st: HypothesisStatus) => s.H.filter((h) => h.status === st).length;
  files["venture.md"] = [
    `# ${s.team}`,
    "",
    `- 문제: ${s.problem?.text ?? "(아직 없음)"}`,
    `- 지금 시험 중인 가설: ${s.H.filter((h) => h.status !== "지지").map((h) => `${h.id} ${h.text}`).join(", ") || "없음"}`,
    `- 이번 주 질문 (${Math.min(wk + 1, 6)}주차): ${WEEK_Q[Math.min(wk + 1, 6)]}`,
    `- 다음 행동: ${s.next?.text ?? "(정해지지 않음)"}`,
    "",
    "## 페이지",
    "",
    `- weeks/ 주차별 정리 ${s.weeks.length}개`,
    `- hypotheses.md 가설 ${s.H.length}개 (지지 ${hs("지지")} · 팀 시험에서만 맞음 ${hs("팀 시험에서만 맞음")} · 시험 중 ${hs("시험 중")} · 열림 ${hs("열림")})`,
    `- evidence.md 근거 ${s.E.length}개 (실제 ${cnt("real")} · 팀 시험·자기 보고 ${cnt("self_reported")} · 모의 ${cnt("simulated")})`,
    `- decisions.md 결정 ${s.D.length}개`,
    `- deck/ ${Object.keys(s.deck).length} / 8장 · 주간 팩 deck.html`,
    "- notes/ 학생 메모 (정리할 때 raw/로 복사)",
    "- log.md",
    "",
  ].join("\n");
  const hyp = ["# 가설", ""];
  for (const h of s.H) hyp.push(`## ${h.id} · ${h.status}`, "", `- 맞다고 볼 기준: ${h.text}${cites(h.cite)}`, `- 근거: ${h.evidence.join(", ") || "아직 없음"}`, "");
  if (s.next) hyp.push("## 다음 주 시험 카드 (초안)", "", `- 확인 방법: ${s.next.text}`, "- 맞다고 볼 기준: (시험 전에 학생이 쓴다)", "");
  files["hypotheses.md"] = hyp.join("\n");
  files["evidence.md"] = ["# 근거", "", "추가만 한다.", "", ...s.E.map((e) => `- **${e.id}** [${e.week}주차] ${e.kind} · ${STATE_KO[e.state]}${e.outcome ? ` · 결과: ${OUT_KO[e.outcome]}` : ""}${e.hypothesis ? ` · ${e.hypothesis}` : ""} · ${e.text}${e.provenance ? ` (누구·언제: ${e.provenance})` : ""}${cites(e.cite)}`)].join("\n") + "\n";
  const dec = ["# 결정", "", "추가만 한다. 판단이 바뀌면 새 결정을 쓴다.", ""];
  for (const d of s.D) dec.push(`## ${d.id} [${d.week}주차]`, "", `- 그래서 할 것: ${d.therefore}`, `- 본 것: ${d.observed.join(", ") || "없음"}`, `- AI 판단, 내 선택: ${d.ai_choice || "(비어 있음)"}${cites(d.cite)}`, "");
  files["decisions.md"] = dec.join("\n");
  for (const wn of s.weeks) {
    const pg = [`# ${wn}주차 정리`, "", `질문: ${WEEK_Q[wn]}`, "", "## 바뀐 것", ""];
    const ch = s.changes.filter((c) => c.week === wn).map((c) => `- ${c.text}${cites(c.cite)}`);
    pg.push(...(ch.length ? ch : ["- 기록 없음"]), "", "## 새 근거", "");
    const ev = s.E.filter((e) => e.week === wn).map((e) => `- ${e.id} ${e.kind} · ${STATE_KO[e.state]} · ${e.text}`);
    pg.push(...(ev.length ? ev : ["- 없음"]), "", "## 결정 · AI 판단, 내 선택", "");
    const ds = s.D.filter((d) => d.week === wn).map((d) => `- ${d.id} ${d.therefore} / ${d.ai_choice}`);
    pg.push(...(ds.length ? ds : ["- 없음"]), "", "## 덱", "", `- 이번 주 장: ${(WEEK_SLIDES[wn] ?? []).map((n) => `${String(n).padStart(2, "0")} ${DECK[n]}`).join(", ") || "새 장 없음 · 8장 다듬기"}`, "");
    files[`weeks/w${wn}.md`] = pg.join("\n");
  }
  for (let no = 1; no <= 8; no++) {
    const sl = s.deck[String(no)];
    const nn = String(no).padStart(2, "0");
    files[`deck/${nn}.md`] = sl
      ? `# ${nn} · ${DECK[no]} (초안 · ${sl.week}주차)\n\n**${sl.title}**\n\n${sl.bullets.map((b) => `- ${b.text} [${b.refs.join(", ")}]\n`).join("")}\n아직 확인 못 한 것: ${sl.open.join(" · ") || "없음"}\n`
      : `# ${nn} · ${DECK[no]}\n\n${SLIDE_WEEK[no]}주차에 채움. 질문: ${DECK_Q[no]}\n`;
  }
  files["log.md"] = `# 기록\n\n${s.log.map((l) => `- ${l}`).join("\n")}\n`;
  files["deck.html"] = deckHtml(s);
  return files;
}

export function writeWiki(dir: string, s: VentureState): void {
  for (const sub of ["", "notes", "raw", "deck", "weeks"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (const [rel, content] of Object.entries(renderWiki(s))) fs.writeFileSync(path.join(dir, rel), content, "utf8");
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(s, null, 1), "utf8");
}

/** The student's notes in `venture/notes/` (markdown or text), by file name. */
export function readNotes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const notesDir = path.join(dir, "notes");
  let names: string[] = [];
  try {
    names = fs.readdirSync(notesDir).filter((n) => /\.(md|txt)$/i.test(n)).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      out[n] = fs.readFileSync(path.join(notesDir, n), "utf8").slice(0, 4000);
    } catch {}
  }
  return out;
}

/**
 * Notes that reached the wiki move to raw/ (the source the citations point at), so next week's
 * ingest reads only new notes. A raw/ file of the same name is kept and the new one gets a suffix.
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

const CSS = `:root{--bg:#f5f7f3;--paper:#fff;--ink:#18211c;--ink-2:#4b564f;--ink-3:#6b766f;--line:#d8ded7;--acc:#1f6b45;--acc-ink:#134a30;--warn:#7a4f0e;--warn-soft:#f6ecd9;--chip:#eef1ec}
@media (prefers-color-scheme:dark){:root{--bg:#111512;--paper:#191f1b;--ink:#e7ebe6;--ink-2:#b3bcb5;--ink-3:#9aa49c;--line:#2b332d;--acc:#74c496;--acc-ink:#a9dcbf;--warn:#e2b76a;--warn-soft:#2e2615;--chip:#232a26}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;line-height:1.65;word-break:keep-all;overflow-wrap:anywhere}
.wrap{max-width:960px;margin:0 auto;padding:24px 20px 60px}.ey{font-family:ui-monospace,monospace;font-size:12px;color:var(--ink-3);letter-spacing:.05em}h1{font-size:clamp(24px,4vw,30px);margin:4px 0 8px}
.id{font-family:ui-monospace,monospace;font-size:11.5px;background:var(--chip);border-radius:5px;padding:1px 6px;color:var(--ink-3)}ul{padding-left:20px;margin:4px 0}li{margin:4px 0}
.notes{list-style:none;padding:0}.notes li{background:var(--warn-soft);color:var(--warn);border-radius:8px;padding:6px 12px;margin:5px 0;font-size:13.5px}
.rule{font-size:13.5px;color:var(--ink-3);margin:0 0 10px}.dots{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 16px}.dot{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;text-decoration:none;font-family:ui-monospace,monospace;border:2px solid var(--line);color:var(--ink-3);background:var(--paper)}.dot.done{border-color:var(--acc);color:var(--acc-ink)}.dot.now{border-color:var(--warn);background:var(--warn-soft);color:var(--warn);font-weight:700}
.slide{aspect-ratio:16/9;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,3.5vw,36px);display:flex;flex-direction:column;gap:10px;margin-bottom:16px}.slide.now{border:2px solid var(--warn)}.slide.empty{aspect-ratio:auto;background:transparent;border-style:dashed;padding:14px 18px;gap:4px;margin-bottom:10px}
.no{font-family:ui-monospace,monospace;color:var(--acc);font-size:13px;margin:0}.t{font-family:inherit;font-size:12px;background:var(--chip);color:var(--ink-3);border-radius:999px;padding:1px 8px;margin-left:6px}.slide.now .t{background:var(--warn-soft);color:var(--warn)}
.slide h2{font-size:clamp(18px,2.5vw,25px);margin:0;line-height:1.35}.slide ul{font-size:clamp(13px,1.6vw,16px)}.q{margin:0;color:var(--ink-3)}.open{margin-top:auto;font-size:13px;color:var(--ink-3)}@media (max-width:700px){.slide{aspect-ratio:auto;min-height:220px}}`;

/** The weekly pack: the deck only, in v5 order, this week's slides marked. */
export function deckHtml(s: VentureState): string {
  const wk = s.weeks.length ? Math.max(...s.weeks) : 1;
  const now = WEEK_SLIDES[wk] ?? [];
  const nn = (n: number) => String(n).padStart(2, "0");
  const dots = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<a class="dot ${now.includes(n) ? "now" : s.deck[String(n)] ? "done" : ""}" href="#s${n}">${n}</a>`).join("");
  let body = "";
  for (let n = 1; n <= 8; n++) {
    const sl = s.deck[String(n)];
    if (sl) {
      body += `<section id="s${n}" class="slide${now.includes(n) ? " now" : ""}"><p class="no">${nn(n)} · ${esc(DECK[n])} <span class="t">${now.includes(n) ? "이번 주" : `${sl.week}주차`}</span></p><h2>${esc(sl.title)}</h2><ul>${sl.bullets.map((b) => `<li>${esc(b.text)} ${b.refs.map((r) => `<span class="id">${esc(r)}</span>`).join(" ")}</li>`).join("")}</ul><p class="open">아직 확인 못 한 것: ${esc(sl.open.join(" · ") || "없음")}</p></section>`;
    } else {
      body += `<section id="s${n}" class="slide empty"><p class="no">${nn(n)} · ${esc(DECK[n])} <span class="t">${SLIDE_WEEK[n]}주차에 채움</span></p><p class="q">${esc(DECK_Q[n])}</p></section>`;
    }
  }
  const notes = lint(s).filter((x) => x.startsWith("덱")).map((x) => `<li>${esc(x)}</li>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>주간 팩 ${wk}주차</title><style>${CSS}</style></head><body><div class="wrap">
<p class="ey">HYPEPROOF STUDIO · 창업교육 · 주간 팩 · ${wk}주차</p><h1>${esc(s.team)}</h1>
<p class="rule">IR 덱 ${Object.keys(s.deck).length} / 8 · 1주 ① · 2주 ②③ · 3주 ④⑤ · 4주 ⑥ · 5주 ⑦⑧ · 6주 다듬기. 새 근거로 답이 바뀔 때만 이전 장을 고친다. E·D·H는 venture/ 폴더의 근거·결정·가설 번호다.</p>
<div class="dots">${dots}</div>${notes ? `<ul class="notes">${notes}</ul>` : ""}${body}</div></body></html>`;
}

/** The first JSON object in a model answer (prose around it is ignored), or null. */
export function proposalFromText(text: string | undefined): Proposal | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" ? (v as Proposal) : null;
  } catch {
    return null;
  }
}
