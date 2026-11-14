// CGP-AGENT-R-020 (Jay, 2026-11-14) — the lesson's learner skill cards, read from what the Service serves on
// /v1/profile as `skill_cards` (hypeproof-service#488). Vscode-free and Buffer-free, like lessonStarters.ts, so the
// extension host and the webview read the same rule.
//
// A card is authored in Chalk and frozen with the lesson version: a name, a one-line summary and a starter prompt.
// Studio shows only these cards on a read-only shelf; "써 보기" puts the prompt into the draft and never sends. It is
// never the coach's SKILL.md or `Profile.skills`, which Studio does not show.
//
// Re-validated here, not trusted: anything malformed is skipped, so an old or bad entry never reaches the screen.
// Empty → `[]`, and the webview draws no shelf (byte-identical to a lesson without cards).

export const SKILL_CARDS_MAX_COUNT = 6;
export const SKILL_CARD_NAME_MAX_UNITS = 30;
export const SKILL_CARD_SUMMARY_MAX_UNITS = 80;
export const SKILL_CARD_PROMPT_MAX_UNITS = 300;
export const SKILL_CARD_PROMPT_MAX_LINES = 6;

export interface SkillCard { name: string; summary: string; prompt: string }

// Control characters, bidi controls, line/paragraph separators and zero-width characters are not a single plain line.
const UNSAFE_LINE = /[\p{Cc}\p{Cf}  ]/u;

/**
 * The Service's `hasLink` (lesson-skill-cards.ts): NFKC first, then any scheme token (a word with a Latin letter
 * directly followed by ':' and a non-space, confusable mixes included), `www.`, or `//` at the start or after a space.
 */
export function hasLink(text: string): boolean {
  const n = text.normalize("NFKC");
  if (/(?:^|\s)\/\//u.test(n)) return true;
  if (/(?:^|[^\p{L}\p{N}])www\./iu.test(n)) return true;
  for (const m of n.matchAll(/(?:^|[^\p{L}\p{N}+.\-])([\p{L}\p{N}][\p{L}\p{N}\p{M}+.\-]*):(?=\S)/gu)) if (/[A-Za-z]/.test(m[1]!)) return true;
  return false;
}

const oneLine = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || UNSAFE_LINE.test(text) || hasLink(text)) return null;
  return text;
};

const prompt = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > SKILL_CARD_PROMPT_MAX_UNITS || hasLink(text)) return null;
  const lines = text.split("\n");
  if (lines.length > SKILL_CARD_PROMPT_MAX_LINES || lines.some((l) => UNSAFE_LINE.test(l))) return null;
  return text;
};

const dedupeKey = (text: string): string => text.normalize("NFKC").toLowerCase();

/** The cards to draw: at most six, in served order, each with a safe name, summary and prompt, names unique. */
export function servedSkillCards(profile: { skill_cards?: unknown } | null | undefined): SkillCard[] {
  const raw = profile?.skill_cards;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SkillCard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const name = oneLine(c.name, SKILL_CARD_NAME_MAX_UNITS);
    const summary = oneLine(c.summary, SKILL_CARD_SUMMARY_MAX_UNITS);
    const text = prompt(c.prompt);
    if (name === null || summary === null || text === null) continue;
    const key = dedupeKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, summary, prompt: text });
    if (out.length === SKILL_CARDS_MAX_COUNT) break;
  }
  return out;
}
