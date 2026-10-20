// Learning wiki skill (generic). A team's record across sessions lives in the student's workspace as
// plain files. There is one step, ingest: one session's Studio conversation (the spool's events.jsonl)
// and the student's notes go to the model once; the model proposes a problem, hypotheses, evidence,
// decisions, product changes and a next action, and every proposal must cite a turn id or a note file
// of that session. This module checks the citations, numbers the entries (H-n, E-n, D-n), appends
// only and renders the pages. It knows nothing about a course: a cohort's `learning_wiki.plan`
// (served on the profile) names the folder, the audience, the session label and each session's
// question. The deck is a separate skill (deckGenerator.ts) that reads this wiki. Students know the
// wiki by a plain name ("팀 브레인", overridable by `plan.name`) and call it by that name in the chat
// (brainIntent); the App answers such a call itself instead of a coach turn.
//
// Pure and vscode-free (fs and path only), like sessionSpool.ts, so a smoke drives exactly what the
// provider runs. Nothing is sent to a server store.

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { noteHostWrite, type HostWriteActor } from "./artifactProvenance.ts";
import { verdictTargets } from "./answerVerdict.ts";
import type { ChatMessage } from "./protocol";

/** The cohort's specialization, as /v1/profile serves it under `learning_wiki.plan`. Every field is optional. */
// The plan shape lives in protocol.ts (the webview build imports protocol.ts and has no Node types).
import type { LearningWikiPlan } from "./protocol";
export type { LearningWikiPlan };

export const DEFAULT_WIKI_DIR = "wiki";
export const DEFAULT_BRAIN_NAME = "팀 브레인";
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
/** The wiki's name for students: the plan's (up to 20 characters), else "팀 브레인". */
export const brainName = (plan?: LearningWikiPlan) => {
  const n = plan?.name?.trim();
  return n && n.length <= 20 ? n : DEFAULT_BRAIN_NAME;
};

/** Final consonant index of the last Hangul syllable (0 = none, 8 = ㄹ), for particles after a name the plan may change. */
const finalConsonant = (w: string) => {
  const c = w.trim().charCodeAt(w.trim().length - 1);
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
};
/** The word with the particle that fits it: josa("팀 브레인", "은", "는") → "팀 브레인은". */
export const josa = (w: string, afterConsonant: string, afterVowel: string) => `${w}${finalConsonant(w) ? afterConsonant : afterVowel}`;
/** The word with 으로/로 (ㄹ takes 로): ro("팀 브레인") → "팀 브레인으로". */
export const ro = (w: string) => `${w}${finalConsonant(w) && finalConsonant(w) !== 8 ? "으로" : "로"}`;

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

/** Characters kept per side when one answer is filed (the whole-session ingest keeps 700 per turn). */
const ANSWER_SOURCE_MAX = 4000;

/**
 * CGP-KNOW-R-004 (REQ-STUDIO-ANSWER-TO-WIKI) — the sources for filing ONE finished answer: the
 * learner's question that prompted it and that answer (every bubble of the turn, so a turn split by
 * tool lines stays whole), as one turn whose id is the answer's message id (the turn's base id, so
 * every citation reads `s<session>·<message id>`). No notes. Null when `messageId` is not the last
 * bubble of a finished answer (verdictTargets, the same rule the answer's other actions use) or when
 * there is no question above it.
 */
export function answerSources(messages: readonly ChatMessage[], messageId: string): Sources | null {
  if (!verdictTargets(messages, false).has(messageId)) return null;
  const end = messages.findIndex((m) => m.id === messageId);
  let start = end;
  while (start > 0 && messages[start - 1].role !== "user") start--;
  const student = start > 0 ? messages[start - 1].content.trim() : "";
  const coach = messages.slice(start, end + 1).filter((m) => m.role === "assistant").map((m) => m.content.trim()).filter(Boolean).join("\n\n");
  if (!student || !coach) return null;
  return { turns: [{ id: messageId.split("#")[0], student: student.slice(0, ANSWER_SOURCE_MAX), coach: coach.slice(0, ANSWER_SOURCE_MAX) }], notes: {} };
}

/** What applying a proposal would add, one line per item with its citations, for the learner to confirm. */
export function proposalPreview(prev: WikiState, next: WikiState): string[] {
  const out: string[] = [];
  if (!prev.problem && next.problem) out.push(`문제: ${next.problem.text}${cites(next.problem.cite)}`);
  for (const h of next.H.slice(prev.H.length)) out.push(`가설 ${h.id}: ${h.text}${cites(h.cite)}`);
  for (const e of next.E.slice(prev.E.length)) out.push(`근거 ${e.id}: ${e.text}${cites(e.cite)}`);
  for (const d of next.D.slice(prev.D.length)) out.push(`결정 ${d.id}: ${d.therefore}${cites(d.cite)}`);
  for (const c of next.changes.slice(prev.changes.length)) out.push(`바뀐 것: ${c.text}${cites(c.cite)}`);
  if (next.next && JSON.stringify(next.next) !== JSON.stringify(prev.next)) out.push(`다음 행동: ${next.next.text}${cites(next.next.cite)}`);
  return out;
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
    `[${brainName(plan)} 요약 · ${s.team}]`,
    `문제: ${s.problem?.text ?? "(아직 없음)"}`,
    `시험 중인 가설: ${testing}`,
    ...(q ? [`이번 ${label} 질문 (${nextSession}${label}): ${q}`] : []),
    ...(focus.length ? [`이번 ${label}에 집중할 덱 장: ${focus.join(", ")}`] : []),
    `다음 행동: ${s.next?.text ?? "(정해지지 않음)"}`,
    `최근 기록: ${s.log.slice(-2).join(" / ") || "없음"}`,
    `위 요약을 먼저 보여 주지 말고, 첫 응답에서 "지난 ${label}에 무엇을 시험했고 결과가 어땠어요?"라고 물은 뒤 학생 답과 요약을 비교해 이어 가세요.`,
  ].join("\n");
}

// ── Calling the wiki by name in the chat ─────────────────────────────────────

export interface BrainIntent { kind: "ingest" | "deck" | "show"; session?: number }

/** Particles that may follow the name ("팀 브레인에", "팀 브레인으로" …), longer ones first. */
const PARTICLES = "에다가|에다|에서|에게|이랑|한테|으로|에|로|은|는|이|가|을|를|의|도|랑|아|야";
// Request endings per action. Each must close the message, so a sentence that only mentions the
// word ("정리하기 전에 …", "정리했어?", "저장하지 마") is not a call.
const DECK_WORD = /덱|슬라이드|발표자료/;
const DECK_END = /(?:만들|써|쓰|짜|뽑|그려|채워|다듬|고쳐)(?:어|아)?(?:줘|줘요|주세요|줄래|줄래요|주라|봐|보자|자|기)?$|(?:업데이트|수정)(?:해|해줘|해줘요|해주세요|해줄래)?$|초안$/;
const INGEST_END = /(?:정리|저장|기록|보관|추가|업데이트)(?:좀)?(?:해|해요|하자|해줘|해줘요|해주세요|해줄래|해줄래요|해주라|해봐|해둬|해둬요|해놔|해놔줘|해두자|부탁해|부탁해요|부탁)?$|(?:넣어|담아|올려)(?:줘|줘요|주세요|줄래|줄래요|주라|둬|놔)?$/;
const SHOW_END = /(?:뭐|뭐가|무엇이)(?:있어|있어요|있니|있나|있지|들었어|들어있어|들어있어요)$|(?:보여|열어|띄워)(?:줘|줘요|주세요|줄래|줄래요|봐)?$|(?:요약|확인)(?:좀)?(?:해|해줘|해줘요|해주세요|해줄래|해봐)?$|(?:어디까지|얼마나)(?:했어|됐어|왔어|쌓였어)(?:요)?$/;
const reEscape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Is this chat message an explicit call of the wiki by name? Only a short one-sentence message that
 * names it (followed by a particle, a space or the end, so "팀 브레인스토밍" does not count) and ends
 * in a request: "팀 브레인에 정리해 줘" → ingest, "팀 브레인으로 덱 만들어 줘" → deck, "팀 브레인에
 * 뭐 있어?" or the name alone → show. A session the student names ("2주차 …") rides along with an
 * ingest. Anything else, including "정리해 줘" without the name, stays a normal coach turn.
 */
export function brainIntent(text: string, name = DEFAULT_BRAIN_NAME, label = "회차"): BrainIntent | null {
  const t = text.trim();
  if (!t || t.length > 40 || t.includes("\n")) return null;
  const words = name.trim().split(/\s+/).filter(Boolean).map(reEscape);
  if (!words.length) return null;
  const m = new RegExp(`${words.join("\\s*")}(?:${PARTICLES}|(?![가-힣A-Za-z0-9]))`, "i").exec(t);
  if (!m) return null;
  const rest = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).replace(/\s+/g, "").replace(/[.!?~…,ㅋㅎㅠㅜ^\p{Extended_Pictographic}️]+$/u, "");
  if (/[.!?]/.test(rest)) return null;
  if (!rest) return { kind: "show" };
  // What comes before the request (e.g. "오늘 내용") stays short.
  const ends = (re: RegExp) => { const e = re.exec(rest); return !!e && e.index <= 14; };
  if (DECK_WORD.test(rest) && ends(DECK_END)) return { kind: "deck" };
  if (ends(INGEST_END)) {
    const sm = new RegExp(`(\\d{1,2})\\s*(?:${[label, "주차", "회차", "차시"].map(reEscape).join("|")})`).exec(t);
    return sm ? { kind: "ingest", session: Number(sm[1]) } : { kind: "ingest" };
  }
  return ends(SHOW_END) ? { kind: "show" } : null;
}

/** Is the next coach turn the conversation's first? Calls of the wiki by name, which the App answered itself, do not count. */
export function firstCoachTurn(history: ReadonlyArray<{ role: string; content: string }>, name = DEFAULT_BRAIN_NAME, label = "회차"): boolean {
  return history.every((m) => m.role !== "user" || brainIntent(m.content, name, label) !== null);
}

/** Two lines for the model on a conversation's first turn, so the coach tells the team once how to call the wiki. */
export function brainIntro(plan?: LearningWikiPlan): string {
  const name = brainName(plan);
  const saved = plan?.deck ? `저장되고, "${ro(name)} 덱 만들어 줘"라고 하면 이번 ${sessionLabel(plan)} 덱 장 초안이 만들어진다` : "저장된다";
  return `[Studio 안내: 이 팀에는 ${josa(name, "이", "가")} 있다(문제, 가설, 결정${plan?.deck ? ", 덱" : ""}을 쌓아 두는 팀 기록). 첫 답 끝에 한 번만, 한 문장으로 알려 줘라.\n수업이 끝날 때 "${name}에 정리해 줘"라고 하면 오늘 대화가 ${saved}.]`;
}

/**
 * The session a chat call files under when the student names none: the next one, no click. It is
 * ambiguous only when the latest session was already filed today, since a second conversation in the
 * same class may belong to it; the caller then asks.
 */
export function defaultIngestSession(s: WikiState, plan: LearningWikiPlan | undefined, today: string): { session: number; last: number; ambiguous: boolean } {
  const last = s.sessions.length ? Math.max(...s.sessions) : 0;
  const session = Math.min(last + 1, sessionCount(plan));
  const ambiguous = last > 0 && session !== last && s.log.some((l) => l.startsWith(`[${today}] ${last}${sessionLabel(plan)} |`));
  return { session, last, ambiguous };
}

const cut = (t: string, n = 40) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const sentence = (t: string) => (/[.!?…]$/.test(t) ? t : `${t}.`);

/**
 * What an ingest tells the student, one short sentence per line: what was added (counts), one or two
 * new items, the deck skill's line and where to look.
 */
export function ingestReport(prev: WikiState, r: IngestResult, info: { session: number; turns: number; notes: number }, plan?: LearningWikiPlan, extra: { deck?: string; opened?: string } = {}): string[] {
  const s = r.state;
  const label = sessionLabel(plan);
  const n = (k: "H" | "E" | "D" | "changes") => s[k].length - prev[k].length;
  const added = [
    !prev.problem && s.problem ? "문제 정의" : "",
    n("H") ? `가설 ${n("H")}개` : "",
    n("E") ? `근거 ${n("E")}개` : "",
    n("D") ? `결정 ${n("D")}개` : "",
    n("changes") ? `바뀐 것 ${n("changes")}개` : "",
  ].filter(Boolean).join(", ");
  const from = info.turns && info.notes ? `대화 ${info.turns}턴과 메모 ${info.notes}개` : info.turns ? `대화 ${info.turns}턴` : `메모 ${info.notes}개`;
  const lines = [`${brainName(plan)}에 정리했어요.`, added ? `${info.session}${label} ${from}에서 ${josa(added, "을", "를")} 더했어요.` : `${info.session}${label} ${josa(from, "을", "를")} 읽었지만 새로 더한 것은 없어요.`];
  const d = s.D.slice(prev.D.length).at(-1);
  const h = s.H.slice(prev.H.length).at(-1);
  const e = s.E.slice(prev.E.length).at(-1);
  const item = d ? `새 결정 ${d.id}: ${cut(d.therefore)}` : h ? `새 가설 ${h.id}: ${cut(h.text)}` : e ? `새 근거 ${e.id}: ${cut(e.text)}` : !prev.problem && s.problem ? `문제: ${cut(s.problem.text)}` : "";
  if (item) lines.push(sentence(item));
  if (s.next && s.next.text !== prev.next?.text) lines.push(sentence(`다음 행동: ${cut(s.next.text)}`));
  if (extra.deck) lines.push(extra.deck);
  if (r.dropped.length) lines.push(`대화에서 근거를 찾지 못해 뺀 것 ${r.dropped.length}개는 log.md에 적어 뒀어요.`);
  if (extra.opened) lines.push(extra.opened);
  return lines;
}

/** "팀 브레인에 뭐 있어?": a short summary from the wiki state, one line each (no model call). */
export function brainSummary(s: WikiState | null, plan: LearningWikiPlan | undefined, folder: string): string[] {
  const name = brainName(plan);
  if (!s || !s.sessions.length) return [`${josa(name, "은", "는")} 아직 비어 있어요.`, `수업이 끝날 때 "${name}에 정리해 줘"라고 말하면 오늘 대화를 정리해 둘게요.`];
  const label = sessionLabel(plan);
  const out = [`${name}에 ${Math.max(...s.sessions)}${label}까지 정리돼 있어요.`, `문제: ${s.problem ? cut(s.problem.text, 60) : "아직 없어요"}`];
  const hs = s.H.slice(-4);
  if (!hs.length) out.push("가설: 아직 없어요");
  for (const h of hs) out.push(`가설 ${h.id} (${h.status}): ${cut(h.text)}`);
  if (s.H.length > hs.length) out.push(`가설은 모두 ${s.H.length}개예요.`);
  const d = s.D.at(-1);
  out.push(`최근 결정: ${d ? `${d.id} ${cut(d.therefore)}` : "아직 없어요"}`);
  out.push(`다음 행동: ${s.next ? cut(s.next.text) : "정해지지 않았어요"}`);
  if (plan?.deck) out.push(`덱: ${Object.keys(s.deck).length}/${plan.deck.slides.length}장`);
  if (folder) out.push(`자세한 기록은 ${folder}/ 폴더에 있어요.`);
  return out;
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
    `# ${brainName(plan)} · ${s.team}`,
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
  const text = JSON.stringify(s, null, 1);
  fs.writeFileSync(path.join(dir, STATE_FILE), text, "utf8");
  noteHostWrite([{ absPath: path.join(dir, STATE_FILE), data: text }], "studio");
}

/** `writer`: "ai" when the pages carry a model's proposal, "studio" for templates (REQ-STUDIO-ARTIFACT-PROVENANCE). */
export function writeFiles(dir: string, files: Record<string, string>, writer: HostWriteActor = "studio"): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, "utf8");
    noteHostWrite([{ absPath: path.join(dir, rel), data: content }], writer);
  }
}

/**
 * The one write of a model's wiki proposal: the state file, then every page as the AI's
 * (REQ-STUDIO-ARTIFACT-PROVENANCE). Shared by the session ingest and the one-answer filing.
 */
export function writeWiki(dir: string, s: WikiState, plan?: LearningWikiPlan): void {
  saveState(dir, s);
  writeFiles(dir, renderWikiPages(s, plan), "ai");
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
    noteHostWrite([{ absPath: target, data: text }], "studio"); // the learner's note, moved by Studio
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
