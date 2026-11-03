// Slide suggestion chips (CGP-ART-R-016, REQ-STUDIO-DECK-SLIDE-SUGGEST). A drafted deck slide offers up
// to three chips (쉽게 줄이기, 그림으로 보이기, 핵심 강조). A chip asks the model for a patch to that one
// slide; the patch is gated here and shown as a before/after proposal the student accepts or rejects.
//
// The gate is conservative (CR-56 + the deckGenerator numbers rule):
// - the answer may name only the chosen slide; an answer touching any other slide is refused whole;
// - the patch may change the slide face only (headline, visual, support); refs, notes, gaps and the
//   session stay as they were, so a patch can never cite a new entry or add a new claim source;
// - every number on the new face, in any script (numerals.ts: Unicode digits, number forms, Hanja
//   numerals, Korean number words), must have its exact value in the entries the slide already cites;
//   the raw model text is read too, before NFKC turns a Roman numeral into letters;
// - a quote must be the slide's own quote or appear verbatim in those entries, and its speaker label
//   must be the slide's own label for its own quote, or appear in those entries;
// - a source phrase (조사, 통계, 발표, 보고서, 장관, 연구, …) and the word before it must appear in those
//   entries, and no wiki id (E-2, D-1, H3, …) may appear on the face;
// - accepting applies the patch only while the slide is still byte-identical to the "before" it was
//   computed from; rejecting writes nothing.
// Pure and vscode-free, like deckGenerator.ts.

import type { LearningWikiPlan, WikiState } from "./learningWiki.ts";
import { foldNumerals, unsupportedNumbers, unsupportedQuantityWords } from "./numerals.ts";
import { basisLabel, citedText, type DeckProposal, type DeckTemplate, type PitchSlide, type Visual, type VisualType } from "./deckGenerator.ts";
import { CONFIDENCE_LABEL, type Confidence } from "./memoryView.ts";

export type SlideChip = "simplify" | "visual" | "highlight";

/** The chips, in display order. Learner copy is Korean. */
export const SLIDE_CHIPS: ReadonlyArray<{ id: SlideChip; label: string; hint: string; ask: string }> = [
  {
    id: "simplify",
    label: "쉽게 줄이기",
    hint: "제목과 짧은 문장을 더 짧고 쉬운 말로",
    ask: "듣는 사람이 한 번에 읽도록 headline과 support를 더 짧고 쉬운 말로 줄인다. 주장과 숫자는 그대로 두고, support는 줄이거나 뺀다.",
  },
  {
    id: "visual",
    label: "그림으로 보이기",
    hint: "글로 된 내용을 숫자·단계·비교 그림 하나로",
    ask: "글로 된 내용을 visual 하나로 옮긴다. number, steps, compare 중 근거에 맞는 것을 고르고, 근거에 없는 숫자나 단계를 만들지 않는다.",
  },
  {
    id: "highlight",
    label: "핵심 강조",
    hint: "가장 중요한 한 가지가 먼저 보이게",
    ask: "이 장에서 가장 중요한 한 가지가 headline에서 먼저 보이게 고치고, 나머지는 줄인다.",
  },
];
export const MAX_SLIDE_CHIPS = 3;

/** The chips a slide offers: none until it is drafted, at most three. */
export function slideChips(s: WikiState, no: number): Array<(typeof SLIDE_CHIPS)[number]> {
  return s.deck[String(no)] ? SLIDE_CHIPS.slice(0, MAX_SLIDE_CHIPS) : [];
}

const VISUALS: VisualType[] = ["number", "quote", "product", "steps", "compare", "statement"];
const CAP = 80;

/** Untrusted model text → one plain line: NFKC, controls, U+2028/2029 and bidi controls removed, capped. */
export function cleanLine(v: unknown, cap = CAP): string {
  if (typeof v !== "string") return "";
  const t = v
    .normalize("NFKC")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...t].slice(0, cap).join("");
}

export function slideSuggestionPrompt(s: WikiState, template: DeckTemplate, no: number, chip: SlideChip, plan?: LearningWikiPlan): string {
  const sl = s.deck[String(no)];
  const t = template.slides.find((x) => x.no === no);
  const c = SLIDE_CHIPS.find((x) => x.id === chip)!;
  const entries = sl ? citedEntries(s, sl.refs) : [];
  return `너는 ${plan?.audience || "학습 팀"}의 피칭 덱에서 ${no}번 장 하나만 다듬는다${t ? ` ("${t.title}", 이 장이 답할 질문: ${t.question})` : ""}.

할 일: ${c.ask}

규칙
- ${no}번 장 하나만 고친다. 다른 장은 답에 넣지 않는다.
- 주장은 바꾸지 않는다. 화면의 숫자는 아래 근거에 그대로 있는 것만 쓴다. 사람, 숫자, 날짜, 사실, 인용을 만들지 않는다.
- quote는 지금 장의 인용을 그대로 두거나, 아래 근거에 그대로 있는 말만 쓴다.
- headline은 28자 안팎, support는 0~2개, 각 20자 안팎.
- "위키", "기록", "근거 번호" 같은 말은 화면 문장에 쓰지 않는다.

JSON 하나만 출력하고 앞뒤에 다른 말을 쓰지 않는다:
{"slides": [{"no": ${no}, "headline": "", "visual": {"type": "number|quote|product|steps|compare|statement", "value": "", "label": "", "items": [], "left": "", "right": ""}, "support": []}]}

지금 장
${JSON.stringify(sl ? { headline: sl.headline, visual: sl.visual, support: sl.support } : null)}

근거
${JSON.stringify(entries)}`;
}

function citedEntries(s: WikiState, refs: string[]): Array<{ id: string; text: string }> {
  return refs.map((r) => ({ id: r, text: citedText(s, [r]) })).filter((x) => x.text);
}

// A wiki id on the slide face (E-2, D-1, H3, P-1; any dash), which the prompt already forbids.
const WIKI_ID = /(?<![A-Za-z0-9])[EDHPedhp]\s*[-\u2010-\u2015\u2212\uFE63\uFF0D]?\s*\d+(?![0-9])/u;
// Words that name where a claim comes from. A face word containing one, and the word before it ("통계청
// 조사", "보건복지부 장관"), must appear in the slide's cited entries.
const SOURCE_TERMS = [
  "조사", "통계", "발표", "보고서", "장관", "연구", "논문", "설문", "출처", "기관", "정부", "협회", "학회", "대학", "교수", "박사",
  "전문가", "기사", "뉴스", "신문", "보도", "따르면", "밝혔", "위원회", "연구소", "연구원", "재단", "공단", "부처", "대통령", "국회", "의원",
  "survey", "study", "studies", "report", "research", "statistic", "according", "source", "minister", "ministry", "institute",
  "university", "professor", "gallup", "oecd", "who", "un", "병원", "유튜브", "youtube", "보건소", "식약처", "질병청", "poll", "nyt",
];
const PARTICLE = /(?:에서|으로|에게|까지|부터|이라|라고|에|의|은|는|이|가|을|를|도|와|과|로|께서|께)$/u;
const bare = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const isSourceWord = (w: string) => {
  const lw = w.toLowerCase();
  return SOURCE_TERMS.some((t) => (!/^[a-z]+$/.test(t) ? lw.includes(t) : t.length <= 3 ? lw === t : lw.startsWith(t)));
};
// The forms of a face word to look up in the cited text: the word itself, and the word without a trailing
// particle only when that keeps at least two syllables and does not cut the source word (보도 is not 보 + 도).
function forms(w: string): string[] {
  const s = w.replace(PARTICLE, "");
  if (s === w || [...s].length < 2 || (isSourceWord(w) && !isSourceWord(s))) return [w];
  return [w, s];
}

/** Source words on the face (and the word each follows) that the cited entries do not contain. */
export function unsupportedSources(face: string[], cited: string): string[] {
  const have = cited.toLowerCase();
  const out: string[] = [];
  for (const line of face) {
    const words = line.split(/\s+/).map(bare).filter(Boolean);
    words.forEach((w, i) => {
      if (!isSourceWord(w)) return;
      for (const x of i > 0 ? [words[i - 1], w] : [w]) if (!forms(x).some((f) => have.includes(f.toLowerCase()))) out.push(x);
    });
  }
  return [...new Set(out)];
}

export interface SlidePatch { no: number; chip: SlideChip; before: PitchSlide; after: PitchSlide; refs: string[]; basis: string }
export type SlidePatchCheck = { ok: true; patch: SlidePatch } | { ok: false; reason: string };

const sameSlide = (a: PitchSlide | undefined, b: PitchSlide | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Gates a model answer for one slide; see the file header for the rules. */
export function checkSlidePatch(s: WikiState, template: DeckTemplate, no: number, chip: SlideChip, answer: DeckProposal | null): SlidePatchCheck {
  const before = s.deck[String(no)];
  if (!before || !template.slides.some((x) => x.no === no)) return { ok: false, reason: "아직 초안이 없는 장이에요." };
  if (!SLIDE_CHIPS.some((x) => x.id === chip)) return { ok: false, reason: "고를 수 없는 제안이에요." };
  const slides = Array.isArray(answer?.slides) ? answer!.slides : [];
  if (!slides.length) return { ok: false, reason: "제안을 받지 못했어요." };
  if (slides.length !== 1 || Number(slides[0]?.no) !== no) return { ok: false, reason: "다른 장까지 고치려 해서 올리지 않았어요." };
  const p = slides[0];
  const headline = cleanLine(p.headline);
  if (!headline) return { ok: false, reason: "제목이 빈 제안이라 올리지 않았어요." };
  const v = (p.visual ?? {}) as Partial<Visual>;
  const type = (VISUALS.includes(v.type as VisualType) ? v.type : "statement") as VisualType;
  const items = Array.isArray(v.items) ? v.items.map((x) => cleanLine(x)).filter(Boolean).slice(0, 4) : [];
  const visual: Visual = { type, value: cleanLine(v.value), label: cleanLine(v.label), items, left: cleanLine(v.left), right: cleanLine(v.right) };
  const support = Array.isArray(p.support) ? p.support.map((x) => cleanLine(x)).filter(Boolean).slice(0, 2) : [];
  const citedRaw = citedText(s, before.refs);
  const cited = citedRaw.normalize("NFKC");
  if (type === "quote") {
    const ownQuote = before.visual.type === "quote" && cleanLine(before.visual.value) === visual.value;
    if (!visual.value || (!ownQuote && !cited.includes(visual.value))) return { ok: false, reason: "근거에 없는 말을 인용하려 해서 올리지 않았어요." };
    const ownLabel = ownQuote && cleanLine(before.visual.label) === visual.label;
    if (visual.label && !ownLabel && !cited.includes(visual.label)) return { ok: false, reason: "근거에 없는 사람의 말로 바꾸려 해서 올리지 않았어요." };
  }
  const face = [headline, visual.value, visual.label, ...items, visual.left, visual.right, ...support].map((x) => x ?? "");
  if (face.some((x) => WIKI_ID.test(foldNumerals(x)))) return { ok: false, reason: "화면 문장에 근거 번호가 들어가서 올리지 않았어요." };
  const source = unsupportedSources(face, cited);
  if (source.length) return { ok: false, reason: `근거에 없는 출처(${source.join(", ")})가 있어서 올리지 않았어요.` };
  const raw = [p.headline, v.value, v.label, v.items, v.left, v.right, p.support].flat().filter((x): x is string => typeof x === "string");
  const bad = unsupportedNumbers([...face, ...raw].join(" "), citedRaw);
  if (bad.length) return { ok: false, reason: `근거에 없는 숫자(${bad.join(", ")})가 있어서 올리지 않았어요.` };
  // No new quantity words (owner decision): every quantity word must already be on this slide or in its cited entries.
  const beforeFace = [before.headline, before.visual.value, before.visual.label, ...(before.visual.items ?? []), before.visual.left, before.visual.right, ...before.support].join(" ");
  const newWords = unsupportedQuantityWords([...face, ...raw].join(" "), `${beforeFace} ${citedRaw}`);
  if (newWords.length) return { ok: false, reason: `근거에 없는 수량 표현(${newWords.join(", ")})이 있어서 올리지 않았어요.` };
  const after: PitchSlide = { ...before, headline, visual, support };
  if (sameSlide(after, before)) return { ok: false, reason: "바꿀 곳이 없다는 답이었어요." };
  return { ok: true, patch: { no, chip, before: JSON.parse(JSON.stringify(before)), after, refs: [...before.refs], basis: basisLabel(s, before.refs) } };
}

/**
 * The accepted patch applied to a fresh copy of the state: only that slide changes, and only while it
 * is still exactly the slide the patch was computed from. Returns null when the slide changed since.
 */
export function applySlidePatch(s: WikiState, patch: SlidePatch): WikiState | null {
  if (!sameSlide(s.deck[String(patch.no)], patch.before)) return null;
  const next: WikiState = JSON.parse(JSON.stringify(s));
  next.deck[String(patch.no)] = JSON.parse(JSON.stringify(patch.after));
  return next;
}

/** The slide face as plain lines, for the before/after proposal. */
export function slideFaceLines(sl: PitchSlide): string[] {
  const v = sl.visual;
  const vis =
    v.type === "number" ? `큰 숫자: ${v.value ?? ""}${v.label ? ` (${v.label})` : ""}`
    : v.type === "quote" ? `인용: “${v.value ?? ""}”${v.label ? ` (${v.label})` : ""}`
    : v.type === "product" ? `제품 화면${v.label ? `: ${v.label}` : ""}`
    : v.type === "steps" ? `단계: ${(v.items ?? []).join(" → ")}`
    : v.type === "compare" ? `지금: ${v.left ?? ""} / 우리: ${v.right ?? ""}`
    : `문장: ${v.value ?? ""}`;
  return [`제목: ${sl.headline}`, vis, ...sl.support.map((x) => `· ${x}`)];
}

/** The before/after proposal text shown with 반영 and 그대로, including the evidence basis label. */
export function slidePatchDetail(patch: SlidePatch): string {
  const chip = SLIDE_CHIPS.find((x) => x.id === patch.chip)?.label ?? "";
  return [`[${chip}]`, "", "지금", ...slideFaceLines(patch.before), "", "바꾼 안", ...slideFaceLines(patch.after), "", `${patch.basis} (근거는 그대로예요)`].join("\n");
}

/**
 * The evidence label of a slide's claim (CR-55, DES-ART-16), computed from what the slide cites, never from the
 * model: observed only when every ref is evidence observed for real; assumed when it cites no evidence at all
 * (only the problem, a hypothesis or a decision); interpreted otherwise (team trials, simulations, or evidence
 * mixed with a decision or hypothesis). A patch keeps the refs, so the label never changes with a proposal.
 */
export function claimConfidence(s: WikiState, refs: string[]): Confidence {
  const cited = refs.map((r) => s.E.find((e) => e.id === r)).filter((e) => !!e);
  if (!cited.length) return "assumed";
  return cited.length === refs.length && cited.every((e) => e.state === "real") ? "observed" : "interpreted";
}

export interface ProposalRow { label: string; before: string; after: string; changed: boolean }

/** The before/after proposal as aligned rows (title, visual, each support line), each marked when it changed. */
export function slidePatchRows(patch: SlidePatch): ProposalRow[] {
  const rows: Array<[string, string, string]> = [
    ["제목", patch.before.headline, patch.after.headline],
    ["그림", slideFaceLines(patch.before)[1], slideFaceLines(patch.after)[1]],
  ];
  const n = Math.max(patch.before.support.length, patch.after.support.length);
  for (let i = 0; i < n; i++) rows.push([`짧은 문장 ${i + 1}`, patch.before.support[i] ?? "", patch.after.support[i] ?? ""]);
  return rows.map(([label, before, after]) => ({ label, before, after, changed: before !== after }));
}

export { CONFIDENCE_LABEL, type Confidence };
