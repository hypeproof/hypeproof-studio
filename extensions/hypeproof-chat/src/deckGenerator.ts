// Deck generator skill (generic). Drafts the slides it is asked for from the learning wiki only: every
// sentence must cite wiki entries (E-n evidence, D-n decisions, H-n hypotheses, P the problem). It has
// no fixed deck: the template (slides with a title and a question) and which slides to draft come from
// the caller, which for a cohort is its `learning_wiki.plan` (the founder course: eight v5 slides, one
// to two per week). Reading the wiki rather than the raw conversation keeps the deck a function of
// what the team recorded and the citations checkable.
//
// Pure and vscode-free, like learningWiki.ts.

import type { LearningWikiPlan, Slide, WikiState } from "./learningWiki.ts";
import { sessionFocus, sessionLabel } from "./learningWiki.ts";

export type DeckTemplate = NonNullable<LearningWikiPlan["deck"]>;
export interface DeckProposal { slides?: Array<{ no?: number; title?: string; bullets?: Array<{ text?: string; refs?: string[] }>; open?: string[] }> }

/** Wiki ids a deck sentence may cite: every H, E, D and, once there is a problem, P. */
export function citableIds(s: WikiState): Set<string> {
  const ids = new Set([...s.H, ...s.E, ...s.D].map((x) => x.id));
  if (s.problem) ids.add("P");
  return ids;
}

export function deckPrompt(s: WikiState, template: DeckTemplate, slides: number[], plan?: LearningWikiPlan): string {
  const want = template.slides.filter((x) => slides.includes(x.no));
  const spec = want.map((x) => `${x.no}번 "${x.title}" (질문: ${x.question})`).join(", ");
  const wiki = {
    problem: s.problem ? { id: "P", text: s.problem.text } : null,
    H: s.H.map(({ id, text, status }) => ({ id, text, status })),
    E: s.E.map(({ id, kind, state, outcome, text }) => ({ id, kind, state, outcome, text })),
    D: s.D.map(({ id, therefore, ai_choice }) => ({ id, therefore, ai_choice })),
    next: s.next?.text ?? null,
    current: Object.fromEntries(Object.entries(s.deck).filter(([no]) => slides.includes(Number(no)))),
  };
  return `너는 ${plan?.audience || "학습 팀"}의 발표 덱 초안을 쓴다${template.title ? ` (${template.title})` : ""}. 아래 WIKI만 근거로 쓴다.

이번에 쓸 장: ${spec}

규칙
- 각 장은 제목 한 문장과 문장 3~5개. 문장마다 refs에 WIKI 번호(E-n, D-n, H-n, 문제는 P)를 하나 이상 단다. WIKI에 없는 번호는 쓸 수 없다.
- 사람, 숫자, 날짜, 사실을 만들지 않는다. WIKI에 없는 내용은 문장으로 쓰지 말고 open에 "아직 확인 못 한 것"으로 적는다.
- 팀 시험(self_reported)이나 모의(simulated) 근거에 기대는 문장은 "팀 시험" 또는 "모의"라고 밝힌다.
- current에 이미 쓴 장이 있으면, 새 근거로 답이 바뀐 부분만 고친다.
- "위키", "기록" 같은 말은 문장에 쓰지 않는다. 짧은 한국어 문장.

JSON 하나만 출력하고 앞뒤에 다른 말을 쓰지 않는다:
{"slides": [{"no": ${want[0]?.no ?? 0}, "title": "", "bullets": [{"text": "", "refs": []}], "open": []}]}

WIKI
${JSON.stringify(wiki)}`;
}

export interface DeckResult { state: WikiState; dropped: string[]; written: number[] }

/** Keeps only the requested slides and only sentences whose references resolve in the wiki. */
export function applyDeckProposal(prev: WikiState, template: DeckTemplate, slides: number[], proposal: DeckProposal, session: number): DeckResult {
  const s: WikiState = JSON.parse(JSON.stringify(prev));
  const known = citableIds(s);
  const allowed = new Set(slides.filter((n) => template.slides.some((x) => x.no === n)));
  const dropped: string[] = [];
  const written: number[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  for (const sl of proposal.slides ?? []) {
    const no = Number(sl?.no);
    if (!allowed.has(no)) continue;
    const bullets: Slide["bullets"] = [];
    for (const b of sl.bullets ?? []) {
      const refs = (Array.isArray(b?.refs) ? b.refs : []).map(String).filter((r) => known.has(r));
      if (refs.length && str(b.text)) bullets.push({ text: str(b.text), refs });
      else dropped.push(`덱 ${String(no).padStart(2, "0")}: "${str(b?.text).slice(0, 30)}…" (번호 없음)`);
    }
    s.deck[String(no)] = { title: str(sl.title), bullets, open: (Array.isArray(sl.open) ? sl.open : []).map(String), session };
    written.push(no);
  }
  s.dropped = [...s.dropped.filter((x) => !x.startsWith(`s${session} 덱 `)), ...dropped.map((x) => `s${session} 덱 ${x.slice(2)}`)];
  return { state: s, dropped, written };
}

/** Deck lines for the team: sentences with no evidence or decision, and sentences resting only on team tests or simulations. */
export function lintDeck(s: WikiState): string[] {
  const out: string[] = [];
  const E = new Map(s.E.map((e) => [e.id, e]));
  for (const [no, sl] of Object.entries(s.deck).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const nn = String(no).padStart(2, "0");
    for (const b of sl.bullets) {
      const ev = b.refs.filter((r) => E.has(r) || r.startsWith("D-"));
      if (!ev.length) out.push(`덱 ${nn}: 근거(E)·결정(D) 번호 없는 문장, "${b.text.slice(0, 26)}…"`);
      else if (ev.every((r) => E.has(r) && E.get(r)!.state !== "real")) out.push(`덱 ${nn}: 실제 관찰 없이 팀 시험·모의만 근거, "${b.text.slice(0, 26)}…"`);
    }
  }
  return out;
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nn = (n: number) => String(n).padStart(2, "0");

/** The session a slide is scheduled for in the plan, if any. */
const plannedSession = (plan: LearningWikiPlan | undefined, no: number) => plan?.sessions?.find((x) => x.focus?.includes(no))?.session;

/** deck/NN.md per template slide and deck.html (the weekly pack): the template in order, this session's slides marked. */
export function renderDeck(s: WikiState, template: DeckTemplate, plan?: LearningWikiPlan): Record<string, string> {
  const label = sessionLabel(plan);
  const files: Record<string, string> = {};
  const last = s.sessions.length ? Math.max(...s.sessions) : 1;
  const now = sessionFocus(plan, last);
  for (const t of template.slides) {
    const sl = s.deck[String(t.no)];
    const when = plannedSession(plan, t.no);
    files[`deck/${nn(t.no)}.md`] = sl
      ? `# ${nn(t.no)} · ${t.title} (초안 · ${sl.session}${label})\n\n**${sl.title}**\n\n${sl.bullets.map((b) => `- ${b.text} [${b.refs.join(", ")}]\n`).join("")}\n아직 확인 못 한 것: ${sl.open.join(" · ") || "없음"}\n`
      : `# ${nn(t.no)} · ${t.title}\n\n${when ? `${when}${label}에 채움. ` : ""}질문: ${t.question}\n`;
  }
  const dots = template.slides.map((t) => `<a class="dot ${now.includes(t.no) ? "now" : s.deck[String(t.no)] ? "done" : ""}" href="#s${t.no}">${t.no}</a>`).join("");
  let body = "";
  for (const t of template.slides) {
    const sl = s.deck[String(t.no)];
    const when = plannedSession(plan, t.no);
    body += sl
      ? `<section id="s${t.no}" class="slide${now.includes(t.no) ? " now" : ""}"><p class="no">${nn(t.no)} · ${esc(t.title)} <span class="t">${now.includes(t.no) ? `이번 ${label}` : `${sl.session}${label}`}</span></p><h2>${esc(sl.title)}</h2><ul>${sl.bullets.map((b) => `<li>${esc(b.text)} ${b.refs.map((r) => `<span class="id">${esc(r)}</span>`).join(" ")}</li>`).join("")}</ul><p class="open">아직 확인 못 한 것: ${esc(sl.open.join(" · ") || "없음")}</p></section>`
      : `<section id="s${t.no}" class="slide empty"><p class="no">${nn(t.no)} · ${esc(t.title)}${when ? ` <span class="t">${when}${label}에 채움</span>` : ""}</p><p class="q">${esc(t.question)}</p></section>`;
  }
  const order = plan?.sessions?.filter((x) => x.focus?.length).map((x) => `${x.session}${label} ${x.focus!.join("·")}`).join(" · ");
  const notes = lintDeck(s).map((x) => `<li>${esc(x)}</li>`).join("");
  files["deck.html"] = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(template.title || "덱")} · ${last}${label}</title><style>${CSS}</style></head><body><div class="wrap">
<p class="ey">HYPEPROOF STUDIO · ${esc(template.title || "덱 초안")} · ${last}${label}</p><h1>${esc(s.team)}</h1>
<p class="rule">${Object.keys(s.deck).length} / ${template.slides.length}장${order ? ` · ${esc(order)}` : ""}. 새 근거로 답이 바뀔 때만 이전 장을 고친다. E·D·H·P는 팀 위키의 근거·결정·가설·문제 번호다.</p>
<div class="dots">${dots}</div>${notes ? `<ul class="notes">${notes}</ul>` : ""}${body}</div></body></html>`;
  return files;
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
