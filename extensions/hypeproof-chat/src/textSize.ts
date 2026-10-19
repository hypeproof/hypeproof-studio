/**
 * CGP-DS-R-009: the learner chooses how large chat text reads in personal chat: body and composer
 * 16/18/20px, reply-choice text +2/+4px. 44px targets stay as they are. The choice is a device
 * preference (globalState), not part of any lesson or activity. Classroom seats have no settings
 * dialog yet, so they keep the base size.
 */
export const TEXT_SIZES = ["base", "large", "xlarge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TEXT_SIZE_LABELS: Record<TextSize, string> = { base: "기본", large: "크게", xlarge: "아주 크게" };
export const TEXT_SIZE_KEY = "hypeproof.textSize";

export function normalizeTextSize(value: unknown): TextSize {
  return (TEXT_SIZES as readonly unknown[]).includes(value) ? (value as TextSize) : "base";
}
