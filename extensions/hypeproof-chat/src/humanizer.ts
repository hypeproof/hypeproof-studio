// Humanizer skill (generic): rewrites short texts so they read like a person wrote them, without
// changing what they say. Rules condensed into Korean from the "humanizer" skill (MIT, based on
// Wikipedia's "Signs of AI writing"): no not-X-but-Y contrasts, no one-line closers or staged
// openers, no forced triads, no dashes, no inflated or sales language, no stock AI words, no bold
// labels. A rewrite is accepted only when it adds no number the original did not have and does not
// balloon; otherwise the original stays. Pure and vscode-free.

export const HUMANIZER_RULES = [
  "대조 구문을 쓰지 않는다: \"A가 아니라 B\", \"단순한 A를 넘어 B\"처럼 아무도 말하지 않은 것을 부정해 무게를 싣는 문장.",
  "한 줄 마무리와 감탄을 쓰지 않는다: 앞 문장을 되풀이하는 짧은 결론, \"이것이 핵심이다\" 같은 말.",
  "도입부 연출을 쓰지 않는다: \"자, 이제\", \"솔직히\", \"중요한 건\"처럼 본론 앞에 거는 말.",
  "3개씩 맞춘 나열을 습관처럼 쓰지 않는다. 뜻이 셋일 때만 셋을 쓴다.",
  "긴 대시(—, –)를 쓰지 않는다. 쉼표, 마침표, 괄호로 바꾼다.",
  "과장과 홍보 말투를 쓰지 않는다: \"혁신적인\", \"획기적\", \"놀라운\", \"완벽한\", \"게임 체인저\".",
  "의미 부풀리기를 쓰지 않는다: \"새로운 장을 열다\", \"큰 의미가 있다\", \"앞으로가 기대된다\".",
  "굵은 라벨이나 제목식 꾸밈을 쓰지 않는다.",
  "사실, 숫자, 이름, 날짜, 인용은 바꾸거나 더하지 않는다. 문장에 필요한 정보가 없으면 더 단순한 문장으로 쓴다.",
  "짧고 구체적으로, 듣는 사람에게 말하듯 쓴다.",
];

export interface TextItem { id: string; text: string }
export interface HumanizeProposal { items?: Array<{ id?: string; text?: string }> }

export function humanizePrompt(items: TextItem[], context = ""): string {
  return `아래 TEXTS의 문장을 사람이 쓴 것처럼 다듬는다${context ? ` (${context})` : ""}. 뜻은 그대로 두고 표현만 고친다.

규칙
${HUMANIZER_RULES.map((r) => `- ${r}`).join("\n")}
- 이미 자연스러운 문장은 그대로 돌려준다. id는 바꾸지 않고 모든 항목을 돌려준다.

JSON 하나만 출력하고 앞뒤에 다른 말을 쓰지 않는다:
{"items": [{"id": "", "text": ""}]}

TEXTS
${JSON.stringify(items)}`;
}

const numbers = (t: string) => new Set(t.match(/\d+(?:[.,]\d+)?/g) ?? []);

/** Long dashes to commas: the one rule that needs no model. */
export function stripDashes(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ", ").replace(/\s+--\s+/g, ", ").replace(/,\s*,/g, ",").trim();
}

/**
 * Accepts each rewrite only when it is non-empty, adds no number the original lacks and is at most
 * 1.5× the original length (+10). Everything else keeps the original. Dashes are stripped either way.
 */
export function applyHumanized(items: TextItem[], proposal: HumanizeProposal | null): { items: TextItem[]; changed: number; rejected: string[] } {
  const byId = new Map((proposal?.items ?? []).filter((x) => typeof x?.id === "string" && typeof x?.text === "string").map((x) => [x.id!, x.text!.trim()]));
  const rejected: string[] = [];
  let changed = 0;
  const out = items.map((it) => {
    const next = byId.get(it.id);
    if (!next || next === it.text) return { ...it, text: stripDashes(it.text) };
    const orig = numbers(it.text);
    const added = [...numbers(next)].filter((n) => !orig.has(n));
    if (added.length || next.length > it.text.length * 1.5 + 10) {
      rejected.push(`${it.id}: ${added.length ? `새 숫자 ${added.join(", ")}` : "너무 길어짐"}`);
      return { ...it, text: stripDashes(it.text) };
    }
    changed++;
    return { ...it, text: stripDashes(next) };
  });
  return { items: out, changed, rejected };
}
