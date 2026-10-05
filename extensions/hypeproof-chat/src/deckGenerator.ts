// Deck generator skill (generic). Drafts investor-style slides from the learning wiki: one claim per
// slide as the headline, one visual (a big number, a quote, the product itself, steps or a
// before/after), at most two supporting lines, and speaker notes. The audience sees the slide; the
// citations (E-n evidence, D-n decisions, H-n hypotheses, P the problem), the notes and what is not
// yet confirmed stay in the notes layer. A slide is kept only when its references resolve in the wiki
// and every number on it appears in the entries it cites (the numbers rule).
//
// It has no fixed deck: the template (slides with a title and a question) and which slides to draft
// come from the caller, which for a cohort is its `learning_wiki.plan` (the founder course: eight v5
// slides, one to two per week). Pure and vscode-free, like learningWiki.ts.

import type { LearningWikiPlan, WikiState } from "./learningWiki.ts";
import { sessionFocus, sessionLabel } from "./learningWiki.ts";

export type DeckTemplate = NonNullable<LearningWikiPlan["deck"]>;
export type VisualType = "number" | "quote" | "product" | "steps" | "compare" | "statement";
export interface Visual { type: VisualType; value?: string; label?: string; items?: string[]; left?: string; right?: string }
export interface PitchSlide { headline: string; visual: Visual; support: string[]; notes: string; refs: string[]; gaps: string[]; session: number }
export interface DeckProposal {
  slides?: Array<{ no?: number; headline?: string; visual?: Partial<Visual>; support?: string[]; notes?: string; refs?: string[]; gaps?: string[] }>;
}
const VISUALS: VisualType[] = ["number", "quote", "product", "steps", "compare", "statement"];

/** Wiki ids a slide may cite: every H, E, D and, once there is a problem, P. */
export function citableIds(s: WikiState): Set<string> {
  const ids = new Set([...s.H, ...s.E, ...s.D].map((x) => x.id));
  if (s.problem) ids.add("P");
  return ids;
}

/** The text of the wiki entries a slide cites (what its numbers may come from). */
function citedText(s: WikiState, refs: string[]): string {
  const parts: string[] = [];
  for (const r of refs) {
    if (r === "P" && s.problem) parts.push(s.problem.text);
    const e = s.E.find((x) => x.id === r);
    if (e) parts.push(e.text, e.provenance);
    const d = s.D.find((x) => x.id === r);
    if (d) parts.push(d.therefore, d.ai_choice);
    const h = s.H.find((x) => x.id === r);
    if (h) parts.push(h.text);
  }
  return parts.join(" ");
}

/** Numbers on a slide (digits, with "명", "%", "번" and the like stripped) that its cited entries do not contain. */
export function unsupportedNumbers(slideText: string, cited: string): string[] {
  const nums = slideText.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return [...new Set(nums)].filter((n) => !cited.includes(n));
}

export function deckPrompt(s: WikiState, template: DeckTemplate, slides: number[], plan?: LearningWikiPlan): string {
  const want = template.slides.filter((x) => slides.includes(x.no));
  const spec = want.map((x) => `${x.no}번 "${x.title}" (이 장이 답할 질문: ${x.question})${x.hint ? `\n   이 장의 역할: ${x.hint}` : ""}`).join("\n");
  const wiki = {
    problem: s.problem ? { id: "P", text: s.problem.text } : null,
    H: s.H.map(({ id, text, status }) => ({ id, text, status })),
    E: s.E.map(({ id, kind, state, outcome, text, provenance }) => ({ id, kind, state, outcome, text, provenance })),
    D: s.D.map(({ id, therefore, ai_choice }) => ({ id, therefore, ai_choice })),
    next: s.next?.text ?? null,
    current: Object.fromEntries(Object.entries(s.deck).filter(([no]) => slides.includes(Number(no))).map(([no, d]) => [no, { headline: d.headline, visual: d.visual }])),
  };
  return `너는 ${plan?.audience || "학습 팀"}이 실제 투자자와 심사위원 앞에서 발표할 피칭 덱을 만든다${template.title ? ` (${template.title})` : ""}.
좋은 피칭 덱(Airbnb 2008 시드 덱, Sequoia 덱 구성, YC 시드 덱 조언)처럼 장마다 주장 하나, 시각 요소 하나, 글은 최소로 쓴다.

이번에 만들 장:
${spec}

장마다 이렇게 쓴다
- headline: 그 장의 주장 한 문장, 28자 안팎. 설명("~에 대하여")이 아니라 듣는 사람이 기억할 주장. 확인한 사실을 자신 있게 쓰되 과장하지 않는다.
- visual: 하나만 고른다.
  - "number": 근거에 있는 숫자 하나를 크게 (value: "2 / 3", label: "처음 쓴 어르신이 혼자 보건소까지 감").
  - "quote": 사용자가 실제로 한 말 (value: 말 그대로, label: "70대 사용자, 첫 시험"). 근거에 있는 말만.
  - "product": 학생이 만든 제품 화면을 그대로 띄운다 (label: 무엇을 보여 주는지).
  - "steps": 3~4단계 흐름 (items: ["…", "…", "…"]).
  - "compare": 지금 쓰는 방법과 우리 방법 (left: "지금", right: "우리").
  - "statement": 위가 다 맞지 않을 때만, 한 문장 (value).
- support: 화면에 같이 둘 짧은 문장 0~2개. 각 20자 안팎.
- notes: 발표자가 이 장에서 말할 것 2~3문장.
- refs: 이 장의 주장과 숫자가 기대는 WIKI 번호(E-n, D-n, H-n, 문제는 P). 하나 이상.
- gaps: 아직 확인 못 한 것. 화면에는 나오지 않고 발표 준비용으로만 쓴다.

규칙
- 사람, 숫자, 날짜, 사실, 인용을 만들지 않는다. 화면의 숫자는 refs로 단 항목에 그대로 있어야 한다.
- visual과 support는 headline의 주장을 뒷받침해야 한다. 장의 역할에 맞지 않는 근거(예: 문제 장에 해결 성과)는 넣지 않는다.
- 근거의 종류(실제 관찰, 팀 시험, 모의)는 화면에 자동으로 붙으니 문장에 쓰지 않는다.
- 근거가 얇으면 작은 숫자라도 정직하게 쓴다("1명", "3명 중 2명"). 부족한 것은 gaps로 보낸다.
- current에 이미 만든 장이 있으면 새 근거로 바뀐 부분만 고친다.
- "위키", "기록", "근거 번호" 같은 말은 화면 문장에 쓰지 않는다.

slides에는 이번에 만들 장(${want.map((x) => x.no).join(", ")}번)을 빠짐없이 하나씩 넣는다. JSON 하나만 출력하고 앞뒤에 다른 말을 쓰지 않는다:
{"slides": [${want.map((x) => `{"no": ${x.no}, "headline": "", "visual": {"type": "number|quote|product|steps|compare|statement", "value": "", "label": "", "items": [], "left": "", "right": ""}, "support": [], "notes": "", "refs": [], "gaps": []}`).join(", ")}]}

WIKI
${JSON.stringify(wiki)}`;
}

/** The basis line on a slide, computed from the cited evidence (never written by the model). */
export function basisLabel(s: WikiState, refs: string[]): string {
  const states = refs.map((r) => s.E.find((e) => e.id === r)?.state).filter(Boolean) as string[];
  if (!states.length) return "근거: 팀 결정·문제 정의";
  const real = states.filter((x) => x === "real").length;
  const team = states.filter((x) => x === "self_reported").length;
  const sim = states.filter((x) => x === "simulated").length;
  return `근거: ${[real ? `실제 관찰 ${real}` : "", team ? `팀 시험 ${team}` : "", sim ? `모의 ${sim}` : ""].filter(Boolean).join(" · ")}`;
}

/** One repair request for slides the gate refused: the same task, only those slides, with the reasons. */
export function deckRepairPrompt(s: WikiState, template: DeckTemplate, refused: Array<{ no: number; reason: string }>, plan?: LearningWikiPlan): string {
  const base = deckPrompt(s, template, refused.map((x) => x.no), plan);
  return `${base}\n\n지난 답에서 아래 장은 규칙 위반으로 화면에 올리지 못했다. 이유를 고쳐 그 장만 다시 써라.\n${refused.map((x) => `- ${x.no}번: ${x.reason}`).join("\n")}`;
}

/** The refused slides of a result, as { no, reason } for deckRepairPrompt. */
export function refusedSlides(dropped: string[]): Array<{ no: number; reason: string }> {
  return dropped.map((x) => /^덱 (\d+): .*\((.+)\)$/.exec(x)).filter(Boolean).map((m) => ({ no: Number(m![1]), reason: m![2] }));
}

/**
 * The on-screen and notes text of the given slides as humanizer items. A quote's value is the user's
 * own words and is never rewritten.
 */
export function slideTextItems(s: WikiState, slides: number[]): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  for (const no of slides) {
    const sl = s.deck[String(no)];
    if (!sl) continue;
    const add = (key: string, text: string | undefined) => { if (text) out.push({ id: `${no}.${key}`, text }); };
    add("headline", sl.headline);
    if (sl.visual.type !== "quote") add("value", sl.visual.value);
    add("label", sl.visual.label);
    (sl.visual.items ?? []).forEach((t, i) => add(`items.${i}`, t));
    add("left", sl.visual.left);
    add("right", sl.visual.right);
    sl.support.forEach((t, i) => add(`support.${i}`, t));
    add("notes", sl.notes);
  }
  return out;
}

/** Writes humanized texts back into the slides they came from. */
export function applySlideText(prev: WikiState, items: Array<{ id: string; text: string }>): WikiState {
  const s: WikiState = JSON.parse(JSON.stringify(prev));
  for (const { id, text } of items) {
    const [no, key, idx] = id.split(".");
    const sl = s.deck[no];
    if (!sl) continue;
    if (key === "headline") sl.headline = text;
    else if (key === "notes") sl.notes = text;
    else if (key === "support" && idx !== undefined) sl.support[Number(idx)] = text;
    else if (key === "items" && idx !== undefined && sl.visual.items) sl.visual.items[Number(idx)] = text;
    else if (key === "value" && sl.visual.type !== "quote") sl.visual.value = text;
    else if (key === "label" || key === "left" || key === "right") sl.visual[key] = text;
  }
  return s;
}

export interface DeckResult { state: WikiState; dropped: string[]; written: number[] }

/**
 * Keeps only requested template slides whose references resolve in the wiki and whose numbers all
 * appear in the cited entries. A slide that fails is not written; the previous draft of it stays.
 */
export function applyDeckProposal(prev: WikiState, template: DeckTemplate, slides: number[], proposal: DeckProposal, session: number): DeckResult {
  const s: WikiState = JSON.parse(JSON.stringify(prev));
  const known = citableIds(s);
  const allowed = new Set(slides.filter((n) => template.slides.some((x) => x.no === n)));
  const dropped: string[] = [];
  const written: number[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const strs = (v: unknown, max: number) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : []);
  for (const sl of proposal.slides ?? []) {
    const no = Number(sl?.no);
    if (!allowed.has(no)) continue;
    const nn = String(no).padStart(2, "0");
    const refs = strs(sl.refs, 12).filter((r) => known.has(r));
    const headline = str(sl.headline);
    const v = sl.visual ?? {};
    const type = (VISUALS.includes(v.type as VisualType) ? v.type : "statement") as VisualType;
    const visual: Visual = { type, value: str(v.value), label: str(v.label), items: strs(v.items, 4), left: str(v.left), right: str(v.right) };
    const support = strs(sl.support, 2);
    if (!headline || !refs.length) {
      dropped.push(`덱 ${nn}: "${headline.slice(0, 30)}…" (근거 번호 없음)`);
      continue;
    }
    const onScreen = [headline, visual.value, visual.label, ...(visual.items ?? []), visual.left, visual.right, ...support].join(" ");
    const bad = unsupportedNumbers(onScreen, citedText(s, refs));
    if (bad.length) {
      dropped.push(`덱 ${nn}: "${headline.slice(0, 30)}…" (근거에 없는 숫자 ${bad.join(", ")})`);
      continue;
    }
    s.deck[String(no)] = { headline, visual, support, notes: str(sl.notes), refs, gaps: strs(sl.gaps, 8), session };
    written.push(no);
  }
  // A requested slide the answer left out counts as refused, so the repair round asks for it again.
  const answered = new Set((proposal.slides ?? []).map((x) => Number(x?.no)));
  for (const no of allowed) if (!answered.has(no)) dropped.push(`덱 ${String(no).padStart(2, "0")}: "" (빠짐)`);
  s.dropped = [...s.dropped.filter((x) => !x.startsWith(`s${session} 덱 `)), ...dropped.map((x) => `s${session} 덱 ${x.slice(2)}`)];
  return { state: s, dropped, written };
}

/** One deck-skill run as the caller reports it: slides written now, slides drafted in all, slides refused, or no usable answer. */
export interface DeckRun { written: number[]; drafted: number; total: number; refused: number; failed: boolean }

/** The student-facing line for a deck run, with the deck's progress (e.g. "지금 덱 3/8장이에요."). */
export function deckReport(d: DeckRun): string {
  const progress = `지금 덱 ${d.drafted}/${d.total}장이에요.`;
  if (d.failed) return `덱 초안은 쓰지 못했어요. ${progress}`;
  const head = d.written.length ? `덱 ${d.written.join("·")}장 초안을 썼어요.` : "덱 초안은 이번에 쓰지 못했어요.";
  return `${head} ${progress}${d.refused ? ` 근거와 맞지 않은 ${d.refused}장은 올리지 않았어요.` : ""}`;
}

/** Notes-layer lines: slides resting only on team tests or simulations, and what is still unconfirmed. */
export function lintDeck(s: WikiState): string[] {
  const out: string[] = [];
  const E = new Map(s.E.map((e) => [e.id, e]));
  for (const [no, sl] of Object.entries(s.deck).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const ev = sl.refs.filter((r) => E.has(r));
    if (ev.length && ev.every((r) => E.get(r)!.state !== "real")) out.push(`덱 ${String(no).padStart(2, "0")}: 실제 관찰 없이 팀 시험·모의 근거에만 기대요`);
  }
  return out;
}

const esc = (v: string | undefined) => (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nn = (n: number) => String(n).padStart(2, "0");
const plannedSession = (plan: LearningWikiPlan | undefined, no: number) => plan?.sessions?.find((x) => x.focus?.includes(no))?.session;

function visualHtml(v: Visual, productSrc: string): string {
  switch (v.type) {
    case "number":
      return `<div class="v-number"><div class="big">${esc(v.value)}</div><div class="lbl">${esc(v.label)}</div></div>`;
    case "quote":
      return `<figure class="v-quote"><blockquote>“${esc(v.value)}”</blockquote><figcaption>${esc(v.label)}</figcaption></figure>`;
    case "product":
      return `<div class="v-product"><iframe src="${esc(productSrc)}" title="제품 화면" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe><div class="lbl">${esc(v.label)}</div></div>`;
    case "steps":
      return `<ol class="v-steps">${(v.items ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`;
    case "compare":
      return `<div class="v-compare"><div class="col before"><span>지금</span><p>${esc(v.left)}</p></div><div class="arrow">→</div><div class="col after"><span>우리</span><p>${esc(v.right)}</p></div></div>`;
    default:
      return `<p class="v-statement">${esc(v.value)}</p>`;
  }
}

/**
 * deck/NN.md per template slide and deck.html: drafted slides as 16:9 pitch slides in template order;
 * a "발표자 노트" switch shows the notes, citations, gaps and the slides not drafted yet.
 * `productSrc` is the student's product page relative to the wiki folder (the product visual embeds it).
 */
export function renderDeck(s: WikiState, template: DeckTemplate, plan?: LearningWikiPlan, productSrc = "../index.html"): Record<string, string> {
  const label = sessionLabel(plan);
  const files: Record<string, string> = {};
  const last = s.sessions.length ? Math.max(...s.sessions) : 1;
  const now = sessionFocus(plan, last);
  for (const t of template.slides) {
    const sl = s.deck[String(t.no)];
    const when = plannedSession(plan, t.no);
    files[`deck/${nn(t.no)}.md`] = sl
      ? [`# ${nn(t.no)} · ${t.title} (초안 · ${sl.session}${label})`, "", `## ${sl.headline}`, "", `- 시각 요소: ${sl.visual.type}${sl.visual.value ? ` · ${sl.visual.value}` : ""}${sl.visual.label ? ` · ${sl.visual.label}` : ""}${sl.visual.items?.length ? ` · ${sl.visual.items.join(" → ")}` : ""}${sl.visual.left ? ` · 지금: ${sl.visual.left} / 우리: ${sl.visual.right}` : ""}`, ...sl.support.map((x) => `- ${x}`), "", `발표자 노트: ${sl.notes || "없음"}`, `근거: ${sl.refs.join(", ")}`, `아직 확인 못 한 것: ${sl.gaps.join(" · ") || "없음"}`, ""].join("\n")
      : `# ${nn(t.no)} · ${t.title}\n\n${when ? `${when}${label}에 채움. ` : ""}질문: ${t.question}\n`;
  }
  const drafted = template.slides.filter((t) => s.deck[String(t.no)]);
  const slidesHtml = template.slides.map((t) => {
    const sl = s.deck[String(t.no)];
    if (!sl) {
      const when = plannedSession(plan, t.no);
      return `<section class="todo notes-only"><span class="kicker">${nn(t.no)} · ${esc(t.title)}</span><p>${when ? `${when}${label}에 채움 · ` : ""}${esc(t.question)}</p></section>`;
    }
    const supporting = sl.support.length ? `<ul class="support">${sl.support.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
    return `<article class="slide${now.includes(t.no) ? " now" : ""}" id="s${t.no}">
<div class="frame"><span class="kicker">${nn(t.no)} · ${esc(t.title)}</span><h2>${esc(sl.headline)}</h2><div class="visual">${visualHtml(sl.visual, productSrc)}</div>${supporting}<span class="basis">${esc(basisLabel(s, sl.refs))}</span><span class="foot">${esc(s.team)}</span></div>
<aside class="notes notes-only"><p><b>발표자 노트</b> ${esc(sl.notes || "없음")}</p><p><b>근거</b> ${sl.refs.map((r) => `<span class="id">${esc(r)}</span>`).join(" ")} · ${sl.session}${label} 초안</p>${sl.gaps.length ? `<p><b>아직 확인 못 한 것</b> ${esc(sl.gaps.join(" · "))}</p>` : ""}</aside></article>`;
  }).join("\n");
  const checks = [...lintDeck(s), ...s.dropped.filter((x) => x.split(" ")[1] === "덱").map((x) => `${x.split(" ").slice(1).join(" ")} → 화면에 올리지 않았어요`)];
  files["deck.html"] = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(template.title || "피칭 덱")} · ${esc(s.team)}</title><style>${CSS}</style></head>
<body><header class="bar"><div><b>${esc(s.team)}</b> · ${esc(template.title || "피칭 덱")} · ${drafted.length} / ${template.slides.length}장 · ${last}${label}</div>
<label class="toggle"><input type="checkbox" onchange="document.body.classList.toggle('show-notes', this.checked)"> 발표자 노트·근거</label></header>
<main>${checks.length ? `<ul class="checks notes-only">${checks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
${drafted.length ? "" : `<p class="empty">아직 만든 장이 없어요.</p>`}${slidesHtml}</main></body></html>`;
  return files;
}

const CSS = `:root{--bg:#eef1ea;--paper:#fbfcf8;--ink:#13221c;--ink-2:#3d4b44;--ink-3:#5f6c65;--brand:#153c32;--brand-2:#2c6b55;--line:#d8e1d1;--soft:#e8efe0;--warm:#fbf2e4;--warn:#7a4f0e}
@media (prefers-color-scheme:dark){:root{--bg:#0f1512;--paper:#16201b;--ink:#e8eee9;--ink-2:#bcc8c0;--ink-3:#93a199;--brand:#9fd8bd;--brand-2:#74c49a;--line:#2a3830;--soft:#1d2a23;--warm:#2b2416;--warn:#e2b76a}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font-family:"Apple SD Gothic Neo","Pretendard","Noto Sans KR",system-ui,sans-serif;word-break:keep-all;overflow-wrap:anywhere}
.bar{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 20px;background:var(--bg);border-bottom:1px solid var(--line);font-size:14px;color:var(--ink-2)}
.toggle{display:flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap}
main{max-width:1180px;margin:0 auto;padding:24px 20px 80px;display:flex;flex-direction:column;gap:28px}
.slide .frame{position:relative;aspect-ratio:16/9;background:var(--paper);border-radius:18px;box-shadow:0 1px 0 var(--line),0 12px 32px rgba(21,60,50,.10);padding:clamp(22px,4.2vw,56px);display:grid;grid-template-rows:auto auto 1fr auto;gap:clamp(8px,1.4vw,18px);overflow:hidden}
.slide.now .frame{outline:3px solid var(--brand-2);outline-offset:4px}
.kicker{font-size:clamp(11px,1.1vw,14px);letter-spacing:.06em;color:var(--brand-2);font-weight:700}
.slide h2{margin:0;font-size:clamp(22px,3.6vw,46px);line-height:1.22;letter-spacing:-.02em;color:var(--brand);font-weight:800;max-width:30ch}
.visual{display:flex;align-items:center;min-height:0}
.v-number .big{font-size:clamp(48px,9vw,120px);font-weight:800;line-height:1;color:var(--brand);letter-spacing:-.03em}.v-number .lbl,.v-product .lbl,.v-quote figcaption{font-size:clamp(13px,1.5vw,19px);color:var(--ink-2);margin-top:8px}
.v-quote{margin:0;border-left:6px solid var(--brand-2);padding-left:clamp(14px,2vw,26px)}.v-quote blockquote{margin:0;font-size:clamp(20px,3vw,38px);line-height:1.35;font-weight:700;color:var(--ink)}
.v-product{width:100%;height:100%;display:flex;flex-direction:column}.v-product iframe{flex:1;width:min(100%,560px);min-height:150px;border:1px solid var(--line);border-radius:12px;background:#fff}
.v-steps{list-style:none;margin:0;padding:0;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:clamp(8px,1.4vw,18px);width:100%;counter-reset:s}.v-steps li{counter-increment:s;background:var(--soft);border-radius:14px;padding:clamp(12px,1.6vw,20px);font-size:clamp(14px,1.7vw,21px);font-weight:600;line-height:1.35}.v-steps li::before{content:counter(s);display:block;font-size:clamp(20px,2.6vw,32px);font-weight:800;color:var(--brand-2);margin-bottom:6px}
.v-compare{display:grid;grid-template-columns:1fr auto 1fr;gap:clamp(10px,1.6vw,22px);align-items:center;width:100%}.v-compare .col{border-radius:14px;padding:clamp(14px,1.8vw,24px);font-size:clamp(15px,1.9vw,23px);line-height:1.4;font-weight:600}.v-compare .col span{display:block;font-size:12px;letter-spacing:.06em;font-weight:700;margin-bottom:6px}.v-compare .before{background:var(--warm);color:var(--ink-2)}.v-compare .after{background:var(--soft);color:var(--brand)}.v-compare .arrow{font-size:clamp(20px,3vw,36px);color:var(--brand-2)}.v-compare p{margin:0}
.v-statement{margin:0;font-size:clamp(18px,2.6vw,32px);line-height:1.4;font-weight:700;color:var(--ink-2)}
.support{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px 18px;font-size:clamp(13px,1.5vw,18px);color:var(--ink-2)}.support li::before{content:"· ";color:var(--brand-2);font-weight:800}
.basis{position:absolute;left:clamp(16px,3vw,40px);bottom:clamp(10px,1.6vw,20px);font-size:12px;color:var(--ink-3);background:var(--soft);border-radius:999px;padding:2px 10px}.foot{position:absolute;right:clamp(16px,3vw,40px);bottom:clamp(10px,1.6vw,20px);font-size:12px;color:var(--ink-3)}
.notes-only{display:none}.show-notes .notes-only{display:block}
.notes{margin-top:10px;background:var(--paper);border:1px dashed var(--line);border-radius:12px;padding:12px 16px;font-size:14px;line-height:1.6;color:var(--ink-2)}.notes p{margin:4px 0}.notes b{color:var(--ink)}
.id{font-family:ui-monospace,monospace;font-size:12px;background:var(--soft);border-radius:5px;padding:1px 6px;color:var(--ink-3)}
.todo{border:1px dashed var(--line);border-radius:14px;padding:12px 16px;color:var(--ink-3);font-size:14px}.todo p{margin:4px 0 0}
.checks{margin:0;padding:0;list-style:none}.checks li{background:var(--warm);color:var(--warn);border-radius:10px;padding:8px 14px;margin:6px 0;font-size:14px}
.empty{color:var(--ink-3)}
@media (max-width:720px){.slide .frame{aspect-ratio:auto;min-height:340px}.v-steps{grid-auto-flow:row}.v-compare{grid-template-columns:1fr}.v-compare .arrow{transform:rotate(90deg);justify-self:center}}
@media print{.bar,.notes-only{display:none!important}main{padding:0;gap:0}.slide{break-after:page}.slide .frame{box-shadow:none;border-radius:0}}`;
