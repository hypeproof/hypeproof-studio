// DEC-30 step 3 (CGP-KNOW-R-037 learner side, CGP-KNOW-D-037) — a lesson's starter sentences and AI role line,
// read from what the Service serves on /v1/profile. Vscode-free and Buffer-free, like coachIdentity.ts, so the
// extension host and the webview read the same rule.
//
// The Service projects `starters` (0..4 single lines, 80 units each) and `assistant_style` ({ role?, tone?,
// tone_clamped? }) onto the learner seat. Both keys are absent for a lesson that sets none, and then nothing here
// draws anything. Starters are editable suggestions: they are inserted into the draft, never sent.
//
// NOT here, by decision: role and tone are never put into a coach prompt in this change (DEC-30 step 4 follows a
// safety review). Role is display text only, and only from `assistant_style`, never from the raw lesson content
// (a minor seat's served lesson has no raw role/tone; `assistant_style` is its only clamped source).

export const STARTERS_MAX_COUNT = 4;
export const STARTER_MAX_UNITS = 80;
export const ASSISTANT_ROLE_MAX_UNITS = 80;

// Control characters, bidi controls, line/paragraph separators and zero-width characters are not a single plain line.
const UNSAFE_LINE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

const oneLine = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || UNSAFE_LINE.test(text)) return null;
  return text;
};

const dedupeKey = (text: string): string => text.normalize("NFKC").toLowerCase();

/**
 * The starters to draw: at most four, in served order, each a trimmed single line of 1..80 units, no duplicates
 * (NFKC, case-insensitive). Anything else the Service sent is skipped, so a malformed entry never reaches the screen.
 * Empty → `[]`, and the webview draws nothing (byte-identical to a lesson without starters).
 */
export function servedLessonStarters(profile: { starters?: unknown } | null | undefined): string[] {
  const raw = profile?.starters;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const text = oneLine(item, STARTER_MAX_UNITS);
    if (text === null) continue;
    const key = dedupeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === STARTERS_MAX_COUNT) break;
  }
  return out;
}

/** The AI's one-line role, from `assistant_style.role` only. Never read from `lesson.content`. Absent or unsafe → null. */
export function servedAssistantRole(profile: { assistant_style?: unknown } | null | undefined): string | null {
  const style = profile?.assistant_style;
  if (typeof style !== "object" || style === null) return null;
  return oneLine((style as { role?: unknown }).role, ASSISTANT_ROLE_MAX_UNITS);
}

/** The learner has sent at least one message in this task: starters have done their job and go away. */
export function learnerHasSent(messages: ReadonlyArray<{ role: string }>): boolean {
  return messages.some((m) => m.role === "user");
}
